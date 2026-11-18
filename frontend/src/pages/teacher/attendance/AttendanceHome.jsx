import { Link } from "react-router-dom";
import { AttTabs, fmtDate, useMyClasses } from "./shared";

export default function AttendanceHome() {
  const { loading, error, data, reload } = useMyClasses();
  const classes = data?.classes || [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">
            {data?.today ? fmtDate(data.today) : "Today"}
            {data?.academic_year ? ` · Academic year ${data.academic_year}` : ""}
          </p>
        </div>
      </div>

      <AttTabs />

      {loading && (
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      )}

      {error && !loading && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <span>
            <i className="bi bi-exclamation-triangle me-1"></i>
            {error}
          </span>
          <button className="btn btn-sm btn-secondary" onClick={reload}>
            <i className="bi bi-arrow-clockwise me-1"></i>
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && classes.length === 0 && (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-mortarboard"></i>
            <h6>No classes yet</h6>
            <p className="text-muted-soft">
              You aren't a class teacher or allocated to teach a subject in any class this year. Ask the
              school office to update your allocations.
            </p>
          </div>
        </div>
      )}

      {!loading && !error && classes.length > 0 && (
        <div className="row g-3">
          {classes.map((c) => {
            const qs = (extra) => `?classroom=${c.classroom_id}${extra || ""}`;
            const daily = c.daily_today || {};
            const dailyMarked = !!daily.marked;

            return (
              <div className="col-12 col-xl-6" key={c.classroom_id}>
                <div className="table-wrap h-100">
                  <div className="table-wrap__header">
                    <div className="min-w-0">
                      <div className="chart-card__title mb-0">
                        {c.label}
                      </div>
                      <div className="chart-card__subtitle mb-1">
                        <i className="bi bi-people me-1"></i>
                        {c.student_count} learner{c.student_count === 1 ? "" : "s"}
                      </div>
                    </div>

                    <span
                      className={`badge ${
                        c.is_class_teacher ? "badge-blue" : "badge-neutral"
                      }`}
                    >
                      {c.is_class_teacher ? "Class Teacher" : "Subject Teacher"}
                    </span>
                  </div>

                  <div className="p-3">
                    {c.is_class_teacher && (
                      <>
                        <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                          <div className="min-w-0">
                            <div className="cell-name">
                              <i className="bi bi-clipboard-check me-1 text-brand"></i>
                              Daily Attendance
                            </div>
                            {dailyMarked ? (
                              <div className="cell-muted small mt-1">
                                {daily.present + daily.late} in · {daily.absent} absent ·{" "}
                                {daily.excused} excused
                              </div>
                            ) : (
                              <div className="cell-muted small mt-1">
                                Not taken yet today
                              </div>
                            )}
                          </div>

                          <span
                            className={`badge text-nowrap ${dailyMarked ? "badge-success" : "badge-warning"}`}
                          >
                            <span
                              className={`status-dot ${
                                dailyMarked ? "status-dot--online" : "status-dot--pending"
                              }`}
                            ></span>
                            {dailyMarked ? "Marked" : "Not marked"}
                          </span>
                        </div>
                        <div className="divider" />
                      </>
                    )}

                    {c.lessons_today.length > 0 ? (
                      <div className="mb-3">
                        <div className="section-label mb-2">Your Lessons Today</div>

                        <div className="d-flex flex-column gap-2">
                          {c.lessons_today.map((l) => (
                            <div
                              key={l.period_slot_id}
                              className="pick-item"
                            >
                              <div className="min-w-0">
                                <div className="cell-name">
                                  {l.subject_name}
                                </div>
                                <div className="cell-muted small mt-1">
                                  <i className="bi bi-clock me-1"></i>
                                  {l.label} · {l.start_time} – {l.end_time}
                                </div>
                              </div>

                              <div className="d-flex align-items-center gap-2">
                                <span
                                  className={`badge text-nowrap ${
                                    l.marked ? "badge-success" : "badge-warning"
                                  }`}
                                >
                                  <span
                                    className={`status-dot ${
                                      l.marked ? "status-dot--online" : "status-dot--pending"
                                    }`}
                                  ></span>
                                  {l.marked ? "Marked" : "Not marked"}
                                </span>
                                <Link
                                  className={`btn btn-sm ${
                                    l.marked ? "btn-outline-secondary" : "btn-primary"
                                  }`}
                                  to={`/teacher/attendance/mark${qs(
                                    `&type=LESSON&subject=${l.subject_id}&slot=${l.period_slot_id}`
                                  )}`}
                                >
                                  <i
                                    className={`bi ${
                                      l.marked ? "bi-pencil" : "bi-check2-square"
                                    } me-1`}
                                  ></i>
                                  {l.marked ? "Edit" : "Mark"}
                                </Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="cell-muted small mb-3">
                        <i className="bi bi-calendar-x me-1"></i>
                        No lessons scheduled for you today.
                      </div>
                    )}

                    <div className="border-top pt-3 d-flex flex-wrap gap-2 justify-content-end">
                      <Link
                        className="btn btn-sm btn-outline-primary"
                        to={`/teacher/attendance/reports${qs()}`}
                      >
                        <i className="bi bi-file-earmark-bar-graph me-1"></i>
                        Reports
                      </Link>
                      {c.subjects.length > 0 && (
                        <Link
                          className="btn btn-sm btn-outline-primary"
                          to={`/teacher/attendance/mark${qs("&type=LESSON")}`}
                        >
                          <i className="bi bi-journal-check me-1"></i>
                          Mark a Lesson
                        </Link>
                      )}
                      {c.is_class_teacher && (
                        <Link
                          className="btn btn-sm btn-primary"
                          to={`/teacher/attendance/mark${qs("&type=DAILY")}`}
                        >
                          <i className="bi bi-clipboard-check me-1"></i>
                          {dailyMarked ? "Edit Today's Register" : "Take Daily Register"}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}