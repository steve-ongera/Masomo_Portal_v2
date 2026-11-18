import { useState } from "react";
import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard } from "../../components/procurement/charts";
import { useAuth } from "../../components/procurement/useProcAuth";
import { procApi } from "../../services/api";

const ROLES = ["PRINCIPAL", "PROCUREMENT", "FINANCE", "SECRETARY", "ADMIN"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }));

export default function Budgets() {
  const { user } = useAuth();
  const admin = user?.role === "ADMIN";
  const [tab, setTab] = useState("budgets");
  return (
    <div>
      <ul className="nav nav-pills mb-3">
        <li className="nav-item"><button className={`nav-link ${tab === "budgets" ? "active" : ""}`} onClick={() => setTab("budgets")}>Department budgets</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === "levels" ? "active" : ""}`} onClick={() => setTab("levels")}>Approval chain</button></li>
      </ul>

      {tab === "budgets" ? (
        <ResourcePage
          key="b" title="Department Budgets" subtitle="A purchase order cannot be approved if it would take its department over budget" icon="bi-piggy-bank" noun="budget"
          resource={procApi.budgets} canCreate={admin} canEdit={() => admin} canDelete={() => admin}
          columns={[
            { key: "department", label: "Department" }, { key: "year", label: "Year" },
            { key: "amount", label: "Budget", type: "money" }, { key: "committed", label: "Committed", type: "money" }, { key: "remaining", label: "Remaining", type: "money" },
            { key: "used", label: "Used", render: (r) => { const p = Math.min(100, Math.round((Number(r.committed) / Number(r.amount || 1)) * 100));
              return <div className="progress" style={{ height: 10, minWidth: 90 }} title={`${p}%`}><div className={`progress-bar ${p > 90 ? "bg-danger" : p > 70 ? "bg-warning" : "bg-success"}`} style={{ width: `${p}%` }} /></div>; } },
          ]}
          fields={[{ name: "department", label: "Department", required: true, lockOnEdit: true, help: "Must match the department name used on requisitions and orders" },
            { name: "amount", label: "Budget (KES)", type: "number", required: true }]}
          topContent={(rows) => (
            <BarCard title="Budget vs committed" data={rows.map((r) => ({ name: r.department, budget: Number(r.amount), committed: Number(r.committed) }))} xKey="name" money
              bars={[{ key: "budget", name: "Budget" }, { key: "committed", name: "Committed", color: "#f59e0b" }]} />
          )}
        />
      ) : (
        <ResourcePage
          key="l" title="Approval Chain" subtitle="Who approves requisitions (PR) and purchase orders (PO), in order. Empty chain = Principal only." icon="bi-diagram-3" noun="approval level"
          resource={procApi.levels} canCreate={admin} canEdit={() => admin} canDelete={() => admin}
          columns={[{ key: "document_type", label: "Document", render: (r) => (r.document_type === "PR" ? "Requisition" : "Purchase order") },
            { key: "order", label: "Step" }, { key: "role", label: "Approver role" }, { key: "is_active", label: "Active", render: (r) => (r.is_active ? "Yes" : "No") }]}
          fields={[
            { name: "document_type", label: "Document", type: "select", required: true, options: [{ value: "PR", label: "Purchase requisition" }, { value: "PO", label: "Purchase order" }] },
            { name: "order", label: "Step number", type: "number", required: true, help: "1 approves first" },
            { name: "role", label: "Approver role", type: "select", options: ROLES, required: true }, { name: "is_active", label: "Active", type: "checkbox" },
          ]}
          blank={{ is_active: true }}
        />
      )}
    </div>
  );
}
