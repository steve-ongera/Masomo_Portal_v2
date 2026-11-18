import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { lessonPlanningApi, teacherApi } from "../../../services/api";
import {
  Field,
  ReviewBanner,
  Spinner,
  StatusBadge,
  errMsg,
  isLocked,
  todayISO,
  unwrap,
} from "./shared";

const EMPTY = {
  allocation: "",
  date: todayISO(),
  scheme_entry: "",
  timetable_entry: "",
  topic: "",
  subtopic: "",
  objectives: "",
  introduction: "",
  activities: "",
  resources: "",
  assessment: "",
  conclusion: "",
  homework: "",
};

const SECTIONS = [
  ["objectives", "Learning Objectives"],
  ["introduction", "Introduction"],
  ["activities", "Lesson Development and Activities"],
  ["resources", "Learning Resources"],
  ["assessment", "Assessment"],
  ["conclusion", "Conclusion"],
  ["homework", "Homework"],
];

const PRINT_CSS = `
.lp-print-area { display: none; }
@media print {
  .lp-print-area { display: block !important; }
  .lp-print-area .lp-sec { margin-top: 14px; page-break-inside: avoid; }
  .lp-print-area .lp-sec-title {
    font-weight: 700;
    border-bottom: 1px solid var(--border-color-strong, #999);
    margin-bottom: 4px;
    padding-bottom: 2px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .lp-print-area h5 { margin-bottom: 2px; }
  .lp-print-area .lp-meta { font-size: 11px; color: #444; margin-bottom: 12px; }
  .lp-print-area .lp-body { white-space: pre-wrap; font-size: 12px; line-height: 1.55; }
}`;

export default function LessonPlanEditor() {
  const { id } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [plan, setPlan] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [allocations, setAllocations] = useState([]);
  const [cov, setCov] = useState({
    completed: false,
    coverage_percentage: 0,
    attendance: "",
    challenges: "",
    remarks: "",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fillCoverage = (c) =>
    setCov(
      c
        ? { ...c, attendance: c.attendance ?? "" }
        : { completed: false, coverage_percentage: 0, attendance: "", challenges: "", remarks: "" }
    );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setAllocations(unwrap(await teacherApi.myAllocations()));

        if (!isNew) {
          const { data } = await lessonPlanningApi.plan(id);
          if (!alive) return;
          setPlan(data);
          setForm({
            ...EMPTY,
            ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, data[k] ?? ""])),
          });
          fillCoverage(data.coverage);
        } else {
          const seed = {
            ...EMPTY,
            allocation: params.get("allocation") || "",
            date: params.get("date") || todayISO(),
            timetable_entry: params.get("timetable_entry") || "",
          };
          const entryId = params.get("entry");
          if (entryId) {
            const { data: e } = await lessonPlanningApi.schemeEntry(entryId);
            Object.assign(seed, {
              scheme_entry: e.id,
              allocation: String(e.allocation_id),
              topic: e.topic_text || e.topic_name || "",
              subtopic: e.subtopic_text || "",
              objectives: e.objectives || "",
              activities: e.activities || "",
              resources: e.resources || "",
              assessment: e.assessment || "",
            });
          }
          if (alive) setForm(seed);
        }
      } catch (e) {
        if (alive) setError(errMsg(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Lesson Plan</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  const locked = plan ? isLocked(plan.status) : false;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const payload = () => {
    const body = { ...form };
    ["scheme_entry", "timetable_entry"].forEach((k) => {
      body[k] = body[k] ? Number(body[k]) : null;
    });
    body.allocation = Number(body.allocation);
    if (!isNew) delete body.allocation;
    return body;
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

  const save = async () => {
    if (isNew) {
      const { data } = await lessonPlanningApi.createPlan(payload());
      navigate(`/teacher/lesson-planning/plans/${data.id}`, { replace: true });
      return data;
    }
    const { data } = await lessonPlanningApi.updatePlan(id, payload());
    setPlan(data);
    return data;
  };

  const onSave = () => run(save, "Lesson plan saved.");
  const onSubmit = () =>
    run(async () => {
      await save();
      const { data } = await lessonPlanningApi.submitPlan(id);
      setPlan(data);
    }, "Submitted for review.");
  const onWithdraw = () =>
    run(async () => {
      setPlan((await lessonPlanningApi.withdrawPlan(id)).data);
    }, "Withdrawn. You can edit it again.");
  const onDelete = () => {
    if (!window.confirm("Delete this lesson plan?")) return;
    run(async () => {
      await lessonPlanningApi.deletePlan(id);
      navigate("/teacher/lesson-planning/plans");
    });
  };
  const onCoverage = (e) => {
    e.preventDefault();
    run(async () => {
      const body = {
        completed: cov.completed,
        coverage_percentage: cov.completed ? 100 : Number(cov.coverage_percentage) || 0,
        attendance: cov.attendance === "" ? null : Number(cov.attendance),
        challenges: cov.challenges,
        remarks: cov.remarks,
      };
      const { data } = await lessonPlanningApi.saveCoverage(id, body);
      setPlan(data);
      fillCoverage(data.coverage);
    }, "Coverage recorded.");
  };

  const alloc = allocations.find((a) => String(a.id) === String(form.allocation));
  const subjectLine = plan
    ? `${plan.subject_name}, ${plan.classroom_label}`
    : alloc
    ? `${alloc.subject_name}, ${alloc.classroom_label}`
    : "";

  const pageTitle = isNew ? "New Lesson Plan" : form.topic || "Lesson Plan";

  return (
    <div>
      <style>{PRINT_CSS}</style>

      <div className="page-header">
        <div>
          <h1 className="page-title">{pageTitle}</h1>
          <p className="page-subtitle">
            {subjectLine || (isNew ? "Choose a class and subject to begin" : "")}
            {plan?.week_number ? ` · Week ${plan.week_number}` : ""}
            {plan?.term_label ? ` · ${plan.term_label}` : ""}
          </p>
        </div>

        <div className="page-header__actions">
          {plan && <StatusBadge status={plan.status} />}
          {!isNew && (
            <button className="btn btn-outline-secondary btn-sm" onClick={() => window.print()}>
              <i className="bi bi-printer"></i>
              Print / Save PDF
            </button>
          )}
        </div>
      </div>

      {plan && <ReviewBanner status={plan.status} remarks={plan.review_remarks} />}

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
            {plan.status === "SUBMITTED"
              ? "This plan is with the reviewer. Withdraw it to edit."
              : "This plan is approved."}{" "}
            You can still record how the lesson went below.
          </span>
        </div>
      )}

      {/* Plan Details */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-journal-text me-2 text-brand"></i>
            Plan Details
          </span>
          {locked && (
            <span className="badge badge-neutral">
              <i className="bi bi-lock me-1"></i>
              Locked
            </span>
          )}
        </div>

        <div className="p-3">
          <div className="row g-3">
            <Field label="Class and Subject" className="col-md-7">
              <select
                className="form-select"
                value={form.allocation}
                disabled={!isNew}
                onChange={(e) => set("allocation", e.target.value)}
              >
                <option value="">Choose...</option>
                {allocations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.subject_name}, {a.classroom_label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Lesson Date" className="col-md-5">
              <input
                type="date"
                className="form-control"
                value={form.date}
                disabled={locked}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>

            <Field label="Topic" className="col-md-6">
              <input
                className="form-control"
                value={form.topic}
                disabled={locked}
                onChange={(e) => set("topic", e.target.value)}
              />
            </Field>

            <Field label="Subtopic" className="col-md-6">
              <input
                className="form-control"
                value={form.subtopic}
                disabled={locked}
                onChange={(e) => set("subtopic", e.target.value)}
              />
            </Field>
          </div>

          <div className="divider mt-4 mb-3" />
          <div className="section-label mb-3">Lesson Sections</div>

          {SECTIONS.map(([key, label]) => (
            <Field label={label} key={key}>
              <textarea
                rows={key === "activities" ? 5 : 3}
                className="form-control"
                value={form[key]}
                disabled={locked}
                onChange={(e) => set(key, e.target.value)}
                style={{ resize: "vertical" }}
              />
            </Field>
          ))}
        </div>

        <div className="table-wrap__footer">
          <span className="table-wrap__footer-info">
            {busy ? (
              <span className="text-gold">
                <span className="dot-loader me-2">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
                Working...
              </span>
            ) : isNew ? (
              "Save to create this lesson plan."
            ) : (
              <>
                {plan.status === "DRAFT" && "Draft — editable"}
                {plan.status === "SUBMITTED" && "Waiting for review"}
                {plan.status === "APPROVED" && "Approved"}
                {plan.status === "REJECTED" && "Returned for revision"}
              </>
            )}
          </span>

          <div className="d-flex flex-wrap gap-2 justify-content-end">
            {!locked && !isNew && (
              <button className="btn btn-sm btn-outline-danger" disabled={busy} onClick={onDelete}>
                <i className="bi bi-trash me-1"></i>
                Delete
              </button>
            )}

            {plan?.status === "SUBMITTED" && (
              <button className="btn btn-sm btn-outline-primary" disabled={busy} onClick={onWithdraw}>
                <i className="bi bi-arrow-return-left me-1"></i>
                Withdraw
              </button>
            )}

            {!locked && (
              <>
                <button
                  className="btn btn-sm btn-outline-primary"
                  disabled={busy || !form.allocation || !form.topic.trim()}
                  onClick={onSave}
                >
                  {busy ? (
                    "Saving..."
                  ) : (
                    <>
                      <i className="bi bi-save me-1"></i>
                      Save Plan
                    </>
                  )}
                </button>

                {!isNew && (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={onSubmit}>
                    <i className="bi bi-send me-1"></i>
                    Submit for Review
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delivery / Coverage */}
      {!isNew && (
        <form className="table-wrap mb-3" onSubmit={onCoverage}>
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-clipboard-data me-2 text-brand"></i>
              How Did the Lesson Go?
            </span>
            {plan?.coverage && (
              <span className="badge badge-success">
                <span className="status-dot status-dot--online"></span>
                Recorded
              </span>
            )}
          </div>

          <div className="p-3">
            <div className={`status-panel mb-3 ${cov.completed ? "status-panel--active" : ""}`}>
              <div className="form-check mb-0">
                <input
                  id="lp-done"
                  type="checkbox"
                  className="form-check-input"
                  checked={cov.completed}
                  onChange={(e) =>
                    setCov({
                      ...cov,
                      completed: e.target.checked,
                      coverage_percentage: e.target.checked ? 100 : cov.coverage_percentage,
                    })
                  }
                />
                <label
                  htmlFor="lp-done"
                  className="form-check-label small fw-semibold"
                >
                  I finished everything I planned
                </label>
              </div>
            </div>

            <div className="row g-3">
              <Field
                label={`Covered: ${cov.completed ? 100 : cov.coverage_percentage}%`}
                className="col-md-8"
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  className="form-range"
                  disabled={cov.completed}
                  value={cov.completed ? 100 : cov.coverage_percentage}
                  onChange={(e) => setCov({ ...cov, coverage_percentage: e.target.value })}
                />
                <div className="progress-track mt-2">
                  <div
                    className="progress-fill"
                    style={{ width: `${cov.completed ? 100 : cov.coverage_percentage}%` }}
                  ></div>
                </div>
              </Field>

              <Field label="Learners Present" className="col-md-4">
                <input
                  type="number"
                  min="0"
                  className="form-control"
                  value={cov.attendance}
                  onChange={(e) => setCov({ ...cov, attendance: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Challenges You Met">
              <textarea
                rows={2}
                className="form-control"
                value={cov.challenges}
                onChange={(e) => setCov({ ...cov, challenges: e.target.value })}
                style={{ resize: "vertical" }}
              />
            </Field>

            <Field label="Remarks">
              <textarea
                rows={2}
                className="form-control"
                value={cov.remarks}
                onChange={(e) => setCov({ ...cov, remarks: e.target.value })}
                style={{ resize: "vertical" }}
              />
            </Field>
          </div>

          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              {plan?.coverage
                ? "Update this if you finish more of the lesson later."
                : "Record how the lesson actually went."}
            </span>
            <button className="btn btn-sm btn-success" disabled={busy}>
              {busy ? (
                "Saving..."
              ) : (
                <>
                  <i className="bi bi-check2 me-1"></i>
                  {plan?.coverage ? "Update Coverage" : "Save Coverage"}
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Print-only area (styled by PRINT_CSS) */}
      {plan && (
        <div className="lp-print-area">
          <h5>Lesson Plan</h5>
          <div className="lp-meta">
            {plan.subject_name}, {plan.classroom_label} · Teacher: {plan.teacher_name} · Date: {plan.date}
            {plan.week_number ? ` · Week ${plan.week_number}` : ""}
            {plan.term_label ? ` · ${plan.term_label}` : ""}
          </div>

          <div className="lp-sec">
            <div className="lp-sec-title">Topic</div>
            <div className="lp-body">
              {plan.topic}
              {plan.subtopic ? `: ${plan.subtopic}` : ""}
            </div>
          </div>

          {SECTIONS.map(([key, label]) =>
            plan[key] ? (
              <div className="lp-sec" key={key}>
                <div className="lp-sec-title">{label}</div>
                <div className="lp-body">{plan[key]}</div>
              </div>
            ) : null
          )}

          {plan.coverage && (
            <div className="lp-sec">
              <div className="lp-sec-title">Delivery</div>
              <div className="lp-body">
                {plan.coverage.completed
                  ? "Completed"
                  : `${plan.coverage.coverage_percentage}% covered`}
                {plan.coverage.attendance != null
                  ? ` · ${plan.coverage.attendance} learners present`
                  : ""}
                {plan.coverage.challenges ? `\nChallenges: ${plan.coverage.challenges}` : ""}
                {plan.coverage.remarks ? `\nRemarks: ${plan.coverage.remarks}` : ""}
              </div>
            </div>
          )}

          {plan.status === "APPROVED" && (
            <div className="lp-sec">
              <div className="lp-sec-title">Approval</div>
              <div className="lp-body">
                Approved by {plan.reviewed_by_name || "the administration"}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}