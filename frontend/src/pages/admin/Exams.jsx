import { useEffect, useMemo, useState } from "react";
import api, { examsApi, academicsApi, calendarApi } from "../../services/api";

const emptyTypeForm = {
  name: "",
  weight: 1,
  order: 1,
  counts_towards_midterm_rank: false,
  counts_towards_endterm_rank: true,
};

const emptyExamForm = {
  term: "",
  exam_type: "",
  grade_level: "",
  name: "",
  start_date: "",
  end_date: "",
};

const emptyFilters = {
  academic_year: "",
  term: "",
  grade_level: "",
  exam_type: "",
  status: "",
};

const DEFAULT_NAME_TEMPLATE = "{grade} {type} – Term {term} {year}";

function errorText(err, fallback) {
  const data = err?.response?.data;
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (data.detail) return data.detail;
  try {
    return JSON.stringify(data);
  } catch {
    return fallback;
  }
}

// ===========================================================================
// Small reusable bits
// ===========================================================================
function StatCard({ label, value, variant = "primary" }) {
  const variantClass =
    variant === "success" ? "dm-card--success" :
    variant === "secondary" ? "dm-card--secondary" :
    variant === "info" ? "dm-card--info" :
    variant === "dark" ? "dm-card--secondary" :
    "dm-card--primary";
  return (
    <div className={`dm-card ${variantClass}`}>
      <div className="dm-card__top">
        <span className="dm-card__label">{label}</span>
      </div>
      <div className="dm-card__num">{value}</div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel = "Delete", onConfirm, onCancel }) {
  return (
    <>
      <div className="modal d-block" tabIndex="-1" role="dialog" style={{ zIndex: 1055 }}>
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" onClick={onCancel} aria-label="Close" />
            </div>
            <div className="modal-body">
              <p className="mb-0">{message}</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={onConfirm}>
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" style={{ zIndex: 1050 }} />
    </>
  );
}

function SortHeader({ label, field, sort, setSort }) {
  const active = sort.field === field;
  const arrow = active ? (sort.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      role="button"
      onClick={() =>
        setSort((prev) =>
          prev.field === field ? { field, dir: prev.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" }
        )
      }
      className="sortable"
      title={`Sort by ${label}`}
    >
      {label} <span className="text-muted">{arrow}</span>
    </th>
  );
}

export default function AdminExams() {
  const [activeTab, setActiveTab] = useState("all");

  const [exams, setExams] = useState([]);
  const [examTypes, setExamTypes] = useState([]);
  const [gradeLevels, setGradeLevels] = useState([]);
  const [terms, setTerms] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [loading, setLoading] = useState(true);

  const [message, setMessage] = useState(null);

  const flash = (type, text) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 4500);
  };

  const [confirmDialog, setConfirmDialog] = useState(null);
  const askConfirm = (title, message, onConfirm) => setConfirmDialog({ title, message, onConfirm });
  const closeConfirm = () => setConfirmDialog(null);

  const loadAll = async () => {
    const [e, et, g, t, ay] = await Promise.all([
      examsApi.exams(),
      examsApi.examTypes(),
      academicsApi.gradeLevels(),
      calendarApi.terms(),
      calendarApi.academicYears(),
    ]);
    setExams(e.data.results ?? e.data);
    setExamTypes(et.data.results ?? et.data);
    setGradeLevels(g.data.results ?? g.data);
    setTerms(t.data.results ?? t.data);
    setAcademicYears(ay.data.results ?? ay.data);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadAll();
      } catch {
        flash("danger", "Could not load exam data. Please refresh the page.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(
    () => ({
      total: exams.length,
      published: exams.filter((e) => e.is_published).length,
      draft: exams.filter((e) => !e.is_published).length,
      types: examTypes.length,
    }),
    [exams, examTypes]
  );

  // ---------------------------------------------------------------------
  // Exam Type CRUD
  // ---------------------------------------------------------------------
  const [typeForm, setTypeForm] = useState(emptyTypeForm);
  const [editingTypeId, setEditingTypeId] = useState(null);
  const [editTypeForm, setEditTypeForm] = useState(emptyTypeForm);
  const [savingType, setSavingType] = useState(false);

  const addExamType = async (e) => {
    e.preventDefault();
    setSavingType(true);
    try {
      await api.post("/exam-types/", typeForm);
      setTypeForm(emptyTypeForm);
      await loadAll();
      flash("success", "Exam type created.");
    } catch (err) {
      flash("danger", errorText(err, "Could not create exam type."));
    } finally {
      setSavingType(false);
    }
  };

  const startEditType = (type) => {
    setEditingTypeId(type.id);
    setEditTypeForm({
      name: type.name,
      weight: type.weight,
      order: type.order,
      counts_towards_midterm_rank: type.counts_towards_midterm_rank,
      counts_towards_endterm_rank: type.counts_towards_endterm_rank,
    });
  };

  const cancelEditType = () => {
    setEditingTypeId(null);
    setEditTypeForm(emptyTypeForm);
  };

  const saveEditType = async (id) => {
    setSavingType(true);
    try {
      await api.patch(`/exam-types/${id}/`, editTypeForm);
      cancelEditType();
      await loadAll();
      flash("success", "Exam type updated.");
    } catch (err) {
      flash("danger", errorText(err, "Could not update exam type."));
    } finally {
      setSavingType(false);
    }
  };

  const deleteExamType = (type) => {
    askConfirm(
      "Delete exam type?",
      `Delete "${type.name}"? This cannot be undone, and may fail if exams already use it.`,
      async () => {
        closeConfirm();
        try {
          await api.delete(`/exam-types/${type.id}/`);
          await loadAll();
          flash("success", "Exam type deleted.");
        } catch (err) {
          flash(
            "danger",
            errorText(err, "Could not delete this exam type. It may already be used by scheduled exams.")
          );
        }
      }
    );
  };

  // ---------------------------------------------------------------------
  // Exam (schedule) CRUD
  // ---------------------------------------------------------------------
  const [examForm, setExamForm] = useState(emptyExamForm);
  const [editingExamId, setEditingExamId] = useState(null);
  const [editExamForm, setEditExamForm] = useState(emptyExamForm);
  const [savingExam, setSavingExam] = useState(false);

  const addExam = async (e) => {
    e.preventDefault();
    setSavingExam(true);
    try {
      await api.post("/exams/", examForm);
      setExamForm(emptyExamForm);
      await loadAll();
      flash("success", "Exam scheduled.");
    } catch (err) {
      flash("danger", errorText(err, "Could not schedule exam."));
    } finally {
      setSavingExam(false);
    }
  };

  const startEditExam = (exam) => {
    setEditingExamId(exam.id);
    setEditExamForm({
      term: exam.term,
      exam_type: exam.exam_type,
      grade_level: exam.grade_level,
      name: exam.name,
      start_date: exam.start_date,
      end_date: exam.end_date,
    });
  };

  const cancelEditExam = () => {
    setEditingExamId(null);
    setEditExamForm(emptyExamForm);
  };

  const saveEditExam = async (id) => {
    setSavingExam(true);
    try {
      await api.patch(`/exams/${id}/`, editExamForm);
      cancelEditExam();
      await loadAll();
      flash("success", "Exam schedule updated.");
    } catch (err) {
      flash("danger", errorText(err, "Could not update this exam."));
    } finally {
      setSavingExam(false);
    }
  };

  const deleteExam = (exam) => {
    askConfirm("Delete exam?", `Delete "${exam.name}"? This cannot be undone.`, async () => {
      closeConfirm();
      try {
        await api.delete(`/exams/${exam.id}/`);
        await loadAll();
        flash("success", "Exam deleted.");
      } catch (err) {
        flash("danger", errorText(err, "Could not delete this exam."));
      }
    });
  };

  const togglePublish = async (exam) => {
    try {
      await api.patch(`/exams/${exam.id}/`, { is_published: !exam.is_published });
      await loadAll();
    } catch (err) {
      flash("danger", errorText(err, "Could not change publish status."));
    }
  };

  // ---------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------
  const [filters, setFilters] = useState(emptyFilters);
  const [sort, setSort] = useState({ field: "", dir: "asc" });

  const termsForYear = (academicYearId) =>
    academicYearId ? terms.filter((t) => String(t.academic_year) === String(academicYearId)) : terms;

  const filteredTermOptions = useMemo(
    () => termsForYear(filters.academic_year),
    [terms, filters.academic_year]
  );

  const setFilter = (field, value) => {
    setFilters((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "academic_year") next.term = "";
      return next;
    });
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const filteredExams = useMemo(() => {
    let rows = exams.filter((ex) => {
      if (filters.term && String(ex.term) !== String(filters.term)) return false;
      if (!filters.term && filters.academic_year) {
        const term = terms.find((t) => t.id === ex.term);
        if (!term || String(term.academic_year) !== String(filters.academic_year)) return false;
      }
      if (filters.grade_level && String(ex.grade_level) !== String(filters.grade_level)) return false;
      if (filters.exam_type && String(ex.exam_type) !== String(filters.exam_type)) return false;
      if (filters.status === "published" && !ex.is_published) return false;
      if (filters.status === "draft" && ex.is_published) return false;
      return true;
    });

    if (sort.field) {
      const dir = sort.dir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const av = (a[sort.field] ?? "").toString().toLowerCase();
        const bv = (b[sort.field] ?? "").toString().toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    return rows;
  }, [exams, terms, filters, sort]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Exams</h1>
          <p className="page-subtitle">Schedule, filter, and publish exams across every grade.</p>
        </div>
      </div>

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      {/* Summary tiles */}
      <div className="stat-grid">
        <StatCard label="Total Exams" value={stats.total} variant="dark" />
        <StatCard label="Published" value={stats.published} variant="success" />
        <StatCard label="Draft" value={stats.draft} variant="secondary" />
        <StatCard label="Exam Types" value={stats.types} variant="info" />
      </div>

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === "all" ? "active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            All Exams <span className="badge badge-neutral ms-1">{exams.length}</span>
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === "types" ? "active" : ""}`}
            onClick={() => setActiveTab("types")}
          >
            Exam Types <span className="badge badge-neutral ms-1">{examTypes.length}</span>
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === "schedule" ? "active" : ""}`}
            onClick={() => setActiveTab("schedule")}
          >
            Schedule Exams
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === "bulk" ? "active" : ""}`}
            onClick={() => setActiveTab("bulk")}
          >
            Bulk Create
          </button>
        </li>
      </ul>

      {loading ? (
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      ) : (
        <>
          {activeTab === "all" && (
            <AllExamsTab
              exams={filteredExams}
              totalCount={exams.length}
              academicYears={academicYears}
              terms={filteredTermOptions}
              gradeLevels={gradeLevels}
              examTypes={examTypes}
              filters={filters}
              setFilter={setFilter}
              resetFilters={() => setFilters(emptyFilters)}
              activeFilterCount={activeFilterCount}
              togglePublish={togglePublish}
              sort={sort}
              setSort={setSort}
            />
          )}

          {activeTab === "types" && (
            <ExamTypesTab
              examTypes={examTypes}
              typeForm={typeForm}
              setTypeForm={setTypeForm}
              addExamType={addExamType}
              savingType={savingType}
              editingTypeId={editingTypeId}
              editTypeForm={editTypeForm}
              setEditTypeForm={setEditTypeForm}
              startEditType={startEditType}
              cancelEditType={cancelEditType}
              saveEditType={saveEditType}
              deleteExamType={deleteExamType}
            />
          )}

          {activeTab === "schedule" && (
            <ScheduleExamsTab
              exams={exams}
              examTypes={examTypes}
              gradeLevels={gradeLevels}
              terms={terms}
              examForm={examForm}
              setExamForm={setExamForm}
              addExam={addExam}
              savingExam={savingExam}
              editingExamId={editingExamId}
              editExamForm={editExamForm}
              setEditExamForm={setEditExamForm}
              startEditExam={startEditExam}
              cancelEditExam={cancelEditExam}
              saveEditExam={saveEditExam}
              deleteExam={deleteExam}
              togglePublish={togglePublish}
            />
          )}

          {activeTab === "bulk" && (
            <BulkExamsTab
              exams={exams}
              examTypes={examTypes}
              gradeLevels={gradeLevels}
              terms={terms}
              reload={loadAll}
              flash={flash}
            />
          )}
        </>
      )}

      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={closeConfirm}
        />
      )}
    </div>
  );
}

// ===========================================================================
// TAB 1 — All Exams
// ===========================================================================
function AllExamsTab({
  exams,
  totalCount,
  academicYears,
  terms,
  gradeLevels,
  examTypes,
  filters,
  setFilter,
  resetFilters,
  activeFilterCount,
  togglePublish,
  sort,
  setSort,
}) {
  return (
    <div>
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-funnel me-2 text-brand"></i>
            Filters
          </span>
          <button
            type="button"
            className="btn btn-sm btn-light"
            onClick={resetFilters}
            disabled={!activeFilterCount}
          >
            <i className="bi bi-x-lg"></i>
            Clear filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
        <div className="toolbar p-3 mb-0">
          <select className="form-select w-auto" value={filters.academic_year} onChange={(e) => setFilter("academic_year", e.target.value)}>
            <option value="">All years</option>
            {academicYears.map((ay) => (
              <option key={ay.id} value={ay.id}>
                {ay.year}
                {ay.is_current ? " (current)" : ""}
              </option>
            ))}
          </select>
          <select className="form-select w-auto" value={filters.term} onChange={(e) => setFilter("term", e.target.value)}>
            <option value="">All terms</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                Term {t.term_number} - {t.academic_year_label}
                {t.is_current ? " (current)" : ""}
              </option>
            ))}
          </select>
          <select className="form-select w-auto" value={filters.grade_level} onChange={(e) => setFilter("grade_level", e.target.value)}>
            <option value="">All grades</option>
            {gradeLevels.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select className="form-select w-auto" value={filters.exam_type} onChange={(e) => setFilter("exam_type", e.target.value)}>
            <option value="">All types</option>
            {examTypes.map((et) => (
              <option key={et.id} value={et.id}>{et.name}</option>
            ))}
          </select>
          <select className="form-select w-auto" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
            <option value="">All</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="chart-card__subtitle mb-0">
          Showing {exams.length} of {totalCount} exams
        </span>
      </div>

      <div className="table-wrap">
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <SortHeader label="Name" field="name" sort={sort} setSort={setSort} />
                <th>Type</th>
                <th>Grade</th>
                <th>Term</th>
                <SortHeader label="Dates" field="start_date" sort={sort} setSort={setSort} />
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {exams.map((ex) => (
                <tr key={ex.id}>
                  <td className="cell-name">{ex.name}</td>
                  <td className="cell-muted small">{ex.exam_type_name}</td>
                  <td className="cell-muted small">{ex.grade_level_name || ex.grade_level}</td>
                  <td className="cell-muted small">{ex.term_label}</td>
                  <td className="cell-mono small">
                    {ex.start_date} → {ex.end_date}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`btn btn-sm ${ex.is_published ? "btn-success" : "btn-outline-secondary"}`}
                      onClick={() => togglePublish(ex)}
                    >
                      {ex.is_published ? "✓ Published" : "Draft"}
                    </button>
                  </td>
                </tr>
              ))}
              {exams.length === 0 && (
                <tr>
                  <td colSpan={6} className="cell-muted text-center">
                    {totalCount === 0
                      ? "No exams scheduled yet. Add one under the Schedule Exams tab."
                      : "No exams match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// TAB 2 — Exam Types
// ===========================================================================
function ExamTypesTab({
  examTypes,
  typeForm,
  setTypeForm,
  addExamType,
  savingType,
  editingTypeId,
  editTypeForm,
  setEditTypeForm,
  startEditType,
  cancelEditType,
  saveEditType,
  deleteExamType,
}) {
  const [search, setSearch] = useState("");

  const visibleTypes = useMemo(() => {
    if (!search.trim()) return examTypes;
    const q = search.trim().toLowerCase();
    return examTypes.filter((et) => et.name.toLowerCase().includes(q));
  }, [examTypes, search]);

  return (
    <div className="row g-3">
      <div className="col-md-4">
        <form className="table-wrap" onSubmit={addExamType}>
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-plus-circle me-2 text-brand"></i>
              Add Exam Type
            </span>
          </div>
          <div className="p-3">
            <input
              className="form-control mb-2"
              placeholder="e.g. Midterm Exam"
              value={typeForm.name}
              onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
              required
            />
            <div className="row g-2 mb-2">
              <div className="col-6">
                <label className="form-label">Weight</label>
                <input
                  type="number"
                  step="0.1"
                  className="form-control"
                  value={typeForm.weight}
                  onChange={(e) => setTypeForm({ ...typeForm, weight: e.target.value })}
                />
              </div>
              <div className="col-6">
                <label className="form-label">Order in term</label>
                <input
                  type="number"
                  className="form-control"
                  value={typeForm.order}
                  onChange={(e) => setTypeForm({ ...typeForm, order: e.target.value })}
                />
              </div>
            </div>
            <div className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                id="midtermFlag"
                checked={typeForm.counts_towards_midterm_rank}
                onChange={(e) => setTypeForm({ ...typeForm, counts_towards_midterm_rank: e.target.checked })}
              />
              <label className="form-check-label" htmlFor="midtermFlag">
                Counts toward midterm ranking
              </label>
            </div>
            <div className="form-check mb-2">
              <input
                type="checkbox"
                className="form-check-input"
                id="endtermFlag"
                checked={typeForm.counts_towards_endterm_rank}
                onChange={(e) => setTypeForm({ ...typeForm, counts_towards_endterm_rank: e.target.checked })}
              />
              <label className="form-check-label" htmlFor="endtermFlag">
                Counts toward end-of-term ranking
              </label>
            </div>
            <button className="btn btn-primary btn-sm" disabled={savingType}>
              {savingType ? "Saving…" : "Save Exam Type"}
            </button>
          </div>
        </form>
      </div>

      <div className="col-md-8">
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-tags me-2 text-brand"></i>
              Exam Types
            </span>
            <span className="chart-card__subtitle mb-0">
              {visibleTypes.length} of {examTypes.length}
            </span>
          </div>
          <div className="toolbar p-3 mb-0">
            <div className="toolbar__search" style={{ maxWidth: "none" }}>
              <i className="bi bi-search"></i>
              <input
                type="search"
                className="form-control"
                placeholder="Search exam types…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: 90 }}>Weight</th>
                  <th style={{ width: 90 }}>Order</th>
                  <th>Midterm</th>
                  <th>End-term</th>
                  <th style={{ width: 160 }}></th>
                </tr>
              </thead>
              <tbody>
                {visibleTypes.map((et) =>
                  editingTypeId === et.id ? (
                    <tr key={et.id}>
                      <td><input className="form-control form-control-sm" value={editTypeForm.name} onChange={(e) => setEditTypeForm({ ...editTypeForm, name: e.target.value })} /></td>
                      <td><input type="number" step="0.1" className="form-control form-control-sm" value={editTypeForm.weight} onChange={(e) => setEditTypeForm({ ...editTypeForm, weight: e.target.value })} /></td>
                      <td><input type="number" className="form-control form-control-sm" value={editTypeForm.order} onChange={(e) => setEditTypeForm({ ...editTypeForm, order: e.target.value })} /></td>
                      <td><input type="checkbox" className="form-check-input" checked={editTypeForm.counts_towards_midterm_rank} onChange={(e) => setEditTypeForm({ ...editTypeForm, counts_towards_midterm_rank: e.target.checked })} /></td>
                      <td><input type="checkbox" className="form-check-input" checked={editTypeForm.counts_towards_endterm_rank} onChange={(e) => setEditTypeForm({ ...editTypeForm, counts_towards_endterm_rank: e.target.checked })} /></td>
                      <td>
                        <div className="table-actions justify-content-end">
                          <button type="button" className="btn btn-success btn-sm me-1" onClick={() => saveEditType(et.id)}>Save</button>
                          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={cancelEditType}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={et.id}>
                      <td className="cell-name">{et.name}</td>
                      <td className="cell-mono">{et.weight}</td>
                      <td className="cell-mono">{et.order}</td>
                      <td>
                        {et.counts_towards_midterm_rank ? (
                          <span className="badge badge-success">Yes</span>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        {et.counts_towards_endterm_rank ? (
                          <span className="badge badge-success">Yes</span>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="table-actions justify-content-end">
                          <button type="button" className="btn btn-outline-primary btn-sm me-1" onClick={() => startEditType(et)}>Edit</button>
                          <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => deleteExamType(et)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
                {visibleTypes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="cell-muted text-center">
                      {examTypes.length === 0
                        ? "No exam types yet. Add one on the left."
                        : "No exam types match your search."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// TAB 3 — Schedule Exams
// ===========================================================================
function ScheduleExamsTab({
  exams,
  examTypes,
  gradeLevels,
  terms,
  examForm,
  setExamForm,
  addExam,
  savingExam,
  editingExamId,
  editExamForm,
  setEditExamForm,
  startEditExam,
  cancelEditExam,
  saveEditExam,
  deleteExam,
  togglePublish,
}) {
  const [search, setSearch] = useState("");
  const [nameEdited, setNameEdited] = useState(false);

  useEffect(() => {
    if (examForm === emptyExamForm) setNameEdited(false);
  }, [examForm]);

  const suggestName = (form) => {
    const term = terms.find((t) => String(t.id) === String(form.term));
    const type = examTypes.find((et) => String(et.id) === String(form.exam_type));
    const grade = gradeLevels.find((g) => String(g.id) === String(form.grade_level));
    if (!term || !type || !grade) return "";
    return `${grade.name} ${type.name} – Term ${term.term_number} ${term.academic_year_label}`;
  };

  const updateExamForm = (patch) => {
    const next = { ...examForm, ...patch };
    if (!nameEdited && !("name" in patch)) {
      const suggested = suggestName(next);
      if (suggested) next.name = suggested;
    }
    setExamForm(next);
  };

  const visibleExams = useMemo(() => {
    if (!search.trim()) return exams;
    const q = search.trim().toLowerCase();
    return exams.filter(
      (ex) =>
        ex.name.toLowerCase().includes(q) ||
        (ex.grade_level_name || "").toLowerCase().includes(q) ||
        (ex.term_label || "").toLowerCase().includes(q)
    );
  }, [exams, search]);

  return (
    <div>
      <form className="table-wrap mb-3" onSubmit={addExam}>
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-calendar-plus me-2 text-brand"></i>
            Schedule an Exam
          </span>
        </div>
        <div className="p-3">
          <div className="row g-2">
            <div className="col-md-3">
              <select className="form-select" required value={examForm.term} onChange={(e) => updateExamForm({ term: e.target.value })}>
                <option value="">Term...</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>Term {t.term_number} - {t.academic_year_label}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <select className="form-select" required value={examForm.exam_type} onChange={(e) => updateExamForm({ exam_type: e.target.value })}>
                <option value="">Exam type...</option>
                {examTypes.map((et) => (
                  <option key={et.id} value={et.id}>{et.name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <select className="form-select" required value={examForm.grade_level} onChange={(e) => updateExamForm({ grade_level: e.target.value })}>
                <option value="">Grade level...</option>
                {gradeLevels.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <input
                className="form-control"
                placeholder="e.g. Form 4 Midterm Exam – Term 1 2026"
                value={examForm.name}
                onChange={(e) => {
                  setNameEdited(e.target.value.trim() !== "");
                  setExamForm({ ...examForm, name: e.target.value });
                }}
                maxLength={120}
                required
              />
              <div className="form-text-hint">Suggested from term, type and grade. You can edit it.</div>
            </div>
            <div className="col-md-3">
              <label className="form-label">Start date</label>
              <input type="date" className="form-control" value={examForm.start_date} onChange={(e) => setExamForm({ ...examForm, start_date: e.target.value })} required />
            </div>
            <div className="col-md-3">
              <label className="form-label">End date</label>
              <input type="date" className="form-control" value={examForm.end_date} onChange={(e) => setExamForm({ ...examForm, end_date: e.target.value })} required />
            </div>
          </div>
          <button className="btn btn-primary btn-sm mt-2" disabled={savingExam}>
            {savingExam ? "Saving…" : "Save Exam"}
          </button>
        </div>
      </form>

      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-calendar3 me-2 text-brand"></i>
            Scheduled Exams
          </span>
          <span className="chart-card__subtitle mb-0">
            {visibleExams.length} of {exams.length}
          </span>
        </div>
        <div className="toolbar p-3 mb-0">
          <div className="toolbar__search" style={{ maxWidth: "none" }}>
            <i className="bi bi-search"></i>
            <input
              type="search"
              className="form-control"
              placeholder="Search by name, grade, or term…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-responsive">
          <table className="table table-hover mb-0 align-middle">
            <thead>
              <tr>
                <th>Name</th>
                <th>Term</th>
                <th>Type</th>
                <th>Grade</th>
                <th>Start</th>
                <th>End</th>
                <th>Published</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {visibleExams.map((ex) =>
                editingExamId === ex.id ? (
                  <tr key={ex.id}>
                    <td><input className="form-control form-control-sm" value={editExamForm.name} onChange={(e) => setEditExamForm({ ...editExamForm, name: e.target.value })} /></td>
                    <td>
                      <select className="form-select form-select-sm" value={editExamForm.term} onChange={(e) => setEditExamForm({ ...editExamForm, term: e.target.value })}>
                        {terms.map((t) => (<option key={t.id} value={t.id}>Term {t.term_number} - {t.academic_year_label}</option>))}
                      </select>
                    </td>
                    <td>
                      <select className="form-select form-select-sm" value={editExamForm.exam_type} onChange={(e) => setEditExamForm({ ...editExamForm, exam_type: e.target.value })}>
                        {examTypes.map((et) => (<option key={et.id} value={et.id}>{et.name}</option>))}
                      </select>
                    </td>
                    <td>
                      <select className="form-select form-select-sm" value={editExamForm.grade_level} onChange={(e) => setEditExamForm({ ...editExamForm, grade_level: e.target.value })}>
                        {gradeLevels.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
                      </select>
                    </td>
                    <td><input type="date" className="form-control form-control-sm" value={editExamForm.start_date} onChange={(e) => setEditExamForm({ ...editExamForm, start_date: e.target.value })} /></td>
                    <td><input type="date" className="form-control form-control-sm" value={editExamForm.end_date} onChange={(e) => setEditExamForm({ ...editExamForm, end_date: e.target.value })} /></td>
                    <td>
                      <button type="button" className={`btn btn-sm ${ex.is_published ? "btn-success" : "btn-outline-secondary"}`} onClick={() => togglePublish(ex)}>
                        {ex.is_published ? "Published" : "Draft"}
                      </button>
                    </td>
                    <td>
                      <div className="table-actions justify-content-end">
                        <button type="button" className="btn btn-success btn-sm me-1" onClick={() => saveEditExam(ex.id)}>Save</button>
                        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={cancelEditExam}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={ex.id}>
                    <td className="cell-name">{ex.name}</td>
                    <td className="cell-muted small">{ex.term_label}</td>
                    <td className="cell-muted small">{ex.exam_type_name}</td>
                    <td className="cell-muted small">{ex.grade_level_name || ex.grade_level}</td>
                    <td className="cell-mono small">{ex.start_date}</td>
                    <td className="cell-mono small">{ex.end_date}</td>
                    <td>
                      <button type="button" className={`btn btn-sm ${ex.is_published ? "btn-success" : "btn-outline-secondary"}`} onClick={() => togglePublish(ex)}>
                        {ex.is_published ? "Published" : "Draft"}
                      </button>
                    </td>
                    <td>
                      <div className="table-actions justify-content-end">
                        <button type="button" className="btn btn-outline-primary btn-sm me-1" onClick={() => startEditExam(ex)}>Edit</button>
                        <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => deleteExam(ex)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              )}
              {visibleExams.length === 0 && (
                <tr>
                  <td colSpan={8} className="cell-muted text-center">
                    {exams.length === 0 ? "No exams scheduled yet. Add one above." : "No exams match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// TAB 4 — Bulk Create
// ===========================================================================
function BulkExamsTab({ exams, examTypes, gradeLevels, terms, reload, flash }) {
  const [form, setForm] = useState({
    term: "",
    exam_type: "",
    start_date: "",
    end_date: "",
    is_published: false,
    name_template: DEFAULT_NAME_TEMPLATE,
  });
  const [selected, setSelected] = useState([]);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const ordered = useMemo(
    () =>
      [...gradeLevels].sort(
        (a, b) =>
          String(a.curriculum_type).localeCompare(String(b.curriculum_type)) ||
          a.level_order - b.level_order
      ),
    [gradeLevels]
  );

  const groups = useMemo(() => {
    const map = new Map();
    ordered.forEach((g) => {
      const key = g.curriculum_type;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(g);
    });
    return [...map.entries()];
  }, [ordered]);

  const term = terms.find((t) => String(t.id) === String(form.term));
  const examType = examTypes.find((et) => String(et.id) === String(form.exam_type));

  const existingGradeIds = useMemo(() => {
    if (!form.term || !form.exam_type) return new Set();
    return new Set(
      exams
        .filter(
          (e) => String(e.term) === String(form.term) && String(e.exam_type) === String(form.exam_type)
        )
        .map((e) => String(e.grade_level))
    );
  }, [exams, form.term, form.exam_type]);

  const isTaken = (id) => existingGradeIds.has(String(id));
  const toCreate = ordered.filter((g) => selected.includes(g.id) && !isTaken(g.id));
  const alreadyThere = ordered.filter((g) => selected.includes(g.id) && isTaken(g.id));

  const buildName = (grade) =>
    form.name_template
      .replaceAll("{grade}", grade.name)
      .replaceAll("{type}", examType?.name ?? "…")
      .replaceAll("{term}", term?.term_number ?? "…")
      .replaceAll("{year}", term?.academic_year_label ?? "…")
      .slice(0, 120);

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectMany = (list) =>
    setSelected((prev) => [...new Set([...prev, ...list.filter((g) => !isTaken(g.id)).map((g) => g.id)])]);

  const clearMany = (list) => {
    const ids = new Set(list.map((g) => g.id));
    setSelected((prev) => prev.filter((id) => !ids.has(id)));
  };

  const applyRange = () => {
    const a = ordered.findIndex((g) => String(g.id) === String(rangeFrom));
    const b = ordered.findIndex((g) => String(g.id) === String(rangeTo));
    if (a < 0 || b < 0) return;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const curriculum = ordered[lo].curriculum_type;
    selectMany(ordered.slice(lo, hi + 1).filter((g) => g.curriculum_type === curriculum));
  };

  const datesInvalid = form.start_date && form.end_date && form.end_date < form.start_date;
  const outsideTerm =
    term &&
    form.start_date &&
    form.end_date &&
    (form.start_date < term.start_date || form.end_date > term.end_date);

  const canSubmit =
    form.term && form.exam_type && form.start_date && form.end_date && !datesInvalid && toCreate.length > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setResult(null);
    try {
      const { data } = await examsApi.bulkCreateExams({
        term: form.term,
        exam_type: form.exam_type,
        grade_level_ids: toCreate.map((g) => g.id),
        start_date: form.start_date,
        end_date: form.end_date,
        name_template: form.name_template || DEFAULT_NAME_TEMPLATE,
        is_published: form.is_published,
      });
      setResult(data);
      setSelected([]);
      await reload();
      flash(
        "success",
        `${data.created_count} exam${data.created_count === 1 ? "" : "s"} created` +
          (data.skipped_count ? `, ${data.skipped_count} skipped (already existed).` : ".")
      );
    } catch (err) {
      flash("danger", errorText(err, "Could not create the exams."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {/* Step 1 */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-1-circle me-2 text-brand"></i>
            1. Exam details
          </span>
        </div>
        <div className="p-3">
          <div className="row g-2">
            <div className="col-md-3">
              <label className="form-label">Term</label>
              <select className="form-select" required value={form.term} onChange={(e) => set({ term: e.target.value })}>
                <option value="">Term...</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    Term {t.term_number} - {t.academic_year_label}
                    {t.is_current ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Exam type</label>
              <select className="form-select" required value={form.exam_type} onChange={(e) => set({ exam_type: e.target.value })}>
                <option value="">Exam type...</option>
                {examTypes.map((et) => (<option key={et.id} value={et.id}>{et.name}</option>))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Start date</label>
              <input type="date" className="form-control" required value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label className="form-label">End date</label>
              <input type="date" className={`form-control ${datesInvalid ? "is-invalid" : ""}`} required value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} />
              {datesInvalid && <div className="invalid-feedback">End date is before the start date.</div>}
            </div>
          </div>
          {outsideTerm && (
            <div className="form-text-hint text-gold mt-2">
              These dates fall outside the selected term ({term.start_date} → {term.end_date}). You can still save.
            </div>
          )}
          <div className="row g-2 mt-1 align-items-end">
            <div className="col-md-8">
              <label className="form-label">Name pattern</label>
              <input className="form-control" value={form.name_template} maxLength={120} onChange={(e) => set({ name_template: e.target.value })} />
              <div className="form-text-hint">
                Use <code>{"{grade}"}</code> <code>{"{type}"}</code> <code>{"{term}"}</code> <code>{"{year}"}</code>. Each grade gets its own name.
              </div>
            </div>
            <div className="col-md-4">
              <div className="form-check">
                <input type="checkbox" className="form-check-input" id="bulkPublish" checked={form.is_published} onChange={(e) => set({ is_published: e.target.checked })} />
                <label className="form-check-label" htmlFor="bulkPublish">
                  Publish immediately (otherwise saved as draft)
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-2-circle me-2 text-brand"></i>
            2. Choose the grades
          </span>
          <span className="chart-card__subtitle mb-0">{selected.length} selected</span>
        </div>
        <div className="p-3">
          <div className="row g-2 align-items-end mb-3">
            <div className="col-6 col-md-3">
              <label className="form-label">From</label>
              <select className="form-select form-select-sm" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)}>
                <option value="">Grade...</option>
                {ordered.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label">To</label>
              <select className="form-select form-select-sm" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)}>
                <option value="">Grade...</option>
                {ordered.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
              </select>
            </div>
            <div className="col-md-3">
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={applyRange} disabled={!rangeFrom || !rangeTo}>
                Select range
              </button>
            </div>
            <div className="col-md-3 text-md-end">
              <button type="button" className="btn btn-link btn-sm" onClick={() => setSelected([])}>Clear all</button>
            </div>
          </div>

          {groups.map(([curriculum, list]) => (
            <div key={curriculum} className="mb-3">
              <div className="d-flex align-items-center gap-2 mb-1">
                <span className="section-label mb-0">{curriculum}</span>
                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => selectMany(list)}>select all</button>
                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => clearMany(list)}>clear</button>
              </div>
              <div className="d-flex flex-wrap gap-2">
                {list.map((g) => {
                  const taken = isTaken(g.id);
                  const on = selected.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      disabled={taken}
                      onClick={() => toggle(g.id)}
                      className={`btn btn-sm ${on ? "btn-primary" : "btn-outline-secondary"}`}
                      title={taken ? "This exam already exists for this term" : ""}
                    >
                      {on ? "✓ " : ""}
                      {g.name}
                      {taken ? " (exists)" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {(!form.term || !form.exam_type) && (
            <div className="form-text-hint">Pick a term and exam type above to see which grades already have this exam.</div>
          )}
        </div>
      </div>

      {/* Step 3 */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-3-circle me-2 text-brand"></i>
            3. Review
          </span>
        </div>
        <div className="p-3">
          {toCreate.length === 0 ? (
            <div className="form-text-hint">Nothing to create yet. Select at least one grade.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm mb-2 align-middle">
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th>Exam name</th>
                    <th>Dates</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {toCreate.map((g) => (
                    <tr key={g.id}>
                      <td className="cell-name">{g.name}</td>
                      <td className="cell-muted small">{buildName(g)}</td>
                      <td className="cell-mono small text-nowrap">
                        {form.start_date || "…"} → {form.end_date || "…"}
                      </td>
                      <td>
                        <span className={`badge ${form.is_published ? "badge-success" : "badge-neutral"}`}>
                          {form.is_published ? "Published" : "Draft"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {alreadyThere.length > 0 && (
            <div className="form-text-hint text-gold">
              Will be skipped (already exist): {alreadyThere.map((g) => g.name).join(", ")}
            </div>
          )}

          <button className="btn btn-primary btn-sm mt-2" disabled={!canSubmit || saving}>
            {saving ? "Creating…" : `Create ${toCreate.length} exam${toCreate.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>

      {result && (
        <div className="alert alert-light border">
          <strong>Done.</strong> {result.created_count} created
          {result.skipped_count > 0 && <>, skipped: {result.skipped.join(", ")}</>}. You can review or edit them under{" "}
          <em>Schedule Exams</em>.
        </div>
      )}
    </form>
  );
}