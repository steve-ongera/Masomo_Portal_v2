"""
lesson_planning/views.py - thin views; rules live in services.py.

Scoping: a TEACHER only ever sees and edits their own documents.
ADMIN / PRINCIPAL can see everything and review submissions.
"""
from django.db import transaction
from django.db.models import Count, Max
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from api import models as api_models

from . import models, serializers, services
from .permissions import (
    REVIEWER_ROLES, TEACHER, IsReviewer, IsTeacher, IsTeacherOrReviewer, TopicPermission,
)


class TeacherScopedMixin:
    """Teachers -> own rows. Reviewers -> all rows. Everyone else -> nothing."""

    teacher_field = "teacher"

    def scope(self, qs):
        role = self.request.user.role
        if role == TEACHER:
            return qs.filter(**{self.teacher_field: self.request.user})
        if role in REVIEWER_ROLES:
            return qs
        return qs.none()


class WorkflowMixin:
    """submit / withdraw (teacher) and review (admin, principal) for schemes and lesson plans."""

    def _run(self, fn, *args):
        obj = self.get_object()
        try:
            fn(obj, *args)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        obj.refresh_from_db()
        return Response(self.get_serializer(obj).data)

    def before_submit(self, obj):
        """Hook: raise ValueError to block submission."""

    @action(detail=True, methods=["post"], permission_classes=[IsTeacher])
    def submit(self, request, pk=None):
        def go(obj):
            self.before_submit(obj)
            services.submit_for_approval(obj)
        return self._run(go)

    @action(detail=True, methods=["post"], permission_classes=[IsTeacher])
    def withdraw(self, request, pk=None):
        return self._run(services.withdraw)

    @action(detail=True, methods=["post"], permission_classes=[IsReviewer])
    def review(self, request, pk=None):
        body = serializers.ReviewSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return self._run(
            services.review, request.user, body.validated_data["decision"], body.validated_data.get("remarks", "")
        )


class LockedWhenSubmittedMixin:
    """Teachers can't edit/delete a document while it's submitted or approved."""

    def _assert_editable(self, obj):
        if self.request.user.role == TEACHER and obj.status not in models.EDITABLE_STATUSES:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"detail": "This document is locked. Withdraw it first to make changes."})

    def perform_update(self, serializer):
        self._assert_editable(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_editable(instance)
        instance.delete()


# ---------------------------------------------------------------------------
# CURRICULUM
# ---------------------------------------------------------------------------
class CurriculumTopicViewSet(viewsets.ModelViewSet):
    queryset = models.CurriculumTopic.objects.select_related("subject", "grade_level", "parent").all()
    serializer_class = serializers.CurriculumTopicSerializer
    permission_classes = [TopicPermission]
    pagination_class = None
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["subject", "grade_level", "parent"]
    search_fields = ["name"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


# ---------------------------------------------------------------------------
# SCHEMES OF WORK
# ---------------------------------------------------------------------------
class SchemeOfWorkViewSet(TeacherScopedMixin, WorkflowMixin, LockedWhenSubmittedMixin, viewsets.ModelViewSet):
    serializer_class = serializers.SchemeSerializer
    permission_classes = [IsTeacherOrReviewer]
    pagination_class = None
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["term", "status", "teacher", "allocation", "term__academic_year"]

    def get_queryset(self):
        qs = models.SchemeOfWork.objects.select_related(
            "teacher", "reviewed_by", "term__academic_year",
            "allocation__subject", "allocation__classroom__grade_level", "allocation__classroom__stream",
        )
        return self.scope(qs)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["with_entries"] = self.action in ("retrieve", "save_entries")
        return ctx

    def before_submit(self, obj):
        if not obj.entries.exists():
            raise ValueError("Add at least one week to the scheme before submitting.")

    @action(detail=True, methods=["post"], url_path="save_entries", permission_classes=[IsTeacher])
    def save_entries(self, request, pk=None):
        """
        POST /schemes/{id}/save_entries/   body: { entries: [ {id?, week_number, ...}, ... ] }

        Replaces the scheme's rows with exactly what's sent: rows with an id
        are updated, rows without are created, saved rows left out are deleted.
        All-or-nothing.
        """
        scheme = self.get_object()
        self._assert_editable(scheme)

        payload = serializers.SchemeEntryInputSerializer(data=request.data.get("entries", []), many=True)
        payload.is_valid(raise_exception=True)
        rows = payload.validated_data

        keys = [(r["week_number"], r.get("lesson_number", 1)) for r in rows]
        if len(keys) != len(set(keys)):
            return Response({"detail": "Each week/lesson number can only appear once."}, status=400)

        existing = {e.id: e for e in scheme.entries.all()}
        with transaction.atomic():
            keep_ids = {r["id"] for r in rows if r.get("id")}
            if keep_ids - existing.keys():
                return Response({"detail": "One of the rows no longer exists. Reload and try again."}, status=400)

            # Delete first, and park surviving rows on temporary lesson numbers, so
            # swapping two rows' week numbers can't trip unique_together mid-save.
            scheme.entries.exclude(id__in=keep_ids).delete()
            for i, e in enumerate(scheme.entries.all()):
                e.lesson_number = 1000 + i
                e.save(update_fields=["lesson_number"])

            for r in rows:
                data = {k: v for k, v in r.items() if k != "id"}
                if r.get("id"):
                    models.SchemeEntry.objects.filter(pk=r["id"], scheme=scheme).update(**data)
                else:
                    models.SchemeEntry.objects.create(scheme=scheme, **data)

        return Response(self.get_serializer(scheme).data)


class SchemeEntryViewSet(TeacherScopedMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only. Used to prefill a lesson plan from a scheme row."""

    serializer_class = serializers.SchemeEntrySerializer
    permission_classes = [IsTeacherOrReviewer]
    pagination_class = None
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["scheme", "week_number"]
    teacher_field = "scheme__teacher"

    def get_queryset(self):
        qs = models.SchemeEntry.objects.select_related(
            "topic", "scheme__allocation__subject", "scheme__allocation__classroom__grade_level",
            "scheme__allocation__classroom__stream",
        ).annotate(
            lesson_plan_count=Count("lesson_plans", distinct=True),
            coverage_percent=Max("lesson_plans__coverage__coverage_percentage"),
        )
        return self.scope(qs)


# ---------------------------------------------------------------------------
# LESSON PLANS
# ---------------------------------------------------------------------------
class LessonPlanViewSet(TeacherScopedMixin, WorkflowMixin, LockedWhenSubmittedMixin, viewsets.ModelViewSet):
    serializer_class = serializers.LessonPlanSerializer
    permission_classes = [IsTeacherOrReviewer]
    pagination_class = None
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["status", "term", "allocation", "teacher", "week_number", "scheme_entry", "date"]

    def get_queryset(self):
        qs = models.LessonPlan.objects.select_related(
            "teacher", "reviewed_by", "term", "coverage",
            "allocation__subject", "allocation__classroom__grade_level", "allocation__classroom__stream",
        )
        return self.scope(qs)

    def get_permissions(self):
        # Only teachers write plans; reviewers read and review.
        if self.action in ("create", "update", "partial_update", "destroy", "coverage"):
            return [IsTeacher()]
        return super().get_permissions()

    @action(detail=False, methods=["get"], permission_classes=[IsTeacher])
    def today(self, request):
        """GET /lesson-plans/today/ - today's timetable with the plan (if any) for each lesson."""
        return Response(services.todays_lessons(request.user))

    @action(detail=True, methods=["post"], url_path="coverage")
    def coverage(self, request, pk=None):
        """
        POST /lesson-plans/{id}/coverage/  - record (or update) what was actually covered.
        Allowed at any approval status: delivery is what happened, whatever the paperwork says.
        """
        plan = self.get_object()
        existing = getattr(plan, "coverage", None)
        serializer = serializers.LessonCoverageSerializer(existing, data=request.data, partial=bool(existing))
        serializer.is_valid(raise_exception=True)
        serializer.save(lesson_plan=plan)
        plan.refresh_from_db()
        return Response(self.get_serializer(plan).data)


# ---------------------------------------------------------------------------
# COVERAGE OVERVIEW
# ---------------------------------------------------------------------------
class CoverageOverviewView(APIView):
    """
    GET /coverage/?term=<id>&teacher=<id>

    One row per teaching allocation for the term (default: the current
    term): scheme status, scheme rows, % delivered, plans written and
    plans awaiting review. Teachers get their own rows; ADMIN/PRINCIPAL get
    everyone's (optionally filtered with ?teacher=).
    """

    permission_classes = [IsTeacherOrReviewer]

    def get(self, request):
        term_id = request.query_params.get("term")
        term = (
            get_object_or_404(api_models.Term, pk=term_id) if term_id
            else api_models.Term.objects.filter(is_current=True).first()
        )
        if not term:
            return Response({"term": None, "rows": []})

        allocations = api_models.TeacherSubjectAllocation.objects.filter(
            academic_year=term.academic_year
        ).select_related("teacher", "subject", "classroom__grade_level", "classroom__stream")

        if request.user.role == TEACHER:
            allocations = allocations.filter(teacher=request.user)
        elif request.query_params.get("teacher"):
            allocations = allocations.filter(teacher_id=request.query_params["teacher"])

        return Response({
            "term": {"id": term.id, "label": str(term)},
            "rows": services.coverage_rows(allocations, term),
        })