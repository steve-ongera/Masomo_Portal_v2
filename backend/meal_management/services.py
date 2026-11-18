"""
meal_management/services.py - business rules for cards, entitlement checks,
meal issuing, the wallet, offline sync and the cafeteria dashboard.
"""
import base64
import io
from collections import defaultdict
from decimal import Decimal

import qrcode
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api import models as api_models

from . import models

MEAL_LABELS = dict(models.MealType.choices)


class MealNotAllowed(Exception):
    """Raised when a meal cannot be issued. `.check` is the eligibility payload."""

    def __init__(self, check):
        self.check = check
        super().__init__(check.get("reason", "Not allowed."))


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def overdraft_limit():
    """How far below zero a wallet student may still be served (KES). Default 100."""
    return Decimal(str(getattr(settings, "MEAL_WALLET_OVERDRAFT_LIMIT", 100)))


def year_for(on_date):
    """The academic year containing `on_date`, falling back to the current one."""
    return (
        api_models.AcademicYear.objects.filter(start_date__lte=on_date, end_date__gte=on_date).first()
        or api_models.AcademicYear.objects.filter(is_current=True).first()
    )


def qr_base64(token):
    """QR image encoding ONLY the opaque token - no personal data, no URL."""
    img = qrcode.make(token, box_size=6, border=2)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def _student_block(student, year):
    enrollment = None
    if year:
        enrollment = (
            api_models.Enrollment.objects.filter(
                student=student, academic_year=year, status=api_models.Enrollment.Status.ACTIVE
            )
            .select_related("classroom__grade_level", "classroom__stream", "classroom__academic_year")
            .first()
        )
    return (
        {
            "student_id": student.id,
            "name": student.user.get_full_name(),
            "admission_no": student.admission_no,
            "classroom": str(enrollment.classroom) if enrollment else None,
        },
        enrollment,
    )


def entitled_rows(on_date, meal_type=None):
    """
    StudentMealPlan rows for students who are active, enrolled (ACTIVE) in the
    year of `on_date`, on an active plan - optionally only plans that include
    `meal_type`. Single source of truth for dashboard, roster and 'missing'.
    """
    year = year_for(on_date)
    if not year:
        return models.StudentMealPlan.objects.none()
    qs = models.StudentMealPlan.objects.filter(
        academic_year=year, is_active=True, plan__is_active=True, student__is_active=True,
        student__enrollments__academic_year=year,
        student__enrollments__status=api_models.Enrollment.Status.ACTIVE,
    )
    if meal_type:
        qs = qs.filter(plan__items__meal_type=meal_type)
    return qs.select_related("student__user", "plan").distinct()


# ---------------------------------------------------------------------------
# cards
# ---------------------------------------------------------------------------
@transaction.atomic
def issue_card(student, issued_by=None, expires_at=None):
    """Issue a new card. Any existing ACTIVE card is marked REPLACED first."""
    models.MealCard.objects.filter(student=student, status=models.MealCard.Status.ACTIVE).update(
        status=models.MealCard.Status.REPLACED
    )
    return models.MealCard.objects.create(student=student, issued_by=issued_by, expires_at=expires_at)


@transaction.atomic
def set_card_status(card, new_status):
    Status = models.MealCard.Status
    if new_status not in (Status.ACTIVE, Status.LOST, Status.BLOCKED):
        raise ValueError("Status must be ACTIVE, LOST or BLOCKED. Use 'issue' to replace a card.")
    if card.status == Status.REPLACED:
        raise ValueError("A replaced card cannot be changed.")
    if new_status == Status.ACTIVE:
        if models.MealCard.objects.filter(student=card.student, status=Status.ACTIVE).exclude(pk=card.pk).exists():
            raise ValueError("This student already has another active card.")
    card.status = new_status
    card.save(update_fields=["status"])
    return card


def resolve_card(code):
    """
    Find a card from whatever the desk was given. Tried in this order:
      1. the opaque QR token (what a scanner / camera sends)
      2. the printed card number (e.g. typed by hand)
      3. the student's admission number -> their ACTIVE card (or, if they have
         no active card, their most recent one so the desk can explain why
         it is lost / blocked / replaced instead of just saying "not found")
    """
    code = (code or "").strip()
    if not code:
        return None

    cards = models.MealCard.objects.select_related("student__user")

    try:
        card = cards.filter(qr_token=code).first()
    except (ValidationError, ValueError):
        card = None  # code is not a valid token format (e.g. qr_token is a UUIDField)
    if card:
        return card

    card = cards.filter(card_number__iexact=code).first()
    if card:
        return card

    by_student = cards.filter(student__admission_no__iexact=code)
    return (
        by_student.filter(status=models.MealCard.Status.ACTIVE).first()
        or by_student.order_by("-id").first()
    )


# ---------------------------------------------------------------------------
# eligibility + issuing
# ---------------------------------------------------------------------------
def check_eligibility(card, meal_type, when=None, allow_negative=False):
    """
    Read-only check: may this card collect `meal_type` on the date of `when`?
    Returns a payload the scan desk renders directly. Never raises for a
    business 'no' - it returns eligible=False with a code and a reason.

    Wallet-billed students are served even when the wallet is short, as long
    as the balance would not drop below -overdraft_limit() (default -100 KES).
    The parent pays later; the next top-up simply clears the negative balance.
    """
    when = when or timezone.now()
    on_date = timezone.localtime(when).date()
    year = year_for(on_date)
    student = card.student
    block, enrollment = _student_block(student, year)

    result = {
        "found": True, "eligible": False, "code": "", "reason": "",
        "student": block,
        "card_number": card.card_number,
        "meal_type": meal_type, "meal_label": MEAL_LABELS.get(meal_type, meal_type),
        "plan": None, "billing_mode": None, "price": "0.00",
        "wallet_balance": None, "overdraft_limit": None, "on_credit": False,
        "collected_at": None,
    }

    def deny(code, reason):
        result.update(code=code, reason=reason)
        return result

    if meal_type not in MEAL_LABELS:
        return deny("BAD_MEAL", "Unknown meal type.")
    if card.status != models.MealCard.Status.ACTIVE:
        return deny("CARD_" + card.status, f"This card is {card.get_status_display().lower()}.")
    if card.expires_at and card.expires_at < when:
        return deny("CARD_EXPIRED", "This card has expired.")
    if not student.is_active:
        return deny("STUDENT_INACTIVE", "This student is no longer active.")
    if not enrollment:
        return deny("NOT_ENROLLED", "Student has no active enrollment for this academic year.")

    sp = (
        models.StudentMealPlan.objects.filter(
            student=student, academic_year=year, is_active=True, plan__is_active=True
        ).select_related("plan").first()
    )
    if not sp:
        return deny("NO_PLAN", "Student is not on a meal plan.")
    result["plan"] = sp.plan.name
    result["billing_mode"] = sp.plan.billing_mode

    item = sp.plan.items.filter(meal_type=meal_type).first()
    if not item:
        return deny("NOT_IN_PLAN", f"{sp.plan.name} does not include {MEAL_LABELS[meal_type].lower()}.")

    existing = models.MealCollection.objects.filter(student=student, meal_type=meal_type, date=on_date).first()
    if existing:
        result["collected_at"] = existing.collected_at
        local = timezone.localtime(existing.collected_at)
        return deny("ALREADY_COLLECTED", f"Already collected at {local:%H:%M}.")

    price = item.price if sp.plan.billing_mode == models.MealPlan.Billing.WALLET else Decimal("0")
    result["price"] = str(price)
    if price > 0:
        limit = overdraft_limit()
        wallet = models.MealWallet.objects.filter(student=student).first()
        balance = wallet.balance if wallet else Decimal("0")
        result["wallet_balance"] = str(balance)
        result["overdraft_limit"] = str(limit)
        if balance - price < -limit and not allow_negative:
            return deny(
                "LOW_WALLET",
                f"Credit limit reached (wallet KES {balance:,.2f}, meal KES {price:,.2f}, "
                f"up to KES {limit:,.0f} on credit). Send the student to the office.",
            )
        result["on_credit"] = balance < price  # served now, parent pays later

    result["eligible"] = True
    return result


def _locked_wallet(student):
    wallet, _ = models.MealWallet.objects.get_or_create(student=student)
    return models.MealWallet.objects.select_for_update().get(pk=wallet.pk)


@transaction.atomic
def issue_meal(card, meal_type, collected_by, when=None, client_uuid=None,
               source=models.MealCollection.Source.ONLINE, allow_negative=False):
    """
    Records a meal as collected (and charges the wallet if the plan is
    wallet-billed). Returns (collection, created). Safe to call twice with
    the same client_uuid - the second call returns the original row.
    """
    when = when or timezone.now()

    if client_uuid:
        existing = models.MealCollection.objects.filter(client_uuid=client_uuid).first()
        if existing:
            return existing, False

    check = check_eligibility(card, meal_type, when=when, allow_negative=allow_negative)
    if not check["eligible"]:
        raise MealNotAllowed(check)

    price = Decimal(check["price"])
    on_date = timezone.localtime(when).date()

    try:
        with transaction.atomic():
            collection = models.MealCollection.objects.create(
                student=card.student, meal_card=card, meal_type=meal_type, date=on_date,
                collected_at=when, collected_by=collected_by, amount_charged=price,
                source=source, client_uuid=client_uuid,
            )
    except IntegrityError:
        # two scanners raced: the unique (student, meal_type, date) constraint won
        check.update(eligible=False, code="ALREADY_COLLECTED", reason="Already collected.")
        raise MealNotAllowed(check)

    if price > 0:
        wallet = _locked_wallet(card.student)
        # re-check under the row lock; the balance may be negative, but never below the credit limit
        if wallet.balance - price < -overdraft_limit() and not allow_negative:
            transaction.set_rollback(True)
            check.update(eligible=False, code="LOW_WALLET", reason="Credit limit reached. Send the student to the office.")
            raise MealNotAllowed(check)
        wallet.balance -= price
        wallet.save(update_fields=["balance", "updated_at"])
        models.MealWalletTransaction.objects.create(
            wallet=wallet, kind=models.MealWalletTransaction.Kind.MEAL, amount=-price,
            balance_after=wallet.balance, meal_type=meal_type, recorded_by=collected_by,
            reference=f"{meal_type} {on_date}",
        )
    return collection, True


@transaction.atomic
def undo_collection(collection, undone_by):
    """Admin correction: delete the collection and refund the wallet if it was charged."""
    if collection.amount_charged > 0:
        wallet = _locked_wallet(collection.student)
        wallet.balance += collection.amount_charged
        wallet.save(update_fields=["balance", "updated_at"])
        models.MealWalletTransaction.objects.create(
            wallet=wallet, kind=models.MealWalletTransaction.Kind.REFUND, amount=collection.amount_charged,
            balance_after=wallet.balance, meal_type=collection.meal_type, recorded_by=undone_by,
            reference=f"Undo {collection.meal_type} {collection.date}",
        )
    collection.delete()


# ---------------------------------------------------------------------------
# wallet
# ---------------------------------------------------------------------------
@transaction.atomic
def topup_wallet(student, amount, recorded_by, reference=""):
    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValueError("Top-up amount must be greater than zero.")
    wallet = _locked_wallet(student)
    wallet.balance += amount
    wallet.save(update_fields=["balance", "updated_at"])
    models.MealWalletTransaction.objects.create(
        wallet=wallet, kind=models.MealWalletTransaction.Kind.TOPUP, amount=amount,
        balance_after=wallet.balance, reference=reference, recorded_by=recorded_by,
    )
    return wallet


@transaction.atomic
def complete_wallet_payment(payment_id, receipt, success, desc="", paid_amount=None):
    """
    Called by the M-Pesa callback. Safe to call twice: only the first call
    (while the payment is still PENDING) credits the wallet.
    """
    S = models.MealWalletPayment.Status
    payment = models.MealWalletPayment.objects.select_for_update().get(pk=payment_id)
    if payment.status != S.PENDING:
        return payment
    payment.status = S.SUCCESS if success else S.FAILED
    payment.mpesa_receipt = receipt or ""
    payment.result_desc = (desc or "")[:255]
    payment.completed_at = timezone.now()
    if success and paid_amount is not None:
        payment.amount = Decimal(str(paid_amount))
    payment.save()
    if success:
        topup_wallet(payment.student, payment.amount, payment.initiated_by, reference=f"M-Pesa {receipt}")
    return payment


# ---------------------------------------------------------------------------
# offline sync
# ---------------------------------------------------------------------------
def sync_offline(scans, user):
    """
    scans: [{client_uuid, qr_token, meal_type, scanned_at}, ...] saved by the
    cafeteria tablet while it had no internet. The meal was already served,
    so wallet shortfalls are allowed (balance may go negative); every other
    rule (unknown card, already collected, not on plan...) is reported back
    as REJECTED for the office to follow up.
    """
    results = []
    for scan in scans:
        uid = scan.get("client_uuid")
        base = {"client_uuid": uid}
        try:
            when = parse_datetime(scan.get("scanned_at") or "") or timezone.now()
            if timezone.is_naive(when):
                when = timezone.make_aware(when)
            card = resolve_card(scan.get("qr_token"))
            if not card:
                results.append({**base, "status": "REJECTED", "reason": "Unknown card."})
                continue
            _, created = issue_meal(
                card, scan.get("meal_type"), user, when=when, client_uuid=uid,
                source=models.MealCollection.Source.OFFLINE_SYNC, allow_negative=True,
            )
            results.append({**base, "status": "SYNCED" if created else "ALREADY_SYNCED"})
        except MealNotAllowed as exc:
            results.append({
                **base, "status": "REJECTED", "reason": exc.check["reason"],
                "student": exc.check["student"]["name"], "meal": exc.check["meal_label"],
            })
        except Exception as exc:  # noqa: BLE001 - one bad row must not sink the batch
            results.append({**base, "status": "ERROR", "reason": str(exc)})
    return results


def build_roster(on_date):
    """
    Everything a tablet needs to check eligibility with NO internet: each
    entitled student's token, the meals their plan includes, and what they
    have already collected today.
    """
    rows = list(entitled_rows(on_date).prefetch_related("plan__items"))
    student_ids = [r.student_id for r in rows]
    year = year_for(on_date)

    cards = {
        c.student_id: c.qr_token
        for c in models.MealCard.objects.filter(student_id__in=student_ids, status=models.MealCard.Status.ACTIVE)
    }
    classrooms = {
        e.student_id: str(e.classroom)
        for e in api_models.Enrollment.objects.filter(
            student_id__in=student_ids, academic_year=year, status=api_models.Enrollment.Status.ACTIVE
        ).select_related("classroom__grade_level", "classroom__stream", "classroom__academic_year")
    }
    collected = defaultdict(list)
    for sid, meal in models.MealCollection.objects.filter(
        date=on_date, student_id__in=student_ids
    ).values_list("student_id", "meal_type"):
        collected[sid].append(meal)

    entries = []
    for r in rows:
        token = cards.get(r.student_id)
        if not token:
            continue
        entries.append({
            "qr_token": token,
            "name": r.student.user.get_full_name(),
            "admission_no": r.student.admission_no,
            "classroom": classrooms.get(r.student_id),
            "meals": [i.meal_type for i in r.plan.items.all()],
            "collected": collected.get(r.student_id, []),
        })
    return {"date": on_date, "entries": entries}


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------
def dashboard(on_date):
    collected = dict(
        models.MealCollection.objects.filter(date=on_date)
        .values_list("meal_type").annotate(c=Count("id"))
    )
    meals = []
    for meal in models.MEAL_ORDER:
        expected = entitled_rows(on_date, meal).count()
        got = collected.get(meal, 0)
        if not expected and not got:
            continue  # hide meals nobody is on (e.g. no suppers for a day school)
        meals.append({
            "meal_type": meal, "label": MEAL_LABELS[meal],
            "expected": expected, "collected": got, "remaining": max(expected - got, 0),
        })
    revenue = models.MealCollection.objects.filter(date=on_date).aggregate(t=Sum("amount_charged"))["t"] or 0
    return {"date": on_date, "meals": meals, "wallet_revenue": float(revenue)}


def missing_students(on_date, meal_type):
    """Entitled students who have NOT collected `meal_type` on `on_date`."""
    rows = list(entitled_rows(on_date, meal_type))
    got = set(
        models.MealCollection.objects.filter(date=on_date, meal_type=meal_type).values_list("student_id", flat=True)
    )
    year = year_for(on_date)
    classrooms = {
        e.student_id: str(e.classroom)
        for e in api_models.Enrollment.objects.filter(
            student_id__in=[r.student_id for r in rows], academic_year=year,
            status=api_models.Enrollment.Status.ACTIVE,
        ).select_related("classroom__grade_level", "classroom__stream", "classroom__academic_year")
    }
    return [
        {
            "student_id": r.student_id, "admission_no": r.student.admission_no,
            "name": r.student.user.get_full_name(), "classroom": classrooms.get(r.student_id),
            "plan": r.plan.name,
        }
        for r in rows if r.student_id not in got
    ]


def my_meals(student):
    """Student/parent view: own card (with QR), plan, today's meals, wallet, pay info."""
    today = timezone.localdate()
    card = models.MealCard.objects.filter(student=student, status=models.MealCard.Status.ACTIVE).first()
    sp = (
        models.StudentMealPlan.objects.filter(student=student, academic_year=year_for(today), is_active=True)
        .select_related("plan").prefetch_related("plan__items").first()
    )
    wallet = models.MealWallet.objects.filter(student=student).first()
    today_rows = {
        c.meal_type: c.collected_at
        for c in models.MealCollection.objects.filter(student=student, date=today)
    }
    wallet_billed = bool(sp and sp.plan.billing_mode == models.MealPlan.Billing.WALLET)
    return {
        "student": {"name": student.user.get_full_name(), "admission_no": student.admission_no},
        "card": {
            "card_number": card.card_number, "status": card.status,
            "qr_code_base64": qr_base64(card.qr_token),
        } if card else None,
        "plan": {
            "name": sp.plan.name, "billing_mode": sp.plan.billing_mode,
            "meals": [{"meal_type": i.meal_type, "label": MEAL_LABELS[i.meal_type], "price": str(i.price)}
                      for i in sorted(sp.plan.items.all(), key=lambda i: models.MEAL_ORDER.index(i.meal_type))],
        } if sp else None,
        "today": [
            {"meal_type": m, "label": MEAL_LABELS[m], "collected_at": today_rows.get(m)}
            for m in ([i.meal_type for i in sp.plan.items.all()] if sp else [])
        ],
        "wallet_balance": str(wallet.balance) if wallet else ("0.00" if wallet_billed else None),
        "overdraft_limit": str(overdraft_limit()),
        "daily_cost": str(sum((i.price for i in sp.plan.items.all()), Decimal("0"))) if sp else "0",
        "till_number": str(getattr(settings, "MEAL_PAY_TILL", "56353")),
        "transactions": [
            {
                "kind": t.kind, "amount": str(t.amount), "balance_after": str(t.balance_after),
                "meal_type": t.meal_type, "reference": t.reference, "created_at": t.created_at,
            }
            for t in (wallet.transactions.all()[:10] if wallet else [])
        ],
    }