import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard, DonutCard, countBy } from "../../components/procurement/charts";
import { COMMENT_OPT } from "../../components/procurement/ProcUI";
import { useAuth } from "../../components/procurement/useProcAuth";
import { procApi } from "../../services/api";
import { INSPECTORS, STORE, can } from "../../components/procurement/roles";

export default function GoodsReceived() {
  const { user } = useAuth();
  const role = user?.role;
  const byDelivery = (rows) => {
    const m = {};
    rows.forEach((g) => g.items.forEach((i) => {
      const k = g.supplier_name; m[k] = m[k] || { name: k, accepted: 0, rejected: 0 };
      m[k].accepted += Number(i.accepted_qty); m[k].rejected += Number(i.rejected_qty);
    }));
    return Object.values(m).slice(0, 8);
  };
  return (
    <ResourcePage
      title="Goods Received" subtitle="Record deliveries against purchase orders, then inspect them" icon="bi-box-seam" noun="GRN"
      resource={procApi.grns} createLabel="Receive goods" canCreate={can(role, STORE)} canEdit={() => false} canDelete={() => false}
      filters={[{ name: "status", label: "Status", options: [{ value: "RECEIVED", label: "Awaiting inspection" }, { value: "ACCEPTED", label: "Accepted" }, { value: "REJECTED", label: "Rejected" }] }]}
      columns={[
        { key: "number", label: "GRN No." }, { key: "po_number", label: "PO" }, { key: "supplier_name", label: "Supplier" },
        { key: "received_date", label: "Received", type: "date" }, { key: "delivery_note_no", label: "Delivery note" },
        { key: "received_by_name", label: "Received by" }, { key: "status", label: "Status", type: "status" },
      ]}
      fields={[
        { name: "po", label: "Purchase order", type: "fk", required: true, col: "col-md-6", optionsApi: () => procApi.purchaseOrders.list({ receivable: 1 }),
          optionLabel: (o) => `${o.number} - ${o.supplier_name}`,
          onChange: async (id) => {
            if (!id) return { items: [] };
            const po = (await procApi.purchaseOrders.get(id)).data;
            return { items: po.items.filter((i) => Number(i.outstanding) > 0).map((i) => ({
              po_item: i.id, description: i.description, ordered: i.quantity, outstanding: i.outstanding,
              received_qty: 0, rejected_qty: 0, rejection_reason: "", serial_numbers: "" })) };
          } },
        { name: "received_date", label: "Date received", type: "date", col: "col-md-3" },
        { name: "delivery_note_no", label: "Delivery note no.", col: "col-md-3" },
        { name: "notes", label: "Notes", type: "textarea", col: "col-12" },
      ]}
      blank={{ received_date: new Date().toISOString().slice(0, 10) }}
      itemsConfig={{
        label: "Quantities delivered", fixed: true, emptyText: "Choose a purchase order to list its outstanding items.",
        columns: [
          { name: "description", label: "Item", readOnly: true }, { name: "ordered", label: "Ordered", readOnly: true, width: 80 },
          { name: "outstanding", label: "Outstanding", readOnly: true, width: 100 },
          { name: "received_qty", label: "Delivered", type: "number", width: 100 }, { name: "rejected_qty", label: "Damaged / rejected", type: "number", width: 130 },
          { name: "rejection_reason", label: "Reason if rejected" }, { name: "serial_numbers", label: "Serial / batch no." },
        ],
        viewColumns: [
          { name: "description", label: "Item" }, { name: "ordered", label: "Ordered" }, { name: "received_qty", label: "Delivered" },
          { name: "accepted_qty", label: "Accepted" }, { name: "rejected_qty", label: "Rejected" }, { name: "rejection_reason", label: "Reason" }, { name: "serial_numbers", label: "Serial / batch" },
        ],
      }}
      detailExtra={(d) => d.inspection_notes ? <div className="alert alert-light border"><strong>Inspection ({d.inspected_by_name}):</strong> {d.inspection_notes}</div> : null}
      rowActions={[
        { label: "Accept", icon: "bi-check2", tone: "success", when: (r, rl) => r.status === "RECEIVED" && can(rl, INSPECTORS),
          prompt: { title: "Accept delivery", intro: "Confirms quantity, quality and specification. Accepted items are added to the order's received total.", fields: COMMENT_OPT },
          run: (r, v) => procApi.grns.act(r.id, "inspect", { decision: "ACCEPTED", notes: v.comment }) },
        { label: "Reject", icon: "bi-x-lg", tone: "danger", when: (r, rl) => r.status === "RECEIVED" && can(rl, INSPECTORS),
          prompt: { title: "Reject delivery", fields: [{ name: "comment", label: "Why is the delivery rejected?", type: "textarea", required: true }], confirmLabel: "Reject delivery" },
          run: (r, v) => procApi.grns.act(r.id, "inspect", { decision: "REJECTED", notes: v.comment }) },
      ]}
      topContent={(rows) => (
        <div className="row g-3">
          <div className="col-lg-4"><DonutCard title="Deliveries by status" data={countBy(rows, "status")} /></div>
          <div className="col-lg-8"><BarCard title="Accepted vs rejected units by supplier" data={byDelivery(rows)} stacked
            bars={[{ key: "accepted", name: "Accepted", color: "#0d9488" }, { key: "rejected", name: "Rejected", color: "#e11d48" }]} /></div>
        </div>
      )}
    />
  );
}
