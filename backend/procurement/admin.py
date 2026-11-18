from django.contrib import admin

from . import models as m

for model in (m.Supplier, m.Requisition, m.RFQ, m.Quotation, m.PurchaseOrder, m.GoodsReceivedNote,
              m.SupplierInvoice, m.ProcurementReturn, m.Contract, m.Budget, m.ApprovalLevel):
    admin.site.register(model)


@admin.register(m.AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "user", "action", "model", "object_ref")
    readonly_fields = [f.name for f in m.AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
