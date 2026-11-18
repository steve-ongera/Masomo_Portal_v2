import ResourcePage from "../../components/procurement/ResourcePage";
import { BarCard, DonutCard, countBy, sumBy } from "../../components/procurement/charts";
import { useAuth } from "../../components/procurement/useProcAuth";
import { procApi } from "../../services/api";
import { MANAGE, can } from "../../components/procurement/roles";

const STATUS = [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "BLACKLISTED", label: "Blacklisted" }];

export default function Suppliers() {
  const { user } = useAuth();
  const manage = can(user?.role, MANAGE);
  return (
    <ResourcePage
      title="Suppliers" subtitle="Approved vendors, contacts and purchase history" icon="bi-truck" noun="supplier"
      resource={procApi.suppliers} canCreate={manage} canEdit={() => manage} canDelete={() => manage} createLabel="Add"
      filters={[{ name: "status", label: "Status", options: STATUS }]}
      columns={[
        { key: "number", label: "Code" }, { key: "name", label: "Supplier" }, { key: "category", label: "Category" },
        { key: "contact_person", label: "Contact" }, { key: "phone", label: "Phone" },
        { key: "po_count", label: "Orders" }, { key: "total_spend", label: "Total spend", type: "money" },
        { key: "status", label: "Status", type: "status" },
      ]}
      fields={[
        { name: "name", label: "Company name", required: true, col: "col-md-8" },
        { name: "status", label: "Status", type: "select", options: STATUS, col: "col-md-4" },
        { name: "category", label: "Category", help: "e.g. Stationery, Lab equipment" },
        { name: "contact_person", label: "Contact person" },
        { name: "phone", label: "Phone" }, { name: "email", label: "Email", type: "email" },
        { name: "kra_pin", label: "KRA PIN" }, { name: "address", label: "Address" },
        { name: "bank_name", label: "Bank" }, { name: "bank_account", label: "Account number" },
        { name: "notes", label: "Notes", type: "textarea", col: "col-12" },
      ]}
      blank={{ status: "ACTIVE" }}
      topContent={(rows) => (
        <div className="row g-3">
          <div className="col-lg-4"><DonutCard title="Suppliers by status" data={countBy(rows, "status")} /></div>
          <div className="col-lg-8"><BarCard title="Top suppliers by spend" subtitle="Approved purchase orders" data={sumBy(rows, "name", "total_spend", 7)} horizontal money /></div>
        </div>
      )}
    />
  );
}
