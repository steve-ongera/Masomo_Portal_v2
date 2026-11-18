"""
Student 360 - everything about ONE student, split into sections so the
modal only loads what the user opens.

GET  /api/v1/students/<id>/360/overview/    ID card + headline numbers
GET  /api/v1/students/<id>/360/fees/        statement, balance, payments
GET  /api/v1/students/<id>/360/academics/   marks per enrollment year (Grade 5 2025, Grade 6 2026 ...)
GET  /api/v1/students/<id>/360/meals/       meal plan, card, wallet, recent meals
GET  /api/v1/students/<id>/360/library/     loans + fines
GET  /api/v1/students/<id>/360/discipline/  previous letters (+ context to write a new one)
POST /api/v1/students/<id>/360/discipline/  save a new disciplinary letter
GET  /api/v1/students/<id>/360/account/     login status + history
POST /api/v1/students/<id>/360/account/     { active: bool, reason }  (ADMIN only)

Password reset already exists: POST /students/<id>/reset_password/
"""
from collections import OrderedDict
from decimal import Decimal

from django.core.exceptions import FieldError
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from api import models, services

from .models import DisciplinaryRecord, StudentStatusLog

FRONT_OFFICE_ROLES = {"ADMIN", "PRINCIPAL", "SECRETARY"}


class IsFrontOffice(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and (u.is_superuser or getattr(u, "role", None) in FRONT_OFFICE_ROLES))


def _student(pk):
    return get_object_or_404(models.StudentProfile.objects.select_related("user"), pk=pk)


def _f(value):
    return float(value) if value is not None else None


def _dig(obj, *paths):
    """First non-None value among dotted attribute paths. Used for the library adapter."""
    for path in paths:
        cur = obj
        for part in path.split("."):
            cur = getattr(cur, part, None)
            if cur is None:
                break
        if cur is not None:
            return cur
    return None


class _Base(APIView):
    permission_classes = [IsFrontOffice]


# ---------------------------------------------------------------------------
# OVERVIEW (ID card + headline numbers)
# ---------------------------------------------------------------------------
class OverviewView(_Base):
    def get(self, request, pk):
        student = _student(pk)
        user = student.user

        id_card = None
        try:
            from idcards.models import StudentIDCard, StudentIDProfile

            profile = StudentIDProfile.objects.filter(student=student).first()
            card = (
                StudentIDCard.objects.filter(student=student, status="ACTIVE").first()
                or StudentIDCard.objects.filter(student=student).first()
            )
            photo = None
            if profile and profile.photo:
                photo = request.build_absolute_uri(profile.photo.url)
            id_card = {
                "photo": photo,
                "nationality": profile.nationality if profile else "Kenyan",
                "address": profile.address if profile else "",
                "card_number": card.card_number if card else None,
                "status": card.status if card else None,
                "status_display": card.get_status_display() if card else None,
                "expiry_date": card.expiry_date if card else None,
                "issued_at": card.issued_at if card else None,
            }
        except Exception:  # idcards app not installed / not migrated yet
            id_card = None

        return Response({
            "admission_no": student.admission_no,
            "id_card": id_card,
            "login_enabled": bool(user.is_active and user.is_active_staff and student.is_active),
            "balance": _f(services.get_outstanding_balance(student)),
            "discipline_count": student.disciplinary_records.count(),
            "last_login": user.last_login,
        })


# ---------------------------------------------------------------------------
# FEES
# ---------------------------------------------------------------------------
class FeesView(_Base):
    def get(self, request, pk):
        student = _student(pk)
        ledger = services.get_ledger_totals_bulk([student.id]).get(student.id)

        invoices = (
            models.Invoice.objects.filter(enrollment__student=student)
            .select_related(
                "fee_structure__term__academic_year",
                "enrollment__classroom__grade_level", "enrollment__classroom__stream",
            )
            .order_by("fee_structure__term__academic_year__year", "fee_structure__term__term_number", "id")
        )
        payments = (
            models.Payment.objects.filter(invoice__enrollment__student=student)
            .select_related("invoice__fee_structure__term__academic_year", "recorded_by")
            .order_by("-paid_at", "-id")
        )
        other = services.get_student_other_charges_summary(student)

        return Response({
            "summary": {
                "opening_balance": _f(ledger["opening"]) if ledger else 0,
                "total_charged": _f(ledger["charged"]) if ledger else 0,
                "total_paid": _f(ledger["paid"]) if ledger else 0,
                "balance": _f(ledger["balance"]) if ledger else 0,  # +owes / -prepaid
                "other_charges_outstanding": _f(other["total_outstanding"]),
            },
            "invoices": [
                {
                    "id": i.id,
                    "term": str(i.fee_structure.term),
                    "academic_year": i.fee_structure.term.academic_year.year,
                    "classroom": str(i.enrollment.classroom),
                    "brought_forward": _f(i.brought_forward),
                    "term_charge": _f(i.term_charge),
                    "amount_due": _f(i.amount_due),
                    "amount_paid": _f(i.amount_paid),
                    "balance": _f(i.balance),
                }
                for i in invoices
            ],
            "payments": [
                {
                    "id": p.id,
                    "receipt_no": p.receipt_no,
                    "paid_at": p.paid_at,
                    "term": str(p.invoice.fee_structure.term),
                    "amount": _f(p.amount),
                    "method": p.get_method_display(),
                    "reference": p.reference,
                    "recorded_by": p.recorded_by.get_full_name() if p.recorded_by else "Self-service",
                }
                for p in payments
            ],
        })


# ---------------------------------------------------------------------------
# ACADEMICS - marks for every year the student has been enrolled
# ---------------------------------------------------------------------------
class AcademicsView(_Base):
    def get(self, request, pk):
        student = _student(pk)
        enrollments = (
            models.Enrollment.objects.filter(student=student)
            .select_related("classroom__grade_level", "classroom__stream", "academic_year")
            .order_by("academic_year__year")
        )

        years = []
        for enr in enrollments:
            grade_level = enr.classroom.grade_level
            curriculum = grade_level.curriculum_type

            results = (
                models.ExamResult.objects.filter(
                    enrollment=enr, is_absent=False, marks_obtained__isnull=False, max_marks__gt=0
                )
                .select_related("exam__term", "exam__exam_type", "subject")
                .order_by("exam__term__term_number", "exam__exam_type__order")
            )

            # exam -> subject -> [marks, max]
            by_exam = OrderedDict()
            for r in results:
                block = by_exam.setdefault(r.exam_id, {"exam": r.exam, "subjects": OrderedDict()})
                cell = block["subjects"].setdefault(r.subject_id, [r.subject, Decimal("0"), Decimal("0")])
                cell[1] += r.marks_obtained
                cell[2] += r.max_marks

            exams = []
            for block in by_exam.values():
                exam = block["exam"]
                rows, pcts = [], []
                for subject, marks, max_marks in block["subjects"].values():
                    pct = round(float(marks / max_marks * 100), 1)
                    grade = services.grade_for_percentage(
                        curriculum, Decimal(str(pct)), subject, grade_level=grade_level, term=exam.term
                    )
                    rows.append({
                        "subject": subject.name, "marks": _f(marks), "out_of": _f(max_marks),
                        "percentage": pct, "grade": grade.grade_letter,
                        "points": _f(grade.points), "remark": grade.remark,
                    })
                    pcts.append(pct)
                average = round(sum(pcts) / len(pcts), 1) if pcts else None
                overall = (
                    services.grade_for_percentage(
                        curriculum, Decimal(str(average)), grade_level=grade_level, term=exam.term
                    ) if average is not None else None
                )
                pos = services.get_student_exam_summary(enr, exam)
                exams.append({
                    "exam_id": exam.id,
                    "exam": exam.name,
                    "term": str(exam.term),
                    "term_number": exam.term.term_number,
                    "is_published": exam.is_published,
                    "average": average,
                    "overall_grade": overall.grade_letter if overall else None,
                    "class_position": pos.get("class_position"),
                    "class_size": pos.get("class_size"),
                    "grade_position": pos.get("grade_position"),
                    "grade_size": pos.get("grade_size"),
                    "subjects": rows,
                })

            years.append({
                "enrollment_id": enr.id,
                "academic_year": enr.academic_year.year,
                "is_current": enr.academic_year.is_current,
                "classroom": str(enr.classroom),
                "grade_level": grade_level.name,
                "status": enr.get_status_display(),
                "exams": exams,
            })
        return Response({"years": years})


# ---------------------------------------------------------------------------
# MEALS
# ---------------------------------------------------------------------------
class MealsView(_Base):
    def get(self, request, pk):
        student = _student(pk)
        try:
            from meal_management import models as mm
        except ImportError:
            return Response({"available": False})

        year = models.AcademicYear.objects.filter(is_current=True).first()
        sp = (
            mm.StudentMealPlan.objects.filter(student=student, academic_year=year, is_active=True)
            .select_related("plan").first()
            if year else None
        )
        plan = None
        if sp:
            plan = {
                "name": sp.plan.name,
                "billing_mode": sp.plan.billing_mode,
                "billing_display": sp.plan.get_billing_mode_display(),
                "meals": [
                    {"meal": i.get_meal_type_display(), "price": _f(i.price)}
                    for i in sp.plan.items.all()
                ],
            }

        card = mm.MealCard.objects.filter(student=student, status="ACTIVE").first()
        wallet = getattr(student, "meal_wallet", None)
        recent = mm.MealCollection.objects.filter(student=student).order_by("-collected_at")[:15]
        txns = wallet.transactions.all()[:10] if wallet else []

        return Response({
            "available": True,
            "plan": plan,
            "card": {
                "card_number": card.card_number, "status": card.get_status_display(),
                "issued_at": card.issued_at, "expires_at": card.expires_at,
            } if card else None,
            "wallet": {"balance": _f(wallet.balance)} if wallet else None,
            "recent_meals": [
                {"date": c.date, "meal": c.get_meal_type_display(), "charged": _f(c.amount_charged)}
                for c in recent
            ],
            "wallet_transactions": [
                {"date": t.created_at, "kind": t.get_kind_display(), "amount": _f(t.amount),
                 "balance_after": _f(t.balance_after), "reference": t.reference}
                for t in txns
            ],
        })


# ---------------------------------------------------------------------------
# LIBRARY  (adapter - the library/models.py file wasn't shared, so field
# names are looked up defensively. Adjust the candidate names below if a
# column shows up empty.)
# ---------------------------------------------------------------------------
class LibraryView(_Base):
    def get(self, request, pk):
        student = _student(pk)
        from django.apps import apps

        try:
            Loan = apps.get_model("library", "Loan")
        except LookupError:
            return Response({"available": False, "detail": "Library app has no Loan model."})
        try:
            Fine = apps.get_model("library", "Fine")
        except LookupError:
            Fine = None

        try:
            loans_qs = Loan.objects.filter(student=student).order_by("-id")[:50]
            loans = [
                {
                    "id": l.id,
                    "book": _dig(l, "copy.book.title", "book.title", "title") or str(l),
                    "accession_no": _dig(l, "copy.accession_no", "accession_no"),
                    "issued_on": _dig(l, "issued_at", "issue_date", "borrowed_at", "date_issued"),
                    "due_on": _dig(l, "due_date", "due_at", "date_due"),
                    "returned_on": _dig(l, "returned_at", "return_date", "date_returned"),
                    "status": _dig(l, "status"),
                }
                for l in loans_qs
            ]
            fines = []
            if Fine is not None:
                for f in Fine.objects.filter(student=student).order_by("-id")[:50]:
                    fines.append({
                        "id": f.id,
                        "amount": _f(_dig(f, "amount", "amount_due")),
                        "reason": _dig(f, "reason", "note", "description"),
                        "status": _dig(f, "status"),
                        "created": _dig(f, "created_at", "date"),
                    })
        except (FieldError, TypeError, ValueError) as exc:
            return Response({"available": False, "detail": f"Library adapter needs adjusting: {exc}"})

        def is_open(l):
            return not l["returned_on"]

        return Response({
            "available": True,
            "currently_borrowed": sum(1 for l in loans if is_open(l)),
            "loans": loans,
            "fines": fines,
        })


# ---------------------------------------------------------------------------
# DISCIPLINE
# ---------------------------------------------------------------------------
def _record_dict(r):
    return {
        "id": r.id,
        "incident_date": r.incident_date,
        "category": r.category, "category_display": r.get_category_display(),
        "severity": r.severity, "severity_display": r.get_severity_display(),
        "action_taken": r.action_taken, "action_display": r.get_action_taken_display(),
        "summary": r.summary,
        "description": r.description,
        "letter_body": r.letter_body,
        "class_label": str(r.enrollment.classroom) if r.enrollment else "",
        "issued_by": r.issued_by.get_full_name() if r.issued_by else "-",
        "created_at": r.created_at,
    }


class DisciplineView(_Base):
    def get(self, request, pk):
        student = _student(pk)
        school = models.School.objects.first()
        link = models.ParentStudentLink.objects.filter(student=student).select_related("parent__user").first()
        records = student.disciplinary_records.select_related("enrollment__classroom", "issued_by")
        return Response({
            "context": {
                "school_name": school.name if school else "",
                "student_name": student.user.get_full_name(),
                "admission_no": student.admission_no,
                "class_label": services.get_student_status_label(student),
                "guardian_name": link.parent.user.get_full_name() if link else "",
                "issuer_name": request.user.get_full_name() or request.user.username,
            },
            "records": [_record_dict(r) for r in records],
        })

    def post(self, request, pk):
        student = _student(pk)
        d = request.data

        summary = (d.get("summary") or "").strip()
        letter = (d.get("letter_body") or "").strip()
        if not summary:
            return Response({"detail": "Give a short summary of the incident."}, status=400)
        if not letter:
            return Response({"detail": "The letter cannot be empty."}, status=400)

        incident_date = parse_date(d.get("incident_date") or "")
        if not incident_date:
            return Response({"detail": "Enter a valid incident date."}, status=400)

        R = DisciplinaryRecord
        category, severity, action = d.get("category", "OTHER"), d.get("severity", "MINOR"), d.get("action_taken", "WARNING")
        if category not in R.Category.values or severity not in R.Severity.values or action not in R.Action.values:
            return Response({"detail": "Invalid category, severity or action."}, status=400)

        record = R.objects.create(
            student=student,
            enrollment=student.current_enrollment,
            incident_date=incident_date,
            category=category, severity=severity, action_taken=action,
            summary=summary[:200],
            description=(d.get("description") or "").strip(),
            letter_body=letter,
            issued_by=request.user,
        )
        return Response(_record_dict(record), status=201)


# ---------------------------------------------------------------------------
# ACCOUNT - deactivate / reactivate (student cannot log in while inactive)
# ---------------------------------------------------------------------------
@transaction.atomic
def set_student_active(student, active, reason, by):
    user = student.user
    if active:
        school = models.School.objects.first()
        count = models.StudentProfile.objects.filter(is_active=True).count()
        services.check_license_limit(school, "students", count)  # raises LicenseLimitExceeded

    user.is_active = active
    user.is_active_staff = active
    user.save(update_fields=["is_active", "is_active_staff"])
    student.is_active = active
    student.save(update_fields=["is_active"])

    StudentStatusLog.objects.create(
        student=student,
        action=StudentStatusLog.Action.REACTIVATED if active else StudentStatusLog.Action.DEACTIVATED,
        reason=reason[:255], performed_by=by,
    )


class AccountView(_Base):
    def get(self, request, pk):
        student = _student(pk)
        user = student.user
        return Response({
            "profile_active": student.is_active,
            "login_enabled": bool(user.is_active and user.is_active_staff),
            "locked": user.is_locked,
            "last_login": user.last_login,
            "history": [
                {"action": l.get_action_display(), "reason": l.reason, "at": l.created_at,
                 "by": l.performed_by.get_full_name() if l.performed_by else "-"}
                for l in student.status_logs.select_related("performed_by")[:20]
            ],
        })

    def post(self, request, pk):
        if not (request.user.is_superuser or request.user.role == "ADMIN"):
            return Response({"detail": "Only an administrator can change account status."}, status=403)
        student = _student(pk)
        active = request.data.get("active")
        reason = (request.data.get("reason") or "").strip()
        if not isinstance(active, bool):
            return Response({"detail": "'active' must be true or false."}, status=400)
        if not active and not reason:
            return Response({"detail": "Please give a reason for deactivating this student."}, status=400)
        try:
            set_student_active(student, active, reason, request.user)
        except services.LicenseLimitExceeded as exc:
            return Response({"detail": str(exc)}, status=403)
        return Response({"detail": "Student reactivated." if active else "Student deactivated. They can no longer log in."})