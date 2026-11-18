import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lessonPlanningApi } from "../../../services/api";
import { Progress, StatusBadge, errMsg, fmtTime } from "./shared";

function TaughtBadge() {
  return (
    <span className="badge badge-success">
      <span className="status-dot status-dot--online"></span>
      Taught
    </span>
  );
}

export default function LessonPlanningHome() {
  const [today, setToday] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([lessonPlanningApi.today(), lessonPlanningApi.coverage()])
      .then(([t, c]) => {
        if (!alive) return;
        setToday(t.data);
        setCoverage(c.data);
      })
      .catch((e) => {
        if (alive) setError(errMsg(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Lesson Planning</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Lesson Planning</h1>
            <p className="page-subtitle">Plan lessons, track scheme coverage</p>
          </div>
        </div>
        <div
          className="alert alert-danger d-flex justify-content-between align-items-center gap-2 flex-wrap"
          role="alert"
        >
          <span>
            <i className="bi bi-exclamation-triangle me-1"></i>
            {error}
          </span>
          <button className="btn btn-sm btn-secondary" onClick={() => window.location.reload()}>
            <i className="bi bi-arrow-clockwise me-1"></i>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const planLink = (lesson) => {
    const q = new URLSearchParams({
      allocation: lesson.allocation_id,
      date: today.date,
      timetable_entry: lesson.timetable_entry_id,
    });
    if (lesson.suggested_entry) q.set("entry", lesson.suggested_entry.id);
    return `/teacher/lesson-planning/plans/new?${q}`;
  };

  const coverageRows = coverage?.rows || [];
  const totals = coverageRows.reduce(
    (acc, r) => {
      acc.plansTotal += r.plans_total || 0;
      acc.plansPending += r.plans_pending || 0;
      acc.entriesTotal += r.entries_total || 0;
      return acc;
    },
    { plansTotal: 0, plansPending: 0, entriesTotal: 0 }
  );

  const lessonsToday = today?.lessons?.length || 0;
  const plannedToday = today?.lessons?.filter((l) => l.plan).length || 0;
  const unplannedToday = lessonsToday - plannedToday;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Lesson Planning</h1>
          <p className="page-subtitle">
            {today.term
              ? `${today.term.label}${today.week_number ? ` · Week ${today.week_number}` : ""}`
              : "No current term is set up."}
          </p>
        </div>
        <div className="page-header__actions">
          <Link className="btn btn-outline-primary btn-sm" to="/teacher/lesson-planning/schemes">
            <i className="bi bi-journal-text"></i>
            Schemes of Work
          </Link>
          <Link className="btn btn-primary btn-sm" to="/teacher/lesson-planning/plans">
            <i className="bi bi-card-checklist"></i>
            My Lesson Plans
          </Link>
        </div>
      </div>

      {/* Stat grid */}
      <div className="stat-grid">
        <div className="dm-card dm-card--primary">
          <div className="dm-card__top">
            <span className="dm-card__label">
              Lesson{lessonsToday === 1 ? "" : "s"} today
            </span>
            <span className="dm-card__icon">
              <i className="bi bi-calendar-day"></i>
            </span>
          </div>
          <div className="dm-card__num">{lessonsToday}</div>
        </div>

        <div className="dm-card dm-card--success">
          <div className="dm-card__top">
            <span className="dm-card__label">Planned today</span>
            <span className="dm-card__icon">
              <i className="bi bi-check2-circle"></i>
            </span>
          </div>
          <div className="dm-card__num">{plannedToday}</div>
        </div>

        {unplannedToday > 0 && (
          <div className="dm-card dm-card--warning">
            <div className="dm-card__top">
              <span className="dm-card__label">Still unplanned</span>
              <span className="dm-card__icon">
                <i className="bi bi-hourglass-split"></i>
              </span>
            </div>
            <div className="dm-card__num">{unplannedToday}</div>
          </div>
        )}

        <div className="dm-card dm-card--danger">
          <div className="dm-card__top">
            <span className="dm-card__label">Awaiting review</span>
            <span className="dm-card__icon">
              <i className="bi bi-send-check"></i>
            </span>
          </div>
          <div className="dm-card__num">{totals.plansPending}</div>
        </div>
      </div>

      {/* Today's Lessons */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-clock-history me-2 text-brand"></i>
            Today's Lessons
          </span>
          <span className="chart-card__subtitle mb-0">
            {lessonsToday === 0 ? "Nothing scheduled" : `${lessonsToday} lesson${lessonsToday === 1 ? "" : "s"}`}
          </span>
        </div>

        {lessonsToday === 0 ? (
          <div className="empty-state">
            <i className="bi bi-calendar-x"></i>
            <h6>No lessons on your timetable today</h6>
            <p className="text-muted-soft">
              Enjoy the quiet day — you'll see your next lessons here when they're scheduled.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th style={{ width: "150px" }}>Time</th>
                  <th>Lesson</th>
                  <th style={{ width: "260px" }}>Plan</th>
                  <th style={{ width: "200px" }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {today.lessons.map((l) => (
                  <tr key={l.timetable_entry_id}>
                    <td>
                      <div className="cell-name">
                        {fmtTime(l.start_time)} – {fmtTime(l.end_time)}
                      </div>
                      <div className="cell-muted small mt-1">
                        <i className="bi bi-clock me-1"></i>
                        {l.period_label}
                      </div>
                    </td>

                    <td>
                      <div className="cell-name">
                        {l.subject_name}
                      </div>
                      <div className="cell-muted small mt-1">
                        <i className="bi bi-people me-1"></i>
                        {l.classroom_label}
                      </div>
                    </td>

                    <td>
                      {l.plan ? (
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          <span className="cell-name">
                            {l.plan.topic || <span className="cell-muted">No topic</span>}
                          </span>
                          <StatusBadge status={l.plan.status} />
                          {l.plan.completed && <TaughtBadge />}
                        </div>
                      ) : l.suggested_entry ? (
                        <div className="small text-muted-soft">
                          <div className="section-label mb-1">Scheme Suggests</div>
                          {l.suggested_entry.topic || <span className="cell-muted">(no topic)</span>}
                        </div>
                      ) : (
                        <span className="cell-muted small">
                          No plan yet
                        </span>
                      )}
                    </td>

                    <td className="text-end">
                      {l.plan ? (
                        <Link
                          className="btn btn-sm btn-outline-primary"
                          to={`/teacher/lesson-planning/plans/${l.plan.id}`}
                        >
                          <i className="bi bi-eye me-1"></i>
                          {l.plan.completed ? "View" : "Open & Record Coverage"}
                        </Link>
                      ) : (
                        <Link className="btn btn-sm btn-primary" to={planLink(l)}>
                          <i className="bi bi-plus-lg me-1"></i>
                          Plan This Lesson
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Syllabus Coverage */}
      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-graph-up-arrow me-2 text-brand"></i>
            Syllabus Coverage This Term
          </span>
          {coverageRows.length > 0 && (
            <span className="chart-card__subtitle mb-0">
              {coverageRows.length} allocation{coverageRows.length === 1 ? "" : "s"} ·{" "}
              {totals.plansTotal} plan{totals.plansTotal === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {coverageRows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-journal-x"></i>
            <h6>No subject allocations this year</h6>
            <p className="text-muted-soft">
              The school office assigns subjects and classes to teachers. Once yours are set, they'll
              appear here with their scheme coverage.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Class and Subject</th>
                  <th style={{ width: "160px" }}>Scheme</th>
                  <th className="text-end" style={{ width: "120px" }}>Weeks Planned</th>
                  <th style={{ width: "180px" }}>Delivered</th>
                  <th className="text-end" style={{ width: "130px" }}>Plans</th>
                  <th style={{ width: "150px" }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coverageRows.map((r) => (
                  <tr key={r.allocation_id}>
                    <td>
                      <div className="cell-name">
                        {r.subject_name}
                      </div>
                      <div className="cell-muted small mt-1">
                        <i className="bi bi-people me-1"></i>
                        {r.classroom_label}
                      </div>
                    </td>

                    <td>
                      <StatusBadge status={r.scheme_status} />
                    </td>

                    <td className="text-end">
                      <span className="cell-mono fw-semibold">{r.entries_total}</span>
                    </td>

                    <td>
                      <Progress value={r.coverage_percent} />
                    </td>

                    <td className="text-end">
                      <span className="cell-mono fw-semibold">{r.plans_total}</span>
                      {r.plans_pending > 0 && (
                        <div className="text-gold small mt-1">
                          <i className="bi bi-hourglass-split me-1"></i>
                          {r.plans_pending} awaiting review
                        </div>
                      )}
                    </td>

                    <td className="text-end">
                      {r.scheme_id ? (
                        <Link
                          className="btn btn-sm btn-outline-secondary"
                          to={`/teacher/lesson-planning/schemes/${r.scheme_id}`}
                        >
                          <i className="bi bi-journal-text me-1"></i>
                          Open Scheme
                        </Link>
                      ) : (
                        <Link
                          className="btn btn-sm btn-primary"
                          to={`/teacher/lesson-planning/schemes?new=${r.allocation_id}`}
                        >
                          <i className="bi bi-plus-lg me-1"></i>
                          Start Scheme
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {coverageRows.length > 0 && totals.plansPending > 0 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              <i className="bi bi-info-circle me-1"></i>
              <strong>{totals.plansPending}</strong> lesson plan
              {totals.plansPending === 1 ? "" : "s"} waiting on the reviewer
            </span>
            <Link className="btn btn-sm btn-outline-primary" to="/teacher/lesson-planning/plans">
              View All Plans
              <i className="bi bi-arrow-right ms-1"></i>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}