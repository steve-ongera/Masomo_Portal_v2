"""
procurement/models.py

Controlled procurement workflow:
  Requisition -> Approval -> RFQ -> Quotations -> Evaluation -> Purchase Order
  -> Approval -> GRN -> Inspection -> Supplier Invoice (3-way match) -> Payment

Integrates with the existing `api` app only through:
  * settings.AUTH_USER_MODEL (api.User and its `role`)
  * api.AcademicYear (budgets / reporting period)
  * api.Expense (a paid supplier invoice is posted as an Expense)
Nothing in `api` needs to change.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction
from django.utils import timezone

USER = settings.AUTH_USER_MODEL
ZERO = Decimal("0")

PO_COMMITTED = ["APPROVED", "SENT", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED"]
INVOICE_OPEN = ["RECEIVED", "MATCHED", "DISCREPANCY", "APPROVED"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
class DocumentSequence(models.Model):
    """Gap-free sequential numbers per prefix per year: PR-2026-0047."""

    prefix = models.CharField(max_length=10)
    year = models.PositiveIntegerField()
    last_number = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "proc_document_sequences"
        unique_together = ("prefix", "year")

    @classmethod
    def next(cls, prefix):
        year = timezone.now().year
        with transaction.atomic():
            seq, _ = cls.objects.select_for_update().get_or_create(prefix=prefix, year=year)
            seq.last_number += 1
            seq.save(update_fields=["last_number"])
        return f"{prefix}-{year}-{seq.last_number:04d}"


class NumberedMixin(models.Model):
    NUMBER_PREFIX = "DOC"
    number = models.CharField(max_length=30, unique=True, editable=False, blank=True)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self.number:
            self.number = DocumentSequence.next(self.NUMBER_PREFIX)
        super().save(*args, **kwargs)


class SoftDelete(models.Model):
    is_deleted = models.BooleanField(default=False, db_index=True)

    class Meta:
        abstract = True


# ---------------------------------------------------------------------------
# Configuration: approval chain + budgets
# ---------------------------------------------------------------------------
class ApprovalLevel(models.Model):
    """School-configurable approval chain, e.g. PR: 1=PRINCIPAL. PO: 1=PROCUREMENT, 2=PRINCIPAL."""

    class DocType(models.TextChoices):
        PR = "PR", "Purchase Requisition"
        PO = "PO", "Purchase Order"

    document_type = models.CharField(max_length=2, choices=DocType.choices)
    order = models.PositiveSmallIntegerField()
    role = models.CharField(max_length=20)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "proc_approval_levels"
        unique_together = ("document_type", "order")
        ordering = ["document_type", "order"]

    def __str__(self):
        return f"{self.document_type} L{self.order}: {self.role}"


class Budget(models.Model):
    academic_year = models.ForeignKey("api.AcademicYear", on_delete=models.CASCADE, related_name="proc_budgets")
    department = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "proc_budgets"
        unique_together = ("academic_year", "department")
        ordering = ["department"]

    def __str__(self):
        return f"{self.department} {self.academic_year}: KES {self.amount}"


# ---------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------
class Supplier(NumberedMixin, SoftDelete):
    NUMBER_PREFIX = "SUP"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"
        BLACKLISTED = "BLACKLISTED", "Blacklisted"

    name = models.CharField(max_length=150)
    contact_person = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    category = models.CharField(max_length=80, blank=True, help_text="e.g. Stationery, Lab equipment")
    kra_pin = models.CharField(max_length=20, blank=True)
    bank_name = models.CharField(max_length=100, blank=True)
    bank_account = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_suppliers"
        ordering = ["name"]

    def __str__(self):
        return f"{self.number} {self.name}"


# ---------------------------------------------------------------------------
# Requisition
# ---------------------------------------------------------------------------
class Requisition(NumberedMixin, SoftDelete):
    NUMBER_PREFIX = "PR"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING_APPROVAL", "Pending Approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"

    class Priority(models.TextChoices):
        LOW = "LOW", "Low"
        NORMAL = "NORMAL", "Normal"
        HIGH = "HIGH", "High"
        URGENT = "URGENT", "Urgent"

    title = models.CharField(max_length=150)
    department = models.CharField(max_length=100)
    requested_by = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="proc_requisitions")
    reason = models.TextField(blank=True)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)
    required_by = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    current_level = models.PositiveSmallIntegerField(default=0)
    estimated_total = models.DecimalField(max_digits=14, decimal_places=2, default=ZERO)
    academic_year = models.ForeignKey(
        "api.AcademicYear", on_delete=models.SET_NULL, null=True, blank=True, related_name="proc_requisitions"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_requisitions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.number} {self.title}"


class RequisitionItem(models.Model):
    requisition = models.ForeignKey(Requisition, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=200)
    specification = models.CharField(max_length=255, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    unit = models.CharField(max_length=20, default="pcs")
    estimated_unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=ZERO)

    class Meta:
        db_table = "proc_requisition_items"

    @property
    def line_total(self):
        return self.quantity * self.estimated_unit_cost


# ---------------------------------------------------------------------------
# RFQ + quotations
# ---------------------------------------------------------------------------
class RFQ(NumberedMixin, SoftDelete):
    NUMBER_PREFIX = "RFQ"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        SENT = "SENT", "Sent to Suppliers"
        CLOSED = "CLOSED", "Closed"
        AWARDED = "AWARDED", "Awarded"
        CANCELLED = "CANCELLED", "Cancelled"

    title = models.CharField(max_length=150)
    requisition = models.ForeignKey(Requisition, on_delete=models.SET_NULL, null=True, blank=True, related_name="rfqs")
    issue_date = models.DateField(default=timezone.localdate)
    closing_date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    suppliers = models.ManyToManyField(Supplier, blank=True, related_name="rfqs")
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="proc_rfqs")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_rfqs"
        ordering = ["-created_at"]


class RFQItem(models.Model):
    rfq = models.ForeignKey(RFQ, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=200)
    specification = models.CharField(max_length=255, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    unit = models.CharField(max_length=20, default="pcs")

    class Meta:
        db_table = "proc_rfq_items"


class Quotation(models.Model):
    rfq = models.ForeignKey(RFQ, on_delete=models.CASCADE, related_name="quotations")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="quotations")
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=ZERO)
    delivery_days = models.PositiveIntegerField(default=7)
    warranty_months = models.PositiveIntegerField(default=0)
    valid_until = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    evaluation_notes = models.TextField(blank=True, help_text="Documented reason this quotation was selected.")
    is_selected = models.BooleanField(default=False)
    submitted_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "proc_quotations"
        unique_together = ("rfq", "supplier")
        ordering = ["total_amount"]


class QuotationItem(models.Model):
    quotation = models.ForeignKey(Quotation, on_delete=models.CASCADE, related_name="items")
    rfq_item = models.ForeignKey(RFQItem, on_delete=models.CASCADE, related_name="quoted_items")
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        db_table = "proc_quotation_items"


# ---------------------------------------------------------------------------
# Purchase order
# ---------------------------------------------------------------------------
class PurchaseOrder(NumberedMixin, SoftDelete):
    NUMBER_PREFIX = "PO"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING_APPROVAL", "Pending Approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        SENT = "SENT", "Sent to Supplier"
        PARTIAL = "PARTIALLY_RECEIVED", "Partially Received"
        FULL = "FULLY_RECEIVED", "Fully Received"
        CLOSED = "CLOSED", "Closed"
        CANCELLED = "CANCELLED", "Cancelled"

    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_orders")
    requisition = models.ForeignKey(Requisition, on_delete=models.SET_NULL, null=True, blank=True, related_name="purchase_orders")
    quotation = models.ForeignKey(Quotation, on_delete=models.SET_NULL, null=True, blank=True, related_name="purchase_orders")
    department = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    current_level = models.PositiveSmallIntegerField(default=0)
    order_date = models.DateField(default=timezone.localdate)
    expected_delivery = models.DateField(null=True, blank=True)
    delivery_location = models.CharField(max_length=120, default="School Store")
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=ZERO)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="proc_orders")
    academic_year = models.ForeignKey("api.AcademicYear", on_delete=models.SET_NULL, null=True, blank=True, related_name="proc_orders")
    approved_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_purchase_orders"
        ordering = ["-created_at"]


class POItem(models.Model):
    po = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="items")
    description = models.CharField(max_length=200)
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    unit = models.CharField(max_length=20, default="pcs")
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    received_qty = models.DecimalField(max_digits=10, decimal_places=2, default=ZERO, help_text="Accepted quantity only")

    class Meta:
        db_table = "proc_po_items"

    @property
    def line_total(self):
        return self.quantity * self.unit_price

    @property
    def outstanding(self):
        return self.quantity - self.received_qty


# ---------------------------------------------------------------------------
# Goods received + inspection
# ---------------------------------------------------------------------------
class GoodsReceivedNote(NumberedMixin):
    NUMBER_PREFIX = "GRN"

    class Status(models.TextChoices):
        RECEIVED = "RECEIVED", "Received - Awaiting Inspection"
        ACCEPTED = "ACCEPTED", "Inspected - Accepted"
        REJECTED = "REJECTED", "Inspected - Rejected"

    po = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="grns")
    received_by = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="proc_grns_received")
    received_date = models.DateField(default=timezone.localdate)
    delivery_note_no = models.CharField(max_length=40, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RECEIVED)
    inspected_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="proc_grns_inspected")
    inspected_at = models.DateTimeField(null=True, blank=True)
    inspection_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_grns"
        ordering = ["-created_at"]


class GRNItem(models.Model):
    grn = models.ForeignKey(GoodsReceivedNote, on_delete=models.CASCADE, related_name="items")
    po_item = models.ForeignKey(POItem, on_delete=models.PROTECT, related_name="grn_items")
    received_qty = models.DecimalField(max_digits=10, decimal_places=2)
    accepted_qty = models.DecimalField(max_digits=10, decimal_places=2)
    rejected_qty = models.DecimalField(max_digits=10, decimal_places=2, default=ZERO)
    rejection_reason = models.CharField(max_length=200, blank=True)
    serial_numbers = models.CharField(max_length=255, blank=True)
    expiry_date = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "proc_grn_items"


# ---------------------------------------------------------------------------
# Supplier invoice (3-way match) + payment
# ---------------------------------------------------------------------------
class SupplierInvoice(NumberedMixin, SoftDelete):
    NUMBER_PREFIX = "INV"

    class Status(models.TextChoices):
        RECEIVED = "RECEIVED", "Received"
        MATCHED = "MATCHED", "3-Way Matched"
        DISCREPANCY = "DISCREPANCY", "Discrepancy"
        APPROVED = "APPROVED", "Approved for Payment"
        PAID = "PAID", "Paid"
        REJECTED = "REJECTED", "Rejected"

    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="invoices")
    po = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="invoices")
    invoice_number = models.CharField(max_length=60, help_text="The supplier's own invoice number")
    invoice_date = models.DateField(default=timezone.localdate)
    due_date = models.DateField(null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=ZERO)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.RECEIVED)
    match_result = models.JSONField(default=list, blank=True)
    attachment = models.FileField(upload_to="procurement/invoices/", blank=True, null=True)
    created_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="proc_invoices_recorded")
    approved_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="proc_invoices_approved")
    approved_at = models.DateTimeField(null=True, blank=True)
    approval_comment = models.CharField(max_length=255, blank=True)
    paid_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name="proc_invoices_paid")
    paid_at = models.DateTimeField(null=True, blank=True)
    payment_method = models.CharField(max_length=10, blank=True)
    payment_reference = models.CharField(max_length=60, blank=True)
    expense_id = models.PositiveIntegerField(null=True, blank=True, help_text="api.Expense created when paid")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_supplier_invoices"
        ordering = ["-created_at"]
        unique_together = ("supplier", "invoice_number")  # duplicate-invoice detection


class InvoiceItem(models.Model):
    invoice = models.ForeignKey(SupplierInvoice, on_delete=models.CASCADE, related_name="items")
    po_item = models.ForeignKey(POItem, on_delete=models.PROTECT, related_name="invoice_items")
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        db_table = "proc_invoice_items"


# ---------------------------------------------------------------------------
# Returns, contracts, audit
# ---------------------------------------------------------------------------
class ProcurementReturn(NumberedMixin, SoftDelete):
    NUMBER_PREFIX = "RTN"

    class Status(models.TextChoices):
        RAISED = "RAISED", "Raised"
        RETURNED = "RETURNED", "Returned to Supplier"
        CREDITED = "CREDITED", "Credit Received"

    grn_item = models.ForeignKey(GRNItem, on_delete=models.PROTECT, related_name="returns")
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    reason = models.CharField(max_length=255)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RAISED)
    credit_amount = models.DecimalField(max_digits=14, decimal_places=2, default=ZERO)
    created_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="proc_returns")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_returns"
        ordering = ["-created_at"]


class Contract(SoftDelete):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        EXPIRED = "EXPIRED", "Expired"
        TERMINATED = "TERMINATED", "Terminated"

    reference = models.CharField(max_length=60, unique=True)
    title = models.CharField(max_length=150)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="contracts")
    start_date = models.DateField()
    end_date = models.DateField()
    value = models.DecimalField(max_digits=14, decimal_places=2, default=ZERO)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    document = models.FileField(upload_to="procurement/contracts/", blank=True, null=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_contracts"
        ordering = ["end_date"]


class ApprovalLog(models.Model):
    """Who decided what, when and why - for PRs and POs."""

    document_type = models.CharField(max_length=2)
    document_id = models.PositiveIntegerField()
    document_number = models.CharField(max_length=30)
    level = models.PositiveSmallIntegerField(default=0)
    decision = models.CharField(max_length=12)  # SUBMITTED / APPROVED / REJECTED / CANCELLED
    user = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="proc_approvals")
    comment = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_approval_logs"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["document_type", "document_id"])]


class AuditLog(models.Model):
    user = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name="proc_audit")
    action = models.CharField(max_length=40)
    model = models.CharField(max_length=40)
    object_id = models.PositiveIntegerField(null=True)
    object_ref = models.CharField(max_length=60, blank=True)
    detail = models.CharField(max_length=255, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "proc_audit_logs"
        ordering = ["-created_at"]
