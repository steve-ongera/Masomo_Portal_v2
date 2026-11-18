import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard, DonutCard, countBy, sumBy } from "../../components/procurement/charts";
import { useAuth } from "../../components/procurement/useProcAuth";
import { procApi } from "../../services/api";
import { MANAGE, can } from "../../components/procurement/roles";

const STATUS = ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }));

export default function Contracts() {
  const { user } = useAuth();
  const m = can(user?.role, MANAGE);
  return (
    <ResourcePage
      title="Procurement Contracts" subtitle="Supply agreements and renewal dates" icon="bi-file-earmark-text" noun="contract"
      resource={procApi.contracts} canCreate={m} canEdit={() => m} canDelete={() => m}
      filters={[{ name: "status", label: "Status", options: STATUS }]}
      columns={[
        { key: "reference", label: "Reference" }, { key: "title", label: "Title" }, { key: "supplier_name", label: "Supplier" },
        { key: "start_date", label: "Starts", type: "date" }, { key: "end_date", label: "Ends", type: "date" },
        { key: "days_to_expiry", label: "Expiry", render: (r) => r.status !== "ACTIVE" ? "—" :
          <span className={`badge text-bg-${r.days_to_expiry < 0 ? "danger" : r.days_to_expiry <= 60 ? "warning" : "light border text-dark"}`}>{r.days_to_expiry < 0 ? `${-r.days_to_expiry}d ago` : `${r.days_to_expiry}d left`}</span> },
        { key: "value", label: "Value", type: "money" }, { key: "status", label: "Status", type: "status" },
      ]}
      fields={[
        { name: "reference", label: "Contract reference", required: true, col: "col-md-4" }, { name: "title", label: "Title", required: true, col: "col-md-8" },
        { name: "supplier", label: "Supplier", type: "fk", required: true, optionsApi: () => procApi.suppliers.list(), optionLabel: (o) => o.name },
        { name: "status", label: "Status", type: "select", options: STATUS },
        { name: "start_date", label: "Start date", type: "date", required: true }, { name: "end_date", label: "End date", type: "date", required: true },
        { name: "value", label: "Contract value (KES)", type: "number" }, { name: "notes", label: "Notes", type: "textarea" },
      ]}
      blank={{ status: "ACTIVE" }}
      topContent={(rows) => (
        <div className="row g-3">
          <div className="col-lg-4"><DonutCard title="Contracts by status" data={countBy(rows, "status")} /></div>
          <div className="col-lg-4"><BarCard title="Contract value by supplier" data={sumBy(rows, "supplier_name", "value", 6)} horizontal money /></div>
          <div className="col-lg-4"><BarCard title="Next to expire (days left)" horizontal
            data={rows.filter((r) => r.status === "ACTIVE").sort((a, b) => a.days_to_expiry - b.days_to_expiry).slice(0, 6).map((r) => ({ name: r.reference, value: r.days_to_expiry }))} /></div>
        </div>
      )}
    />
  );
}
