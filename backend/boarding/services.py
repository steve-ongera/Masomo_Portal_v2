"""
Boarding business rules. Views stay thin and call these functions.
Every rule violation raises BoardingError (an HTTP 400 with {"detail": ...}).
"""
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone
from rest_framework.exceptions import APIException

from api import models as api_models

from .models import (
    Bed, BedAllocation, BoardingFeeBilling, BoardingFeeRate, BoardingRegistration, BoardingSettings,
    Dormitory, ExeatRequest, Room, RollCallEntry, RollCallSession,
)

Reg = BoardingRegistration
Alloc = BedAllocation
Reason = BedAllocation.ReleaseReason
ExStatus = ExeatRequest.Status


class BoardingError(APIException):
    status_code = 400
    default_detail = "Invalid boarding request."
    default_code = "boarding_error"


class _DryRunRollback(Exception):
    """Raised on purpose to roll a dry run back."""


# ---------------------------------------------------------------------------
# small lookups
# ---------------------------------------------------------------------------
def current_year():
    return api_models.AcademicYear.objects.filter(is_current=True).first()


def current_term():
    return api_models.Term.objects.filter(is_current=True).first()


def require_year(year_id=None):
    if year_id:
        year = api_models.AcademicYear.objects.filter(pk=year_id).first()
        if not year:
            raise BoardingError("Academic year not found.")
        return year
    year = current_year()
    if not year:
        raise BoardingError("No current academic year is set.")
    return year


def get_settings():
    school = api_models.School.objects.first()
    if not school:
        raise BoardingError("No school record exists yet.")
    obj, _ = BoardingSettings.objects.get_or_create(school=school)
    return obj


def student_name(student):
    return student.user.get_full_name() or student.user.username


def current_allocation(registration):
    return (
        Alloc.objects.filter(registration=registration, released_at__isnull=True)
        .select_related("bed__room__dormitory")
        .first()
    )


def _enrollment_for(student, year):
    return (
        api_models.Enrollment.objects.filter(student=student, academic_year=year)
        .select_related("classroom__grade_level", "classroom__stream")
        .first()
    )


def _grade_eligible(enrollment, cfg):
    ids = set(cfg.boarding_grades.values_list("pk", flat=True))
    if not ids:
        return True
    return enrollment.classroom.grade_level_id in ids


# ---------------------------------------------------------------------------
# structure
# ---------------------------------------------------------------------------
def dormitory_counts(dorm):
    beds = Bed.objects.filter(room__dormitory=dorm, is_active=True, room__is_active=True)
    total = beds.count()
    occupied = Alloc.objects.filter(
        bed__in=beds, released_at__isnull=True
    ).count()
    return {
        "room_count": dorm.rooms.count(),
        "bed_count": total,
        "occupied_count": occupied,
        "vacant_count": max(total - occupied, 0),
    }


def _next_bed_numbers(room, count):
    existing = set(room.beds.values_list("number", flat=True))
    out, n = [], 1
    while len(out) < count:
        if str(n) not in existing:
            out.append(str(n))
        n += 1
    return out


@transaction.atomic
def generate_rooms(dorm, room_numbers, beds_per_room, floor=""):
    """Create rooms (and their beds). Existing rooms are topped up to beds_per_room."""
    if not 1 <= beds_per_room <= 60:
        raise BoardingError("Beds per room must be between 1 and 60.")
    numbers = [str(n).strip() for n in room_numbers if str(n).strip()]
    if not numbers:
        raise BoardingError("Give at least one room number.")
    if len(numbers) > 500:
        raise BoardingError("Too many rooms in one go (max 500).")
    created_rooms = created_beds = 0
    for num in dict.fromkeys(numbers):  # de-duplicate, keep order
        room, made = Room.objects.get_or_create(dormitory=dorm, number=num, defaults={"floor": floor})
        created_rooms += int(made)
        have = room.beds.count()
        if have < beds_per_room:
            for bn in _next_bed_numbers(room, beds_per_room - have):
                Bed.objects.create(room=room, number=bn)
                created_beds += 1
    return {"rooms_created": created_rooms, "beds_created": created_beds}


@transaction.atomic
def add_beds(room, count):
    if not 1 <= count <= 60:
        raise BoardingError("Add between 1 and 60 beds at a time.")
    nums = _next_bed_numbers(room, count)
    Bed.objects.bulk_create([Bed(room=room, number=n) for n in nums])
    return nums


# ---------------------------------------------------------------------------
# registration (who is a boarder this year)
# ---------------------------------------------------------------------------
def register_student(student, academic_year, by=None, enforce_grade=True):
    """Returns (registration, created)."""
    if not student.is_active:
        raise BoardingError(f"{student.admission_no} is not an active student.")
    enr = _enrollment_for(student, academic_year)
    if not enr:
        raise BoardingError(f"{student.admission_no} is not enrolled in {academic_year}.")
    if enr.status != api_models.Enrollment.Status.ACTIVE:
        raise BoardingError(f"{student.admission_no}'s enrollment for {academic_year} is {enr.get_status_display()}.")
    if enforce_grade and not _grade_eligible(enr, get_settings()):
        raise BoardingError(f"{enr.classroom.grade_level.name} does not board at this school.")

    snap = {
        "enrollment": enr,
        "grade_name": enr.classroom.grade_level.name,
        "class_name": str(enr.classroom),
    }
    reg, created = Reg.objects.get_or_create(
        student=student, academic_year=academic_year, defaults={**snap, "registered_by": by}
    )
    if not created and reg.status == Reg.Status.WITHDRAWN:
        for k, v in snap.items():
            setattr(reg, k, v)
        reg.status = Reg.Status.REGISTERED
        reg.withdrawn_at = None
        reg.withdrawn_reason = ""
        reg.registered_by = by
        reg.registered_at = timezone.now()
        reg.save()
        created = True
    return reg, created


@transaction.atomic
def register_classroom(classroom, by=None):
    cfg = get_settings()
    out = {"registered": 0, "already_registered": 0, "skipped": []}
    enrs = classroom.enrollments.filter(status=api_models.Enrollment.Status.ACTIVE).select_related(
        "student__user", "classroom__grade_level"
    )
    if not _grade_eligible_for_classroom(classroom, cfg):
        raise BoardingError(f"{classroom.grade_level.name} does not board at this school.")
    for enr in enrs:
        try:
            _, created = register_student(enr.student, classroom.academic_year, by)
        except BoardingError as exc:
            out["skipped"].append({"admission_no": enr.student.admission_no, "reason": str(exc.detail)})
            continue
        out["registered" if created else "already_registered"] += 1
    return out


def _grade_eligible_for_classroom(classroom, cfg):
    ids = set(cfg.boarding_grades.values_list("pk", flat=True))
    return not ids or classroom.grade_level_id in ids


@transaction.atomic
def withdraw_registration(reg, by=None, reason=""):
    if reg.status == Reg.Status.WITHDRAWN:
        raise BoardingError("This student is already withdrawn from boarding.")
    alloc = current_allocation(reg)
    if alloc:
        release_allocation(alloc, by, Reason.WITHDRAWN, reason)
    reg.status = Reg.Status.WITHDRAWN
    reg.withdrawn_at = timezone.now()
    reg.withdrawn_reason = (reason or "")[:255]
    reg.save(update_fields=["status", "withdrawn_at", "withdrawn_reason"])
    return reg


# ---------------------------------------------------------------------------
# bed allocation
# ---------------------------------------------------------------------------
def _assert_bed_usable(bed):
    if not bed.is_active:
        raise BoardingError(f"{bed.label} is out of service.")
    if not bed.room.is_active:
        raise BoardingError(f"Room {bed.room.number} is not in use.")
    if not bed.room.dormitory.is_active:
        raise BoardingError(f"{bed.room.dormitory.name} is not in use.")


def allocate_bed(registration, bed, by=None, notes="", carried_over=False):
    with transaction.atomic():
        bed = Bed.objects.select_for_update().get(pk=bed.pk)
        registration = Reg.objects.select_for_update().get(pk=registration.pk)
        if registration.status != Reg.Status.REGISTERED:
            raise BoardingError("This student is not registered as a boarder.")
        _assert_bed_usable(bed)
        dorm = bed.room.dormitory
        if registration.student.gender != dorm.gender:
            raise BoardingError(
                f"{dorm.name} is a {dorm.get_gender_display().lower()}' hostel; "
                f"{registration.student.admission_no} cannot be placed there."
            )
        holder = (
            Alloc.objects.filter(bed=bed, released_at__isnull=True)
            .select_related("registration__student__user", "registration__academic_year")
            .first()
        )
        if holder:
            hint = ""
            if holder.registration.academic_year_id != registration.academic_year_id:
                hint = f" (held since {holder.registration.academic_year} - run Year Rollover to free old beds)"
            raise BoardingError(
                f"{bed.label} is already occupied by {holder.registration.student.admission_no}{hint}."
            )
        if Alloc.objects.filter(registration=registration, released_at__isnull=True).exists():
            raise BoardingError("This student already has a bed. Use transfer to move them.")
        try:
            with transaction.atomic():
                return Alloc.objects.create(
                    registration=registration, bed=bed, bed_label=bed.label,
                    notes=(notes or "")[:255], carried_over=carried_over, allocated_by=by,
                )
        except IntegrityError:
            raise BoardingError("That bed was just taken by someone else. Pick another bed.")


def release_allocation(alloc, by=None, reason=Reason.OTHER, notes=""):
    if alloc.released_at is not None:
        raise BoardingError("This bed allocation is already closed.")
    if reason not in Reason.values:
        reason = Reason.OTHER
    alloc.released_at = timezone.now()
    alloc.release_reason = reason
    alloc.released_by = by
    if notes:
        alloc.notes = (notes or "")[:255]
    alloc.save(update_fields=["released_at", "release_reason", "released_by", "notes"])
    return alloc


@transaction.atomic
def transfer_student(registration, new_bed, by=None, notes=""):
    old = current_allocation(registration)
    if not old:
        raise BoardingError("This student has no current bed. Allocate one instead.")
    if old.bed_id == new_bed.pk:
        raise BoardingError("The student is already in that bed.")
    release_allocation(old, by, Reason.TRANSFER, notes)
    return allocate_bed(registration, new_bed, by, notes)


def vacant_beds(dorm):
    return (
        Bed.objects.filter(room__dormitory=dorm, is_active=True, room__is_active=True)
        .exclude(allocations__released_at__isnull=True)
        .select_related("room__dormitory")
        .order_by("room__number", "number")
    )


@transaction.atomic
def auto_allocate(dorm, by=None, grade_level=None, academic_year=None):
    """Fill vacant beds of `dorm` with unplaced boarders of the matching gender."""
    year = academic_year or require_year()
    has_bed = Alloc.objects.filter(registration=OuterRef("pk"), released_at__isnull=True)
    regs = (
        Reg.objects.filter(academic_year=year, status=Reg.Status.REGISTERED, student__gender=dorm.gender)
        .annotate(has_bed=Exists(has_bed))
        .filter(has_bed=False)
        .select_related("student__user", "enrollment__classroom")
    )
    if grade_level:
        regs = regs.filter(enrollment__classroom__grade_level=grade_level)
    regs = sorted(regs, key=lambda r: (r.grade_name, r.class_name, r.student.admission_no))
    beds = list(vacant_beds(dorm))
    placed = 0
    for reg, bed in zip(regs, beds):
        allocate_bed(reg, bed, by, "Auto-allocated")
        placed += 1
    return {
        "allocated": placed,
        "still_unplaced": max(len(regs) - placed, 0),
        "beds_left": max(len(beds) - placed, 0),
    }


# ---------------------------------------------------------------------------
# year rollover - keeps history, frees beds of leavers, carries returners
# ---------------------------------------------------------------------------
def rollover_year(from_year, to_year, by=None, keep_beds=True, dry_run=True):
    if from_year.pk == to_year.pk or to_year.year <= from_year.year:
        raise BoardingError("The target year must be later than the source year.")
    cfg = get_settings()
    report = {
        "dry_run": dry_run, "carried": [], "released": [], "candidates_not_registered": 0,
        "carried_count": 0, "released_count": 0,
    }
    try:
        with transaction.atomic():
            regs = (
                Reg.objects.filter(academic_year=from_year, status=Reg.Status.REGISTERED)
                .select_related("student__user")
                .order_by("student__admission_no")
            )
            for reg in regs:
                student = reg.student
                alloc = current_allocation(reg)
                old_enr = reg.enrollment
                new_enr = _enrollment_for(student, to_year)
                if new_enr and new_enr.status != api_models.Enrollment.Status.ACTIVE:
                    new_enr = None

                row = {
                    "admission_no": student.admission_no, "name": student_name(student),
                    "bed": alloc.bed_label if alloc else None,
                }
                if new_enr is None:
                    graduated = bool(old_enr and old_enr.status == api_models.Enrollment.Status.GRADUATED)
                    reason = Reason.GRADUATED if graduated else Reason.NOT_RETURNING
                    if alloc:
                        release_allocation(alloc, by, reason, f"Rollover {from_year} -> {to_year}")
                    row["reason"] = reason
                    report["released"].append(row)
                    continue
                if not _grade_eligible(new_enr, cfg):
                    if alloc:
                        release_allocation(alloc, by, Reason.NOT_BOARDING_GRADE, f"Rollover {from_year} -> {to_year}")
                    row["reason"] = Reason.NOT_BOARDING_GRADE
                    report["released"].append(row)
                    continue

                new_reg, _ = register_student(student, to_year, by)
                row["grade"] = new_reg.grade_name
                if alloc:
                    bed = alloc.bed
                    release_allocation(alloc, by, Reason.YEAR_END, f"Rollover {from_year} -> {to_year}")
                    if keep_beds:
                        try:
                            _assert_bed_usable(bed)
                            if not Alloc.objects.filter(registration=new_reg, released_at__isnull=True).exists():
                                allocate_bed(new_reg, bed, by, f"Carried over from {from_year}", carried_over=True)
                                row["kept_bed"] = True
                        except BoardingError as exc:
                            row["kept_bed"] = False
                            row["note"] = str(exc.detail)
                report["carried"].append(row)

            registered_ids = Reg.objects.filter(academic_year=to_year).values_list("student_id", flat=True)
            ids = set(cfg.boarding_grades.values_list("pk", flat=True))
            cand = api_models.Enrollment.objects.filter(
                academic_year=to_year, status=api_models.Enrollment.Status.ACTIVE
            ).exclude(student_id__in=registered_ids)
            if ids:
                cand = cand.filter(classroom__grade_level_id__in=ids)
            report["candidates_not_registered"] = cand.count()
            report["carried_count"] = len(report["carried"])
            report["released_count"] = len(report["released"])
            if dry_run:
                raise _DryRunRollback()
    except _DryRunRollback:
        pass
    return report


# ---------------------------------------------------------------------------
# exeat / leave-out
# ---------------------------------------------------------------------------
OPEN_EXEAT = (ExStatus.PENDING, ExStatus.APPROVED, ExStatus.OUT)


def _needs_principal(exeat, cfg=None):
    cfg = cfg or get_settings()
    return exeat.exeat_type in (cfg.principal_approval_types or [])


def _assert_can_decide(exeat, user):
    if _needs_principal(exeat) and getattr(user, "role", None) not in ("ADMIN", "PRINCIPAL"):
        raise BoardingError(
            f"{exeat.get_exeat_type_display()} requests can only be approved or rejected by the Principal or Admin."
        )


@transaction.atomic
def create_exeat(registration, *, exeat_type, reason, expected_departure, expected_return,
                 destination="", contact_name="", contact_phone="", by=None,
                 source=ExeatRequest.Source.STAFF, approve_now=False):
    registration = Reg.objects.select_for_update().get(pk=registration.pk)
    if registration.status != Reg.Status.REGISTERED:
        raise BoardingError("This student is not registered as a boarder.")
    if exeat_type not in ExeatRequest.Type.values:
        raise BoardingError("Unknown exeat type.")
    if not (reason or "").strip():
        raise BoardingError("Please give a reason.")
    if expected_return <= expected_departure:
        raise BoardingError("The return time must be after the departure time.")
    cfg = get_settings()
    if expected_return - expected_departure > timedelta(days=cfg.exeat_max_days):
        raise BoardingError(f"An exeat cannot be longer than {cfg.exeat_max_days} days.")
    if expected_return < timezone.now():
        raise BoardingError("The return time is already in the past.")
    if registration.exeats.filter(status__in=OPEN_EXEAT).exists():
        raise BoardingError("This student already has an open exeat. Close or cancel it first.")

    exeat = ExeatRequest.objects.create(
        registration=registration, term=current_term(), exeat_type=exeat_type, reason=reason.strip(),
        destination=destination, contact_name=contact_name, contact_phone=contact_phone,
        expected_departure=expected_departure, expected_return=expected_return,
        source=source, requested_by=by,
    )
    exeat.slip_no = f"EX-{timezone.localdate().year}-{exeat.pk:06d}"
    exeat.save(update_fields=["slip_no"])
    if approve_now:
        approve_exeat(exeat, by)
    return exeat


@transaction.atomic
def approve_exeat(exeat, by, note=""):
    exeat = ExeatRequest.objects.select_for_update().get(pk=exeat.pk)
    if exeat.status != ExStatus.PENDING:
        raise BoardingError(f"Only pending requests can be approved (this one is {exeat.get_status_display()}).")
    _assert_can_decide(exeat, by)
    exeat.status = ExStatus.APPROVED
    exeat.decided_by, exeat.decided_at, exeat.decision_note = by, timezone.now(), (note or "")[:255]
    exeat.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
    return exeat


@transaction.atomic
def reject_exeat(exeat, by, note=""):
    exeat = ExeatRequest.objects.select_for_update().get(pk=exeat.pk)
    if exeat.status != ExStatus.PENDING:
        raise BoardingError(f"Only pending requests can be rejected (this one is {exeat.get_status_display()}).")
    if not (note or "").strip():
        raise BoardingError("Please give a reason for rejecting.")
    _assert_can_decide(exeat, by)
    exeat.status = ExStatus.REJECTED
    exeat.decided_by, exeat.decided_at, exeat.decision_note = by, timezone.now(), note.strip()[:255]
    exeat.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
    return exeat


@transaction.atomic
def cancel_exeat(exeat, by, note=""):
    exeat = ExeatRequest.objects.select_for_update().get(pk=exeat.pk)
    if exeat.status not in (ExStatus.PENDING, ExStatus.APPROVED):
        raise BoardingError("Only pending or approved requests that have not left yet can be cancelled.")
    exeat.status = ExStatus.CANCELLED
    exeat.decided_by, exeat.decided_at = by, timezone.now()
    exeat.decision_note = (note or exeat.decision_note or "")[:255]
    exeat.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
    return exeat


@transaction.atomic
def check_out_exeat(exeat, by, collected_by_name="", collected_by_id_no="", collected_by_relationship=""):
    exeat = ExeatRequest.objects.select_for_update().get(pk=exeat.pk)
    if exeat.status != ExStatus.APPROVED:
        raise BoardingError("Only an approved exeat can be checked out.")
    if not (collected_by_name or "").strip():
        raise BoardingError("Record who is collecting the student.")
    exeat.status = ExStatus.OUT
    exeat.checked_out_at, exeat.checked_out_by = timezone.now(), by
    exeat.collected_by_name = collected_by_name.strip()[:120]
    exeat.collected_by_id_no = (collected_by_id_no or "")[:30]
    exeat.collected_by_relationship = (collected_by_relationship or "")[:60]
    exeat.save(update_fields=[
        "status", "checked_out_at", "checked_out_by",
        "collected_by_name", "collected_by_id_no", "collected_by_relationship",
    ])
    return exeat


@transaction.atomic
def check_in_exeat(exeat, by, note=""):
    exeat = ExeatRequest.objects.select_for_update().get(pk=exeat.pk)
    if exeat.status != ExStatus.OUT:
        raise BoardingError("Only a student who is out can be checked back in.")
    exeat.status = ExStatus.RETURNED
    exeat.checked_in_at, exeat.checked_in_by = timezone.now(), by
    exeat.return_note = (note or "")[:255]
    exeat.save(update_fields=["status", "checked_in_at", "checked_in_by", "return_note"])
    return exeat


# ---------------------------------------------------------------------------
# roll call
# ---------------------------------------------------------------------------
@transaction.atomic
def open_roll_call(dorm, date, session_type, by=None):
    """Create (or return) the session for that hostel/date/slot, pre-filled from current bed allocations."""
    if session_type not in RollCallSession.SessionType.values:
        raise BoardingError("Unknown roll call session.")
    if date > timezone.localdate():
        raise BoardingError("You cannot open a roll call for a future date.")
    session, created = RollCallSession.objects.get_or_create(
        dormitory=dorm, date=date, session_type=session_type,
        defaults={"academic_year": current_year(), "term": current_term(), "taken_by": by},
    )
    if not created:
        return session, False
    out_now = set(
        ExeatRequest.objects.filter(status=ExStatus.OUT).values_list("registration_id", flat=True)
    )
    allocs = Alloc.objects.filter(
        released_at__isnull=True, bed__room__dormitory=dorm, registration__status=Reg.Status.REGISTERED
    ).select_related("registration")
    RollCallEntry.objects.bulk_create([
        RollCallEntry(
            session=session, registration=a.registration, bed_label=a.bed_label,
            status=RollCallEntry.Status.EXEAT if a.registration_id in out_now else RollCallEntry.Status.PRESENT,
        )
        for a in allocs
    ])
    return session, True


@transaction.atomic
def mark_roll_call(session, marks):
    """marks: [{"entry": id, "status": "...", "remarks": "..."}]"""
    session = RollCallSession.objects.select_for_update().get(pk=session.pk)
    if session.status != RollCallSession.Status.OPEN:
        raise BoardingError("This roll call has been submitted. Ask an admin to reopen it.")
    valid = set(RollCallEntry.Status.values)
    entries = {e.pk: e for e in session.entries.all()}
    changed = 0
    for m in marks:
        entry = entries.get(m.get("entry"))
        if entry is None:
            raise BoardingError(f"Entry {m.get('entry')} is not part of this roll call.")
        if m.get("status") not in valid:
            raise BoardingError(f"Invalid status '{m.get('status')}'.")
        entry.status = m["status"]
        entry.remarks = (m.get("remarks") or "")[:255]
        entry.save(update_fields=["status", "remarks"])
        changed += 1
    return changed


@transaction.atomic
def submit_roll_call(session, by):
    session = RollCallSession.objects.select_for_update().get(pk=session.pk)
    if session.status == RollCallSession.Status.SUBMITTED:
        raise BoardingError("This roll call is already submitted.")
    session.status = RollCallSession.Status.SUBMITTED
    session.submitted_at = timezone.now()
    session.taken_by = by
    session.save(update_fields=["status", "submitted_at", "taken_by"])
    return session


def reopen_roll_call(session):
    if session.status != RollCallSession.Status.SUBMITTED:
        raise BoardingError("This roll call is already open.")
    session.status = RollCallSession.Status.OPEN
    session.submitted_at = None
    session.save(update_fields=["status", "submitted_at"])
    return session


# ---------------------------------------------------------------------------
# boarding fees - billed through the existing StudentCharge system
# ---------------------------------------------------------------------------
def _boarding_charge_type():
    ct, _ = api_models.ChargeType.objects.get_or_create(
        code="BOARDING", defaults={"name": "Boarding Fee", "description": "Termly boarding fee"}
    )
    return ct


def bill_boarding_fees(term, by=None, dry_run=False, only_allocated=False):
    from api import services as api_services

    if not hasattr(api_services, "create_student_charge"):
        raise BoardingError("api.services.create_student_charge was not found; boarding billing needs it.")

    rates = {r.grade_level_id: r.amount for r in BoardingFeeRate.objects.filter(term=term)}
    if not rates:
        raise BoardingError(f"No boarding fee rates are set for {term}.")
    default_rate = rates.get(None)
    charge_type = None if dry_run else _boarding_charge_type()

    regs = Reg.objects.filter(academic_year=term.academic_year, status=Reg.Status.REGISTERED).select_related(
        "student__user", "enrollment__classroom"
    )
    if only_allocated:
        regs = regs.filter(allocations__released_at__isnull=True).distinct()
    billed_ids = set(BoardingFeeBilling.objects.filter(term=term).values_list("registration_id", flat=True))

    out = {"dry_run": dry_run, "billed": 0, "total": Decimal("0"), "already_billed": 0, "no_rate": [], "failed": []}
    for reg in regs.order_by("student__admission_no"):
        if reg.pk in billed_ids:
            out["already_billed"] += 1
            continue
        grade_id = reg.enrollment.classroom.grade_level_id if reg.enrollment_id else None
        amount = rates.get(grade_id, default_rate)
        if amount is None:
            out["no_rate"].append({"admission_no": reg.student.admission_no, "grade": reg.grade_name})
            continue
        if dry_run:
            out["billed"] += 1
            out["total"] += amount
            continue
        try:
            with transaction.atomic():
                charge = api_services.create_student_charge(
                    reg.student, charge_type, amount=amount,
                    description=f"Boarding fee - {term}", due_date=None, created_by=by,
                )
                BoardingFeeBilling.objects.create(
                    registration=reg, term=term, charge=charge, amount=amount, billed_by=by
                )
        except Exception as exc:  # one bad row must not stop the run
            out["failed"].append({"admission_no": reg.student.admission_no, "error": str(getattr(exc, "detail", exc))})
            continue
        out["billed"] += 1
        out["total"] += amount
    out["total"] = str(out["total"])
    return out


# ---------------------------------------------------------------------------
# reports
# ---------------------------------------------------------------------------
def dormitory_occupancy(dorm, year):
    """
    Every bed of a dormitory with everyone who slept in it during `year`
    (current occupant first). Works for past years - that is the history view.
    """
    beds = list(
        Bed.objects.filter(room__dormitory=dorm).select_related("room").order_by("room__number", "number")
    )
    allocs = (
        Alloc.objects.filter(bed__room__dormitory=dorm, registration__academic_year=year)
        .select_related("registration__student__user")
        .order_by("allocated_from", "id")
    )
    by_bed = {}
    for a in allocs:
        by_bed.setdefault(a.bed_id, []).append({
            "allocation": a.pk,
            "admission_no": a.registration.student.admission_no,
            "student_name": student_name(a.registration.student),
            "grade_name": a.registration.grade_name,
            "allocated_from": a.allocated_from,
            "released_at": a.released_at,
            "release_reason": a.release_reason,
            "is_current": a.released_at is None,
        })
    rooms = {}
    for b in beds:
        room = rooms.setdefault(b.room_id, {"room": b.room_id, "number": b.room.number, "is_active": b.room.is_active, "beds": []})
        occ = sorted(by_bed.get(b.pk, []), key=lambda o: o["is_current"], reverse=True)
        room["beds"].append({"bed": b.pk, "number": b.number, "is_active": b.is_active, "occupants": occ})
    return list(rooms.values())


def dashboard(user_dorm_ids):
    """Headline numbers. user_dorm_ids=None means the whole school."""
    year = current_year()
    dorms = Dormitory.objects.all()
    if user_dorm_ids is not None:
        dorms = dorms.filter(pk__in=user_dorm_ids)
    dorm_ids = list(dorms.values_list("pk", flat=True))

    per_dorm = []
    tot_beds = tot_occ = 0
    for d in dorms.order_by("gender", "name"):
        c = dormitory_counts(d)
        tot_beds += c["bed_count"]
        tot_occ += c["occupied_count"]
        per_dorm.append({"id": d.pk, "name": d.name, "gender": d.gender, "is_active": d.is_active, **c})

    scope_regs = Alloc.objects.filter(released_at__isnull=True, bed__room__dormitory_id__in=dorm_ids)
    reg_ids = scope_regs.values_list("registration_id", flat=True)
    exeats = ExeatRequest.objects.filter(registration_id__in=reg_ids)
    now = timezone.now()

    today = timezone.localdate()
    pending_rolls = []
    if year:
        for d in dorms.filter(is_active=True):
            done = set(RollCallSession.objects.filter(dormitory=d, date=today).values_list("session_type", flat=True))
            pending_rolls.append({"dormitory": d.pk, "name": d.name, "done": sorted(done)})

    boarders = Reg.objects.filter(academic_year=year, status=Reg.Status.REGISTERED) if year else Reg.objects.none()
    has_bed = Alloc.objects.filter(registration=OuterRef("pk"), released_at__isnull=True)
    unplaced = boarders.annotate(h=Exists(has_bed)).filter(h=False)
    if user_dorm_ids is not None:
        genders = set(dorms.values_list("gender", flat=True))
        unplaced = unplaced.filter(student__gender__in=genders)
        boarders = boarders.filter(student__gender__in=genders)

    stale = scope_regs.exclude(registration__academic_year=year).count() if year else 0
    return {
        "academic_year": year.year if year else None,
        "boarders": boarders.count(),
        "unplaced_boarders": unplaced.count(),
        "total_beds": tot_beds,
        "occupied_beds": tot_occ,
        "vacant_beds": max(tot_beds - tot_occ, 0),
        "stale_allocations": stale,
        "pending_exeats": exeats.filter(status=ExStatus.PENDING).count(),
        "approved_waiting": exeats.filter(status=ExStatus.APPROVED).count(),
        "out_now": exeats.filter(status=ExStatus.OUT).count(),
        "overdue": exeats.filter(status=ExStatus.OUT, expected_return__lt=now).count(),
        "dormitories": per_dorm,
        "roll_call_today": pending_rolls,
    }