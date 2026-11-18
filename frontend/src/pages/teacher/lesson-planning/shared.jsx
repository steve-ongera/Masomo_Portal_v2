// Shared helpers for the teacher lesson-planning pages.
// Styled to match the ERP design system in main.css — badge palette,
// progress-track/fill, alert variants, and the page loader ring.

export const unwrap = (res) => res?.data?.results ?? res?.data ?? [];

export const errMsg = (
  err,
  fallback = "Something went wrong. Please try again."
) => {
  const d = err?.response?.data;
  if (!d) return fallback;
  if (typeof d === "string") return d;
  if (d.detail) return d.detail;
  const first = Object.entries(d)[0];
  if (!first) return fallback;
  const [key, val] = first;
  const text = Array.isArray(val)
    ? val[0]
    : typeof val === "string"
    ? val
    : JSON.stringify(val);
  return key === "non_field_errors"
    ? text
    : `${key.replace(/_/g, " ")}: ${text}`;
};

export const STATUS_STYLE = {
  DRAFT: "badge-neutral",
  SUBMITTED: "badge-blue",
  APPROVED: "badge-success",
  REJECTED: "badge-danger",
  NEEDS_REVISION: "badge-warning",
};

export const STATUS_DOT = {
  DRAFT: "status-dot--offline",
  SUBMITTED: "status-dot--pending",
  APPROVED: "status-dot--online",
  REJECTED: "status-dot--offline",
  NEEDS_REVISION: "status-dot--pending",
};

export const STATUS_LABEL = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_REVISION: "Needs revision",
};

export const isLocked = (status) =>
  status === "SUBMITTED" || status === "APPROVED";

export function StatusBadge({ status }) {
  if (!status) {
    return (
      <span className="badge badge-neutral">
        <span className="status-dot status-dot--offline"></span>
        Not started
      </span>
    );
  }
  const badge = STATUS_STYLE[status] || "badge-neutral";
  const dot = STATUS_DOT[status] || "status-dot--offline";
  return (
    <span className={`badge ${badge}`}>
      <span className={`status-dot ${dot}`}></span>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function ReviewBanner({ status, remarks }) {
  if (!remarks || (status !== "REJECTED" && status !== "NEEDS_REVISION")) {
    return null;
  }
  const isRejected = status === "REJECTED";
  return (
    <div
      className={`alert ${isRejected ? "alert-danger" : "alert-warning"} d-flex gap-2 align-items-start`}
      role="alert"
    >
      <i className="bi bi-chat-left-text mt-1"></i>
      <div>
        <strong>
          {isRejected ? "Returned: rejected." : "Returned: needs revision."}
        </strong>
        <div style={{ whiteSpace: "pre-wrap", marginTop: "0.2rem" }}>{remarks}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className = "" }) {
  return (
    <div className={`mb-3 ${className}`}>
      <label className="form-label">{label}</label>
      {children}
      {hint && <div className="form-text-hint">{hint}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading..." }) {
  return (
    <div
      className="d-flex align-items-center gap-3 py-4"
      style={{ color: "var(--ink-600)" }}
      role="status"
    >
      <div className="page-loader__ring" />
      <span style={{ fontSize: "var(--fs-xs)" }}>{label}</span>
    </div>
  );
}

export function Progress({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));

  const fillClass =
    v >= 100
      ? "progress-fill progress-fill--success"
      : v >= 50
      ? "progress-fill"
      : "progress-fill progress-fill--gold";

  return (
    <div className="d-flex align-items-center gap-2" style={{ minWidth: 120 }}>
      <div className="progress-track" style={{ flex: 1, height: 6 }}>
        <div className={fillClass} style={{ width: `${v}%` }} />
      </div>
      <span
        style={{
          fontSize: "var(--fs-xs)",
          color: "var(--ink-400)",
          minWidth: 38,
          textAlign: "right",
          fontWeight: 600,
        }}
      >
        {v}%
      </span>
    </div>
  );
}

export const fmtTime = (t) => (t ? t.slice(0, 5) : "");

export const todayISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};