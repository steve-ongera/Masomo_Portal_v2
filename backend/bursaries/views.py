from django.db.models import ProtectedError
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api import models as core

from . import models, permissions as perms, serializers, services

try:  # plan gate: create a Feature with code "bursaries" and ui_prefixes ["/bursaries"]
    from entitlements.enforcement import check_feature
except ImportError:  # pragma: no cover
    check_feature = None


class FeatureGated:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if check_feature:
            check_feature("bursaries")


class Page(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 500


def _bad(exc, status=400):
    return Response({"detail": str(exc)}, status=status)


class FundingSourceViewSet(FeatureGated, viewsets.ModelViewSet):
    queryset = models.FundingSource.objects.all()
    serializer_class = serializers.FundingSourceSerializer
    pagination_class = None
    filterset_fields = ["source_type", "is_active"]
    filter_backends = [DjangoFilterBackend]

    def get_permissions(self):
        return [(perms.CanView if self.action in ("list", "retrieve") else perms.CanSetup)()]

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return _bad("This funder already has schemes or money recorded. Switch it off instead of deleting it.")


class AidSchemeViewSet(FeatureGated, viewsets.ModelViewSet):
    queryset = models.AidScheme.objects.select_related("source").prefetch_related("grade_levels")
    serializer_class = serializers.AidSchemeSerializer
    pagination_class = None
    filterset_fields = ["kind", "rule", "is_active", "source"]
    filter_backends = [DjangoFilterBackend]

    def get_permissions(self):
        if self.action in ("list", "retrieve", "evaluate"):
            return [perms.CanView()]
        return [perms.CanSetup()]

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return _bad("Students already have awards under this scheme. Switch it off instead of deleting it.")

    @action(detail=True, methods=["get", "post"])
    def evaluate(self, request, pk=None):
        """
        GET  -> students who look eligible under this scheme's automatic rule.
        POST { start_term, student_ids: [...] } -> create awards for the ones chosen.
        """
        scheme = self.get_object()
        try:
            if request.method == "GET":
                return Response(services.find_candidates(scheme))
            term = core.Term.objects.filter(pk=request.data.get("start_term")).first()
            if not term:
                return _bad("Choose the term the discount starts from.")
            ids = request.data.get("student_ids") or []
            if not ids:
                return _bad("Select at least one student.")
            created, errors = services.create_from_candidates(scheme, term, ids, request.user)
        except ValueError as exc:
            return _bad(exc)
        return Response({"created": len(created), "errors": errors}, status=201)


class AwardViewSet(FeatureGated, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                   mixins.CreateModelMixin, viewsets.GenericViewSet):
    queryset = (
        models.Award.objects.select_related(
            "student__user", "scheme__source", "start_term__academic_year", "end_term__academic_year",
            "requested_by", "decided_by", "staff_parent",
        ).prefetch_related("terms").order_by("-requested_at")
    )
    serializer_class = serializers.AwardSerializer
    pagination_class = Page
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["status", "scheme", "scheme__kind", "scheme__source", "student"]
    search_fields = ["student__admission_no", "student__user__first_name", "student__user__last_name", "reference_no"]

    DECIDE_ACTIONS = ("approve", "reject", "suspend", "resume", "reverse_term", "reapply")

    def get_permissions(self):
        return [(perms.CanDecide if self.action in self.DECIDE_ACTIONS else perms.CanView)()]

    def create(self, request, *args, **kwargs):
        s = serializers.AwardCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            award = services.create_award(user=request.user, **s.validated_data)
        except ValueError as exc:
            return _bad(exc)
        return Response(serializers.AwardSerializer(award).data, status=201)

    def _run(self, fn):
        award = self.get_object()
        try:
            fn(award)
        except ValueError as exc:
            return _bad(exc)
        award = self.get_queryset().get(pk=award.pk)
        return Response(serializers.AwardSerializer(award).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._run(lambda a: services.approve_award(a, request.user))

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._run(lambda a: services.reject_award(a, request.user, request.data.get("reason", "")))

    @action(detail=True, methods=["post"])
    def suspend(self, request, pk=None):
        return self._run(lambda a: services.set_suspended(a, request.user, True))

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        return self._run(lambda a: services.set_suspended(a, request.user, False))

    @action(detail=True, methods=["post"])
    def reapply(self, request, pk=None):
        return self._run(lambda a: services.reapply(a, request.user))

    @action(detail=True, methods=["get"])
    def terms(self, request, pk=None):
        award = self.get_object()
        return Response({
            "terms": serializers.AwardTermSerializer(award.terms.select_related("term__academic_year"), many=True).data,
            "history": [
                {"action": a.action, "detail": a.detail, "at": a.created_at,
                 "by": a.performed_by.get_full_name() if a.performed_by else "System"}
                for a in award.audit.select_related("performed_by")[:30]
            ],
        })

    @action(detail=True, methods=["post"])
    def reverse_term(self, request, pk=None):
        award = self.get_object()
        entry = award.terms.filter(pk=request.data.get("award_term")).first()
        if not entry:
            return _bad("That entry was not found on this award.", 404)
        try:
            services.reverse_award_term(entry, request.user, request.data.get("reason", ""))
        except ValueError as exc:
            return _bad(exc)
        return Response({"detail": "Reversed."})


class RemittanceViewSet(FeatureGated, mixins.ListModelMixin, mixins.RetrieveModelMixin,
                        mixins.CreateModelMixin, viewsets.GenericViewSet):
    queryset = models.FundingRemittance.objects.select_related("source", "recorded_by")
    serializer_class = serializers.RemittanceSerializer
    pagination_class = Page
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["source", "method"]
    search_fields = ["reference", "source__name"]

    def get_permissions(self):
        return [perms.CanHandleMoney()]

    def perform_create(self, serializer):
        serializer.save(recorded_by=self.request.user)

    @action(detail=True, methods=["get"])
    def candidates(self, request, pk=None):
        """Funder-paid entries from this funder that are still waiting for money."""
        remittance = self.get_object()
        entries = services.open_entries_for_source(remittance.source)
        return Response(serializers.AwardTermSerializer(entries, many=True).data)

    @action(detail=True, methods=["get"])
    def allocations(self, request, pk=None):
        remittance = self.get_object()
        rows = remittance.allocations.select_related("award_term__award__student__user", "award_term__term")
        return Response(serializers.RemittanceAllocationSerializer(rows, many=True).data)

    @action(detail=True, methods=["post"])
    def allocate(self, request, pk=None):
        remittance = self.get_object()
        s = serializers.AllocateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            created = services.allocate_remittance(
                remittance, [dict(r) for r in s.validated_data["rows"]], request.user
            )
        except ValueError as exc:
            return _bad(exc)
        return Response({"allocated": len(created), "receipts": [c.receipt_no for c in created]}, status=201)

    @action(detail=True, methods=["post"])
    def reverse_allocation(self, request, pk=None):
        remittance = self.get_object()
        alloc = remittance.allocations.filter(pk=request.data.get("allocation")).first()
        if not alloc:
            return _bad("That allocation was not found on this remittance.", 404)
        try:
            services.reverse_allocation(alloc, request.user, request.data.get("reason", ""))
        except ValueError as exc:
            return _bad(exc)
        return Response({"detail": "Reversed. The receipt was voided and the student's balance restored."})


class DashboardView(FeatureGated, APIView):
    permission_classes = [perms.CanView]

    def get(self, request):
        year_id = request.query_params.get("academic_year")
        year = core.AcademicYear.objects.filter(pk=year_id).first() if year_id else None
        return Response(services.dashboard(year))


class MyAidView(APIView):
    """Student / parent: the aid awarded to the learner and what it did each term."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from api.views import _portal_student

        student = _portal_student(request)
        if not student:
            return Response({"detail": "No student profile found for this account."}, status=404)
        awards = models.Award.objects.filter(student=student, status__in=[
            models.Award.Status.APPROVED, models.Award.Status.SUSPENDED, models.Award.Status.ENDED,
        ]).select_related("scheme__source", "start_term", "end_term").prefetch_related("terms__term")
        return Response([
            {
                "scheme": a.scheme.name, "kind": a.scheme.get_kind_display(),
                "funder": a.scheme.source.name if a.scheme.source else "School",
                "status": a.get_status_display(), "starts": str(a.start_term),
                "ends": str(a.end_term) if a.end_term else "Until further notice",
                "terms": [
                    {"term": str(t.term), "amount": float(t.amount), "status": t.get_status_display()}
                    for t in a.terms.all() if t.status == models.AwardTerm.Status.ACTIVE
                ],
            }
            for a in awards
        ])