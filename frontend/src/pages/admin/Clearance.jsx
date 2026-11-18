import { useEffect, useState } from "react";
import { clearanceApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";

const PAGE_SIZE = 25;

const currency = (v) => Number(v || 0).toLocaleString();
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "-";

const statusBadge = (app) => {
  if (app.status === "CLEARED") {
    return app.is_collected
      ? { cls: "badge-blue", text: "Collected" }
      : { cls: "badge-success", text: "Cleared" };
  }
  if (app.status === "REJECTED") return { cls: "badge-danger", text: "Not cleared" };
  return { cls: "badge-gold", text: "Pending" };
};

export default function AdminClearance() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(null); // { type, text }

  // review modal
  const [modal, setModal] = useState(null); // { app, mode: "clear" | "reject" }
  const [remarks, setRemarks] = useState("");
  const [force, setForce] = useState(false);
  const [modalError, setModalError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [listRes, sumRes] = await Promise.all([
        clearanceApi.list({
          page,
          status: statusFilter || undefined,
          search: search.trim() || undefined,
        }),
        clearanceApi.summary(),
      ]);
      const list = listRes.data.results ?? listRes.data;
      setRows(list);
      setCount(listRes.data.count ?? list.length);
      setSummary(sumRes.data);
    } catch (err) {
      console.error("Failed to load clearance applications:", err);
      setError(err.response?.data?.detail || "Could not load clearance applications.");
    } finally {
      setLoading(false);
    }
  };

  // reload on page / filter change; wait a moment while typing in the search box
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, search]);

  const openModal = (app, mode) => {
    setModal({ app, mode });
    setRemarks("");
    setForce(false);
    setModalError("");
  };
  const closeModal = () => {
    if (!busy) setModal(null);
  };

  const submitDecision = async () => {
    if (modal.mode === "reject" && !remarks.trim()) {
      setModalError("Please give the reason, so the student knows what to fix.");
      return;
    }
    setBusy(true);
    setModalError("");
    try {
      if (modal.mode === "clear") {
        await clearanceApi.clear(modal.app.id, { remarks, force });
        setMessage({ type: "success", text: `${modal.app.student_name} has been cleared.` });
      } else {
        await clearanceApi.reject(modal.app.id, { remarks });
        setMessage({ type: "success", text: `${modal.app.student_name} was marked as not cleared.` });
      }
      setModal(null);
      await load();
    } catch (err) {
      setModalError(err.response?.data?.detail || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const quickAction = async (app, kind) => {
    if (kind === "reopen" && !window.confirm(`Send ${app.student_name}'s application back to Pending?`)) return;
    if (kind === "collected" && !window.confirm(`Confirm ${app.student_name} has collected their certificate?`)) return;
    try {
      if (kind === "reopen") await clearanceApi.reopen(app.id);
      else await clearanceApi.markCollected(app.id);
      setMessage({
        type: "success",
        text: kind === "reopen"
          ? `${app.student_name}'s application is pending again.`
          : `${app.student_name}'s certificate was marked as collected.`,
      });
      await load();
    } catch (err) {
      setMessage({ type: "danger", text: err.response?.data?.detail || "Something went wrong." });
    }
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  const cards = summary && [
    { label: "Pending review", value: summary.pending, variant: "warning", icon: "bi-clock" },
    { label: "Cleared, awaiting collection", value: summary.awaiting_collection, variant: "success", icon: "bi-check2-circle" },
    { label: "Certificates collected", value: summary.collected, variant: "primary", icon: "bi-mortarboard" },
    { label: "Not cleared", value: summary.rejected, variant: "danger", icon: "bi-x-circle" },
  ];

  const hasFilters = !!(search || statusFilter);
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("");
    setPage(1);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Student Clearance</h1>
          <p className="page-subtitle">
            Review final-year students' clearance applications. Cleared students then collect their certificate in person.
          </p>
        </div>
      </div>

      {message && (
        <div className={`alert alert-${message.type} alert-dismissible fade show`}>
          {message.text}
          <button type="button" className="btn-close" onClick={() => setMessage(null)}></button>
        </div>
      )}

      {/* ---- Stat cards ---- */}
      {cards && (
        <div className="stat-grid">
          {cards.map((c) => (
            <div className={`dm-card dm-card--${c.variant}`} key={c.label}>
              <div className="dm-card__top">
                <span className="dm-card__label">{c.label}</span>
                <span className="dm-card__icon">
                  <i className={`bi ${c.icon}`}></i>
                </span>
              </div>
              <div className="dm-card__num">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ---- Filters + Table ---- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-funnel me-2 text-brand"></i>
            Applications
            <span className="badge badge-neutral ms-2">{count}</span>
          </span>
          {hasFilters && (
            <button className="btn btn-sm btn-light" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        <div className="toolbar p-3 mb-0">
          <div className="toolbar__search" style={{ maxWidth: "none" }}>
            <i className="bi bi-search"></i>
            <input
              className="form-control"
              placeholder="Search by name, admission no or clearance no"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select
            className="form-select w-auto"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending review</option>
            <option value="CLEARED">Cleared</option>
            <option value="REJECTED">Not cleared</option>
          </select>
        </div>

        {loading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : error ? (
          <div className="alert alert-danger m-3">
            <i className="bi bi-exclamation-circle me-2"></i>
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-patch-check"></i>
            <h6>No clearance applications</h6>
            <p className="text-muted-soft">
              {hasFilters
                ? "Nothing matches these filters."
                : "Applications appear here when final-year students apply for clearance."}
            </p>
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Applied</th>
                    <th className="text-end">Fee balance (KES)</th>
                    <th>Status</th>
                    <th style={{ width: "250px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((app) => {
                    const badge = statusBadge(app);
                    const balance = Number(app.current_balance);
                    return (
                      <tr key={app.id}>
                        <td>
                          <div className="cell-name">{app.student_name}</div>
                          <div className="cell-muted small">
                            {app.admission_no}
                            {app.student_phone ? ` · ${app.student_phone}` : ""}
                          </div>
                          {app.student_remarks && (
                            <div className="small text-muted-soft">
                              <i className="bi bi-chat-left-text me-1"></i>{app.student_remarks}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="badge badge-blue">{app.classroom_label}</span>
                        </td>
                        <td className="cell-mono">{fmtDate(app.submitted_at)}</td>
                        <td className={`cell-mono text-end fw-bold ${balance > 0 ? "text-danger" : "text-success"}`}>
                          {balance > 0 ? currency(balance) : balance < 0 ? `${currency(Math.abs(balance))} prepaid` : "0"}
                        </td>
                        <td>
                          <span className={`badge ${badge.cls}`}>{badge.text}</span>
                          {app.clearance_no && (
                            <div className="cell-muted small">{app.clearance_no}</div>
                          )}
                          {app.cleared_with_balance && (
                            <div className="small text-danger">Cleared with balance</div>
                          )}
                          {app.status === "REJECTED" && app.admin_remarks && (
                            <div className="small text-muted-soft">{app.admin_remarks}</div>
                          )}
                          {app.is_collected && (
                            <div className="cell-muted small">{fmtDate(app.collected_at)}</div>
                          )}
                        </td>
                        <td className="text-end">
                          <div className="table-actions justify-content-end flex-wrap">
                            {app.status === "PENDING" && (
                              <>
                                <button className="btn btn-sm btn-primary" onClick={() => openModal(app, "clear")}>
                                  <i className="bi bi-check2-circle me-1"></i>Clear
                                </button>
                                <button className="btn btn-sm btn-outline-danger" onClick={() => openModal(app, "reject")}>
                                  <i className="bi bi-x-circle me-1"></i>Not cleared
                                </button>
                              </>
                            )}
                            {app.status === "CLEARED" && !app.is_collected && (
                              <>
                                <button className="btn btn-sm btn-primary" onClick={() => quickAction(app, "collected")}>
                                  <i className="bi bi-mortarboard me-1"></i>Mark collected
                                </button>
                                <button className="btn btn-sm btn-outline-secondary" onClick={() => quickAction(app, "reopen")}>
                                  Reopen
                                </button>
                              </>
                            )}
                            {app.status === "REJECTED" && (
                              <button className="btn btn-sm btn-outline-secondary" onClick={() => quickAction(app, "reopen")}>
                                Reopen
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                Page <strong>{page}</strong> of <strong>{totalPages}</strong>
              </span>
              <div className="d-flex gap-2">
                <button
                  className="btn btn-sm btn-outline-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <i className="bi bi-chevron-left"></i> Prev
                </button>
                <button
                  className="btn btn-sm btn-outline-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <i className="bi bi-chevron-right"></i>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---- Review modal ---- */}
      {modal && (
        <div
          className="modal show d-block modal-scrim"
          tabIndex="-1"
          role="dialog"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="modal-dialog modal-dialog-centered" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {modal.mode === "clear" ? (
                    <><i className="bi bi-check2-circle me-2 text-ok"></i>Clear student</>
                  ) : (
                    <><i className="bi bi-x-circle me-2 text-owe"></i>Mark as not cleared</>
                  )}
                </h5>
                <button type="button" className="btn-close" onClick={closeModal}></button>
              </div>
              <div className="modal-body">
                <p className="mb-3">
                  <strong>{modal.app.student_name}</strong> ({modal.app.admission_no}) · {modal.app.classroom_label}
                </p>

                {modalError && (
                  <div className="alert alert-danger py-2">
                    <i className="bi bi-exclamation-circle me-2"></i>
                    {modalError}
                  </div>
                )}

                {modal.mode === "clear" && Number(modal.app.current_balance) > 0 && (
                  <div className="alert alert-warning py-2">
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    This student still owes <strong>KES {currency(modal.app.current_balance)}</strong>.
                    <div className="form-check mt-2">
                      <input
                        id="force-clear"
                        type="checkbox"
                        className="form-check-input"
                        checked={force}
                        onChange={(e) => setForce(e.target.checked)}
                      />
                      <label htmlFor="force-clear" className="form-check-label">
                        Clear anyway (this is recorded on the application)
                      </label>
                    </div>
                  </div>
                )}

                <label className="form-label">
                  {modal.mode === "clear" ? "Note for the student (optional)" : "Reason (the student will see this)"}
                </label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={
                    modal.mode === "clear"
                      ? "e.g. Collect your certificate from the office on weekdays"
                      : "e.g. Outstanding library books - please return them"
                  }
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={`btn ${modal.mode === "clear" ? "btn-primary" : "btn-danger"}`}
                  onClick={submitDecision}
                  disabled={busy || (modal.mode === "clear" && Number(modal.app.current_balance) > 0 && !force)}
                >
                  {busy ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Saving...
                    </>
                  ) : modal.mode === "clear" ? (
                    "Clear student"
                  ) : (
                    "Mark as not cleared"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}