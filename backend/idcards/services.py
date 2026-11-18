"""
idcards/services.py - ID card issuing, QR payloads, fee "days allowed", arrival
marking and parent notifications. Reuses api.services for the fee ledger and email,
the Fee Update Card (gatepass) policy for days allowed, and meal_management for
the cafeteria wallet and plan.
"""
import base64
import importlib
import io
from datetime import date, time, timedelta
from decimal import Decimal

import qrcode
from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from api import models as core_models
from api import services as core

from . import models as m

QR_PREFIX = "SID:"
# Arrivals after this time are marked LATE (override in settings.py with a datetime.time).
LATE_AFTER = getattr(settings, "STUDENT_ID_LATE_AFTER", time(7, 30))


class ScanError(Exception):
    def __init__(self, detail, code, student_name=None, status=400):
        super().__init__(detail)
        self.detail, self.code, self.student_name, self.status = detail, code, student_name, status


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _abs(request, url):
    return request.build_absolute_uri(url) if request else url


def parse_qr(text):
    text = (text or "").strip()
    return text[len(QR_PREFIX):] if text.startswith(QR_PREFIX) else text


def qr_png_base64(token):
    img = qrcode.make(f"{QR_PREFIX}{token}")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def compute_expiry(student):
    """31 Dec of the year the student finishes the last grade of their curriculum."""
    enrollment = student.current_enrollment
    if not enrollment:
        return None
    grade, steps = enrollment.classroom.grade_level, 0
    while grade.next_grade_id and steps < 15:
        grade = grade.next_grade
        steps += 1
    return date(enrollment.academic_year.year + steps, 12, 31)


def generate_card_number():
    last = m.StudentIDCard.objects.aggregate(top=Max("id"))["top"] or 0
    return f"SID-{last + 1:05d}"


def guardian_contacts(student):
    links = core_models.ParentStudentLink.objects.filter(student=student).select_related("parent__user")
    return [
        {
            "name": l.parent.user.get_full_name(),
            "relationship": l.get_relationship_display(),
            "phone_number": l.parent.user.phone_number,
            "email": l.parent.user.email,
        }
        for l in links
    ]


# ---------------------------------------------------------------------------
# issuing / status
# ---------------------------------------------------------------------------
@transaction.atomic
def issue_card(student, issued_by, expiry_date=None, replace=False, reason=""):
    """
    Issues the student's card ONCE. If they already have an ACTIVE card this refuses,
    unless replace=True, which retires the old card (REPLACED) and issues a new token.
    """
    active = (
        m.StudentIDCard.objects.select_for_update().filter(student=student, status=m.StudentIDCard.Status.ACTIVE).first()
    )
    if active and not replace:
        raise ValueError(
            f"{student.user.get_full_name()} already has an active ID card ({active.card_number}). "
            "Use Replace if it was lost or damaged."
        )
    expiry = expiry_date or (active.expiry_date if active else None) or compute_expiry(student)
    if not expiry:
        raise ValueError("This student has no enrollment in the current academic year, so no expiry date can be set.")

    if active:
        active.status = m.StudentIDCard.Status.REPLACED
        active.note = (reason or "Replaced")[:200]
        active.save(update_fields=["status", "note"])

    m.StudentIDProfile.objects.get_or_create(student=student)
    return m.StudentIDCard.objects.create(
        student=student, card_number=generate_card_number(), expiry_date=expiry, issued_by=issued_by,
    )


def issue_missing_for_classroom(classroom, issued_by):
    created = existing = 0
    enrollments = core_models.Enrollment.objects.filter(
        classroom=classroom, status=core_models.Enrollment.Status.ACTIVE, student__is_active=True
    ).select_related("student__user")
    for e in enrollments:
        if m.StudentIDCard.objects.filter(student=e.student, status=m.StudentIDCard.Status.ACTIVE).exists():
            existing += 1
            continue
        issue_card(e.student, issued_by)
        created += 1
    return {"created": created, "already_had_card": existing}


@transaction.atomic
def set_card_status(card, new_status):
    S = m.StudentIDCard.Status
    if new_status not in (S.ACTIVE, S.LOST, S.BLOCKED):
        raise ValueError("Status must be ACTIVE, LOST or BLOCKED. Use Replace to issue a new card.")
    if card.status == S.REPLACED:
        raise ValueError("A replaced card can't be changed.")
    if new_status == S.ACTIVE and m.StudentIDCard.objects.filter(student=card.student, status=S.ACTIVE).exclude(pk=card.pk).exists():
        raise ValueError("This student already has another active card.")
    card.status = new_status
    card.save(update_fields=["status"])
    return card


def card_warnings(card):
    prof = getattr(card.student, "id_profile", None)
    return [] if (prof and prof.photo) else ["This student has no photo yet - upload one before printing."]


def card_payload(card, request=None):
    """Everything the PRINTED card needs. No balances: the QR fetches those live."""
    s, u = card.student, card.student.user
    prof = getattr(s, "id_profile", None)
    enrollment = s.current_enrollment
    classroom = enrollment.classroom if enrollment else None
    return {
        "id": card.id,
        "card_number": card.card_number,
        "status": card.status,
        "surname": u.last_name,
        "given_names": u.first_name,
        "sex": s.get_gender_display(),
        "nationality": prof.nationality if prof else "Kenyan",
        "address": prof.address if prof else "",
        "admission_no": s.admission_no,
        "date_of_birth": s.date_of_birth,
        "expiry_date": card.expiry_date,
        "photo_url": _abs(request, prof.photo.url) if prof and prof.photo else None,
        "classroom": str(classroom) if classroom else "",
        "grade": classroom.grade_level.name if classroom else "",
        "stream": classroom.stream.name if classroom else "",
        "qr_code_base64": qr_png_base64(card.qr_token),
        "issued_at": card.issued_at,
    }


# ---------------------------------------------------------------------------
# fee "days allowed" - SAME policy as the Fee Update Card & Gatepass
# ---------------------------------------------------------------------------
# Used only if the gatepass module can't be imported. Keep in sync with GRACE_PERIOD_BANDS.
_FALLBACK_BANDS = [
    (0.01, 5000, 10),
    (5000.01, 10000, 7),
    (10000.01, 20000, 5),
    (20000.01, 40000, 3),
    (40000.01, None, 1),
]


def _fallback_card_status(balance, issue_date, today=None):
    today = today or timezone.localdate()
    if balance <= 0:
        return "CLEARED", None
    grace_days = 0
    for lo, hi, days in _FALLBACK_BANDS:
        if balance >= lo and (hi is None or balance <= hi):
            grace_days = days
            break
    if grace_days <= 0:
        return "OWING", 0
    grace_to = issue_date + timedelta(days=grace_days - 1)
    return ("GRACE" if issue_date <= today <= grace_to else "OWING"), grace_days


def _card_status(balance, issue_date, today):
    """Prefer the real gatepass card_status so the ID and the weekly fee card always agree."""
    for path in ("api.gatepass", "api.views"):
        try:
            return importlib.import_module(path).card_status(balance, issue_date, today)
        except (ImportError, AttributeError):
            continue
    return _fallback_card_status(balance, issue_date, today)


def fee_access(student, today=None):
    """
    CLEARED : balance <= 0 -> full access.
    GRACE   : owes, but inside the grace window sized to the balance (GRACE_PERIOD_BANDS),
              counted from the MONDAY of this week (the Fee Update Card's weekly issue date).
    OWING   : owes and has no window left.
    Re-derived from the LIVE balance on every call, so a payment changes it immediately.
    """
    today = today or timezone.localdate()
    totals = core.get_ledger_totals_bulk([student.id]).get(student.id)
    balance = totals["balance"] if totals else Decimal("0")

    week_start = today - timedelta(days=today.weekday())
    status, grace_days = _card_status(balance, week_start, today)
    grace_to = week_start + timedelta(days=grace_days - 1) if status == "GRACE" and grace_days else None
    remaining = max((grace_to - today).days + 1, 0) if grace_to else 0

    message = {
        "CLEARED": "Fees cleared - full access.",
        "GRACE": f"Allowed in school until {grace_to:%a %d %b %Y} ({remaining} day{'s' if remaining != 1 else ''} left)."
        if grace_to else "",
        "OWING": "No grace period left - send to Finance office.",
    }[status]

    return {
        "status": status,
        "balance": float(balance),
        "term": None,  # kept for compatibility; the policy is weekly, not per-term
        "term_start": None, "term_end": None, "term_days": 0,
        "grace_days": grace_days or 0,
        "days_covered": grace_days or 0,
        "week_start": week_start,
        "access_until": grace_to,
        "days_remaining": remaining,
        "message": message,
    }


def meal_snapshot(student):
    """Cafeteria wallet + plan from meal_management. Never raises: available=False if it can't be read."""
    try:
        from meal_management import models as mm

        today = timezone.localdate()
        wallet = mm.MealWallet.objects.filter(student=student).first()
        link = (
            mm.StudentMealPlan.objects.filter(student=student, academic_year__is_current=True, is_active=True)
            .select_related("plan")
            .first()
        )
        out = {
            "available": True,
            "wallet_balance": float(wallet.balance) if wallet else 0.0,
            "overdraft_limit": float(getattr(settings, "MEAL_WALLET_OVERDRAFT_LIMIT", 0)),
            "plan": None, "plan_code": None, "billing_mode": None, "billing_display": None,
            "meals": [],
            "collected_today": list(
                mm.MealCollection.objects.filter(student=student, date=today).values_list("meal_type", flat=True)
            ),
        }
        if link:
            plan = link.plan
            order = {value: i for i, value in enumerate(mm.MEAL_ORDER)}
            items = sorted(plan.items.all(), key=lambda i: order.get(i.meal_type, 99))
            out.update(
                plan=plan.name, plan_code=plan.code, billing_mode=plan.billing_mode,
                billing_display=plan.get_billing_mode_display(),
                meals=[
                    {"meal_type": i.meal_type, "label": i.get_meal_type_display(), "price": float(i.price)}
                    for i in items
                ],
            )
        return out
    except Exception:  # noqa: BLE001
        return {"available": False, "wallet_balance": None, "plan": None, "meals": [], "collected_today": []}


# ---------------------------------------------------------------------------
# full student snapshot (scan result)
# ---------------------------------------------------------------------------
def student_snapshot(student, request=None, detail=True, card=None):
    u = student.user
    prof = getattr(student, "id_profile", None)
    enrollment = student.current_enrollment
    room = enrollment.classroom if enrollment else None
    today = timezone.localdate()

    fee = fee_access(student, today)
    arrival = m.ArrivalRecord.objects.filter(student=student, date=today).first()

    data = {
        "student": {
            "id": student.id, "admission_no": student.admission_no,
            "surname": u.last_name, "given_names": u.first_name, "full_name": u.get_full_name(),
            "sex": student.get_gender_display(), "date_of_birth": student.date_of_birth,
            "nationality": prof.nationality if prof else "Kenyan", "address": prof.address if prof else "",
            "photo_url": _abs(request, prof.photo.url) if prof and prof.photo else None,
            "is_active": student.is_active,
        },
        "class": {
            "classroom": str(room) if room else None,
            "grade": room.grade_level.name if room else None,
            "stream": room.stream.name if room else None,
            "academic_year": room.academic_year.year if room else None,
        },
        "card": {
            "card_number": card.card_number, "status": card.status,
            "status_display": card.get_status_display(), "expiry_date": card.expiry_date,
            "expired": card.expiry_date < today,
        } if card else None,
        "fee": fee,
        "today": {
            "checked_in": bool(arrival),
            "time": timezone.localtime(arrival.check_in_at).strftime("%H:%M") if arrival else None,
            "status": arrival.status if arrival else None,
        },
    }
    if not detail:                      # teachers: status + days only, never amounts
        data["fee"] = {k: v for k, v in fee.items() if k != "balance"}
        return data

    totals = core.get_ledger_totals_bulk([student.id]).get(student.id)
    data["ledger"] = {k: float(v) for k, v in totals.items()} if totals else None
    data["cafeteria"] = meal_snapshot(student)
    data["guardians"] = guardian_contacts(student)
    data["recent"] = [
        {"date": a.date, "time": timezone.localtime(a.check_in_at).strftime("%H:%M"),
         "status": a.status, "fee_status": a.fee_status}
        for a in m.ArrivalRecord.objects.filter(student=student).order_by("-date")[:14]
    ]
    return data


# ---------------------------------------------------------------------------
# scanning
# ---------------------------------------------------------------------------
def resolve_scan(qr_token=None, admission_no=None, strict=True):
    """-> (student, card_or_None, method). strict=True rejects inactive/expired cards (attendance)."""
    if qr_token:
        card = m.StudentIDCard.objects.select_related("student__user").filter(qr_token=parse_qr(qr_token)).first()
        if not card:
            raise ScanError("Unrecognised card - it was not issued by this school.", "unknown_card", status=404)
        name = card.student.user.get_full_name()
        if strict:
            if card.status != m.StudentIDCard.Status.ACTIVE:
                raise ScanError(f"This card is {card.get_status_display().upper()}. Do not accept it.", "card_inactive", name)
            if card.expiry_date < timezone.localdate():
                raise ScanError(f"This card expired on {card.expiry_date:%d %b %Y}.", "card_expired", name)
        return card.student, card, "SCAN"

    adm = (admission_no or "").strip()
    if not adm:
        raise ScanError("Scan a card or enter an admission number.", "empty")
    student = core_models.StudentProfile.objects.select_related("user").filter(admission_no=adm).first()
    if not student:
        raise ScanError("No student with that admission number.", "not_found", status=404)
    return student, student.id_cards.filter(status=m.StudentIDCard.Status.ACTIVE).first(), "MANUAL"


@transaction.atomic
def record_arrival(student, card, scanned_by, method="SCAN"):
    if not student.is_active:
        raise ScanError("This student is no longer active.", "student_inactive", student.user.get_full_name())
    now = timezone.localtime()
    rec, created = m.ArrivalRecord.objects.get_or_create(
        student=student, date=now.date(),
        defaults={
            "check_in_at": now,
            "status": m.ArrivalRecord.Status.LATE if now.time() > LATE_AFTER else m.ArrivalRecord.Status.PRESENT,
            "method": method, "fee_status": fee_access(student, now.date())["status"],
            "card": card, "scanned_by": scanned_by,
        },
    )
    if created:
        transaction.on_commit(lambda: notify_guardians_arrival(rec.pk))
    return rec, created


# ---------------------------------------------------------------------------
# parent notifications (email)
# ---------------------------------------------------------------------------
def notify_guardians_arrival(arrival_id):
    try:
        rec = m.ArrivalRecord.objects.select_related("student__user").get(pk=arrival_id)
        student = rec.student
        enrollment = student.current_enrollment
        local = timezone.localtime(rec.check_in_at)
        body = (
            f"{student.user.get_full_name()} ({student.admission_no}"
            f"{', ' + str(enrollment.classroom) if enrollment else ''}) arrived at school at "
            f"{local:%H:%M} on {local:%A %d %b %Y}."
            + (" They were marked LATE." if rec.status == m.ArrivalRecord.Status.LATE else "")
        )
        sent = False
        for g in guardian_contacts(student):
            if g["email"]:
                ok, _ = core.send_email_notification(g["email"], f"{student.user.first_name} has arrived at school", body)
                sent = sent or ok
        if sent:
            rec.guardian_notified = True
            rec.save(update_fields=["guardian_notified"])
    except Exception:  # noqa: BLE001 - a mail failure must never break scanning
        pass


def expected_enrollments(classroom=None):
    year = core_models.AcademicYear.objects.filter(is_current=True).first()
    qs = core_models.Enrollment.objects.filter(
        academic_year=year, status=core_models.Enrollment.Status.ACTIVE, student__is_active=True
    ).select_related("student__user", "classroom__grade_level", "classroom__stream", "classroom__academic_year")
    return qs.filter(classroom=classroom) if classroom else qs


def notify_absentees(day, classroom=None):
    arrived = set(m.ArrivalRecord.objects.filter(date=day).values_list("student_id", flat=True))
    already = set(m.AbsenceAlert.objects.filter(date=day).values_list("student_id", flat=True))
    sent = no_contact = 0
    for e in expected_enrollments(classroom):
        if e.student_id in arrived or e.student_id in already:
            continue
        emails = [g["email"] for g in guardian_contacts(e.student) if g["email"]]
        ok_any = False
        for addr in emails:
            ok, _ = core.send_email_notification(
                addr, f"{e.student.user.first_name} was not scanned in at school today",
                f"{e.student.user.get_full_name()} ({e.student.admission_no}, {e.classroom}) has not been "
                f"scanned in at school on {day:%A %d %b %Y}. If you expected them to be in school, "
                "please contact the school office.",
            )
            ok_any = ok_any or ok
        if ok_any:
            m.AbsenceAlert.objects.get_or_create(student=e.student, date=day)
            sent += 1
        else:
            no_contact += 1
    return {"date": day, "emails_sent": sent, "no_email_on_file": no_contact}


def daily_summary(day, classroom=None, request=None):
    enrollments = list(expected_enrollments(classroom))
    room_by_student = {e.student_id: str(e.classroom) for e in enrollments}
    arrivals = [
        a for a in m.ArrivalRecord.objects.filter(date=day).select_related("student__user").order_by("-check_in_at")
        if a.student_id in room_by_student
    ]
    arrived_ids = {a.student_id for a in arrivals}
    out = {
        "date": day, "expected": len(enrollments), "present": len(arrivals),
        "late": sum(1 for a in arrivals if a.status == m.ArrivalRecord.Status.LATE),
        "absent_count": len(enrollments) - len(arrived_ids),
        "arrivals": [
            {
                "id": a.id, "student_id": a.student_id, "admission_no": a.student.admission_no,
                "name": a.student.user.get_full_name(), "classroom": room_by_student[a.student_id],
                "time": timezone.localtime(a.check_in_at).strftime("%H:%M"),
                "status": a.status, "method": a.method, "fee_status": a.fee_status,
                "guardian_notified": a.guardian_notified,
            }
            for a in arrivals[:300]
        ],
        "absent": [],
    }
    if classroom:  # the full absent list only for one class (keeps the payload small)
        out["absent"] = [
            {"student_id": e.student_id, "admission_no": e.student.admission_no, "name": e.student.user.get_full_name()}
            for e in enrollments if e.student_id not in arrived_ids
        ]
    return out