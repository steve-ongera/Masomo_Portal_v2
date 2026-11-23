import { useEffect, useMemo, useRef, useState } from "react";
import { academicsApi, calendarApi, examsApi } from "../../services/api";

const cellKey = (enrollmentId, subjectId, paperId) =>
  `${enrollmentId}:${subjectId}:${paperId ?? "single"}`;

const isAbsentValue = (v) => /^a(bs)?$/i.test((v ?? "").trim());

const STATUS_BADGE = {
  PROMOTED: "badge-gold",
  GRADUATED: "badge-neutral",
  REPEATED: "badge-neutral",
};

export default function AdminMarkEntry() {
  // ---------- selection ----------
  const [classrooms, setClassrooms] = useState([]);
  const [year, setYear] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [classroomId, setClassroomId] = useState("");

  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState("");

  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [examsLoading, setExamsLoading] = useState(false);

  // ---------- sheet ----------
  const [sheet, setSheet] = useState(null);
  const [values, setValues] = useState({});
  const [original, setOriginal] = useState({});
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowErrors, setRowErrors] = useState({});
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");

  // ---------- per-exam paper setup ----------
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupSubjectId, setSetupSubjectId] = useState("");
  const [draft, setDraft] = useState([]);
  const [savingSetup, setSavingSetup] = useState(false);

  const inputRefs = useRef({});
  const isDev = import.meta.env.DEV;

  const notify = (text, type = "info") => {
    setMessage(text);
    setMessageType(type);
  };

  useEffect(() => {
    academicsApi.allClassrooms().then(({ data }) => setClassrooms(data.results ?? data));
  }, []);

  const years = useMemo(
    () => [...new Set(classrooms.map((c) => c.academic_year_year))].sort((a, b) => b - a),
    [classrooms]
  );

  const gradesForYear = useMemo(() => {
    const pool = year ? classrooms.filter((c) => String(c.academic_year_year) === String(year)) : classrooms;
    const seen = new Map();
    pool.forEach((c) => seen.set(c.grade_level, c.grade_level_name));
    return [...seen.entries()];
  }, [classrooms, year]);

  const classroomsForGrade = useMemo(
    () =>
      classrooms.filter((c) => {
        if (year && String(c.academic_year_year) !== String(year)) return false;
        if (gradeId && String(c.grade_level) !== String(gradeId)) return false;
        return true;
      }),
    [classrooms, year, gradeId]
  );

  const selectedClassroom = classrooms.find((c) => String(c.id) === String(classroomId));

  const classroomOptionLabel = (c) => {
    let label = `${c.stream_name} — ${c.academic_year_year}`;
    if (c.is_promoted) label += ` — Promoted → ${c.promoted_to_label}`;
    else label += ` — ${c.student_count} active`;
    return year ? label : `${c.grade_level_name} ${label}`;
  };

  useEffect(() => {
    setTermId("");
    setTerms([]);
    if (!selectedClassroom) return;
    calendarApi
      .terms({ academic_year: selectedClassroom.academic_year, page_size: 100 })
      .then(({ data }) => setTerms(data.results ?? data));
  }, [classroomId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setExamId("");
    setExams([]);
    if (!selectedClassroom || !termId) return;
    setExamsLoading(true);
    examsApi
      .exams({ grade_level: selectedClassroom.grade_level, term: termId, page_size: 200 })
      .then(({ data }) => setExams(data.results ?? data))
      .finally(() => setExamsLoading(false));
  }, [termId, classroomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetSheet = () => {
    setSheet(null);
    setValues({});
    setOriginal({});
    setRowErrors({});
    setSetupOpen(false);
    setMessage("");
  };

  // ---------- derived ----------
  const columns = useMemo(() => {
    if (!sheet) return [];
    return sheet.subjects.flatMap((s) =>
      s.columns.map((c) => ({
        subject_id: s.subject_id,
        subject_code: s.subject_code,
        subject_name: s.subject_name,
        paper_id: c.paper_id,
        label: c.label,
        max: Number(c.max_marks),
      }))
    );
  }, [sheet]);

  const dirtyKeys = useMemo(
    () => Object.keys(values).filter((k) => (values[k] ?? "") !== (original[k] ?? "")),
    [values, original]
  );

  const isInvalid = (raw, max) => {
    const v = (raw ?? "").trim();
    if (!v || isAbsentValue(v)) return false;
    const n = Number(v);
    return Number.isNaN(n) || n < 0 || n > max;
  };

  const invalidCount = useMemo(() => {
    if (!sheet) return 0;
    let n = 0;
    sheet.students.forEach((s) =>
      columns.forEach((c) => {
        if (isInvalid(values[cellKey(s.enrollment_id, c.subject_id, c.paper_id)], c.max)) n++;
      })
    );
    return n;
  }, [values, sheet, columns]);

  const totalCells = sheet ? sheet.students.length * columns.length : 0;
  const filledCount = useMemo(() => {
    if (!sheet) return 0;
    let n = 0;
    sheet.students.forEach((s) =>
      columns.forEach((c) => {
        if ((values[cellKey(s.enrollment_id, c.subject_id, c.paper_id)] ?? "").trim()) n++;
      })
    );
    return n;
  }, [values, sheet, columns]);
  const progressPct = totalCells ? Math.round((filledCount / totalCells) * 100) : 0;

  const rowStats = (enrollmentId) => {
    let total = 0;
    let max = 0;
    columns.forEach((c) => {
      const v = (values[cellKey(enrollmentId, c.subject_id, c.paper_id)] ?? "").trim();
      if (!v || isAbsentValue(v) || Number.isNaN(Number(v))) return;
      total += Number(v);
      max += c.max;
    });
    return { total, pct: max ? (total / max) * 100 : null };
  };

  // ---------- load ----------
  const loadSheet = async (skipConfirm = false) => {
    if (!classroomId || !examId) return;
    if (!skipConfirm && dirtyKeys.length && !window.confirm("You have unsaved marks. Discard them and reload?")) {
      return;
    }
    setLoadingSheet(true);
    setMessage("");
    setRowErrors({});
    try {
      const { data } = await academicsApi.examSpreadsheet(classroomId, examId);
      const init = {};
      Object.entries(data.marks || {}).forEach(([k, m]) => {
        init[k] = m.is_absent ? "A" : m.marks_obtained == null ? "" : String(m.marks_obtained);
      });
      setSheet(data);
      setValues(init);
      setOriginal(init);
    } catch (err) {
      setSheet(null);
      notify(err.response?.data?.detail || "Could not load the spreadsheet.", "danger");
    } finally {
      setLoadingSheet(false);
    }
  };

  const setCell = (key, val) => setValues((p) => ({ ...p, [key]: val }));

  // ==========================================================================
  // DEV / TESTING ONLY
  // ==========================================================================
  const seedDemoMarks = () => {
    if (!sheet) return;
    setValues((prev) => {
      const next = { ...prev };
      sheet.students.forEach((s) =>
        columns.forEach((c) => {
          const k = cellKey(s.enrollment_id, c.subject_id, c.paper_id);
          if ((next[k] ?? "").trim()) return;
          if (Math.random() < 0.05) {
            next[k] = "A";
            return;
          }
          const min = Math.round(c.max * 0.3);
          const cap = Math.round(c.max * 0.95);
          next[k] = String(Math.floor(min + Math.random() * (cap - min + 1)));
        })
      );
      return next;
    });
    notify("Demo marks filled in locally (not saved yet). Click Save All Marks to keep them.", "warning");
  };

  // ---------- keyboard / paste ----------
  const focusCell = (r, c) => inputRefs.current[`${r}-${c}`]?.focus();

  const onKeyDown = (e, r, c) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(r + 1, c);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(r - 1, c);
    } else if (e.key === "ArrowRight" && e.target.selectionStart === e.target.value.length) {
      e.preventDefault();
      focusCell(r, c + 1);
    } else if (e.key === "ArrowLeft" && e.target.selectionStart === 0) {
      e.preventDefault();
      focusCell(r, c - 1);
    }
  };

  const onPaste = (e, r, c) => {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const rows = text
      .replace(/\r/g, "")
      .replace(/\n$/, "")
      .split("\n")
      .map((l) => l.split("\t"));
    setValues((prev) => {
      const next = { ...prev };
      rows.forEach((cells, ri) => {
        const student = sheet.students[r + ri];
        if (!student) return;
        cells.forEach((val, ci) => {
          const col = columns[c + ci];
          if (!col) return;
          next[cellKey(student.enrollment_id, col.subject_id, col.paper_id)] = val.trim();
        });
      });
      return next;
    });
  };

  // ---------- save marks ----------
  const save = async () => {
    if (!sheet) return;
    if (invalidCount) {
      notify(`Fix ${invalidCount} invalid cell(s) (shown in red) first.`, "danger");
      return;
    }

    const colByKey = {};
    columns.forEach((c) => (colByKey[`${c.subject_id}:${c.paper_id ?? "single"}`] = c));

    const entries = [];
    dirtyKeys.forEach((k) => {
      const v = (values[k] ?? "").trim();
      if (!v) return;
      const [enrollmentId, subjectId, paper] = k.split(":");
      const col = colByKey[`${subjectId}:${paper}`];
      if (!col) return;
      const absent = isAbsentValue(v);
      entries.push({
        enrollment_id: Number(enrollmentId),
        subject_id: Number(subjectId),
        paper_id: paper === "single" ? null : Number(paper),
        max_marks: col.max,
        marks_obtained: absent ? null : Number(v),
        is_absent: absent,
      });
    });

    if (!entries.length) {
      notify("Nothing new to save.", "info");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const { data } = await academicsApi.saveExamSpreadsheet(classroomId, {
        exam_id: Number(examId),
        entries,
      });
      const errs = data.errors || [];
      const failed = new Set(errs.map((x) => `${x.enrollment_id}:${x.subject_id}`));
      setRowErrors(
        errs.reduce((acc, x) => ({ ...acc, [`${x.enrollment_id}:${x.subject_id}`]: x.error }), {})
      );
      setOriginal((prev) => {
        const next = { ...prev };
        entries.forEach((en) => {
          if (failed.has(`${en.enrollment_id}:${en.subject_id}`)) return;
          const k = cellKey(en.enrollment_id, en.subject_id, en.paper_id);
          next[k] = values[k];
        });
        return next;
      });
      notify(
        errs.length
          ? `${data.saved.length} saved, ${errs.length} failed (see highlighted cells).`
          : `${data.saved.length} mark(s) saved.`,
        errs.length ? "warning" : "success"
      );
    } catch (err) {
      // 207 responses are treated as success by axios; real failures land here
      notify(err.response?.data?.detail || "Could not save marks.", "danger");
    } finally {
      setSaving(false);
    }
  };

  // ---------- paper setup ----------
  const openSetup = (subjectId) => {
    if (!sheet) return;
    if (dirtyKeys.length) {
      notify("Save your marks first, then change the paper setup.", "danger");
      return;
    }
    const sub = sheet.subjects.find((s) => String(s.subject_id) === String(subjectId));
    if (!sub) return;
    setSetupSubjectId(String(subjectId));
    setDraft(sub.paper_setup.map((p) => ({ ...p })));
    setSetupOpen(true);
  };

  const draftSingle = () =>
    setDraft([{ paper_number: 0, name: "Marks", max_marks: draft[0]?.max_marks || 100 }]);

  const draftWithPapers = () =>
    setDraft([
      { paper_number: 1, name: "PP1", max_marks: draft[0]?.max_marks || 100 },
      { paper_number: 2, name: "PP2", max_marks: 100 },
    ]);

  const addDraft = () => {
    const next = Math.max(0, ...draft.map((p) => p.paper_number)) + 1;
    setDraft((d) => [...d, { paper_number: next, name: `PP${next}`, max_marks: 100 }]);
  };

  const editDraft = (i, field, v) =>
    setDraft((d) => d.map((p, idx) => (idx === i ? { ...p, [field]: v } : p)));

  const removeDraft = (i) => setDraft((d) => d.filter((_, idx) => idx !== i));

  const saveSetup = async () => {
    setSavingSetup(true);
    try {
      await examsApi.savePaperSetup({
        exam_id: Number(examId),
        subject_id: Number(setupSubjectId),
        papers: draft.map((p) => ({
          paper_number: p.paper_number,
          name: p.name,
          max_marks: Number(p.max_marks),
        })),
      });
      setSetupOpen(false);
      await loadSheet(true);
      notify("Paper setup saved.", "success");
    } catch (err) {
      notify(err.response?.data?.detail || "Could not save paper setup.", "danger");
    } finally {
      setSavingSetup(false);
    }
  };

  const canLoad = classroomId && examId && !loadingSheet;
  const movedCount = sheet
    ? sheet.students.filter((s) => s.enrollment_status && s.enrollment_status !== "ACTIVE").length
    : 0;

  return (
    <div>
      <div className="page-header">
        <div className="d-flex align-items-center gap-3">
          <div>
            <h1 className="page-title">Mark Entry — All Subjects</h1>
            <p className="page-subtitle mb-0">
              Pick a class and exam (any year, including classes already promoted), set how many papers each
              subject had and what each is out of, then enter marks for every subject at once. Type{" "}
              <strong>A</strong> for absent, leave a cell empty if the student didn't sit that paper, and
              paste a block straight from Excel.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div className={`alert alert-${messageType} alert-dismissible fade show`} role="alert">
          {message}
          <button type="button" className="btn-close" onClick={() => setMessage("")}></button>
        </div>
      )}

      {/* ---------------- SELECTION ---------------- */}
      <div className="card mb-3">
        <div className="card-header d-flex align-items-center gap-2">
          <i className="bi bi-sliders text-brand"></i>
          Select Class &amp; Exam
        </div>
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-6 col-md-2">
              <label className="form-label">Year</label>
              <select
                className="form-select"
                value={year}
                onChange={(e) => { setYear(e.target.value); setGradeId(""); setClassroomId(""); resetSheet(); }}
              >
                <option value="">All</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label">Grade</label>
              <select
                className="form-select"
                value={gradeId}
                onChange={(e) => { setGradeId(e.target.value); setClassroomId(""); resetSheet(); }}
              >
                <option value="">Select...</option>
                {gradesForYear.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label">Stream / Class</label>
              <select
                className="form-select"
                value={classroomId}
                onChange={(e) => { setClassroomId(e.target.value); resetSheet(); }}
              >
                <option value="">Select...</option>
                {classroomsForGrade.map((c) => (
                  <option key={c.id} value={c.id}>{classroomOptionLabel(c)}</option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label">Term</label>
              <select
                className="form-select"
                value={termId}
                onChange={(e) => { setTermId(e.target.value); resetSheet(); }}
                disabled={!selectedClassroom}
              >
                <option value="">{!selectedClassroom ? "Pick a class first..." : "Select..."}</option>
                {terms.map((t) => <option key={t.id} value={t.id}>Term {t.term_number}</option>)}
              </select>
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label">Exam Type</label>
              <select
                className="form-select"
                value={examId}
                onChange={(e) => { setExamId(e.target.value); resetSheet(); }}
                disabled={!termId || examsLoading}
              >
                <option value="">{examsLoading ? "Loading..." : "Select..."}</option>
                {exams.map((ex) => <option key={ex.id} value={ex.id}>{ex.exam_type_name}</option>)}
              </select>
            </div>
          </div>

          {selectedClassroom?.is_promoted && (
            <div className="alert alert-info py-2 mt-3 mb-0">
              <i className="bi bi-clock-history me-1"></i>
              {selectedClassroom.grade_level_name} {selectedClassroom.stream_name} (
              {selectedClassroom.academic_year_year}) was already promoted to{" "}
              <strong>{selectedClassroom.promoted_to_label}</strong>. You can still enter or correct marks
              for its {selectedClassroom.academic_year_year} exams — they stay in {selectedClassroom.academic_year_year}.
            </div>
          )}

          {termId && !examsLoading && exams.length === 0 && (
            <div className="form-text-hint mt-2">
              <i className="bi bi-info-circle me-1"></i>
              No exams set up yet for this grade and term.
            </div>
          )}

          <div className="mt-3 pt-3 border-top d-flex justify-content-end">
            <button className="btn btn-primary" disabled={!canLoad} onClick={() => loadSheet()}>
              {loadingSheet ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                  Loading...
                </>
              ) : (
                <>
                  <i className="bi bi-grid-3x3"></i>
                  Load Spreadsheet
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- LOADING SKELETON ---------------- */}
      {loadingSheet && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title">
              <i className="bi bi-person-lines-fill me-2 text-brand"></i>
              Students
            </span>
            <span className="skeleton skeleton-text" style={{ width: 100 }}></span>
          </div>
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th><div className="skeleton skeleton-text" style={{ width: 80 }}></div></th>
                  <th><div className="skeleton skeleton-text" style={{ width: 120 }}></div></th>
                  <th><div className="skeleton skeleton-text" style={{ width: 100 }}></div></th>
                  <th><div className="skeleton skeleton-text" style={{ width: 80 }}></div></th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td><div className="skeleton skeleton-text" style={{ width: 60 }}></div></td>
                    <td><div className="skeleton skeleton-text" style={{ width: 100 }}></div></td>
                    <td><div className="skeleton skeleton-text" style={{ width: 80 }}></div></td>
                    <td><div className="skeleton skeleton-text" style={{ width: 40 }}></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- EMPTY STATE ---------------- */}
      {sheet && sheet.students.length === 0 && (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-person-x"></i>
            <h6>No students found</h6>
            <p className="text-muted-soft">No students were ever enrolled in this class.</p>
          </div>
        </div>
      )}

      {sheet && (
        <>
          {/* ---------------- STAT CARDS ---------------- */}
          {sheet.students.length > 0 && (
            <div className="stat-grid">
              <div className="dm-card dm-card--primary">
                <div className="dm-card__top">
                  <span className="dm-card__label">Class</span>
                  <span className="dm-card__icon"><i className="bi bi-door-open"></i></span>
                </div>
                <div className="dm-card__num" style={{ fontSize: "1.1rem" }}>{sheet.classroom}</div>
                <div className="dm-card__sub">{sheet.exam}</div>
              </div>
              <div className="dm-card dm-card--info">
                <div className="dm-card__top">
                  <span className="dm-card__label">Students</span>
                  <span className="dm-card__icon"><i className="bi bi-people"></i></span>
                </div>
                <div className="dm-card__num">{sheet.students.length}</div>
                <div className="dm-card__sub">
                  {movedCount > 0 ? `${movedCount} since promoted / moved on` : "In this class"}
                </div>
              </div>
              <div className="dm-card dm-card--warning">
                <div className="dm-card__top">
                  <span className="dm-card__label">Subjects</span>
                  <span className="dm-card__icon"><i className="bi bi-journal-text"></i></span>
                </div>
                <div className="dm-card__num">{sheet.subjects.length}</div>
                <div className="dm-card__sub">
                  {columns.length} mark columns ·{" "}
                  {sheet.subjects.filter((s) => s.configured).length} set up for this exam
                </div>
              </div>
              <div className="dm-card dm-card--success">
                <div className="dm-card__top">
                  <span className="dm-card__label">Entered</span>
                  <span className="dm-card__icon"><i className="bi bi-check-circle"></i></span>
                </div>
                <div className="dm-card__num">
                  {filledCount}
                  <span className="text-muted-soft" style={{ fontSize: "0.9rem" }}> / {totalCells}</span>
                </div>
                <div className="progress-track mt-1">
                  <div className="progress-fill progress-fill--success" style={{ width: `${progressPct}%` }}></div>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- PAPER SETUP PANEL ---------------- */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-sliders2 me-2 text-brand"></i>
                Subject papers &amp; "out of" for this exam
              </span>
              <select
                className="form-select form-select-sm"
                style={{ maxWidth: 280 }}
                value={setupOpen ? setupSubjectId : ""}
                onChange={(e) => e.target.value && openSetup(e.target.value)}
              >
                <option value="">Choose a subject to set up…</option>
                {sheet.subjects.map((s) => (
                  <option key={s.subject_id} value={s.subject_id}>
                    {s.subject_name} {s.configured ? "✓" : ""}
                  </option>
                ))}
              </select>
            </div>

            {!setupOpen && (
              <div className="p-3 form-text-hint">
                <i className="bi bi-info-circle me-1"></i>
                Subjects marked ✓ already have a paper setup for this exam. Subjects without one use the
                default (their usual papers, or a single mark out of 100). You can also click the
                <i className="bi bi-gear mx-1"></i> next to a subject name in the table.
              </div>
            )}

            {setupOpen && (
              <div className="p-3">
                <div className="fw-semibold mb-2">
                  {sheet.subjects.find((s) => String(s.subject_id) === String(setupSubjectId))?.subject_name}
                </div>
                <div className="d-flex gap-2 mb-3">
                  <button className="btn btn-sm btn-outline-secondary" onClick={draftSingle}>
                    Single mark
                  </button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={draftWithPapers}>
                    Papers (PP1, PP2…)
                  </button>
                </div>

                {draft.map((p, i) => (
                  <div className="row g-2 align-items-end mb-2" key={i}>
                    <div className="col-6 col-md-3">
                      <label className="form-label small">Name</label>
                      <input
                        className="form-control form-control-sm"
                        value={p.name}
                        onChange={(e) => editDraft(i, "name", e.target.value)}
                      />
                    </div>
                    <div className="col-4 col-md-2">
                      <label className="form-label small">Out of</label>
                      <input
                        type="number"
                        min="1"
                        className="form-control form-control-sm"
                        value={p.max_marks}
                        onChange={(e) => editDraft(i, "max_marks", e.target.value)}
                      />
                    </div>
                    {p.paper_number !== 0 && draft.length > 1 && (
                      <div className="col-2">
                        <button className="btn btn-sm btn-outline-danger" onClick={() => removeDraft(i)}>
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                <div className="d-flex gap-2 mt-3">
                  {draft[0]?.paper_number !== 0 && (
                    <button className="btn btn-sm btn-outline-primary" onClick={addDraft}>
                      <i className="bi bi-plus-lg me-1"></i>Add Paper
                    </button>
                  )}
                  <button className="btn btn-sm btn-success" onClick={saveSetup} disabled={savingSetup}>
                    {savingSetup ? "Saving..." : "Save setup"}
                  </button>
                  <button className="btn btn-sm btn-light" onClick={() => setSetupOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ---------------- SPREADSHEET ---------------- */}
          {sheet.students.length > 0 && (
            <div className="table-wrap">
              <div className="table-wrap__header">
                <span className="chart-card__title">
                  <i className="bi bi-grid-3x3 me-2 text-brand"></i>
                  {sheet.classroom} — {sheet.exam}
                  <span className="badge badge-neutral ms-2">{sheet.students.length}</span>
                  {sheet.is_promoted && (
                    <span className="badge badge-gold ms-2">
                      Promoted → {sheet.promoted_to_label}
                    </span>
                  )}
                </span>
                <span className="chart-card__subtitle">
                  <i className="bi bi-check-circle me-1 text-success"></i>
                  {filledCount} of {totalCells} entered ({progressPct}%)
                  {dirtyKeys.length > 0 && (
                    <span className="text-gold fw-semibold ms-2">
                      <i className="bi bi-pencil-square me-1"></i>
                      {dirtyKeys.length} unsaved
                    </span>
                  )}
                  {invalidCount > 0 && (
                    <span className="text-owe fw-semibold ms-2">
                      <i className="bi bi-exclamation-triangle me-1"></i>
                      {invalidCount} invalid
                    </span>
                  )}
                </span>
              </div>

              <div className="table-responsive spreadsheet-scroll">
                <table className="table table-hover mb-0 spreadsheet-table">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="spreadsheet-th-sticky-1">Admission No</th>
                      <th rowSpan={2} className="spreadsheet-th-sticky-2">Student</th>
                      {sheet.subjects.map((subj) => (
                        <th
                          key={subj.subject_id}
                          colSpan={subj.columns.length}
                          className="text-center spreadsheet-subject-head"
                          title={subj.subject_name}
                        >
                          <span className="me-1">{subj.subject_code}</span>
                          {subj.configured && (
                            <i className="bi bi-check-circle-fill text-success me-1" title="Paper setup saved for this exam"></i>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary spreadsheet-add-paper"
                            title={`Set papers / "out of" for ${subj.subject_name}`}
                            onClick={() => openSetup(subj.subject_id)}
                          >
                            <i className="bi bi-gear"></i>
                          </button>
                        </th>
                      ))}
                      <th rowSpan={2} className="text-center">Total</th>
                      <th rowSpan={2} className="text-center">Avg %</th>
                    </tr>
                    <tr>
                      {sheet.subjects.map((subj) =>
                        subj.columns.map((col) => (
                          <th
                            key={`${subj.subject_id}-${col.paper_id ?? "single"}`}
                            className="text-center spreadsheet-subhead"
                            title={subj.subject_name}
                          >
                            <div>{col.label}</div>
                            <div className="text-muted-soft" style={{ fontSize: "0.65rem", fontWeight: 500 }}>
                              /{col.max_marks}
                            </div>
                          </th>
                        ))
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.students.map((s, r) => {
                      const st = rowStats(s.enrollment_id);
                      const moved = s.enrollment_status && s.enrollment_status !== "ACTIVE";
                      return (
                        <tr key={s.enrollment_id}>
                          <td className="spreadsheet-td-sticky-1 cell-mono text-brand fw-semibold">
                            {s.admission_no}
                          </td>
                          <td className="spreadsheet-td-sticky-2" title={s.full_name}>
                            <div className="table-avatar-cell">
                              <div className="avatar-sm">
                                {(s.full_name || "").split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("") || "S"}
                              </div>
                              <span className="cell-name">{s.full_name}</span>
                              {moved && (
                                <span
                                  className={`badge ${STATUS_BADGE[s.enrollment_status] || "badge-neutral"} ms-2`}
                                  style={{ fontSize: "0.6rem" }}
                                  title="Status of this student's enrollment in this class"
                                >
                                  {s.enrollment_status_display}
                                </span>
                              )}
                            </div>
                          </td>

                          {columns.map((col, ci) => {
                            const k = cellKey(s.enrollment_id, col.subject_id, col.paper_id);
                            const v = values[k] ?? "";
                            const bad = isInvalid(v, col.max);
                            const serverErr = rowErrors[`${s.enrollment_id}:${col.subject_id}`];
                            const dirty = v !== (original[k] ?? "");
                            const absent = isAbsentValue(v);

                            const cls = [
                              "spreadsheet-input",
                              bad || serverErr ? "is-error" : "",
                              !bad && !serverErr && absent ? "is-absent" : "",
                              !bad && !serverErr && dirty ? "is-dirty" : "",
                            ]
                              .filter(Boolean)
                              .join(" ");

                            return (
                              <td key={k} className="spreadsheet-cell" title={serverErr || undefined}>
                                <input
                                  ref={(el) => (inputRefs.current[`${r}-${ci}`] = el)}
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  spellCheck={false}
                                  className={cls}
                                  value={v}
                                  onChange={(e) => setCell(k, e.target.value)}
                                  onKeyDown={(e) => onKeyDown(e, r, ci)}
                                  onPaste={(e) => onPaste(e, r, ci)}
                                  onFocus={(e) => e.target.select()}
                                />
                              </td>
                            );
                          })}

                          <td className="text-center fw-bold">{st.total || ""}</td>
                          <td className="text-center fw-bold">{st.pct == null ? "" : st.pct.toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="table-wrap__footer">
                <span className="table-wrap__footer-info">
                  <i className="bi bi-info-circle me-1"></i>
                  Type <strong>A</strong> for absent · paste from Excel · <kbd>Enter</kbd> and arrows move
                  between cells · <strong>{dirtyKeys.length}</strong> unsaved
                </span>
                <div className="d-flex gap-2 align-items-center flex-wrap">
                  {isDev && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={seedDemoMarks}
                      title="Fill every empty cell with a random mark (dev only)"
                    >
                      <i className="bi bi-shuffle me-1"></i>
                      Seed Demo Marks
                      <span className="badge badge-gold ms-2" style={{ fontSize: "0.55rem" }}>DEV</span>
                    </button>
                  )}
                  <button className="btn btn-success" disabled={saving || !dirtyKeys.length} onClick={save}>
                    {saving ? (
                      <>
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                        Saving...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check2"></i>
                        Save All Marks
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}