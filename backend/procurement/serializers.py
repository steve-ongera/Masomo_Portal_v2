from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from . import models as m
from . import services as svc

MIN_QTY = {"min_value": Decimal("0.01")}


class WithItemsSerializer(serializers.ModelSerializer):
    """Parent + nested line items, replaced wholesale on edit (only while the document is still editable)."""

    item_model = None
    fk = None
    editable_statuses = ("DRAFT", "REJECTED")
    reset_status = {"REJECTED": "DRAFT"}

    def _save_items(self, parent, items):
        self.item_model.objects.filter(**{self.fk: parent}).delete()
        self.item_model.objects.bulk_create([self.item_model(**{self.fk: parent}, **i) for i in items])

    def after_items(self, obj):
        pass

    @transaction.atomic
    def create(self, validated):
        items = validated.pop("items", [])
        obj = super().create(validated)
        self._save_items(obj, items)
        self.after_items(obj)
        return obj

    @transaction.atomic
    def update(self, instance, validated):
        status = getattr(instance, "status", None)
        if self.editable_statuses and status not in self.editable_statuses:
            raise serializers.ValidationError("This document can no longer be edited.")
        items = validated.pop("items", None)
        if status in self.reset_status:
            validated["status"] = self.reset_status[status]
        obj = super().update(instance, validated)
        if items is not None:
            self._save_items(obj, items)
        self.after_items(obj)
        return obj


# ------------------------------------------------------------ config -------
class ApprovalLevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.ApprovalLevel
        fields = ["id", "document_type", "order", "role", "is_active"]

    def validate_role(self, v):
        from api.models import User
        if v not in User.Role.values:
            raise serializers.ValidationError("Unknown role.")
        return v


class BudgetSerializer(serializers.ModelSerializer):
    committed = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    year = serializers.CharField(source="academic_year.year", read_only=True)
    academic_year = serializers.PrimaryKeyRelatedField(queryset=m.Budget._meta.get_field("academic_year").remote_field.model.objects.all(), required=False)

    class Meta:
        model = m.Budget
        fields = ["id", "academic_year", "year", "department", "amount", "committed", "remaining"]

    def get_committed(self, o):
        return svc.committed_for(o.academic_year, o.department)

    def get_remaining(self, o):
        return o.amount - svc.committed_for(o.academic_year, o.department)

    def validate(self, a):
        if not self.instance and not a.get("academic_year"):
            year = svc.current_year()
            if not year:
                raise serializers.ValidationError("No current academic year is set.")
            a["academic_year"] = year
        return a


class SupplierSerializer(serializers.ModelSerializer):
    po_count = serializers.IntegerField(read_only=True)
    total_spend = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)

    class Meta:
        model = m.Supplier
        exclude = ["is_deleted"]
        read_only_fields = ["number", "created_at"]


# ------------------------------------------------------ requisitions -------
class RequisitionItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)

    class Meta:
        model = m.RequisitionItem
        fields = ["id", "description", "specification", "quantity", "unit", "estimated_unit_cost", "line_total"]
        extra_kwargs = {"quantity": MIN_QTY}


class RequisitionSerializer(WithItemsSerializer):
    item_model, fk = m.RequisitionItem, "requisition"
    items = RequisitionItemSerializer(many=True)
    requested_by_name = serializers.SerializerMethodField()
    pending_role = serializers.SerializerMethodField()

    class Meta:
        model = m.Requisition
        exclude = ["is_deleted"]
        read_only_fields = ["number", "status", "requested_by", "estimated_total", "current_level", "academic_year", "created_at"]

    def get_requested_by_name(self, o):
        return o.requested_by.get_full_name() or o.requested_by.username

    def get_pending_role(self, o):
        return svc.pending_role("PR", o)

    def after_items(self, obj):
        svc.recalc_requisition(obj)


# ------------------------------------------------------------- RFQ ---------
class RFQItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = m.RFQItem
        fields = ["id", "description", "specification", "quantity", "unit"]
        extra_kwargs = {"quantity": MIN_QTY}


class RFQSerializer(WithItemsSerializer):
    item_model, fk = m.RFQItem, "rfq"
    editable_statuses = ("DRAFT",)
    reset_status = {}
    items = RFQItemSerializer(many=True)
    suppliers = serializers.PrimaryKeyRelatedField(many=True, queryset=m.Supplier.objects.filter(is_deleted=False), required=False)
    supplier_names = serializers.SerializerMethodField()
    requisition_number = serializers.CharField(source="requisition.number", read_only=True, default="")
    quotation_count = serializers.SerializerMethodField()

    class Meta:
        model = m.RFQ
        exclude = ["is_deleted"]
        read_only_fields = ["number", "status", "created_by", "created_at"]

    def get_supplier_names(self, o):
        return [s.name for s in o.suppliers.all()]

    def get_quotation_count(self, o):
        return o.quotations.count()

    def validate(self, a):
        issue = a.get("issue_date") or (self.instance.issue_date if self.instance else None)
        closing = a.get("closing_date") or (self.instance.closing_date if self.instance else None)
        if issue and closing and closing < issue:
            raise serializers.ValidationError({"closing_date": "Closing date cannot be before the issue date."})
        return a


class QuotationItemSerializer(serializers.ModelSerializer):
    description = serializers.CharField(source="rfq_item.description", read_only=True)
    quantity = serializers.DecimalField(source="rfq_item.quantity", max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = m.QuotationItem
        fields = ["id", "rfq_item", "description", "quantity", "unit_price"]


class QuotationSerializer(WithItemsSerializer):
    item_model, fk = m.QuotationItem, "quotation"
    editable_statuses = None
    reset_status = {}
    items = QuotationItemSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    rfq_number = serializers.CharField(source="rfq.number", read_only=True)

    class Meta:
        model = m.Quotation
        fields = ["id", "rfq", "rfq_number", "supplier", "supplier_name", "total_amount", "delivery_days",
                  "warranty_months", "valid_until", "notes", "evaluation_notes", "is_selected", "submitted_at", "items"]
        read_only_fields = ["total_amount", "evaluation_notes", "is_selected", "submitted_at"]

    def validate(self, a):
        rfq = a.get("rfq") or self.instance.rfq
        if rfq.status not in ("SENT", "CLOSED"):
            raise serializers.ValidationError("Quotations can only be recorded against an RFQ that has been sent.")
        if self.instance and self.instance.is_selected:
            raise serializers.ValidationError("The selected quotation is locked.")
        for it in a.get("items", []):
            if it["rfq_item"].rfq_id != rfq.pk:
                raise serializers.ValidationError("A priced line does not belong to this RFQ.")
        return a

    def after_items(self, obj):
        obj.total_amount = sum((i.rfq_item.quantity * i.unit_price for i in obj.items.select_related("rfq_item")), Decimal("0"))
        obj.save(update_fields=["total_amount"])


# -------------------------------------------------------- purchase order ---
class POItemSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=16, decimal_places=2, read_only=True)
    outstanding = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = m.POItem
        fields = ["id", "description", "quantity", "unit", "unit_price", "received_qty", "outstanding", "line_total"]
        read_only_fields = ["received_qty"]
        extra_kwargs = {"quantity": MIN_QTY}


class PurchaseOrderSerializer(WithItemsSerializer):
    item_model, fk = m.POItem, "po"
    items = POItemSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    requisition_number = serializers.CharField(source="requisition.number", read_only=True, default="")
    created_by_name = serializers.SerializerMethodField()
    pending_role = serializers.SerializerMethodField()
    received_pct = serializers.SerializerMethodField()

    class Meta:
        model = m.PurchaseOrder
        exclude = ["is_deleted"]
        read_only_fields = ["number", "status", "created_by", "total_amount", "current_level", "academic_year",
                            "approved_at", "sent_at", "created_at"]

    def get_created_by_name(self, o):
        return o.created_by.get_full_name() or o.created_by.username

    def get_pending_role(self, o):
        return svc.pending_role("PO", o)

    def get_received_pct(self, o):
        items = list(o.items.all())
        ordered = sum(i.quantity for i in items)
        return round(float(sum(min(i.received_qty, i.quantity) for i in items) / ordered * 100), 1) if ordered else 0

    def validate_supplier(self, s):
        if s.status != "ACTIVE":
            raise serializers.ValidationError("Orders can only be raised against active suppliers.")
        return s

    def after_items(self, obj):
        svc.recalc_po(obj)


# ------------------------------------------------------------------ GRN ----
class GRNItemSerializer(serializers.ModelSerializer):
    description = serializers.CharField(source="po_item.description", read_only=True)
    ordered = serializers.DecimalField(source="po_item.quantity", max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = m.GRNItem
        fields = ["id", "po_item", "description", "ordered", "received_qty", "accepted_qty", "rejected_qty",
                  "rejection_reason", "serial_numbers", "expiry_date"]
        read_only_fields = ["accepted_qty"]


class GRNSerializer(serializers.ModelSerializer):
    items = GRNItemSerializer(many=True)
    po_number = serializers.CharField(source="po.number", read_only=True)
    supplier_name = serializers.CharField(source="po.supplier.name", read_only=True)
    received_by_name = serializers.SerializerMethodField()
    inspected_by_name = serializers.SerializerMethodField()

    class Meta:
        model = m.GoodsReceivedNote
        fields = ["id", "number", "po", "po_number", "supplier_name", "received_by", "received_by_name", "received_date",
                  "delivery_note_no", "notes", "status", "inspected_by_name", "inspected_at", "inspection_notes", "items", "created_at"]
        read_only_fields = ["number", "received_by", "status", "inspected_at", "inspection_notes", "created_at"]

    def get_received_by_name(self, o):
        return o.received_by.get_full_name() or o.received_by.username

    def get_inspected_by_name(self, o):
        return (o.inspected_by.get_full_name() or o.inspected_by.username) if o.inspected_by else ""

    def validate(self, a):
        user = self.context["request"].user
        po = a["po"]
        if po.status not in ("APPROVED", "SENT", "PARTIALLY_RECEIVED"):
            raise serializers.ValidationError({"po": "Goods can only be received against an approved order that is not fully received."})
        svc.separation_of_duties(user, po.created_by_id, "Separation of duties: the person who raised the PO cannot receive its goods.")
        lines = []
        for it in a.get("items", []):
            if it["received_qty"] <= 0:
                continue
            pi = it["po_item"]
            if pi.po_id != po.pk:
                raise serializers.ValidationError("A line does not belong to this purchase order.")
            rejected = it.get("rejected_qty") or Decimal("0")
            if rejected < 0 or rejected > it["received_qty"]:
                raise serializers.ValidationError(f"{pi.description}: rejected quantity must be between 0 and the received quantity.")
            accepted = it["received_qty"] - rejected
            room = pi.quantity - pi.received_qty - svc.pending_accepted(pi)
            if accepted > room:
                raise serializers.ValidationError(f"{pi.description}: only {room:g} still outstanding on the order.")
            if rejected and not it.get("rejection_reason"):
                raise serializers.ValidationError(f"{pi.description}: give a reason for the rejected quantity.")
            it["accepted_qty"] = accepted
            lines.append(it)
        if not lines:
            raise serializers.ValidationError("Enter a received quantity for at least one item.")
        a["items"] = lines
        return a

    @transaction.atomic
    def create(self, validated):
        items = validated.pop("items")
        grn = m.GoodsReceivedNote.objects.create(**validated)
        m.GRNItem.objects.bulk_create([m.GRNItem(grn=grn, **i) for i in items])
        return grn


class GRNItemOptionSerializer(serializers.ModelSerializer):
    label = serializers.SerializerMethodField()

    class Meta:
        model = m.GRNItem
        fields = ["id", "label"]

    def get_label(self, o):
        returned = sum((r.quantity for r in o.returns.exclude(status="CREDITED").filter(is_deleted=False)), Decimal("0"))
        return f"{o.grn.number} - {o.po_item.description} (accepted {o.accepted_qty:g}, returned {returned:g})"


# ------------------------------------------------------------- invoices ----
class InvoiceItemSerializer(serializers.ModelSerializer):
    description = serializers.CharField(source="po_item.description", read_only=True)

    class Meta:
        model = m.InvoiceItem
        fields = ["id", "po_item", "description", "quantity", "unit_price"]
        extra_kwargs = {"quantity": MIN_QTY}


class SupplierInvoiceSerializer(WithItemsSerializer):
    item_model, fk = m.InvoiceItem, "invoice"
    editable_statuses = ("RECEIVED", "DISCREPANCY", "MATCHED")
    reset_status = {}
    items = InvoiceItemSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    po_number = serializers.CharField(source="po.number", read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = m.SupplierInvoice
        exclude = ["is_deleted", "expense_id", "approved_by", "paid_by"]
        read_only_fields = ["number", "amount", "status", "match_result", "created_by", "approved_at", "approval_comment",
                            "paid_at", "payment_method", "payment_reference", "created_at", "attachment"]
        extra_kwargs = {"supplier": {"required": False}}

    def get_created_by_name(self, o):
        return (o.created_by.get_full_name() or o.created_by.username) if o.created_by else ""

    def validate(self, a):
        po = a.get("po") or self.instance.po
        if po.status not in ("PARTIALLY_RECEIVED", "FULLY_RECEIVED"):
            raise serializers.ValidationError({"po": "Invoices can only be recorded once goods have been received and accepted."})
        a["supplier"] = po.supplier
        number = a.get("invoice_number") or (self.instance.invoice_number if self.instance else None)
        dup = m.SupplierInvoice.objects.filter(supplier=po.supplier, invoice_number__iexact=number)
        if self.instance:
            dup = dup.exclude(pk=self.instance.pk)
        if dup.exists():
            raise serializers.ValidationError({"invoice_number": f"Duplicate: {po.supplier.name} invoice {number} is already recorded as {dup.first().number}."})
        for it in a.get("items", []):
            if it["po_item"].po_id != po.pk:
                raise serializers.ValidationError("An invoice line does not belong to this purchase order.")
        if "items" in a and not a["items"]:
            raise serializers.ValidationError("Add at least one invoice line.")
        return a

    def after_items(self, obj):
        svc.recalc_invoice(obj)
        svc.run_three_way_match(obj)


# --------------------------------------------------- returns / contracts ----
class ReturnSerializer(serializers.ModelSerializer):
    label = serializers.SerializerMethodField()
    supplier_name = serializers.CharField(source="grn_item.grn.po.supplier.name", read_only=True)
    item_name = serializers.CharField(source="grn_item.po_item.description", read_only=True)
    grn_number = serializers.CharField(source="grn_item.grn.number", read_only=True)

    class Meta:
        model = m.ProcurementReturn
        exclude = ["is_deleted"]
        read_only_fields = ["number", "status", "credit_amount", "created_by", "created_at"]

    def get_label(self, o):
        return f"{o.grn_item.grn.number} - {o.grn_item.po_item.description}"

    def validate(self, a):
        gi = a.get("grn_item") or self.instance.grn_item
        qty = a.get("quantity") or self.instance.quantity
        if gi.grn.status != "ACCEPTED":
            raise serializers.ValidationError({"grn_item": "Only inspected and accepted deliveries can be returned."})
        used = sum((r.quantity for r in gi.returns.filter(is_deleted=False).exclude(pk=getattr(self.instance, "pk", None))), Decimal("0"))
        if qty <= 0 or qty + used > gi.accepted_qty:
            raise serializers.ValidationError({"quantity": f"You can return at most {gi.accepted_qty - used:g} of this item."})
        return a


class ContractSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    days_to_expiry = serializers.SerializerMethodField()

    class Meta:
        model = m.Contract
        exclude = ["is_deleted"]
        read_only_fields = ["document", "created_at"]

    def get_days_to_expiry(self, o):
        from django.utils import timezone
        return (o.end_date - timezone.localdate()).days

    def validate(self, a):
        s, e = a.get("start_date") or self.instance.start_date, a.get("end_date") or self.instance.end_date
        if e < s:
            raise serializers.ValidationError({"end_date": "End date cannot be before the start date."})
        return a


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = m.AuditLog
        fields = ["id", "user_name", "action", "model", "object_ref", "detail", "ip_address", "created_at"]

    def get_user_name(self, o):
        return (o.user.get_full_name() or o.user.username) if o.user else "system"


class ApprovalLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = m.ApprovalLog
        fields = ["id", "document_type", "document_number", "level", "decision", "user_name", "comment", "created_at"]

    def get_user_name(self, o):
        return (o.user.get_full_name() or o.user.username) if o.user else "system"
