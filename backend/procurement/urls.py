from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views as v

router = DefaultRouter()
router.register("suppliers", v.SupplierViewSet, basename="proc-supplier")
router.register("requisitions", v.RequisitionViewSet, basename="proc-requisition")
router.register("approval-levels", v.ApprovalLevelViewSet, basename="proc-level")
router.register("budgets", v.BudgetViewSet, basename="proc-budget")
router.register("rfqs", v.RFQViewSet, basename="proc-rfq")
router.register("quotations", v.QuotationViewSet, basename="proc-quotation")
router.register("purchase-orders", v.PurchaseOrderViewSet, basename="proc-po")
router.register("grns", v.GRNViewSet, basename="proc-grn")
router.register("grn-items", v.GRNItemViewSet, basename="proc-grn-item")
router.register("invoices", v.SupplierInvoiceViewSet, basename="proc-invoice")
router.register("returns", v.ReturnViewSet, basename="proc-return")
router.register("contracts", v.ContractViewSet, basename="proc-contract")
router.register("audit-log", v.AuditLogViewSet, basename="proc-audit")

urlpatterns = [
    path("dashboard/", v.DashboardView.as_view()),
    path("approvals/pending/", v.ApprovalInboxView.as_view()),
    path("reports/<str:name>/", v.ReportView.as_view()),
    path("", include(router.urls)),
]
