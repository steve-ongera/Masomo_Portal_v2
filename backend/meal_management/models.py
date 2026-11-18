import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class MealType(models.TextChoices):
    BREAKFAST = "BREAKFAST", "Breakfast"
    MORNING_SNACK = "MORNING_SNACK", "Morning Snack"
    LUNCH = "LUNCH", "Lunch"
    AFTERNOON_SNACK = "AFTERNOON_SNACK", "Afternoon Snack"
    SUPPER = "SUPPER", "Supper"


MEAL_ORDER = [value for value, _ in MealType.choices]


def _new_card_number():
    return "MC-" + secrets.token_hex(5).upper()


def _new_qr_token():
    return secrets.token_urlsafe(18)


class CafeteriaAttendant(models.Model):
    """
    Marks a user as allowed to scan cards and issue meals. Kept here (not as
    a new User.Role) so the `api` app does not need to change.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cafeteria_profile")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "meal_cafeteria_attendants"

    def __str__(self):
        return f"{self.user} ({'active' if self.is_active else 'inactive'})"


class MealPlan(models.Model):
    class Billing(models.TextChoices):
        INCLUDED = "INCLUDED", "Included in school fees (no deduction)"
        WALLET = "WALLET", "Deducted from the student's meal wallet"

    name = models.CharField(max_length=80)                       # "Full Board", "Day Scholar - Lunch"
    code = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)
    billing_mode = models.CharField(max_length=10, choices=Billing.choices, default=Billing.INCLUDED)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "meal_plans"
        ordering = ["name"]

    def __str__(self):
        return self.name


class MealPlanItem(models.Model):
    """One meal a plan includes, with its price (only used when billing_mode=WALLET)."""

    plan = models.ForeignKey(MealPlan, on_delete=models.CASCADE, related_name="items")
    meal_type = models.CharField(max_length=20, choices=MealType.choices)
    price = models.DecimalField(max_digits=8, decimal_places=2, default=0)

    class Meta:
        db_table = "meal_plan_items"
        unique_together = ("plan", "meal_type")

    def __str__(self):
        return f"{self.plan.code} - {self.meal_type}"


class StudentMealPlan(models.Model):
    """Which plan a student is on for an academic year. No row = not entitled to any meal."""

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="meal_plans")
    plan = models.ForeignKey(MealPlan, on_delete=models.PROTECT, related_name="student_plans")
    academic_year = models.ForeignKey("api.AcademicYear", on_delete=models.CASCADE, related_name="meal_plans")
    is_active = models.BooleanField(default=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    assigned_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "meal_student_plans"
        unique_together = ("student", "academic_year")

    def __str__(self):
        return f"{self.student.admission_no} -> {self.plan.code} ({self.academic_year.year})"


class MealCard(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        LOST = "LOST", "Lost"
        BLOCKED = "BLOCKED", "Blocked"
        EXPIRED = "EXPIRED", "Expired"
        REPLACED = "REPLACED", "Replaced"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="meal_cards")
    card_number = models.CharField(max_length=20, unique=True, default=_new_card_number)  # printed: MC-7F83A92C1B
    qr_token = models.CharField(max_length=64, unique=True, db_index=True, default=_new_qr_token)  # inside the QR
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    issued_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "meal_cards"
        ordering = ["-issued_at"]
        constraints = [
            # a student can hold only ONE active card at a time
            models.UniqueConstraint(
                fields=["student"], condition=Q(status="ACTIVE"), name="meal_one_active_card_per_student"
            )
        ]

    def __str__(self):
        return f"{self.card_number} ({self.status})"


class MealCollection(models.Model):
    """One meal handed over. The unique constraint is what stops a double lunch."""

    class Source(models.TextChoices):
        ONLINE = "ONLINE", "Scanned online"
        OFFLINE_SYNC = "OFFLINE_SYNC", "Scanned offline, synced later"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="meal_collections")
    meal_card = models.ForeignKey(MealCard, on_delete=models.SET_NULL, null=True, blank=True, related_name="collections")
    meal_type = models.CharField(max_length=20, choices=MealType.choices)
    date = models.DateField(db_index=True)
    collected_at = models.DateTimeField(default=timezone.now)
    collected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="meals_issued"
    )
    amount_charged = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    source = models.CharField(max_length=15, choices=Source.choices, default=Source.ONLINE)
    # set by the cafeteria tablet for offline scans, so re-sending a batch can never double-record
    client_uuid = models.UUIDField(null=True, blank=True, unique=True)

    class Meta:
        db_table = "meal_collections"
        unique_together = ("student", "meal_type", "date")
        ordering = ["-collected_at"]
        indexes = [models.Index(fields=["date", "meal_type"])]

    def __str__(self):
        return f"{self.student.admission_no} {self.meal_type} {self.date}"


class MealWallet(models.Model):
    """Optional prepaid balance, used only by plans with billing_mode=WALLET."""

    student = models.OneToOneField("api.StudentProfile", on_delete=models.CASCADE, related_name="meal_wallet")
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "meal_wallets"

    def __str__(self):
        return f"{self.student.admission_no}: KES {self.balance}"


class MealWalletTransaction(models.Model):
    class Kind(models.TextChoices):
        TOPUP = "TOPUP", "Top-up"
        MEAL = "MEAL", "Meal charge"
        REFUND = "REFUND", "Refund"

    wallet = models.ForeignKey(MealWallet, on_delete=models.CASCADE, related_name="transactions")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2, help_text="Signed: negative = money out.")
    balance_after = models.DecimalField(max_digits=10, decimal_places=2)
    meal_type = models.CharField(max_length=20, blank=True)
    reference = models.CharField(max_length=80, blank=True, help_text="M-Pesa code, receipt no, etc.")
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "meal_wallet_transactions"
        ordering = ["-created_at"]
        
        
class MealWalletPayment(models.Model):
    """One M-Pesa STK push a student/parent started to top up the meal wallet."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SUCCESS = "SUCCESS", "Paid"
        FAILED = "FAILED", "Failed"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="meal_wallet_payments")
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    phone = models.CharField(max_length=15)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    checkout_request_id = models.CharField(max_length=100, unique=True, null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    mpesa_receipt = models.CharField(max_length=30, blank=True)
    result_desc = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "meal_wallet_payments"
        ordering = ["-created_at"]