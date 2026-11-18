import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AttTabs,
  ClassSelect,
  Modal,
  Pill,
  Rate,
  REASON_LABEL,
  attendanceApi,
  daysAgoISO,
  errMsg,
  fmtDate,
  todayISO,
  useMyClasses,
} from "./shared";
import TableSkeleton from "../../../components/TableSkeleton";

export default function AttendanceRecords() {
  const { loading: loadingClasses, error: classesError, data } = useMyClasses();
  const classes = data?.classes || [];

  const [classroomId, setClassroomId] = useState(null);
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [type, setType] = useState("");
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState({ loading: false, rows: [], error: "" });

  useEffect(() => {
    if (!classroomId && classes.length === 1) setClassroomId(classes[0].classroom_id);
  }, [classes, classroomId]);

  const loadSessions = async () => {
    if (!classroomId) {
      setSessions([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await attendanceApi.sessions({
        classroom: classroomId,
        date_from: from,
        date_to: to,
        session_type: type || undefined,
      });
      setSessions(r.data);
    } catch (e) {
      setError(errMsg(e, "Couldn't load records."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, from, to, type]);

  const view = async (s) => {
    setOpen(s);
    setDetail({ loading: true, rows: [], error: "" });
    try {
      const r = await attendanceApi.session(s.id);
      setDetail({ loading: false, rows: r.data, error: "" });
    } catch (e) {
      setDetail({ loading: false, rows: [], error: errMsg(e) });
    }
  };

  const room = classes.find((c) => c.classroom_id === classroomId);

  const editLink = (s) => {
    const base = `/teacher/attendance/mark?classroom=${classroomId}&date=${s.date}&type=${s.session_type}`;
    return s.session_type === "LESSON"
      ? `${base}&subject=${s.subject_id}${s.period_slot_id ? `&slot=${s.period_slot_id}` : ""}`
      : base;
  };

  const canEdit = (s) =>
    s.session_type === "DAILY"
      ? !!room?.is_class_teacher
      : !!room?.subjects.some((x) => x.id === s.subject_id);

  const hasFilters = !!(classroomId || from || to || type);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance Records</h1>
          <p className="page-subtitle">
            Every register taken in your classes — open one to see each learner
          </p>
        </div>
      </div>

      <AttTabs />

      {classesError && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {classesError}
        </div>
      )}

      {/* Filters */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-funnel me-2 text-brand"></i>
            Filters
          </span>
          {hasFilters && (
            <button
              className="btn btn-sm btn-light"
              onClick={() => {
                setFrom(daysAgoISO(30));
                setTo(todayISO());
                setType("");
              }}
            >
              <i className="bi bi-x-lg me-1"></i>
              Reset Dates
            </button>
          )}
        </div>

        <div className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-6 col-lg-3">
              <ClassSelect classes={classes} value={classroomId} onChange={setClassroomId} />
            </div>

            <div className="col-sm-6 col-md-3 col-lg-2">
              <label className="form-label">From</label>
              <input
                type="date"
                className="form-control"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div className="col-sm-6 col-md-3 col-lg-2">
              <label className="form-label">To</label>
              <input
                type="date"
                className="form-control"
                value={to}
                min={from}
                max={todayISO()}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            <div className="col-sm-12 col-md-6 col-lg-3">
              <label className="form-label">Register Type</label>
              <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All registers</option>
                <option value="DAILY">Daily</option>
                <option value="LESSON">Lesson</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Records list */}
      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-journal-check me-2 text-brand"></i>
            Registers Taken
          </span>
          <span className="chart-card__subtitle mb-0">
            {room?.label ? `${room.label} · ` : ""}
            {fmtDate(from)} → {fmtDate(to)}
            {sessions.length > 0 ? ` · ${sessions.length} session${sessions.length === 1 ? "" : "s"}` : ""}
          </span>
        </div>

        {error && (
          <div className="p-3">
            <div className="alert alert-danger mb-0 d-flex justify-content-between align-items-center gap-2 flex-wrap" role="alert">
              <span>
                <i className="bi bi-exclamation-triangle me-1"></i>
                {error}
              </span>
              <button className="btn btn-sm btn-secondary" onClick={loadSessions}>
                <i className="bi bi-arrow-clockwise me-1"></i>
                Try Again
              </button>
            </div>
          </div>
        )}

        {(loading || loadingClasses) && <TableSkeleton rows={8} columns={8} />}

        {!loading && !loadingClasses && !classroomId && !error && (
          <div className="empty-state">
            <i className="bi bi-mortarboard"></i>
            <h6>Choose a class to see its records</h6>
            <p className="text-muted-soft">
              Pick a class above to load the registers taken in the selected date range.
            </p>
          </div>
        )}

        {classroomId && !loading && !loadingClasses && !error && sessions.length === 0 && (
          <div className="empty-state">
            <i className="bi bi-journal-x"></i>
            <h6>No registers between {fmtDate(from)} and {fmtDate(to)}</h6>
            <p className="text-muted-soft mb-3">
              Widen the date range or take a new register for this class.
            </p>
            <Link className="btn btn-primary" to={`/teacher/attendance/mark?classroom=${classroomId}`}>
              <i className="bi bi-check2-square me-1"></i>
              Take a Register
            </Link>
          </div>
        )}

        {sessions.length > 0 && !loading && !loadingClasses && !error && (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th style={{ width: "120px" }}>Date</th>
                  <th>Register</th>
                  <th className="text-end" style={{ width: "90px" }}>Present</th>
                  <th className="text-end" style={{ width: "80px" }}>Late</th>
                  <th className="text-end" style={{ width: "90px" }}>Absent</th>
                  <th className="text-end" style={{ width: "90px" }}>Excused</th>
                  <th style={{ width: "140px" }}>Rate</th>
                  <th style={{ width: "150px" }}>Marked By</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className="clickable"
                    tabIndex={0}
                    role="button"
                    style={{ cursor: "pointer" }}
                    onClick={() => view(s)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        view(s);
                      }
                    }}
                  >
                    <td className="cell-mono">{fmtDate(s.date)}</td>
                    <td>
                      {s.session_type === "DAILY" ? (
                        <span className="badge badge-blue">Daily</span>
                      ) : (
                        <div>
                          <div className="cell-name">{s.subject_name}</div>
                          {s.period_label && (
                            <div className="cell-muted small mt-1">
                              <i className="bi bi-clock me-1"></i>
                              {s.period_label}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="text-end">
                      <span className="cell-mono fw-semibold text-ok">
                        {s.present}
                      </span>
                    </td>
                    <td className="text-end">
                      {s.late > 0 ? (
                        <span className="cell-mono fw-semibold text-gold">{s.late}</span>
                      ) : (
                        <span className="cell-muted">0</span>
                      )}
                    </td>
                    <td className="text-end">
                      {s.absent > 0 ? (
                        <span className="cell-mono fw-semibold text-owe">{s.absent}</span>
                      ) : (
                        <span className="cell-muted">0</span>
                      )}
                    </td>
                    <td className="text-end">
                      {s.excused > 0 ? (
                        <span className="cell-mono fw-semibold text-brand">{s.excused}</span>
                      ) : (
                        <span className="cell-muted">0</span>
                      )}
                    </td>
                    <td>
                      <Rate value={s.rate} />
                    </td>
                    <td className="cell-muted small">
                      {s.marked_by || <span className="cell-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sessions.length > 0 && !loading && !error && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              <strong>{sessions.length}</strong> register{sessions.length === 1 ? "" : "s"} ·{" "}
              {fmtDate(from)} → {fmtDate(to)}
            </span>
            <span className="form-text-hint m-0">
              Click any row to see each learner
            </span>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {open && (
        <Modal
          title={
            open.session_type === "DAILY"
              ? `${fmtDate(open.date)} — Daily Register`
              : `${fmtDate(open.date)} — ${open.subject_name}${
                  open.period_label ? `, ${open.period_label}` : ""
                }`
          }
          onClose={() => setOpen(null)}
          size="lg"
        >
          <div className="d-flex flex-wrap gap-2 pb-3 border-bottom mb-3">
            <span className="badge badge-success">
              <span className="status-dot status-dot--online"></span>
              Present: {open.present}
            </span>
            {open.late > 0 && (
              <span className="badge badge-gold">
                <span className="status-dot status-dot--pending"></span>
                Late: {open.late}
              </span>
            )}
            {open.absent > 0 && (
              <span className="badge badge-danger">
                <span className="status-dot status-dot--offline"></span>
                Absent: {open.absent}
              </span>
            )}
            {open.excused > 0 && (
              <span className="badge badge-blue">
                <span className="status-dot status-dot--pending"></span>
                Excused: {open.excused}
              </span>
            )}
            {open.rate !== undefined && (
              <span className="badge badge-neutral">
                <i className="bi bi-graph-up me-1"></i>
                Rate: {open.rate}
              </span>
            )}
          </div>

          {detail.loading && <TableSkeleton rows={5} columns={4} />}

          {detail.error && !detail.loading && (
            <div className="alert alert-danger" role="alert">
              {detail.error}
            </div>
          )}

          {!detail.loading && !detail.error && detail.rows.length === 0 && (
            <div className="empty-state">
              <i className="bi bi-people"></i>
              <h6>No learners in this register</h6>
              <p className="text-muted-soft">This register has no attendance rows recorded.</p>
            </div>
          )}

          {!detail.loading && !detail.error && detail.rows.length > 0 && (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "110px" }}>No.</th>
                    <th>Name</th>
                    <th style={{ width: "150px" }}>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rows.map((r) => {
                    const note = [
                      REASON_LABEL[r.absence_reason],
                      r.check_in_time && `Arrived ${r.check_in_time}`,
                      r.remarks,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <tr key={r.enrollment_id}>
                        <td>
                          <span className="cell-mono text-brand fw-semibold">
                            {r.admission_no}
                          </span>
                        </td>
                        <td>
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">
                              {(r.full_name || "")
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <span className="cell-name">{r.full_name}</span>
                          </div>
                        </td>
                        <td>
                          <Pill status={r.status} />
                        </td>
                        <td className="cell-muted small" style={{ whiteSpace: "normal" }}>
                          {note || <span className="cell-muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canEdit(open) && !detail.loading && (
            <div className="border-top pt-3 d-flex justify-content-end gap-2 mt-3">
              <button className="btn btn-secondary" onClick={() => setOpen(null)}>
                Close
              </button>
              <Link className="btn btn-primary" to={editLink(open)}>
                <i className="bi bi-pencil me-1"></i>
                Edit This Register
              </Link>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}