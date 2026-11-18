import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { lessonPlanningApi } from "../../../services/api";
import { Progress, ReviewBanner, StatusBadge, errMsg, isLocked, unwrap } from "./shared";

const blankRow = (week = 1) => ({
  _key: `new-${Math.random().toString(36).slice(2)}`,
  week_number: week,
  lesson_number: 1,
  topic: "",
  topic_text: "",
  subtopic_text: "",
  objectives: "",
  activities: "",
  resources: "",
  assessment: "",
  remarks: "",
});

const fromServer = (e) => ({ ...e, _key: `e-${e.id}`, topic: e.topic ?? "" });

const toPayload = (r) => ({
  ...(r.id ? { id: r.id } : {}),
  week_number: Number(r.week_number),
  lesson_number: Number(r.lesson_number) || 1,
  topic: r.topic ? Number(r.topic) : null,
  topic_text: r.topic_text,
  subtopic_text: r.subtopic_text,
  objectives: r.objectives,
  activities: r.activities,
  resources: r.resources,
  assessment: r.assessment,
  remarks: r.remarks,
});

const WEEK_SECTIONS = [
  ["objectives", "Learning Objectives"],
  ["activities", "Teaching Activities"],
  ["resources", "Learning Resources"],
  ["assessment", "Assessment"],
];

export default function SchemeEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [scheme, setScheme] = useState(null);
  const [rows, setRows] = useState([]);
  const [topics, setTopics] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const apply = useCallback((data) => {
    setScheme(data);
    setRows((data.entries || []).map(fromServer));
    setDirty(false);
  }, []);

  useEffect(() => {
    let alive = true;
    lessonPlanningApi
      .scheme(id)
      .then(({ data }) => {
        if (!alive) return;
        apply(data);
        return lessonPlanningApi.topics({
          subject: data.subject_id,
          grade_level: data.grade_level_id,
        });
      })
      .then((res) => {
        if (alive && res) setTopics(unwrap(res));
      })
      .catch((e) => {
        if (alive) setError(errMsg(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [id, apply]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Scheme of Work</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  if (!scheme) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Scheme of Work</h1>
          </div>
        </div>
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error || "Could not load this scheme."}
        </div>
      </div>
    );
  }

  const locked = isLocked(scheme.status);

  const update = (key, field, value) => {
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
    setDirty(true);
  };

  const pickTopic = (key, topicId) => {
    const t = topics.find((x) => String(x.id) === String(topicId));
    setRows((rs) =>
      rs.map((r) =>
        r._key === key
          ? { ...r, topic: topicId, topic_text: t && !r.topic_text ? t.name : r.topic_text }
          : r
      )
    );
    setDirty(true);
  };

  const addRow = () => {
    const nextWeek = rows.length
      ? Math.max(...rows.map((r) => Number(r.week_number) || 0)) + 1
      : 1;
    setRows((rs) => [...rs, blankRow(nextWeek)]);
    setDirty(true);
  };

  const removeRow = (key) => {
    setRows((rs) => rs.filter((r) => r._key !== key));
    setDirty(true);
  };

  const save = async () => {
    const { data } = await lessonPlanningApi.saveSchemeEntries(id, rows.map(toPayload));
    apply(data);
    return data;
  };

  const run = async (fn, okMessage) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (okMessage) setNotice(okMessage);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => apply((await lessonPlanningApi.scheme(id)).data);

  const onSave = () => run(save, "Scheme saved.");
  const onSubmit = () =>
    run(async () => {
      if (dirty) await save();
      await lessonPlanningApi.submitScheme(id);
      await reload();
    }, "Submitted for review.");
  const onWithdraw = () =>
    run(async () => {
      await lessonPlanningApi.withdrawScheme(id);
      await reload();
    }, "Withdrawn. You can edit it again.");
  const onDelete = async () => {
    if (
      !window.confirm("Delete this scheme and all of its weeks? Lesson plans you already wrote stay.")
    )
      return;
    run(async () => {
      await lessonPlanningApi.deleteScheme(id);
      navigate("/teacher/lesson-planning/schemes");
    });
  };

  const totalPlans = rows.reduce((sum, r) => sum + (Number(r.lesson_plan_count) || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {scheme.subject_name}, {scheme.classroom_label}
          </h1>
          <p className="page-subtitle">
            {scheme.term_label}
            {rows.length > 0 ? ` · ${rows.length} week${rows.length === 1 ? "" : "s"}` : ""}
            {totalPlans > 0 ? ` · ${totalPlans} lesson plan${totalPlans === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="page-header__actions">
          <StatusBadge status={scheme.status} />
        </div>
      </div>

      <ReviewBanner status={scheme.status} remarks={scheme.review_remarks} />

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError("")}></button>
        </div>
      )}

      {notice && (
        <div className="alert alert-success alert-dismissible fade show" role="status">
          <i className="bi bi-check2-circle me-1"></i>
          {notice}
          <button type="button" className="btn-close" onClick={() => setNotice("")}></button>
        </div>
      )}

      {locked && (
        <div className="alert alert-light border d-flex align-items-start gap-2">
          <i className="bi bi-lock mt-1 text-muted-soft"></i>
          <span>
            {scheme.status === "SUBMITTED"
              ? "This scheme is with the reviewer. Withdraw it if you need to change something."
              : "This scheme is approved. Write lesson plans from any week below."}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="table-wrap mb-3">
          <div className="empty-state">
            <i className="bi bi-journal-plus"></i>
            <h6>No weeks yet</h6>
            <p className="text-muted-soft mb-3">Add the first week to start building this scheme of work.</p>
            {!locked && (
              <button className="btn btn-primary" onClick={addRow} type="button">
                <i className="bi bi-plus-lg me-1"></i>
                Add Week
              </button>
            )}
          </div>
        </div>
      ) : (
        rows.map((r) => (
          <div key={r._key} className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-calendar-week me-2 text-brand"></i>
                Week {r.week_number || "—"}
                {r.lesson_number ? ` · Lesson ${r.lesson_number}` : ""}
              </span>
              {r.id && (
                <div className="d-flex align-items-center gap-2">
                  <span className="chart-card__subtitle mb-0">
                    <i className="bi bi-card-checklist me-1"></i>
                    {r.lesson_plan_count || 0} plan{r.lesson_plan_count === 1 ? "" : "s"}
                  </span>
                  <div style={{ width: "100px" }} title={`${r.coverage_percent || 0}% coverage`}>
                    <Progress value={r.coverage_percent || 0} />
                  </div>
                </div>
              )}
            </div>

            <div className="p-3">
              <div className="row g-3 align-items-end">
                <div className="col-6 col-md-2 col-lg-1">
                  <label className="form-label">Week</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    className="form-control"
                    value={r.week_number}
                    disabled={locked}
                    onChange={(e) => update(r._key, "week_number", e.target.value)}
                  />
                </div>

                <div className="col-6 col-md-2 col-lg-1">
                  <label className="form-label">Lesson</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={r.lesson_number}
                    disabled={locked}
                    onChange={(e) => update(r._key, "lesson_number", e.target.value)}
                  />
                </div>

                <div className="col-12 col-md-4 col-lg-4">
                  <label className="form-label">Topic from Curriculum</label>
                  <select
                    className="form-select"
                    value={r.topic}
                    disabled={locked}
                    onChange={(e) => pickTopic(r._key, e.target.value)}
                  >
                    <option value="">None — type it below</option>
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.parent_name ? `${t.parent_name}: ${t.name}` : t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-12 col-md-3 col-lg-3">
                  <label className="form-label">Topic</label>
                  <input
                    className="form-control"
                    value={r.topic_text}
                    disabled={locked}
                    onChange={(e) => update(r._key, "topic_text", e.target.value)}
                  />
                </div>

                <div className="col-12 col-md-3 col-lg-3">
                  <label className="form-label">Subtopic</label>
                  <input
                    className="form-control"
                    value={r.subtopic_text}
                    disabled={locked}
                    onChange={(e) => update(r._key, "subtopic_text", e.target.value)}
                  />
                </div>
              </div>

              <div className="row g-3 mt-1 pt-3 border-top">
                {WEEK_SECTIONS.map(([field, label]) => (
                  <div className="col-12 col-md-6" key={field}>
                    <label className="form-label">{label}</label>
                    <textarea
                      rows={2}
                      className="form-control"
                      value={r[field]}
                      disabled={locked}
                      onChange={(e) => update(r._key, field, e.target.value)}
                      style={{ resize: "vertical" }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                {r.id ? (
                  <>
                    <i className="bi bi-check2-circle me-1 text-brand"></i>
                    Week saved — write lesson plans from here
                  </>
                ) : (
                  <>
                    <i className="bi bi-info-circle me-1"></i>
                    Save the scheme to plan lessons from this week
                  </>
                )}
              </span>
              <div className="d-flex gap-2">
                {r.id && (
                  <Link
                    className="btn btn-sm btn-outline-primary"
                    to={`/teacher/lesson-planning/plans/new?entry=${r.id}&allocation=${scheme.allocation}`}
                  >
                    <i className="bi bi-journal-plus me-1"></i>
                    Write Lesson Plan
                  </Link>
                )}
                {!locked && (
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => removeRow(r._key)}
                    type="button"
                  >
                    <i className="bi bi-trash me-1"></i>
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {/* Sticky action bar */}
      <div
        className="table-wrap p-3 d-flex justify-content-between align-items-center gap-3 flex-wrap"
        style={{ position: "sticky", bottom: "0.75rem", zIndex: 5 }}
      >
        <div>
          {!locked && (
            <button className="btn btn-outline-secondary" onClick={addRow} type="button">
              <i className="bi bi-plus-lg me-1"></i>
              Add Week
            </button>
          )}
          <div
            className={`form-text-hint mt-1 mb-0 ${dirty ? "text-gold fw-semibold" : ""}`}
          >
            {dirty
              ? "You have unsaved changes."
              : rows.length === 0
              ? "No weeks yet — add one to get started."
              : "All changes saved."}
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2">
          {!locked && (
            <>
              <button className="btn btn-outline-danger" disabled={busy} onClick={onDelete}>
                <i className="bi bi-trash me-1"></i>
                Delete Scheme
              </button>

              <button className="btn btn-outline-primary" disabled={busy || !dirty} onClick={onSave}>
                {busy ? (
                  "Saving..."
                ) : (
                  <>
                    <i className="bi bi-save me-1"></i>
                    Save Changes
                  </>
                )}
              </button>

              <button
                className="btn btn-primary"
                disabled={busy || rows.length === 0}
                onClick={onSubmit}
              >
                <i className="bi bi-send me-1"></i>
                Submit for Review
              </button>
            </>
          )}

          {scheme.status === "SUBMITTED" && (
            <button className="btn btn-outline-primary" disabled={busy} onClick={onWithdraw}>
              <i className="bi bi-arrow-return-left me-1"></i>
              Withdraw
            </button>
          )}
        </div>
      </div>
    </div>
  );
}