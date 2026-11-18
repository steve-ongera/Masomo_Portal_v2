"""
library/services.py - all library business rules. Views stay thin.

LENDING RULES (editable in LibrarySettings):
  - a learner may hold max_active_loans books at once
  - no new loan while they have an overdue book (block_if_overdue)
  - no new loan while they have unpaid library fines (block_if_unpaid_fines)
  - loan length = loan_days; a loan can be renewed max_renewals times,
    but never once it is overdue

FINES:
  - overdue: (calendar days late - grace_days) x fine_per_day, charged at return
  - lost: replacement cost (the book's price, or an amount the librarian enters)
  - damaged: optional amount entered by the librarian
  A fine is UNPAID until the librarian marks it PAID, or WAIVED with a note.
  Library fines are separate from school fees.
"""
import re
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied

from api import models as api_models
from api import services as api_services

from .models import Book, BookCategory, BookCopy, Fine, LibrarySettings, Loan

Copy = BookCopy.Status
FineStatus = Fine.Status


class LibraryError(APIException):
    """A lending rule was broken. Always a 400 with {"detail": message}."""
    status_code = 400
    default_code = "library_error"


def today():
    return timezone.localdate()


# ---------------------------------------------------------------------------
# ACCESSION NUMBERS
# ---------------------------------------------------------------------------
def next_accession_numbers(n):
    last = BookCopy.objects.filter(accession_no__regex=r"^LIB-\d+$").order_by("-accession_no").first()
    start = int(last.accession_no.split("-")[1]) + 1 if last else 1
    return [f"LIB-{i:06d}" for i in range(start, start + n)]


@transaction.atomic
def add_copies(book, count):
    numbers = next_accession_numbers(count)
    BookCopy.objects.bulk_create([BookCopy(book=book, accession_no=a) for a in numbers])
    return numbers


# ---------------------------------------------------------------------------
# STUDENTS + STANDING
# ---------------------------------------------------------------------------
def overdue_days(loan, on=None):
    """Calendar days past due_on (0 if not late). Works for open and closed loans."""
    end = loan.returned_on or on or today()
    return max((end - loan.due_on).days, 0)


def fine_for_days(days):
    s = LibrarySettings.get()
    chargeable = max(days - s.grace_days, 0)
    return (Decimal(chargeable) * s.fine_per_day).quantize(Decimal("0.01"))


def student_standing(student):
    s = LibrarySettings.get()
    t = today()
    active = Loan.objects.filter(student=student, returned_on__isnull=True)
    active_count = active.count()
    overdue_count = active.filter(due_on__lt=t).count()
    unpaid = Fine.objects.filter(loan__student=student, status=FineStatus.UNPAID).aggregate(t=Sum("amount"))["t"] or Decimal("0")

    reasons = []
    if not student.is_active:
        reasons.append("This learner is no longer active.")
    if active_count >= s.max_active_loans:
        reasons.append(f"Already holds the maximum of {s.max_active_loans} books.")
    if s.block_if_overdue and overdue_count:
        reasons.append(f"Has {overdue_count} overdue book(s) to return first.")
    if s.block_if_unpaid_fines and unpaid > 0:
        reasons.append(f"Has unpaid library fines of KES {unpaid:,.2f}.")
    return {
        "active_loans": active_count,
        "overdue_loans": overdue_count,
        "unpaid_fines": unpaid,
        "max_active_loans": s.max_active_loans,
        "can_borrow": not reasons,
        "blocked_reasons": reasons,
    }


def search_students(q):
    q = (q or "").strip()
    if len(q) < 2:
        return []
    students = (
        api_models.StudentProfile.objects.filter(is_active=True)
        .filter(
            Q(admission_no__icontains=q)
            | Q(user__first_name__icontains=q)
            | Q(user__last_name__icontains=q)
        )
        .select_related("user")
        .order_by("admission_no")[:15]
    )
    out = []
    for st in students:
        enr = st.current_enrollment
        out.append({
            "student_id": st.id,
            "admission_no": st.admission_no,
            "full_name": st.user.get_full_name(),
            "classroom": str(enr.classroom) if enr else "No current class",
            **student_standing(st),
        })
    return out


# ---------------------------------------------------------------------------
# ISSUE / RETURN / RENEW
# ---------------------------------------------------------------------------
@transaction.atomic
def issue_book(librarian, admission_no, accession_no, due_on=None):
    student = api_models.StudentProfile.objects.select_related("user").filter(admission_no=admission_no.strip()).first()
    if not student:
        raise LibraryError(f"No learner with admission number {admission_no}.")

    copy = (
        BookCopy.objects.select_for_update().select_related("book")
        .filter(accession_no=accession_no.strip().upper()).first()
    )
    if not copy:
        raise LibraryError(f"No book copy with accession number {accession_no}.")
    if not copy.book.is_active:
        raise LibraryError("This title has been hidden from the catalogue.")
    if copy.status != Copy.AVAILABLE:
        raise LibraryError(f"This copy can't be issued: it is {copy.get_status_display().lower()}.")

    standing = student_standing(student)
    if not standing["can_borrow"]:
        raise LibraryError(" ".join(standing["blocked_reasons"]))

    s = LibrarySettings.get()
    t = today()
    due = due_on or t + timedelta(days=s.loan_days)
    if due < t:
        raise LibraryError("The due date can't be in the past.")

    loan = Loan.objects.create(
        copy=copy, student=student,
        borrower_admission_no=student.admission_no, borrower_name=student.user.get_full_name(),
        issued_on=t, due_on=due, issued_by=librarian,
    )
    copy.status = Copy.ON_LOAN
    copy.save(update_fields=["status"])
    return loan


@transaction.atomic
def return_book(librarian, accession_no, condition="GOOD", fine_amount=None, note=""):
    copy = BookCopy.objects.select_for_update().select_related("book").filter(accession_no=accession_no.strip().upper()).first()
    if not copy:
        raise LibraryError(f"No book copy with accession number {accession_no}.")
    loan = Loan.objects.select_for_update().filter(copy=copy, returned_on__isnull=True).first()
    if not loan:
        raise LibraryError("This copy isn't on loan.")

    t = today()
    fines = []
    days = overdue_days(loan, t)
    late_fee = fine_for_days(days)
    if late_fee > 0:
        fines.append(Fine.objects.create(loan=loan, amount=late_fee, reason=Fine.Reason.OVERDUE, note=f"{days} day(s) late"))

    if condition == Loan.Condition.LOST:
        amount = fine_amount if fine_amount is not None else copy.book.price
        if amount is None or amount <= 0:
            raise LibraryError("Enter the replacement fee for a lost book (this title has no price set).")
        fines.append(Fine.objects.create(loan=loan, amount=amount, reason=Fine.Reason.LOST, note=note))
        copy.status = Copy.LOST
    elif condition == Loan.Condition.DAMAGED:
        if fine_amount and fine_amount > 0:
            fines.append(Fine.objects.create(loan=loan, amount=fine_amount, reason=Fine.Reason.DAMAGED, note=note))
        copy.status = Copy.DAMAGED
    else:
        copy.status = Copy.AVAILABLE

    loan.returned_on = t
    loan.received_by = librarian
    loan.return_condition = condition
    loan.note = note[:255]
    loan.save(update_fields=["returned_on", "received_by", "return_condition", "note"])
    copy.save(update_fields=["status"])
    return loan, fines


@transaction.atomic
def renew_loan(loan):
    loan = Loan.objects.select_for_update().get(pk=loan.pk)
    s = LibrarySettings.get()
    t = today()
    if loan.returned_on:
        raise LibraryError("This book has already been returned.")
    if loan.due_on < t:
        raise LibraryError("An overdue book can't be renewed. Return it first.")
    if loan.renewals >= s.max_renewals:
        raise LibraryError(f"This loan has already been renewed {s.max_renewals} time(s).")
    loan.due_on = max(loan.due_on, t) + timedelta(days=s.loan_days)
    loan.renewals += 1
    loan.save(update_fields=["due_on", "renewals"])
    return loan


@transaction.atomic
def settle_fine(librarian, fine, action, note=""):
    if fine.status != FineStatus.UNPAID:
        raise LibraryError("This fine has already been settled.")
    note = (note or "").strip()
    if action == "WAIVE" and not note:
        raise LibraryError("Give a reason for waiving the fine.")
    fine.status = FineStatus.PAID if action == "PAY" else FineStatus.WAIVED
    if note:
        fine.note = f"{fine.note}. {note}".strip(". ") if fine.note else note
    fine.settled_at = timezone.now()
    fine.settled_by = librarian
    fine.save(update_fields=["status", "note", "settled_at", "settled_by"])
    return fine


@transaction.atomic
def set_copy_status(copy, status):
    allowed = {Copy.AVAILABLE, Copy.DAMAGED, Copy.LOST, Copy.WITHDRAWN}
    if status not in allowed:
        raise LibraryError("Status must be Available, Damaged, Lost or Withdrawn.")
    if copy.status == Copy.ON_LOAN:
        raise LibraryError("This copy is on loan. Receive it back first.")
    copy.status = status
    copy.save(update_fields=["status"])
    return copy


# ---------------------------------------------------------------------------
# SERIALIZING LOANS
# ---------------------------------------------------------------------------
def loan_dict(loan, on=None):
    t = on or today()
    days = overdue_days(loan, t)
    return {
        "id": loan.id,
        "accession_no": loan.copy.accession_no,
        "book_id": loan.copy.book_id,
        "title": loan.copy.book.title,
        "author": loan.copy.book.author,
        "admission_no": loan.borrower_admission_no,
        "student_name": loan.borrower_name,
        "issued_on": loan.issued_on,
        "due_on": loan.due_on,
        "returned_on": loan.returned_on,
        "renewals": loan.renewals,
        "is_active": loan.returned_on is None,
        "is_overdue": loan.returned_on is None and loan.due_on < t,
        "days_overdue": days,
        "accrued_fine": fine_for_days(days) if loan.returned_on is None else Decimal("0"),
        "return_condition": loan.return_condition,
        "issued_by": loan.issued_by.get_full_name() if loan.issued_by else "",
    }


def fine_dict(f):
    return {
        "id": f.id,
        "amount": f.amount,
        "reason": f.reason,
        "reason_display": f.get_reason_display(),
        "status": f.status,
        "status_display": f.get_status_display(),
        "note": f.note,
        "created_at": f.created_at,
        "settled_at": f.settled_at,
        "title": f.loan.copy.book.title,
        "accession_no": f.loan.copy.accession_no,
        "admission_no": f.loan.borrower_admission_no,
        "student_name": f.loan.borrower_name,
    }


def filter_loans(qs, status=None, q=None, date_from=None, date_to=None):
    t = today()
    if status == "active":
        qs = qs.filter(returned_on__isnull=True)
    elif status == "overdue":
        qs = qs.filter(returned_on__isnull=True, due_on__lt=t)
    elif status == "returned":
        qs = qs.filter(returned_on__isnull=False)
    if q:
        qs = qs.filter(
            Q(borrower_name__icontains=q) | Q(borrower_admission_no__icontains=q)
            | Q(copy__accession_no__icontains=q) | Q(copy__book__title__icontains=q)
        )
    if date_from:
        qs = qs.filter(issued_on__gte=date_from)
    if date_to:
        qs = qs.filter(issued_on__lte=date_to)
    return qs.select_related("copy__book", "issued_by")


# ---------------------------------------------------------------------------
# DASHBOARD + REPORTS
# ---------------------------------------------------------------------------
def dashboard():
    t = today()
    copies = BookCopy.objects.aggregate(
        total=Count("id"),
        available=Count("id", filter=Q(status=Copy.AVAILABLE)),
        on_loan=Count("id", filter=Q(status=Copy.ON_LOAN)),
        lost=Count("id", filter=Q(status=Copy.LOST)),
        damaged=Count("id", filter=Q(status=Copy.DAMAGED)),
    )
    active = Loan.objects.filter(returned_on__isnull=True)
    unpaid = Fine.objects.filter(status=FineStatus.UNPAID).aggregate(t=Sum("amount"), n=Count("id"))
    week_start = t - timedelta(days=13)
    per_day = {r["issued_on"]: r["c"] for r in Loan.objects.filter(issued_on__gte=week_start).values("issued_on").annotate(c=Count("id"))}
    return {
        "titles": Book.objects.filter(is_active=True).count(),
        "copies": copies,
        "overdue": active.filter(due_on__lt=t).count(),
        "due_today": active.filter(due_on=t).count(),
        "unpaid_fines_total": unpaid["t"] or Decimal("0"),
        "unpaid_fines_count": unpaid["n"],
        "issued_per_day": [
            {"date": week_start + timedelta(days=i), "count": per_day.get(week_start + timedelta(days=i), 0)}
            for i in range(14)
        ],
        "overdue_list": [loan_dict(l, t) for l in filter_loans(active.filter(due_on__lt=t).order_by("due_on"))[:8]],
        "due_today_list": [loan_dict(l, t) for l in filter_loans(active.filter(due_on=t))[:8]],
    }


def report_overdue():
    t = today()
    loans = filter_loans(Loan.objects.filter(returned_on__isnull=True, due_on__lt=t).order_by("due_on"))
    rows = []
    for l in loans:
        d = loan_dict(l, t)
        enr = l.student.current_enrollment if l.student else None
        d["classroom"] = str(enr.classroom) if enr else ""
        rows.append(d)
    return rows


def report_popular(date_from=None, date_to=None, limit=15):
    qs = Loan.objects.all()
    if date_from:
        qs = qs.filter(issued_on__gte=date_from)
    if date_to:
        qs = qs.filter(issued_on__lte=date_to)
    books = list(
        qs.values("copy__book_id", "copy__book__title", "copy__book__author")
        .annotate(loans=Count("id")).order_by("-loans", "copy__book__title")[:limit]
    )
    borrowers = list(
        qs.values("borrower_admission_no", "borrower_name").annotate(loans=Count("id")).order_by("-loans")[:limit]
    )
    return {
        "books": [{"book_id": b["copy__book_id"], "title": b["copy__book__title"], "author": b["copy__book__author"], "loans": b["loans"]} for b in books],
        "borrowers": [{"admission_no": b["borrower_admission_no"], "name": b["borrower_name"], "loans": b["loans"]} for b in borrowers],
    }


def report_stock():
    rows = (
        Book.objects.filter(is_active=True)
        .values("category__name")
        .annotate(
            titles=Count("id", distinct=True),
            copies=Count("copies"),
            available=Count("copies", filter=Q(copies__status=Copy.AVAILABLE)),
            on_loan=Count("copies", filter=Q(copies__status=Copy.ON_LOAN)),
            lost=Count("copies", filter=Q(copies__status=Copy.LOST)),
            damaged=Count("copies", filter=Q(copies__status=Copy.DAMAGED)),
        )
        .order_by("category__name")
    )
    return [{"category": r["category__name"] or "Uncategorised", **{k: r[k] for k in ("titles", "copies", "available", "on_loan", "lost", "damaged")}} for r in rows]


def remind_overdue(librarian):
    """One in-app message per learner (and their guardians) listing overdue books."""
    t = today()
    by_student = defaultdict(list)
    for l in filter_loans(Loan.objects.filter(returned_on__isnull=True, due_on__lt=t, student__isnull=False)):
        by_student[l.student_id].append(l)

    sent = 0
    for loans in by_student.values():
        student = loans[0].student
        lines = [f"- {l.copy.book.title}, was due {l.due_on:%d %b %Y}" for l in loans]
        try:
            comm = api_models.Communication.objects.create(
                sender=librarian,
                subject="Library books to return",
                body=f"{student.user.get_full_name()} ({student.admission_no}) has overdue library book(s):\n"
                     + "\n".join(lines) + "\n\nPlease return them to the library as soon as possible.",
                category=api_models.Communication.Category.GENERAL,
                audience_type=api_models.Communication.AudienceType.INDIVIDUAL,
                include_students=True, include_guardians=True,
                send_in_app=True, send_sms=False, send_email=False,
            )
            comm.target_students.set([student])
            api_services.send_communication(comm)
            sent += 1
        except Exception:  # noqa: BLE001 - one bad message never stops the rest
            continue
    return {"learners_reminded": sent, "learners_overdue": len(by_student)}


# ---------------------------------------------------------------------------
# STUDENT / PARENT VIEW
# ---------------------------------------------------------------------------
def my_library(user, student_id=None):
    children = []
    student = getattr(user, "student_profile", None)
    if user.role == api_models.User.Role.PARENT:
        links = api_models.ParentStudentLink.objects.filter(parent__user=user).select_related("student__user")
        children = [{"student_id": l.student_id, "name": l.student.user.get_full_name(), "admission_no": l.student.admission_no} for l in links]
        link = links.filter(student_id=student_id).first() if student_id else links.first()
        student = link.student if link else None
    elif user.role != api_models.User.Role.STUDENT:
        raise PermissionDenied("This page is for learners and parents.")
    if not student:
        raise LibraryError("No learner profile found for this account.")

    t = today()
    loans = Loan.objects.filter(student=student).select_related("copy__book", "issued_by")
    s = LibrarySettings.get()
    fines = Fine.objects.filter(loan__student=student).select_related("loan__copy__book").order_by("-created_at")
    unpaid = sum((f.amount for f in fines if f.status == FineStatus.UNPAID), Decimal("0"))
    return {
        "student": {"student_id": student.id, "name": student.user.get_full_name(), "admission_no": student.admission_no},
        "children": children,
        "current": [loan_dict(l, t) for l in loans.filter(returned_on__isnull=True).order_by("due_on")],
        "history": [loan_dict(l, t) for l in loans.filter(returned_on__isnull=False)[:50]],
        "fines": [fine_dict(f) for f in fines[:50]],
        "unpaid_fines": unpaid,
        "rules": {
            "loan_days": s.loan_days, "max_active_loans": s.max_active_loans,
            "max_renewals": s.max_renewals, "fine_per_day": s.fine_per_day, "grace_days": s.grace_days,
        },
    }
