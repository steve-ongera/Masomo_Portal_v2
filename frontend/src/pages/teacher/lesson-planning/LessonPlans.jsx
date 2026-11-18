import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { lessonPlanningApi, teacherApi } from "../../../services/api";
import { StatusBadge, STATUS_LABEL, errMsg, unwrap } from "./shared";
import TableSkeleton from "../../../components/TableSkeleton";

const fmtCellDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export default function LessonPlans() {
  const [plans, setPlans] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allocations, setAllocations] = useState([]);
  const [filters, setFilters] = useState({ status: "", allocation: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    teacherApi
      .myAllocations()
      .then((r) => {
        if (alive) setAllocations(unwrap(r));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.allocation) params.allocation = filters.allocation;
      const r = await lessonPlanningApi.plans(params);
      setPlans(unwrap(r));
    } catch (e) {
      setError(errMsg(e));
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const hasFilters = !!(filters.status || filters.allocation);

  const clearFilters = () => {
    setFilters({ status: "", allocation: "" });
  };

  const summary = useMemo(() => {
    if (!plans) return { total: 0, taught: 0, pending: 0 };
    return plans.reduce(
      (acc, p) => {
        acc.total += 1;
        if (p.coverage?.completed) acc.taught += 1;
        if (p.status === "SUBMITTED") acc.pending += 1;
        return acc;
      },
      { total: 0, taught: 0, pending: 0 }
    );
  }, [plans]);

  const activeAllocLabel = useMemo(() => {
    const a = allocations.find((x) => String(x.id) === String(filters.allocation));
    return a ? `${a.subject_name}, ${a.classroom_label}` : "";
  }, [allocations, filters.allocation]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Lesson Plans</h1>
          <p className="page-subtitle">Detailed plans for individual lessons</p>
        </div>
        <div className="page-header__actions">
          <Link className="btn btn-primary btn-sm" to="/teacher/lesson-planning/plans/new">
            <i className="bi bi-plus-lg"></i>
            New Lesson Plan
          </Link>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0" style={{ width: "100%" }}>
            <select
              className="form-select w-auto"
              value={filters.allocation}
              onChange={(e) => setFilters({ ...filters, allocation: e.target.value })}
            >
              <option value="">All classes and subjects</option>
              {allocations.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.subject_name}, {a.classroom_label}
                </option>
              ))}
            </select>

            <select
              className="form-select w-auto"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Any status</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>

            {hasFilters && (
              <button className="btn btn-sm btn-light" onClick={clearFilters}>
                <i className="bi bi-x-lg me-1"></i>
                Clear
              </button>
            )}
          </div>

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title mb-0">
              <i className="bi bi-card-checklist me-2 text-brand"></i>
              Lesson Plans
            </span>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              {plans && plans.length > 0 && (
                <>
                  <span className="badge badge-neutral">{summary.total} total</span>
                  {summary.taught > 0 && (
                    <span className="badge badge-success">
                      <span className="status-dot status-dot--online"></span>
                      {summary.taught} taught
                    </span>
                  )}
                  {summary.pending > 0 && (
                    <span className="badge badge-gold">
                      <span className="status-dot status-dot--pending"></span>
                      {summary.pending} awaiting review
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {activeAllocLabel && (
            <div className="chip-row p-0 border-0">
              <span className="filter-chip">
                {activeAllocLabel}
                <button onClick={() => setFilters({ ...filters, allocation: "" })}>
                  <i className="bi bi-x"></i>
                </button>
              </span>
              {filters.status && (
                <span className="filter-chip">
                  {STATUS_LABEL[filters.status]}
                  <button onClick={() => setFilters({ ...filters, status: "" })}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="p-3">
            <div
              className="alert alert-danger mb-0 d-flex justify-content-between align-items-center gap-2 flex-wrap"
              role="alert"
            >
              <span>
                <i className="bi bi-exclamation-triangle me-1"></i>
                {error}
              </span>
              <button className="btn btn-sm btn-secondary" onClick={load}>
                <i className="bi bi-arrow-clockwise me-1"></i>
                Try Again
              </button>
            </div>
          </div>
        )}

        {loading && !error && <TableSkeleton rows={8} columns={7} />}

        {!loading && !error && plans && plans.length === 0 && (
          <div className="empty-state">
            <i className="bi bi-card-checklist"></i>
            <h6>{hasFilters ? "No lesson plans match your filters" : "No lesson plans yet"}</h6>
            <p className="text-muted-soft mb-3">
              {hasFilters
                ? "Try a different status or allocation, or clear the filters."
                : "Start one from today's lessons, or from a week in your scheme of work."}
            </p>
            {hasFilters ? (
              <button className="btn btn-sm btn-light" onClick={clearFilters}>
                <i className="bi bi-x-lg me-1"></i>
                Clear Filters
              </button>
            ) : (
              <Link className="btn btn-primary" to="/teacher/lesson-planning/plans/new">
                <i className="bi bi-plus-lg me-1"></i>
                New Lesson Plan
              </Link>
            )}
          </div>
        )}

        {!loading && !error && plans && plans.length > 0 && (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th style={{ width: "140px" }}>Date</th>
                  <th>Topic</th>
                  <th style={{ width: "220px" }}>Class and Subject</th>
                  <th className="text-end" style={{ width: "80px" }}>Week</th>
                  <th style={{ width: "150px" }}>Status</th>
                  <th style={{ width: "130px" }}>Taught</th>
                  <th style={{ width: "110px" }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-mono text-nowrap">
                      {fmtCellDate(p.date)}
                    </td>

                    <td>
                      <span className="cell-name">
                        {p.topic || <span className="cell-muted">No topic</span>}
                      </span>
                    </td>

                    <td>
                      <div className="cell-name">
                        {p.subject_name}
                      </div>
                      <div className="cell-muted small mt-1">
                        <i className="bi bi-people me-1"></i>
                        {p.classroom_label}
                      </div>
                    </td>

                    <td className="text-end">
                      {p.week_number != null ? (
                        <span className="cell-mono fw-semibold">
                          {p.week_number}
                        </span>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>

                    <td>
                      <StatusBadge status={p.status} />
                    </td>

                    <td>
                      {p.coverage ? (
                        p.coverage.completed ? (
                          <span className="badge badge-success">
                            <span className="status-dot status-dot--online"></span>
                            Yes
                          </span>
                        ) : (
                          <span className="text-gold fw-semibold small">
                            <i className="bi bi-hourglass-split me-1"></i>
                            {p.coverage.coverage_percentage}%
                          </span>
                        )
                      ) : (
                        <span className="cell-muted small">
                          Not recorded
                        </span>
                      )}
                    </td>

                    <td className="text-end">
                      <Link
                        className="btn btn-sm btn-outline-primary"
                        to={`/teacher/lesson-planning/plans/${p.id}`}
                      >
                        <i className="bi bi-pencil me-1"></i>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && plans && plans.length > 0 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              <strong>{plans.length}</strong> plan{plans.length === 1 ? "" : "s"}
              {hasFilters ? " matching your filters" : ""}
            </span>
            <span className="form-text-hint m-0">
              Click any row to open the plan
            </span>
          </div>
        )}
      </div>
    </div>
  );
}