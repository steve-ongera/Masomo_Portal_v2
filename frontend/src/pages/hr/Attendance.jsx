import { useEffect, useState, useCallback, useMemo } from "react";
import { hrApi } from "../../services/api";
import Breadcrumb from "../../components/Breadcrumb";
import TableSkeleton from "../../components/TableSkeleton";

const STATUSES = [
  ["PRESENT", "Present"],
  ["LATE", "Late"],
  ["ABSENT", "Absent"],
  ["EARLY_DEPARTURE", "Left early"],
  ["ON_LEAVE", "On leave"],
  ["OFF_DUTY", "Off duty"],
];

const STATUS_META = {
  PRESENT: { badge: "badge-success", dot: "status-dot--online" },
  LATE: { badge: "badge-gold", dot: "status-dot--pending" },
  ABSENT: { badge: "badge-danger", dot: "status-dot--offline" },
  EARLY_DEPARTURE: { badge: "badge-warning", dot: "status-dot--pending" },
  ON_LEAVE: { badge: "badge-blue", dot: "status-dot--pending" },
  OFF_DUTY: { badge: "badge-neutral", dot: "status-dot--offline" },
};

const STATUS_SHORT = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  EARLY_DEPARTURE: "Left early",
  ON_LEAVE: "On leave",
  OFF_DUTY: "Off duty",
};

const today = () => new Date().toISOString().slice(0, 10);

const prettyDate = (iso) => {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

export default function StaffAttendance() {
  const [date, setDate] = useState(today());
  const [staff, setStaff] = useState([]);
  const [marks, setMarks] = useState({});
  const [loading, setLoading] = useState(true);

  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("info");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, a] = await Promise.all([
        hrApi.employees.list({ status: "ACTIVE" }),
        hrApi.attendance.list({ date }),
      ]);
      const staffRows = e.data.results ?? e.data;
      const attendanceRows = a.data.results ?? a.data;

      setStaff(staffRows);

      const m = {};
      attendanceRows.forEach((x) => {
        m[x.employee] = x.status;
      });
      setMarks(m);
    } catch {
      setMsg("Could not load the register.");
      setMsgType("danger");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const markEveryonePresent = () => {
    setMarks((prev) =>
      Object.fromEntries(staff.map((s) => [s.id, prev[s.id] || "PRESENT"]))
    );
  };

  const clearMarks = () => {
    setMarks({});
  };

  const setStatus = (employeeId, status) => {
    setMarks((prev) => {
      const next = { ...prev };
      if (!status) delete next[employeeId];
      else next[employeeId] = status;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const rows = Object.entries(marks).map(([employee, status]) => ({
        employee: Number(employee),
        status,
      }));
      const { data } = await hrApi.attendance.bulk(date, rows);
      setMsg(`Saved ${data.saved} record${data.saved === 1 ? "" : "s"} for ${date}.`);
      setMsgType("success");
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not save the register.");
      setMsgType("danger");
    } finally {
      setSaving(false);
    }
  };

  const summary = useMemo(() => {
    const counts = Object.fromEntries(STATUSES.map(([key]) => [key, 0]));
    let unmarked = 0;
    staff.forEach((s) => {
      const status = marks[s.id];
      if (!status) unmarked += 1;
      else if (counts[status] !== undefined) counts[status] += 1;
    });
    return { counts, unmarked };
  }, [marks, staff]);

  const totalMarked = staff.length - summary.unmarked;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "HR", href: "/admin/hr" },
          { label: "Staff Attendance", href: "#" },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Staff Attendance</h1>
          <p className="page-subtitle">Daily attendance register — {prettyDate(date)}</p>
        </div>
        <button
          className="btn btn-success"
          onClick={save}
          disabled={saving || staff.length === 0}
        >
          {saving ? (
            "Saving..."
          ) : (
            <>
              <i className="bi bi-check2 me-1"></i>
              Save Register
            </>
          )}
        </button>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show`} role="alert">
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      <div className="d-flex flex-wrap gap-2 mb-3">
        {STATUSES.map(([key, label]) => {
          const meta = STATUS_META[key] || { badge: "badge-neutral", dot: "status-dot--offline" };
          return (
            <span key={key} className={`badge ${meta.badge}`} style={{ padding: "0.35rem 0.6rem" }}>
              <span className={`status-dot ${meta.dot}`}></span>
              {label}: {summary.counts[key] || 0}
            </span>
          );
        })}
        {summary.unmarked > 0 && (
          <span className="badge badge-neutral" style={{ padding: "0.35rem 0.6rem" }}>
            <span className="status-dot status-dot--offline"></span>
            Not marked: {summary.unmarked}
          </span>
        )}
      </div>

      <div className="table-wrap">
        <div
          className="table-wrap__header"
          style={{ flexDirection: "column", alignItems: "stretch", gap: "0.75rem" }}
        >
          <div className="d-flex flex-wrap gap-2" style={{ width: "100%" }}>
            <div>
              <label className="form-label" htmlFor="attendanceDate" style={{ marginBottom: "0.2rem" }}>
                Register Date
              </label>
              <input
                id="attendanceDate"
                type="date"
                className="form-control"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ minWidth: "170px" }}
              />
            </div>

            <div className="d-flex align-items-end gap-2">
              <button
                className="btn btn-outline-primary"
                onClick={markEveryonePresent}
                disabled={staff.length === 0}
              >
                <i className="bi bi-check2-all me-1"></i>
                Mark Everyone Present
              </button>
              <button
                className="btn btn-light"
                onClick={clearMarks}
                disabled={totalMarked === 0}
                title="Clear all marks for this day"
              >
                <i className="bi bi-eraser me-1"></i>
                Clear
              </button>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
              <i className="bi bi-clipboard-check me-2"></i>
              Register — {staff.length} active staff
            </span>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
              {totalMarked} of {staff.length} marked
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={10} columns={3} />
        ) : staff.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>No active staff to mark</h6>
            <p className="text-muted-soft">
              Once employees are hired and marked active, they'll appear here.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th style={{ width: "140px" }}>No.</th>
                  <th>Name</th>
                  <th style={{ width: "260px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const current = marks[s.id] || "";
                  const meta = current ? STATUS_META[current] : null;
                  return (
                    <tr key={s.id}>
                      <td>
                        <span
                          style={{
                            fontWeight: 600,
                            color: "var(--blue-700)",
                            fontSize: "var(--fs-sm)",
                          }}
                        >
                          {s.employee_no}
                        </span>
                      </td>
                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">
                            {(s.full_name || "")
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <div>
                            <div className="cell-name">{s.full_name}</div>
                            {s.category && (
                              <div
                                style={{
                                  fontSize: "var(--fs-xs)",
                                  color: "var(--ink-400)",
                                  marginTop: "2px",
                                }}
                              >
                                {s.category}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <select
                            className="form-select"
                            value={current}
                            onChange={(e) => setStatus(s.id, e.target.value)}
                            style={{ flex: 1, minWidth: "130px" }}
                          >
                            <option value="">Not marked</option>
                            {STATUSES.map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                          {meta ? (
                            <span className={`badge ${meta.badge}`} style={{ whiteSpace: "nowrap" }}>
                              <span className={`status-dot ${meta.dot}`}></span>
                              {STATUS_SHORT[current]}
                            </span>
                          ) : (
                            <span className="badge badge-neutral" style={{ whiteSpace: "nowrap" }}>
                              <span className="status-dot status-dot--offline"></span>
                              Unmarked
                            </span>
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

        {!loading && staff.length > 0 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              <strong>{totalMarked}</strong> of <strong>{staff.length}</strong> staff marked
              {summary.unmarked > 0 && <> · {summary.unmarked} still unmarked</>}
            </span>
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-light" onClick={clearMarks} disabled={totalMarked === 0}>
                Clear
              </button>
              <button
                className="btn btn-sm btn-success"
                onClick={save}
                disabled={saving || totalMarked === 0}
              >
                {saving ? "Saving..." : "Save Register"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}