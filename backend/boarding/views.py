"""
Boarding API. Views stay thin: parse the request, check scope, call services.

Everything a HOSTEL_WARDEN touches is limited to the dormitories assigned to
them (see permissions.warden_dormitory_ids).
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Exists, OuterRef, Prefetch, Q
from django.db.models.deletion import ProtectedError
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from api import models as api_models

from . import permissions as perm
from . import serializers as ser
from . import services
from .models import (
    Bed, BedAllocation, BoardingFeeBilling, BoardingFeeRate, BoardingRegistration, Dormitory,
    ExeatRequest, Room, RollCallEntry, RollCallSession, WardenAssignment,
)

User = get_user_model()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
class BoardingPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 500


def _bad(msg, code=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": msg}, status=code)


def _truthy(v):
    return str(v).lower() in ("1", "true", "yes")


def _int(v, name):
    try:
        return int(v)
    except (TypeError, ValueError):
        raise services.BoardingError(f"'{name}' must be a number.")


def _scope_ids(request):
    return perm.warden_dormitory_ids(request.user)


def _assert_dorm_access(request, dorm):
    ids = _scope_ids(request)
    if ids is not None and dorm.pk not in ids:
        raise PermissionDenied("You are not assigned to this hostel.")


def _get_or_404(model, pk, what):
    try:
        return model.objects.get(pk=pk)
    except (model.DoesNotExist, ValueError, TypeError):
        raise NotFound(f"{what} not found.")


def _year_from(request, key="academic_year"):
    """?academic_year=<id> | 'all' | (missing -> current). Returns a year, or None for 'all'."""
    raw = request.query_params.get(key)
    if raw == "all":
        return None
    return services.require_year(raw)


class MappedPermissionsMixin:
    """permission_map: {action_name: PermissionClass | [PermissionClass, ...]}"""

    permission_map = {}
    default_permission = perm.IsBoardingViewer

    def get_permissions(self):
        chosen = self.permission_map.get(getattr(self, "action", None), self.default_permission)
        chosen = chosen if isinstance(chosen, (list, tuple)) else [chosen]
        return [p() for p in chosen]


# ---------------------------------------------------------------------------
# access / settings / dashboard
# ---------------------------------------------------------------------------
class AccessView(APIView):
    """Tells the frontend what the signed-in user may do (so pages never offer a button the API refuses)."""

    permission_classes = [perm.IsBoardingViewer]

    def get(self, request):
        role = request.user.role
        ids = _scope_ids(request)
        dorms = Dormitory.objects.all()
        if ids is not None:
            dorms = dorms.filter(pk__in=ids)
        return Response({
            "role": role,
            "can_manage_structure": role in perm.ADMIN_ROLES,
            "can_operate": role in perm.OPERATE_ROLES,
            "can_approve_exeat": role in perm.APPROVE_ROLES,
            "can_bill": role in perm.FINANCE_ROLES,
            "is_warden": role == perm.WARDEN,
            "has_dormitories": dorms.exists(),
            "dormitories": [{"id": d.pk, "name": d.name, "gender": d.gender} for d in dorms],
        })


class SettingsView(APIView):
    def get_permissions(self):
        return [(perm.IsBoardingAdmin if self.request.method in ("PATCH", "PUT") else perm.IsBoardingViewer)()]

    def get(self, request):
        return Response(ser.BoardingSettingsSerializer(services.get_settings()).data)

    def patch(self, request):
        s = ser.BoardingSettingsSerializer(services.get_settings(), data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    put = patch


class DashboardView(APIView):
    permission_classes = [perm.IsBoardingViewer]

    def get(self, request):
        return Response(services.dashboard(_scope_ids(request)))


class WardenUsersView(APIView):
    """Staff accounts that can be assigned to hostels (Admin only)."""

    permission_classes = [perm.IsBoardingAdmin]

    def get(self, request):
        users = User.objects.filter(role=perm.WARDEN, is_active=True).order_by("first_name", "last_name")
        return Response([{"id": str(u.pk), "name": u.get_full_name() or u.username, "username": u.username} for u in users])


# ---------------------------------------------------------------------------
# structure: dormitories, rooms, beds
# ---------------------------------------------------------------------------
class DormitoryViewSet(MappedPermissionsMixin, viewsets.ModelViewSet):
    serializer_class = ser.DormitorySerializer
    pagination_class = None
    permission_map = {
        "create": perm.IsBoardingAdmin, "update": perm.IsBoardingAdmin,
        "partial_update": perm.IsBoardingAdmin, "destroy": perm.IsBoardingAdmin,
        "set_wardens": perm.IsBoardingAdmin, "generate_rooms": perm.IsBoardingOperator,
    }

    def get_queryset(self):
        qs = Dormitory.objects.prefetch_related("warden_assignments__user")
        ids = _scope_ids(self.request)
        if ids is not None:
            qs = qs.filter(pk__in=ids)
        p = self.request.query_params
        if p.get("gender") in ("M", "F"):
            qs = qs.filter(gender=p["gender"])
        if _truthy(p.get("active", "")):
            qs = qs.filter(is_active=True)
        return qs

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return _bad("Students have slept in this hostel, so it cannot be deleted. Deactivate it instead.")

    @action(detail=True, methods=["get"])
    def occupancy(self, request, pk=None):
        """Every bed with everyone who slept in it in ?academic_year (default current)."""
        dorm = self.get_object()
        year = _year_from(request)
        if year is None:
            raise services.BoardingError("Pick one academic year.")
        return Response({
            "dormitory": {"id": dorm.pk, "name": dorm.name, "gender": dorm.gender},
            "academic_year": {"id": year.pk, "year": year.year},
            "rooms": services.dormitory_occupancy(dorm, year),
        })

    @action(detail=True, methods=["post"])
    def generate_rooms(self, request, pk=None):
        """{"room_numbers": ["101","102"]} or {"prefix":"", "start":101, "end":110}, plus "beds_per_room"."""
        dorm = self.get_object()
        d = request.data
        numbers = d.get("room_numbers")
        if not numbers:
            start, end = _int(d.get("start"), "start"), _int(d.get("end"), "end")
            if end < start or end - start > 500:
                raise services.BoardingError("Room range is invalid.")
            prefix = str(d.get("prefix") or "")
            numbers = [f"{prefix}{n}" for n in range(start, end + 1)]
        result = services.generate_rooms(
            dorm, numbers, _int(d.get("beds_per_room"), "beds_per_room"), floor=str(d.get("floor") or "")
        )
        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def set_wardens(self, request, pk=None):
        """Replace the wardens of this hostel: {"user_ids": [...]}."""
        dorm = self.get_object()
        ids = request.data.get("user_ids") or []
        users = list(User.objects.filter(pk__in=ids, role=perm.WARDEN, is_active=True))
        if len(users) != len(set(map(str, ids))):
            raise services.BoardingError("Some selected users are not active hostel wardens.")
        with transaction.atomic():
            WardenAssignment.objects.filter(dormitory=dorm).exclude(user__in=users).delete()
            for u in users:
                WardenAssignment.objects.get_or_create(user=u, dormitory=dorm)
        return Response(ser.DormitorySerializer(self.get_object(), context=self.get_serializer_context()).data)


class RoomViewSet(MappedPermissionsMixin, viewsets.ModelViewSet):
    serializer_class = ser.RoomSerializer
    pagination_class = BoardingPagination
    permission_map = {
        "create": perm.IsBoardingOperator, "update": perm.IsBoardingOperator,
        "partial_update": perm.IsBoardingOperator, "destroy": perm.IsBoardingOperator,
        "add_beds": perm.IsBoardingOperator,
    }

    def get_queryset(self):
        qs = Room.objects.select_related("dormitory")
        ids = _scope_ids(self.request)
        if ids is not None:
            qs = qs.filter(dormitory_id__in=ids)
        if self.request.query_params.get("dormitory"):
            qs = qs.filter(dormitory_id=self.request.query_params["dormitory"])
        return qs.order_by("dormitory__name", "number")

    def perform_create(self, serializer):
        _assert_dorm_access(self.request, serializer.validated_data["dormitory"])
        serializer.save()

    def perform_update(self, serializer):
        new_dorm = serializer.validated_data.get("dormitory")
        if new_dorm:
            _assert_dorm_access(self.request, new_dorm)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return _bad("Students have slept in this room, so it cannot be deleted. Mark it inactive instead.")

    @action(detail=True, methods=["post"])
    def add_beds(self, request, pk=None):
        room = self.get_object()
        nums = services.add_beds(room, _int(request.data.get("count"), "count"))
        return Response({"added": nums}, status=status.HTTP_201_CREATED)


class BedViewSet(MappedPermissionsMixin, viewsets.ModelViewSet):
    serializer_class = ser.BedSerializer
    pagination_class = BoardingPagination
    permission_map = {
        "create": perm.IsBoardingOperator, "update": perm.IsBoardingOperator,
        "partial_update": perm.IsBoardingOperator, "destroy": perm.IsBoardingOperator,
    }

    def get_queryset(self):
        qs = Bed.objects.select_related("room__dormitory").prefetch_related(
            Prefetch(
                "allocations",
                queryset=BedAllocation.objects.filter(released_at__isnull=True)
                .select_related("registration__student__user"),
                to_attr="current_allocs",
            )
        )
        ids = _scope_ids(self.request)
        if ids is not None:
            qs = qs.filter(room__dormitory_id__in=ids)
        p = self.request.query_params
        if p.get("dormitory"):
            qs = qs.filter(room__dormitory_id=p["dormitory"])
        if p.get("room"):
            qs = qs.filter(room_id=p["room"])
        if p.get("is_active") in ("0", "1", "true", "false"):
            qs = qs.filter(is_active=_truthy(p["is_active"]))
        if p.get("status") in ("vacant", "occupied"):
            held = BedAllocation.objects.filter(bed=OuterRef("pk"), released_at__isnull=True)
            qs = qs.annotate(held=Exists(held)).filter(held=(p["status"] == "occupied"))
            if p["status"] == "vacant":
                qs = qs.filter(is_active=True, room__is_active=True, room__dormitory__is_active=True)
        if p.get("gender") in ("M", "F"):
            qs = qs.filter(room__dormitory__gender=p["gender"])
        return qs.order_by("room__dormitory__name", "room__number", "number")

    def perform_create(self, serializer):
        _assert_dorm_access(self.request, serializer.validated_data["room"].dormitory)
        serializer.save()

    def perform_update(self, serializer):
        bed = serializer.instance
        if serializer.validated_data.get("is_active") is False and bed.allocations.filter(released_at__isnull=True).exists():
            raise services.BoardingError("Move the student out of this bed before taking it out of service.")
        if "room" in serializer.validated_data and serializer.validated_data["room"].pk != bed.room_id:
            raise services.BoardingError("A bed cannot be moved to another room. Create a new bed instead.")
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return _bad("Someone has slept in this bed, so it cannot be deleted. Mark it out of service instead.")

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        """Everyone who ever slept in this bed, newest first. Optional ?academic_year=<id>."""
        bed = self.get_object()
        qs = BedAllocation.objects.filter(bed=bed).select_related(
            "registration__student__user", "registration__academic_year", "allocated_by", "released_by"
        )
        if request.query_params.get("academic_year"):
            qs = qs.filter(registration__academic_year_id=request.query_params["academic_year"])
        return Response({
            "bed": {"id": bed.pk, "label": bed.label},
            "history": ser.AllocationSerializer(qs, many=True).data,
        })


# ---------------------------------------------------------------------------
# registrations (who boards this year)
# ---------------------------------------------------------------------------
class RegistrationViewSet(MappedPermissionsMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ser.RegistrationSerializer
    pagination_class = BoardingPagination
    permission_map = {
        "create": perm.IsBoardingOperator, "register_classroom": perm.IsBoardingOperator,
        "withdraw": perm.IsBoardingOperator,
    }

    def get_queryset(self):
        qs = BoardingRegistration.objects.select_related("student__user", "academic_year").prefetch_related(
            Prefetch(
                "allocations", queryset=BedAllocation.objects.filter(released_at__isnull=True),
                to_attr="current_allocs",
            )
        )
        genders = perm.warden_genders(self.request.user)
        if genders is not None:
            qs = qs.filter(student__gender__in=genders)
        p = self.request.query_params
        ay = p.get("academic_year")
        if self.action == "list" and ay != "all":
            qs = qs.filter(academic_year=services.require_year(ay))  # default: current year
        elif self.action == "history" and ay and ay != "all":
            qs = qs.filter(academic_year_id=ay)
        if p.get("status") in BoardingRegistration.Status.values:
            qs = qs.filter(status=p["status"])
        if p.get("grade_level"):
            qs = qs.filter(enrollment__classroom__grade_level_id=p["grade_level"])
        if p.get("classroom"):
            qs = qs.filter(enrollment__classroom_id=p["classroom"])
        if p.get("gender") in ("M", "F"):
            qs = qs.filter(student__gender=p["gender"])
        if p.get("allocated") in ("0", "1", "true", "false"):
            held = BedAllocation.objects.filter(registration=OuterRef("pk"), released_at__isnull=True)
            qs = qs.annotate(held=Exists(held)).filter(held=_truthy(p["allocated"]))
        if p.get("student"):
            qs = qs.filter(student_id=p["student"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(student__admission_no__icontains=q)
                | Q(student__user__first_name__icontains=q)
                | Q(student__user__last_name__icontains=q)
            )
        return qs.order_by("grade_name", "student__admission_no")

    def create(self, request):
        student = _get_or_404(api_models.StudentProfile, request.data.get("student"), "Student")
        genders = perm.warden_genders(request.user)
        if genders is not None and student.gender not in genders:
            raise PermissionDenied("This student is not in a hostel you look after.")
        year = services.require_year(request.data.get("academic_year"))
        reg, created = services.register_student(student, year, request.user)
        return Response(ser.RegistrationSerializer(reg).data, status=status.HTTP_201_CREATED if created else 200)

    @action(detail=False, methods=["post"])
    def register_classroom(self, request):
        classroom = _get_or_404(api_models.ClassRoom, request.data.get("classroom"), "Class")
        return Response(services.register_classroom(classroom, request.user))

    @action(detail=True, methods=["post"])
    def withdraw(self, request, pk=None):
        reg = services.withdraw_registration(self.get_object(), request.user, request.data.get("reason", ""))
        return Response(ser.RegistrationSerializer(reg).data)

    @action(detail=False, methods=["get"])
    def eligible(self, request):
        """Students enrolled in the year, in a boarding grade, not yet registered. ?q= searches, ?classroom= narrows."""
        year = services.require_year(request.query_params.get("academic_year"))
        cfg = services.get_settings()
        qs = api_models.Enrollment.objects.filter(
            academic_year=year, status=api_models.Enrollment.Status.ACTIVE, student__is_active=True
        ).select_related("student__user", "classroom__grade_level", "classroom__stream")
        registered = BoardingRegistration.objects.filter(
            academic_year=year, status=BoardingRegistration.Status.REGISTERED
        ).values_list("student_id", flat=True)
        qs = qs.exclude(student_id__in=registered)
        grade_ids = list(cfg.boarding_grades.values_list("pk", flat=True))
        if grade_ids:
            qs = qs.filter(classroom__grade_level_id__in=grade_ids)
        genders = perm.warden_genders(request.user)
        if genders is not None:
            qs = qs.filter(student__gender__in=genders)
        p = request.query_params
        if p.get("classroom"):
            qs = qs.filter(classroom_id=p["classroom"])
        if p.get("gender") in ("M", "F"):
            qs = qs.filter(student__gender=p["gender"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(student__admission_no__icontains=q)
                | Q(student__user__first_name__icontains=q)
                | Q(student__user__last_name__icontains=q)
            )
        qs = qs.order_by("student__admission_no")[:100]
        return Response([
            {
                "student": e.student_id, "admission_no": e.student.admission_no,
                "name": services.student_name(e.student), "gender": e.student.gender,
                "grade_name": e.classroom.grade_level.name, "class_name": str(e.classroom),
            }
            for e in qs
        ])

    @action(detail=False, methods=["get"])
    def history(self, request):
        """One student's whole boarding history, year by year: ?student=<id>."""
        if not request.query_params.get("student"):
            raise services.BoardingError("Give ?student=<id>.")
        regs = self.get_queryset().order_by("-academic_year__year")
        out = []
        for reg in regs:
            allocs = (
                BedAllocation.objects.filter(registration=reg)
                .select_related("registration__student__user", "registration__academic_year")
                .order_by("allocated_from", "id")
            )
            out.append({
                "registration": ser.RegistrationSerializer(reg).data,
                "allocations": ser.AllocationSerializer(allocs, many=True).data,
            })
        return Response(out)


# ---------------------------------------------------------------------------
# bed allocations
# ---------------------------------------------------------------------------
class AllocationViewSet(MappedPermissionsMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ser.AllocationSerializer
    pagination_class = BoardingPagination
    permission_map = {
        "allocate": perm.IsBoardingOperator, "transfer": perm.IsBoardingOperator,
        "release": perm.IsBoardingOperator, "auto_allocate": perm.IsBoardingOperator,
        "rollover": perm.IsBoardingAdmin,
    }

    def get_queryset(self):
        qs = BedAllocation.objects.select_related(
            "registration__student__user", "registration__academic_year", "allocated_by", "released_by", "bed__room__dormitory"
        )
        ids = _scope_ids(self.request)
        if ids is not None:
            qs = qs.filter(bed__room__dormitory_id__in=ids)
        p = self.request.query_params
        if p.get("academic_year") and p["academic_year"] != "all":
            qs = qs.filter(registration__academic_year_id=p["academic_year"])
        if p.get("current") in ("0", "1", "true", "false"):
            qs = qs.filter(released_at__isnull=_truthy(p["current"]))
        if p.get("dormitory"):
            qs = qs.filter(bed__room__dormitory_id=p["dormitory"])
        if p.get("room"):
            qs = qs.filter(bed__room_id=p["room"])
        if p.get("bed"):
            qs = qs.filter(bed_id=p["bed"])
        if p.get("student"):
            qs = qs.filter(registration__student_id=p["student"])
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(registration__student__admission_no__icontains=q)
                | Q(registration__student__user__first_name__icontains=q)
                | Q(registration__student__user__last_name__icontains=q)
                | Q(bed_label__icontains=q)
            )
        return qs.order_by("-created_at", "-id")

    # -- helpers --------------------------------------------------------
    def _bed(self, request, pk):
        bed = _get_or_404(Bed, pk, "Bed")
        _assert_dorm_access(request, bed.room.dormitory)
        return bed

    def _registration(self, request, pk):
        reg = _get_or_404(BoardingRegistration, pk, "Boarder")
        genders = perm.warden_genders(request.user)
        if genders is not None and reg.student.gender not in genders:
            raise PermissionDenied("This student is not in a hostel you look after.")
        return reg

    # -- actions --------------------------------------------------------
    @action(detail=False, methods=["post"])
    def allocate(self, request):
        """{"registration": id | "student": id, "bed": id, "notes": ""}. Registers the student first if needed."""
        d = request.data
        bed = self._bed(request, d.get("bed"))
        with transaction.atomic():
            if d.get("registration"):
                reg = self._registration(request, d["registration"])
            else:
                student = _get_or_404(api_models.StudentProfile, d.get("student"), "Student")
                year = services.require_year(d.get("academic_year"))
                reg, _ = services.register_student(student, year, request.user)
                self._registration(request, reg.pk)
            alloc = services.allocate_bed(reg, bed, request.user, d.get("notes", ""))
        return Response(ser.AllocationSerializer(alloc).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def transfer(self, request):
        d = request.data
        reg = self._registration(request, d.get("registration"))
        old = services.current_allocation(reg)
        if old:
            _assert_dorm_access(request, old.bed.room.dormitory)
        alloc = services.transfer_student(reg, self._bed(request, d.get("bed")), request.user, d.get("notes", ""))
        return Response(ser.AllocationSerializer(alloc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def release(self, request, pk=None):
        """Free the bed. {"reason": "OTHER|CORRECTION|...", "notes": ""}"""
        alloc = self.get_object()
        services.release_allocation(
            alloc, request.user, request.data.get("reason") or BedAllocation.ReleaseReason.OTHER,
            request.data.get("notes", ""),
        )
        return Response(ser.AllocationSerializer(alloc).data)

    @action(detail=False, methods=["post"])
    def auto_allocate(self, request):
        """{"dormitory": id, "grade_level": id?} fill vacant beds with unplaced boarders of the right gender."""
        dorm = _get_or_404(Dormitory, request.data.get("dormitory"), "Hostel")
        _assert_dorm_access(request, dorm)
        grade = None
        if request.data.get("grade_level"):
            grade = _get_or_404(api_models.GradeLevel, request.data["grade_level"], "Grade")
        year = services.require_year(request.data.get("academic_year"))
        return Response(services.auto_allocate(dorm, request.user, grade, year))

    @action(detail=False, methods=["post"])
    def rollover(self, request):
        """
        {"from_year": id, "to_year": id, "keep_beds": true, "dry_run": true}
        Closes last year's allocations (history kept), frees beds of leavers, carries returners.
        Run it AFTER promotion has created next year's enrollments. Always preview first.
        """
        d = request.data
        from_year = services.require_year(d.get("from_year"))
        to_year = services.require_year(d.get("to_year"))
        report = services.rollover_year(
            from_year, to_year, request.user,
            keep_beds=d.get("keep_beds", True) not in (False, "false", "0", 0),
            dry_run=d.get("dry_run", True) not in (False, "false", "0", 0),
        )
        return Response(report)


# ---------------------------------------------------------------------------
# exeat / leave-out
# ---------------------------------------------------------------------------
class ExeatViewSet(MappedPermissionsMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = ser.ExeatSerializer
    pagination_class = BoardingPagination
    permission_map = {
        "create": perm.IsBoardingOperator, "approve": perm.IsExeatApprover, "reject": perm.IsExeatApprover,
        "cancel": perm.IsBoardingOperator, "check_out": perm.IsBoardingOperator, "check_in": perm.IsBoardingOperator,
    }

    def get_queryset(self):
        qs = ExeatRequest.objects.select_related(
            "registration__student__user", "requested_by", "decided_by", "checked_out_by", "checked_in_by"
        )
        ids = _scope_ids(self.request)
        if ids is not None:
            in_scope = BedAllocation.objects.filter(
                registration=OuterRef("registration_id"), bed__room__dormitory_id__in=ids
            )
            qs = qs.annotate(in_scope=Exists(in_scope)).filter(Q(in_scope=True) | Q(requested_by=self.request.user))
        p = self.request.query_params
        if p.get("status") in ExeatRequest.Status.values:
            qs = qs.filter(status=p["status"])
        if p.get("exeat_type") in ExeatRequest.Type.values:
            qs = qs.filter(exeat_type=p["exeat_type"])
        if p.get("student"):
            qs = qs.filter(registration__student_id=p["student"])
        if p.get("registration"):
            qs = qs.filter(registration_id=p["registration"])
        if p.get("dormitory"):
            in_dorm = BedAllocation.objects.filter(
                registration=OuterRef("registration_id"), bed__room__dormitory_id=p["dormitory"]
            )
            qs = qs.annotate(in_dorm=Exists(in_dorm)).filter(in_dorm=True)
        if _truthy(p.get("overdue", "")):
            qs = qs.filter(status=ExeatRequest.Status.OUT, expected_return__lt=timezone.now())
        if _truthy(p.get("open", "")):
            qs = qs.filter(status__in=services.OPEN_EXEAT)
        d_from, d_to = parse_date(p.get("from") or ""), parse_date(p.get("to") or "")
        if d_from:
            qs = qs.filter(expected_departure__date__gte=d_from)
        if d_to:
            qs = qs.filter(expected_departure__date__lte=d_to)
        q = (p.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(slip_no__icontains=q)
                | Q(registration__student__admission_no__icontains=q)
                | Q(registration__student__user__first_name__icontains=q)
                | Q(registration__student__user__last_name__icontains=q)
            )
        return qs.order_by("-created_at", "-id")

    def _out(self, exeat):
        return Response(ser.ExeatSerializer(ExeatRequest.objects.get(pk=exeat.pk)).data)

    def create(self, request):
        s = ser.ExeatCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        reg = d.get("registration")
        if reg is None:
            year = services.require_year(request.data.get("academic_year"))
            reg = BoardingRegistration.objects.filter(
                student_id=d["student"], academic_year=year, status=BoardingRegistration.Status.REGISTERED
            ).first()
            if not reg:
                raise services.BoardingError("This student is not registered as a boarder this year.")
        genders = perm.warden_genders(request.user)
        if genders is not None and reg.student.gender not in genders:
            raise PermissionDenied("This student is not in a hostel you look after.")
        approve_now = d["approve_now"] and request.user.role in perm.APPROVE_ROLES
        exeat = services.create_exeat(
            reg, exeat_type=d["exeat_type"], reason=d["reason"], destination=d["destination"],
            contact_name=d["contact_name"], contact_phone=d["contact_phone"],
            expected_departure=d["expected_departure"], expected_return=d["expected_return"],
            by=request.user, approve_now=approve_now,
        )
        return Response(ser.ExeatSerializer(ExeatRequest.objects.get(pk=exeat.pk)).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._out(services.approve_exeat(self.get_object(), request.user, request.data.get("note", "")))

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._out(services.reject_exeat(self.get_object(), request.user, request.data.get("note", "")))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._out(services.cancel_exeat(self.get_object(), request.user, request.data.get("note", "")))

    @action(detail=True, methods=["post"])
    def check_out(self, request, pk=None):
        s = ser.ExeatCheckOutSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return self._out(services.check_out_exeat(self.get_object(), request.user, **s.validated_data))

    @action(detail=True, methods=["post"])
    def check_in(self, request, pk=None):
        return self._out(services.check_in_exeat(self.get_object(), request.user, request.data.get("note", "")))


# ---------------------------------------------------------------------------
# roll call
# ---------------------------------------------------------------------------
class RollCallViewSet(MappedPermissionsMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    pagination_class = BoardingPagination
    permission_map = {
        "create": perm.IsBoardingOperator, "mark": perm.IsBoardingOperator, "submit": perm.IsBoardingOperator,
        "reopen": perm.IsBoardingAdmin,
    }

    def get_serializer_class(self):
        return ser.RollCallDetailSerializer if self.action in ("retrieve", "create") else ser.RollCallSessionSerializer

    def get_queryset(self):
        qs = RollCallSession.objects.select_related("dormitory", "taken_by").prefetch_related(
            "entries__registration__student__user"
        )
        ids = _scope_ids(self.request)
        if ids is not None:
            qs = qs.filter(dormitory_id__in=ids)
        p = self.request.query_params
        if p.get("dormitory"):
            qs = qs.filter(dormitory_id=p["dormitory"])
        if p.get("session_type") in RollCallSession.SessionType.values:
            qs = qs.filter(session_type=p["session_type"])
        if p.get("status") in RollCallSession.Status.values:
            qs = qs.filter(status=p["status"])
        d = parse_date(p.get("date") or "")
        if d:
            qs = qs.filter(date=d)
        return qs.order_by("-date", "-created_at")

    def create(self, request):
        """{"dormitory": id, "session_type": "NIGHT", "date": "YYYY-MM-DD" (default today)}"""
        dorm = _get_or_404(Dormitory, request.data.get("dormitory"), "Hostel")
        _assert_dorm_access(request, dorm)
        date = parse_date(request.data.get("date") or "") or timezone.localdate()
        session, created = services.open_roll_call(dorm, date, request.data.get("session_type"), request.user)
        data = ser.RollCallDetailSerializer(RollCallSession.objects.get(pk=session.pk)).data
        return Response(data, status=status.HTTP_201_CREATED if created else 200)

    def _detail(self, session):
        return Response(ser.RollCallDetailSerializer(RollCallSession.objects.get(pk=session.pk)).data)

    @action(detail=True, methods=["post"])
    def mark(self, request, pk=None):
        """{"marks": [{"entry": id, "status": "ABSENT", "remarks": ""}, ...]}"""
        session = self.get_object()
        marks = request.data.get("marks")
        if not isinstance(marks, list) or not marks:
            raise services.BoardingError("Send a non-empty 'marks' list.")
        services.mark_roll_call(session, marks)
        return self._detail(session)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        return self._detail(services.submit_roll_call(self.get_object(), request.user))

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        return self._detail(services.reopen_roll_call(self.get_object()))

    @action(detail=False, methods=["get"])
    def absentees(self, request):
        """Everyone marked ABSENT on ?date= (default today), across the hostels you can see."""
        date = parse_date(request.query_params.get("date") or "") or timezone.localdate()
        entries = RollCallEntry.objects.filter(
            session__in=self.get_queryset().filter(date=date), status=RollCallEntry.Status.ABSENT
        ).select_related("session__dormitory", "registration__student__user")
        return Response([
            {
                "date": date, "dormitory": e.session.dormitory.name, "session_type": e.session.session_type,
                "admission_no": e.registration.student.admission_no,
                "student_name": services.student_name(e.registration.student),
                "bed_label": e.bed_label, "remarks": e.remarks,
            }
            for e in entries
        ])


# ---------------------------------------------------------------------------
# boarding fees
# ---------------------------------------------------------------------------
class BoardingFeeRateViewSet(viewsets.ModelViewSet):
    serializer_class = ser.BoardingFeeRateSerializer
    permission_classes = [perm.IsBoardingFinance]
    pagination_class = None

    def get_queryset(self):
        qs = BoardingFeeRate.objects.select_related("term__academic_year", "grade_level")
        if self.request.query_params.get("term"):
            qs = qs.filter(term_id=self.request.query_params["term"])
        return qs.order_by("-term__academic_year__year", "-term__term_number", "grade_level__level_order")

    @action(detail=False, methods=["post"])
    def bill(self, request):
        """{"term": id, "dry_run": true, "only_allocated": false}. Preview first, then bill."""
        term = _get_or_404(api_models.Term, request.data.get("term"), "Term")
        return Response(services.bill_boarding_fees(
            term, request.user,
            dry_run=request.data.get("dry_run", True) not in (False, "false", "0", 0),
            only_allocated=request.data.get("only_allocated") in (True, "true", "1", 1),
        ))

    @action(detail=False, methods=["get"])
    def billings(self, request):
        qs = BoardingFeeBilling.objects.select_related(
            "registration__student__user", "term__academic_year", "charge"
        )
        if request.query_params.get("term"):
            qs = qs.filter(term_id=request.query_params["term"])
        q = (request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(registration__student__admission_no__icontains=q)
                | Q(registration__student__user__first_name__icontains=q)
                | Q(registration__student__user__last_name__icontains=q)
            )
        return Response(ser.BoardingFeeBillingSerializer(qs[:500], many=True).data)


# ---------------------------------------------------------------------------
# student / parent
# ---------------------------------------------------------------------------
def _family_students(user):
    """StudentProfiles this user may see: themselves (STUDENT) or their linked children (PARENT)."""
    if user.role == "STUDENT":
        sp = getattr(user, "student_profile", None)
        return [sp] if sp else []
    if user.role == "PARENT":
        pp = getattr(user, "parent_profile", None)
        return list(pp.students.select_related("user")) if pp else []
    return []


class MyBoardingView(APIView):
    """Bed, hostel and exeat slips for the signed-in student, or for each child of a parent."""

    permission_classes = [perm.IsStudentOrParent]

    def get(self, request):
        year = services.current_year()
        out = []
        for st in _family_students(request.user):
            reg = BoardingRegistration.objects.filter(
                student=st, academic_year=year, status=BoardingRegistration.Status.REGISTERED
            ).first() if year else None
            alloc = services.current_allocation(reg) if reg else None
            exeats = (
                ExeatRequest.objects.filter(registration__student=st)
                .select_related("registration__student__user", "requested_by", "decided_by")
                .order_by("-created_at")[:20]
            )
            out.append({
                "student": st.pk, "admission_no": st.admission_no, "name": services.student_name(st),
                "is_boarder": bool(reg), "registration": reg.pk if reg else None,
                "grade_name": reg.grade_name if reg else "",
                "bed": {"label": alloc.bed_label, "since": alloc.allocated_from} if alloc else None,
                "exeats": ser.ExeatSerializer(exeats, many=True).data,
            })
        return Response(out)


class MyExeatRequestView(APIView):
    """
    A PARENT asks for an exeat / leave-out for their child, or a STUDENT asks for themself.
    Either way it lands as PENDING for the warden (or Principal) to decide.
    """

    permission_classes = [perm.IsStudentOrParent]

    def post(self, request):
        role = request.user.role
        if role not in ("PARENT", "STUDENT"):
            raise PermissionDenied("Only a student, parent or guardian can request an exeat.")

        mine = {st.pk: st for st in _family_students(request.user)}
        data = request.data.copy()
        if role == "STUDENT":
            if not mine:
                raise PermissionDenied("Your account has no student profile.")
            own_id = next(iter(mine))
            given = data.get("student")
            if given not in (None, "") and str(given) != str(own_id):
                raise PermissionDenied("You can only request an exeat for yourself.")
            data["student"] = own_id  # the student never has to send it

        s = ser.ExeatCreateSerializer(data=data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if d.get("student") not in mine:
            raise PermissionDenied("That student is not linked to your account.")

        year = services.require_year()
        reg = BoardingRegistration.objects.filter(
            student_id=d["student"], academic_year=year, status=BoardingRegistration.Status.REGISTERED
        ).first()
        if not reg:
            raise services.BoardingError(
                "You are not registered as a boarder this year." if role == "STUDENT"
                else "Your child is not registered as a boarder this year."
            )
        exeat = services.create_exeat(
            reg, exeat_type=d["exeat_type"], reason=d["reason"], destination=d["destination"],
            contact_name=d["contact_name"], contact_phone=d["contact_phone"],
            expected_departure=d["expected_departure"], expected_return=d["expected_return"],
            by=request.user,
            source=ExeatRequest.Source.STUDENT if role == "STUDENT" else ExeatRequest.Source.PARENT,
            approve_now=False,
        )
        return Response(ser.ExeatSerializer(ExeatRequest.objects.get(pk=exeat.pk)).data, status=status.HTTP_201_CREATED)