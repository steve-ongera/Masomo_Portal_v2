import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard, DonutCard, countBy, sumBy } from "../../components/procurement/charts";
import { COMMENT_OPT, COMMENT_REQ } from "../../components/procurement/ProcUI";
import { useAuth } from "../../components/procurement/useProcAuth";
import { procApi } from "../../services/api";
import { FINANCE_ROLES, MANAGE, can } from "../../components/procurement/roles";

const STATUS = ["RECEIVED", "MATCHED", "DISCREPANCY", "APPROVED", "PAID", "REJECTED"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }));
const OPEN = ["RECEIVED", "MATCHED", "DISCREPANCY", "APPROVED"];
const METHODS = ["BANK", "MPESA", "CHEQUE", "CASH"].map((v) => ({ value: v, label: v === "MPESA" ? "M-Pesa" : v[0] + v.slice(1).toLowerCase() }));

function aging(rows) {
  const today = new Date();
  const b = { "Not due": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  rows.filter((r) => OPEN.includes(r.status)).forEach((r) => {
    const d = Math.floor((today - new Date(r.due_date || r.invoice_date)) / 864e5);
    b[d <= 0 ? "Not due" : d <= 30 ? "1-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+"] += Number(r.amount);
  });
  return Object.entries(b).map(([name, value]) => ({ name, value }));
}

export default function Invoices() {
  const { user } = useAuth();
  const role = user?.role;
  const writer = can(role, [...MANAGE, "FINANCE"]);
  const fin = can(role, FINANCE_ROLES);
  const open = (r) => ["RECEIVED", "MATCHED", "DISCREPANCY"].includes(r.status);

  return (
    <ResourcePage
      title="Supplier Invoices" subtitle="Every invoice is matched against the purchase order and the goods actually received" icon="bi-receipt" noun="invoice" historyView={false}
      resource={procApi.invoices} canCreate={writer} canEdit={(r) => writer && open(r)} canDelete={(r) => writer && ["RECEIVED", "DISCREPANCY", "REJECTED"].includes(r.status)}
      filters={[{ name: "status", label: "Status", options: STATUS }]}
      columns={[
        { key: "number", label: "Ref." }, { key: "invoice_number", label: "Supplier invoice" }, { key: "supplier_name", label: "Supplier" },
        { key: "po_number", label: "PO" }, { key: "invoice_date", label: "Dated", type: "date" }, { key: "due_date", label: "Due", type: "date" },
        { key: "amount", label: "Amount", type: "money" }, { key: "status", label: "Status", type: "status" },
      ]}
      fields={[
        { name: "po", label: "Purchase order", type: "fk", required: true, lockOnEdit: true, optionsApi: () => procApi.purchaseOrders.list({ invoiceable: 1 }),
          optionLabel: (o) => `${o.number} - ${o.supplier_name}`,
          onChange: async (id) => {
            if (!id) return { items: [] };
            const po = (await procApi.purchaseOrders.get(id)).data;
            return { items: po.items.filter((i) => Number(i.received_qty) > 0).map((i) => ({ po_item: i.id, description: i.description, quantity: i.received_qty, unit_price: i.unit_price })) };
          } },
        { name: "invoice_number", label: "Supplier's invoice number", required: true },
        { name: "invoice_date", label: "Invoice date", type: "date" }, { name: "due_date", label: "Due date", type: "date" },
      ]}
      blank={{ invoice_date: new Date().toISOString().slice(0, 10) }}
      itemsConfig={{
        label: "Invoiced lines", fixed: true, emptyText: "Choose a purchase order that has accepted deliveries.",
        columns: [
          { name: "description", label: "Item", readOnly: true },
          { name: "quantity", label: "Invoiced qty", type: "number", width: 130 }, { name: "unit_price", label: "Invoiced unit price", type: "number", width: 160 },
        ],
        total: (i) => Number(i.quantity || 0) * Number(i.unit_price || 0),
      }}
      detailExtra={(d) => (d.match_result?.length
        ? <div className="alert alert-danger"><strong>3-way match found {d.match_result.length} issue(s):</strong><ul className="mb-0">{d.match_result.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
        : ["MATCHED", "APPROVED", "PAID"].includes(d.status) ? <div className="alert alert-success mb-3"><i className="bi bi-check-circle me-1" />PO, goods received and invoice agree.</div> : null)}
      rowActions={[
        { label: "Re-match", icon: "bi-arrow-repeat", tone: "secondary", when: (r) => writer && open(r), run: (r) => procApi.invoices.act(r.id, "rematch") },
        { label: "Approve", icon: "bi-check2", tone: "success", when: (r) => fin && ["MATCHED", "DISCREPANCY"].includes(r.status),
          prompt: { title: "Approve for payment", fields: [...COMMENT_OPT, ...(role === "ADMIN" ? [{ name: "override", label: "If there are discrepancies", type: "select", default: "", options: [{ value: "", label: "Do not approve" }, { value: "yes", label: "Override (comment required)" }] }] : [])] },
          run: (r, v) => procApi.invoices.act(r.id, "approve", { comment: v.comment, override: v.override === "yes" }) },
        { label: "Pay", icon: "bi-cash-coin", tone: "primary", when: (r) => fin && r.status === "APPROVED",
          prompt: { title: "Record payment", intro: "The payment is also posted to Finance > Expenses.", confirmLabel: "Record payment",
            fields: [{ name: "method", label: "Method", type: "select", default: "BANK", options: METHODS }, { name: "reference", label: "Payment reference", placeholder: "Bank slip / M-Pesa code", required: true }] },
          run: (r, v) => procApi.invoices.act(r.id, "pay", v) },
        { label: "Reject", icon: "bi-x-lg", tone: "danger", when: (r) => fin && !["PAID", "REJECTED"].includes(r.status),
          prompt: { title: "Reject invoice", fields: COMMENT_REQ, confirmLabel: "Reject" }, run: (r, v) => procApi.invoices.act(r.id, "reject", v) },
      ]}
      topContent={(rows) => (
        <div className="row g-3">
          <div className="col-lg-4"><DonutCard title="Invoices by status" data={countBy(rows, "status")} /></div>
          <div className="col-lg-4"><BarCard title="Payables ageing" subtitle="Unpaid invoices by days overdue" data={aging(rows)} money /></div>
          <div className="col-lg-4"><BarCard title="Invoiced by supplier" data={sumBy(rows.filter((r) => r.status !== "REJECTED"), "supplier_name", "amount", 6)} horizontal money /></div>
        </div>
      )}
    />
  );
}
