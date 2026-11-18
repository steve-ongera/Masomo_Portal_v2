"""
boarding/models.py

Boarding & hostel management for Masomo Portal.

HOW HISTORY STAYS INTACT
------------------------
* Dormitory -> Room -> Bed are PHYSICAL assets. They are never tied to a year
  and are never deleted once anybody has slept in them (deactivate instead).
* BedAllocation is the history record: "student X slept in bed B from date D1
  until D2, during academic year Y". When a student leaves (graduates, is
  withdrawn, transfers) the row is CLOSED (released_at is set), never deleted.
  The bed is then free and a new row is created for the next student.
  So "Mt Kenya, room 101, bed 4" can list every occupant of every year.
* Each allocation stores a `bed_label` snapshot, and each registration stores
  `grade_name` / `class_name` snapshots, so renaming a hostel or promoting a
  student later never rewrites what was true at the time.
* Database constraints (partial unique indexes) guarantee that a bed holds at
  most ONE current occupant and a registration has at most ONE current bed.
"""
from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

USER = settings.AUTH_USER_MODEL


class Gender(models.TextChoices):
    # Same codes as api.StudentProfile.Gender so the two compare directly.
    MALE = "M", "Boys"
    FEMALE = "F", "Girls"


def default_principal_types():
    return ["SENT_HOME"]


# ---------------------------------------------------------------------------
# 1. SETTINGS
# ---------------------------------------------------------------------------
class BoardingSettings(models.Model):
    """One row per school. Decides who is allowed to board."""

    school = models.OneToOneField("api.School", on_delete=models.CASCADE, related_name="boarding_settings")
    boarding_grades = models.ManyToManyField(
        "api.GradeLevel", blank=True, related_name="+",
        help_text="Grades that board at this school (e.g. Grade 7-12, or Grade 10-12 only). "
                  "Leave empty to allow every grade.",
    )
    principal_approval_types = models.JSONField(
        default=default_principal_types, blank=True,
        help_text="Exeat types that only the Principal/Admin may approve, e.g. ['SENT_HOME'].",
    )
    exeat_max_days = models.PositiveSmallIntegerField(
        default=14, help_text="Longest exeat/leave-out that can be requested, in days."
    )

    class Meta:
        db_table = "boarding_settings"

    def __str__(self):
        return f"Boarding settings - {self.school}"


# ---------------------------------------------------------------------------
# 2. PHYSICAL STRUCTURE
# ---------------------------------------------------------------------------
class Dormitory(models.Model):
    """A hostel / dormitory, e.g. 'Mt Kenya' (boys) or 'Kilimanjaro' (girls)."""

    name = models.CharField(max_length=120, unique=True)
    gender = models.CharField(max_length=1, choices=Gender.choices)
    description = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "boarding_dormitories"
        ordering = ["gender", "name"]

    def __str__(self):
        return f"{self.name} ({self.get_gender_display()})"


class WardenAssignment(models.Model):
    """Which dormitories a hostel warden looks after."""

    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="warden_assignments")
    dormitory = models.ForeignKey(Dormitory, on_delete=models.CASCADE, related_name="warden_assignments")
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "boarding_warden_assignments"
        unique_together = ("user", "dormitory")

    def __str__(self):
        return f"{self.user} -> {self.dormitory}"


class Room(models.Model):
    dormitory = models.ForeignKey(Dormitory, on_delete=models.CASCADE, related_name="rooms")
    number = models.CharField(max_length=20)  # "101", "A3"
    floor = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "boarding_rooms"
        unique_together = ("dormitory", "number")
        ordering = ["dormitory__name", "number"]

    def __str__(self):
        return f"{self.dormitory.name} - Room {self.number}"


class Bed(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="beds")
    number = models.CharField(max_length=10)  # "1", "4", "4A"
    is_active = models.BooleanField(default=True, help_text="Untick when the bed is broken / out of service.")
    notes = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "boarding_beds"
        unique_together = ("room", "number")
        ordering = ["room__dormitory__name", "room__number", "number"]

    @property
    def label(self):
        return f"{self.room.dormitory.name} · Room {self.room.number} · Bed {self.number}"

    def __str__(self):
        return self.label


# ---------------------------------------------------------------------------
# 3. WHO BOARDS, AND WHERE THEY SLEEP
# ---------------------------------------------------------------------------
class BoardingRegistration(models.Model):
    """A student is a boarder for a given academic year (vs a day scholar)."""

    class Status(models.TextChoices):
        REGISTERED = "REGISTERED", "Registered"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="boarding_registrations")
    academic_year = models.ForeignKey("api.AcademicYear", on_delete=models.CASCADE, related_name="boarding_registrations")
    enrollment = models.ForeignKey(
        "api.Enrollment", on_delete=models.SET_NULL, null=True, blank=True, related_name="boarding_registrations"
    )
    # snapshots so history still reads correctly after promotion
    grade_name = models.CharField(max_length=60, blank=True)
    class_name = models.CharField(max_length=120, blank=True)

    status = models.CharField(max_length=12, choices=Status.choices, default=Status.REGISTERED)
    registered_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    registered_at = models.DateTimeField(default=timezone.now)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    withdrawn_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "boarding_registrations"
        unique_together = ("student", "academic_year")
        ordering = ["-academic_year__year", "student__admission_no"]

    def __str__(self):
        return f"{self.student.admission_no} boarder {self.academic_year}"


class BedAllocation(models.Model):
    """
    One row = one student in one bed for one stretch of time.
    released_at IS NULL  ->  the student is in that bed right now.
    """

    class ReleaseReason(models.TextChoices):
        TRANSFER = "TRANSFER", "Moved to another bed"
        YEAR_END = "YEAR_END", "Academic year ended (re-allocated)"
        GRADUATED = "GRADUATED", "Completed school"
        NOT_RETURNING = "NOT_RETURNING", "Not returning"
        NOT_BOARDING_GRADE = "NOT_BOARDING_GRADE", "Grade does not board"
        WITHDRAWN = "WITHDRAWN", "Withdrawn from boarding"
        CORRECTION = "CORRECTION", "Correction"
        OTHER = "OTHER", "Other"

    registration = models.ForeignKey(BoardingRegistration, on_delete=models.CASCADE, related_name="allocations")
    bed = models.ForeignKey(Bed, on_delete=models.PROTECT, related_name="allocations")
    bed_label = models.CharField(max_length=255, blank=True)  # snapshot

    allocated_from = models.DateField(default=timezone.localdate)
    released_at = models.DateTimeField(null=True, blank=True)
    release_reason = models.CharField(max_length=20, choices=ReleaseReason.choices, blank=True)
    notes = models.CharField(max_length=255, blank=True)
    carried_over = models.BooleanField(default=False, help_text="Kept the same bed after year rollover.")

    allocated_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    released_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "boarding_bed_allocations"
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["bed"], condition=Q(released_at__isnull=True), name="boarding_one_current_occupant_per_bed"
            ),
            models.UniqueConstraint(
                fields=["registration"], condition=Q(released_at__isnull=True),
                name="boarding_one_current_bed_per_registration",
            ),
        ]
        indexes = [models.Index(fields=["bed", "released_at"])]

    @property
    def is_current(self):
        return self.released_at is None

    def __str__(self):
        return f"{self.registration.student.admission_no} @ {self.bed_label}"


# ---------------------------------------------------------------------------
# 4. EXEAT / LEAVE-OUT SLIPS
# ---------------------------------------------------------------------------
class ExeatRequest(models.Model):
    class Type(models.TextChoices):
        EXEAT = "EXEAT", "Exeat (home visit / weekend)"
        LEAVE_OUT = "LEAVE_OUT", "Leave-out (day outing)"
        MEDICAL = "MEDICAL", "Medical"
        EMERGENCY = "EMERGENCY", "Family emergency"
        SENT_HOME = "SENT_HOME", "Sent home (fees / discipline)"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"
        OUT = "OUT", "Out of school"
        RETURNED = "RETURNED", "Returned"

    class Source(models.TextChoices):
        STAFF = "STAFF", "Raised by staff"
        PARENT = "PARENT", "Requested by parent"
        STUDENT = "STUDENT", "Requested by student"

    slip_no = models.CharField(max_length=30, unique=True, null=True, blank=True, editable=False)
    registration = models.ForeignKey(BoardingRegistration, on_delete=models.CASCADE, related_name="exeats")
    term = models.ForeignKey("api.Term", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    exeat_type = models.CharField(max_length=12, choices=Type.choices, default=Type.EXEAT)
    reason = models.TextField()
    destination = models.CharField(max_length=200, blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    contact_phone = models.CharField(max_length=30, blank=True)
    expected_departure = models.DateTimeField()
    expected_return = models.DateTimeField()

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.STAFF)
    requested_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    decided_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.CharField(max_length=255, blank=True)

    checked_out_at = models.DateTimeField(null=True, blank=True)
    checked_out_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    collected_by_name = models.CharField(max_length=120, blank=True)
    collected_by_id_no = models.CharField(max_length=30, blank=True)
    collected_by_relationship = models.CharField(max_length=60, blank=True)

    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_in_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    return_note = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "boarding_exeats"
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["status", "expected_return"])]

    @property
    def is_overdue(self):
        return self.status == self.Status.OUT and self.expected_return < timezone.now()

    @property
    def returned_late(self):
        return bool(self.checked_in_at and self.checked_in_at > self.expected_return)

    def __str__(self):
        return f"{self.slip_no or self.pk} - {self.registration.student.admission_no} ({self.status})"


# ---------------------------------------------------------------------------
# 5. ROLL CALL
# ---------------------------------------------------------------------------
class RollCallSession(models.Model):
    class SessionType(models.TextChoices):
        MORNING = "MORNING", "Morning"
        EVENING = "EVENING", "Evening / prep"
        NIGHT = "NIGHT", "Night (lights out)"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        SUBMITTED = "SUBMITTED", "Submitted"

    dormitory = models.ForeignKey(Dormitory, on_delete=models.CASCADE, related_name="roll_calls")
    date = models.DateField(default=timezone.localdate)
    session_type = models.CharField(max_length=10, choices=SessionType.choices)
    academic_year = models.ForeignKey("api.AcademicYear", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    term = models.ForeignKey("api.Term", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    taken_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    submitted_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "boarding_roll_call_sessions"
        unique_together = ("dormitory", "date", "session_type")
        ordering = ["-date", "-created_at"]

    def __str__(self):
        return f"{self.dormitory.name} {self.date} {self.session_type}"


class RollCallEntry(models.Model):
    class Status(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        ABSENT = "ABSENT", "Absent"
        EXEAT = "EXEAT", "On exeat / leave-out"
        SICK = "SICK", "Sick bay / hospital"
        OTHER = "OTHER", "Other (excused)"

    session = models.ForeignKey(RollCallSession, on_delete=models.CASCADE, related_name="entries")
    registration = models.ForeignKey(BoardingRegistration, on_delete=models.CASCADE, related_name="roll_call_entries")
    bed_label = models.CharField(max_length=255, blank=True)  # snapshot
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PRESENT)
    remarks = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "boarding_roll_call_entries"
        unique_together = ("session", "registration")
        ordering = ["bed_label", "registration__student__admission_no"]


# ---------------------------------------------------------------------------
# 6. BOARDING FEES (billed through the existing StudentCharge system)
# ---------------------------------------------------------------------------
class BoardingFeeRate(models.Model):
    """Boarding fee for a term. grade_level NULL = default rate for every grade."""

    term = models.ForeignKey("api.Term", on_delete=models.CASCADE, related_name="boarding_rates")
    grade_level = models.ForeignKey(
        "api.GradeLevel", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        db_table = "boarding_fee_rates"
        constraints = [
            models.UniqueConstraint(fields=["term", "grade_level"], name="boarding_rate_term_grade_uniq"),
            models.UniqueConstraint(
                fields=["term"], condition=Q(grade_level__isnull=True), name="boarding_rate_term_default_uniq"
            ),
        ]

    def __str__(self):
        return f"{self.term} / {self.grade_level or 'All grades'}: {self.amount}"


class BoardingFeeBilling(models.Model):
    """Proof that a boarder was billed for a term (prevents double billing)."""

    registration = models.ForeignKey(BoardingRegistration, on_delete=models.CASCADE, related_name="fee_billings")
    term = models.ForeignKey("api.Term", on_delete=models.CASCADE, related_name="+")
    charge = models.ForeignKey("api.StudentCharge", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    billed_by = models.ForeignKey(USER, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    billed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "boarding_fee_billings"
        unique_together = ("registration", "term")
        ordering = ["-billed_at"]