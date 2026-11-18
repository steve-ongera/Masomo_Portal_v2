import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard, DonutCard, countBy, sumBy } from "../../components/procurement/charts";
import { COMMENT_OPT } from "../../components/procurement/ProcUI";
import { useAuth } from "../../components/procurement/useProcAuth";
import { procApi } from "../../services/api";
import { MANAGE, can } from "../../components/procurement/roles";

const STATUS = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED", "CANCELLED"]
  .map((v) => ({ value: v, label: v.replaceAll("_", " ").toLowerCase() }));
const editable = (r) => ["DRAFT", "REJECTED"].includes(r.status);
const OPEN = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];

export default function PurchaseOrders() {
  const { user } = useAuth();
  const manage = can(user?.role, MANAGE);
  return (
    <ResourcePage
      title="Purchase Orders" subtitle="Orders placed with suppliers, from approval to full delivery" icon="bi-bag-check" noun="purchase order" historyView
      resource={procApi.purchaseOrders} canCreate={manage} canEdit={(r) => manage && editable(r)}
      canDelete={(r) => manage && ["DRAFT", "REJECTED", "CANCELLED"].includes(r.status)}
      filters={[{ name: "status", label: "Status", options: STATUS }]}
      columns={[
        { key: "number", label: "PO No." }, { key: "supplier_name", label: "Supplier" }, { key: "department", label: "Department" },
        { key: "order_date", label: "Ordered", type: "date" }, { key: "expected_delivery", label: "Due", type: "date" },
        { key: "total_amount", label: "Total", type: "money" },
        { key: "received_pct", label: "Received", render: (r) => (
          <div className="progress" style={{ height: 8, minWidth: 70 }} title={`${r.received_pct}%`}><div className="progress-bar bg-success" style={{ width: `${r.received_pct}%` }} /></div>) },
        { key: "status", label: "Status", type: "status" },
      ]}
      fields={[
        { name: "supplier", label: "Supplier", type: "fk", required: true, lockOnEdit: false, optionsApi: () => procApi.suppliers.list({ status: "ACTIVE" }), optionLabel: (o) => o.name },
        { name: "requisition", label: "From approved requisition (optional)", type: "fk", placeholder: "None",
          optionsApi: () => procApi.requisitions.list({ status: "APPROVED" }), optionLabel: (o) => `${o.number} - ${o.title}`,
          onChange: async (id) => {
            if (!id) return null;
            const d = (await procApi.requisitions.get(id)).data;
            return { department: d.department, items: d.items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unit_price: i.estimated_unit_cost })) };
          } },
        { name: "department", label: "Charged to department", col: "col-md-4", help: "Used for budget control" },
        { name: "order_date", label: "Order date", type: "date", col: "col-md-4" },
        { name: "expected_delivery", label: "Expected delivery", type: "date", col: "col-md-4" },
        { name: "delivery_location", label: "Delivery location" },
        { name: "notes", label: "Notes", type: "textarea" },
      ]}
      blank={{ delivery_location: "School Store", order_date: new Date().toISOString().slice(0, 10) }}
      itemsConfig={{
        label: "Order lines", blank: { description: "", quantity: 1, unit: "pcs", unit_price: 0 },
        columns: [
          { name: "description", label: "Item" }, { name: "quantity", label: "Qty", type: "number", width: 90 },
          { name: "unit", label: "Unit", width: 90 }, { name: "unit_price", label: "Unit price", type: "number", width: 130 },
        ],
        viewColumns: [
          { name: "description", label: "Item" }, { name: "quantity", label: "Ordered" }, { name: "received_qty", label: "Received (accepted)" },
          { name: "outstanding", label: "Outstanding" }, { name: "unit_price", label: "Unit price" }, { name: "line_total", label: "Line total" },
        ],
        total: (i) => Number(i.quantity || 0) * Number(i.unit_price || 0),
      }}
      rowActions={[
        { label: "Submit", icon: "bi-send", when: (r) => manage && editable(r), confirm: "Submit this purchase order for approval?", run: (r) => procApi.purchaseOrders.act(r.id, "submit") },
        { label: "Send to supplier", icon: "bi-envelope-arrow-up", tone: "success", when: (r) => manage && r.status === "APPROVED", confirm: "Mark this order as sent to the supplier?", run: (r) => procApi.purchaseOrders.act(r.id, "send") },
        { label: "Close", tone: "secondary", when: (r) => manage && ["FULLY_RECEIVED", "PARTIALLY_RECEIVED"].includes(r.status),
          prompt: { title: "Close purchase order", intro: "Closing stops further receipts against this order.", fields: COMMENT_OPT }, run: (r, v) => procApi.purchaseOrders.act(r.id, "close", v) },
        { label: "Cancel", tone: "secondary", when: (r) => manage && ["DRAFT", "PENDING_APPROVAL", "REJECTED", "APPROVED", "SENT"].includes(r.status),
          prompt: { fields: COMMENT_OPT, confirmLabel: "Cancel order" }, run: (r, v) => procApi.purchaseOrders.act(r.id, "cancel", v) },
      ]}
      topContent={(rows) => {
        const live = rows.filter((r) => !["DRAFT", "REJECTED", "CANCELLED", "PENDING_APPROVAL"].includes(r.status));
        return (
          <div className="row g-3">
            <div className="col-lg-4"><DonutCard title="Orders by status" data={countBy(rows, "status")} /></div>
            <div className="col-lg-4"><BarCard title="Committed spend by supplier" data={sumBy(live, "supplier_name", "total_amount", 6)} horizontal money /></div>
            <div className="col-lg-4"><BarCard title="Delivery progress (open orders)" subtitle="% of ordered quantity received" horizontal
              data={rows.filter((r) => OPEN.includes(r.status)).slice(0, 7).map((r) => ({ name: r.number, value: r.received_pct }))} /></div>
          </div>
        );
      }}
    />
  );
}
