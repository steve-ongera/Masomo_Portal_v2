// src/pages/examofficer/GradingScales.jsx
import { useEffect, useMemo, useState } from "react";
import { gradingApi, academicsApi, calendarApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import Modal from "../../components/Modal";

const list = (r) => r.data.results ?? r.data;

const errText = (e) => {
  const d = e?.response?.data;
  if (!d) return e?.message || "Something went wrong.";
  if (typeof d === "string") return d.slice(0, 300);
  if (d.detail) return d.detail;
  return Object.entries(d)
    .map(
      ([k, v]) =>
        `${k.replaceAll("_", " ")}: ${
          Array.isArray(v) ? v.join(" ") : JSON.stringify(v)
        }`
    )
    .join(" | ");
};

const TEMPLATES = {
  "8-4-4 (12 points)": [
    [80, 100, "A", 12, "Excellent"],
    [75, 79.99, "A-", 11, "Very Good"],
    [70, 74.99, "B+", 10, "Very Good"],
    [65, 69.99, "B", 9, "Good"],
    [60, 64.99, "B-", 8, "Good"],
    [55, 59.99, "C+", 7, "Average"],
    [50, 54.99, "C", 6, "Average"],
    [45, 49.99, "C-", 5, "Below Average"],
    [40, 44.99, "D+", 4, "Below Average"],
    [35, 39.99, "D", 3, "Weak"],
    [30, 34.99, "D-", 2, "Weak"],
    [0, 29.99, "E", 1, "Needs Improvement"],
  ],
  "CBC (4 levels)": [
    [75, 100, "EE", 4, "Exceeding Expectation"],
    [50, 74.99, "ME", 3, "Meeting Expectation"],
    [25, 49.99, "AE", 2, "Approaching Expectation"],
    [0, 24.99, "BE", 1, "Below Expectation"],
  ],
};

const toBands = (rows) =>
  rows.map(
    ([min_percentage, max_percentage, grade_letter, points, remark]) => ({
      min_percentage,
      max_percentage,
      grade_letter,
      points,
      remark,
    })
  );

const blankBand = () => ({
  min_percentage: "",
  max_percentage: "",
  grade_letter: "",
  points: 0,
  remark: "",
});

const blankForm = () => ({
  id: null,
  name: "",
  grade_level: "",
  subject: "",
  curriculum_type: "8-4-4",
  effective_from_term: "",
  notes: "",
  status: "DRAFT",
  version: 1,
  bands: toBands(TEMPLATES["8-4-4 (12 points)"]),
});

function problems(f) {
  const out = [];
  if (!f.name.trim()) out.push("Give the scale a name.");
  if (!f.effective_from_term) out.push("Choose the term it starts from.");

  const b = f.bands.filter(
    (x) =>
      x.grade_letter !== "" ||
      x.min_percentage !== "" ||
      x.max_percentage !== ""
  );
  if (!b.length) return [...out, "Add at least one band."];

  const rows = b.map((x) => ({
    ...x,
    lo: Number(x.min_percentage),
    hi: Number(x.max_percentage),
  }));

  if (
    rows.some(
      (r) =>
        !r.grade_letter.trim() ||
        r.min_percentage === "" ||
        r.max_percentage === "" ||
        r.lo > r.hi
    )
  )
    out.push(
      "Every band needs a letter, a min and a max (min not above max)."
    );

  const sorted = [...rows].sort((a, c) => a.lo - c.lo);
  if (sorted[0].lo !== 0) out.push("The lowest band must start at 0.");
  if (sorted[sorted.length - 1].hi < 100)
    out.push("The highest band must reach 100.");

  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].lo <= sorted[i - 1].hi)
      out.push(
        `${sorted[i - 1].grade_letter} and ${sorted[i].grade_letter} overlap.`
      );

  return out;
}

const STATUS_META = {
  PUBLISHED: {
    badge: "badge-success",
    dot: "status-dot--online",
    label: "Published",
  },
  DRAFT: {
    badge: "badge-neutral",
    dot: "status-dot--offline",
    label: "Draft",
  },
};

export default function GradingScales() {
  const [schemes, setSchemes] = useState([]);
  const [schemesLoading, setSchemesLoading] = useState(true);
  const [grades, setGrades] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [terms, setTerms] = useState([]);
  const [filter, setFilter] = useState({ grade_level: "", subject: "" });

  const [formModal, setFormModal] = useState(null); // form data or null
  const [viewing, setViewing] = useState(null);

  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const locked = formModal?.status === "PUBLISHED";

  const load = async () => {
    setSchemesLoading(true);
    try {
      const params = {};
      if (filter.grade_level) params.grade_level = filter.grade_level;
      if (filter.subject) params.subject = filter.subject;
      setSchemes(list(await gradingApi.list(params)));
    } finally {
      setSchemesLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [g, s, t] = await Promise.all([
          academicsApi.gradeLevels(),
          academicsApi.subjects(),
          calendarApi.terms(),
        ]);
        setGrades(list(g));
        setSubjects(list(s));
        setTerms(list(t));
      } catch (e) {
        setMsg({ type: "danger", text: errText(e) });
      }
    })();
  }, []);

  useEffect(() => {
    load().catch((e) => setMsg({ type: "danger", text: errText(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const hasFilters = !!(filter.grade_level || filter.subject);

  const clearFilters = () => {
    setFilter({ grade_level: "", subject: "" });
  };

  const openView = async (s) => {
    setViewing(s);
    try {
      const { data } = gradingApi.get
        ? await gradingApi.get(s.id)
        : { data: s };
      setViewing(data);
    } catch {
      /* keep the row we already have */
    }
  };

  const openNew = () => {
    setFormModal(blankForm());
    setMsg(null);
  };

  const openEdit = (s) =>
    setFormModal({
      ...s,
      grade_level: s.grade_level ?? "",
      subject: s.subject ?? "",
    });

  const cloneForEdit = async (s) => {
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await gradingApi.clone(s.id);
      await load();
      setFormModal({
        ...data,
        grade_level: data.grade_level ?? "",
        subject: data.subject ?? "",
      });
      setViewing(null);
      setMsg({
        type: "success",
        text: "New version created as a draft. Pick the term it starts from, adjust the bands, then publish.",
      });
    } catch (e) {
      setMsg({ type: "danger", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Grading Scales</h1>
          <p className="page-subtitle">
            A published scale applies from the term you choose. Earlier terms
            keep the grades they already have.
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary btn-sm" onClick={openNew}>
            <i className="bi bi-plus-lg"></i>
            New Scale
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`alert alert-${msg.type} alert-dismissible fade show`}
          role="alert"
        >
          <i
            className={`bi ${
              msg.type === "success"
                ? "bi-check2-circle"
                : "bi-exclamation-triangle"
            } me-1`}
          ></i>
          {msg.text}
          <button
            type="button"
            className="btn-close"
            onClick={() => setMsg(null)}
          ></button>
        </div>
      )}

      {/* ---- Filters ---- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-funnel me-2 text-brand"></i>
            Filters
          </span>
          {hasFilters && (
            <button className="btn btn-sm btn-light" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i>
              Clear
            </button>
          )}
        </div>

        <div className="p-3">
          <div className="row g-3">
            <div className="col-sm-6 col-md-4">
              <label className="form-label">Class</label>
              <select
                className="form-select"
                value={filter.grade_level}
                onChange={(e) =>
                  setFilter({ ...filter, grade_level: e.target.value })
                }
              >
                <option value="">All classes</option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.curriculum_type})
                  </option>
                ))}
              </select>
            </div>

            <div className="col-sm-6 col-md-4">
              <label className="form-label">Subject</label>
              <select
                className="form-select"
                value={filter.subject}
                onChange={(e) =>
                  setFilter({ ...filter, subject: e.target.value })
                }
              >
                <option value="">All subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.curriculum_type})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Scales table ---- */}
      <div className="table-wrap mb-4">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-list-check me-2 text-brand"></i>
            Scales
          </span>
          <span className="chart-card__subtitle mb-0">
            {schemes.length} scale{schemes.length === 1 ? "" : "s"}
          </span>
        </div>

        {schemesLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : schemes.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-mortarboard"></i>
            <h6>No custom scales yet</h6>
            <p className="text-muted-soft">
              Classes keep using the school's existing grading until you
              publish one.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Applies To</th>
                  <th>Name</th>
                  <th style={{ width: "200px" }}>Starts</th>
                  <th style={{ width: "140px" }}>Status</th>
                  <th style={{ width: "220px" }} className="text-end">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {schemes.map((s) => {
                  const meta = STATUS_META[s.status] || STATUS_META.DRAFT;
                  return (
                    <tr key={s.id}>
                      <td>
                        <span className="cell-name">{s.scope_label}</span>
                      </td>

                      <td>
                        <span className="cell-name">{s.name}</span>
                        <span className="text-muted-soft ms-1">
                          v{s.version}
                        </span>
                      </td>

                      <td>
                        <i className="bi bi-calendar3 me-1 text-muted-soft"></i>
                        {s.term_label}
                      </td>

                      <td>
                        <span className={`badge ${meta.badge}`}>
                          <span className={`status-dot ${meta.dot}`}></span>
                          {meta.label}
                        </span>
                      </td>

                      <td className="text-end">
                        <div className="table-actions justify-content-end">
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => openView(s)}
                          >
                            <i className="bi bi-eye me-1"></i>
                            View
                          </button>

                          {s.status === "PUBLISHED" ? (
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              disabled={busy}
                              onClick={() => cloneForEdit(s)}
                            >
                              <i className="bi bi-copy me-1"></i>
                              New Version
                            </button>
                          ) : (
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => openEdit(s)}
                            >
                              <i className="bi bi-pencil me-1"></i>
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!schemesLoading && schemes.length > 0 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              <strong>{schemes.length}</strong> scale
              {schemes.length === 1 ? "" : "s"}
              {hasFilters ? " matching your filters" : ""}
            </span>
            <span className="text-muted-soft">
              Published scales are locked; clone to change them
            </span>
          </div>
        )}
      </div>

      {/* ==================== VIEW MODAL ==================== */}
      <Modal
        show={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.name} (v${viewing.version})` : "Scale"}
        size="lg"
      >
        {viewing && <ViewScale scale={viewing} />}
      </Modal>

      {/* ==================== CREATE / EDIT MODAL ==================== */}
      <Modal
        show={!!formModal}
        onClose={() => setFormModal(null)}
        title={
          formModal
            ? formModal.id
              ? `${formModal.name} (v${formModal.version})`
              : "New Scale"
            : ""
        }
        size="lg"
      >
        {formModal && (
          <ScaleForm
            form={formModal}
            setFormModal={setFormModal}
            grades={grades}
            subjects={subjects}
            terms={terms}
            today={today}
            locked={locked}
            busy={busy}
            setBusy={setBusy}
            setMsg={setMsg}
            onSaved={() => {
              load();
              setFormModal(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ==========================================================================
   SCALE FORM — shared create/edit form (used inside the create/edit modal)
   ========================================================================== */

function ScaleForm({
  form,
  setFormModal,
  grades,
  subjects,
  terms,
  today,
  locked,
  busy,
  setBusy,
  setMsg,
  onSaved,
}) {
  const [testPct, setTestPct] = useState("");

  const grade = grades.find(
    (g) => String(g.id) === String(form.grade_level)
  );
  const curriculum = grade ? grade.curriculum_type : form.curriculum_type;
  const subjectOptions = subjects.filter(
    (s) => s.curriculum_type === curriculum
  );
  const openTerms = terms.filter((t) => t.end_date >= today);
  const termLabel = (t) =>
    `Term ${t.term_number} ${t.academic_year_label ?? ""}`.trim();

  const issues = useMemo(() => problems(form), [form]);

  const tester = useMemo(() => {
    if (testPct === "" || issues.length) return null;
    const p = Number(testPct);
    return [...form.bands]
      .sort((a, b) => Number(b.min_percentage) - Number(a.min_percentage))
      .find((b) => p >= Number(b.min_percentage));
  }, [form, testPct, issues]);

  const set = (patch) => setFormModal((f) => ({ ...f, ...patch }));
  const setBand = (i, patch) =>
    set({
      bands: form.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    });

  const payload = () => ({
    name: form.name.trim(),
    curriculum_type: curriculum,
    grade_level: form.grade_level || null,
    subject: form.subject || null,
    effective_from_term: form.effective_from_term,
    notes: form.notes,
    bands: form.bands
      .filter((b) => b.grade_letter !== "")
      .map((b) => ({
        ...b,
        points: b.points === "" ? 0 : b.points,
      })),
  });

  const save = async () => {
    const { data } = form.id
      ? await gradingApi.update(form.id, payload())
      : await gradingApi.create(payload());
    return data;
  };

  const run = async (fn, okText) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ type: "success", text: okText });
    } catch (e) {
      setMsg({ type: "danger", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {locked && (
        <div className="alert alert-primary d-flex align-items-start gap-2">
          <i className="bi bi-lock mt-1"></i>
          <span>
            This scale is published and can't be edited. Use{" "}
            <strong>New Version</strong> to change it from a later term.
          </span>
        </div>
      )}

      <fieldset disabled={locked} style={{ border: 0, padding: 0 }}>
        <h6 className="settings-section__title mb-2">Details</h6>
        <div className="row g-3">
          <div className="col-md-4">
            <label className="form-label">Name</label>
            <input
              className="form-control"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>

          <div className="col-md-3">
            <label className="form-label">Class</label>
            <select
              className="form-select"
              value={form.grade_level}
              onChange={(e) =>
                set({ grade_level: e.target.value, subject: "" })
              }
            >
              <option value="">Every class</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.curriculum_type})
                </option>
              ))}
            </select>
          </div>

          {!grade && (
            <div className="col-md-2">
              <label className="form-label">Curriculum</label>
              <select
                className="form-select"
                value={form.curriculum_type}
                onChange={(e) =>
                  set({ curriculum_type: e.target.value, subject: "" })
                }
              >
                <option value="8-4-4">8-4-4</option>
                <option value="CBC">CBC</option>
              </select>
            </div>
          )}

          <div className="col-md-3">
            <label className="form-label">Subject</label>
            <select
              className="form-select"
              value={form.subject}
              onChange={(e) => set({ subject: e.target.value })}
            >
              <option value="">Every subject</option>
              {subjectOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label">Starts From</label>
            <select
              className="form-select"
              value={form.effective_from_term}
              onChange={(e) => set({ effective_from_term: e.target.value })}
            >
              <option value="">Choose a term</option>
              {openTerms.map((t) => (
                <option key={t.id} value={t.id}>
                  {termLabel(t)}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-9">
            <label className="form-label">Notes</label>
            <input
              className="form-control"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </div>

        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-4 mb-2 pt-3 border-top">
          <span className="section-label">Grade Bands</span>
          <div className="d-flex flex-wrap gap-1">
            {Object.keys(TEMPLATES).map((k) => (
              <button
                key={k}
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => set({ bands: toBands(TEMPLATES[k]) })}
              >
                <i className="bi bi-magic me-1"></i>
                Start from {k}
              </button>
            ))}
          </div>
        </div>

        <div className="table-responsive">
          <table className="table table-sm align-middle mb-2">
            <thead>
              <tr>
                <th style={{ width: "110px" }}>From %</th>
                <th style={{ width: "110px" }}>To %</th>
                <th style={{ width: "110px" }}>Grade</th>
                <th style={{ width: "100px" }}>Points</th>
                <th>Remark</th>
                <th style={{ width: "100px" }} className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {form.bands.map((b, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control form-control-sm"
                      value={b.min_percentage}
                      onChange={(e) =>
                        setBand(i, { min_percentage: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control form-control-sm"
                      value={b.max_percentage}
                      onChange={(e) =>
                        setBand(i, { max_percentage: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="form-control form-control-sm"
                      value={b.grade_letter}
                      onChange={(e) =>
                        setBand(i, { grade_letter: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control form-control-sm"
                      value={b.points}
                      onChange={(e) =>
                        setBand(i, { points: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="form-control form-control-sm"
                      value={b.remark}
                      onChange={(e) =>
                        setBand(i, { remark: e.target.value })
                      }
                    />
                  </td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger btn-icon"
                      title="Remove band"
                      aria-label="Remove band"
                      onClick={() =>
                        set({
                          bands: form.bands.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <i className="bi bi-trash"></i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          onClick={() => set({ bands: [...form.bands, blankBand()] })}
        >
          <i className="bi bi-plus-lg me-1"></i>
          Add Band
        </button>
      </fieldset>

      {issues.length > 0 && !locked && (
        <div className="alert alert-danger mt-3 mb-0" role="alert">
          <div className="d-flex align-items-center gap-2 mb-2 fw-bold">
            <i className="bi bi-exclamation-triangle"></i>
            Fix {issues.length} issue{issues.length === 1 ? "" : "s"} before
            saving
          </div>
          <ul className="mb-0 small" style={{ paddingLeft: "1.2rem" }}>
            {issues.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="row g-3 align-items-end mt-4 pt-3 border-top">
        <div className="col-sm-6 col-md-3">
          <label className="form-label">Try a Score</label>
          <input
            type="number"
            className="form-control"
            value={testPct}
            onChange={(e) => setTestPct(e.target.value)}
            placeholder="e.g. 67"
          />
        </div>

        <div className="col-sm-6 col-md-3">
          {tester && (
            <div className="note-card justify-content-center flex-column text-center p-2 mb-0 mt-0">
              <div className="fw-bold" style={{ fontSize: "var(--fs-lg)", color: "var(--blue-800)", lineHeight: 1.1 }}>
                {tester.grade_letter}
              </div>
              <div className="small" style={{ color: "var(--blue-800)", marginTop: 2 }}>
                {tester.points} pts · {tester.remark}
              </div>
            </div>
          )}
        </div>

        {!locked && (
          <div className="col-md-6 d-flex flex-wrap gap-2 justify-content-md-end">
            {form.id && (
              <button
                className="btn btn-outline-danger"
                disabled={busy}
                onClick={() =>
                  window.confirm("Delete this draft?") &&
                  run(async () => {
                    await gradingApi.remove(form.id);
                    setFormModal(null);
                    onSaved();
                  }, "Draft deleted.")
                }
              >
                <i className="bi bi-trash me-1"></i>
                Delete Draft
              </button>
            )}
            <button
              className="btn btn-outline-primary"
              disabled={busy || issues.length > 0}
              onClick={() =>
                run(async () => {
                  await save();
                  onSaved();
                }, "Draft saved.")
              }
            >
              <i className="bi bi-save me-1"></i>
              Save Draft
            </button>
            <button
              className="btn btn-success"
              disabled={busy || issues.length > 0}
              onClick={() => {
                if (
                  !window.confirm(
                    "Publish this scale? It can't be edited afterwards, and it applies from the chosen term onward. Earlier terms keep their grades."
                  )
                )
                  return;
                run(async () => {
                  const d = await save();
                  await gradingApi.publish(d.id);
                  onSaved();
                }, "Scale published.");
              }}
            >
              <i className="bi bi-send me-1"></i>
              Publish
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   VIEW SCALE — read-only presentation of a scale (used inside the view modal)
   ========================================================================== */

function ViewScale({ scale }) {
  const meta = STATUS_META[scale.status] || STATUS_META.DRAFT;
  const bands = scale.bands || [];
  const sorted = [...bands].sort(
    (a, b) => Number(b.min_percentage) - Number(a.min_percentage)
  );

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <span className={`badge ${meta.badge}`}>
          <span className={`status-dot ${meta.dot}`}></span>
          {meta.label}
        </span>
        <span className="badge badge-neutral">v{scale.version}</span>
        {scale.scope_label && (
          <span className="badge badge-blue">{scale.scope_label}</span>
        )}
      </div>

      <div className="row g-3 mb-3">
        <div className="col-sm-6">
          <div className="profile-info-row">
            <span>Starts From</span>
            <span>
              <i className="bi bi-calendar3 me-1 text-muted-soft"></i>
              {scale.term_label || "—"}
            </span>
          </div>
        </div>

        <div className="col-sm-6">
          <div className="profile-info-row">
            <span>Curriculum</span>
            <span>
              <i className="bi bi-mortarboard me-1 text-muted-soft"></i>
              {scale.curriculum_type || "—"}
            </span>
          </div>
        </div>

        {scale.notes && (
          <div className="col-12">
            <div className="section-label mb-1">Notes</div>
            <div className="text-muted-soft" style={{ whiteSpace: "pre-wrap", fontSize: "var(--fs-sm)" }}>
              {scale.notes}
            </div>
          </div>
        )}
      </div>

      <div className="section-label mb-2">Grade Bands</div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-list-check"></i>
          <h6>No bands defined</h6>
          <p className="text-muted-soft">
            This scale has no grading bands attached.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th style={{ width: "140px" }}>Range</th>
                <th style={{ width: "110px" }}>Grade</th>
                <th className="text-end" style={{ width: "100px" }}>
                  Points
                </th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b, i) => (
                <tr key={i}>
                  <td className="cell-mono">
                    {b.min_percentage}% – {b.max_percentage}%
                  </td>
                  <td>
                    <span className="badge badge-blue" style={{ minWidth: "44px" }}>
                      {b.grade_letter}
                    </span>
                  </td>
                  <td className="text-end">
                    <span className="fw-bold">{b.points}</span>
                  </td>
                  <td>
                    {b.remark || <span className="cell-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scale.status === "PUBLISHED" && (
        <div className="note-card mt-3 mb-0">
          <i className="bi bi-lock"></i>
          <span>
            This scale is published and can't be edited. Use{" "}
            <strong>New Version</strong> to create a change from a later term.
          </span>
        </div>
      )}
    </div>
  );
}