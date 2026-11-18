"""
Save as: api/management/commands/seed_grading_scales.py
(make sure api/management/__init__.py and api/management/commands/__init__.py exist)

Usage:
    python manage.py seed_grading_scales --dry-run          # show what it would create
    python manage.py seed_grading_scales                    # create + publish from the CURRENT term
    python manage.py seed_grading_scales --term 7           # start from a specific term id
    python manage.py seed_grading_scales --draft            # create as drafts so the Exam Officer reviews first
    python manage.py seed_grading_scales --force            # add a NEW VERSION where a class already has a scale

Creates ONE GradingScheme per CBC class, smallest class to Grade 12. Each class gets its own
row, so the Exam Officer can edit any class later (as a new version) without touching the others.
Classes that already have a class-wide scale are skipped unless --force is given.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from api import models, services
from api.grading_api import validate_bands

# --- DATA START -------------------------------------------------------------
# Band = (min %, max %, grade, points, remark)

# 4 levels. Used for Baby Class - Grade 5 (school-based performance levels).
FOUR_LEVEL = [
    (75, 100,   "EE", 4, "Exceeding Expectation"),
    (50, 74.99, "ME", 3, "Meeting Expectation"),
    (25, 49.99, "AE", 2, "Approaching Expectation"),
    (0,  24.99, "BE", 1, "Below Expectation"),
]

# 8 levels. KNEC's scale for KPSEA (Grade 6) and KJSEA (Grade 9); used for Grade 6 and above.
EIGHT_LEVEL = [
    (90, 100,   "EE1", 8, "Exceptional"),
    (75, 89.99, "EE2", 7, "Very Good"),
    (58, 74.99, "ME1", 6, "Good"),
    (41, 57.99, "ME2", 5, "Fair"),
    (31, 40.99, "AE1", 4, "Needs Improvement"),
    (21, 30.99, "AE2", 3, "Below Average"),
    (11, 20.99, "BE1", 2, "Well Below Average"),
    (0,  10.99, "BE2", 1, "Minimal"),
]

# Which scale each class uses. Edit this table if your school does it differently.
# Order here = order printed (smallest class first).
CLASSES = [
    # (class name,   profile name,        scale)
    ("Baby Class",   "Pre-primary",       FOUR_LEVEL),
    ("PP1",          "Pre-primary",       FOUR_LEVEL),
    ("PP2",          "Pre-primary",       FOUR_LEVEL),
    ("Grade 1",      "Lower primary",     FOUR_LEVEL),
    ("Grade 2",      "Lower primary",     FOUR_LEVEL),
    ("Grade 3",      "Lower primary",     FOUR_LEVEL),
    ("Grade 4",      "Upper primary",     FOUR_LEVEL),
    ("Grade 5",      "Upper primary",     FOUR_LEVEL),
    ("Grade 6",      "Upper primary (KPSEA)", EIGHT_LEVEL),
    ("Grade 7",      "Junior school",     EIGHT_LEVEL),
    ("Grade 8",      "Junior school",     EIGHT_LEVEL),
    ("Grade 9",      "Junior school (KJSEA)", EIGHT_LEVEL),
    # Senior school: same 8-level shape as a starting point. Confirm the bands against the
    # KNEC senior-school regulations and edit in Grading Scales if they differ.
    ("Grade 10",     "Senior school",     EIGHT_LEVEL),
    ("Grade 11",     "Senior school",     EIGHT_LEVEL),
    ("Grade 12",     "Senior school",     EIGHT_LEVEL),
]
# --- DATA END ---------------------------------------------------------------


def _key(name):
    return "".join(name.lower().split())


def _bands(scale):
    return [
        {"min_percentage": lo, "max_percentage": hi, "grade_letter": g, "points": p, "remark": r}
        for lo, hi, g, p, r in scale
    ]


class Command(BaseCommand):
    help = "Create a CBC grading scale for every class, Baby Class to Grade 12."

    def add_arguments(self, parser):
        parser.add_argument("--term", type=int, help="Term id the scales start from (default: current term)")
        parser.add_argument("--draft", action="store_true", help="Create as drafts instead of publishing")
        parser.add_argument("--force", action="store_true", help="Add a new version where a scale already exists")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **opts):
        term = (
            models.Term.objects.filter(pk=opts["term"]).first() if opts["term"]
            else models.Term.objects.filter(is_current=True).first()
        )
        if not term:
            raise CommandError("No term found. Set a current term in the Academic Calendar or pass --term <id>.")

        for _, _, scale in CLASSES:
            validate_bands(_bands(scale))      # fail fast if a table above is wrong

        grades = {_key(g.name): g for g in models.GradeLevel.objects.filter(curriculum_type=models.CurriculumType.CBC)}
        status = models.GradingScheme.Status.DRAFT if opts["draft"] else models.GradingScheme.Status.PUBLISHED
        created, skipped, missing = 0, 0, []

        self.stdout.write(f"Starting from {term}; status: {status}{'  (dry run)' if opts['dry_run'] else ''}\n")

        with transaction.atomic():
            for name, profile, scale in CLASSES:
                grade = grades.get(_key(name))
                if not grade:
                    missing.append(name)
                    continue

                existing = models.GradingScheme.objects.filter(
                    curriculum_type=models.CurriculumType.CBC, grade_level=grade, subject__isnull=True
                )
                if existing.exists() and not opts["force"]:
                    skipped += 1
                    self.stdout.write(f"  skip     {name:<11} already has a scale (use --force for a new version)")
                    continue

                version = (existing.order_by("-version").values_list("version", flat=True).first() or 0) + 1
                levels = " / ".join(b[2] for b in scale)
                self.stdout.write(f"  create   {name:<11} {profile:<24} {levels}  (v{version})")
                created += 1
                if opts["dry_run"]:
                    continue

                scheme = models.GradingScheme.objects.create(
                    name=f"{name} - {profile}", curriculum_type=models.CurriculumType.CBC,
                    grade_level=grade, subject=None, effective_from_term=term, version=version,
                    status=status, notes="Seeded by seed_grading_scales.",
                    published_at=timezone.now() if status == models.GradingScheme.Status.PUBLISHED else None,
                )
                models.GradingBand.objects.bulk_create(
                    [models.GradingBand(scheme=scheme, **b) for b in _bands(scale)]
                )

            if opts["dry_run"]:
                transaction.set_rollback(True)

        services.clear_grading_cache()
        self.stdout.write(self.style.SUCCESS(f"\nDone: {created} created, {skipped} skipped."))
        if missing:
            self.stdout.write(self.style.WARNING(
                "No CBC grade level named: " + ", ".join(missing) +
                ". Add them under Grade Levels (curriculum CBC) and run again; existing ones are skipped."
            ))