import { useEffect, useState, useCallback, useMemo } from "react";
import { myLeaveApi, procErrMsg } from "../../services/api";
import Breadcrumb from "../../components/Breadcrumb";
import TableSkeleton from "../../components/TableSkeleton";
import Modal from "../../components/Modal";

const STATUS_META = {
  PENDING: { badge: "badge-warning", dot: "status-dot--pending", label: "Pending" },
  APPROVED: { badge: "badge-success", dot: "status-dot--online", label: "Approved" },
  REJECTED: { badge: "badge-danger", dot: "status-dot--offline", label: "Rejected" },
  CANCELLED: { badge: "badge-neutral", dot: "status-dot--offline", label: "Cancelled" },
};

const formatDate = (iso) =>
  iso
    ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "—";

const daysLabel = (n) => `${n} day${n === 1 ? "" : "s"}`;

// Mon–Fri count, mirrors the backend's weekdays_between
const countWeekdays = (start, end) => {
  if (!start || !end || end < start) return 0;
  let d = new Date(start + "T00:00:00");
  const last = new Date(end + "T00:00:00");
  let n = 0;
  while (d <= last) {
    const w = d.getDay();
    if (w !== 0 && w !== 6) n += 1;
    d.setDate(d.getDate() + 1);
  }
  return n;
};

const emptyForm = { leave_type: "", start_date: "", end_date: "", reason: "" };

export default function MyLeave() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("info");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await myLeaveApi.overview();
      setData(r.data);
    } catch (err) {
      setMsg(procErrMsg(err));
      setMsgType("danger");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const previewDays = useMemo(() => countWeekdays(form.start_date, form.end_date), [form.start_date, form.end_date]);
  const selectedBalance = data?.balances?.find((b) => String(b.leave_type) === String(form.leave_type));

  const openForm = () => {
    setForm(emptyForm);
    setFormError("");
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      await myLeaveApi.request({ ...form, leave_type: Number(form.leave_type) });
      setShowForm(false);
      setMsg("Leave request sent. HR will review it.");
      setMsgType("success");
      await load();
    } catch (err) {
      setFormError(procErrMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = async () => {
    setCancelling(true);
    try {
      await myLeaveApi.cancel(cancelTarget.id);
      setMsg("Request cancelled.");
      setMsgType("success");
      setCancelTarget(null);
      await load();
    } catch (err) {
      setMsg(procErrMsg(err));
      setMsgType("danger");
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  };

  const notLinked = data && data.linked === false;

  return (
    <div>
      <Breadcrumb items={[{ label: "Dashboard", href: "/" }, { label: "My Leave", href: "#" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-title">My Leave</h1>
          <p className="page-subtitle">Request leave (including sick leave) and track approvals</p>
        </div>
        {data?.linked && (
          <button className="btn btn-primary" onClick={openForm}>
            <i className="bi bi-plus-lg me-1"></i>
            Request Leave
          </button>
        )}
      </div>

      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show`} role="alert">
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={5} columns={6} />
      ) : notLinked ? (
        <div className="empty-state">
          <i className="bi bi-person-exclamation"></i>
          <h6>No staff record found</h6>
          <p className="text-muted-soft">
            Your account is not linked to an employee record yet. Please visit the HR office so one can be
            created for you, then you can request leave here.
          </p>
        </div>
      ) : data ? (
        <>
          <div className="d-flex flex-wrap gap-3 mb-3">
            {data.balances.map((b) => (
              <div
                key={b.leave_type}
                style={{
                  background: "var(--bg-app)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  padding: "0.6rem 0.9rem",
                  minWidth: "150px",
                }}
              >
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)" }}>{b.leave_type_name}</div>
                <div style={{ fontWeight: 700, color: "var(--ink-900)" }}>
                  {b.remaining} <span style={{ fontWeight: 400, fontSize: "var(--fs-xs)" }}>/ {b.entitled} days left</span>
                </div>
              </div>
            ))}
          </div>

          <div className="table-wrap">
            {data.requests.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-calendar2-check"></i>
                <h6>No leave requests yet</h6>
                <p className="text-muted-soft">Use “Request Leave” to submit your first one.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Days</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>HR Remarks</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.requests.map((r) => {
                      const meta = STATUS_META[r.status] || STATUS_META.CANCELLED;
                      return (
                        <tr key={r.id}>
                          <td>{r.leave_type_name}</td>
                          <td style={{ fontSize: "var(--fs-xs)" }}>{formatDate(r.start_date)}</td>
                          <td style={{ fontSize: "var(--fs-xs)" }}>{formatDate(r.end_date)}</td>
                          <td>{daysLabel(r.days)}</td>
                          <td style={{ maxWidth: "220px", whiteSpace: "normal", fontSize: "var(--fs-xs)" }}>
                            {r.reason || "—"}
                          </td>
                          <td>
                            <span className={`badge ${meta.badge}`}>
                              <span className={`status-dot ${meta.dot}`}></span>
                              {meta.label}
                            </span>
                          </td>
                          <td style={{ maxWidth: "220px", whiteSpace: "normal", fontSize: "var(--fs-xs)" }}>
                            {r.review_remarks || "—"}
                          </td>
                          <td>
                            {r.status === "PENDING" && (
                              <button className="btn btn-sm btn-outline-danger" onClick={() => setCancelTarget(r)}>
                                Cancel
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      <Modal show={showForm} onClose={() => setShowForm(false)} title="Request Leave">
        <form onSubmit={submit}>
          {formError && <div className="alert alert-danger py-2">{formError}</div>}

          <label className="form-label">Leave type</label>
          <select
            className="form-select mb-3"
            required
            value={form.leave_type}
            onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
          >
            <option value="">Select type…</option>
            {data?.leave_types?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <div className="row g-2 mb-2">
            <div className="col">
              <label className="form-label">From</label>
              <input
                type="date"
                className="form-control"
                required
                value={form.start_date}
                onChange={(e) =>
                  setForm({
                    ...form,
                    start_date: e.target.value,
                    end_date: form.end_date && form.end_date < e.target.value ? e.target.value : form.end_date,
                  })
                }
              />
            </div>
            <div className="col">
              <label className="form-label">To</label>
              <input
                type="date"
                className="form-control"
                required
                min={form.start_date}
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>

          {previewDays > 0 && (
            <div className="form-text mb-3" style={{ fontSize: "var(--fs-xs)" }}>
              {daysLabel(previewDays)} (weekdays only)
              {selectedBalance && ` · ${selectedBalance.remaining} days available`}
            </div>
          )}

          <label className="form-label">Reason</label>
          <textarea
            className="form-control"
            rows={3}
            required
            placeholder="e.g. Down with malaria, doctor advised rest."
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />

          <div className="mt-3 d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
              Close
            </button>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Sending..." : "Submit Request"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal show={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancel Request">
        {cancelTarget && (
          <>
            <p>
              Cancel your <strong>{cancelTarget.leave_type_name}</strong> request for{" "}
              <strong>{daysLabel(cancelTarget.days)}</strong>?
            </p>
            <div className="d-flex gap-2 justify-content-end">
              <button className="btn btn-secondary" onClick={() => setCancelTarget(null)}>
                Keep it
              </button>
              <button className="btn btn-danger" onClick={confirmCancel} disabled={cancelling}>
                {cancelling ? "Cancelling..." : "Cancel Request"}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}