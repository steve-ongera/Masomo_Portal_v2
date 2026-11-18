import { useState } from "react";
import ResourcePage from "../../components/procurement/ResourcePage";
import QuotationManager from "../../components/procurement/QuotationManager";
import { BarCard, DonutCard, countBy } from "../../components/procurement/charts";
import { COMMENT_OPT } from "../../components/procurement/ProcUI";
import { useAuth } from "../../components/procurement/useProcAuth";
import { procApi } from "../../services/api";
import { MANAGE, can } from "../../components/procurement/roles";

const STATUS = ["DRAFT", "SENT", "CLOSED", "AWARDED", "CANCELLED"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }));

export default function Rfqs() {
  const { user } = useAuth();
  const manage = can(user?.role, MANAGE);
  const [rfq, setRfq] = useState(null);
  const [tick, setTick] = useState(0);

  return (
    <>
      <ResourcePage
        key={tick}
        title="Requests for Quotation" subtitle="Invite suppliers to quote, then compare their responses" icon="bi-envelope-paper" noun="RFQ"
        resource={procApi.rfqs} canCreate={manage} canEdit={(r) => manage && r.status === "DRAFT"} canDelete={(r) => manage && ["DRAFT", "CANCELLED"].includes(r.status)}
        filters={[{ name: "status", label: "Status", options: STATUS }]}
        columns={[
          { key: "number", label: "RFQ No." }, { key: "title", label: "Title" }, { key: "requisition_number", label: "From PR" },
          { key: "supplier_names", label: "Invited", render: (r) => `${r.supplier_names.length} supplier(s)` },
          { key: "quotation_count", label: "Quotes" }, { key: "closing_date", label: "Closes", type: "date" },
          { key: "status", label: "Status", type: "status" },
        ]}
        fields={[
          { name: "requisition", label: "Based on requisition (optional)", type: "fk", col: "col-md-6", placeholder: "None",
            optionsApi: () => procApi.requisitions.list({ status: "APPROVED" }), optionLabel: (o) => `${o.number} - ${o.title}`,
            help: "Copies the requisition's items into this RFQ.",
            onChange: async (id) => {
              if (!id) return null;
              const d = (await procApi.requisitions.get(id)).data;
              return { title: d.title, items: d.items.map((i) => ({ description: i.description, specification: i.specification, quantity: i.quantity, unit: i.unit })) };
            } },
          { name: "title", label: "Title", required: true, col: "col-md-6" },
          { name: "issue_date", label: "Issue date", type: "date", col: "col-md-3" },
          { name: "closing_date", label: "Closing date", type: "date", required: true, col: "col-md-3" },
          { name: "suppliers", label: "Invite suppliers", type: "multi", col: "col-md-6", optionsApi: () => procApi.suppliers.list({ status: "ACTIVE" }), optionLabel: (o) => o.name },
          { name: "notes", label: "Notes to suppliers", type: "textarea", col: "col-12" },
        ]}
        blank={{ suppliers: [], issue_date: new Date().toISOString().slice(0, 10) }}
        itemsConfig={{
          label: "Items to quote", blank: { description: "", specification: "", quantity: 1, unit: "pcs" },
          columns: [{ name: "description", label: "Item" }, { name: "specification", label: "Specification" }, { name: "quantity", label: "Qty", type: "number", width: 90 }, { name: "unit", label: "Unit", width: 90 }],
        }}
        rowActions={[
          { label: "Send", icon: "bi-send", when: (r) => manage && r.status === "DRAFT", confirm: "Send this RFQ to the invited suppliers? It cannot be edited afterwards.", run: (r) => procApi.rfqs.act(r.id, "send") },
          { label: "Quotes", icon: "bi-columns-gap", tone: "success", silent: true, when: (r) => ["SENT", "CLOSED", "AWARDED"].includes(r.status), run: async (r) => setRfq(r) },
          { label: "Close", tone: "secondary", when: (r) => manage && r.status === "SENT", confirm: "Close this RFQ to new quotations?", run: (r) => procApi.rfqs.act(r.id, "close") },
          { label: "Cancel", tone: "secondary", when: (r) => manage && ["DRAFT", "SENT", "CLOSED"].includes(r.status), prompt: { fields: COMMENT_OPT, confirmLabel: "Cancel RFQ" }, run: (r) => procApi.rfqs.act(r.id, "cancel") },
        ]}
        topContent={(rows) => (
          <div className="row g-3">
            <div className="col-lg-4"><DonutCard title="RFQs by status" data={countBy(rows, "status")} /></div>
            <div className="col-lg-8"><BarCard title="Quotations received per RFQ" data={rows.slice(0, 8).map((r) => ({ name: r.number, invited: r.suppliers.length, received: r.quotation_count }))} xKey="name"
              bars={[{ key: "invited", name: "Invited" }, { key: "received", name: "Quotes received", color: "#0d9488" }]} /></div>
          </div>
        )}
      />
      {rfq && <QuotationManager rfqId={rfq.id} canManage={manage} onClose={() => { setRfq(null); setTick((t) => t + 1); }} onChanged={() => {}} />}
    </>
  );
}
