import csv
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status as http, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from . import models as m
from . import serializers as s
from . import services as svc
from .permissions import MANAGE, REQUESTERS, STORE, VIEW_ALL, ProcPermission

ZERO = Decimal("0")


def num(x):
    return float(x or 0)


class ProcPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 1000


def apply_filters(qs, request, fields):
    for f in fields:
        v = request.query_params.get(f)
        if v not in (None, ""):
            qs = qs.filter(**{f: v})
    return qs


class ProcViewSet(viewsets.ModelViewSet):
    permission_classes = [ProcPermission]
    pagination_class = ProcPagination
    read_roles, write_roles, action_roles = VIEW_ALL, MANAGE, {}
    filter_fields = []
    deletable_statuses = ("DRAFT", "REJECTED", "CANCELLED")
    create_extra = None  # callable(request) -> dict

    def get_queryset(self):
        qs = super().get_queryset()
        if hasattr(self.queryset.model, "is_deleted"):
            qs = qs.filter(is_deleted=False)
        return apply_filters(qs, self.request, self.filter_fields)

    def perform_create(self, serializer):
        extra = self.create_extra(self.request) if self.create_extra else {}
        obj = serializer.save(**extra)
        svc.audit(self.request, "CREATE", obj)

    def perform_update(self, serializer):
        obj = serializer.save()
        svc.audit(self.request, "UPDATE", obj)

    def perform_destroy(self, obj):
        st = getattr(obj, "status", None)
        if st is not None and st not in self.deletable_statuses:
            raise ValidationError(f"A document in status {st} cannot be deleted. Cancel it instead.")
        obj.is_deleted = True
        obj.save(update_fields=["is_deleted"])
        svc.audit(self.request, "DELETE", obj)


# ------------------------------------------------------------------ config --
class ApprovalLevelViewSet(ProcViewSet):
    queryset = m.ApprovalLevel.objects.all()
    serializer_class = s.ApprovalLevelSerializer
    write_roles = set()

    def perform_destroy(self, obj):
        obj.delete()


class BudgetViewSet(ProcViewSet):
    queryset = m.Budget.objects.select_related("academic_year")
    serializer_class = s.BudgetSerializer
    write_roles = set()

    def perform_destroy(self, obj):
        obj.delete()


class SupplierViewSet(ProcViewSet):
    queryset = m.Supplier.objects.annotate(
        po_count=Count("purchase_orders", filter=Q(purchase_orders__status__in=m.PO_COMMITTED), distinct=True),
        total_spend=Sum("purchase_orders__total_amount", filter=Q(purchase_orders__status__in=m.PO_COMMITTED)),
    )
    serializer_class = s.SupplierSerializer
    filter_fields = ["status"]

    def perform_destroy(self, obj):
        if obj.purchase_orders.exclude(status__in=["CLOSED", "CANCELLED", "REJECTED", "DRAFT"]).exists():
            raise ValidationError("This supplier has open purchase orders. Mark it inactive instead.")
        obj.is_deleted = True
        obj.save(update_fields=["is_deleted"])
        svc.audit(self.request, "DELETE", obj)


# ----------------------------------------------------------- approval flow --
class ApprovalFlowMixin:
    doc_type = None
    owner_field = None

    def _owner_id(self, obj):
        return getattr(obj, self.owner_field + "_id")

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        obj = self.get_object()
        svc.submit_for_approval(obj, self.doc_type, request.user, request)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        obj = self.get_object()
        svc.decide(obj, self.doc_type, request.user, "APPROVED", request.data.get("comment", ""),
                   self._owner_id(obj), request, bool(request.data.get("override_budget")))
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        obj = self.get_object()
        svc.decide(obj, self.doc_type, request.user, "REJECTED", request.data.get("comment", ""), self._owner_id(obj), request)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        obj = self.get_object()
        svc.cancel_document(obj, self.doc_type, request.user, request)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        obj = self.get_object()
        logs = m.ApprovalLog.objects.filter(document_type=self.doc_type, document_id=obj.pk).select_related("user").order_by("created_at")
        return Response(s.ApprovalLogSerializer(logs, many=True).data)


class RequisitionViewSet(ApprovalFlowMixin, ProcViewSet):
    queryset = m.Requisition.objects.select_related("requested_by").prefetch_related("items")
    serializer_class = s.RequisitionSerializer
    doc_type, owner_field = "PR", "requested_by"
    read_roles = write_roles = REQUESTERS
    action_roles = {"approve": VIEW_ALL, "reject": VIEW_ALL}
    filter_fields = ["status", "department"]

    def create_extra(self, request):
        return {"requested_by": request.user, "academic_year": svc.current_year()}

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.user.role not in VIEW_ALL:  # teachers / staff see only their own
            qs = qs.filter(requested_by=self.request.user)
        return qs

    def get_object(self):
        obj = super().get_object()
        u = self.request.user
        if self.action in ("update", "partial_update", "destroy", "submit", "cancel") and u.role not in MANAGE and obj.requested_by_id != u.pk:
            raise PermissionDenied("Only the requester or procurement can change this requisition.")
        return obj


# --------------------------------------------------------------- RFQ / quotes
class RFQViewSet(ProcViewSet):
    queryset = m.RFQ.objects.select_related("requisition").prefetch_related("items", "suppliers", "quotations")
    serializer_class = s.RFQSerializer
    filter_fields = ["status"]

    def create_extra(self, request):
        return {"created_by": request.user}

    def _move(self, request, frm, to, verb):
        obj = self.get_object()
        if obj.status not in frm:
            raise ValidationError(f"Only RFQs in status {', '.join(frm)} can be {verb}.")
        obj.status = to
        obj.save(update_fields=["status"])
        svc.audit(request, verb.upper(), obj)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        obj = self.get_object()
        if not obj.suppliers.exists() or not obj.items.exists():
            raise ValidationError("An RFQ needs at least one item and one supplier before it is sent.")
        return self._move(request, ("DRAFT",), "SENT", "sent")

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        return self._move(request, ("SENT",), "CLOSED", "closed")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._move(request, ("DRAFT", "SENT", "CLOSED"), "CANCELLED", "cancelled")


class QuotationViewSet(ProcViewSet):
    queryset = m.Quotation.objects.select_related("rfq", "supplier").prefetch_related("items__rfq_item")
    serializer_class = s.QuotationSerializer
    filter_fields = ["rfq", "supplier"]

    def perform_destroy(self, obj):
        if obj.is_selected:
            raise ValidationError("The selected quotation cannot be deleted.")
        obj.delete()
        svc.audit(self.request, "DELETE", obj)

    @action(detail=True, methods=["post"])
    def select(self, request, pk=None):
        q = self.get_object()
        notes = (request.data.get("evaluation_notes") or "").strip()
        if not notes:
            raise ValidationError({"evaluation_notes": "Document why this quotation was chosen (price, delivery, warranty, eligibility...)."})
        if q.rfq.status not in ("SENT", "CLOSED", "AWARDED"):
            raise ValidationError("This RFQ is not open for evaluation.")
        if m.PurchaseOrder.objects.filter(quotation__rfq=q.rfq).exclude(status__in=["CANCELLED", "REJECTED"]).exists():
            raise ValidationError("A purchase order already exists for this RFQ.")
        q.rfq.quotations.update(is_selected=False)
        q.is_selected, q.evaluation_notes = True, notes
        q.save(update_fields=["is_selected", "evaluation_notes"])
        q.rfq.status = "AWARDED"
        q.rfq.save(update_fields=["status"])
        svc.audit(request, "SELECT_QUOTATION", q.rfq, f"{q.supplier.name}: {notes}")
        return Response(self.get_serializer(q).data)


# ----------------------------------------------------------------- PO -------
class PurchaseOrderViewSet(ApprovalFlowMixin, ProcViewSet):
    queryset = m.PurchaseOrder.objects.select_related("supplier", "requisition", "created_by").prefetch_related("items")
    serializer_class = s.PurchaseOrderSerializer
    doc_type, owner_field = "PO", "created_by"
    action_roles = {"approve": VIEW_ALL, "reject": VIEW_ALL, "history": VIEW_ALL}
    filter_fields = ["status", "supplier"]

    def create_extra(self, request):
        return {"created_by": request.user, "academic_year": svc.current_year()}

    def perform_create(self, serializer):
        req = serializer.validated_data.get("requisition")
        extra = self.create_extra(self.request)
        if req and not serializer.validated_data.get("department"):
            extra["department"] = req.department
        obj = serializer.save(**extra)
        svc.audit(self.request, "CREATE", obj)

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("receivable"):
            qs = qs.filter(status__in=["APPROVED", "SENT", "PARTIALLY_RECEIVED"])
        if p.get("invoiceable"):
            qs = qs.filter(status__in=["PARTIALLY_RECEIVED", "FULLY_RECEIVED"])
        return qs

    @action(detail=False, methods=["post"])
    def from_quotation(self, request):
        q = m.Quotation.objects.select_related("rfq__requisition", "supplier").prefetch_related("items__rfq_item").filter(pk=request.data.get("quotation")).first()
        if not q or not q.is_selected:
            raise ValidationError("Select (award) the quotation before creating a purchase order.")
        if m.PurchaseOrder.objects.filter(quotation=q).exclude(status__in=["CANCELLED", "REJECTED"]).exists():
            raise ValidationError("A purchase order already exists for this quotation.")
        req = q.rfq.requisition
        po = m.PurchaseOrder.objects.create(
            supplier=q.supplier, quotation=q, requisition=req, department=req.department if req else "",
            delivery_location=request.data.get("delivery_location") or "School Store",
            expected_delivery=request.data.get("expected_delivery") or (timezone.localdate() + timedelta(days=q.delivery_days)),
            created_by=request.user, academic_year=svc.current_year(),
        )
        m.POItem.objects.bulk_create([
            m.POItem(po=po, description=i.rfq_item.description, quantity=i.rfq_item.quantity, unit=i.rfq_item.unit, unit_price=i.unit_price)
            for i in q.items.all()
        ])
        svc.recalc_po(po)
        svc.audit(request, "CREATE_FROM_QUOTATION", po, q.rfq.number)
        return Response(self.get_serializer(po).data, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        po = self.get_object()
        if po.status != "APPROVED":
            raise ValidationError("Only approved purchase orders can be sent to the supplier.")
        po.status, po.sent_at = "SENT", timezone.now()
        po.save(update_fields=["status", "sent_at"])
        svc.audit(request, "SEND", po)
        return Response(self.get_serializer(po).data)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        po = self.get_object()
        if po.status not in ("FULLY_RECEIVED", "PARTIALLY_RECEIVED"):
            raise ValidationError("Only orders with received goods can be closed.")
        po.status = "CLOSED"
        po.save(update_fields=["status"])
        svc.audit(request, "CLOSE", po, request.data.get("comment", ""))
        return Response(self.get_serializer(po).data)


# --------------------------------------------------------------- GRN --------
class GRNViewSet(viewsets.ModelViewSet):
    queryset = m.GoodsReceivedNote.objects.select_related("po__supplier", "received_by", "inspected_by").prefetch_related("items__po_item")
    serializer_class = s.GRNSerializer
    permission_classes = [ProcPermission]
    pagination_class = ProcPagination
    http_method_names = ["get", "post", "head", "options"]
    read_roles, write_roles = VIEW_ALL | STORE, STORE
    action_roles = {"inspect": MANAGE | {"PRINCIPAL", "STAFF"}}

    def get_queryset(self):
        return apply_filters(super().get_queryset(), self.request, ["status", "po"])

    def perform_create(self, serializer):
        obj = serializer.save(received_by=self.request.user)
        svc.audit(self.request, "CREATE", obj)

    @action(detail=True, methods=["post"])
    def inspect(self, request, pk=None):
        grn = self.get_object()
        decision = "ACCEPTED" if request.data.get("decision") == "ACCEPTED" else "REJECTED"
        svc.inspect_grn(grn, request.user, decision, request.data.get("notes", ""), request)
        return Response(self.get_serializer(grn).data)


class GRNItemViewSet(viewsets.ReadOnlyModelViewSet):
    """Options source for the Returns form: accepted deliveries only."""
    queryset = m.GRNItem.objects.filter(grn__status="ACCEPTED", accepted_qty__gt=0).select_related("grn", "po_item")
    serializer_class = s.GRNItemOptionSerializer
    permission_classes = [ProcPermission]
    pagination_class = ProcPagination
    read_roles, write_roles = VIEW_ALL | STORE, set()


# ------------------------------------------------------------ invoices ------
class SupplierInvoiceViewSet(ProcViewSet):
    queryset = m.SupplierInvoice.objects.select_related("supplier", "po", "created_by").prefetch_related("items__po_item")
    serializer_class = s.SupplierInvoiceSerializer
    write_roles = MANAGE | {"FINANCE"}
    action_roles = {"approve": {"FINANCE"}, "pay": {"FINANCE"}, "reject": {"FINANCE"}}
    filter_fields = ["status", "supplier", "po"]
    deletable_statuses = ("RECEIVED", "DISCREPANCY", "REJECTED")

    def create_extra(self, request):
        return {"created_by": request.user}

    @action(detail=True, methods=["post"])
    def rematch(self, request, pk=None):
        inv = self.get_object()
        if inv.status not in ("RECEIVED", "MATCHED", "DISCREPANCY"):
            raise ValidationError("This invoice is already past matching.")
        svc.run_three_way_match(inv)
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        inv = self.get_object()
        svc.approve_invoice(inv, request.user, request.data.get("comment", ""), request, bool(request.data.get("override")))
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        inv = self.get_object()
        if inv.status in ("PAID", "REJECTED"):
            raise ValidationError("This invoice can no longer be rejected.")
        if not (request.data.get("comment") or "").strip():
            raise ValidationError({"comment": "Give a reason for rejecting the invoice."})
        inv.status, inv.approval_comment = "REJECTED", request.data["comment"][:255]
        inv.save(update_fields=["status", "approval_comment"])
        svc.audit(request, "REJECT", inv, inv.approval_comment)
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        inv = self.get_object()
        svc.pay_invoice(inv, request.user, request.data.get("method", "BANK"), request.data.get("reference", ""), request)
        return Response(self.get_serializer(inv).data)


class ReturnViewSet(ProcViewSet):
    queryset = m.ProcurementReturn.objects.select_related("grn_item__grn__po__supplier", "grn_item__po_item")
    serializer_class = s.ReturnSerializer
    read_roles, write_roles = VIEW_ALL | STORE, STORE
    filter_fields = ["status"]
    deletable_statuses = ("RAISED",)

    def create_extra(self, request):
        return {"created_by": request.user}

    @action(detail=True, methods=["post"])
    def mark_returned(self, request, pk=None):
        r = self.get_object()
        svc.mark_returned(r, request)
        return Response(self.get_serializer(r).data)

    @action(detail=True, methods=["post"])
    def mark_credited(self, request, pk=None):
        r = self.get_object()
        if r.status != "RETURNED":
            raise ValidationError("Mark the goods as returned before recording a credit.")
        r.credit_amount, r.status = Decimal(str(request.data.get("credit_amount") or 0)), "CREDITED"
        r.save(update_fields=["credit_amount", "status"])
        svc.audit(request, "CREDITED", r, str(r.credit_amount))
        return Response(self.get_serializer(r).data)


class ContractViewSet(ProcViewSet):
    queryset = m.Contract.objects.select_related("supplier")
    serializer_class = s.ContractSerializer
    filter_fields = ["status", "supplier"]
    deletable_statuses = ("DRAFT", "EXPIRED", "TERMINATED", "ACTIVE")


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = m.AuditLog.objects.select_related("user")
    serializer_class = s.AuditLogSerializer
    permission_classes = [ProcPermission]
    pagination_class = ProcPagination
    read_roles, write_roles = MANAGE | {"PRINCIPAL"}, set()

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get("model"):
            qs = qs.filter(model=p["model"])
        if p.get("q"):
            qs = qs.filter(Q(object_ref__icontains=p["q"]) | Q(detail__icontains=p["q"]) | Q(action__icontains=p["q"]))
        return qs


# ---------------------------------------------------------- approvals inbox --
class ApprovalInboxView(APIView):
    permission_classes = [ProcPermission]
    read_roles, write_roles = VIEW_ALL, set()

    def get(self, request):
        u = request.user
        pending = []
        for doc_type, qs, owner in (
            ("PR", m.Requisition.objects.filter(status="PENDING_APPROVAL", is_deleted=False).select_related("requested_by"), "requested_by"),
            ("PO", m.PurchaseOrder.objects.filter(status="PENDING_APPROVAL", is_deleted=False).select_related("created_by", "supplier"), "created_by"),
        ):
            for d in qs:
                role = svc.pending_role(doc_type, d)
                owner_obj = getattr(d, owner)
                pending.append({
                    "doc_type": doc_type, "id": d.pk, "number": d.number,
                    "title": d.title if doc_type == "PR" else f"{d.supplier.name} - {d.delivery_location}",
                    "department": d.department, "owner_name": owner_obj.get_full_name() or owner_obj.username,
                    "amount": num(d.estimated_total if doc_type == "PR" else d.total_amount),
                    "level": d.current_level, "total_levels": len(svc.approval_roles(doc_type)),
                    "pending_role": role, "can_act": (u.role == "ADMIN" or u.role == role) and u.pk != owner_obj.pk,
                    "created_at": d.created_at,
                })
        logs = m.ApprovalLog.objects.select_related("user")[:200]
        return Response({"pending": pending, "history": s.ApprovalLogSerializer(logs, many=True).data})


# -------------------------------------------------------------- dashboard ----
def month_range(n=12):
    today = timezone.localdate().replace(day=1)
    out = []
    y, mth = today.year, today.month
    for _ in range(n):
        out.append(f"{y}-{mth:02d}")
        mth -= 1
        if mth == 0:
            y, mth = y - 1, 12
    return list(reversed(out))


def monthly_spend(n=12):
    months = month_range(n)
    start = timezone.now() - timedelta(days=31 * n)
    ordered = (m.PurchaseOrder.objects.filter(status__in=m.PO_COMMITTED, is_deleted=False, order_date__gte=start.date())
               .annotate(mo=TruncMonth("order_date")).values("mo").annotate(t=Sum("total_amount")))
    paid = (m.SupplierInvoice.objects.filter(status="PAID", is_deleted=False, paid_at__gte=start)
            .annotate(mo=TruncMonth("paid_at")).values("mo").annotate(t=Sum("amount")))
    o = {r["mo"].strftime("%Y-%m"): num(r["t"]) for r in ordered}
    p = {r["mo"].strftime("%Y-%m"): num(r["t"]) for r in paid}
    return [{"month": mo, "ordered": o.get(mo, 0), "paid": p.get(mo, 0)} for mo in months]


class DashboardView(APIView):
    permission_classes = [ProcPermission]
    read_roles, write_roles = VIEW_ALL, set()

    def get(self, request):
        today = timezone.localdate()
        committed = m.PurchaseOrder.objects.filter(status__in=m.PO_COMMITTED, is_deleted=False)
        month_start = today.replace(day=1)
        year = svc.current_year()
        by_dept = list(committed.exclude(department="").values("department").annotate(t=Sum("total_amount")).order_by("-t")[:8])
        budgets = [{"department": b.department, "budget": num(b.amount), "committed": num(svc.committed_for(b.academic_year, b.department))}
                   for b in m.Budget.objects.filter(academic_year=year)] if year else []
        data = {
            "cards": {
                "pending_requisitions": m.Requisition.objects.filter(status__in=["DRAFT", "PENDING_APPROVAL"], is_deleted=False).count(),
                "pending_approvals": m.Requisition.objects.filter(status="PENDING_APPROVAL", is_deleted=False).count()
                + m.PurchaseOrder.objects.filter(status="PENDING_APPROVAL", is_deleted=False).count(),
                "active_rfqs": m.RFQ.objects.filter(status="SENT", is_deleted=False).count(),
                "pending_pos": m.PurchaseOrder.objects.filter(status__in=["DRAFT", "PENDING_APPROVAL"], is_deleted=False).count(),
                "pending_deliveries": m.PurchaseOrder.objects.filter(status__in=["APPROVED", "SENT", "PARTIALLY_RECEIVED"], is_deleted=False).count(),
                "pending_grns": m.GoodsReceivedNote.objects.filter(status="RECEIVED").count(),
                "open_invoices": m.SupplierInvoice.objects.filter(status__in=m.INVOICE_OPEN, is_deleted=False).count(),
                "overdue_invoices": m.SupplierInvoice.objects.filter(status__in=m.INVOICE_OPEN, is_deleted=False, due_date__lt=today).count(),
                "month_spend": num(m.SupplierInvoice.objects.filter(status="PAID", is_deleted=False, paid_at__date__gte=month_start).aggregate(t=Sum("amount"))["t"]),
                "ytd_committed": num(committed.filter(order_date__year=today.year).aggregate(t=Sum("total_amount"))["t"]),
                "payables": num(m.SupplierInvoice.objects.filter(status__in=m.INVOICE_OPEN, is_deleted=False).aggregate(t=Sum("amount"))["t"]),
                "expiring_contracts": m.Contract.objects.filter(status="ACTIVE", is_deleted=False, end_date__lte=today + timedelta(days=60)).count(),
            },
            "monthly_spend": monthly_spend(),
            "spend_by_supplier": [{"name": r["supplier__name"], "value": num(r["t"])} for r in
                                  committed.values("supplier__name").annotate(t=Sum("total_amount")).order_by("-t")[:7]],
            "spend_by_department": [{"name": r["department"], "value": num(r["t"])} for r in by_dept],
            "requisition_status": [{"name": r["status"], "value": r["c"]} for r in
                                   m.Requisition.objects.filter(is_deleted=False).values("status").annotate(c=Count("id"))],
            "po_status": [{"name": r["status"], "value": r["c"]} for r in
                          m.PurchaseOrder.objects.filter(is_deleted=False).values("status").annotate(c=Count("id"))],
            "budget_utilization": budgets,
            "recent_activity": s.AuditLogSerializer(m.AuditLog.objects.select_related("user")[:8], many=True).data,
        }
        return Response(data)


# ---------------------------------------------------------------- reports ----
def _dates(request):
    p = request.query_params
    return p.get("date_from") or None, p.get("date_to") or None


def r_spend_by_supplier(request):
    a, b = _dates(request)
    qs = m.PurchaseOrder.objects.filter(status__in=m.PO_COMMITTED, is_deleted=False)
    if a: qs = qs.filter(order_date__gte=a)
    if b: qs = qs.filter(order_date__lte=b)
    return [{"supplier": r["supplier__name"], "orders": r["c"], "total": num(r["t"])} for r in
            qs.values("supplier__name").annotate(c=Count("id"), t=Sum("total_amount")).order_by("-t")]


def r_spend_by_department(request):
    a, b = _dates(request)
    qs = m.PurchaseOrder.objects.filter(status__in=m.PO_COMMITTED, is_deleted=False)
    if a: qs = qs.filter(order_date__gte=a)
    if b: qs = qs.filter(order_date__lte=b)
    return [{"department": r["department"] or "Unassigned", "orders": r["c"], "total": num(r["t"])} for r in
            qs.values("department").annotate(c=Count("id"), t=Sum("total_amount")).order_by("-t")]


def r_monthly_spend(request):
    return monthly_spend(12)


def r_supplier_performance(request):
    grn = defaultdict(lambda: [ZERO, ZERO])
    for r in m.GRNItem.objects.filter(grn__status__in=["ACCEPTED", "REJECTED"]).values("grn__po__supplier__name").annotate(rc=Sum("received_qty"), rj=Sum("rejected_qty")):
        grn[r["grn__po__supplier__name"]] = [r["rc"] or ZERO, r["rj"] or ZERO]
    rows = []
    for sup in m.Supplier.objects.filter(is_deleted=False):
        pos = m.PurchaseOrder.objects.filter(supplier=sup, status__in=m.PO_COMMITTED, is_deleted=False, expected_delivery__isnull=False)
        measured = on_time = 0
        for po in pos:
            first = po.grns.filter(status="ACCEPTED").order_by("received_date").first()
            if first:
                measured += 1
                on_time += first.received_date <= po.expected_delivery
        rc, rj = grn.get(sup.name, [ZERO, ZERO])
        if measured or rc:
            rows.append({"supplier": sup.name, "orders_measured": measured,
                         "on_time_pct": round(on_time / measured * 100, 1) if measured else None,
                         "rejection_pct": round(float(rj / rc * 100), 1) if rc else 0.0})
    return rows


def r_budget_utilization(request):
    year = svc.current_year()
    rows = []
    for b in m.Budget.objects.filter(academic_year=year) if year else []:
        c = svc.committed_for(year, b.department)
        rows.append({"department": b.department, "budget": num(b.amount), "committed": num(c), "remaining": num(b.amount - c),
                     "used_pct": round(float(c / b.amount * 100), 1) if b.amount else 0})
    return rows


def r_payables_aging(request):
    today = timezone.localdate()
    buckets = [("Not yet due", 0), ("1-30 days overdue", 0), ("31-60 days overdue", 0), ("61-90 days overdue", 0), ("90+ days overdue", 0)]
    data = {b[0]: [0, 0.0] for b in buckets}
    for inv in m.SupplierInvoice.objects.filter(status__in=m.INVOICE_OPEN, is_deleted=False):
        days = (today - (inv.due_date or inv.invoice_date)).days
        key = buckets[0][0] if days <= 0 else buckets[1][0] if days <= 30 else buckets[2][0] if days <= 60 else buckets[3][0] if days <= 90 else buckets[4][0]
        data[key][0] += 1
        data[key][1] += num(inv.amount)
    return [{"bucket": k, "invoices": v[0], "amount": v[1]} for k, v in data.items()]


def r_cycle_times(request):
    def avg(vals):
        return round(sum(vals) / len(vals), 1) if vals else 0
    pr_po = [(po.created_at.date() - po.requisition.created_at.date()).days for po in
             m.PurchaseOrder.objects.filter(requisition__isnull=False, is_deleted=False).select_related("requisition")]
    po_del = []
    for po in m.PurchaseOrder.objects.filter(status__in=m.PO_COMMITTED, is_deleted=False):
        g = po.grns.filter(status="ACCEPTED").order_by("received_date").first()
        if g:
            po_del.append((g.received_date - po.order_date).days)
    del_pay = []
    for inv in m.SupplierInvoice.objects.filter(status="PAID").select_related("po"):
        g = inv.po.grns.filter(status="ACCEPTED").order_by("received_date").first()
        if g and inv.paid_at:
            del_pay.append((inv.paid_at.date() - g.received_date).days)
    return [{"stage": "Requisition to PO", "avg_days": avg(pr_po), "samples": len(pr_po)},
            {"stage": "PO to delivery", "avg_days": avg(po_del), "samples": len(po_del)},
            {"stage": "Delivery to payment", "avg_days": avg(del_pay), "samples": len(del_pay)}]


REPORTS = {
    "spend-by-supplier": r_spend_by_supplier, "spend-by-department": r_spend_by_department,
    "monthly-spend": r_monthly_spend, "supplier-performance": r_supplier_performance,
    "budget-utilization": r_budget_utilization, "payables-aging": r_payables_aging, "cycle-times": r_cycle_times,
}


class ReportView(APIView):
    permission_classes = [ProcPermission]
    read_roles, write_roles = VIEW_ALL, set()

    def get(self, request, name):
        fn = REPORTS.get(name)
        if not fn:
            return Response({"detail": "Unknown report."}, status=404)
        rows = fn(request)
        if request.query_params.get("export") == "csv":
            resp = HttpResponse(content_type="text/csv")
            resp["Content-Disposition"] = f'attachment; filename="{name}.csv"'
            w = csv.writer(resp)
            if rows:
                w.writerow(rows[0].keys())
                for r in rows:
                    w.writerow(r.values())
            return resp
        return Response({"rows": rows})
