import datetime

from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from api import models as core_models

from . import models as m
from . import services as svc

ISSUERS = ("ADMIN", "SECRETARY", "PRINCIPAL")
SCANNERS = ("TEACHER", "ADMIN", "SECRETARY", "PRINCIPAL", "STAFF")
VIEWERS = ("ADMIN", "PRINCIPAL", "SECRETARY", "FINANCE")


def roles(*allowed):
    class _Role(BasePermission):
        def has_permission(self, request, view):
            u = request.user
            return bool(u and u.is_authenticated and u.role in allowed)
    return _Role


def _date(value):
    try:
        return datetime.date.fromisoformat(value) if value else None
    except (TypeError, ValueError):
        return None


def _scan_error(exc):
    return Response(
        {"detail": exc.detail, "code": exc.code, "student_name": exc.student_name}, status=exc.status
    )


def _card_row(c):
    s = c.student
    enrollment = s.current_enrollment
    prof = getattr(s, "id_profile", None)
    return {
        "id": c.id, "card_number": c.card_number, "status": c.status, "status_display": c.get_status_display(),
        "expiry_date": c.expiry_date, "issued_at": c.issued_at, "note": c.note,
        "student": s.id, "student_name": s.user.get_full_name(), "admission_no": s.admission_no,
        "classroom": str(enrollment.classroom) if enrollment else "",
        "has_photo": bool(prof and prof.photo),
    }


# ---------------------------------------------------------------------------
# admin: students, details, cards
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsAuthenticated, roles(*ISSUERS)])
def student_search(request):
    q = (request.query_params.get("q") or "").strip()
    if not q:
        return Response([])
    qs = core_models.StudentProfile.objects.filter(is_active=True).filter(
        Q(admission_no__icontains=q) | Q(user__first_name__icontains=q) | Q(user__last_name__icontains=q)
    ).select_related("user")[:15]
    rows = []
    for s in qs:
        enrollment = s.current_enrollment
        prof = getattr(s, "id_profile", None)
        active = s.id_cards.filter(status=m.StudentIDCard.Status.ACTIVE).first()
        rows.append({
            "id": s.id, "admission_no": s.admission_no, "full_name": s.user.get_full_name(),
            "classroom": str(enrollment.classroom) if enrollment else "",
            "has_photo": bool(prof and prof.photo),
            "active_card": active.card_number if active else None,
        })
    return Response(rows)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, roles(*ISSUERS)])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def id_profile(request, student_id):
    student = core_models.StudentProfile.objects.filter(pk=student_id).first()
    if not student:
        return Response({"detail": "Student not found."}, status=404)
    prof, _ = m.StudentIDProfile.objects.get_or_create(student=student)

    if request.method == "POST":
        if "nationality" in request.data:
            prof.nationality = (request.data.get("nationality") or "Kenyan").strip()[:60]
        if "address" in request.data:
            prof.address = (request.data.get("address") or "").strip()[:200]
        photo = request.FILES.get("photo")
        if photo:
            if not (photo.content_type or "").startswith("image/"):
                return Response({"detail": "The photo must be an image file."}, status=400)
            if photo.size > 3 * 1024 * 1024:
                return Response({"detail": "The photo must be smaller than 3 MB."}, status=400)
            prof.photo = photo
        if str(request.data.get("remove_photo", "")).lower() in ("1", "true"):
            prof.photo = None
        prof.save()

    return Response({
        "student_id": student.id, "full_name": student.user.get_full_name(),
        "admission_no": student.admission_no, "nationality": prof.nationality, "address": prof.address,
        "photo_url": request.build_absolute_uri(prof.photo.url) if prof.photo else None,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, roles(*ISSUERS, "FINANCE")])
def cards_list(request):
    qs = m.StudentIDCard.objects.select_related("student__user", "student__id_profile")
    q = (request.query_params.get("search") or "").strip()
    if q:
        qs = qs.filter(
            Q(card_number__icontains=q) | Q(student__admission_no__icontains=q)
            | Q(student__user__first_name__icontains=q) | Q(student__user__last_name__icontains=q)
        )
    status = request.query_params.get("status")
    if status:
        qs = qs.filter(status=status)
    return Response([_card_row(c) for c in qs[:300]])


@api_view(["POST"])
@permission_classes([IsAuthenticated, roles(*ISSUERS)])
def issue_card(request):
    student = core_models.StudentProfile.objects.select_related("user").filter(pk=request.data.get("student_id")).first()
    if not student:
        return Response({"detail": "Student not found."}, status=404)
    try:
        card = svc.issue_card(
            student, request.user, _date(request.data.get("expiry_date")),
            replace=bool(request.data.get("replace")), reason=(request.data.get("reason") or "")[:200],
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    return Response({"card": svc.card_payload(card, request), "warnings": svc.card_warnings(card)}, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated, roles(*ISSUERS)])
def issue_bulk(request):
    classroom = core_models.ClassRoom.objects.filter(pk=request.data.get("classroom_id")).first()
    if not classroom:
        return Response({"detail": "Classroom not found."}, status=404)
    try:
        return Response(svc.issue_missing_for_classroom(classroom, request.user))
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)


@api_view(["GET"])
@permission_classes([IsAuthenticated, roles(*ISSUERS)])
def class_sheet(request):
    classroom = core_models.ClassRoom.objects.filter(pk=request.query_params.get("classroom")).first()
    if not classroom:
        return Response({"detail": "Classroom not found."}, status=404)
    cards = (
        m.StudentIDCard.objects.filter(
            status=m.StudentIDCard.Status.ACTIVE,
            student__enrollments__classroom=classroom,
            student__enrollments__status=core_models.Enrollment.Status.ACTIVE,
        )
        .select_related("student__user", "student__id_profile")
        .distinct()
        .order_by("student__user__first_name")
    )
    payloads = [svc.card_payload(c, request) for c in cards]
    return Response({
        "classroom": str(classroom), "cards": payloads,
        "missing_photo": sum(1 for p in payloads if not p["photo_url"]),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, roles(*ISSUERS)])
def card_payload(request, pk):
    card = m.StudentIDCard.objects.select_related("student__user", "student__id_profile").filter(pk=pk).first()
    if not card:
        return Response({"detail": "Card not found."}, status=404)
    return Response(svc.card_payload(card, request))


@api_view(["POST"])
@permission_classes([IsAuthenticated, roles(*ISSUERS)])
def card_set_status(request, pk):
    card = m.StudentIDCard.objects.select_related("student__user").filter(pk=pk).first()
    if not card:
        return Response({"detail": "Card not found."}, status=404)
    try:
        svc.set_card_status(card, request.data.get("status"))
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    return Response(_card_row(card))


# ---------------------------------------------------------------------------
# scanning
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([IsAuthenticated, roles(*SCANNERS)])
def scan_attendance(request):
    """Teacher / gate scan. Body: { qr_token } or { admission_no } (manual fallback)."""
    try:
        student, card, method = svc.resolve_scan(
            request.data.get("qr_token"), request.data.get("admission_no"), strict=True
        )
        rec, created = svc.record_arrival(student, card, request.user, method)
    except svc.ScanError as exc:
        return _scan_error(exc)
    data = svc.student_snapshot(student, request, detail=False, card=card)
    data["already_checked_in"] = not created
    data["arrival_status"] = rec.status
    return Response(data, status=201 if created else 200)


@api_view(["POST"])
@permission_classes([IsAuthenticated, roles(*VIEWERS)])
def scan_lookup(request):
    """Admin scan: everything about the student. Does NOT mark attendance."""
    try:
        student, card, _ = svc.resolve_scan(
            request.data.get("qr_token"), request.data.get("admission_no"), strict=False
        )
    except svc.ScanError as exc:
        return _scan_error(exc)
    return Response(svc.student_snapshot(student, request, detail=True, card=card))


@api_view(["GET"])
@permission_classes([IsAuthenticated, roles(*SCANNERS)])
def attendance_today(request):
    day = _date(request.query_params.get("date")) or timezone.localdate()
    classroom = core_models.ClassRoom.objects.filter(pk=request.query_params.get("classroom")).first() \
        if request.query_params.get("classroom") else None
    return Response(svc.daily_summary(day, classroom, request))


@api_view(["POST"])
@permission_classes([IsAuthenticated, roles(*ISSUERS)])
def notify_absentees(request):
    day = _date(request.data.get("date")) or timezone.localdate()
    classroom = core_models.ClassRoom.objects.filter(pk=request.data.get("classroom_id")).first() \
        if request.data.get("classroom_id") else None
    return Response(svc.notify_absentees(day, classroom))