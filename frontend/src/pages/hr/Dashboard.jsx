import { useEffect, useState } from "react";
import { hrApi } from "../../services/api";

const CATEGORY = {
  TEACHER: "Teachers",
  ADMINISTRATION: "Administration",
  ACCOUNTS: "Accounts",
  ICT: "ICT",
  SUPPORT: "Support staff",
};

const ATT = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  ON_LEAVE: "On leave",
  EARLY_DEPARTURE: "Left early",
  OFF_DUTY: "Off duty",
};

const ATT_META = {
  PRESENT: { badge: "badge-success", dot: "status-dot--online" },
  ABSENT: { badge: "badge-danger", dot: "status-dot--offline" },
  LATE: { badge: "badge-gold", dot: "status-dot--pending" },
  ON_LEAVE: { badge: "badge-blue", dot: "status-dot--pending" },
  EARLY_DEPARTURE: { badge: "badge-warning", dot: "status-dot--pending" },
  OFF_DUTY: { badge: "badge-neutral", dot: "status-dot--offline" },
};

export default function HRDashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    hrApi
      .dashboard()
      .then((r) => setD(r.data))
      .catch(() => setError("Could not load the HR summary."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="page-loader page-loader--inline">
        <div className="page-loader__ring" />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">HR Dashboard</h1>
            <p className="page-subtitle">Staff, attendance and contract overview</p>
          </div>
        </div>
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!d) return null;

  const attendanceTiles = Object.entries(ATT).map(([key, label]) => ({
    key,
    label,
    value: d.attendance_today?.[key] || 0,
  }));

  const categoryTiles = Object.entries(d.by_category || {}).map(([key, count]) => ({
    key,
    label: CATEGORY[key] || key,
    value: count,
  }));

  const leaveLabel = `${d.pending_leave} leave request${d.pending_leave === 1 ? "" : "s"} waiting`;
  const contractsLabel = `${d.contracts_expiring_30d} contract${d.contracts_expiring_30d === 1 ? "" : "s"} ending within 30 days`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">HR Dashboard</h1>
          <p className="page-subtitle">
            {leaveLabel} · {contractsLabel}
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="dm-card dm-card--primary">
          <div className="dm-card__top">
            <span className="dm-card__label">Staff on the payroll register</span>
            <span className="dm-card__icon">
              <i className="bi bi-people"></i>
            </span>
          </div>
          <div className="dm-card__num">{d.total}</div>
        </div>

        <div className="dm-card dm-card--warning">
          <div className="dm-card__top">
            <span className="dm-card__label">
              Leave request{d.pending_leave === 1 ? "" : "s"} awaiting a decision
            </span>
            <span className="dm-card__icon">
              <i className="bi bi-hourglass-split"></i>
            </span>
          </div>
          <div className="dm-card__num">{d.pending_leave}</div>
        </div>

        <div className="dm-card dm-card--danger">
          <div className="dm-card__top">
            <span className="dm-card__label">
              Contract{d.contracts_expiring_30d === 1 ? "" : "s"} ending within 30 days
            </span>
            <span className="dm-card__icon">
              <i className="bi bi-file-earmark-x"></i>
            </span>
          </div>
          <div className="dm-card__num">{d.contracts_expiring_30d}</div>
        </div>
      </div>

      {/* ---- Who is here today ---- */}
      <div className="table-wrap mb-4">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-calendar-check me-2 text-brand"></i>
            Who is here today
          </span>
          <span className="chart-card__subtitle mb-0">
            Live attendance snapshot
          </span>
        </div>

        <div className="p-3">
          <div className="row g-2">
            {attendanceTiles.map(({ key, label, value }) => {
              const meta = ATT_META[key] || { badge: "badge-neutral", dot: "status-dot--offline" };
              return (
                <div key={key} className="col-6 col-md-4 col-lg-2">
                  <div className="attendance-tile">
                    <span className={`badge ${meta.badge}`}>
                      <span className={`status-dot ${meta.dot}`}></span>
                      {label}
                    </span>
                    <span className="cell-mono fw-bold">
                      {value}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- Staff by category ---- */}
      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-diagram-3 me-2 text-brand"></i>
            Staff by category
          </span>
          <span className="chart-card__subtitle mb-0">
            {categoryTiles.reduce((sum, t) => sum + (t.value || 0), 0)} staff in total
          </span>
        </div>

        {categoryTiles.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-diagram-3"></i>
            <h6>No categories to show yet</h6>
            <p className="text-muted-soft">Staff categories will appear once payroll records exist.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ width: "140px" }}>Staff</th>
                  <th style={{ width: "200px" }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {categoryTiles.map(({ key, label, value }) => {
                  const total = categoryTiles.reduce((sum, t) => sum + (t.value || 0), 0) || 1;
                  const pct = Math.round((value / total) * 100);
                  return (
                    <tr key={key}>
                      <td>
                        <span className="cell-name">{label}</span>
                      </td>
                      <td className="cell-num">{value}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="progress-track flex-grow-1">
                            <div className="progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="form-text-hint text-end m-0" style={{ minWidth: 32 }}>
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}