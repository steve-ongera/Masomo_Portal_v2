"""
api/management/commands/seed_allocation.py

    python manage.py seed_allocation
    python manage.py seed_allocation --dry-run
    python manage.py seed_allocation --periods 4 --password password123

STEP 1  Creates 15 teachers (real Kenyan names, default password "password123").
        Safe to re-run: an existing username is left untouched (its password is
        NOT reset).
STEP 2  For the CURRENT academic year, walks every classroom and allocates every
        subject the grade offers (GradeSubject) to one of those teachers by
        creating TeacherSubjectAllocation rows. Existing allocations are never
        changed, so it is safe to re-run after adding classrooms or subjects.

How teachers are picked:
  - The same teacher takes the same subject for every stream of a grade
    (e.g. Form 2 Red + Blue Maths -> one teacher), which is what lets the
    timetable auto-generator combine those lessons into one slot.
  - Otherwise the least-loaded teacher gets it, preferring someone who already
    teaches that subject so each teacher keeps a consistent subject set.
"""
from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api import models

# (first name, middle name, surname)
TEACHERS = [
    ("Grace", "Wanjiku", "Mwangi"),
    ("Peter", "Otieno", "Ochieng"),
    ("Mary", "Akinyi", "Odhiambo"),
    ("John", "Kamau", "Njoroge"),
    ("Esther", "Nyambura", "Kariuki"),
    ("Samuel", "Kipchoge", "Rotich"),
    ("Faith", "Chebet", "Koech"),
    ("David", "Mutua", "Musyoka"),
    ("Lucy", "Wairimu", "Gathogo"),
    ("Joseph", "Barasa", "Wekesa"),
    ("Amina", "Salim", "Mwinyi"),
    ("Daniel", "Kiprono", "Cheruiyot"),
    ("Rose", "Naliaka", "Simiyu"),
    ("Hassan", "Omar", "Bakari"),
    ("Beatrice", "Mwende", "Kioko"),
]


class Command(BaseCommand):
    help = "Create 15 teachers, then allocate current-year subjects across all classes."

    def add_arguments(self, parser):
        parser.add_argument("--password", default="password123", help="Password for NEW teacher accounts.")
        parser.add_argument("--periods", type=int, default=5, help="periods_per_week for each new allocation.")
        parser.add_argument("--dry-run", action="store_true", help="Show what would happen, save nothing.")

    @transaction.atomic
    def handle(self, *args, **opts):
        password, periods, dry_run = opts["password"], opts["periods"], opts["dry_run"]

        year = models.AcademicYear.objects.filter(is_current=True).first()
        if not year:
            raise CommandError("No current academic year is set. Mark one as current first.")

        # ------------------------------------------------------------------
        # STEP 1: teachers
        # ------------------------------------------------------------------
        self.stdout.write(self.style.MIGRATE_HEADING("Step 1: teachers"))
        teachers, created_count = [], 0
        for first, middle, last in TEACHERS:
            username = f"{first}.{last}".lower()
            user, created = models.User.objects.get_or_create(
                username=username,
                defaults={
                    "first_name": first,
                    "last_name": f"{middle} {last}",
                    "role": models.User.Role.TEACHER,
                    "is_active_staff": True,
                },
            )
            if created:
                user.set_password(password)
                user.save()
                created_count += 1
                self.stdout.write(f"  + created  {username:<22} {user.get_full_name()}")
            elif user.role != models.User.Role.TEACHER:
                self.stdout.write(self.style.WARNING(
                    f"  ! {username} already exists with role {user.role}; skipped (not used for allocation)."
                ))
                continue
            else:
                self.stdout.write(f"  = exists   {username:<22} {user.get_full_name()}")
            teachers.append(user)

        if not teachers:
            raise CommandError("No usable teachers available.")

        # ------------------------------------------------------------------
        # STEP 2: allocations for the current academic year
        # ------------------------------------------------------------------
        self.stdout.write(self.style.MIGRATE_HEADING(f"Step 2: allocations for {year.year}"))

        classrooms = list(
            models.ClassRoom.objects.filter(academic_year=year)
            .select_related("grade_level", "stream")
            .order_by("grade_level__level_order", "stream__name")
        )
        if not classrooms:
            raise CommandError(f"No classrooms exist for {year.year}. Create them first.")

        teacher_ids = {t.id for t in teachers}
        load = defaultdict(int)             # teacher_id -> periods per week
        subjects_of = defaultdict(set)      # teacher_id -> {subject_id}
        unit_teacher = {}                   # (subject_id, grade_level_id) -> teacher
        existing = set()                    # (classroom_id, subject_id)

        for a in models.TeacherSubjectAllocation.objects.filter(academic_year=year).select_related("classroom"):
            existing.add((a.classroom_id, a.subject_id))
            unit_teacher.setdefault((a.subject_id, a.classroom.grade_level_id), a.teacher)
            if a.teacher_id in teacher_ids:
                load[a.teacher_id] += a.periods_per_week
                subjects_of[a.teacher_id].add(a.subject_id)

        def pick_teacher(subject_id):
            lowest = min(load[t.id] for t in teachers)
            pool = [t for t in teachers if load[t.id] <= lowest + 2 * periods]
            familiar = [t for t in pool if subject_id in subjects_of[t.id]]
            return min(familiar or pool, key=lambda t: load[t.id])

        created_allocs = skipped = 0
        for classroom in classrooms:
            offered = (
                models.GradeSubject.objects.filter(grade_level=classroom.grade_level)
                .select_related("subject")
                .order_by("subject__name")
            )
            if not offered:
                self.stdout.write(self.style.WARNING(
                    f"  ! {classroom}: its grade has no subjects configured (Grade Offerings)."
                ))
                continue

            for gs in offered:
                subject = gs.subject
                if (classroom.id, subject.id) in existing:
                    skipped += 1
                    continue

                unit = (subject.id, classroom.grade_level_id)
                teacher = unit_teacher.get(unit) or pick_teacher(subject.id)
                unit_teacher[unit] = teacher

                models.TeacherSubjectAllocation.objects.create(
                    teacher=teacher, subject=subject, classroom=classroom,
                    academic_year=year, periods_per_week=periods,
                )
                existing.add((classroom.id, subject.id))
                if teacher.id in teacher_ids:
                    load[teacher.id] += periods
                    subjects_of[teacher.id].add(subject.id)
                created_allocs += 1

        # ------------------------------------------------------------------
        # Summary
        # ------------------------------------------------------------------
        capacity = models.PeriodSlot.objects.filter(slot_type=models.PeriodSlot.SlotType.LESSON).count()
        self.stdout.write(self.style.MIGRATE_HEADING("Workload (periods per week)"))
        for t in teachers:
            note = ""
            if capacity and load[t.id] > capacity:
                note = self.style.WARNING(f"  OVER the week's {capacity} lesson slots")
            self.stdout.write(f"  {t.get_full_name():<30} {load[t.id]:>3}{note}")

        self.stdout.write(self.style.SUCCESS(
            f"\n{created_count} teacher(s) created, {created_allocs} allocation(s) created, "
            f"{skipped} already allocated (left as is)."
        ))
        if capacity:
            self.stdout.write(
                f"Weekly lesson slots in the timetable structure: {capacity}. "
                "Combined streams share a slot, so a teacher slightly over this may still fit."
            )
        else:
            self.stdout.write("No LESSON period slots set yet: set up the Timetable Structure before auto-generating.")

        if dry_run:
            transaction.set_rollback(True)
            self.stdout.write(self.style.WARNING("DRY RUN: nothing was saved."))