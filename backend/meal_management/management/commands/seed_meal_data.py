"""
Seeds demo data for the meal_management app using REAL students from `api`.

    python manage.py seed_meal_data
    python manage.py seed_meal_data --students 60 --days 7
    python manage.py seed_meal_data --flush            # wipe meal data first, then seed
    python manage.py seed_meal_data --seed 7           # reproducible random picks

What it does
  1. Creates 3 meal plans (Day Lunch / Day Lunch + Snack [wallet] / Full Board).
  2. Creates a CAFETERIA user (cafeteria1) to log in with.
  3. Picks random ACTIVE students enrolled in the current academic year.
  4. Assigns plans, issues cards, tops up wallets.
  5. Records meal collections for the last few school days (and today's
     meals that are already "past") by calling the REAL services.issue_meal,
     so the eligibility, wallet and unique-constraint rules are exercised.
  6. Sets up a few scripted scan scenarios and prints their QR tokens so
     you can test the scan desk by pasting them into the code box.

Only touches meal_management tables (plus the cafeteria user). Nothing in
`api` is modified. Refuses to run unless DEBUG is on or --force is passed.
"""
import random
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from api import models as api_models
from meal_management import models, services

MEAL_TIMES = {
    "BREAKFAST": time(7, 15),
    "MORNING_SNACK": time(10, 20),
    "LUNCH": time(12, 30),
    "AFTERNOON_SNACK": time(15, 45),
    "SUPPER": time(18, 30),
}

PLAN_DEFS = [
    {
        "code": "DAY_LUNCH",
        "name": "Day Scholar - Lunch",
        "description": "Lunch only. Included in school fees.",
        "billing_mode": models.MealPlan.Billing.INCLUDED,
        "items": {"LUNCH": "0"},
    },
    {
        "code": "DAY_LUNCH_SNACK",
        "name": "Day Scholar - Lunch + Snack (Wallet)",
        "description": "Lunch KES 100 and morning snack KES 50, paid from the meal wallet.",
        "billing_mode": models.MealPlan.Billing.WALLET,
        "items": {"LUNCH": "100", "MORNING_SNACK": "50"},
    },
    {
        "code": "FULL_BOARD",
        "name": "Full Board",
        "description": "All five meals. Included in boarding fees.",
        "billing_mode": models.MealPlan.Billing.INCLUDED,
        "items": {
            "BREAKFAST": "0", "MORNING_SNACK": "0", "LUNCH": "0",
            "AFTERNOON_SNACK": "0", "SUPPER": "0",
        },
    },
]


class Command(BaseCommand):
    help = "Seed meal plans, cards, wallets and sample collections using random students from api."

    def add_arguments(self, parser):
        parser.add_argument("--students", type=int, default=40, help="How many random students to seed (min 6).")
        parser.add_argument("--days", type=int, default=5, help="How many past days of collections to generate.")
        parser.add_argument("--flush", action="store_true", help="Delete ALL meal_management data first.")
        parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducible picks.")
        parser.add_argument("--username", default="cafeteria1", help="Cafeteria user to create/reuse.")
        parser.add_argument("--password", default="Cafeteria@2026", help="Password if the user is created.")
        parser.add_argument("--force", action="store_true", help="Allow running when DEBUG is off.")

    # ------------------------------------------------------------------
    def handle(self, *args, **opts):
        if not settings.DEBUG and not opts["force"]:
            raise CommandError("Refusing to seed demo data with DEBUG off. Pass --force if you really mean it.")
        if opts["students"] < 6:
            raise CommandError("--students must be at least 6 (the scripted scan scenarios need 6).")

        year = api_models.AcademicYear.objects.filter(is_current=True).first()
        if not year:
            raise CommandError("No current academic year in api. Seed/create the academic calendar first.")

        rng = random.Random(opts["seed"])

        if opts["flush"]:
            self._flush()

        with transaction.atomic():
            plans = self._create_plans()
            cafeteria_user = self._cafeteria_user(opts["username"], opts["password"])

        students = self._pick_students(year, opts["students"], rng)
        self.stdout.write(f"Picked {len(students)} random active students from {year.year}.")

        with transaction.atomic():
            scenarios = self._setup_students(students, year, plans, cafeteria_user, rng)

        stats = self._simulate_collections(students, scenarios, cafeteria_user, opts["days"], rng)

        self._report(plans, cafeteria_user, opts, scenarios, stats)

    # ------------------------------------------------------------------
    def _flush(self):
        with transaction.atomic():
            models.MealCollection.objects.all().delete()
            models.MealWalletTransaction.objects.all().delete()
            models.MealWallet.objects.all().delete()
            models.MealCard.objects.all().delete()
            models.StudentMealPlan.objects.all().delete()
            models.MealPlanItem.objects.all().delete()
            models.MealPlan.objects.all().delete()
        self.stdout.write(self.style.WARNING("Flushed all meal_management data."))

    def _create_plans(self):
        plans = {}
        for d in PLAN_DEFS:
            plan, _ = models.MealPlan.objects.update_or_create(
                code=d["code"],
                defaults={
                    "name": d["name"], "description": d["description"],
                    "billing_mode": d["billing_mode"], "is_active": True,
                },
            )
            plan.items.all().delete()
            models.MealPlanItem.objects.bulk_create([
                models.MealPlanItem(plan=plan, meal_type=meal, price=Decimal(price))
                for meal, price in d["items"].items()
            ])
            plans[d["code"]] = plan
        return plans

    def _cafeteria_user(self, username, password):
        role = getattr(api_models.User.Role, "CAFETERIA", None)
        if role is None:
            raise CommandError("api.User.Role has no CAFETERIA role yet. Add it and run makemigrations first.")
        user = api_models.User.objects.filter(username=username).first()
        if user:
            return user
        user = api_models.User(
            username=username, first_name="Grace", last_name="Atieno",
            role=role, phone_number="0700000000",
        )
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(f"Created cafeteria user '{username}'."))
        return user

    def _pick_students(self, year, count, rng):
        ids = sorted(
            api_models.Enrollment.objects.filter(
                academic_year=year,
                status=api_models.Enrollment.Status.ACTIVE,
                student__is_active=True,
            ).values_list("student_id", flat=True).distinct()
        )
        if len(ids) < 6:
            raise CommandError(
                f"Only {len(ids)} active enrolled students in {year.year}; need at least 6. Seed students first."
            )
        chosen = rng.sample(ids, min(count, len(ids)))
        by_id = {
            s.id: s for s in api_models.StudentProfile.objects.filter(id__in=chosen).select_related("user")
        }
        return [by_id[i] for i in chosen]

    # ------------------------------------------------------------------
    def _assign(self, student, year, plan, user):
        models.StudentMealPlan.objects.update_or_create(
            student=student, academic_year=year,
            defaults={"plan": plan, "is_active": True, "assigned_by": user},
        )

    def _setup_students(self, students, year, plans, user, rng):
        """
        First 6 students get scripted scenarios for testing the scan desk;
        the rest get a random plan. Returns {student_id: scenario_label}.
        """
        scenarios = {}
        wallet_plan = plans["DAY_LUNCH_SNACK"]

        for idx, student in enumerate(students):
            card = services.issue_card(student, issued_by=user)

            if idx == 0:
                self._assign(student, year, plans["FULL_BOARD"], user)
                services.set_card_status(card, models.MealCard.Status.LOST)
                scenarios[student.id] = ("LOST card", "NOT ELIGIBLE: card is lost", card)
            elif idx == 1:
                scenarios[student.id] = ("No meal plan", "NOT ELIGIBLE: not on a meal plan", card)
            elif idx == 2:
                self._assign(student, year, wallet_plan, user)
                services.topup_wallet(student, 20, user, reference="SEED-LOW")
                scenarios[student.id] = ("Low wallet (KES 20)", "NOT ELIGIBLE for LUNCH: insufficient wallet", card)
            elif idx == 3:
                self._assign(student, year, plans["DAY_LUNCH"], user)
                scenarios[student.id] = ("Happy path", "ELIGIBLE for LUNCH today", card)
            elif idx == 4:
                self._assign(student, year, plans["DAY_LUNCH"], user)
                scenarios[student.id] = ("Already collected", "NOT ELIGIBLE for LUNCH: already collected today", card)
            elif idx == 5:
                self._assign(student, year, plans["FULL_BOARD"], user)
                scenarios[student.id] = ("Boarder", "ELIGIBLE for any meal not yet collected", card)
            else:
                plan = rng.choices(
                    [plans["DAY_LUNCH"], wallet_plan, plans["FULL_BOARD"]], weights=[50, 25, 25]
                )[0]
                self._assign(student, year, plan, user)
                if plan.billing_mode == models.MealPlan.Billing.WALLET:
                    services.topup_wallet(student, rng.choice([2000, 3000, 5000]), user, reference="SEED-TOPUP")

        return scenarios

    # ------------------------------------------------------------------
    def _simulate_collections(self, students, scenarios, user, days, rng):
        stats = {"recorded": 0, "rejected": 0}
        now_local = timezone.localtime().replace(tzinfo=None)
        today = timezone.localdate()

        # scripted: student #5 (index 4) already collected today's lunch
        already = students[4]
        card = models.MealCard.objects.filter(student=already, status=models.MealCard.Status.ACTIVE).first()
        try:
            services.issue_meal(card, "LUNCH", user)
            stats["recorded"] += 1
        except services.MealNotAllowed:
            stats["rejected"] += 1

        scripted_ids = {s.id for i, s in enumerate(students) if i < 6}
        pool = [s for s in students if s.id not in scripted_ids]

        for offset in range(days, -1, -1):
            day = today - timedelta(days=offset)
            if day.weekday() >= 5:  # skip Saturday/Sunday
                continue
            for student in pool:
                card = models.MealCard.objects.filter(student=student, status=models.MealCard.Status.ACTIVE).first()
                sp = models.StudentMealPlan.objects.filter(student=student).select_related("plan").first()
                if not card or not sp:
                    continue
                for item in sp.plan.items.all():
                    at = datetime.combine(day, MEAL_TIMES[item.meal_type])
                    if day == today and at > now_local:
                        continue  # that meal hasn't happened yet today
                    if rng.random() > 0.88:  # ~12% don't turn up
                        continue
                    when = timezone.make_aware(at + timedelta(minutes=rng.randint(0, 25)))
                    try:
                        services.issue_meal(card, item.meal_type, user, when=when)
                        stats["recorded"] += 1
                    except services.MealNotAllowed:
                        stats["rejected"] += 1
        return stats

    # ------------------------------------------------------------------
    def _report(self, plans, user, opts, scenarios, stats):
        out = self.stdout.write
        out("")
        out(self.style.SUCCESS("Meal data seeded."))
        out(f"  Plans:        {len(plans)}")
        out(f"  Cards:        {models.MealCard.objects.count()}")
        out(f"  Wallets:      {models.MealWallet.objects.count()}")
        out(f"  Collections:  {models.MealCollection.objects.count()} ({stats['rejected']} skipped by the rules)")
        out("")
        out(f"  Cafeteria login:  {user.username} / {opts['password']}  (password only set if the user was newly created)")
        out("")
        out("  Scripted scan tests - paste a token into the Scan Desk code box:")
        for student_id, (label, expected, card) in scenarios.items():
            student = card.student
            out(f"   - {label:<22} {student.admission_no:<10} {student.user.get_full_name():<26} {card.qr_token}")
            out(f"       expect: {expected}")
        out("")
        out("  Note: scenarios assume the LUNCH meal is selected on the scan desk.")