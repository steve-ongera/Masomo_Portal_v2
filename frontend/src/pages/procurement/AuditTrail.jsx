import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard } from "../../components/procurement/charts";
import { procApi } from "../../services/api";

const resource = { list: procApi.audit.list, get: procApi.audit.get }; // read-only: no edit/delete buttons
const MODELS = ["Requisition", "RFQ", "PurchaseOrder", "GoodsReceivedNote", "SupplierInvoice", "ProcurementReturn", "Supplier", "Contract"].map((v) => ({ value: v, label: v }));

const tally = (rows, key) => {
  const m = {};
  rows.forEach((r) => { m[r[key]] = (m[r[key]] || 0) + 1; });
  return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
};

export default function AuditTrail() {
  return (
    <ResourcePage
      title="Audit Trail" subtitle="Every create, approval, receipt and payment. Entries cannot be edited or removed." icon="bi-journal-check" noun="audit entry"
      resource={resource} canCreate={false} filters={[{ name: "model", label: "Record type", options: MODELS }]}
      columns={[
        { key: "created_at", label: "When", type: "datetime" }, { key: "user_name", label: "Who" }, { key: "action", label: "Action" },
        { key: "model", label: "Record type" }, { key: "object_ref", label: "Reference" }, { key: "detail", label: "Detail" }, { key: "ip_address", label: "IP" },
      ]}
      topContent={(rows) => (
        <div className="row g-3">
          <div className="col-md-6"><BarCard title="Activity by person" data={tally(rows, "user_name")} horizontal /></div>
          <div className="col-md-6"><BarCard title="Activity by action" data={tally(rows, "action")} horizontal /></div>
        </div>
      )}
    />
  );
}
