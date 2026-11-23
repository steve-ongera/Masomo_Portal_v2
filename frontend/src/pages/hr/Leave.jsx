import { useEffect, useState, useCallback, useMemo } from "react";
import { hrApi } from "../../services/api";
import Breadcrumb from "../../components/Breadcrumb";
import TableSkeleton from "../../components/TableSkeleton";
import Modal from "../../components/Modal";

const STATUS_FILTERS = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "", label: "All" },
];

const STATUS_META = {
  PENDING: { badge: "badge-warning", dot: "status-dot--pending", label: "Pending" },
  APPROVED: { badge: "badge-success", dot: "status-dot--online", label: "Approved" },
  REJECTED: { badge: "badge-danger", dot: "status-dot--offline", label: "Rejected" },
  CANCELLED: { badge: "badge-neutral", dot: "status-dot--offline", label: "Cancelled" },
};

const LEAVE_TYPE_ACCENT = {
  ANNUAL: "badge-blue",
  SICK: "badge-danger",
  MATERNITY: "badge-gold",
  PATERNITY: "badge-gold",
  COMPASSIONATE: "badge-neutral",
  STUDY: "badge-blue",
  UNPAID: "badge-neutral",
};

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const formatDateTime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const daysLabel = (n) => `${n} day${n === 1 ? "" : "s"}`;

// one label/value row inside the details modal
const DetailRow = ({ label, children }) => (
  <div
    style={{
      display: "flex",
      gap: "0.75rem",
      padding: "0.45rem 0",
      borderBottom: "1px solid var(--border-color)",
      fontSize: "var(--fs-sm, 0.875rem)",
    }}
  >
    <div style={{ width: "130px", flexShrink: 0, color: "var(--ink-600)", fontSize: "var(--fs-xs)" }}>
      {label}
    </div>
    <div style={{ flex: 1, color: "var(--ink-900)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {children}
    </div>
  </div>
);

export default function Leave() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("PENDING");

  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("info");

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailTarget, setDetailTarget] = useState(null);

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);

  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approveTarget, setApproveTarget] = useState(null);
  const [approveSaving, setApproveSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const r = await hrApi.leave.list(params);
      setRows(r.data.results ?? r.data);
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not load leave requests.");
      setMsgType("danger");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = (row) => {
    setDetailTarget(row);
    setShowDetailModal(true);
  };

  const openApprove = (row) => {
    setApproveTarget(row);
    setShowApproveModal(true);
  };

  const confirmApprove = async (e) => {
    e.preventDefault();
    if (!approveTarget) return;
    setApproveSaving(true);
    try {
      await hrApi.leave.approve(approveTarget.id);
      setMsg(
        `Approved ${approveTarget.employee_name}'s leave. Staff attendance will show On leave for those days.`
      );
      setMsgType("success");
      setShowApproveModal(false);
      await load();
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not save the decision.");
      setMsgType("danger");
      setShowApproveModal(false);
    } finally {
      setApproveSaving(false);
    }
  };

  const openReject = (row) => {
    setRejectTarget(row);
    setRejectRemarks("");
    setShowRejectModal(true);
  };

  const confirmReject = async (e) => {
    e.preventDefault();
    if (!rejectTarget) return;
    const remarks = rejectRemarks.trim();
    if (!remarks) return;
    setRejectSaving(true);
    try {
      await hrApi.leave.reject(rejectTarget.id, remarks);
      setMsg(`Rejected ${rejectTarget.employee_name}'s leave request.`);
      setMsgType("success");
      setShowRejectModal(false);
      await load();
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not save the decision.");
      setMsgType("danger");
      setShowRejectModal(false);
    } finally {
      setRejectSaving(false);
    }
  };

  const summary = useMemo(() => {
    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
    let other = 0;
    rows.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status] += 1;
      else other += 1;
    });
    return { counts, other };
  }, [rows]);

  const canDecide = (row) => row.status === "PENDING";
  const isPendingView = statusFilter === "PENDING";

  const metaFor = (status) =>
    STATUS_META[status] || { badge: "badge-neutral", dot: "status-dot--offline", label: status };

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/hr" },
          { label: "HR", href: "/hr" },
          { label: "Leave Requests", href: "#" },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Requests</h1>
          <p className="page-subtitle">
            {isPendingView
              ? "Requests waiting for your decision"
              : "Review all leave requests across staff"}
          </p>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show`} role="alert">
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      <div className="table-wrap">
        <div
          className="table-wrap__header"
          style={{ flexDirection: "column", alignItems: "stretch", gap: "0.75rem" }}
        >
          <div className="d-flex flex-wrap gap-2" style={{ width: "100%" }}>
            <ul className="nav academic-year-tabs mb-0">
              {STATUS_FILTERS.map((f) => (
                <li className="nav-item" key={f.value || "ALL"}>
                  <button
                    type="button"
                    className={`nav-link ${statusFilter === f.value ? "active" : ""}`}
                    onClick={() => setStatusFilter(f.value)}
                  >
                    {f.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
              <i className="bi bi-calendar2-check me-2"></i>
              {isPendingView ? "Pending Requests" : "Leave Requests"}
            </span>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              {Object.entries(summary.counts).map(([key, count]) => {
                const meta = metaFor(key);
                if (!count) return null;
                return (
                  <span key={key} className={`badge ${meta.badge}`}>
                    <span className={`status-dot ${meta.dot}`}></span>
                    {meta.label}: {count}
                  </span>
                );
              })}
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
                {rows.length} record{rows.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-calendar2-check"></i>
            <h6>
              {isPendingView ? "Nothing pending — all caught up" : "No leave requests to show"}
            </h6>
            <p className="text-muted-soft">
              {isPendingView
                ? "New requests will appear here for approval or rejection."
                : "Try a different status filter."}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th style={{ width: "110px" }}>Working Days</th>
                  <th>Reason</th>
                  <th style={{ width: "160px" }}>Status</th>
                  <th style={{ width: "230px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = metaFor(r.status);
                  const typeAccent = LEAVE_TYPE_ACCENT[r.leave_type_code] || "badge-neutral";
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">
                            {(r.employee_name || "")
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <span className="cell-name">{r.employee_name || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${typeAccent}`}>{r.leave_type_name || "—"}</span>
                      </td>
                      <td style={{ fontSize: "var(--fs-xs)" }}>{formatDate(r.start_date)}</td>
                      <td style={{ fontSize: "var(--fs-xs)" }}>{formatDate(r.end_date)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                          {daysLabel(r.days)}
                        </span>
                      </td>
                      <td
                        style={{
                          maxWidth: "240px",
                          whiteSpace: "normal",
                          fontSize: "var(--fs-xs)",
                          color: "var(--ink-700)",
                        }}
                        title={r.reason || ""}
                      >
                        {r.reason ? r.reason : <span className="cell-muted">—</span>}
                      </td>
                      <td>
                        <span className={`badge ${meta.badge}`}>
                          <span className={`status-dot ${meta.dot}`}></span>
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => openDetail(r)}
                            title="View details"
                            aria-label="View details"
                          >
                            <i className="bi bi-eye"></i>
                          </button>
                          {canDecide(r) && (
                            <>
                              <button className="btn btn-sm btn-success" onClick={() => openApprove(r)} title="Approve this request">
                                <i className="bi bi-check2 me-1"></i>
                                Approve
                              </button>
                              <button className="btn btn-sm btn-outline-danger" onClick={() => openReject(r)} title="Reject this request">
                                <i className="bi bi-x-lg me-1"></i>
                                Reject
                              </button>
                            </>
                          )}
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

      {/* ---------- View details ---------- */}
      <Modal show={showDetailModal} onClose={() => setShowDetailModal(false)} title="Leave Request Details">
        {detailTarget && (
          <div>
            <div className="d-flex align-items-center gap-3 mb-3">
              <div className="avatar-sm">
                {(detailTarget.employee_name || "")
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((n) => n[0])
                  .join("")}
              </div>
              <div>
                <div style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                  {detailTarget.employee_name || "—"}
                </div>
                <span className={`badge ${metaFor(detailTarget.status).badge}`}>
                  <span className={`status-dot ${metaFor(detailTarget.status).dot}`}></span>
                  {metaFor(detailTarget.status).label}
                </span>
              </div>
            </div>

            <DetailRow label="Leave type">
              <span className={`badge ${LEAVE_TYPE_ACCENT[detailTarget.leave_type_code] || "badge-neutral"}`}>
                {detailTarget.leave_type_name || "—"}
              </span>
            </DetailRow>
            <DetailRow label="From">{formatDate(detailTarget.start_date)}</DetailRow>
            <DetailRow label="To">{formatDate(detailTarget.end_date)}</DetailRow>
            <DetailRow label="Working days">{daysLabel(detailTarget.days)}</DetailRow>
            <DetailRow label="Reason">{detailTarget.reason || "—"}</DetailRow>
            <DetailRow label="Requested on">{formatDateTime(detailTarget.created_at)}</DetailRow>

            {detailTarget.status !== "PENDING" && detailTarget.status !== "CANCELLED" && (
              <>
                <DetailRow label="Decided by">
                  {detailTarget.reviewed_by_name || (detailTarget.reviewed_by ? "HR officer" : "—")}
                </DetailRow>
                <DetailRow label="Decided on">{formatDateTime(detailTarget.reviewed_at)}</DetailRow>
                <DetailRow label="HR remarks">{detailTarget.review_remarks || "—"}</DetailRow>
              </>
            )}

            <div className="mt-3 d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowDetailModal(false)}>
                Close
              </button>
              {canDecide(detailTarget) && (
                <>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    onClick={() => {
                      setShowDetailModal(false);
                      openReject(detailTarget);
                    }}
                  >
                    <i className="bi bi-x-lg me-1"></i>
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={() => {
                      setShowDetailModal(false);
                      openApprove(detailTarget);
                    }}
                  >
                    <i className="bi bi-check2 me-1"></i>
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ---------- Approve ---------- */}
      <Modal show={showApproveModal} onClose={() => setShowApproveModal(false)} title="Approve Leave">
        {approveTarget && (
          <form onSubmit={confirmApprove}>
            <div className="modal-icon-circle modal-icon-circle--success">
              <i className="bi bi-check2-circle"></i>
            </div>
            <p className="text-center mb-3">
              Approve <strong>{approveTarget.employee_name}</strong>'s{" "}
              <strong>{approveTarget.leave_type_name}</strong> request for{" "}
              <strong>{daysLabel(approveTarget.days)}</strong>?
            </p>

            <div
              style={{
                background: "var(--bg-app)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "0.6rem 0.75rem",
                fontSize: "var(--fs-xs)",
                color: "var(--ink-600)",
                lineHeight: 1.55,
              }}
            >
              <div>
                <strong>From:</strong> {formatDate(approveTarget.start_date)} · <strong>To:</strong>{" "}
                {formatDate(approveTarget.end_date)}
              </div>
              {approveTarget.reason && (
                <div style={{ marginTop: "0.25rem" }}>
                  <strong>Reason:</strong> {approveTarget.reason}
                </div>
              )}
            </div>

            <p className="text-muted-soft mt-3 mb-0" style={{ fontSize: "var(--fs-xs)" }}>
              Attendance for those days will show <strong>On leave</strong> automatically once approved.
            </p>

            <div className="mt-3 d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowApproveModal(false)}>
                Cancel
              </button>
              <button className="btn btn-success" type="submit" disabled={approveSaving}>
                {approveSaving ? "Approving..." : "Approve Leave"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---------- Reject ---------- */}
      <Modal show={showRejectModal} onClose={() => setShowRejectModal(false)} title="Reject Leave">
        {rejectTarget && (
          <form onSubmit={confirmReject}>
            <div className="modal-icon-circle modal-icon-circle--danger">
              <i className="bi bi-x-circle"></i>
            </div>
            <p className="text-center mb-3">
              Rejecting <strong>{rejectTarget.employee_name}</strong>'s request.
            </p>

            <label className="form-label">Reason for rejection</label>
            <textarea
              className="form-control"
              rows={3}
              required
              placeholder="e.g. Overlaps with exam week — please reschedule."
              value={rejectRemarks}
              onChange={(e) => setRejectRemarks(e.target.value)}
            />
            <div className="form-text" style={{ fontSize: "var(--fs-xs)" }}>
              This reason is stored with the request and shown to the staff member.
            </div>

            <div className="mt-3 d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowRejectModal(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" type="submit" disabled={rejectSaving || !rejectRemarks.trim()}>
                {rejectSaving ? "Rejecting..." : "Reject Leave"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}