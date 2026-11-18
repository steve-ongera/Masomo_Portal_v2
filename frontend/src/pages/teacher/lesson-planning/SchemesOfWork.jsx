import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { calendarApi, lessonPlanningApi, teacherApi } from "../../../services/api";
import { Field, StatusBadge, errMsg, unwrap } from "./shared";

const EDITABLE_STATUSES = ["DRAFT", "REJECTED", "NEEDS_REVISION"];

export default function SchemesOfWork() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [schemes, setSchemes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allocations, setAllocations] = useState([]);
  const [terms, setTerms] = useState([]);
  const [currentYearId, setCurrentYearId] = useState(null);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(Boolean(params.get("new")));
  const [form, setForm] = useState({
    allocation: params.get("new") || "",
    term: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, a, y, t] = await Promise.all([
        lessonPlanningApi.schemes(),
        teacherApi.myAllocations(),
        calendarApi.academicYears(),
        calendarApi.terms(),
      ]);
      setSchemes(unwrap(s));
      setAllocations(unwrap(a));
      setTerms(unwrap(t));
      setCurrentYearId(unwrap(y).find((x) => x.is_current)?.id ?? null);
    } catch (e) {
      setError(errMsg(e));
      setSchemes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const yearAllocations = useMemo(
    () => allocations.filter((a) => !currentYearId || a.academic_year === currentYearId),
    [allocations, currentYearId]
  );

  const chosen = allocations.find((a) => String(a.id) === String(form.allocation));
  const termOptions = terms.filter((t) => chosen && t.academic_year === chosen.academic_year);

  useEffect(() => {
    if (chosen && !form.term) {
      const current = termOptions.find((t) => t.is_current) || termOptions[0];
      if (current) {
        setForm((f) => ({ ...f, term: String(current.id) }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, terms]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await lessonPlanningApi.createScheme({
        allocation: Number(form.allocation),
        term: Number(form.term),
      });
      navigate(`/teacher/lesson-planning/schemes/${data.id}`);
    } catch (err) {
      setError(errMsg(err));
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    if (!schemes) return { total: 0, editable: 0, submitted: 0 };
    return schemes.reduce(
      (acc, s) => {
        acc.total += 1;
        if (EDITABLE_STATUSES.includes(s.status)) acc.editable += 1;
        if (s.status === "SUBMITTED") acc.submitted += 1;
        return acc;
      },
      { total: 0, editable: 0, submitted: 0 }
    );
  }, [schemes]);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Schemes of Work</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Schemes of Work</h1>
          <p className="page-subtitle">The term-long plan: what you teach each week</p>
        </div>
        <div className="page-header__actions">
          <button
            className={`btn btn-sm ${showForm ? "btn-secondary" : "btn-primary"}`}
            onClick={() => setShowForm((v) => !v)}
          >
            <i className={`bi ${showForm ? "bi-x-lg" : "bi-plus-lg"}`}></i>
            {showForm ? "Cancel" : "New Scheme"}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError("")}></button>
        </div>
      )}

      {/* Create panel */}
      {showForm && (
        <form className="table-wrap mb-3" onSubmit={create}>
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-journal-plus me-2 text-brand"></i>
              Create New Scheme
            </span>
            <span className="chart-card__subtitle mb-0">
              One scheme per class and subject, per term
            </span>
          </div>

          <div className="p-3">
            <div className="row g-3 align-items-end">
              <Field label="Class and Subject" className="col-md-6">
                <select
                  className="form-select"
                  required
                  value={form.allocation}
                  onChange={(e) => setForm({ allocation: e.target.value, term: "" })}
                >
                  <option value="">Choose...</option>
                  {yearAllocations.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.subject_name}, {a.classroom_label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Term" className="col-md-4">
                <select
                  className="form-select"
                  required
                  value={form.term}
                  disabled={!chosen}
                  onChange={(e) => setForm({ ...form, term: e.target.value })}
                >
                  <option value="">Choose...</option>
                  {termOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      Term {t.term_number}
                      {t.is_current ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="col-md-2">
                <button
                  className="btn btn-primary w-100"
                  disabled={saving || !form.allocation || !form.term}
                >
                  {saving ? (
                    "Creating..."
                  ) : (
                    <>
                      <i className="bi bi-check2 me-1"></i>
                      Create
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Schemes list */}
      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-journal-text me-2 text-brand"></i>
            My Schemes
          </span>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            {schemes && schemes.length > 0 && (
              <>
                <span className="badge badge-neutral">{summary.total} total</span>
                {summary.editable > 0 && (
                  <span className="badge badge-gold">
                    <span className="status-dot status-dot--pending"></span>
                    {summary.editable} editable
                  </span>
                )}
                {summary.submitted > 0 && (
                  <span className="badge badge-blue">
                    <span className="status-dot status-dot--online"></span>
                    {summary.submitted} awaiting review
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {schemes && schemes.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-journal-text"></i>
            <h6>No schemes of work yet</h6>
            <p className="text-muted-soft mb-3">
              Create one for each class and subject you teach this term.
            </p>
            {!showForm && (
              <button className="btn btn-primary" onClick={() => setShowForm(true)} type="button">
                <i className="bi bi-plus-lg me-1"></i>
                New Scheme
              </button>
            )}
          </div>
        ) : schemes && schemes.length > 0 ? (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Class</th>
                  <th style={{ width: "180px" }}>Term</th>
                  <th className="text-end" style={{ width: "100px" }}>Weeks</th>
                  <th style={{ width: "160px" }}>Status</th>
                  <th style={{ width: "120px" }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schemes.map((s) => {
                  const canEdit = EDITABLE_STATUSES.includes(s.status);
                  return (
                    <tr key={s.id}>
                      <td>
                        <span className="cell-name">{s.subject_name}</span>
                      </td>

                      <td className="cell-muted small">
                        <i className="bi bi-people me-1"></i>
                        {s.classroom_label}
                      </td>

                      <td className="cell-muted small">
                        <i className="bi bi-calendar3 me-1"></i>
                        {s.term_label}
                      </td>

                      <td className="text-end">
                        <span className="cell-mono fw-semibold">
                          {s.entry_count}
                        </span>
                      </td>

                      <td>
                        <StatusBadge status={s.status} />
                      </td>

                      <td className="text-end">
                        <Link
                          className={`btn btn-sm ${
                            canEdit ? "btn-outline-primary" : "btn-outline-secondary"
                          }`}
                          to={`/teacher/lesson-planning/schemes/${s.id}`}
                        >
                          <i className={`bi ${canEdit ? "bi-pencil" : "bi-eye"} me-1`}></i>
                          {canEdit ? "Edit" : "View"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {schemes && schemes.length > 0 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              <strong>{schemes.length}</strong> scheme{schemes.length === 1 ? "" : "s"} ·{" "}
              {summary.editable > 0 ? `${summary.editable} ready to edit` : "All up to date"}
            </span>
            <span className="form-text-hint m-0">
              Click any row to open the scheme
            </span>
          </div>
        )}
      </div>
    </div>
  );
}