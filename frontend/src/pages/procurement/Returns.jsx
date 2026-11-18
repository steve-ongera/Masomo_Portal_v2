import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard, DonutCard, countBy } from "../../components/procurement/charts";
import { useAuth } from "../../components/procurement/useProcAuth";
import { procApi } from "../../services/api";
import { STORE, can } from "../../components/procurement/roles";

export default function Returns() {
  const { user } = useAuth();
  const w = can(user?.role, STORE);
  return (
    <ResourcePage
      title="Returns & Damaged Goods" subtitle="Send accepted goods back to the supplier and track credit" icon="bi-arrow-return-left" noun="return"
      resource={procApi.returns} canCreate={w} canEdit={(r) => w && r.status === "RAISED"} canDelete={(r) => w && r.status === "RAISED"}
      columns={[
        { key: "number", label: "Return No." }, { key: "grn_number", label: "GRN" }, { key: "item_name", label: "Item" }, { key: "supplier_name", label: "Supplier" },
        { key: "quantity", label: "Qty" }, { key: "reason", label: "Reason" }, { key: "credit_amount", label: "Credit", type: "money" }, { key: "status", label: "Status", type: "status" },
      ]}
      fields={[
        { name: "grn_item", label: "Delivered item", type: "fk", required: true, lockOnEdit: true, col: "col-md-8", optionsApi: () => procApi.grnItems.list(), optionLabel: (o) => o.label },
        { name: "quantity", label: "Quantity to return", type: "number", required: true, col: "col-md-4" },
        { name: "reason", label: "Reason", type: "textarea", required: true, col: "col-12" },
      ]}
      rowActions={[
        { label: "Mark returned", icon: "bi-truck", when: (r) => w && r.status === "RAISED", confirm: "Confirm the goods have left the school? Stock received on the PO is reduced.", run: (r) => procApi.returns.act(r.id, "mark_returned") },
        { label: "Record credit", icon: "bi-cash", tone: "success", when: (r) => w && r.status === "RETURNED",
          prompt: { title: "Record supplier credit", fields: [{ name: "credit_amount", label: "Credit received (KES)", type: "number", required: true }] }, run: (r, v) => procApi.returns.act(r.id, "mark_credited", v) },
      ]}
      topContent={(rows) => (
        <div className="row g-3">
          <div className="col-lg-4"><DonutCard title="Returns by status" data={countBy(rows, "status")} /></div>
          <div className="col-lg-8"><BarCard title="Returns by supplier" data={countBy(rows, "supplier_name")} /></div>
        </div>
      )}
    />
  );
}
