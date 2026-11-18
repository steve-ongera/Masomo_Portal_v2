import { useState } from "react";
import { boardingApi } from "../../services/boardingApi";
import { fmtDateTime, localToIso, Msg, useAction, useLoad } from "../warden/common";

const TYPES = [
  ["EXEAT", "Exeat (home visit / weekend)"],
  ["LEAVE_OUT", "Leave-out (day outing)"],
  ["MEDICAL", "Medical"],
  ["EMERGENCY", "Family emergency"],
];

const STATUS_BADGE = {
  PENDING: "badge-warning",
  APPROVED: "badge-blue",
  OUT: "badge-neutral",
  RETURNED: "badge-success",
  REJECTED: "badge-danger",
  CANCELLED: "badge-neutral",
};

export default function MyBoarding() {
  const my = useLoad(async () => (await boardingApi.my()).data, []);
  const [asking, setAsking] = useState(null);

  const children = my.data || [];

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Boarding</h1>
          <p className="page-subtitle">
            Your bed and exeat slips
            {children.length > 1 ? " — for every child on your account" : ""}
          </p>
        </div>
      </div>

      <Msg error={my.error} />

      {my.loading ? (
        <div className="text-center py-5">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading boarding details...
        </div>
      ) : children.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-person-x" />
          <h6>No students found on your account</h6>
          <p className="text-muted-soft">
            If this looks wrong, contact the school office to check the account.
          </p>
        </div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {children.map((s) => (
            <ChildPanel
              key={s.student}
              s={s}
              asking={asking === s.student}
              onToggleAsking={() =>
                setAsking(asking === s.student ? null : s.student)
              }
              onDone={() => {
                setAsking(null);
                my.reload();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-child panel
// ---------------------------------------------------------------------------
function ChildPanel({ s, asking, onToggleAsking, onDone }) {
  const slips = s.exeats || [];

  return (
    <div className="table-wrap">
      {/* Panel header */}
      <div className="table-wrap__header flex-column align-items-stretch gap-3">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <div className="chart-card__title">
              <i className="bi bi-person-badge me-2 text-brand" />
              {s.name}{" "}
              <span className="cell-mono text-muted-soft">
                ({s.admission_no})
              </span>
            </div>
            <div className="chart-card__subtitle">
              {!s.is_boarder ? (
                <span className="text-muted-soft">
                  Not registered as a boarder this year
                </span>
              ) : s.bed ? (
                <>
                  Bed:{" "}
                  <span className="badge badge-neutral">{s.bed.label}</span>
                </>
              ) : (
                <span className="text-muted-soft">Bed not allocated yet</span>
              )}
            </div>
          </div>

          {s.is_boarder && (
            <div className="d-flex gap-2">
              <button
                type="button"
                className={`btn btn-sm ${asking ? "btn-secondary" : "btn-primary"}`}
                onClick={onToggleAsking}
              >
                <i className={`bi ${asking ? "bi-x-lg" : "bi-plus-lg"} me-1`} />
                {asking ? "Cancel request" : "Request an exeat"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline request form */}
      {asking && (
        <div className="p-3 border-bottom">
          <RequestForm student={s.student} onDone={onDone} onCancel={onToggleAsking} />
        </div>
      )}

      {/* Exeat slips */}
      <div className="px-3 pt-3 pb-2">
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span className="chart-card__title">
            <i className="bi bi-journal-text me-2 text-brand" />
            Exeat slips
          </span>
          <span className="chart-card__subtitle">
            {slips.length} slip{slips.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {!s.is_boarder ? (
        <div className="px-3 pb-3">
          <p className="form-text-hint mt-0 mb-0">
            Exeat slips are only available for students registered as boarders.
          </p>
        </div>
      ) : slips.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-journal" />
          <h6>No exeat slips yet</h6>
          <p className="text-muted-soft">
            Request one above and it will appear here once the hostel warden
            responds.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover table--stack mb-0">
            <thead>
              <tr>
                <th>Slip</th>
                <th>Type</th>
                <th>Leaves</th>
                <th>Back by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((x) => (
                <tr key={x.id}>
                  <td
                    data-label="Slip"
                    className="cell-mono text-brand fw-semibold"
                  >
                    {x.slip_no}
                  </td>
                  <td data-label="Type">
                    <span className="badge badge-neutral">
                      {x.exeat_type_display}
                    </span>
                  </td>
                  <td data-label="Leaves" className="cell-mono">
                    {fmtDateTime(x.expected_departure)}
                  </td>
                  <td data-label="Back by" className="cell-mono">
                    {fmtDateTime(x.expected_return)}
                  </td>
                  <td data-label="Status">
                    <span
                      className={`badge ${STATUS_BADGE[x.status] || "badge-neutral"}`}
                    >
                      {x.status_display}
                    </span>
                    {x.decision_note && (
                      <div className="text-muted-soft small mt-1 fst-italic">
                        {x.decision_note}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request an exeat
// ---------------------------------------------------------------------------
function RequestForm({ student, onDone, onCancel }) {
  const act = useAction();
  const [f, setF] = useState({
    exeat_type: "EXEAT",
    reason: "",
    destination: "",
    contact_name: "",
    contact_phone: "",
    expected_departure: "",
    expected_return: "",
  });

  const submit = async (e) => {
    e.preventDefault();
    const r = await act.run(
      () =>
        boardingApi.requestExeat({
          ...f,
          student,
          expected_departure: localToIso(f.expected_departure),
          expected_return: localToIso(f.expected_return),
        }),
      "Request sent. The hostel warden will respond."
    );
    if (r) onDone();
  };

  return (
    <form onSubmit={submit}>
      <Msg error={act.error} ok={act.ok} onClose={() => act.setError("")} />

      {/* ---------- Type & reason ---------- */}
      <h6 className="settings-section__title mb-2">Type &amp; reason</h6>
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
            placeholder="Why does the student need to leave?"
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            required
          />
        </div>
      </div>

      {/* ---------- Contact ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Person collecting</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Name</label>
          <input
            className="form-control"
            value={f.contact_name}
            onChange={(e) => setF({ ...f, contact_name: e.target.value })}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">Phone</label>
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

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={act.busy}
        >
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={act.busy}>
          {act.busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Sending...
            </>
          ) : (
            <>
              <i className="bi bi-send me-1" />
              Send request
            </>
          )}
        </button>
      </div>
    </form>
  );
}