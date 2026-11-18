"""Business rules: approvals, budgets, receiving, 3-way match, payment, audit."""
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from . import models as m

ZERO = Decimal("0")


# ----------------------------------------------------------------- audit ---
def audit(request, action, obj, detail=""):
    ip, user = None, None
    if request is not None:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        ip = (xff.split(",")[0].strip() if xff else request.META.get("REMOTE_ADDR")) or None
        user = request.user if request.user.is_authenticated else None
    m.AuditLog.objects.create(
        user=user, action=action, model=obj.__class__.__name__, object_id=obj.pk,
        object_ref=getattr(obj, "number", "") or str(obj.pk), detail=str(detail)[:255], ip_address=ip,
    )


def current_year():
    from api.models import AcademicYear
    return AcademicYear.objects.filter(is_current=True).first()


def separation_of_duties(user, other_user_id, message):
    """Block the same person doing two incompatible steps. ADMIN is exempt so a one-person school is not locked out."""
    if user.role != "ADMIN" and other_user_id and user.pk == other_user_id:
        raise PermissionDenied(message)


# -------------------------------------------------------------- approvals ---
def approval_roles(doc_type):
    roles = list(
        m.ApprovalLevel.objects.filter(document_type=doc_type, is_active=True)
        .order_by("order").values_list("role", flat=True)
    )
    return roles or ["PRINCIPAL"]  # sensible default when the school has not configured a chain


def pending_role(doc_type, doc):
    if doc.status != "PENDING_APPROVAL":
        return None
    roles = approval_roles(doc_type)
    return roles[min(max(doc.current_level, 1), len(roles)) - 1]


def log_approval(doc_type, doc, user, decision, comment="", level=0):
    m.ApprovalLog.objects.create(
        document_type=doc_type, document_id=doc.pk, document_number=doc.number,
        level=level, decision=decision, user=user, comment=comment[:255],
    )


def submit_for_approval(doc, doc_type, user, request):
    if doc.status not in ("DRAFT", "REJECTED"):
        raise ValidationError("Only draft or rejected documents can be submitted.")
    if not doc.items.exists():
        raise ValidationError("Add at least one line item before submitting.")
    doc.status, doc.current_level = "PENDING_APPROVAL", 1
    doc.save(update_fields=["status", "current_level"])
    log_approval(doc_type, doc, user, "SUBMITTED", level=1)
    audit(request, "SUBMIT", doc)


@transaction.atomic
def decide(doc, doc_type, user, decision, comment, owner_id, request, override_budget=False):
    if doc.status != "PENDING_APPROVAL":
        raise ValidationError("This document is not awaiting approval.")
    if user.pk == owner_id:
        raise PermissionDenied("Separation of duties: you cannot approve a document you created.")
    role = pending_role(doc_type, doc)
    if not (user.role == "ADMIN" or user.role == role):
        raise PermissionDenied(f"This step must be approved by: {role}.")
    level = doc.current_level
    if decision == "REJECTED":
        if not (comment or "").strip():
            raise ValidationError({"comment": "A reason is required when rejecting."})
        doc.status = "REJECTED"
    elif level >= len(approval_roles(doc_type)):
        if doc_type == "PO":
            check_budget(doc, user, override_budget)
            doc.approved_at = timezone.now()
        doc.status = "APPROVED"
    else:
        doc.current_level = level + 1
    doc.save()
    log_approval(doc_type, doc, user, decision, comment or "", level)
    audit(request, decision, doc, comment or "")


def cancel_document(doc, doc_type, user, request):
    if doc.status not in ("DRAFT", "PENDING_APPROVAL", "REJECTED", "APPROVED"):
        raise ValidationError("This document can no longer be cancelled.")
    if doc_type == "PO" and doc.grns.exists():
        raise ValidationError("A purchase order with goods received cannot be cancelled.")
    doc.status = "CANCELLED"
    doc.save(update_fields=["status"])
    log_approval(doc_type, doc, user, "CANCELLED")
    audit(request, "CANCEL", doc)


# ----------------------------------------------------------------- budget ---
def committed_for(year, department, exclude_pk=None):
    qs = m.PurchaseOrder.objects.filter(
        academic_year=year, department__iexact=department, status__in=m.PO_COMMITTED, is_deleted=False
    )
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    return qs.aggregate(s=Sum("total_amount"))["s"] or ZERO


def check_budget(po, user, override=False):
    year, dept = po.academic_year or current_year(), (po.department or "").strip()
    if not (year and dept):
        return
    budget = m.Budget.objects.filter(academic_year=year, department__iexact=dept).first()
    if not budget:
        return
    committed = committed_for(year, dept, po.pk)
    if committed + po.total_amount > budget.amount and not (override and user.role == "ADMIN"):
        raise ValidationError(
            f"Budget exceeded for {dept}: budget KES {budget.amount:,.0f}, already committed "
            f"KES {committed:,.0f}, this order KES {po.total_amount:,.0f}. An administrator can override."
        )


# ----------------------------------------------------------------- totals ---
def recalc_requisition(pr):
    pr.estimated_total = sum((i.line_total for i in pr.items.all()), ZERO)
    pr.save(update_fields=["estimated_total"])


def recalc_po(po):
    po.total_amount = sum((i.line_total for i in po.items.all()), ZERO)
    po.save(update_fields=["total_amount"])


# -------------------------------------------------------------- receiving ---
def pending_accepted(po_item):
    """Accepted quantity sitting on GRNs that have not been inspected yet."""
    return m.GRNItem.objects.filter(po_item=po_item, grn__status="RECEIVED").aggregate(s=Sum("accepted_qty"))["s"] or ZERO


def refresh_po_receipt_status(po):
    if po.status not in ("APPROVED", "SENT", "PARTIALLY_RECEIVED", "FULLY_RECEIVED"):
        return
    items = list(po.items.all())
    if not items:
        return
    if all(i.received_qty >= i.quantity for i in items):
        new = "FULLY_RECEIVED"
    elif any(i.received_qty > 0 for i in items):
        new = "PARTIALLY_RECEIVED"
    else:
        new = "SENT" if po.sent_at else "APPROVED"
    if new != po.status:
        po.status = new
        po.save(update_fields=["status"])


@transaction.atomic
def inspect_grn(grn, user, decision, notes, request):
    if grn.status != "RECEIVED":
        raise ValidationError("This GRN has already been inspected.")
    separation_of_duties(user, grn.received_by_id, "Separation of duties: the person who received the goods cannot inspect them.")
    if decision == "REJECTED" and not (notes or "").strip():
        raise ValidationError({"notes": "Explain why the delivery is rejected."})
    grn.status, grn.inspected_by, grn.inspected_at = decision, user, timezone.now()
    grn.inspection_notes = notes or ""
    grn.save()
    if decision == "ACCEPTED":
        for gi in grn.items.select_related("po_item"):
            gi.po_item.received_qty += gi.accepted_qty
            gi.po_item.save(update_fields=["received_qty"])
        refresh_po_receipt_status(grn.po)
    audit(request, f"INSPECT_{decision}", grn, notes or "")


@transaction.atomic
def mark_returned(ret, request):
    if ret.status != "RAISED":
        raise ValidationError("Only a raised return can be marked as returned.")
    pi = ret.grn_item.po_item
    pi.received_qty = max(ZERO, pi.received_qty - ret.quantity)
    pi.save(update_fields=["received_qty"])
    refresh_po_receipt_status(pi.po)
    ret.status = "RETURNED"
    ret.save(update_fields=["status"])
    audit(request, "RETURNED", ret)


# ------------------------------------------------------- invoice matching ---
def recalc_invoice(inv):
    inv.amount = sum((i.quantity * i.unit_price for i in inv.items.all()), ZERO)
    inv.save(update_fields=["amount"])


def run_three_way_match(inv):
    """PO <-> GRN <-> Invoice. Flags quantity/price differences instead of silently processing."""
    issues = []
    for it in inv.items.select_related("po_item"):
        pi = it.po_item
        before = (
            m.InvoiceItem.objects.filter(po_item=pi, invoice__is_deleted=False)
            .exclude(invoice=inv).exclude(invoice__status="REJECTED")
            .aggregate(s=Sum("quantity"))["s"] or ZERO
        )
        if it.quantity + before > pi.received_qty:
            issues.append(
                f"{pi.description}: invoiced {it.quantity + before:g} in total but only "
                f"{pi.received_qty:g} accepted into stores (ordered {pi.quantity:g})."
            )
        if it.unit_price != pi.unit_price:
            issues.append(f"{pi.description}: invoice price {it.unit_price:,.2f} differs from PO price {pi.unit_price:,.2f}.")
    inv.match_result = issues
    if inv.status in ("RECEIVED", "MATCHED", "DISCREPANCY"):
        inv.status = "DISCREPANCY" if issues else "MATCHED"
    inv.save(update_fields=["match_result", "status"])


def approve_invoice(inv, user, comment, request, override=False):
    if inv.status not in ("MATCHED", "DISCREPANCY"):
        raise ValidationError("Only matched invoices (or discrepancies overridden by an admin) can be approved.")
    if inv.status == "DISCREPANCY":
        if not (override and user.role == "ADMIN" and (comment or "").strip()):
            raise ValidationError("This invoice has discrepancies. An administrator must approve with an override and a comment.")
    separation_of_duties(user, inv.created_by_id, "Separation of duties: you recorded this invoice, someone else must approve it.")
    inv.status, inv.approved_by, inv.approved_at, inv.approval_comment = "APPROVED", user, timezone.now(), (comment or "")[:255]
    inv.save()
    audit(request, "APPROVE", inv, comment or "")


def record_expense(inv, user, method, reference):
    """Post the payment to the existing Finance expenses so school reports stay complete."""
    try:
        from api.models import AcademicYear, Expense, ExpenseCategory, Term
    except Exception:
        return None
    cat, _ = ExpenseCategory.objects.get_or_create(code="PROCUREMENT", defaults={"name": "Procurement"})
    exp = Expense.objects.create(
        category=cat, item_name=f"{inv.po.number} / {inv.number}"[:150],
        description=f"Supplier invoice {inv.invoice_number} ({inv.supplier.name})",
        quantity=1, unit_cost=inv.amount, vendor=inv.supplier.name[:150],
        payment_method=method if method in ("MPESA", "BANK", "CASH", "CHEQUE") else "BANK",
        reference=(reference or inv.invoice_number)[:60],
        academic_year=AcademicYear.objects.filter(is_current=True).first(),
        term=Term.objects.filter(is_current=True).first(),
        expense_date=timezone.localdate(), recorded_by=user,
    )
    return exp.pk


@transaction.atomic
def pay_invoice(inv, user, method, reference, request):
    if inv.status != "APPROVED":
        raise ValidationError("Only approved invoices can be paid.")
    separation_of_duties(user, inv.po.created_by_id, "Separation of duties: the person who raised the PO cannot authorise its payment.")
    inv.status, inv.paid_by, inv.paid_at = "PAID", user, timezone.now()
    inv.payment_method, inv.payment_reference = method or "BANK", (reference or "")[:60]
    inv.expense_id = record_expense(inv, user, method, reference)
    inv.save()
    po = inv.po
    if po.status == "FULLY_RECEIVED":
        received_value = sum((i.received_qty * i.unit_price for i in po.items.all()), ZERO)
        paid = po.invoices.filter(status="PAID", is_deleted=False).aggregate(s=Sum("amount"))["s"] or ZERO
        if paid >= received_value:
            po.status = "CLOSED"
            po.save(update_fields=["status"])
    audit(request, "PAY", inv, f"{method} {reference or ''}")
