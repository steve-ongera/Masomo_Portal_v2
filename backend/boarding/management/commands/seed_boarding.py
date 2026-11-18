"""
boarding/management/commands/seed_boarding.py

Seeds demo / starter data for the boarding module.

What it creates (all idempotent - safe to run more than once):
  * BoardingSettings for the school (all grades board by default)
  * Dormitories (boys + girls), rooms and beds
  * WardenAssignment rows for any HOSTEL_WARDEN users
  * Optional: boarding registrations + bed allocations for existing students
  * Optional: sample exeat slips, today's roll calls, a default boarding fee rate

Usage:
    python manage.py seed_boarding
    python manage.py seed_boarding --students 40 --exeats --roll-calls --fee-rate 15000
    python manage.py seed_boarding --structure-only
    python manage.py seed_boarding --reset --yes          # wipe boarding data first

Make sure these exist (empty files are fine):
    boarding/management/__init__.py
    boarding/management/commands/__init__.py
"""
import random
from datetime import timedelta

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.exceptions import FieldError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from boarding.models import (
    Bed,
    BedAllocation,
    BoardingFeeRate,
    BoardingRegistration,
    BoardingSettings,
    Dormitory,
    ExeatRequest,
    Gender,
    RollCallEntry,
    RollCallSession,
    Room,
    WardenAssignment,
)

# (name, gender, description)
DORMITORIES = [
    ("Mt Kenya", Gender.MALE, "Boys' hostel - Form 1 & 2"),
    ("Mt Elgon", Gender.MALE, "Boys' hostel - Form 3 & 4"),
    ("Kilimanjaro", Gender.FEMALE, "Girls' hostel - Form 1 & 2"),
    ("Aberdares", Gender.FEMALE, "Girls' hostel - Form 3 & 4"),
]

EXEAT_REASONS = [
    ("EXEAT", "Weekend visit home", "Mombasa"),
    ("EXEAT", "Family function", "Kilifi"),
    ("LEAVE_OUT", "Shopping for personal items", "Nyali"),
    ("MEDICAL", "Dental appointment", "Coast General Hospital"),
    ("EMERGENCY", "Bereavement in the family", "Malindi"),
    ("SENT_HOME", "Outstanding school fees", "Kwale"),
]


def _dig(obj, path, default=""):
    """Safely walk 'a.b.c' attributes; return default if anything is missing."""
    for part in path.split("."):
        obj = getattr(obj, part, None)
        if obj is None:
            return default
    return obj


class Command(BaseCommand):
    help = "Seed dormitories, rooms, beds and (optionally) boarders, exeats and roll calls."

    def add_arguments(self, parser):
        parser.add_argument("--rooms", type=int, default=6, help="Rooms per dormitory (default 6).")
        parser.add_argument("--beds", type=int, default=8, help="Beds per room (default 8).")
        parser.add_argument("--students", type=int, default=30,
                            help="How many existing students to register as boarders (default 30).")
        parser.add_argument("--structure-only", action="store_true",
                            help="Only create dormitories, rooms, beds, settings and warden links.")
        parser.add_argument("--exeats", action="store_true", help="Create sample exeat slips.")
        parser.add_argument("--roll-calls", action="store_true", help="Create today's roll calls.")
        parser.add_argument("--fee-rate", type=int, default=None,
                            help="Create a default boarding fee rate (KES) for the current term.")
        parser.add_argument("--year", type=int, default=None,
                            help="AcademicYear id to use (default: current / latest).")
        parser.add_argument("--seed", type=int, default=42, help="Random seed for repeatable data.")
        parser.add_argument("--reset", action="store_true",
                            help="Delete ALL boarding data before seeding (needs --yes).")
        parser.add_argument("--yes", action="store_true", help="Confirm destructive --reset.")

    # ------------------------------------------------------------------
    def handle(self, *args, **opts):
        random.seed(opts["seed"])
        self.opts = opts

        if opts["reset"]:
            if not opts["yes"]:
                raise CommandError("--reset deletes all boarding data. Re-run with --yes to confirm.")
            self._reset()

        with transaction.atomic():
            self.school = self._get_school()
            self._seed_settings()
            self._seed_structure()
            self._seed_wardens()

            if not opts["structure_only"]:
                self.year = self._get_year()
                self.term = self._get_term()
                self.admin_user = self._get_admin_user()
                if self.year:
                    self._seed_boarders()
                else:
                    self.stdout.write(self.style.WARNING("No AcademicYear found - skipping boarders."))

                if opts["exeats"]:
                    self._seed_exeats()
                if opts["roll_calls"]:
                    self._seed_roll_calls()
                if opts["fee_rate"] is not None:
                    self._seed_fee_rate(opts["fee_rate"])

        self.stdout.write(self.style.SUCCESS("Boarding seed complete."))

    # ------------------------------------------------------------------
    # lookups (defensive: the api app's exact fields aren't assumed)
    # ------------------------------------------------------------------
    def _get_school(self):
        School = apps.get_model("api", "School")
        school = School.objects.first()
        if not school:
            raise CommandError("No api.School row exists. Create the school first.")
        return school

    def _get_year(self):
        AcademicYear = apps.get_model("api", "AcademicYear")
        if self.opts["year"]:
            return AcademicYear.objects.filter(pk=self.opts["year"]).first()
        try:
            year = AcademicYear.objects.filter(is_current=True).first()
            if year:
                return year
        except FieldError:
            pass
        return AcademicYear.objects.order_by("-year").first()

    def _get_term(self):
        Term = apps.get_model("api", "Term")
        qs = Term.objects.all()
        try:
            qs = qs.filter(academic_year=self.year)
        except FieldError:
            pass
        try:
            current = qs.filter(is_current=True).first()
            if current:
                return current
        except FieldError:
            pass
        return qs.order_by("-id").first()

    def _get_admin_user(self):
        User = get_user_model()
        try:
            user = User.objects.filter(role="ADMIN").first()
            if user:
                return user
        except FieldError:
            pass
        return User.objects.filter(is_superuser=True).first()

    # ------------------------------------------------------------------
    # reset
    # ------------------------------------------------------------------
    def _reset(self):
        self.stdout.write(self.style.WARNING("Deleting existing boarding data..."))
        with transaction.atomic():
            RollCallEntry.objects.all().delete()
            RollCallSession.objects.all().delete()
            ExeatRequest.objects.all().delete()
            BedAllocation.objects.all().delete()
            BoardingRegistration.objects.all().delete()
            WardenAssignment.objects.all().delete()
            Bed.objects.all().delete()
            Room.objects.all().delete()
            Dormitory.objects.all().delete()

    # ------------------------------------------------------------------
    # settings + structure
    # ------------------------------------------------------------------
    def _seed_settings(self):
        _, created = BoardingSettings.objects.get_or_create(school=self.school)
        self.stdout.write(f"Boarding settings: {'created' if created else 'already there'} (all grades board).")

    def _seed_structure(self):
        rooms_per, beds_per = self.opts["rooms"], self.opts["beds"]
        new_dorms = new_rooms = new_beds = 0

        for name, gender, desc in DORMITORIES:
            dorm, d_new = Dormitory.objects.get_or_create(
                name=name, defaults={"gender": gender, "description": desc}
            )
            new_dorms += d_new
            for r in range(1, rooms_per + 1):
                number = f"{100 + r}"
                room, r_new = Room.objects.get_or_create(
                    dormitory=dorm, number=number, defaults={"floor": "Ground" if r <= rooms_per // 2 else "First"}
                )
                new_rooms += r_new
                for b in range(1, beds_per + 1):
                    _, b_new = Bed.objects.get_or_create(room=room, number=str(b))
                    new_beds += b_new

        self.stdout.write(f"Structure: +{new_dorms} dormitories, +{new_rooms} rooms, +{new_beds} beds.")

    def _seed_wardens(self):
        User = get_user_model()
        try:
            wardens = list(User.objects.filter(role="HOSTEL_WARDEN"))
        except FieldError:
            self.stdout.write(self.style.WARNING("User model has no 'role' field - skipping warden links."))
            return
        if not wardens:
            self.stdout.write("No HOSTEL_WARDEN users found - skipping warden links.")
            return

        dorms = list(Dormitory.objects.filter(is_active=True))
        made = 0
        # Split dormitories between wardens round-robin; a lone warden gets all of them.
        for i, dorm in enumerate(dorms):
            warden = wardens[i % len(wardens)]
            _, created = WardenAssignment.objects.get_or_create(user=warden, dormitory=dorm)
            made += created
        self.stdout.write(f"Warden assignments: +{made} across {len(wardens)} warden(s).")

    # ------------------------------------------------------------------
    # boarders + allocations
    # ------------------------------------------------------------------
    def _snapshot(self, student):
        """(enrollment, grade_name, class_name) - tolerant of unknown field names."""
        Enrollment = apps.get_model("api", "Enrollment")
        enrollment = None
        try:
            enrollment = Enrollment.objects.filter(student=student, academic_year=self.year).first()
        except FieldError:
            try:
                enrollment = Enrollment.objects.filter(student=student).order_by("-id").first()
            except FieldError:
                pass
        if not enrollment:
            return None, "", ""

        grade = ""
        klass = ""
        for path in ("classroom.grade_level.name", "class_room.grade_level.name", "grade_level.name"):
            grade = _dig(enrollment, path)
            if grade:
                break
        for path in ("classroom.name", "class_room.name", "stream.name"):
            klass = _dig(enrollment, path)
            if klass:
                break
        return enrollment, str(grade), str(klass)

    def _seed_boarders(self):
        StudentProfile = apps.get_model("api", "StudentProfile")
        target = self.opts["students"]
        if target <= 0:
            return

        already = set(
            BoardingRegistration.objects.filter(academic_year=self.year).values_list("student_id", flat=True)
        )
        existing_count = len(already)
        need = max(target - existing_count, 0)
        if need == 0:
            self.stdout.write(f"Boarders: already {existing_count} registered, nothing to add.")
        # Half boys, half girls where possible.
        picked = []
        for gender, share in ((Gender.MALE, (need + 1) // 2), (Gender.FEMALE, need // 2)):
            qs = StudentProfile.objects.filter(gender=gender).exclude(pk__in=already).order_by("?")[:share]
            picked.extend(qs)

        registered = 0
        for student in picked:
            enrollment, grade_name, class_name = self._snapshot(student)
            _, created = BoardingRegistration.objects.get_or_create(
                student=student,
                academic_year=self.year,
                defaults={
                    "enrollment": enrollment,
                    "grade_name": grade_name,
                    "class_name": class_name,
                    "registered_by": self.admin_user,
                },
            )
            registered += created
        if need:
            self.stdout.write(f"Boarders: +{registered} registered (asked for {need} new).")

        self._allocate_beds()

    def _allocate_beds(self):
        """Give every un-bedded REGISTERED boarder a free bed in a dorm of their gender."""
        regs = (
            BoardingRegistration.objects
            .filter(academic_year=self.year, status=BoardingRegistration.Status.REGISTERED)
            .exclude(allocations__released_at__isnull=True)
            .select_related("student")
        )

        occupied = set(
            BedAllocation.objects.filter(released_at__isnull=True).values_list("bed_id", flat=True)
        )
        free_by_gender = {}
        for gender in (Gender.MALE, Gender.FEMALE):
            beds = (
                Bed.objects
                .filter(is_active=True, room__is_active=True,
                        room__dormitory__is_active=True, room__dormitory__gender=gender)
                .select_related("room__dormitory")
                .order_by("room__dormitory__name", "room__number", "number")
            )
            free_by_gender[gender] = [b for b in beds if b.pk not in occupied]

        allocated = skipped = 0
        for reg in regs:
            pool = free_by_gender.get(reg.student.gender, [])
            if not pool:
                skipped += 1
                continue
            bed = pool.pop(0)
            BedAllocation.objects.create(
                registration=reg,
                bed=bed,
                bed_label=bed.label,
                allocated_by=self.admin_user,
            )
            allocated += 1

        self.stdout.write(f"Bed allocations: +{allocated}" + (f" ({skipped} without a free bed)" if skipped else "") + ".")

    # ------------------------------------------------------------------
    # exeats
    # ------------------------------------------------------------------
    def _next_slip_no(self):
        year = timezone.localdate().year
        prefix = f"EX-{year}-"
        last = (
            ExeatRequest.objects.filter(slip_no__startswith=prefix)
            .order_by("-slip_no").values_list("slip_no", flat=True).first()
        )
        n = int(last.split("-")[-1]) + 1 if last else 1
        return f"{prefix}{n:04d}"

    def _seed_exeats(self):
        regs = list(
            BoardingRegistration.objects.filter(
                academic_year=self.year, status=BoardingRegistration.Status.REGISTERED
            ).select_related("student")[:20]
        )
        if not regs:
            self.stdout.write(self.style.WARNING("No boarders - skipping exeats."))
            return
        if ExeatRequest.objects.exists():
            self.stdout.write("Exeats: some already exist, not adding more.")
            return

        now = timezone.now()
        S = ExeatRequest.Status
        # (status, departure offset hours, return offset hours)
        plan = [
            (S.PENDING, 24, 72),
            (S.PENDING, 48, 96),
            (S.APPROVED, 6, 54),
            (S.REJECTED, 24, 48),
            (S.OUT, -30, 18),      # still out, not yet overdue
            (S.OUT, -96, -24),     # out and overdue
            (S.RETURNED, -120, -72),
            (S.CANCELLED, 72, 120),
        ]
        made = 0
        for i, (status, dep_h, ret_h) in enumerate(plan):
            reg = regs[i % len(regs)]
            etype, reason, dest = EXEAT_REASONS[i % len(EXEAT_REASONS)]
            exeat = ExeatRequest(
                slip_no=self._next_slip_no(),
                registration=reg,
                term=self.term,
                exeat_type=etype,
                reason=reason,
                destination=dest,
                contact_name="Parent / Guardian",
                contact_phone="0700000000",
                expected_departure=now + timedelta(hours=dep_h),
                expected_return=now + timedelta(hours=ret_h),
                status=status,
                source=ExeatRequest.Source.STAFF,
                requested_by=self.admin_user,
            )
            if status in (S.APPROVED, S.REJECTED, S.OUT, S.RETURNED):
                exeat.decided_by = self.admin_user
                exeat.decided_at = now - timedelta(hours=2)
                exeat.decision_note = "Not approved - exams week" if status == S.REJECTED else "Approved"
            if status in (S.OUT, S.RETURNED):
                exeat.checked_out_at = exeat.expected_departure
                exeat.checked_out_by = self.admin_user
                exeat.collected_by_name = "Parent / Guardian"
                exeat.collected_by_id_no = "12345678"
                exeat.collected_by_relationship = "Parent"
            if status == S.RETURNED:
                exeat.checked_in_at = exeat.expected_return - timedelta(hours=1)
                exeat.checked_in_by = self.admin_user
            exeat.save()
            made += 1
        self.stdout.write(f"Exeats: +{made} sample slips.")

    # ------------------------------------------------------------------
    # roll calls
    # ------------------------------------------------------------------
    def _seed_roll_calls(self):
        today = timezone.localdate()
        made_sessions = made_entries = 0

        for dorm in Dormitory.objects.filter(is_active=True):
            current = list(
                BedAllocation.objects.filter(released_at__isnull=True, bed__room__dormitory=dorm)
                .select_related("registration__student")
            )
            if not current:
                continue

            session, created = RollCallSession.objects.get_or_create(
                dormitory=dorm,
                date=today,
                session_type=RollCallSession.SessionType.MORNING,
                defaults={
                    "academic_year": self.year,
                    "term": self.term,
                    "status": RollCallSession.Status.SUBMITTED,
                    "taken_by": self.admin_user,
                    "submitted_at": timezone.now(),
                },
            )
            if not created:
                continue
            made_sessions += 1

            out_regs = set(
                ExeatRequest.objects.filter(status=ExeatRequest.Status.OUT)
                .values_list("registration_id", flat=True)
            )
            for alloc in current:
                if alloc.registration_id in out_regs:
                    status = RollCallEntry.Status.EXEAT
                else:
                    status = random.choices(
                        [RollCallEntry.Status.PRESENT, RollCallEntry.Status.ABSENT, RollCallEntry.Status.SICK],
                        weights=[92, 4, 4],
                    )[0]
                RollCallEntry.objects.create(
                    session=session,
                    registration=alloc.registration,
                    bed_label=alloc.bed_label,
                    status=status,
                )
                made_entries += 1

        self.stdout.write(f"Roll calls: +{made_sessions} sessions, +{made_entries} entries.")

    # ------------------------------------------------------------------
    # fees
    # ------------------------------------------------------------------
    def _seed_fee_rate(self, amount):
        if not self.term:
            self.stdout.write(self.style.WARNING("No term found - skipping fee rate."))
            return
        rate, created = BoardingFeeRate.objects.get_or_create(
            term=self.term, grade_level=None, defaults={"amount": amount}
        )
        self.stdout.write(
            f"Fee rate: {'created' if created else 'already exists'} - KES {rate.amount} for {self.term}."
        )