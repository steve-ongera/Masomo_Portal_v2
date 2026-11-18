import { useState } from "react";
import Modal from "../../components/Modal";
import { boardingApi, unwrap } from "../../services/boardingApi";
import {
  fmtDateTime,
  localToIso,
  Msg,
  NoHostelNotice,
  useAccess,
  useAction,
  useLoad,
} from "./common";

const TYPES = [
  ["EXEAT", "Exeat (home visit / weekend)"],
  ["LEAVE_OUT", "Leave-out (day outing)"],
  ["MEDICAL", "Medical"],
  ["EMERGENCY", "Family emergency"],
  ["SENT_HOME", "Sent home (fees / discipline)"],
];

const TABS = [
  ["PENDING", "Pending"],
  ["APPROVED", "Approved"],
  ["OUT", "Out now"],
  ["OVERDUE", "Overdue"],
  ["RETURNED", "Returned"],
  ["REJECTED", "Rejected"],
  ["CANCELLED", "Cancelled"],
  ["", "All"],
];

const STATUS_BADGE = {
  PENDING: "badge-warning",
  APPROVED: "badge-blue",
  OUT: "badge-neutral",
  RETURNED: "badge-success",
  REJECTED: "badge-danger",
  CANCELLED: "badge-neutral",
};

export default function Exeats() {
  const access = useAccess();
  const act = useAction();

  const [tab, setTab] = useState("PENDING");
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Which row's check-out modal is open (holds the exeat object)
  const [checkOutFor, setCheckOutFor] = useState(null);

  const params = { q: q || undefined, page_size: 200 };
  if (tab === "OVERDUE") params.overdue = 1;
  else if (tab) params.status = tab;

  const list = useLoad(async () => unwrap(await boardingApi.exeats(params)), [tab, q]);

  const doAct = async (ex, action, body, okText) => {
    const r = await act.run(() => boardingApi.exeatAct(ex.id, action, body), okText);
    if (r) {
      setCheckOutFor(null);
      list.reload();
    }
  };

  const reject = (ex) => {
    const note = window.prompt("Reason for rejecting (required):", "");
    if (note) doAct(ex, "reject", { note }, "Rejected.");
  };

  const rows = list.data || [];
  const hasFilters = !!(q || tab !== "PENDING");

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Exeat / Leave-out</h1>
          <p className="page-subtitle">
            Manage exeats, day leave-outs, and check-outs
          </p>
        </div>
        {access?.can_operate && (
          <div className="page-header__actions">
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              <i className="bi bi-plus-lg" />
              New exeat slip
            </button>
          </div>
        )}
      </div>

      <NoHostelNotice />
      <Msg error={act.error || list.error} ok={act.ok} />

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          {/* Search + clear */}
          <div className="toolbar mb-0">
            <div className="toolbar__search">
              <i className="bi bi-search" />
              <input
                type="text"
                className="form-control"
                placeholder="Search slip / name / adm no..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="toolbar__spacer" />
            <span className="chart-card__subtitle">
              {rows.length} slip{rows.length !== 1 ? "s" : ""}
            </span>
            {hasFilters && (
              <button
                className="btn btn-sm btn-light"
                onClick={() => {
                  setQ("");
                  setTab("PENDING");
                }}
              >
                <i className="bi bi-x-lg" /> Clear
              </button>
            )}
          </div>

          {/* Status tabs */}
          <ul className="nav nav-tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <li className="nav-item" role="presentation" key={k || "all"}>
                <button
                  type="button"
                  role="tab"
                  className={`nav-link ${tab === k ? "active" : ""}`}
                  onClick={() => setTab(k)}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {list.loading ? (
          <div className="text-center py-4">
            <span className="spinner-border spinner-border-sm me-2" />
            Loading exeats...
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-door-open" />
            <h6>
              {hasFilters
                ? `No ${tab === "OVERDUE" ? "overdue" : (tab || "matching").toLowerCase()} exeats`
                : "No exeats yet"}
            </h6>
            <p className="text-muted-soft">
              {hasFilters
                ? "Try a different tab or clear your search."
                : "Create the first slip with the New exeat slip button above."}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table--stack mb-0">
              <thead>
                <tr>
                  <th>Slip</th>
                  <th>Student</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Leaves</th>
                  <th>Back by</th>
                  <th>Status</th>
                  <th style={{ width: 200 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ex) => (
                  <tr key={ex.id}>
                    <td data-label="Slip" className="cell-mono text-brand fw-semibold">
                      {ex.slip_no}
                    </td>
                    <td data-label="Student">
                      <div>
                        <div className="cell-name">{ex.student_name}</div>
                        <div className="text-muted-soft small">
                          <span className="cell-mono">{ex.admission_no}</span>
                          {ex.bed_label ? ` · ${ex.bed_label}` : ""}
                        </div>
                      </div>
                    </td>
                    <td data-label="Type">
                      <span className="badge badge-neutral">{ex.exeat_type_display}</span>
                      {ex.needs_principal && (
                        <div className="text-muted-soft small mt-1">
                          <i className="bi bi-shield-check me-1" />
                          Principal approves
                        </div>
                      )}
                    </td>
                    <td data-label="Reason">
                      <div>{ex.reason}</div>
                      {ex.destination && (
                        <div className="text-muted-soft small">
                          <i className="bi bi-geo-alt me-1" />
                          {ex.destination}
                        </div>
                      )}
                      {ex.source === "PARENT" && (
                        <span className="badge badge-gold mt-1">Parent request</span>
                      )}
                    </td>
                    <td data-label="Leaves" className="cell-mono">
                      {fmtDateTime(ex.expected_departure)}
                    </td>
                    <td data-label="Back by" className="cell-mono">
                      {fmtDateTime(ex.expected_return)}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`badge ${
                          ex.is_overdue
                            ? "badge-danger"
                            : STATUS_BADGE[ex.status] || "badge-neutral"
                        }`}
                      >
                        {ex.is_overdue ? "Overdue" : ex.status_display}
                      </span>
                      {ex.returned_late && (
                        <span className="badge badge-warning mt-1">Returned late</span>
                      )}
                      {ex.decision_note && (
                        <div className="text-muted-soft small mt-1 fst-italic">
                          {ex.decision_note}
                        </div>
                      )}
                    </td>
                    <td data-label="Actions">
                      <div className="table-actions">
                        {ex.status === "PENDING" && access?.can_approve_exeat && (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-success btn-icon"
                              title="Approve"
                              aria-label="Approve"
                              disabled={act.busy}
                              onClick={() => doAct(ex, "approve", {}, "Approved.")}
                            >
                              <i className="bi bi-check2" />
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger btn-icon"
                              title="Reject"
                              aria-label="Reject"
                              disabled={act.busy}
                              onClick={() => reject(ex)}
                            >
                              <i className="bi bi-x" />
                            </button>
                          </>
                        )}
                        {ex.status === "APPROVED" && access?.can_operate && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary btn-icon"
                            title="Check out"
                            aria-label="Check out"
                            onClick={() =>
                              setCheckOutFor(checkOutFor?.id === ex.id ? null : ex)
                            }
                          >
                            <i className="bi bi-box-arrow-right" />
                          </button>
                        )}
                        {ex.status === "OUT" && access?.can_operate && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary btn-icon"
                            title="Check in"
                            aria-label="Check in"
                            disabled={act.busy}
                            onClick={() => doAct(ex, "check_in", {}, "Checked back in.")}
                          >
                            <i className="bi bi-box-arrow-in-left" />
                          </button>
                        )}
                        {["PENDING", "APPROVED"].includes(ex.status) &&
                          access?.can_operate && (
                            <button
                              type="button"
                              className="btn btn-sm btn-light btn-icon"
                              title="Cancel"
                              aria-label="Cancel"
                              disabled={act.busy}
                              onClick={() => doAct(ex, "cancel", {}, "Cancelled.")}
                            >
                              <i className="bi bi-slash-circle" />
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- New exeat slip modal ---------- */}
      <Modal
        show={showForm}
        onClose={() => setShowForm(false)}
        title="New exeat slip"
        size="lg"
      >
        <ExeatForm
          access={access}
          onCreated={() => {
            setShowForm(false);
            list.reload();
          }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      {/* ---------- Check-out modal ---------- */}
      <Modal
        show={!!checkOutFor}
        onClose={() => setCheckOutFor(null)}
        title={checkOutFor ? `Check out ${checkOutFor.student_name}` : "Check out"}
      >
        {checkOutFor && (
          <>
            <div className="profile-info-row">
              <span>Slip</span>
              <span className="cell-mono">{checkOutFor.slip_no}</span>
            </div>
            <div className="profile-info-row">
              <span>Back by</span>
              <span>{fmtDateTime(checkOutFor.expected_return)}</span>
            </div>
            <p className="form-text-hint mt-2">
              Record who is collecting the student. All fields are optional but
              recommended for safeguarding.
            </p>
            <CheckOutForm
              busy={act.busy}
              onCancel={() => setCheckOutFor(null)}
              onSubmit={(b) => doAct(checkOutFor, "check_out", b, "Checked out.")}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check-out form (now inside a Modal, so no wrapping container)
// ---------------------------------------------------------------------------
function CheckOutForm({ onSubmit, onCancel, busy }) {
  const [f, setF] = useState({
    collected_by_name: "",
    collected_by_id_no: "",
    collected_by_relationship: "",
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
    >
      <div className="row g-3 mt-1">
        <div className="col-12">
          <label className="form-label">Collected by (name)</label>
          <input
            className="form-control"
            value={f.collected_by_name}
            onChange={(e) => setF({ ...f, collected_by_name: e.target.value })}
            required
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">ID number</label>
          <input
            className="form-control"
            value={f.collected_by_id_no}
            onChange={(e) => setF({ ...f, collected_by_id_no: e.target.value })}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">Relationship</label>
          <input
            className="form-control"
            value={f.collected_by_relationship}
            onChange={(e) =>
              setF({ ...f, collected_by_relationship: e.target.value })
            }
          />
        </div>
      </div>

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Checking out...
            </>
          ) : (
            "Confirm check-out"
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// New exeat form (inside the New exeat modal)
// ---------------------------------------------------------------------------
function ExeatForm({ access, onCreated, onCancel }) {
  const act = useAction();
  const [q, setQ] = useState("");
  const [reg, setReg] = useState(null);
  const [f, setF] = useState({
    exeat_type: "EXEAT",
    reason: "",
    destination: "",
    contact_name: "",
    contact_phone: "",
    expected_departure: "",
    expected_return: "",
    approve_now: false,
  });
  const found = useLoad(
    async () =>
      q.trim().length >= 2
        ? unwrap(
            await boardingApi.registrations({
              q: q.trim(),
              status: "REGISTERED",
              page_size: 10,
            })
          )
        : [],
    [q]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!reg) {
      act.setError("Choose a student first.");
      return;
    }
    const r = await act.run(
      () =>
        boardingApi.createExeat({
          ...f,
          registration: reg.id,
          expected_departure: localToIso(f.expected_departure),
          expected_return: localToIso(f.expected_return),
        }),
      "Slip created."
    );
    if (r) onCreated();
  };

  return (
    <form onSubmit={submit}>
      <Msg error={act.error || found.error} ok={act.ok} />

      {/* ---------- Student ---------- */}
      <h6 className="settings-section__title mb-2">Student</h6>
      {reg ? (
        <div className="alert alert-primary d-flex align-items-center flex-wrap gap-2">
          <i className="bi bi-person-check" />
          <span>
            <span className="cell-mono text-brand fw-semibold me-2">
              {reg.admission_no}
            </span>
            <span className="cell-name">{reg.student_name}</span>
            {reg.class_name && (
              <span className="text-muted-soft small ms-2">({reg.class_name})</span>
            )}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-light ms-auto"
            onClick={() => {
              setReg(null);
              setQ("");
            }}
          >
            <i className="bi bi-x-lg me-1" />
            Change
          </button>
        </div>
      ) : (
        <>
          <div className="input-icon-group mb-2">
            <i className="bi bi-search input-icon-leading" />
            <input
              className="form-control"
              placeholder="Search boarder by name or admission no (min 2 letters)..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {q.trim().length > 0 && q.trim().length < 2 && (
            <div className="form-text-hint mt-0">
              Type at least 2 characters to search.
            </div>
          )}
          {found.loading ? (
            <div className="text-center py-2">
              <span className="spinner-border spinner-border-sm me-2" />
              Searching...
            </div>
          ) : q.trim().length >= 2 && (found.data || []).length === 0 ? (
            <p className="form-text-hint mt-0">No matching boarders.</p>
          ) : (
            (found.data || []).length > 0 && (
              <div className="pick-list">
                {found.data.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="pick-item"
                    onClick={() => setReg(r)}
                  >
                    <span>
                      <span className="pick-item__adm">{r.admission_no}</span>
                      <span className="cell-name">{r.student_name}</span>
                      {r.class_name && (
                        <span className="text-muted-soft small ms-2">
                          ({r.class_name})
                        </span>
                      )}
                    </span>
                    <i className="bi bi-arrow-right-circle" />
                  </button>
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* ---------- Details ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Details</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Exeat type</label>
          <select
            className="form-select"
            value={f.exeat_type}
            onChange={(e) => setF({ ...f, exeat_type: e.target.value })}
          >
            {TYPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label">Destination</label>
          <input
            className="form-control"
            placeholder="e.g. Home in Nyali"
            value={f.destination}
            onChange={(e) => setF({ ...f, destination: e.target.value })}
          />
        </div>
        <div className="col-12">
          <label className="form-label">Reason</label>
          <textarea
            className="form-control"
            rows={2}
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            required
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">Contact person</label>
          <input
            className="form-control"
            value={f.contact_name}
            onChange={(e) => setF({ ...f, contact_name: e.target.value })}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">Contact phone</label>
          <input
            className="form-control"
            value={f.contact_phone}
            onChange={(e) => setF({ ...f, contact_phone: e.target.value })}
          />
        </div>
      </div>

      {/* ---------- Times ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Times</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Leaves</label>
          <input
            type="datetime-local"
            className="form-control"
            value={f.expected_departure}
            onChange={(e) => setF({ ...f, expected_departure: e.target.value })}
            required
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">Back by</label>
          <input
            type="datetime-local"
            className="form-control"
            value={f.expected_return}
            onChange={(e) => setF({ ...f, expected_return: e.target.value })}
            required
          />
        </div>
      </div>

      {/* ---------- Approval ---------- */}
      {access?.can_approve_exeat && (
        <div className="form-check mt-3">
          <input
            className="form-check-input"
            type="checkbox"
            id="approve_now"
            checked={f.approve_now}
            onChange={(e) => setF({ ...f, approve_now: e.target.checked })}
          />
          <label className="form-check-label" htmlFor="approve_now">
            Approve straight away
          </label>
        </div>
      )}

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={act.busy}
        >
          Cancel
        </button>
        <button className="btn btn-primary" type="submit" disabled={act.busy || !reg}>
          {act.busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Creating...
            </>
          ) : (
            "Create slip"
          )}
        </button>
      </div>
    </form>
  );
}