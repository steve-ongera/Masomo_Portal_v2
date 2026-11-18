import { useMemo, useState } from "react";
import { academicsApi, calendarApi } from "../../services/api";
import { boardingApi, unwrap } from "../../services/boardingApi";
import { Msg, useAccess, useAction, useLoad } from "./common";

const TYPES = [
  ["EXEAT", "Exeat"],
  ["LEAVE_OUT", "Leave-out"],
  ["MEDICAL", "Medical"],
  ["EMERGENCY", "Family emergency"],
  ["SENT_HOME", "Sent home"],
];

export default function BoardingSettings() {
  const access = useAccess();

  const tabs = useMemo(() => {
    const out = [];
    if (access?.can_manage_structure) out.push(["rules", "Boarding rules"]);
    if (access?.can_bill) out.push(["fees", "Boarding fees"]);
    return out;
  }, [access]);

  const [tab, setTab] = useState(null);
  const activeTab = tab || tabs[0]?.[0] || null;

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Boarding Settings &amp; Fees</h1>
          <p className="page-subtitle">
            Who boards, who approves exeats, and how term boarding fees are billed
          </p>
        </div>
      </div>

      {tabs.length === 0 ? (
        <div className="alert alert-warning" role="alert">
          <i className="bi bi-exclamation-triangle me-2" />
          You do not have permission to change boarding settings or fees.
        </div>
      ) : (
        <>
          {tabs.length > 1 && (
            <ul className="nav nav-tabs mb-3" role="tablist">
              {tabs.map(([k, label]) => (
                <li className="nav-item" role="presentation" key={k}>
                  <button
                    type="button"
                    role="tab"
                    className={`nav-link ${activeTab === k ? "active" : ""}`}
                    onClick={() => setTab(k)}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {activeTab === "rules" && <Rules />}
          {activeTab === "fees" && <Fees />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boarding rules
// ---------------------------------------------------------------------------
function Rules() {
  const act = useAction();
  const s = useLoad(async () => (await boardingApi.settings()).data, []);
  const grades = useLoad(async () => unwrap(await academicsApi.gradeLevels()), []);
  const [draft, setDraft] = useState(null);
  const cfg = draft || s.data;

  const toggle = (key, id) => {
    const cur = cfg[key];
    setDraft({
      ...cfg,
      [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    });
  };

  const save = async () => {
    const r = await act.run(
      () =>
        boardingApi.updateSettings({
          boarding_grades: cfg.boarding_grades,
          principal_approval_types: cfg.principal_approval_types,
          exeat_max_days: cfg.exeat_max_days,
        }),
      "Saved."
    );
    if (r) {
      setDraft(null);
      s.reload();
    }
  };

  return (
    <div>
      <Msg error={act.error || s.error || grades.error} ok={act.ok} />

      {s.loading && !cfg ? (
        <div className="text-center py-4">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading settings...
        </div>
      ) : !cfg ? null : (
        <>
          {/* ---------- Who boards ---------- */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-person-check me-2 text-brand" />
                Who boards
              </span>
              <span className="chart-card__subtitle">
                {cfg.boarding_grades.length === 0
                  ? "Every grade boards"
                  : `${cfg.boarding_grades.length} grade${cfg.boarding_grades.length !== 1 ? "s" : ""} selected`}
              </span>
            </div>
            <div className="p-3">
              <p className="form-text-hint mt-0">
                Tick the grades that board at your school. Leave all unticked to
                allow every grade.
              </p>
              {grades.loading ? (
                <div className="text-center py-3">
                  <span className="spinner-border spinner-border-sm me-2" />
                  Loading grades...
                </div>
              ) : (grades.data || []).length === 0 ? (
                <p className="text-muted-soft mb-0">No grade levels set up yet.</p>
              ) : (
                <div className="row g-2">
                  {(grades.data || []).map((g) => (
                    <div className="col-12 col-sm-6 col-md-4" key={g.id}>
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id={`grade-${g.id}`}
                          checked={cfg.boarding_grades.includes(g.id)}
                          onChange={() => toggle("boarding_grades", g.id)}
                        />
                        <label
                          className="form-check-label"
                          htmlFor={`grade-${g.id}`}
                        >
                          {g.name}
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ---------- Principal approval ---------- */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-shield-check me-2 text-brand" />
                Principal approval
              </span>
              <span className="chart-card__subtitle">
                {cfg.principal_approval_types.length === 0
                  ? "Wardens approve everything"
                  : `${cfg.principal_approval_types.length} type${cfg.principal_approval_types.length !== 1 ? "s" : ""} require principal`}
              </span>
            </div>
            <div className="p-3">
              <p className="form-text-hint mt-0">
                Exeat types only the Principal / Admin may approve.
              </p>
              <div className="row g-2">
                {TYPES.map(([k, l]) => (
                  <div className="col-12 col-sm-6" key={k}>
                    <div className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`type-${k}`}
                        checked={cfg.principal_approval_types.includes(k)}
                        onChange={() => toggle("principal_approval_types", k)}
                      />
                      <label className="form-check-label" htmlFor={`type-${k}`}>
                        {l}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ---------- Limits ---------- */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-clock me-2 text-brand" />
                Limits
              </span>
            </div>
            <div className="p-3">
              <div className="row g-3 align-items-end">
                <div className="col-12 col-md-4">
                  <label className="form-label">Longest exeat (days)</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    className="form-control"
                    value={cfg.exeat_max_days}
                    onChange={(e) =>
                      setDraft({ ...cfg, exeat_max_days: Number(e.target.value) })
                    }
                  />
                  <div className="form-text-hint">
                    Applies to all exeats. 1 to 90 days.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ---------- Save bar ---------- */}
          <div className="d-flex justify-content-end">
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={act.busy || !draft}
            >
              {act.busy ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Saving...
                </>
              ) : (
                <>
                  <i className="bi bi-check2 me-1" />
                  Save settings
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boarding fees
// ---------------------------------------------------------------------------
function Fees() {
  const act = useAction();
  const terms = useLoad(async () => unwrap(await calendarApi.terms()), []);
  const grades = useLoad(async () => unwrap(await academicsApi.gradeLevels()), []);

  const [term, setTerm] = useState("");
  const termId =
    term || (terms.data || []).find((t) => t.is_current)?.id || "";

  const rates = useLoad(
    async () => (termId ? unwrap(await boardingApi.feeRates({ term: termId })) : []),
    [termId]
  );
  const billings = useLoad(
    async () =>
      termId ? (await boardingApi.billings({ term: termId })).data : [],
    [termId]
  );

  const [f, setF] = useState({ grade_level: "", amount: "" });
  const [bill, setBill] = useState(null);

  const addRate = async (e) => {
    e.preventDefault();
    const r = await act.run(
      () =>
        boardingApi.createFeeRate({
          term: termId,
          grade_level: f.grade_level || null,
          amount: f.amount,
        }),
      "Rate saved."
    );
    if (r) {
      setF({ grade_level: "", amount: "" });
      rates.reload();
    }
  };

  const delRate = async (id) => {
    const r = await act.run(() => boardingApi.deleteFeeRate(id), "Removed.");
    if (r) rates.reload();
  };

  const runBill = async (dry) => {
    if (
      !dry &&
      !window.confirm(
        "Bill every registered boarder for this term? Students already billed are skipped."
      )
    )
      return;
    const r = await act.run(
      () => boardingApi.billFees({ term: termId, dry_run: dry }),
      dry ? "Preview only." : "Billing complete."
    );
    if (r) {
      setBill(r.data);
      if (!dry) billings.reload();
    }
  };

  const noRate = bill?.no_rate || [];
  const failed = bill?.failed || [];

  return (
    <div>
      <Msg error={act.error || terms.error || rates.error} ok={act.ok} />

      {/* ---------- Term picker ---------- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title">
            <i className="bi bi-calendar3 me-2 text-brand" />
            Term
          </span>
        </div>
        <div className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md-6">
              <label className="form-label">Term</label>
              <select
                className="form-select"
                value={termId}
                onChange={(e) => setTerm(e.target.value)}
              >
                {(terms.data || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.academic_year_name ?? t.academic_year} — Term {t.term_number}
                    {t.is_current ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Rates ---------- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title">
            <i className="bi bi-tags me-2 text-brand" />
            Fee rates
          </span>
          <span className="chart-card__subtitle">
            {(rates.data || []).length} rate{(rates.data || []).length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="p-3 border-bottom">
          <form onSubmit={addRate}>
            <div className="row g-2 align-items-end">
              <div className="col-12 col-md-4">
                <label className="form-label">Grade</label>
                <select
                  className="form-select"
                  value={f.grade_level}
                  onChange={(e) => setF({ ...f, grade_level: e.target.value })}
                >
                  <option value="">All grades (default rate)</option>
                  {(grades.data || []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-12 col-md-4">
                <label className="form-label">Amount (KES)</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  className="form-control"
                  placeholder="Amount (KES)"
                  value={f.amount}
                  onChange={(e) => setF({ ...f, amount: e.target.value })}
                  required
                />
              </div>
              <div className="col-12 col-md-4">
                <button
                  className="btn btn-primary w-100"
                  disabled={!termId || act.busy}
                >
                  <i className="bi bi-plus-lg me-1" />
                  Add rate
                </button>
              </div>
            </div>
          </form>
        </div>

        {rates.loading ? (
          <div className="text-center py-4">
            <span className="spinner-border spinner-border-sm me-2" />
            Loading rates...
          </div>
        ) : (rates.data || []).length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-tags" />
            <h6>No fee rates set for this term</h6>
            <p className="text-muted-soft">
              Add at least a default rate (All grades) before billing.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table--stack mb-0">
              <thead>
                <tr>
                  <th>Grade</th>
                  <th className="text-end">Amount</th>
                  <th style={{ width: 90 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rates.data.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Grade" className="cell-name">
                      {r.grade_name || <em className="text-muted-soft">All grades</em>}
                    </td>
                    <td data-label="Amount" className="cell-num">
                      {r.amount}
                    </td>
                    <td data-label="Actions">
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger btn-icon"
                          title="Remove rate"
                          aria-label="Remove rate"
                          onClick={() => delRate(r.id)}
                        >
                          <i className="bi bi-trash" />
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

      {/* ---------- Billing ---------- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title">
            <i className="bi bi-cash-stack me-2 text-brand" />
            Bill boarders
          </span>
          <span className="chart-card__subtitle">
            Charges are created from the fee rates above
          </span>
        </div>

        <div className="p-3 border-bottom">
          <div className="d-flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-outline-primary"
              disabled={!termId || act.busy}
              onClick={() => runBill(true)}
            >
              <i className="bi bi-eye me-1" />
              Preview billing
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!termId || act.busy || !bill || !bill.dry_run}
              onClick={() => runBill(false)}
              title={
                !bill?.dry_run ? "Preview first to enable this" : undefined
              }
            >
              <i className="bi bi-cash-coin me-1" />
              Bill boarders
            </button>
          </div>
        </div>

        {bill && (
          <div className="p-3 border-bottom">
            <div className="stat-grid">
              <div className={`dm-card ${bill.dry_run ? "dm-card--info" : "dm-card--success"}`}>
                <div className="dm-card__top">
                  <span className="dm-card__label">
                    {bill.dry_run ? "Would bill" : "Billed"}
                  </span>
                  <span className="dm-card__icon">
                    <i className="bi bi-receipt" />
                  </span>
                </div>
                <div className="dm-card__num">{bill.billed}</div>
                <div className="dm-card__sub">Total KES {bill.total}</div>
              </div>

              <div className="dm-card dm-card--secondary">
                <div className="dm-card__top">
                  <span className="dm-card__label">Already billed</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-check2-circle" />
                  </span>
                </div>
                <div className="dm-card__num">{bill.already_billed}</div>
                <div className="dm-card__sub">Skipped this run</div>
              </div>

              <div className="dm-card dm-card--warning">
                <div className="dm-card__top">
                  <span className="dm-card__label">No rate for their grade</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-exclamation-circle" />
                  </span>
                </div>
                <div className="dm-card__num">{noRate.length}</div>
                <div className="dm-card__sub">
                  {noRate.length === 0 ? "Everyone has a rate" : "See list below"}
                </div>
              </div>

              <div className={`dm-card ${failed.length > 0 ? "dm-card--danger" : "dm-card--secondary"}`}>
                <div className="dm-card__top">
                  <span className="dm-card__label">Failed</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-x-circle" />
                  </span>
                </div>
                <div className="dm-card__num">{failed.length}</div>
                <div className="dm-card__sub">
                  {failed.length === 0 ? "None" : "See list below"}
                </div>
              </div>
            </div>

            {(noRate.length > 0 || failed.length > 0) && (
              <details className="mt-2">
                <summary className="text-muted-soft small">
                  Show details
                </summary>
                {noRate.length > 0 && (
                  <div className="mt-2">
                    <strong className="small">No rate for their grade</strong>
                    <ul className="list-unstyled small mb-0">
                      {noRate.map((x, i) => (
                        <li key={i} className="border-bottom py-1">
                          <span className="cell-mono text-brand fw-semibold me-2">
                            {x.admission_no}
                          </span>
                          {x.student_name || x.name || ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {failed.length > 0 && (
                  <div className="mt-2">
                    <strong className="small">Failed</strong>
                    <ul className="list-unstyled small mb-0">
                      {failed.map((x, i) => (
                        <li key={i} className="border-bottom py-1">
                          <span className="cell-mono text-brand fw-semibold me-2">
                            {x.admission_no}
                          </span>
                          <span className="text-owe">{x.error}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </details>
            )}
          </div>
        )}
      </div>

      {/* ---------- Billed this term ---------- */}
      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title">
            <i className="bi bi-receipt me-2 text-brand" />
            Billed this term
          </span>
          <span className="chart-card__subtitle">
            {(billings.data || []).length} student{(billings.data || []).length !== 1 ? "s" : ""}
          </span>
        </div>

        {billings.loading ? (
          <div className="text-center py-4">
            <span className="spinner-border spinner-border-sm me-2" />
            Loading billings...
          </div>
        ) : (billings.data || []).length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt" />
            <h6>No students billed for this term yet</h6>
            <p className="text-muted-soft">
              Run the billing above to create charges for all registered boarders.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table--stack mb-0">
              <thead>
                <tr>
                  <th>Admission No</th>
                  <th>Student</th>
                  <th className="text-end">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {billings.data.map((b) => (
                  <tr key={b.id}>
                    <td data-label="Admission No" className="cell-mono text-brand fw-semibold">
                      {b.admission_no}
                    </td>
                    <td data-label="Student">
                      <div className="table-avatar-cell">
                        <div className="avatar-sm">
                          {(b.student_name || "")
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((n) => n[0])
                            .join("")}
                        </div>
                        <span className="cell-name">{b.student_name}</span>
                      </div>
                    </td>
                    <td data-label="Amount" className="cell-num">
                      {b.amount}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`badge ${
                          b.charge_status === "PAID"
                            ? "badge-success"
                            : b.charge_status === "UNPAID"
                            ? "badge-danger"
                            : "badge-neutral"
                        }`}
                      >
                        {b.charge_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}