import { useState } from "react";
import { boardingApi, unwrap } from "../../services/boardingApi";
import {
  fmtDateTime,
  Msg,
  NoHostelNotice,
  todayStr,
  useAccess,
  useAction,
  useLoad,
} from "./common";

const STATUSES = [
  ["PRESENT", "Present"],
  ["ABSENT", "Absent"],
  ["EXEAT", "On exeat"],
  ["SICK", "Sick bay"],
  ["OTHER", "Other (excused)"],
];
const SESSIONS = [
  ["MORNING", "Morning"],
  ["EVENING", "Evening / prep"],
  ["NIGHT", "Night"],
];

export default function RollCall() {
  const access = useAccess();
  const act = useAction();

  const dorms = useLoad(
    async () => unwrap(await boardingApi.dormitories({ active: 1 })),
    []
  );

  const [dormId, setDormId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [slot, setSlot] = useState("NIGHT");
  const [session, setSession] = useState(null);
  const [edits, setEdits] = useState({}); // entryId -> {status, remarks}

  const recent = useLoad(
    async () =>
      unwrap(
        await boardingApi.rollCalls({
          dormitory: dormId || undefined,
          page_size: 20,
        })
      ),
    [dormId, session?.status]
  );
  const absentees = useLoad(
    async () => (await boardingApi.absentees(date)).data,
    [date, session?.status]
  );

  const load = (s) => {
    setSession(s);
    setEdits({});
  };

  const open = async () => {
    const r = await act.run(
      () => boardingApi.openRollCall({ dormitory: dormId, date, session_type: slot }),
      "Roll call ready."
    );
    if (r) load(r.data);
  };

  const openExisting = async (id) => {
    const r = await act.run(() => boardingApi.rollCall(id), "Loaded.");
    if (r) load(r.data);
  };

  const set = (id, patch) =>
    setEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), ...patch } }));
  const view = (en) => ({ status: en.status, remarks: en.remarks, ...(edits[en.id] || {}) });
  const dirty = Object.keys(edits);

  const save = async () => {
    const marks = dirty.map((id) => ({ entry: Number(id), ...edits[id] }));
    const r = await act.run(() => boardingApi.markRollCall(session.id, marks), "Saved.");
    if (r) load(r.data);
  };

  const submit = async () => {
    if (dirty.length) {
      act.setError("Save your changes before submitting.");
      return;
    }
    if (!window.confirm("Submit this roll call? It will be locked.")) return;
    const r = await act.run(() => boardingApi.submitRollCall(session.id), "Submitted.");
    if (r) load(r.data);
  };

  const reopen = async () => {
    const r = await act.run(() => boardingApi.reopenRollCall(session.id), "Reopened.");
    if (r) load(r.data);
  };

  const editable = session && session.status === "OPEN" && access?.can_operate;
  const canOpen = access?.can_operate;

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Roll Call</h1>
          <p className="page-subtitle">
            Take and review morning, evening and night roll calls
          </p>
        </div>
        {canOpen && (
          <div className="page-header__actions">
            <button
              className="btn btn-primary"
              onClick={open}
              disabled={!dormId || act.busy}
              title={!dormId ? "Choose a hostel first" : undefined}
            >
              {act.busy ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Opening...
                </>
              ) : (
                <>
                  <i className="bi bi-clipboard-plus" />
                  Open / continue roll call
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <NoHostelNotice />
      <Msg error={act.error || dorms.error} ok={act.ok} />

      {/* ---------- Open-roll-call form ---------- */}
      {canOpen && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title">
              <i className="bi bi-sliders me-2 text-brand" />
              New / existing roll call
            </span>
          </div>
          <div className="p-3">
            <div className="row g-2 align-items-end">
              <div className="col-12 col-md-4">
                <label className="form-label">Hostel</label>
                <select
                  className="form-select"
                  value={dormId}
                  onChange={(e) => setDormId(e.target.value)}
                >
                  <option value="">Choose hostel...</option>
                  {(dorms.data || []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12 col-md-3">
                <label className="form-label">Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={date}
                  max={todayStr()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="col-12 col-md-3">
                <label className="form-label">Session</label>
                <select
                  className="form-select"
                  value={slot}
                  onChange={(e) => setSlot(e.target.value)}
                >
                  {SESSIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12 col-md-2 d-grid">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={open}
                  disabled={!dormId || act.busy}
                >
                  <i className="bi bi-box-arrow-in-right me-1" />
                  Open
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Active session ---------- */}
      {session && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header flex-column align-items-stretch gap-3">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-clipboard-check me-2 text-brand" />
                  {session.dormitory_name} — {session.session_type_display}
                </div>
                <div className="chart-card__subtitle">
                  {session.date}
                  {session.submitted_at && (
                    <>
                      {" "}
                      · Submitted {fmtDateTime(session.submitted_at)}
                      {session.taken_by_name ? ` by ${session.taken_by_name}` : ""}
                    </>
                  )}
                </div>
              </div>
              <span
                className={`badge ${
                  session.status === "OPEN"
                    ? "badge-warning"
                    : session.status === "SUBMITTED"
                    ? "badge-success"
                    : "badge-neutral"
                }`}
              >
                {session.status}
              </span>
            </div>

            {/* Counts strip */}
            <div className="summary-strip">
              <span>Present <strong>{session.counts.PRESENT}</strong></span>
              <span>·</span>
              <span>Absent <strong>{session.counts.ABSENT}</strong></span>
              <span>·</span>
              <span>Exeat <strong>{session.counts.EXEAT}</strong></span>
              <span>·</span>
              <span>Sick <strong>{session.counts.SICK}</strong></span>
              <span>·</span>
              <span>Other <strong>{session.counts.OTHER}</strong></span>
              <span>·</span>
              <span>Total <strong>{session.counts.total}</strong></span>
            </div>

            {/* Row-level actions */}
            <div className="toolbar mb-0">
              {editable ? (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={save}
                    disabled={!dirty.length || act.busy}
                  >
                    {act.busy ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check2 me-1" />
                        Save changes ({dirty.length})
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-success"
                    onClick={submit}
                    disabled={act.busy}
                  >
                    <i className="bi bi-lock me-1" />
                    Submit roll call
                  </button>
                </>
              ) : session.status === "SUBMITTED" && access?.can_manage_structure ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={reopen}
                  disabled={act.busy}
                >
                  <i className="bi bi-unlock me-1" />
                  Reopen (admin)
                </button>
              ) : (
                <span className="form-text-hint mt-0">
                  {session.status === "SUBMITTED"
                    ? "This roll call is locked."
                    : "You do not have permission to edit this roll call."}
                </span>
              )}
            </div>
          </div>

          {session.entries.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-people" />
              <h6>No entries to mark</h6>
              <p className="text-muted-soft">
                No boarders were registered in this hostel on this date.
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover table--stack mb-0">
                <thead>
                  <tr>
                    <th>Bed</th>
                    <th>Adm no</th>
                    <th>Name</th>
                    <th style={{ minWidth: 150 }}>Status</th>
                    <th style={{ minWidth: 200 }}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {session.entries.map((en) => {
                    const v = view(en);
                    return (
                      <tr key={en.id}>
                        <td data-label="Bed">
                          <span className="badge badge-neutral">{en.bed_label || "-"}</span>
                        </td>
                        <td data-label="Adm no" className="cell-mono text-brand fw-semibold">
                          {en.admission_no}
                        </td>
                        <td data-label="Name">
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">
                              {(en.student_name || "")
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <span className="cell-name">{en.student_name}</span>
                          </div>
                        </td>
                        <td data-label="Status">
                          <select
                            className="form-select form-select-sm"
                            disabled={!editable}
                            value={v.status}
                            onChange={(e) => set(en.id, { status: e.target.value })}
                          >
                            {STATUSES.map(([k, l]) => (
                              <option key={k} value={k}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td data-label="Remarks">
                          <input
                            className="form-control form-control-sm"
                            disabled={!editable}
                            value={v.remarks || ""}
                            onChange={(e) => set(en.id, { remarks: e.target.value })}
                            placeholder="—"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---------- Absent / recent side by side ---------- */}
      <div className="row g-3">
        {/* Absent today */}
        <div className="col-12 col-xl-6">
          <div className="table-wrap h-100">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-person-x me-2 text-brand" />
                Absent on {date}
              </span>
              <span className="chart-card__subtitle">
                {(absentees.data || []).length} absent{(absentees.data || []).length !== 1 ? "ees" : ""}
              </span>
            </div>

            {absentees.loading ? (
              <div className="text-center py-4">
                <span className="spinner-border spinner-border-sm me-2" />
                Loading absentees...
              </div>
            ) : (absentees.data || []).length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-check-circle" />
                <h6>No absentees on {date}</h6>
                <p className="text-muted-soft">
                  Absentees appear here as roll calls are marked.
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th>Hostel</th>
                      <th>Session</th>
                      <th>Adm no</th>
                      <th>Name</th>
                      <th>Bed</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {absentees.data.map((a, i) => (
                      <tr key={i}>
                        <td data-label="Hostel">
                          <span className="badge badge-neutral">{a.dormitory || "-"}</span>
                        </td>
                        <td data-label="Session">{a.session_type}</td>
                        <td data-label="Adm no" className="cell-mono text-brand fw-semibold">
                          {a.admission_no}
                        </td>
                        <td data-label="Name" className="cell-name">
                          {a.student_name}
                        </td>
                        <td data-label="Bed">
                          <span className="badge badge-neutral">{a.bed_label || "-"}</span>
                        </td>
                        <td data-label="Remarks" className="cell-muted">
                          {a.remarks || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Recent roll calls */}
        <div className="col-12 col-xl-6">
          <div className="table-wrap h-100">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-clock-history me-2 text-brand" />
                Recent roll calls
              </span>
              <span className="chart-card__subtitle">
                {(recent.data || []).length} session{(recent.data || []).length !== 1 ? "s" : ""}
              </span>
            </div>

            {recent.loading ? (
              <div className="text-center py-4">
                <span className="spinner-border spinner-border-sm me-2" />
                Loading roll calls...
              </div>
            ) : (recent.data || []).length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-clock-history" />
                <h6>No roll calls yet</h6>
                <p className="text-muted-soft">
                  Opened roll calls appear here.
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Hostel</th>
                      <th>Session</th>
                      <th>Status</th>
                      <th className="text-center">Absent</th>
                      <th style={{ width: 90 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {recent.data.map((s) => (
                      <tr key={s.id}>
                        <td data-label="Date" className="cell-mono">
                          {s.date}
                        </td>
                        <td data-label="Hostel" className="cell-name">
                          {s.dormitory_name}
                        </td>
                        <td data-label="Session">{s.session_type_display}</td>
                        <td data-label="Status">
                          <span
                            className={`badge ${
                              s.status === "OPEN"
                                ? "badge-warning"
                                : s.status === "SUBMITTED"
                                ? "badge-success"
                                : "badge-neutral"
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td data-label="Absent" className="cell-num">
                          {s.counts.ABSENT}
                        </td>
                        <td data-label="Open">
                          <div className="table-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary btn-icon"
                              title="Open this roll call"
                              aria-label="Open this roll call"
                              onClick={() => openExisting(s.id)}
                            >
                              <i className="bi bi-box-arrow-in-right" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}