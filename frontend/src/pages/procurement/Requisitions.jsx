import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard, DonutCard, countBy, sumBy } from "../../components/procurement/charts";
import { COMMENT_OPT } from "../../components/procurement/ProcUI";
import { procApi } from "../../services/api";
import { MANAGE, can } from "../../components/procurement/roles";

const STATUS = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].map((v) => ({ value: v, label: v.replaceAll("_", " ").toLowerCase() }));
const PRIORITY = ["LOW", "NORMAL", "HIGH", "URGENT"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }));
const editable = (r) => ["DRAFT", "REJECTED"].includes(r.status);

export default function Requisitions() {
  return (
    <ResourcePage
      title="Purchase Requisitions" subtitle="Request what your department needs. Nothing is bought until it is approved."
      noun="requisition" historyView
      resource={procApi.requisitions} createLabel="New" modalSize="xl"
      canEdit={editable} canDelete={(r) => ["DRAFT", "REJECTED", "CANCELLED"].includes(r.status)}
      filters={[{ name: "status", label: "Status", options: STATUS }]}
      columns={[
        { key: "number", label: "PR No." }, { key: "title", label: "Title" }, { key: "department", label: "Department" },
        { key: "priority", label: "Priority", type: "status" }, { key: "required_by", label: "Required by", type: "date" },
        { key: "estimated_total", label: "Estimate", type: "money" },
        { key: "status", label: "Status", type: "status" },
        { key: "requested_by_name", label: "Requested by" },
      ]}
      fields={[
        { name: "title", label: "What do you need?", required: true, col: "col-md-8" },
        { name: "department", label: "Department", required: true, col: "col-md-4", help: "e.g. Science, Games, Boarding" },
        { name: "priority", label: "Priority", type: "select", options: PRIORITY, col: "col-md-4" },
        { name: "required_by", label: "Required by", type: "date", col: "col-md-4" },
        { name: "reason", label: "Reason", type: "textarea", col: "col-12" },
      ]}
      blank={{ priority: "NORMAL" }}
      itemsConfig={{
        label: "Items requested",
        blank: { description: "", specification: "", quantity: 1, unit: "pcs", estimated_unit_cost: 0 },
        columns: [
          { name: "description", label: "Item" }, { name: "specification", label: "Specification" },
          { name: "quantity", label: "Qty", type: "number", width: 90 }, { name: "unit", label: "Unit", width: 90 },
          { name: "estimated_unit_cost", label: "Est. unit cost", type: "number", width: 130 },
        ],
        viewColumns: [
          { name: "description", label: "Item" }, { name: "specification", label: "Specification" },
          { name: "quantity", label: "Qty" }, { name: "unit", label: "Unit" },
          { name: "estimated_unit_cost", label: "Unit cost" }, { name: "line_total", label: "Line total" },
        ],
        total: (i) => Number(i.quantity || 0) * Number(i.estimated_unit_cost || 0),
      }}
      rowActions={[
        { label: "Submit", icon: "bi-send", when: editable, confirm: "Submit this requisition for approval? You will not be able to edit it afterwards.", run: (r) => procApi.requisitions.act(r.id, "submit") },
        { label: "Cancel", tone: "secondary", when: (r) => ["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(r.status),
          prompt: { title: "Cancel requisition", fields: COMMENT_OPT, confirmLabel: "Cancel requisition" }, run: (r, v) => procApi.requisitions.act(r.id, "cancel", v) },
      ]}
      topContent={(rows) => (
        <div className="row g-3">
          <div className="col-lg-4"><DonutCard title="Requisitions by status" data={countBy(rows, "status")} /></div>
          <div className="col-lg-4"><BarCard title="Requested value by department" data={sumBy(rows.filter((r) => r.status !== "CANCELLED"), "department", "estimated_total", 6)} horizontal money /></div>
          <div className="col-lg-4"><BarCard title="By priority" data={countBy(rows, "priority")} /></div>
        </div>
      )}
    />
  );
}