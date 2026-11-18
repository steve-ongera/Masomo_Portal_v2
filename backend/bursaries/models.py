"""
bursaries/models.py
Bursaries, scholarships and fee discounts.

Two ways money moves, decided per scheme (AidScheme.settlement):

  WAIVER          The school absorbs it (sibling / staff-child discounts,
                  school scholarships). The term charge on the student's
                  Invoice is REDUCED, so the ledger balance drops at once.

  FUNDER_REMITS   An outside funder pays (NG-CDF, county, sponsor). The invoice
                  is NOT reduced. We record what the funder PLEDGED for the term
                  (AwardTerm.amount). When the cheque/EFT arrives it is recorded
                  as a FundingRemittance and allocated to students; each
                  allocation posts a normal Payment (method=BURSARY) with its own
                  receipt number, so the ledger, receipts and corrections keep
                  working unchanged.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Sum

USER = settings.AUTH_USER_MODEL


class ValueType(models.TextChoices):
    PERCENT = "PERCENT", "Percentage of term fee"
    FIXED = "FIXED", "Fixed amount per term (KES)"


class FundingSource(models.Model):
    class SourceType(models.TextChoices):
        CDF = "CDF", "NG-CDF (Constituency Development Fund)"
        COUNTY = "COUNTY", "County Government"
        GOVERNMENT = "GOVERNMENT", "Other Government / Ministry"
        SPONSOR = "SPONSOR", "Individual / Corporate Sponsor"
        NGO = "NGO", "NGO / Foundation"
        CHURCH = "CHURCH", "Church / Community"
        ALUMNI = "ALUMNI", "Alumni / Old Students"
        SCHOOL = "SCHOOL", "School-funded"

    name = models.CharField(max_length=150)
    source_type = models.CharField(max_length=12, choices=SourceType.choices)
    contact_person = models.CharField(max_length=120, blank=True)
    phone_number = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    location = models.CharField(max_length=120, blank=True, help_text="Constituency or county")
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "bursary_funding_sources"
        ordering = ["name"]

    def __str__(self):
        return self.name


class AidScheme(models.Model):
    """The policy: what kind of aid, who pays, how much, and any automatic rule."""

    class Kind(models.TextChoices):
        BURSARY = "BURSARY", "Bursary"
        SCHOLARSHIP = "SCHOLARSHIP", "Scholarship"
        DISCOUNT = "DISCOUNT", "Fee discount"

    class Rule(models.TextChoices):
        MANUAL = "MANUAL", "Awarded case by case"
        SIBLING = "SIBLING", "Sibling discount (automatic detection)"
        STAFF_CHILD = "STAFF_CHILD", "Staff-child discount (suggested from staff records)"

    class Settlement(models.TextChoices):
        WAIVER = "WAIVER", "School absorbs it (reduces the fee charged)"
        FUNDER_REMITS = "FUNDER_REMITS", "Funder pays the school (tracked as a receivable)"

    name = models.CharField(max_length=120)
    code = models.CharField(max_length=20, unique=True)
    kind = models.CharField(max_length=12, choices=Kind.choices)
    rule = models.CharField(max_length=12, choices=Rule.choices, default=Rule.MANUAL)
    source = models.ForeignKey(
        FundingSource, on_delete=models.PROTECT, null=True, blank=True, related_name="schemes",
        help_text="Leave blank for school-funded schemes.",
    )
    settlement = models.CharField(max_length=15, choices=Settlement.choices, default=Settlement.WAIVER)
    value_type = models.CharField(max_length=8, choices=ValueType.choices, default=ValueType.PERCENT)
    value = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sibling_tiers = models.JSONField(
        default=list, blank=True,
        help_text='Only for the sibling rule, e.g. [{"rank": 2, "percent": 5}, {"rank": 3, "percent": 10}]',
    )
    grade_levels = models.ManyToManyField(
        "api.GradeLevel", blank=True, related_name="aid_schemes",
        help_text="Leave empty to offer at every grade.",
    )
    default_duration_terms = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Blank = runs until it is ended or suspended."
    )
    priority = models.PositiveSmallIntegerField(default=100, help_text="Lower numbers are applied first.")
    stackable = models.BooleanField(
        default=True,
        help_text="If off, when this scheme applies only the single largest award on an invoice is used.",
    )
    auto_approve = models.BooleanField(
        default=False, help_text="Awards created by the sibling / staff-child finder skip the approval step."
    )
    budget_per_year = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="Maximum total this scheme may give in one academic year. Blank = no cap.",
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "bursary_schemes"
        ordering = ["priority", "name"]

    def __str__(self):
        return self.name


class Award(models.Model):
    """One student receiving one scheme, from a start term until an optional end term."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        SUSPENDED = "SUSPENDED", "Suspended"
        ENDED = "ENDED", "Ended"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="aid_awards")
    scheme = models.ForeignKey(AidScheme, on_delete=models.PROTECT, related_name="awards")
    value_type = models.CharField(max_length=8, choices=ValueType.choices)
    value = models.DecimalField(max_digits=12, decimal_places=2)
    start_term = models.ForeignKey("api.Term", on_delete=models.PROTECT, related_name="+")
    end_term = models.ForeignKey("api.Term", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    reference_no = models.CharField(max_length=60, blank=True, help_text="Funder's award letter / file number")
    staff_parent = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    sibling_rank = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    decision_note = models.CharField(max_length=255, blank=True)
    requested_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="+")
    requested_at = models.DateTimeField(auto_now_add=True)
    decided_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "bursary_awards"
        ordering = ["-requested_at"]
        indexes = [models.Index(fields=["student", "status"])]

    def __str__(self):
        return f"{self.student.admission_no} - {self.scheme.name} [{self.status}]"


class AwardTerm(models.Model):
    """What an award actually did (or was skipped from doing) in one term."""

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Applied"
        REVERSED = "REVERSED", "Reversed"
        SKIPPED = "SKIPPED", "Skipped"

    award = models.ForeignKey(Award, on_delete=models.CASCADE, related_name="terms")
    term = models.ForeignKey("api.Term", on_delete=models.PROTECT, related_name="+")
    invoice = models.ForeignKey("api.Invoice", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    gross_fee = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    received = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    settlement = models.CharField(max_length=15, choices=AidScheme.Settlement.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "bursary_award_terms"
        unique_together = ("award", "term")
        ordering = ["term__start_date"]

    @property
    def outstanding(self):
        """Still expected from the funder (funder-paid entries only)."""
        if self.settlement != AidScheme.Settlement.FUNDER_REMITS or self.status != self.Status.ACTIVE:
            return Decimal("0")
        return self.amount - self.received


class FundingRemittance(models.Model):
    """Money actually received from a funder (one cheque / EFT / M-Pesa), before it is split among students."""

    class Method(models.TextChoices):
        BANK = "BANK", "Bank transfer / EFT"
        CHEQUE = "CHEQUE", "Cheque"
        MPESA = "MPESA", "M-Pesa"
        CASH = "CASH", "Cash"

    source = models.ForeignKey(FundingSource, on_delete=models.PROTECT, related_name="remittances")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    method = models.CharField(max_length=10, choices=Method.choices, default=Method.CHEQUE)
    reference = models.CharField(max_length=60, help_text="Cheque no., EFT or M-Pesa reference")
    received_on = models.DateField()
    notes = models.CharField(max_length=255, blank=True)
    recorded_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "bursary_remittances"
        ordering = ["-received_on", "-id"]

    @property
    def allocated(self):
        return self.allocations.filter(reversed=False).aggregate(t=Sum("amount"))["t"] or Decimal("0")

    @property
    def unallocated(self):
        return self.amount - self.allocated

    def __str__(self):
        return f"{self.source.name} - KES {self.amount} ({self.reference})"


class RemittanceAllocation(models.Model):
    remittance = models.ForeignKey(FundingRemittance, on_delete=models.CASCADE, related_name="allocations")
    award_term = models.ForeignKey(AwardTerm, on_delete=models.PROTECT, related_name="allocations")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    receipt_no = models.CharField(max_length=30)
    created_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    reversed = models.BooleanField(default=False)
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reverse_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "bursary_allocations"
        ordering = ["-created_at"]


class AidSettings(models.Model):
    """Single row of school-wide limits."""

    max_discount_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=100,
        help_text="School-funded discounts on one invoice can never exceed this % of the term fee.",
    )

    class Meta:
        db_table = "bursary_settings"

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class AidAuditLog(models.Model):
    award = models.ForeignKey(Award, on_delete=models.CASCADE, related_name="audit")
    action = models.CharField(max_length=20)
    detail = models.CharField(max_length=255, blank=True)
    performed_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "bursary_audit"
        ordering = ["-created_at"]