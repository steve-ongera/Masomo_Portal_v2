import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AttTabs,
  ClassSelect,
  Modal,
  Pill,
  Rate,
  REASON_LABEL,
  attendanceApi,
  daysAgoISO,
  downloadCsv,
  errMsg,
  fmtDate,
  rateTone,
  todayISO,
  useMyClasses,
} from "./shared";
import TableSkeleton from "../../../components/TableSkeleton";

const TREND_TONE = {
  good: "var(--success-600)",
  warn: "var(--gold-500)",
  bad: "var(--danger-600)",
  neutral: "var(--blue-600)",
};

const pctOf = (rate) => {
  const n = Number(rate);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
};

export default function AttendanceReports() {
  const [params] = useSearchParams();
  const { loading: loadingClasses, error: classesError, data } = useMyClasses();
  const classes = data?.classes || [];

  const [classroomId, setClassroomId] = useState(Number(params.get("classroom")) || null);
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [type, setType] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [sort, setSort] = useState("name");
  const [search, setSearch] = useState("");

  const [student, setStudent] = useState(null);
  const [history, setHistory] = useState({ loading: false, data: null, error: "" });

  const room = classes.find((c) => c.classroom_id === classroomId);

  useEffect(() => {
    if (!classroomId && classes.length === 1) setClassroomId(classes[0].classroom_id);
  }, [classes, classroomId]);

  const loadReport = async () => {
    if (!classroomId) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await attendanceApi.summary({
        classroom: classroomId,
        date_from: from,
        date_to: to,
        session_type: type || undefined,
        subject: subjectId || undefined,
      });
      setReport(r.data);
    } catch (e) {
      setReport(null);
      setError(errMsg(e, "Couldn't load the report."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, from, to, type, subjectId]);

  const students = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase();
    const list = report.students.filter(
      (s) =>
        !q ||
        s.full_name.toLowerCase().includes(q) ||
        String(s.admission_no).toLowerCase().includes(q)
    );
    const by = {
      name: (a, b) => a.full_name.localeCompare(b.full_name),
      rate: (a, b) => (a.rate ?? 101) - (b.rate ?? 101),
      absent: (a, b) => b.absent - a.absent,
    }[sort];
    return [...list].sort(by);
  }, [report, sort, search]);

  const openStudent = async (s) => {
    setStudent(s);
    setHistory({ loading: true, data: null, error: "" });
    try {
      const r = await attendanceApi.studentHistory(s.enrollment_id, {
        date_from: from,
        date_to: to,
      });
      setHistory({ loading: false, data: r.data, error: "" });
    } catch (e) {
      setHistory({ loading: false, data: null, error: errMsg(e) });
    }
  };

  const exportCsv = () => {
    if (!report) return;
    downloadCsv(
      `attendance_${report.classroom.replace(/\s+/g, "_")}_${from}_to_${to}.csv`,
      [
        ["Admission no", "Name", "Sessions", "Present", "Late", "Absent", "Excused", "Rate %"],
        ...report.students.map((s) => [
          s.admission_no,
          s.full_name,
          s.total,
          s.present,
          s.late,
          s.absent,
          s.excused,
          s.rate ?? "",
        ]),
      ]
    );
  };

  const t = report?.totals;
  const needAttention = report
    ? report.students.filter((s) => s.rate != null && s.rate < 75).length
    : 0;

  const hasFilters = !!(classroomId || from || to || type || subjectId);

  const resetDates = () => {
    setFrom(daysAgoISO(30));
    setTo(todayISO());
    setType("");
    setSubjectId("");
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance Reports</h1>
          <p className="page-subtitle">
            Who is attending, who is slipping, and how the class is trending
          </p>
        </div>
        {report && report.sessions_count > 0 && (
          <div className="page-header__actions">
            <button className="btn btn-outline-primary btn-sm" onClick={exportCsv}>
              <i className="bi bi-download"></i>
              Download CSV
            </button>
          </div>
        )}
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
            <button className="btn btn-sm btn-light" onClick={resetDates}>
              <i className="bi bi-x-lg me-1"></i>
              Reset
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

            <div className="col-sm-6 col-md-3 col-lg-2">
              <label className="form-label">Register Type</label>
              <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All my registers</option>
                <option value="DAILY">Daily only</option>
                <option value="LESSON">Lessons only</option>
              </select>
            </div>

            {room?.subjects.length > 0 && type !== "DAILY" && (
              <div className="col-sm-6 col-md-3 col-lg-3">
                <label className="form-label">Subject</label>
                <select className="form-select" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">All subjects</option>
                  {room.subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger d-flex justify-content-between align-items-center gap-2 flex-wrap" role="alert">
          <span>
            <i className="bi bi-exclamation-triangle me-1"></i>
            {error}
          </span>
          <button className="btn btn-sm btn-secondary" onClick={loadReport}>
            <i className="bi bi-arrow-clockwise me-1"></i>
            Try Again
          </button>
        </div>
      )}

      {(loading || loadingClasses) && (
        <div className="table-wrap">
          <TableSkeleton rows={8} columns={7} />
        </div>
      )}

      {!classroomId && !loadingClasses && !error && (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-mortarboard"></i>
            <h6>Choose a class to see its report</h6>
            <p className="text-muted-soft">Pick a class from the filters above to load its attendance summary.</p>
          </div>
        </div>
      )}

      {report && report.sessions_count === 0 && !loading && !error && (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-journal-x"></i>
            <h6>No registers in this period yet</h6>
            <p className="text-muted-soft">
              Widen the date range or take a register to start building this report.
            </p>
          </div>
        </div>
      )}

      {report && report.sessions_count > 0 && !loading && !error && (
        <>
          {report.scope === "MY_SUBJECTS" && (
            <div className="alert alert-primary d-flex align-items-start gap-2">
              <i className="bi bi-info-circle mt-1"></i>
              <span>You are a subject teacher here, so this report covers only your own lessons.</span>
            </div>
          )}

          {/* Stats tiles */}
          <div className="stat-grid">
            <div className="dm-card dm-card--primary">
              <div className="dm-card__top">
                <span className="dm-card__label">Overall rate</span>
                <span className="dm-card__icon">
                  <i className="bi bi-graph-up-arrow"></i>
                </span>
              </div>
              <div className="dm-card__num"><Rate value={t.rate} /></div>
            </div>

            <div className="dm-card dm-card--warning">
              <div className="dm-card__top">
                <span className="dm-card__label">
                  Register{report.sessions_count === 1 ? "" : "s"}
                </span>
                <span className="dm-card__icon">
                  <i className="bi bi-journal-check"></i>
                </span>
              </div>
              <div className="dm-card__num">{report.sessions_count}</div>
            </div>

            <div className="dm-card dm-card--danger">
              <div className="dm-card__top">
                <span className="dm-card__label">Absences</span>
                <span className="dm-card__icon">
                  <i className="bi bi-person-x"></i>
                </span>
              </div>
              <div className="dm-card__num">{t.absent}</div>
            </div>

            <div className="dm-card dm-card--warning">
              <div className="dm-card__top">
                <span className="dm-card__label">Late arrivals</span>
                <span className="dm-card__icon">
                  <i className="bi bi-clock-history"></i>
                </span>
              </div>
              <div className="dm-card__num">{t.late}</div>
            </div>

            <div className="dm-card dm-card--primary">
              <div className="dm-card__top">
                <span className="dm-card__label">Excused</span>
                <span className="dm-card__icon">
                  <i className="bi bi-shield-check"></i>
                </span>
              </div>
              <div className="dm-card__num">{t.excused}</div>
            </div>

            {needAttention > 0 && (
              <div className="dm-card dm-card--danger">
                <div className="dm-card__top">
                  <span className="dm-card__label">Below 75% attendance</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-exclamation-triangle"></i>
                  </span>
                </div>
                <div className="dm-card__num">{needAttention}</div>
              </div>
            )}
          </div>

          {/* Daily trend */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-bar-chart-line me-2 text-brand"></i>
                Daily Trend
              </span>
              <div className="d-flex align-items-center gap-3">
                {[
                  { label: "≥ 90%", tone: "good" },
                  { label: "75–89%", tone: "warn" },
                  { label: "< 75%", tone: "bad" },
                ].map((c) => (
                  <span
                    key={c.tone}
                    className="d-flex align-items-center gap-1 small"
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: TREND_TONE[c.tone],
                        display: "inline-block",
                      }}
                    ></span>
                    {c.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="p-3" role="img" aria-label="Attendance rate per day">
              {report.trend.length === 0 ? (
                <p className="form-text-hint mb-0">
                  No days to show.
                </p>
              ) : (
                <div
                  className="d-flex align-items-end gap-1"
                  style={{
                    minHeight: "120px",
                    paddingBottom: "0.4rem",
                    borderBottom: "1px solid var(--border-color)",
                    overflowX: "auto",
                  }}
                >
                  {report.trend.map((d) => {
                    const tone = rateTone(d.rate);
                    const color = TREND_TONE[tone] || TREND_TONE.neutral;
                    const pct = pctOf(d.rate);
                    return (
                      <div
                        key={d.date}
                        title={`${fmtDate(d.date)}: ${d.rate == null ? "-" : d.rate + "%"}`}
                        style={{
                          flex: "1 0 18px",
                          minWidth: "14px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <div
                          style={{
                            height: "90px",
                            width: "100%",
                            display: "flex",
                            alignItems: "flex-end",
                            justifyContent: "center",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              maxWidth: "14px",
                              height: `${pct}%`,
                              background: color,
                              borderRadius: "var(--radius-sm)",
                              transition: "height 0.2s ease",
                            }}
                          ></div>
                        </div>
                        <span
                          className="text-muted-soft"
                          style={{ fontSize: "0.6rem", whiteSpace: "nowrap" }}
                        >
                          {String(d.date).slice(8)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Learners */}
          <div className="table-wrap">
            <div className="table-wrap__header flex-column align-items-stretch gap-3">
              <div className="toolbar mb-0" style={{ width: "100%" }}>
                <div className="toolbar__search" style={{ maxWidth: "none" }}>
                  <i className="bi bi-search"></i>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Find a learner by name or admission no..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <select
                  className="form-select w-auto"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="name">Sort: Name</option>
                  <option value="rate">Sort: Lowest rate first</option>
                  <option value="absent">Sort: Most absences first</option>
                </select>

                {search && (
                  <button className="btn btn-sm btn-light" onClick={() => setSearch("")}>
                    <i className="bi bi-x-lg me-1"></i>
                    Clear
                  </button>
                )}
              </div>

              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-people me-2 text-brand"></i>
                  Learners
                </span>
                <span className="chart-card__subtitle mb-0">
                  {students.length} of {report.students.length} shown
                </span>
              </div>
            </div>

            {students.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-search"></i>
                <h6>No learner matches "{search}"</h6>
                <p className="text-muted-soft">Try a different name or clear the search.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: "120px" }}>No.</th>
                      <th>Name</th>
                      <th className="text-end" style={{ width: "90px" }}>Present</th>
                      <th className="text-end" style={{ width: "80px" }}>Late</th>
                      <th className="text-end" style={{ width: "90px" }}>Absent</th>
                      <th className="text-end" style={{ width: "90px" }}>Excused</th>
                      <th style={{ width: "150px" }}>Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr
                        key={s.enrollment_id}
                        className="clickable"
                        tabIndex={0}
                        role="button"
                        style={{ cursor: "pointer" }}
                        onClick={() => openStudent(s)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openStudent(s);
                          }
                        }}
                      >
                        <td>
                          <span className="cell-mono text-brand fw-semibold">
                            {s.admission_no}
                          </span>
                        </td>
                        <td>
                          <span className="cell-name">{s.full_name}</span>
                        </td>
                        <td className="text-end">
                          <span className="cell-mono fw-semibold text-ok">{s.present}</span>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <strong>{students.length}</strong> learner{students.length === 1 ? "" : "s"} ·{" "}
                {fmtDate(from)} → {fmtDate(to)}
              </span>
              <span className="form-text-hint m-0">
                Click any row to see the learner's history
              </span>
            </div>
          </div>
        </>
      )}

      {/* Student history modal */}
      {student && (
        <Modal title={student.full_name} onClose={() => setStudent(null)} size="lg">
          {history.loading && <TableSkeleton rows={5} columns={4} />}

          {history.error && !history.loading && (
            <div className="alert alert-danger" role="alert">{history.error}</div>
          )}

          {history.data && !history.loading && !history.error && (
            <>
              <p className="cell-muted small mb-3">
                <i className="bi bi-person-vcard me-1"></i>
                {history.data.student.admission_no} · {history.data.student.classroom} ·{" "}
                {fmtDate(from)} to {fmtDate(to)}
              </p>

              <div className="d-flex flex-wrap gap-2 mb-3">
                <span className="badge badge-neutral">
                  <i className="bi bi-graph-up me-1"></i>
                  Rate: {history.data.rate ?? "—"}
                </span>
                <span className="badge badge-success">
                  <span className="status-dot status-dot--online"></span>
                  Present: {history.data.counts.present}
                </span>
                {history.data.counts.late > 0 && (
                  <span className="badge badge-gold">
                    <span className="status-dot status-dot--pending"></span>
                    Late: {history.data.counts.late}
                  </span>
                )}
                {history.data.counts.absent > 0 && (
                  <span className="badge badge-danger">
                    <span className="status-dot status-dot--offline"></span>
                    Absent: {history.data.counts.absent}
                  </span>
                )}
                {history.data.counts.excused > 0 && (
                  <span className="badge badge-blue">
                    <span className="status-dot status-dot--pending"></span>
                    Excused: {history.data.counts.excused}
                  </span>
                )}
              </div>

              {history.data.items.length === 0 ? (
                <div className="empty-state">
                  <i className="bi bi-journal-x"></i>
                  <h6>No records in this period</h6>
                  <p className="text-muted-soft">Try widening the date range from the reports page.</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: "120px" }}>Date</th>
                        <th>Register</th>
                        <th style={{ width: "150px" }}>Status</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.items.map((i, idx) => {
                        const note = [
                          REASON_LABEL[i.absence_reason],
                          i.check_in_time && `Arrived ${i.check_in_time}`,
                          i.remarks,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <tr key={idx}>
                            <td className="cell-mono">{fmtDate(i.date)}</td>
                            <td className="cell-muted small">
                              {i.session_type === "DAILY" ? "Daily" : i.subject_name}
                            </td>
                            <td>
                              <Pill status={i.status} />
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
            </>
          )}
        </Modal>
      )}
    </div>
  );
}