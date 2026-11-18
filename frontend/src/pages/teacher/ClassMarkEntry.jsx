import { useEffect, useMemo, useRef, useState } from "react";
import { academicsApi, calendarApi, examsApi, teacherApi } from "../../services/api";

const list = (r) => r.data.results ?? r.data;
const cellKey = (enrollmentId, subjectId, paperId) =>
  `${enrollmentId}:${subjectId}:${paperId ?? "single"}`;

const seedRandomMarks = (prevValues, students, columns) => {
  const next = { ...prevValues };
  students.forEach((s) => {
    columns.forEach((c) => {
      const k = cellKey(s.enrollment_id, c.subject_id, c.paper_id);
      const existing = (next[k] ?? "").trim();
      if (existing) return;

      if (Math.random() < 0.05) {
        next[k] = "A";
        return;
      }

      const min = Math.floor(c.max * 0.4);
      const max = c.max;
      const raw = min + Math.random() * (max - min);
      const step = Number.isInteger(c.max) ? 1 : 0.5;
      const rounded = Math.round(raw / step) * step;
      next[k] = String(rounded);
    });
  });
  return next;
};

export default function ClassMarkEntry() {
  const [years, setYears] = useState([]);
  const [myClasses, setMyClasses] = useState([]);
  const [terms, setTerms] = useState([]);
  const [exams, setExams] = useState([]);

  const [yearId, setYearId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [termId, setTermId] = useState("");
  const [examId, setExamId] = useState("");

  const [sheet, setSheet] = useState(null);
  const [values, setValues] = useState({});
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  // Per-exam paper setup (PP1 / PP2 ... and what each is out of)
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupSubjectId, setSetupSubjectId] = useState("");
  const [draft, setDraft] = useState([]);
  const [savingSetup, setSavingSetup] = useState(false);

  const inputRefs = useRef({});

  const isDev = import.meta.env.DEV;

  useEffect(() => {
    (async () => {
      try {
        const [y, c] = await Promise.all([
          calendarApi.academicYears(),
          teacherApi.myClassTeacherClassrooms(),
        ]);
        const yl = list(y);
        setYears(yl);
        setMyClasses(list(c));
        const cur = yl.find((a) => a.is_current) || yl[0];
        if (cur) setYearId(String(cur.id));
      } catch {
        setMsg({ type: "error", text: "Could not load your classes." });
      }
    })();
  }, []);

  const classesForYear = useMemo(
    () => myClasses.filter((c) => String(c.academic_year) === String(yearId)),
    [myClasses, yearId]
  );

  const classroom = useMemo(
    () => myClasses.find((c) => String(c.id) === String(classroomId)),
    [myClasses, classroomId]
  );

  useEffect(() => {
    setClassroomId("");
    setTermId("");
    setExamId("");
    setSheet(null);
    setSetupOpen(false);
    if (!yearId) return;
    calendarApi.terms({ academic_year: yearId }).then((r) => {
      const tl = list(r);
      setTerms(tl);
      const cur = tl.find((t) => t.is_current);
      if (cur) setTermId(String(cur.id));
    });
  }, [yearId]);

  useEffect(() => {
    setExamId("");
    setSheet(null);
    setSetupOpen(false);
    if (!termId || !classroom) {
      setExams([]);
      return;
    }
    examsApi
      .exams({ term: termId, grade_level: classroom.grade_level, page_size: 100 })
      .then((r) => setExams(list(r)))
      .catch(() => setExams([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId, classroomId]);

  const columns = useMemo(() => {
    if (!sheet) return [];
    return sheet.subjects.flatMap((s) =>
      s.columns.map((c) => ({
        subject_id: s.subject_id,
        subject_code: s.subject_code,
        subject_name: s.subject_name,
        paper_id: c.paper_id,
        label: c.label,
        max: c.max_marks,
      }))
    );
  }, [sheet]);

  const dirtyKeys = useMemo(
    () => Object.keys(values).filter((k) => (values[k] ?? "") !== (original[k] ?? "")),
    [values, original]
  );

  const isInvalid = (raw, max) => {
    const v = (raw ?? "").trim();
    if (!v || /^a(bs)?$/i.test(v)) return false;
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

  // skipConfirm = true is used right after saving a paper setup (nothing unsaved at that point)
  const load = async (skipConfirm = false) => {
    if (!skipConfirm && dirtyKeys.length && !window.confirm("You have unsaved marks. Discard them and reload?"))
      return;
    setLoading(true);
    setMsg(null);
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
    } catch (e) {
      setSheet(null);
      setMsg({
        type: "error",
        text: e.response?.data?.detail || "Could not load the mark sheet.",
      });
    } finally {
      setLoading(false);
    }
  };

  const setCell = (key, val) => setValues((p) => ({ ...p, [key]: val }));

  const handleSeedRandom = () => {
    if (!sheet || columns.length === 0) return;
    setValues((prev) => seedRandomMarks(prev, sheet.students, columns));
    setMsg({
      type: "info",
      text: "Random marks seeded into empty cells (dev only).",
    });
  };

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

  const rowStats = (enrollmentId) => {
    let total = 0,
      max = 0;
    columns.forEach((c) => {
      const v = (values[cellKey(enrollmentId, c.subject_id, c.paper_id)] ?? "").trim();
      if (!v || /^a(bs)?$/i.test(v) || Number.isNaN(Number(v))) return;
      total += Number(v);
      max += c.max;
    });
    return { total, pct: max ? (total / max) * 100 : null };
  };

  const save = async () => {
    if (invalidCount) {
      setMsg({
        type: "error",
        text: `Fix ${invalidCount} invalid cell(s) (shown in red) first.`,
      });
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
      const absent = /^a(bs)?$/i.test(v);
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
      setMsg({ type: "info", text: "Nothing new to save." });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const { data } = await academicsApi.saveExamSpreadsheet(classroomId, {
        exam_id: Number(examId),
        entries,
      });
      const errs = data.errors || [];
      const failed = new Set(errs.map((x) => `${x.enrollment_id}:${x.subject_id}`));
      setRowErrors(
        errs.reduce(
          (acc, x) => ({ ...acc, [`${x.enrollment_id}:${x.subject_id}`]: x.error }),
          {}
        )
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
      setMsg(
        errs.length
          ? {
              type: "error",
              text: `${data.saved.length} saved, ${errs.length} failed (see highlighted cells).`,
            }
          : { type: "success", text: `${data.saved.length} mark(s) saved.` }
      );
    } catch (e) {
      setMsg({
        type: "error",
        text: e.response?.data?.detail || "Save failed.",
      });
    } finally {
      setSaving(false);
    }
  };

  // ---------- paper setup ----------
  const openSetup = (subjectId) => {
    if (dirtyKeys.length) {
      setMsg({ type: "error", text: "Save your marks first, then change the paper setup." });
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
      await load(true); // reload the sheet with the new columns
      setMsg({ type: "success", text: "Paper setup saved." });
    } catch (e) {
      setMsg({ type: "error", text: e.response?.data?.detail || "Could not save paper setup." });
    } finally {
      setSavingSetup(false);
    }
  };

  const canLoad = classroomId && examId && !loading;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Class Mark Entry</h1>
          <p className="page-subtitle">
            Enter marks for every subject for the class you are class teacher of. Type{" "}
            <strong>A</strong> for absent — you can paste a block straight from Excel.
          </p>
        </div>

        {isDev && (
          <div className="page-header__actions">
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={handleSeedRandom}
              disabled={!sheet || columns.length === 0}
              title="Fill every empty cell with a random mark (dev only)"
            >
              <i className="bi bi-shuffle"></i>
              Seed Random Marks
              <span className="badge badge-gold ms-2" style={{ fontSize: "0.55rem" }}>
                DEV
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Load panel */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-sliders me-2 text-brand"></i>
            Load a Mark Sheet
          </span>
          <span className="chart-card__subtitle mb-0">
            Year · Class · Term · Exam
          </span>
        </div>

        <div className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-sm-6 col-lg-3">
              <label className="form-label">Academic Year</label>
              <select
                className="form-select"
                value={yearId}
                onChange={(e) => setYearId(e.target.value)}
              >
                <option value="">Select year</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.year}
                    {y.is_current ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-sm-6 col-lg-3">
              <label className="form-label">My Class</label>
              <select
                className="form-select"
                value={classroomId}
                onChange={(e) => setClassroomId(e.target.value)}
                disabled={!yearId}
              >
                <option value="">
                  {classesForYear.length ? "Select class" : "No class assigned this year"}
                </option>
                {classesForYear.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.grade_level_name} {c.stream_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-sm-6 col-lg-2">
              <label className="form-label">Term</label>
              <select
                className="form-select"
                value={termId}
                onChange={(e) => setTermId(e.target.value)}
                disabled={!yearId}
              >
                <option value="">Select term</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    Term {t.term_number}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-sm-6 col-lg-2">
              <label className="form-label">Exam</label>
              <select
                className="form-select"
                value={examId}
                onChange={(e) => {
                  setExamId(e.target.value);
                  setSheet(null);
                  setSetupOpen(false);
                }}
                disabled={!termId || !classroomId}
              >
                <option value="">
                  {exams.length || !termId || !classroomId ? "Select exam" : "No exams scheduled"}
                </option>
                {exams.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} — {x.exam_type_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-sm-6 col-lg-2">
              <button className="btn btn-primary w-100" onClick={() => load()} disabled={!canLoad}>
                {loading ? (
                  "Loading..."
                ) : (
                  <>
                    <i className="bi bi-people me-1"></i>
                    Load Students
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div
          className={`alert alert-${
            msg.type === "success" ? "success" : msg.type === "error" ? "danger" : "primary"
          } alert-dismissible fade show`}
          role="status"
        >
          <i
            className={`bi ${
              msg.type === "success"
                ? "bi-check2-circle"
                : msg.type === "error"
                ? "bi-exclamation-triangle"
                : "bi-info-circle"
            } me-1`}
          ></i>
          {msg.text}
          <button type="button" className="btn-close" onClick={() => setMsg(null)}></button>
        </div>
      )}

      {/* Paper setup panel */}
      {sheet && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-sliders me-2 text-brand"></i>
              Subject papers &amp; "out of" for this exam
            </span>
            <select
              className="form-select form-select-sm"
              style={{ maxWidth: 260 }}
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

          {setupOpen && (
            <div className="p-3">
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
      )}

      {sheet && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <div>
              <div className="chart-card__title mb-0">
                <i className="bi bi-table me-2 text-brand"></i>
                {sheet.classroom} · {sheet.exam}
              </div>
              <div className="chart-card__subtitle mb-0">
                {sheet.students.length} student{sheet.students.length === 1 ? "" : "s"} ·{" "}
                {columns.length} column{columns.length === 1 ? "" : "s"}
                {dirtyKeys.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-gold fw-semibold">
                      <i className="bi bi-pencil-square me-1"></i>
                      {dirtyKeys.length} unsaved
                    </span>
                  </>
                )}
                {invalidCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-owe fw-semibold">
                      <i className="bi bi-exclamation-triangle me-1"></i>
                      {invalidCount} invalid
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="d-flex gap-2 align-items-center">
              {isDev && (
                <button
                  className="btn btn-sm btn-outline-secondary"
                  onClick={handleSeedRandom}
                  title="Fill every empty cell with a random mark (dev only)"
                >
                  <i className="bi bi-shuffle me-1"></i>
                  Seed Random
                  <span className="badge badge-gold ms-2" style={{ fontSize: "0.55rem" }}>
                    DEV
                  </span>
                </button>
              )}

              <button
                className="btn btn-success"
                onClick={save}
                disabled={saving || !dirtyKeys.length}
              >
                {saving ? (
                  "Saving..."
                ) : (
                  <>
                    <i className="bi bi-check2 me-1"></i>
                    Save Marks
                  </>
                )}
              </button>
            </div>
          </div>

          <div style={{ maxHeight: "70vh", overflow: "auto", position: "relative" }}>
            <table
              className="table mb-0"
              style={{
                borderCollapse: "separate",
                borderSpacing: 0,
                fontSize: "var(--fs-xs)",
                width: "max-content",
                minWidth: "100%",
              }}
            >
              <thead style={{ position: "sticky", top: 0, zIndex: 20 }}>
                <tr>
                  <th
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 30,
                      minWidth: 40,
                      background: "var(--blue-50)",
                      color: "var(--blue-800)",
                      borderBottom: "1px solid var(--border-color)",
                      borderRight: "1px solid var(--border-color)",
                      padding: "0.55rem 0.5rem",
                      textAlign: "center",
                      fontSize: "var(--fs-xs)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    #
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      left: 40,
                      zIndex: 30,
                      minWidth: 90,
                      background: "var(--blue-50)",
                      color: "var(--blue-800)",
                      borderBottom: "1px solid var(--border-color)",
                      borderRight: "1px solid var(--border-color)",
                      padding: "0.55rem 0.6rem",
                      textAlign: "left",
                      fontSize: "var(--fs-xs)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Adm No
                  </th>
                  <th
                    style={{
                      position: "sticky",
                      left: 130,
                      zIndex: 30,
                      minWidth: 200,
                      background: "var(--blue-50)",
                      color: "var(--blue-800)",
                      borderBottom: "1px solid var(--border-color)",
                      borderRight: "1px solid var(--border-color)",
                      padding: "0.55rem 0.6rem",
                      textAlign: "left",
                      fontSize: "var(--fs-xs)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Student
                  </th>

                  {columns.map((c) => (
                    <th
                      key={`${c.subject_id}-${c.paper_id}`}
                      title={`${c.subject_name} — ${c.label}`}
                      style={{
                        minWidth: 78,
                        background: "var(--blue-50)",
                        color: "var(--blue-800)",
                        borderBottom: "1px solid var(--border-color)",
                        borderRight: "1px solid var(--border-color)",
                        padding: "0.5rem 0.4rem",
                        textAlign: "center",
                        fontSize: "var(--fs-xs)",
                        fontWeight: 700,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: "var(--fs-xs)",
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                        }}
                      >
                        {c.label}
                      </div>
                      <div
                        style={{
                          fontSize: "0.6rem",
                          color: "var(--ink-400)",
                          fontWeight: 500,
                          marginTop: "2px",
                        }}
                      >
                        /{c.max}
                      </div>
                    </th>
                  ))}

                  <th
                    style={{
                      minWidth: 70,
                      background: "var(--ink-100)",
                      color: "var(--ink-700)",
                      borderBottom: "1px solid var(--border-color)",
                      borderRight: "1px solid var(--border-color)",
                      padding: "0.55rem 0.4rem",
                      textAlign: "center",
                      fontSize: "var(--fs-xs)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      fontWeight: 700,
                    }}
                  >
                    Total
                  </th>
                  <th
                    style={{
                      minWidth: 70,
                      background: "var(--ink-100)",
                      color: "var(--ink-700)",
                      borderBottom: "1px solid var(--border-color)",
                      padding: "0.55rem 0.4rem",
                      textAlign: "center",
                      fontSize: "var(--fs-xs)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      fontWeight: 700,
                    }}
                  >
                    Avg %
                  </th>
                </tr>
              </thead>

              <tbody>
                {sheet.students.map((s, r) => {
                  const st = rowStats(s.enrollment_id);
                  const rowBg = r % 2 === 0 ? "var(--surface)" : "var(--bg-app)";
                  return (
                    <tr key={s.enrollment_id}>
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          zIndex: 10,
                          minWidth: 40,
                          background: rowBg,
                          borderBottom: "1px solid var(--border-color)",
                          borderRight: "1px solid var(--border-color)",
                          padding: "0.4rem 0.5rem",
                          textAlign: "center",
                          color: "var(--ink-400)",
                          fontSize: "var(--fs-xs)",
                        }}
                      >
                        {r + 1}
                      </td>

                      <td
                        style={{
                          position: "sticky",
                          left: 40,
                          zIndex: 10,
                          minWidth: 90,
                          background: rowBg,
                          borderBottom: "1px solid var(--border-color)",
                          borderRight: "1px solid var(--border-color)",
                          padding: "0.4rem 0.6rem",
                          fontWeight: 600,
                          color: "var(--blue-700)",
                          fontSize: "var(--fs-xs)",
                        }}
                      >
                        {s.admission_no}
                      </td>

                      <td
                        style={{
                          position: "sticky",
                          left: 130,
                          zIndex: 10,
                          minWidth: 200,
                          background: rowBg,
                          borderBottom: "1px solid var(--border-color)",
                          borderRight: "1px solid var(--border-color)",
                          padding: "0.4rem 0.6rem",
                          fontWeight: 600,
                          color: "var(--ink-900)",
                          fontSize: "var(--fs-xs)",
                        }}
                      >
                        {s.full_name}
                      </td>

                      {columns.map((c, ci) => {
                        const k = cellKey(s.enrollment_id, c.subject_id, c.paper_id);
                        const v = values[k] ?? "";
                        const bad = isInvalid(v, c.max);
                        const dirty = v !== (original[k] ?? "");
                        const serverErr = rowErrors[`${s.enrollment_id}:${c.subject_id}`];
                        const absent = /^a(bs)?$/i.test(v);

                        const bg =
                          bad || serverErr
                            ? "var(--danger-100)"
                            : absent
                            ? "var(--ink-100)"
                            : dirty
                            ? "var(--gold-100)"
                            : "var(--surface)";
                        const fg =
                          bad || serverErr
                            ? "var(--danger-600)"
                            : absent
                            ? "var(--ink-600)"
                            : "var(--ink-900)";

                        return (
                          <td
                            key={k}
                            title={serverErr || undefined}
                            style={{
                              padding: 0,
                              borderBottom: "1px solid var(--border-color)",
                              borderRight: "1px solid var(--border-color)",
                            }}
                          >
                            <input
                              ref={(el) => (inputRefs.current[`${r}-${ci}`] = el)}
                              value={v}
                              onChange={(e) => setCell(k, e.target.value)}
                              onKeyDown={(e) => onKeyDown(e, r, ci)}
                              onPaste={(e) => onPaste(e, r, ci)}
                              onFocus={(e) => e.target.select()}
                              inputMode="decimal"
                              style={{
                                height: 36,
                                width: "100%",
                                minWidth: 78,
                                padding: "0 0.4rem",
                                textAlign: "center",
                                border: "none",
                                outline: "none",
                                background: bg,
                                color: fg,
                                fontSize: "var(--fs-xs)",
                                fontWeight: dirty ? 600 : 500,
                                fontFamily: "var(--font-body)",
                              }}
                            />
                          </td>
                        );
                      })}

                      <td
                        style={{
                          minWidth: 70,
                          background: "var(--bg-app)",
                          borderBottom: "1px solid var(--border-color)",
                          borderRight: "1px solid var(--border-color)",
                          padding: "0.4rem",
                          textAlign: "center",
                          fontWeight: 700,
                          color: "var(--ink-900)",
                          fontSize: "var(--fs-xs)",
                        }}
                      >
                        {st.total || ""}
                      </td>

                      <td
                        style={{
                          minWidth: 70,
                          background: "var(--bg-app)",
                          borderBottom: "1px solid var(--border-color)",
                          padding: "0.4rem",
                          textAlign: "center",
                          fontWeight: 700,
                          color: "var(--ink-900)",
                          fontSize: "var(--fs-xs)",
                        }}
                      >
                        {st.pct == null ? "" : st.pct.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!sheet.students.length && (
            <div className="empty-state">
              <i className="bi bi-people"></i>
              <h6>No active students in this class</h6>
              <p className="text-muted-soft">Once students are enrolled, they'll appear here.</p>
            </div>
          )}

          {sheet.students.length > 0 && (
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <i className="bi bi-info-circle me-1"></i>
                Type <strong>A</strong> for absent · paste a block straight from Excel ·{" "}
                <kbd>Enter</kbd> and arrows move between cells
              </span>
              <div className="d-flex align-items-center gap-2">
                {dirtyKeys.length > 0 && (
                  <span className="form-text-hint text-gold fw-semibold m-0">
                    {dirtyKeys.length} unsaved
                  </span>
                )}
                <button
                  className="btn btn-sm btn-success"
                  onClick={save}
                  disabled={saving || !dirtyKeys.length}
                >
                  {saving ? (
                    "Saving..."
                  ) : (
                    <>
                      <i className="bi bi-check2 me-1"></i>
                      Save Marks
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}