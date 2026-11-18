import { useCallback, useEffect, useState } from "react";
import { academicsApi, bursaryApi, calendarApi, errMsg, unwrap } from "../../services/api";
import Modal from "../../components/Modal";

const KIND_LABEL = {
  SCHOLARSHIP: "Scholarship",
  BURSARY: "Bursary",
  SPONSORSHIP: "Sponsorship",
  STAFF_DISCOUNT: "Staff discount",
  SIBLING_DISCOUNT: "Sibling discount",
  OTHER: "Other",
};

const SOURCE_TYPES = [
  ["CDF", "NG-CDF (Constituency Development Fund)"],
  ["COUNTY", "County Government"],
  ["GOVERNMENT", "Other Government / Ministry"],
  ["SPONSOR", "Individual / Corporate Sponsor"],
  ["NGO", "NGO / Foundation"],
  ["CHURCH", "Church / Community"],
  ["ALUMNI", "Alumni / Old Students"],
  ["SCHOOL", "School-funded"],
];

const RULES = [
  ["MANUAL", "Awarded case by case"],
  ["SIBLING", "Sibling discount (automatic detection)"],
  ["STAFF_CHILD", "Staff-child discount (suggested from staff records)"],
];

const fmt = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0);

const valueLabel = (type, value) =>
  type === "PERCENT" ? `${Number(value)}%` : `KES ${fmt(value)}`;

export default function Setup() {
  const [tab, setTab] = useState("schemes");
  const [sources, setSources] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editSource, setEditSource] = useState(null);
  const [editScheme, setEditScheme] = useState(null);
  const [finder, setFinder] = useState(null);
  const [msg, setMsg] = useState({ kind: "", text: "" });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      bursaryApi.sources.list().then((r) => setSources(unwrap(r))).catch((e) => setMsg({ kind: "error", text: errMsg(e) })),
      bursaryApi.schemes.list().then((r) => setSchemes(unwrap(r))).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (api, row) => {
    try {
      await api.update(row.id, { is_active: !row.is_active });
      load();
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e) });
    }
  };

  const openAdd = () =>
    tab === "schemes" ? setEditScheme({}) : setEditSource({});

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Funders &amp; Schemes</h1>
          <p className="page-subtitle">
            Set up who pays, then the rules each bursary or discount follows
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={openAdd}>
            <i className="bi bi-plus-lg" />
            {tab === "schemes" ? "Add a scheme" : "Add a funder"}
          </button>
        </div>
      </div>

      {/* ---------- Tabs ---------- */}
      <ul className="nav nav-tabs mb-3" role="tablist">
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            className={`nav-link ${tab === "schemes" ? "active" : ""}`}
            onClick={() => setTab("schemes")}
          >
            <i className="bi bi-tags me-2" />
            Schemes
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            className={`nav-link ${tab === "sources" ? "active" : ""}`}
            onClick={() => setTab("sources")}
          >
            <i className="bi bi-building me-2" />
            Funders
          </button>
        </li>
      </ul>

      {/* ---------- Message ---------- */}
      {msg.text && (
        <div
          className={`alert alert-${msg.kind === "error" ? "danger" : "success"} alert-dismissible fade show`}
          role={msg.kind === "error" ? "alert" : "status"}
        >
          {msg.text}
          <button
            type="button"
            className="btn-close"
            onClick={() => setMsg({ kind: "", text: "" })}
            aria-label="Dismiss"
          />
        </div>
      )}

      {loading ? (
        <div className="text-center py-4">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading...
        </div>
      ) : tab === "sources" ? (
        <SourcesTable sources={sources} onEdit={setEditSource} onToggle={(s) => toggle(bursaryApi.sources, s)} />
      ) : (
        <SchemesTable
          schemes={schemes}
          onEdit={setEditScheme}
          onToggle={(s) => toggle(bursaryApi.schemes, s)}
          onFind={setFinder}
        />
      )}

      {/* ---------- Modals ---------- */}
      <Modal
        show={!!editSource}
        onClose={() => setEditSource(null)}
        title={editSource?.id ? "Edit funder" : "Add a funder"}
        size="lg"
      >
        {editSource && (
          <SourceForm
            row={editSource}
            onClose={() => setEditSource(null)}
            onSaved={() => {
              setEditSource(null);
              load();
            }}
          />
        )}
      </Modal>

      <Modal
        show={!!editScheme}
        onClose={() => setEditScheme(null)}
        title={editScheme?.id ? "Edit scheme" : "Add a scheme"}
        size="lg"
      >
        {editScheme && (
          <SchemeForm
            row={editScheme}
            sources={sources.filter((s) => s.is_active)}
            onClose={() => setEditScheme(null)}
            onSaved={() => {
              setEditScheme(null);
              load();
            }}
          />
        )}
      </Modal>

      <Modal
        show={!!finder}
        onClose={() => setFinder(null)}
        title={finder ? `Eligible students: ${finder.name}` : "Eligible students"}
        size="lg"
      >
        {finder && (
          <Finder
            scheme={finder}
            onClose={() => setFinder(null)}
            onDone={(t) => {
              setFinder(null);
              setMsg({ kind: "ok", text: t });
            }}
          />
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources table
// ---------------------------------------------------------------------------
function SourcesTable({ sources, onEdit, onToggle }) {
  if (sources.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-building" />
        <h6>No funders yet</h6>
        <p className="text-muted-soft">
          Add NG-CDF, your county, or a sponsor to start.
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <div className="table-wrap__header">
        <span className="chart-card__title">
          <i className="bi bi-building me-2 text-brand" />
          Funders
        </span>
        <span className="chart-card__subtitle">
          {sources.length} funder{sources.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="table-responsive">
        <table className="table table-hover table--stack mb-0">
          <thead>
            <tr>
              <th>Funder</th>
              <th>Type</th>
              <th>Contact</th>
              <th>Status</th>
              <th style={{ width: 140 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td data-label="Funder">
                  <div className="cell-name">{s.name}</div>
                  {s.location && (
                    <div className="text-muted-soft small">{s.location}</div>
                  )}
                </td>
                <td data-label="Type">
                  <span className="badge badge-neutral">{s.type_display}</span>
                </td>
                <td data-label="Contact">
                  {s.contact_person || "—"}
                  {s.phone_number && (
                    <div className="text-muted-soft small cell-mono">
                      {s.phone_number}
                    </div>
                  )}
                </td>
                <td data-label="Status">
                  <span
                    className={`badge ${s.is_active ? "badge-success" : "badge-neutral"}`}
                  >
                    {s.is_active ? "Active" : "Off"}
                  </span>
                </td>
                <td data-label="Actions">
                  <div className="table-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary btn-icon"
                      title="Edit funder"
                      aria-label="Edit funder"
                      onClick={() => onEdit(s)}
                    >
                      <i className="bi bi-pencil" />
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm btn-icon ${
                        s.is_active ? "btn-outline-danger" : "btn-outline-success"
                      }`}
                      title={s.is_active ? "Switch off" : "Switch on"}
                      aria-label={s.is_active ? "Switch off" : "Switch on"}
                      onClick={() => onToggle(s)}
                    >
                      <i className={`bi ${s.is_active ? "bi-power" : "bi-check2"}`} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schemes table
// ---------------------------------------------------------------------------
function SchemesTable({ schemes, onEdit, onToggle, onFind }) {
  if (schemes.length === 0) {
    return (
      <div className="empty-state">
        <i className="bi bi-tags" />
        <h6>No schemes yet</h6>
        <p className="text-muted-soft">
          Add one — for example "Sibling discount" or "NG-CDF Bursary".
        </p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <div className="table-wrap__header">
        <span className="chart-card__title">
          <i className="bi bi-tags me-2 text-brand" />
          Schemes
        </span>
        <span className="chart-card__subtitle">
          {schemes.length} scheme{schemes.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="table-responsive">
        <table className="table table-hover table--stack mb-0">
          <thead>
            <tr>
              <th>Scheme</th>
              <th>Type</th>
              <th>Paid by</th>
              <th>Value</th>
              <th>Status</th>
              <th style={{ width: 200 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {schemes.map((s) => (
              <tr key={s.id}>
                <td data-label="Scheme">
                  <div className="cell-name">{s.name}</div>
                  <div className="text-muted-soft small">
                    <span className="cell-mono">{s.code}</span> · {s.rule_display}
                  </div>
                </td>
                <td data-label="Type">
                  <span className="badge badge-blue">{KIND_LABEL[s.kind] || s.kind}</span>
                </td>
                <td data-label="Paid by">
                  <div>{s.source_name || "School"}</div>
                  <div className="text-muted-soft small">
                    {s.settlement === "WAIVER" ? "Fee is reduced" : "Funder remits"}
                  </div>
                </td>
                <td data-label="Value">
                  <div>
                    {s.rule === "SIBLING"
                      ? (s.sibling_tiers || [])
                          .map((t) => `#${t.rank}: ${t.percent}%`)
                          .join(", ")
                      : valueLabel(s.value_type, s.value)}
                  </div>
                  {s.budget_per_year > 0 && (
                    <div className="text-muted-soft small">
                      Budget KES {fmt(s.budget_per_year)} a year
                    </div>
                  )}
                </td>
                <td data-label="Status">
                  <span
                    className={`badge ${s.is_active ? "badge-success" : "badge-neutral"}`}
                  >
                    {s.is_active ? "Active" : "Off"}
                  </span>
                </td>
                <td data-label="Actions">
                  <div className="table-actions">
                    {s.rule !== "MANUAL" && s.is_active && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary btn-icon"
                        title="Find eligible students"
                        aria-label="Find eligible students"
                        onClick={() => onFind(s)}
                      >
                        <i className="bi bi-search" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary btn-icon"
                      title="Edit scheme"
                      aria-label="Edit scheme"
                      onClick={() => onEdit(s)}
                    >
                      <i className="bi bi-pencil" />
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm btn-icon ${
                        s.is_active ? "btn-outline-danger" : "btn-outline-success"
                      }`}
                      title={s.is_active ? "Switch off" : "Switch on"}
                      aria-label={s.is_active ? "Switch off" : "Switch on"}
                      onClick={() => onToggle(s)}
                    >
                      <i className={`bi ${s.is_active ? "bi-power" : "bi-check2"}`} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funder form
// ---------------------------------------------------------------------------
function SourceForm({ row, onClose, onSaved }) {
  const [f, setF] = useState({
    name: "",
    source_type: "CDF",
    contact_person: "",
    phone_number: "",
    email: "",
    location: "",
    notes: "",
    ...row,
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      row.id
        ? await bursaryApi.sources.update(row.id, f)
        : await bursaryApi.sources.create(f);
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}

      <h6 className="settings-section__title mb-2">Identity</h6>
      <div className="row g-3">
        <div className="col-12">
          <label className="form-label">Name</label>
          <input
            className="form-control"
            value={f.name}
            onChange={set("name")}
            placeholder="e.g. Kilifi North NG-CDF"
          />
        </div>
        <div className="col-12">
          <label className="form-label">Type</label>
          <select
            className="form-select"
            value={f.source_type}
            onChange={set("source_type")}
          >
            {SOURCE_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12">
          <label className="form-label">Constituency or county</label>
          <input
            className="form-control"
            value={f.location}
            onChange={set("location")}
          />
        </div>
      </div>

      <h6 className="settings-section__title mt-4 mb-2">Contact</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Contact person</label>
          <input
            className="form-control"
            value={f.contact_person}
            onChange={set("contact_person")}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">Phone</label>
          <input
            className="form-control"
            value={f.phone_number}
            onChange={set("phone_number")}
          />
        </div>
        <div className="col-12">
          <label className="form-label">Email</label>
          <input
            type="email"
            className="form-control"
            value={f.email}
            onChange={set("email")}
          />
        </div>
      </div>

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy}
        >
          {busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Saving...
            </>
          ) : (
            "Save funder"
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheme form
// ---------------------------------------------------------------------------
function SchemeForm({ row, sources, onClose, onSaved }) {
  const [grades, setGrades] = useState([]);
  const [f, setF] = useState({
    name: "",
    code: "",
    kind: "DISCOUNT",
    rule: "MANUAL",
    source: "",
    settlement: "WAIVER",
    value_type: "PERCENT",
    value: "",
    priority: 100,
    stackable: true,
    auto_approve: false,
    budget_per_year: "",
    default_duration_terms: "",
    description: "",
    grade_levels: [],
    ...row,
    source: row.source ?? "",
  });
  const [tiers, setTiers] = useState(
    (row.sibling_tiers || []).map((t) => `${t.rank}:${t.percent}`).join(", ")
  );
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    academicsApi
      .gradeLevels()
      .then((r) => setGrades(unwrap(r)))
      .catch(() => {});
  }, []);

  const set = (k) => (e) =>
    setF({
      ...f,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    });

  const save = async () => {
    setErr("");
    const sibling_tiers = tiers
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const [rank, percent] = x.split(":").map((n) => Number(n.trim()));
        return { rank, percent };
      });
    const payload = {
      ...f,
      source: f.source || null,
      sibling_tiers: f.rule === "SIBLING" ? sibling_tiers : [],
      value: f.rule === "SIBLING" ? 0 : f.value,
      budget_per_year: f.budget_per_year || null,
      default_duration_terms: f.default_duration_terms || null,
      settlement: f.source ? f.settlement : "WAIVER",
    };
    setBusy(true);
    try {
      row.id
        ? await bursaryApi.schemes.update(row.id, payload)
        : await bursaryApi.schemes.create(payload);
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}

      {/* ---------- Identity ---------- */}
      <h6 className="settings-section__title mb-2">Identity</h6>
      <div className="row g-3">
        <div className="col-md-8">
          <label className="form-label">Name</label>
          <input
            className="form-control"
            value={f.name}
            onChange={set("name")}
            placeholder="e.g. Sibling discount"
          />
        </div>
        <div className="col-md-4">
          <label className="form-label">Short code</label>
          <input
            className="form-control"
            value={f.code}
            onChange={set("code")}
            placeholder="SIBLING"
          />
          <div className="form-text-hint">Letters and numbers, no spaces</div>
        </div>
        <div className="col-md-6">
          <label className="form-label">Type</label>
          <select className="form-select" value={f.kind} onChange={set("kind")}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label">How students get it</label>
          <select className="form-select" value={f.rule} onChange={set("rule")}>
            {RULES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---------- Who pays ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Who pays</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Funder</label>
          <select className="form-select" value={f.source} onChange={set("source")}>
            <option value="">School-funded</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="form-text-hint">Leave empty when the school pays</div>
        </div>
        {f.source && f.rule === "MANUAL" && (
          <div className="col-md-6">
            <label className="form-label">Money flow</label>
            <select
              className="form-select"
              value={f.settlement}
              onChange={set("settlement")}
            >
              <option value="FUNDER_REMITS">
                Funder pays the school (tracked as a receivable)
              </option>
              <option value="WAIVER">School reduces the fee now</option>
            </select>
          </div>
        )}
      </div>

      {/* ---------- Value ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Value</h6>
      {f.rule === "SIBLING" ? (
        <>
          <label className="form-label">Sibling tiers</label>
          <input
            className="form-control"
            value={tiers}
            onChange={(e) => setTiers(e.target.value)}
            placeholder="2:5, 3:10"
          />
          <div className="form-text-hint">
            Rank:percent, separated by commas. The eldest pays in full. Example:
            <span className="cell-mono"> 2:5, 3:10 </span>
            gives the second child 5% and the third and later 10%.
          </div>
        </>
      ) : (
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label">Value type</label>
            <select
              className="form-select"
              value={f.value_type}
              onChange={set("value_type")}
            >
              <option value="PERCENT">Percentage of term fee</option>
              <option value="FIXED">Fixed amount per term (KES)</option>
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label">
              {f.value_type === "PERCENT" ? "Percent" : "Amount per term (KES)"}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="form-control"
              value={f.value}
              onChange={set("value")}
            />
          </div>
        </div>
      )}

      {/* ---------- Eligibility & budget ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Eligibility &amp; budget</h6>
      <div className="row g-3">
        <div className="col-md-4">
          <label className="form-label">Runs for how many terms</label>
          <input
            type="number"
            min="1"
            className="form-control"
            value={f.default_duration_terms ?? ""}
            onChange={set("default_duration_terms")}
          />
          <div className="form-text-hint">Empty means until it is ended</div>
        </div>
        <div className="col-md-4">
          <label className="form-label">Yearly budget (KES)</label>
          <input
            type="number"
            min="0"
            className="form-control"
            value={f.budget_per_year ?? ""}
            onChange={set("budget_per_year")}
          />
          <div className="form-text-hint">Empty means no limit</div>
        </div>
        <div className="col-md-4">
          <label className="form-label">Order applied</label>
          <input
            type="number"
            className="form-control"
            value={f.priority}
            onChange={set("priority")}
          />
          <div className="form-text-hint">Lower numbers applied first</div>
        </div>
        <div className="col-12">
          <label className="form-label">Only for these grades</label>
          <select
            multiple
            className="form-select"
            style={{ minHeight: "8rem" }}
            value={f.grade_levels.map(String)}
            onChange={(e) =>
              setF({
                ...f,
                grade_levels: [...e.target.selectedOptions].map((o) => Number(o.value)),
              })
            }
          >
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="form-text-hint">
            Hold Ctrl or Cmd to pick several. Empty means every grade.
          </div>
        </div>
      </div>

      {/* ---------- Behaviour ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Behaviour</h6>
      <div className="form-check mb-2">
        <input
          type="checkbox"
          className="form-check-input"
          id="stackable"
          checked={f.stackable}
          onChange={set("stackable")}
        />
        <label className="form-check-label" htmlFor="stackable">
          Can be combined with other aid
        </label>
      </div>
      {f.rule !== "MANUAL" && (
        <div className="form-check">
          <input
            type="checkbox"
            className="form-check-input"
            id="auto_approve"
            checked={f.auto_approve}
            onChange={set("auto_approve")}
          />
          <label className="form-check-label" htmlFor="auto_approve">
            Approve automatically when created from the finder
          </label>
        </div>
      )}

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy}
        >
          {busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Saving...
            </>
          ) : (
            "Save scheme"
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finder
// ---------------------------------------------------------------------------
function Finder({ scheme, onClose, onDone }) {
  const [rows, setRows] = useState(null);
  const [terms, setTerms] = useState([]);
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState(new Set());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const isSibling = scheme.rule === "SIBLING";

  useEffect(() => {
    bursaryApi.schemes
      .candidates(scheme.id)
      .then((r) => {
        setRows(r.data);
        setPicked(new Set(r.data.map((x) => x.student_id)));
      })
      .catch((e) => setErr(errMsg(e)));
    calendarApi
      .terms({ is_current: true })
      .then((r) => {
        const t = unwrap(r);
        setTerms(t);
        if (t[0]) setTerm(String(t[0].id));
      })
      .catch(() => {});
  }, [scheme.id]);

  const flip = (id) => {
    const n = new Set(picked);
    n.has(id) ? n.delete(id) : n.add(id);
    setPicked(n);
  };

  const create = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await bursaryApi.schemes.createFromCandidates(scheme.id, {
        start_term: Number(term),
        student_ids: [...picked],
      });
      const { created, errors } = r.data;
      onDone(
        `${created} award${created === 1 ? "" : "s"} created${
          scheme.auto_approve ? " and approved" : ". They are waiting for approval"
        }${errors.length ? `. ${errors.length} could not be created.` : "."}`
      );
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}

      {!isSibling && (
        <div className="alert alert-primary" role="status">
          <i className="bi bi-info-circle me-2" />
          These are suggestions. A guardian's phone number matching a staff
          member's is not proof of parenthood. Untick anyone who does not qualify.
        </div>
      )}

      {rows === null ? (
        <div className="text-center py-4">
          <span className="spinner-border spinner-border-sm me-2" />
          Looking for eligible students...
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-people" />
          <h6>No one new qualifies right now</h6>
          <p className="text-muted-soft">
            Try again once new students are admitted or family details are updated.
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap mb-3">
            <div
              className="table-responsive"
              style={{ maxHeight: "24rem" }}
            >
              <table className="table table-hover table-sm mb-0">
                <thead>
                  <tr>
                    <th style={{ width: 40 }} />
                    <th>Student</th>
                    <th>Class</th>
                    <th>{isSibling ? "Sibling rank" : "Staff parent"}</th>
                    <th className="text-end">Discount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.student_id}>
                      <td>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={picked.has(r.student_id)}
                          onChange={() => flip(r.student_id)}
                          aria-label={`Select ${r.name}`}
                        />
                      </td>
                      <td>
                        <div className="cell-name">{r.name}</div>
                        <div className="text-muted-soft small">
                          <span className="cell-mono">{r.admission_no}</span>
                          {isSibling && r.siblings.length
                            ? ` · with ${r.siblings.join(", ")}`
                            : ""}
                        </div>
                      </td>
                      <td>{r.classroom}</td>
                      <td>
                        {isSibling
                          ? `${r.rank} of ${r.family_size}`
                          : `${r.staff_name} (${r.staff_role})`}
                      </td>
                      <td className="cell-num">
                        {r.percent != null
                          ? `${r.percent}%`
                          : valueLabel(scheme.value_type, scheme.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="summary-strip mb-3">
            <span>
              <strong>{picked.size}</strong> student
              {picked.size !== 1 ? "s" : ""} selected
            </span>
            <span className="ms-auto">
              <label className="form-label mb-1">Starts in term</label>
              <select
                className="form-select form-select-sm"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              >
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    Term {t.term_number} · {t.academic_year_label}
                  </option>
                ))}
              </select>
            </span>
          </div>
        </>
      )}

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !picked.size || !term}
          onClick={create}
        >
          {busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Creating...
            </>
          ) : (
            <>
              <i className="bi bi-check2-all me-1" />
              Create {picked.size} award{picked.size === 1 ? "" : "s"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}