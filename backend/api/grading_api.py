"""
03_grading_api.py  ->  save as api/grading_api.py (new file, nothing existing is edited here)

Wire-up in api/urls.py:
    from .grading_api import GradingSchemeViewSet, PromotionSettingsView, PromotionRunView
    router.register("grading-schemes", GradingSchemeViewSet, basename="grading-scheme")
    urlpatterns += [
        path("promotion-settings/", PromotionSettingsView.as_view()),
        path("promotion-settings/run/", PromotionRunView.as_view()),
    ]
"""
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models, services

READ_ROLES = ("ADMIN", "EXAM_OFFICER", "PRINCIPAL")
WRITE_ROLES = ("ADMIN", "EXAM_OFFICER")


class CanManageGrading(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated):
            return False
        return u.role in (READ_ROLES if request.method in SAFE_METHODS else WRITE_ROLES)


# ---------------------------------------------------------------------------
# validation helpers
# ---------------------------------------------------------------------------
def validate_bands(bands):
    """Raises ValueError with a plain-language message. Every score 0-100 must get a grade."""
    if not bands:
        raise ValueError("Add at least one grade band.")
    rows, letters = [], set()
    for b in bands:
        try:
            lo, hi = Decimal(str(b["min_percentage"])), Decimal(str(b["max_percentage"]))
            pts = Decimal(str(b.get("points", 0) or 0))
        except (InvalidOperation, KeyError):
            raise ValueError("Every band needs numeric min, max and points.")
        letter = str(b.get("grade_letter", "")).strip()
        if not letter:
            raise ValueError("Every band needs a grade letter.")
        if letter.upper() in letters:
            raise ValueError(f"Grade '{letter}' appears more than once.")
        letters.add(letter.upper())
        if lo < 0 or hi > 100 or lo > hi:
            raise ValueError(f"{letter}: the range must sit within 0-100 and min cannot exceed max.")
        if pts < 0:
            raise ValueError(f"{letter}: points cannot be negative.")
        rows.append((lo, hi, letter))
    rows.sort()
    if rows[0][0] != 0:
        raise ValueError("The lowest band must start at 0 so every score gets a grade.")
    if rows[-1][1] < 100:
        raise ValueError("The highest band must reach 100.")
    for (_, hi1, l1), (lo2, _, l2) in zip(rows, rows[1:]):
        if lo2 <= hi1:
            raise ValueError(f"Bands {l1} and {l2} overlap.")
    return rows


def assert_term_is_safe(term, grade_level):
    """A new scale may only start in a term that hasn't finished and has no published results it could change."""
    if term.end_date < timezone.localdate():
        raise ValueError(f"{term} has already finished - choose the current or an upcoming term.")
    exams = models.Exam.objects.filter(term=term, is_published=True)
    if grade_level:
        exams = exams.filter(grade_level=grade_level)
    if exams.exists():
        raise ValueError(
            f"Exams in {term} are already published, so a scale starting then would change grades "
            "students have seen. Choose the next term."
        )


def next_version(curriculum_type, grade_level, subject):
    top = models.GradingScheme.objects.filter(
        curriculum_type=curriculum_type, grade_level=grade_level, subject=subject
    ).aggregate(m=Max("version"))["m"]
    return (top or 0) + 1


# ---------------------------------------------------------------------------
# serializers
# ---------------------------------------------------------------------------
class GradingBandSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.GradingBand
        fields = ["id", "min_percentage", "max_percentage", "grade_letter", "points", "remark"]
        read_only_fields = ["id"]


class GradingSchemeSerializer(serializers.ModelSerializer):
    bands = GradingBandSerializer(many=True)
    curriculum_type = serializers.ChoiceField(choices=models.CurriculumType.choices, required=False)
    grade_level_name = serializers.CharField(source="grade_level.name", read_only=True, default=None)
    subject_name = serializers.CharField(source="subject.name", read_only=True, default=None)
    term_label = serializers.CharField(source="effective_from_term.__str__", read_only=True)
    scope_label = serializers.CharField(read_only=True)
    created_by_name = serializers.CharField(source="created_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = models.GradingScheme
        fields = [
            "id", "name", "curriculum_type", "grade_level", "grade_level_name", "subject", "subject_name",
            "effective_from_term", "term_label", "version", "status", "notes", "scope_label",
            "created_by_name", "created_at", "published_at", "bands",
        ]
        read_only_fields = ["version", "status", "created_at", "published_at"]

    def validate(self, attrs):
        inst = self.instance
        grade_level = attrs.get("grade_level", inst.grade_level if inst else None)
        subject = attrs.get("subject", inst.subject if inst else None)
        curriculum = (
            grade_level.curriculum_type if grade_level
            else attrs.get("curriculum_type", inst.curriculum_type if inst else None)
        )
        if not curriculum:
            raise serializers.ValidationError("Choose a class or a curriculum.")
        if subject and subject.curriculum_type != curriculum:
            raise serializers.ValidationError("That subject belongs to a different curriculum.")
        attrs["curriculum_type"] = curriculum
        term = attrs.get("effective_from_term", inst.effective_from_term if inst else None)
        try:
            if "bands" in attrs:
                validate_bands(attrs["bands"])
            if term and term.end_date < timezone.localdate():
                raise ValueError(f"{term} has already finished - choose the current or an upcoming term.")
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        bands = validated_data.pop("bands")
        validated_data["version"] = next_version(
            validated_data["curriculum_type"], validated_data.get("grade_level"), validated_data.get("subject")
        )
        scheme = models.GradingScheme.objects.create(
            created_by=self.context["request"].user, **validated_data
        )
        models.GradingBand.objects.bulk_create([models.GradingBand(scheme=scheme, **b) for b in bands])
        return scheme

    @transaction.atomic
    def update(self, instance, validated_data):
        if instance.status != models.GradingScheme.Status.DRAFT:
            raise serializers.ValidationError(
                "A published scale can't be edited. Use 'New version' to change it from a later term."
            )
        bands = validated_data.pop("bands", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if bands is not None:
            instance.bands.all().delete()
            models.GradingBand.objects.bulk_create([models.GradingBand(scheme=instance, **b) for b in bands])
        return instance


class PromotionSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.PromotionSettings
        fields = ["auto_promote_enabled", "mode", "days_after_year_end", "auto_activate_next_year",
                  "last_run_at", "last_run_summary"]
        read_only_fields = ["last_run_at", "last_run_summary"]


# ---------------------------------------------------------------------------
# views
# ---------------------------------------------------------------------------
class GradingSchemeViewSet(viewsets.ModelViewSet):
    queryset = models.GradingScheme.objects.select_related(
        "grade_level", "subject", "effective_from_term__academic_year", "created_by"
    ).prefetch_related("bands")
    serializer_class = GradingSchemeSerializer
    permission_classes = [CanManageGrading]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["grade_level", "subject", "status", "curriculum_type"]
    pagination_class = None

    def destroy(self, request, *args, **kwargs):
        scheme = self.get_object()
        if scheme.status != models.GradingScheme.Status.DRAFT:
            return Response({"detail": "Published scales are kept for the record and can't be deleted."}, status=400)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        scheme = self.get_object()
        if scheme.status != models.GradingScheme.Status.DRAFT:
            return Response({"detail": "Already published."}, status=400)
        try:
            validate_bands(list(scheme.bands.values("min_percentage", "max_percentage", "grade_letter", "points")))
            assert_term_is_safe(scheme.effective_from_term, scheme.grade_level)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        scheme.status = models.GradingScheme.Status.PUBLISHED
        scheme.published_at = timezone.now()
        scheme.save(update_fields=["status", "published_at"])
        services.clear_grading_cache()
        return Response(self.get_serializer(scheme).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def clone(self, request, pk=None):
        """New draft VERSION of this scale. Defaults to starting from the next upcoming term."""
        src = self.get_object()
        today = timezone.localdate()
        term = (
            models.Term.objects.filter(start_date__gt=today).order_by("start_date").first()
            or models.Term.objects.filter(end_date__gte=today).order_by("start_date").first()
        )
        if not term:
            return Response({"detail": "No current or upcoming term is set up in the Academic Calendar."}, status=400)
        new = models.GradingScheme.objects.create(
            name=src.name, curriculum_type=src.curriculum_type, grade_level=src.grade_level,
            subject=src.subject, effective_from_term=term, notes=src.notes, created_by=request.user,
            version=next_version(src.curriculum_type, src.grade_level, src.subject),
        )
        models.GradingBand.objects.bulk_create([
            models.GradingBand(scheme=new, min_percentage=b.min_percentage, max_percentage=b.max_percentage,
                               grade_letter=b.grade_letter, points=b.points, remark=b.remark)
            for b in src.bands.all()
        ])
        return Response(self.get_serializer(new).data, status=201)

    @action(detail=False, methods=["get"])
    def resolve(self, request):
        """
        GET /grading-schemes/resolve/?grade_level=&subject=&term=&percentage=
        "Which scale would grade this, and what grade would 67% get?" - lets the
        Exam Officer check the result of their setup before any exam is marked.
        """
        p = request.query_params
        grade_level = models.GradeLevel.objects.filter(pk=p.get("grade_level")).first()
        subject = models.Subject.objects.filter(pk=p.get("subject")).first()
        term = models.Term.objects.filter(pk=p.get("term")).first() or models.Term.objects.filter(is_current=True).first()
        curriculum = grade_level.curriculum_type if grade_level else p.get("curriculum_type")
        if not (curriculum and term):
            return Response({"detail": "Give a grade_level (or curriculum_type) and a term."}, status=400)
        try:
            pct = Decimal(p.get("percentage", "0"))
        except InvalidOperation:
            return Response({"detail": "percentage must be a number."}, status=400)
        found = services.find_grading_scheme(curriculum, grade_level, subject, term)
        grade = services.grade_for_percentage(curriculum, pct, subject, grade_level, term)
        return Response({
            "source": "custom" if found else "legacy/default",
            "scheme": {"id": found[0].id, "name": found[0].name, "version": found[0].version} if found else None,
            "grade_letter": grade.grade_letter, "points": float(grade.points), "remark": grade.remark,
        })


class PromotionSettingsView(APIView):
    permission_classes = [CanManageGrading]

    def get(self, request):
        return Response(PromotionSettingsSerializer(models.PromotionSettings.load()).data)

    def patch(self, request):
        cfg = models.PromotionSettings.load()
        s = PromotionSettingsSerializer(cfg, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save(updated_by=request.user)
        return Response(s.data)


class PromotionRunView(APIView):
    """POST {dry_run: true|false}. Defaults to a dry run so nobody promotes a school by accident."""
    permission_classes = [CanManageGrading]

    def post(self, request):
        dry_run = request.data.get("dry_run", True) not in (False, "false", "False", 0, "0")
        return Response(services.run_auto_promotion(dry_run=dry_run, scheduled=False, triggered_by=request.user))