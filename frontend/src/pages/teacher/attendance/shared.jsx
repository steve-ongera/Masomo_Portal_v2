import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { attendanceApi } from "../../../services/api";
import ERPModal from "../../../components/Modal";

export { attendanceApi };

export const STATUSES = [
  { value: "PRESENT", short: "P", label: "Present" },
  { value: "ABSENT", short: "A", label: "Absent" },
  { value: "LATE", short: "L", label: "Late" },
  { value: "EXCUSED", short: "E", label: "Excused" },
];

export const REASONS = [
  { value: "SICK", label: "Sick" },
  { value: "AUTHORIZED", label: "Authorized absence" },
  { value: "FAMILY", label: "Family reason" },
  { value: "SCHOOL_ACTIVITY", label: "School activity" },
  { value: "UNKNOWN", label: "Unknown" },
  { value: "OTHER", label: "Other" },
];

export const STATUS_LABEL = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label])
);

export const REASON_LABEL = Object.fromEntries(
  REASONS.map((r) => [r.value, r.label])
);

export const STATUS_META = {
  PRESENT: { badge: "badge-success", dot: "status-dot--online", tone: "success" },
  LATE: { badge: "badge-gold", dot: "status-dot--pending", tone: "gold" },
  ABSENT: { badge: "badge-danger", dot: "status-dot--offline", tone: "danger" },
  EXCUSED: { badge: "badge-blue", dot: "status-dot--pending", tone: "blue" },
};

export const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

export const daysAgoISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

export const fmtDate = (iso) =>
  iso
    ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

export const fmtDateShort = (iso) =>
  iso
    ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "";

export const errMsg = (e, fallback = "Something went wrong. Try again.") =>
  e?.response?.data?.detail ||
  (typeof e?.response?.data === "object" &&
    e.response.data &&
    Object.values(e.response.data).flat().join(" ")) ||
  fallback;

export const rateTone = (rate) => {
  if (rate == null) return "neutral";
  if (rate >= 90) return "good";
  if (rate >= 75) return "warn";
  return "bad";
};

const RATE_COLOR = {
  good: "var(--success-600)",
  warn: "var(--gold-500)",
  bad: "var(--danger-600)",
  neutral: "var(--ink-400)",
};

export function Rate({ value }) {
  if (value == null) {
    return <span className="cell-muted">—</span>;
  }

  const tone = rateTone(value);
  const color = RATE_COLOR[tone] || RATE_COLOR.neutral;
  const pct = Math.min(Math.max(Number(value) || 0, 0), 100);

  return (
    <span
      className="d-inline-flex align-items-center gap-2"
      title="(Present + Late) / (Total − Excused)"
    >
      <span className="progress-track" style={{ width: 56, height: 6, flexShrink: 0 }}>
        <span
          className="progress-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      <strong
        className="cell-mono fw-bold small text-end"
        style={{ color, minWidth: 34 }}
      >
        {value}%
      </strong>
    </span>
  );
}

export function Pill({ status }) {
  const meta = STATUS_META[status] || {
    badge: "badge-neutral",
    dot: "status-dot--offline",
  };
  return (
    <span className={`badge ${meta.badge}`}>
      <span className={`status-dot ${meta.dot}`}></span>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function AttTabs() {
  const items = [
    ["/teacher/attendance", "My Classes", true, "bi-mortarboard"],
    ["/teacher/attendance/mark", "Mark Attendance", false, "bi-check2-square"],
    ["/teacher/attendance/records", "Records", false, "bi-journal-check"],
    ["/teacher/attendance/reports", "Reports", false, "bi-bar-chart-line"],
  ];

  return (
    <ul className="nav nav-tabs mb-3" role="tablist" aria-label="Attendance sections">
      {items.map(([to, label, end, icon]) => (
        <li className="nav-item" key={to}>
          <NavLink
            to={to}
            end={end}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
          >
            <i className={`bi ${icon} me-1`}></i>
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function useMyClasses() {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  const load = () => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    attendanceApi
      .myClasses()
      .then((r) => setState({ loading: false, error: "", data: r.data }))
      .catch((e) =>
        setState({
          loading: false,
          error: errMsg(e, "Couldn't load your classes."),
          data: null,
        })
      );
  };

  useEffect(() => {
    load();
  }, []);

  return { ...state, reload: load };
}

export function ClassSelect({ classes, value, onChange }) {
  return (
    <div className="field">
      <label className="form-label">Class</label>
      <select
        className="form-select"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || null)}
      >
        <option value="">Choose a class</option>
        {classes.map((c) => (
          <option key={c.classroom_id} value={c.classroom_id}>
            {c.label}
            {c.is_class_teacher ? " (class teacher)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <ERPModal show={true} onClose={onClose} title={title}>
      {children}
    </ERPModal>
  );
}

export function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob(
    [rows.map((r) => r.map(esc).join(",")).join("\n")],
    { type: "text/csv;charset=utf-8;" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}