"""
bursaries/services.py - business rules. Views stay thin and call these.

Money is only ever moved through the core ledger helpers in api.services
(recalculate_student_invoice_chain, _allocate_payment, correct_receipt), so the
student portal, receipts, clearance and finance reports keep agreeing.
"""
import re
from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Count, F, Sum
from django.utils import timezone

from api import models as core
from api import services as core_services

from . import models

ZERO = Decimal("0")
A = models.Award.Status
T = models.AwardTerm.Status
WAIVER = models.AidScheme.Settlement.WAIVER
FUNDER = models.AidScheme.Settlement.FUNDER_REMITS
LIVE_AWARD_STATUSES = (A.PENDING, A.APPROVED, A.SUSPENDED)


def money(x):
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def log(award, action, user=None, detail=""):
    models.AidAuditLog.objects.create(award=award, action=action, detail=detail[:255], performed_by=user)


# ---------------------------------------------------------------------------
# amounts and term scope
# ---------------------------------------------------------------------------
def raw_amount(award, gross):
    amt = gross * award.value / Decimal("100") if award.value_type == models.ValueType.PERCENT else award.value
    return money(min(max(amt, ZERO), gross))


def terms_in_scope(award, only_started=True):
    qs = core.Term.objects.filter(start_date__gte=award.start_term.start_date)
    if award.end_term_id:
        qs = qs.filter(start_date__lte=award.end_term.start_date)
    if only_started:
        qs = qs.filter(start_date__lte=timezone.localdate())
    return qs.order_by("start_date")


def _nth_term(start_term, n):
    """The term that is n terms long counting start_term as the first, or None if not set up yet."""
    terms = list(core.Term.objects.order_by("academic_year__year", "term_number"))
    idx = next((i for i, t in enumerate(terms) if t.id == start_term.id), None)
    if idx is None or idx + n - 1 >= len(terms):
        return None
    return terms[idx + n - 1]


def _grade_allowed(scheme, grade_level_id):
    ids = set(scheme.grade_levels.values_list("id", flat=True))
    return not ids or grade_level_id in ids


# ---------------------------------------------------------------------------
# creating and deciding awards
# ---------------------------------------------------------------------------
@transaction.atomic
def create_award(*, student, scheme, start_term, user, value=None, value_type=None, end_term=None,
                 reference_no="", notes="", staff_parent=None, sibling_rank=None, auto_approve=False):
    if not scheme.is_active:
        raise ValueError("This scheme is switched off.")
    if not student.is_active:
        raise ValueError(f"{student.admission_no} is not an active student.")
    if models.Award.objects.filter(student=student, scheme=scheme, status__in=LIVE_AWARD_STATUSES).exists():
        raise ValueError(f"{student.admission_no} already has a live award under {scheme.name}.")

    vt = value_type or scheme.value_type
    val = Decimal(str(value)) if value not in (None, "") else scheme.value
    if val <= 0:
        raise ValueError("The award value must be greater than zero.")
    if vt == models.ValueType.PERCENT and val > 100:
        raise ValueError("A percentage cannot be more than 100.")

    if end_term is None and scheme.default_duration_terms:
        end_term = _nth_term(start_term, scheme.default_duration_terms)
    if end_term and end_term.start_date < start_term.start_date:
        raise ValueError("The end term cannot be before the start term.")

    award = models.Award.objects.create(
        student=student, scheme=scheme, value_type=vt, value=val, start_term=start_term, end_term=end_term,
        reference_no=reference_no, notes=notes, staff_parent=staff_parent, sibling_rank=sibling_rank,
        requested_by=user,
    )
    log(award, "REQUESTED", user, f"{scheme.name}: {val}{'%' if vt == models.ValueType.PERCENT else ' KES'}")
    if auto_approve:
        award = approve_award(award, user, system=True)
    return award


@transaction.atomic
def approve_award(award, user, system=False):
    award = models.Award.objects.select_for_update().get(pk=award.pk)
    if award.status != A.PENDING:
        raise ValueError("Only pending awards can be approved.")
    if not system and award.requested_by_id == user.id and not getattr(user, "is_super_admin", False):
        raise ValueError("You requested this award, so someone else needs to approve it.")
    award.status = A.APPROVED
    award.decided_by, award.decided_at = user, timezone.now()
    award.save(update_fields=["status", "decided_by", "decided_at"])
    log(award, "APPROVED", user, "Auto-approved by scheme" if system else "")
    apply_all(award=award)
    return models.Award.objects.get(pk=award.pk)


@transaction.atomic
def reject_award(award, user, reason):
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("Please give a reason for rejecting this award.")
    if award.status != A.PENDING:
        raise ValueError("Only pending awards can be rejected.")
    award.status = A.REJECTED
    award.decision_note = reason[:255]
    award.decided_by, award.decided_at = user, timezone.now()
    award.save(update_fields=["status", "decision_note", "decided_by", "decided_at"])
    log(award, "REJECTED", user, reason)
    return award


@transaction.atomic
def set_suspended(award, user, suspend):
    if suspend and award.status != A.APPROVED:
        raise ValueError("Only approved awards can be suspended.")
    if not suspend and award.status != A.SUSPENDED:
        raise ValueError("Only suspended awards can be resumed.")
    award.status = A.SUSPENDED if suspend else A.APPROVED
    award.save(update_fields=["status"])
    log(award, "SUSPENDED" if suspend else "RESUMED", user)
    if not suspend:
        apply_all(award=award)
    return award


# ---------------------------------------------------------------------------
# applying awards to invoices
# ---------------------------------------------------------------------------
@transaction.atomic
def apply_awards_to_invoice(invoice):
    """
    Apply every approved, not-yet-applied award that covers this invoice's term.
    WAIVER awards reduce the invoice's term charge; FUNDER_REMITS awards only record
    the pledge. Safe to call repeatedly: an award is applied once per term.
    """
    invoice = core.Invoice.objects.select_for_update().get(pk=invoice.pk)
    student = invoice.enrollment.student
    term = invoice.fee_structure.term
    grade_id = invoice.enrollment.classroom.grade_level_id

    awards = [
        a for a in models.Award.objects.filter(student=student, status=A.APPROVED, scheme__is_active=True)
        .select_related("scheme", "start_term", "end_term")
        if a.start_term.start_date <= term.start_date
        and (a.end_term_id is None or term.start_date <= a.end_term.start_date)
        and not a.terms.filter(term=term).exists()
    ]
    if not awards:
        return []

    active = models.AwardTerm.objects.filter(invoice=invoice, status=T.ACTIVE)
    existing_total = active.aggregate(t=Sum("amount"))["t"] or ZERO
    existing_waived = active.filter(settlement=WAIVER).aggregate(t=Sum("amount"))["t"] or ZERO
    gross = invoice.term_charge + existing_waived          # the fee before any school-funded discount
    if gross <= 0:
        return []

    cfg = models.AidSettings.load()
    waiver_cap = money(gross * cfg.max_discount_percent / Decimal("100")) - existing_waived
    room = gross - existing_total
    results = []

    def record(award, amount, status, note=""):
        entry = models.AwardTerm.objects.create(
            award=award, term=term, invoice=invoice, gross_fee=gross, amount=amount,
            settlement=award.scheme.settlement, status=status, note=note[:255],
        )
        results.append(entry)

    candidates = []
    for a in sorted(awards, key=lambda x: (x.scheme.priority, x.id)):
        if _grade_allowed(a.scheme, grade_id):
            candidates.append((a, raw_amount(a, gross)))
        else:
            record(a, ZERO, T.SKIPPED, "This scheme is not offered for this grade.")

    winners = {a.id for a, _ in candidates}
    if any(not a.scheme.stackable for a, _ in candidates):
        # a non-stackable scheme is present: only the single largest award is used
        winners = {max(candidates, key=lambda c: c[1])[0].id} if existing_total == 0 else set()

    waived_now = ZERO
    for a, amt in candidates:
        if a.id not in winners:
            record(a, ZERO, T.SKIPPED, "Not stackable with other aid on this invoice.")
            continue
        amt = min(amt, room)
        if a.scheme.settlement == WAIVER:
            amt = min(amt, waiver_cap - waived_now)
        budget = a.scheme.budget_per_year
        if budget is not None:
            used = models.AwardTerm.objects.filter(
                award__scheme=a.scheme, term__academic_year=term.academic_year, status=T.ACTIVE
            ).aggregate(t=Sum("amount"))["t"] or ZERO
            if used + amt > budget:
                record(a, ZERO, T.SKIPPED, "The scheme's budget for this year is used up.")
                continue
        if amt <= 0:
            record(a, ZERO, T.SKIPPED, "Nothing left to cover: the fee is already covered or the discount cap is reached.")
            continue
        record(a, amt, T.ACTIVE)
        room -= amt
        if a.scheme.settlement == WAIVER:
            waived_now += amt

    if waived_now > 0:
        invoice.amount_due -= waived_now
        invoice.save(update_fields=["amount_due"])
        core_services.recalculate_student_invoice_chain(student)   # carries the change into later terms

    for e in results:
        if e.status == T.ACTIVE:
            log(e.award, "APPLIED", None, f"{term}: KES {e.amount:,.2f} ({e.get_settlement_display()})")
    return results


def apply_all(award=None):
    """
    Find every (approved award x started term) that has no AwardTerm yet and apply it.
    Run daily by the `apply_awards` command, and straight away when an award is approved.
    """
    awards = models.Award.objects.filter(status=A.APPROVED, scheme__is_active=True).select_related(
        "student", "start_term", "end_term"
    )
    if award is not None:
        awards = awards.filter(pk=award.pk)

    invoice_ids = set()
    for a in awards:
        for term in terms_in_scope(a):
            if a.terms.filter(term=term).exists():
                continue
            inv = core.Invoice.objects.filter(enrollment__student=a.student, fee_structure__term=term).first()
            if inv:
                invoice_ids.add(inv.id)

    applied = sum(len(apply_awards_to_invoice(inv)) for inv in core.Invoice.objects.filter(id__in=invoice_ids))

    today = timezone.localdate()
    ended = 0
    for a in awards.filter(end_term__isnull=False):
        if a.end_term.end_date < today:
            a.status = A.ENDED
            a.save(update_fields=["status"])
            log(a, "ENDED", None, "End term has finished")
            ended += 1
    return {"invoices_processed": len(invoice_ids), "entries_created": applied, "awards_ended": ended}


@transaction.atomic
def reapply(award, user):
    """Forget 'skipped' entries (e.g. after raising a scheme's budget) and try again."""
    if award.status != A.APPROVED:
        raise ValueError("Only approved awards can be re-applied.")
    award.terms.filter(status=T.SKIPPED).delete()
    log(award, "REAPPLIED", user)
    return apply_all(award=award)


@transaction.atomic
def reverse_award_term(entry, user, reason):
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("Please give the reason for reversing this.")
    entry = models.AwardTerm.objects.select_for_update().get(pk=entry.pk)
    if entry.status != T.ACTIVE:
        raise ValueError("Only applied entries can be reversed.")
    if entry.received > 0:
        raise ValueError("Money has already been received against this entry. Reverse those allocations first.")
    if entry.settlement == WAIVER and entry.invoice_id:
        invoice = core.Invoice.objects.select_for_update().get(pk=entry.invoice_id)
        invoice.amount_due += entry.amount
        invoice.save(update_fields=["amount_due"])
        core_services.recalculate_student_invoice_chain(invoice.enrollment.student)
    entry.status = T.REVERSED
    entry.note = f"Reversed: {reason}"[:255]
    entry.save(update_fields=["status", "note"])
    log(entry.award, "REVERSED", user, f"{entry.term}: KES {entry.amount:,.2f} - {reason}")
    return entry


# ---------------------------------------------------------------------------
# finding eligible students (sibling / staff-child)
# ---------------------------------------------------------------------------
def _active_students():
    return core.StudentProfile.objects.filter(
        is_active=True,
        enrollments__academic_year__is_current=True,
        enrollments__status=core.Enrollment.Status.ACTIVE,
    ).distinct()


def _already_awarded(scheme):
    return set(models.Award.objects.filter(scheme=scheme, status__in=LIVE_AWARD_STATUSES)
               .values_list("student_id", flat=True))


def sibling_candidates(scheme):
    """
    Families = active students who share a guardian (directly or through a chain of
    guardians). Eldest is rank 1 and pays full; each younger child gets the tier for
    their rank from scheme.sibling_tiers.
    """
    active = {s.id: s for s in _active_students().select_related("user")}
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    by_guardian = defaultdict(list)
    for guardian_id, student_id in core.ParentStudentLink.objects.filter(
        student_id__in=list(active)
    ).values_list("parent_id", "student_id"):
        by_guardian[guardian_id].append(student_id)
    for ids in by_guardian.values():
        for other in ids[1:]:
            parent[find(other)] = find(ids[0])

    families = defaultdict(list)
    for sid in {s for ids in by_guardian.values() for s in ids}:
        families[find(sid)].append(active[sid])

    tiers = sorted(scheme.sibling_tiers or [], key=lambda t: int(t["rank"]))
    skip = _already_awarded(scheme)
    out = []
    for family in families.values():
        if len(family) < 2:
            continue
        family.sort(key=lambda s: (s.date_of_birth or date.max, len(s.admission_no), s.admission_no))
        for rank, s in enumerate(family, start=1):
            percent = None
            for t in tiers:
                if int(t["rank"]) <= rank:
                    percent = Decimal(str(t["percent"]))
            if rank < 2 or percent is None or s.id in skip:
                continue
            enrollment = s.current_enrollment
            out.append({
                "student_id": s.id, "admission_no": s.admission_no, "name": s.user.get_full_name(),
                "classroom": str(enrollment.classroom) if enrollment else "-",
                "rank": rank, "family_size": len(family), "percent": float(percent),
                "siblings": [x.user.get_full_name() for x in family if x.id != s.id],
            })
    return sorted(out, key=lambda r: (r["name"]))


def _phone_key(phone):
    digits = re.sub(r"\D", "", phone or "")
    return digits[-9:] if len(digits) >= 9 else ""


def staff_child_candidates(scheme):
    """
    SUGGESTIONS only: a guardian whose phone number matches a staff member's. A person
    must confirm each one, because a shared phone number is not proof of parenthood.
    """
    staff = core.User.objects.filter(is_active_staff=True, is_active=True).exclude(
        role__in=[core.User.Role.STUDENT, core.User.Role.PARENT]
    ).exclude(phone_number="")
    by_phone = {}
    for u in staff:
        key = _phone_key(u.phone_number)
        if key:
            by_phone.setdefault(key, u)

    skip = _already_awarded(scheme)
    seen, out = set(), []
    links = core.ParentStudentLink.objects.filter(
        student__in=_active_students()
    ).select_related("parent__user", "student__user")
    for link in links:
        staff_user = by_phone.get(_phone_key(link.parent.user.phone_number))
        sid = link.student_id
        if not staff_user or sid in seen or sid in skip:
            continue
        seen.add(sid)
        enrollment = link.student.current_enrollment
        out.append({
            "student_id": sid, "admission_no": link.student.admission_no,
            "name": link.student.user.get_full_name(),
            "classroom": str(enrollment.classroom) if enrollment else "-",
            "staff_user_id": str(staff_user.id), "staff_name": staff_user.get_full_name() or staff_user.username,
            "staff_role": staff_user.get_role_display(), "guardian_name": link.parent.user.get_full_name(),
            "percent": float(scheme.value) if scheme.value_type == models.ValueType.PERCENT else None,
        })
    return sorted(out, key=lambda r: r["name"])


def find_candidates(scheme):
    if scheme.rule == models.AidScheme.Rule.SIBLING:
        return sibling_candidates(scheme)
    if scheme.rule == models.AidScheme.Rule.STAFF_CHILD:
        return staff_child_candidates(scheme)
    raise ValueError("This scheme is awarded case by case, so there is nothing to detect automatically.")


def create_from_candidates(scheme, start_term, student_ids, user):
    """Re-derives candidates on the server (never trusts the browser's numbers), then creates awards."""
    wanted = {int(i) for i in student_ids}
    created, errors = [], []
    for c in find_candidates(scheme):
        if c["student_id"] not in wanted:
            continue
        student = core.StudentProfile.objects.get(pk=c["student_id"])
        try:
            kwargs = {}
            if scheme.rule == models.AidScheme.Rule.SIBLING:
                kwargs = dict(value=c["percent"], value_type=models.ValueType.PERCENT, sibling_rank=c["rank"])
            else:
                kwargs = dict(staff_parent=core.User.objects.get(pk=c["staff_user_id"]))
            created.append(create_award(
                student=student, scheme=scheme, start_term=start_term, user=user,
                auto_approve=scheme.auto_approve, **kwargs,
            ))
        except ValueError as exc:
            errors.append({"admission_no": student.admission_no, "error": str(exc)})
    return created, errors


# ---------------------------------------------------------------------------
# funder money
# ---------------------------------------------------------------------------
def open_entries_for_source(source):
    return models.AwardTerm.objects.filter(
        status=T.ACTIVE, settlement=FUNDER, award__scheme__source=source, amount__gt=F("received"),
    ).select_related("award__student__user", "award__scheme", "term__academic_year").order_by(
        "term__start_date", "award__student__admission_no"
    )


@transaction.atomic
def allocate_remittance(remittance, rows, user):
    """rows: [{"award_term": id, "amount": x}]. Each row posts a BURSARY Payment with its own receipt."""
    remittance = models.FundingRemittance.objects.select_for_update().get(pk=remittance.pk)
    if not rows:
        raise ValueError("Enter an amount for at least one student.")
    total = sum((money(r["amount"]) for r in rows), ZERO)
    if total > remittance.unallocated:
        raise ValueError(f"You are allocating KES {total:,.2f} but only KES {remittance.unallocated:,.2f} is unallocated.")

    created = []
    for r in rows:
        amt = money(r["amount"])
        if amt <= 0:
            raise ValueError("Amounts must be greater than zero.")
        entry = models.AwardTerm.objects.select_for_update().get(pk=r["award_term"])
        student = entry.award.student
        if entry.status != T.ACTIVE or entry.settlement != FUNDER:
            raise ValueError(f"{student.admission_no}: this entry is not waiting on a funder.")
        if entry.award.scheme.source_id != remittance.source_id:
            raise ValueError(f"{student.admission_no}: this award belongs to a different funder.")
        if amt > entry.outstanding:
            raise ValueError(f"{student.admission_no}: only KES {entry.outstanding:,.2f} is still expected for {entry.term}.")
        try:
            payments = core_services._allocate_payment(
                student, amt, "BURSARY", (remittance.reference or f"REM-{remittance.id}")[:60], user,
                core_services.generate_receipt_no(),
            )
        except ValueError as exc:
            raise ValueError(f"{student.admission_no}: {exc}")
        created.append(models.RemittanceAllocation.objects.create(
            remittance=remittance, award_term=entry, amount=amt, receipt_no=payments[0].receipt_no, created_by=user,
        ))
        models.AwardTerm.objects.filter(pk=entry.pk).update(received=F("received") + amt)
        log(entry.award, "FUNDS_RECEIVED", user, f"KES {amt:,.2f} receipt {payments[0].receipt_no}")
    return created


@transaction.atomic
def reverse_allocation(allocation, user, reason):
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("Please give the reason for reversing this allocation.")
    allocation = models.RemittanceAllocation.objects.select_for_update().get(pk=allocation.pk)
    if allocation.reversed:
        raise ValueError("This allocation has already been reversed.")
    core_services.correct_receipt(allocation.receipt_no, user, f"Bursary allocation reversed: {reason}", void=True)
    models.AwardTerm.objects.filter(pk=allocation.award_term_id).update(received=F("received") - allocation.amount)
    allocation.reversed, allocation.reversed_at = True, timezone.now()
    allocation.reversed_by, allocation.reverse_reason = user, reason[:255]
    allocation.save(update_fields=["reversed", "reversed_at", "reversed_by", "reverse_reason"])
    log(allocation.award_term.award, "ALLOCATION_REVERSED", user, f"{allocation.receipt_no}: {reason}")
    return allocation


def pledged_outstanding_bulk(student_ids):
    """
    {student_id: KES still expected from funders}. Use it to avoid treating a pledged
    bursary as 'owing' at the gate (see the optional gatepass patch in the README).
    """
    rows = models.AwardTerm.objects.filter(
        status=T.ACTIVE, settlement=FUNDER, award__student_id__in=list(student_ids),
    ).values("award__student_id").annotate(t=Sum(F("amount") - F("received")))
    return {r["award__student_id"]: r["t"] or ZERO for r in rows}


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------
def dashboard(academic_year=None):
    year = academic_year or core.AcademicYear.objects.filter(is_current=True).first()
    entries = models.AwardTerm.objects.filter(status=T.ACTIVE)
    if year:
        entries = entries.filter(term__academic_year=year)

    def total(qs, field="amount"):
        return float(qs.aggregate(t=Sum(field))["t"] or 0)

    funder = entries.filter(settlement=FUNDER)
    by_scheme = entries.values("award__scheme_id", "award__scheme__name", "award__scheme__kind").annotate(
        students=Count("award__student", distinct=True), amount=Sum("amount"), received=Sum("received"),
    ).order_by("-amount")
    by_source = funder.values(
        "award__scheme__source_id", "award__scheme__source__name", "award__scheme__source__source_type"
    ).annotate(pledged=Sum("amount"), received=Sum("received")).order_by("-pledged")

    remittances = models.FundingRemittance.objects.select_related("source")
    unallocated = sum((r.unallocated for r in remittances), ZERO)
    status_counts = dict(models.Award.objects.values_list("status").annotate(c=Count("id")))

    return {
        "academic_year": year.year if year else None,
        "awards_by_status": status_counts,
        "waived_total": total(entries.filter(settlement=WAIVER)),
        "pledged_total": total(funder),
        "received_total": total(funder, "received"),
        "receivable_total": total(funder) - total(funder, "received"),
        "unallocated_remittances": float(unallocated),
        "students_supported": entries.values("award__student").distinct().count(),
        "by_scheme": [
            {"scheme_id": r["award__scheme_id"], "scheme": r["award__scheme__name"], "kind": r["award__scheme__kind"],
             "students": r["students"], "amount": float(r["amount"] or 0), "received": float(r["received"] or 0)}
            for r in by_scheme
        ],
        "by_source": [
            {"source_id": r["award__scheme__source_id"], "source": r["award__scheme__source__name"],
             "type": r["award__scheme__source__source_type"], "pledged": float(r["pledged"] or 0),
             "received": float(r["received"] or 0), "outstanding": float((r["pledged"] or 0) - (r["received"] or 0))}
            for r in by_source
        ],
    }