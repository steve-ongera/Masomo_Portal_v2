import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { errMsg, procApi } from "../../services/api";
import { Alert, Loading, PageHeader, StatCard, StatusBadge, fdt, kes } from "../../components/procurement/ProcUI";
import { AreaCard, BarCard, DonutCard } from "../../components/procurement/charts";

export default function ProcurementDashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { procApi.dashboard().then((r) => setD(r.data)).catch((e) => setErr(errMsg(e))); }, []);

  if (err) return <Alert>{err}</Alert>;
  if (!d) return <Loading />;
  const c = d.cards;

  return (
    <div>
      <PageHeader title="Procurement" subtitle="From requisition to payment, at a glance" />

      {/* ---- Counter tiles ---- */}
      <div className="stat-grid">
        <StatCard icon="bi-clipboard-plus" label="Open requisitions" value={c.pending_requisitions} to="/procurement/requisitions" />
        <StatCard icon="bi-check2-square" tone="warning" label="Awaiting approval" value={c.pending_approvals} to="/procurement/approvals" />
        <StatCard icon="bi-envelope-paper" tone="info" label="RFQs out for quotes" value={c.active_rfqs} to="/procurement/rfqs" />
        <StatCard icon="bi-bag-check" tone="primary" label="Draft / pending POs" value={c.pending_pos} to="/procurement/purchase-orders" />
        <StatCard icon="bi-truck" tone="success" label="Deliveries expected" value={c.pending_deliveries} to="/procurement/purchase-orders" />
        <StatCard icon="bi-box-seam" tone="warning" label="GRNs to inspect" value={c.pending_grns} to="/procurement/goods-received" />
        <StatCard icon="bi-receipt" tone="danger" label="Unpaid invoices" value={c.open_invoices} hint={c.overdue_invoices ? `${c.overdue_invoices} overdue` : null} to="/procurement/invoices" />
        <StatCard icon="bi-file-earmark-text" tone="secondary" label="Contracts expiring (60d)" value={c.expiring_contracts} to="/procurement/contracts" />
      </div>

      {/* ---- Money tiles ---- */}
      <div className="stat-grid mt-3">
        <StatCard icon="bi-cash-coin" tone="success" label="Paid this month" value={kes(c.month_spend)} />
        <StatCard icon="bi-bag-check" label="Committed this year" value={kes(c.ytd_committed)} />
        <StatCard icon="bi-hourglass-split" tone="danger" label="Owed to suppliers" value={kes(c.payables)} />
      </div>

      {/* ---- Ordered vs paid + spend by department ---- */}
      <div className="row g-3 mb-3 mt-1">
        <div className="col-lg-8">
          <AreaCard
            title="Ordered vs paid"
            subtitle="Last 12 months"
            data={d.monthly_spend}
            money
            lines={[
              { key: "ordered", name: "Ordered (POs)" },
              { key: "paid", name: "Paid (invoices)", color: "#0d9488" },
            ]}
          />
        </div>
        <div className="col-lg-4">
          <DonutCard title="Spend by department" data={d.spend_by_department} money />
        </div>
      </div>

      {/* ---- Top suppliers + requisition + PO status ---- */}
      <div className="row g-3 mb-3">
        <div className="col-lg-4">
          <BarCard title="Top suppliers" data={d.spend_by_supplier} horizontal money />
        </div>
        <div className="col-lg-4">
          <DonutCard title="Requisitions by status" data={d.requisition_status} />
        </div>
        <div className="col-lg-4">
          <BarCard
            title="Purchase orders by status"
            data={d.po_status.map((x) => ({ ...x, name: x.name.replaceAll("_", " ").toLowerCase() }))}
            horizontal
          />
        </div>
      </div>

      {/* ---- Budget vs committed + recent activity ---- */}
      <div className="row g-3">
        <div className="col-lg-7">
          <BarCard
            title="Budget vs committed"
            subtitle="Current academic year"
            data={d.budget_utilization}
            xKey="department"
            money
            bars={[
              { key: "budget", name: "Budget" },
              { key: "committed", name: "Committed", color: "#f59e0b" },
            ]}
          />
        </div>
        <div className="col-lg-5">
          <div className="table-wrap h-100">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-clock-history me-2 text-brand"></i>
                Recent activity
              </span>
              <Link to="/procurement/audit" className="btn btn-sm btn-light">
                <i className="bi bi-list-ul"></i>
                Audit trail
              </Link>
            </div>

            <div className="p-3">
              {d.recent_activity.length ? (
                d.recent_activity.map((a) => (
                  <div
                    key={a.id}
                    className="d-flex justify-content-between align-items-center border-bottom py-2 small"
                  >
                    <span className="text-truncate me-2">
                      <StatusBadge value={a.action} />{" "}
                      <strong>{a.object_ref}</strong>{" "}
                      <span className="text-muted-soft">by {a.user_name}</span>
                    </span>
                    <span className="text-muted-soft text-nowrap">{fdt(a.created_at)}</span>
                  </div>
                ))
              ) : (
                <div className="text-muted-soft small">No activity yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}