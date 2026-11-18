import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AttTabs,
  ClassSelect,
  REASONS,
  STATUSES,
  attendanceApi,
  errMsg,
  fmtDate,
  todayISO,
  useMyClasses,
} from "./shared";
import TableSkeleton from "../../../components/TableSkeleton";

const STATUS_META = {
  PRESENT: { badge: "badge-success", dot: "status-dot--online" },
  LATE: { badge: "badge-gold", dot: "status-dot--pending" },
  ABSENT: { badge: "badge-danger", dot: "status-dot--offline" },
  EXCUSED: { badge: "badge-blue", dot: "status-dot--pending" },
};

export default function MarkAttendance() {
  const [params] = useSearchParams();
  const { loading: loadingClasses, error: classesError, data } = useMyClasses();
  const classes = data?.classes || [];

  const [classroomId, setClassroomId] = useState(Number(params.get("classroom")) || null);
  const [date, setDate] = useState(params.get("date") || todayISO());
  const [type, setType] = useState(params.get("type") || "");
  const [subjectId, setSubjectId] = useState(Number(params.get("subject")) || null);
  const [slotId, setSlotId] = useState(Number(params.get("slot")) || null);

  const [lessons, setLessons] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [rows, setRows] = useState([]);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [notify, setNotify] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(null);

  const room = useMemo(
    () => classes.find((c) => c.classroom_id === classroomId),
    [classes, classroomId]
  );
  const canDaily = !!room?.is_class_teacher;
  const canLesson = !!room?.subjects?.length;

  useEffect(() => {
    if (!room) return;
    if (type === "DAILY" && !canDaily) setType(canLesson ? "LESSON" : "");
    else if (type === "LESSON" && !canLesson) setType(canDaily ? "DAILY" : "");
    else if (!type) setType(canDaily ? "DAILY" : "LESSON");
    if (subjectId && !room.subjects.some((s) => s.id === subjectId)) {
      setSubjectId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useEffect(() => {
    setLessons([]);
    if (!classroomId || type !== "LESSON" || !date) return;
    attendanceApi
      .lessons({ classroom: classroomId, date })
      .then((r) => setLessons(r.data))
      .catch(() => setLessons([]));
  }, [classroomId, type, date]);

  const periodOptions = lessons.filter((l) => !subjectId || l.subject_id === subjectId);
  const ready = classroomId && date && type && (type === "DAILY" || subjectId);

  useEffect(() => {
    setSheet(null);
    setRows([]);
    setDirty(false);
    if (!ready) return;
    setLoadingSheet(true);
    setMessage(null);
    const q = { classroom: classroomId, date, session_type: type };
    if (type === "LESSON") {
      q.subject = subjectId;
      if (slotId) q.period_slot = slotId;
    }
    attendanceApi
      .sheet(q)
      .then((r) => {
        setSheet(r.data);
        setRows(r.data.students);
      })
      .catch((e) => setMessage({ kind: "error", text: errMsg(e, "Couldn't load the register.") }))
      .finally(() => setLoadingSheet(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, date, type, subjectId, slotId]);

  const patch = (i, changes) => {
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const next = { ...r, ...changes };
        if (changes.status && changes.status !== "LATE") next.check_in_time = "";
        if (changes.status && !["ABSENT", "EXCUSED"].includes(changes.status)) next.absence_reason = "";
        return next;
      })
    );
    setDirty(true);
    setMessage(null);
  };

  const markAll = (status) => {
    setRows((rs) =>
      rs.map((r) => ({ ...r, status, absence_reason: "", check_in_time: "" }))
    );
    setDirty(true);
  };

  const tally = useMemo(() => {
    const t = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    rows.forEach((r) => {
      t[r.status] = (t[r.status] || 0) + 1;
    });
    return t;
  }, [rows]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        classroom: classroomId,
        date,
        session_type: type,
        subject: type === "LESSON" ? subjectId : null,
        period_slot: type === "LESSON" ? slotId : null,
        notify_guardians: notify && type === "DAILY",
        records: rows.map((r) => ({
          enrollment_id: r.enrollment_id,
          status: r.status,
          absence_reason: r.absence_reason || "",
          check_in_time: r.status === "LATE" && r.check_in_time ? r.check_in_time : null,
          remarks: r.remarks || "",
        })),
      };
      const { data: res } = await attendanceApi.save(payload);
      setDirty(false);
      setMessage({
        kind: "ok",
        text:
          `Saved ${res.saved} learner${res.saved === 1 ? "" : "s"}.` +
          (res.guardians_notified
            ? ` ${res.guardians_notified} guardian${res.guardians_notified === 1 ? "" : "s"} notified.`
            : ""),
      });
      setSheet((s) => s && { ...s, session: { ...(s.session || {}), id: res.session_id } });
    } catch (e) {
      setMessage({ kind: "error", text: errMsg(e, "Couldn't save attendance.") });
    } finally {
      setSaving(false);
    }
  };

  const readOnly = sheet && !sheet.can_mark;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mark Attendance</h1>
          <p className="page-subtitle">
            Everyone starts as present. Change only the learners who aren't.
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

      {/* Register Setup */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-sliders me-2 text-brand"></i>
            Register Setup
          </span>
          {room?.label && (
            <span className="chart-card__subtitle mb-0">{room.label}</span>
          )}
        </div>

        <div className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-6 col-lg-3">
              <ClassSelect
                classes={classes}
                value={classroomId}
                onChange={(id) => {
                  setClassroomId(id);
                  setSlotId(null);
                }}
              />
            </div>

            <div className="col-sm-6 col-md-3 col-lg-2">
              <label className="form-label">Date</label>
              <input
                type="date"
                className="form-control"
                value={date}
                max={todayISO()}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSlotId(null);
                }}
              />
            </div>

            <div className="col-sm-6 col-md-3 col-lg-3">
              <label className="form-label">Register Type</label>
              <select
                className="form-select"
                value={type}
                disabled={!room}
                onChange={(e) => {
                  setType(e.target.value);
                  setSlotId(null);
                }}
              >
                {!room && <option value="">Choose a class first</option>}
                {canDaily && <option value="DAILY">Daily (whole day)</option>}
                {canLesson && <option value="LESSON">Lesson / period</option>}
              </select>
            </div>

            {type === "LESSON" && room && (
              <>
                <div className="col-sm-6 col-md-3 col-lg-2">
                  <label className="form-label">Subject</label>
                  <select
                    className="form-select"
                    value={subjectId || ""}
                    onChange={(e) => {
                      setSubjectId(Number(e.target.value) || null);
                      setSlotId(null);
                    }}
                  >
                    <option value="">Choose a subject</option>
                    {room.subjects.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div className="col-sm-6 col-md-3 col-lg-2">
                  <label className="form-label">Period</label>
                  <select
                    className="form-select"
                    value={slotId || ""}
                    onChange={(e) => setSlotId(Number(e.target.value) || null)}
                  >
                    <option value="">Not from timetable</option>
                    {periodOptions.map((l) => (
                      <option key={l.period_slot_id} value={l.period_slot_id}>
                        {l.label} ({l.start_time}) {l.subject_name}
                        {l.marked ? " — marked" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {!classroomId && !loadingClasses && !classesError && (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-mortarboard"></i>
            <h6>Choose a class to open its register</h6>
            <p className="text-muted-soft">Pick a class above to start marking attendance.</p>
          </div>
        </div>
      )}

      {classroomId && type === "LESSON" && !subjectId && (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-book"></i>
            <h6>Choose the subject you are teaching</h6>
            <p className="text-muted-soft">Pick a subject above to load the class register for that lesson.</p>
          </div>
        </div>
      )}

      {loadingSheet && (
        <div className="table-wrap">
          <TableSkeleton rows={8} columns={3} />
        </div>
      )}

      {message && (
        <div
          className={`alert alert-${message.kind === "ok" ? "success" : "danger"} alert-dismissible fade show`}
          role="status"
        >
          <i
            className={`bi ${
              message.kind === "ok" ? "bi-check2-circle" : "bi-exclamation-triangle"
            } me-1`}
          ></i>
          {message.text}
          <button type="button" className="btn-close" onClick={() => setMessage(null)}></button>
        </div>
      )}

      {sheet && (
        <>
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <div className="min-w-0">
                <div className="chart-card__title mb-0">
                  {sheet.classroom}
                  {sheet.subject_name ? `, ${sheet.subject_name}` : ", Daily Register"}
                </div>
                <div className="cell-muted small mt-1">
                  <i className="bi bi-calendar3 me-1"></i>
                  {fmtDate(sheet.date)}
                  {sheet.session && sheet.session.marked_by && (
                    <>
                      {" · "}
                      <i className="bi bi-person-check me-1"></i>
                      Marked by {sheet.session.marked_by}
                      <span className="text-gold"> — saving will update it</span>
                    </>
                  )}
                </div>
              </div>

              {!readOnly && rows.length > 0 && (
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => markAll("PRESENT")}
                >
                  <i className="bi bi-check2-all me-1"></i>
                  Mark All Present
                </button>
              )}
            </div>
          </div>

          {readOnly && (
            <div className="alert alert-primary d-flex align-items-center gap-2">
              <i className="bi bi-eye"></i>
              <span>You can view this register but not change it.</span>
            </div>
          )}

          {rows.length > 0 && (
            <div className="stat-grid">
              <div className="dm-card dm-card--success">
                <div className="dm-card__top">
                  <span className="dm-card__label">Present</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-check2-circle"></i>
                  </span>
                </div>
                <div className="dm-card__num">{tally.PRESENT || 0}</div>
              </div>

              <div className="dm-card dm-card--danger">
                <div className="dm-card__top">
                  <span className="dm-card__label">Absent</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-x-circle"></i>
                  </span>
                </div>
                <div className="dm-card__num">{tally.ABSENT || 0}</div>
              </div>

              <div className="dm-card dm-card--warning">
                <div className="dm-card__top">
                  <span className="dm-card__label">Late</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-clock-history"></i>
                  </span>
                </div>
                <div className="dm-card__num">{tally.LATE || 0}</div>
              </div>

              <div className="dm-card dm-card--primary">
                <div className="dm-card__top">
                  <span className="dm-card__label">Excused</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-shield-check"></i>
                  </span>
                </div>
                <div className="dm-card__num">{tally.EXCUSED || 0}</div>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="table-wrap">
              <div className="empty-state">
                <i className="bi bi-people"></i>
                <h6>
                  No active learners for this {type === "LESSON" ? "subject in this class" : "class"}
                </h6>
                <p className="text-muted-soft">
                  Check that the class has enrolled learners, or pick a different subject.
                </p>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <div className="table-wrap__header">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-list-check me-2 text-brand"></i>
                  Learner Roll
                </span>
                <span className="chart-card__subtitle mb-0">
                  {rows.length} learner{rows.length === 1 ? "" : "s"}
                </span>
              </div>

              <ul className="list-unstyled mb-0">
                {rows.map((r, i) => (
                  <li
                    key={r.enrollment_id}
                    className="pick-item"
                    style={{
                      borderBottom: "1px solid var(--border-color)",
                      borderRadius: 0,
                      background:
                        r.status === "ABSENT"
                          ? "rgba(220, 61, 67, 0.03)"
                          : r.status === "LATE"
                          ? "rgba(245, 165, 36, 0.04)"
                          : "transparent",
                      flexDirection: "column",
                      alignItems: "stretch",
                    }}
                  >
                    <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                      <div className="d-flex align-items-center gap-2 min-w-0" style={{ flex: "1 1 220px" }}>
                        <span
                          className="cell-mono text-brand fw-semibold"
                          style={{ minWidth: 80 }}
                        >
                          {r.admission_no}
                        </span>
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
                      </div>

                      <div
                        role="group"
                        aria-label={`Status for ${r.full_name}`}
                        className="d-flex flex-wrap"
                        style={{
                          border: "1px solid var(--border-color-strong)",
                          borderRadius: "var(--radius-md)",
                          overflow: "hidden",
                          flexShrink: 0,
                        }}
                      >
                        {STATUSES.map((s, idx) => {
                          const active = r.status === s.value;
                          const activeBg =
                            s.value === "PRESENT"
                              ? "var(--success-600)"
                              : s.value === "ABSENT"
                              ? "var(--danger-600)"
                              : s.value === "LATE"
                              ? "var(--gold-500)"
                              : "var(--blue-700)";
                          const activeFg = s.value === "LATE" ? "var(--blue-900)" : "#fff";
                          return (
                            <button
                              key={s.value}
                              type="button"
                              aria-pressed={active}
                              aria-label={s.label}
                              title={s.label}
                              disabled={readOnly}
                              onClick={() => patch(i, { status: s.value })}
                              className={`small ${active ? "fw-semibold" : ""}`}
                              style={{
                                border: "none",
                                borderLeft:
                                  idx === 0 ? "none" : "1px solid var(--border-color-strong)",
                                background: active ? activeBg : "var(--surface)",
                                color: active ? activeFg : "var(--ink-700)",
                                padding: "0.3rem 0.6rem",
                                cursor: readOnly ? "not-allowed" : "pointer",
                                minWidth: 44,
                                transition: "background 0.15s ease",
                              }}
                            >
                              {s.short}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {r.status !== "PRESENT" && (
                      <div className="d-flex flex-wrap gap-2 mt-2" style={{ paddingLeft: 2 }}>
                        {["ABSENT", "EXCUSED"].includes(r.status) && (
                          <select
                            className="form-select"
                            aria-label="Reason"
                            value={r.absence_reason}
                            disabled={readOnly}
                            onChange={(e) => patch(i, { absence_reason: e.target.value })}
                            style={{ maxWidth: 220 }}
                          >
                            <option value="">Reason (optional)</option>
                            {REASONS.map((x) => (
                              <option key={x.value} value={x.value}>{x.label}</option>
                            ))}
                          </select>
                        )}
                        {r.status === "LATE" && (
                          <input
                            type="time"
                            className="form-control"
                            aria-label="Arrival time"
                            value={r.check_in_time}
                            disabled={readOnly}
                            onChange={(e) => patch(i, { check_in_time: e.target.value })}
                            style={{ maxWidth: 140 }}
                          />
                        )}
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Remarks (optional)"
                          maxLength={255}
                          value={r.remarks}
                          disabled={readOnly}
                          onChange={(e) => patch(i, { remarks: e.target.value })}
                          style={{ flex: "1 1 220px", minWidth: 180 }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!readOnly && rows.length > 0 && (
            <div
              className="table-wrap p-3 mt-3 d-flex justify-content-between align-items-center gap-3 flex-wrap"
              style={{ position: "sticky", bottom: "0.75rem", zIndex: 5 }}
            >
              <div>
                {type === "DAILY" && (
                  <label className="form-check d-flex align-items-center gap-2 mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={notify}
                      onChange={(e) => setNotify(e.target.checked)}
                    />
                    <span className="form-check-label small">
                      Notify guardians of absent learners
                    </span>
                  </label>
                )}
                <div
                  className={`form-text-hint mb-0 ${dirty ? "text-gold fw-semibold" : ""}`}
                  style={{ marginTop: type === "DAILY" ? 4 : 0 }}
                >
                  {dirty
                    ? "You have unsaved changes."
                    : sheet.session
                    ? "Register is up to date."
                    : "No changes yet."}
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={save}
                disabled={saving || (!dirty && !!sheet.session)}
              >
                {saving ? (
                  "Saving..."
                ) : (
                  <>
                    <i className="bi bi-check2 me-1"></i>
                    {sheet.session ? "Update Attendance" : "Save Attendance"}
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}