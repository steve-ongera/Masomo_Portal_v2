import { useState } from "react";
import { Link } from "react-router-dom";

export const kes = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
export const fdate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const fdt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const TONE = {
  DRAFT: "secondary", PENDING_APPROVAL: "warning", APPROVED: "success", REJECTED: "danger", CANCELLED: "dark",
  SENT: "info", CLOSED: "dark", AWARDED: "success", PARTIALLY_RECEIVED: "primary", FULLY_RECEIVED: "success",
  ACTIVE: "success", INACTIVE: "secondary", BLACKLISTED: "danger", EXPIRED: "danger", TERMINATED: "dark",
  RECEIVED: "info", ACCEPTED: "success", MATCHED: "success", DISCREPANCY: "danger", PAID: "success",
  RAISED: "warning", RETURNED: "primary", CREDITED: "success",
  LOW: "secondary", NORMAL: "info", HIGH: "warning", URGENT: "danger",
};

// map our tone vocabulary onto the main.css `.badge badge-*` palette
const BADGE_MAP = {
  primary: "badge-blue",
  info: "badge-blue",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  secondary: "badge-neutral",
  dark: "badge-neutral",
};

export function StatusBadge({ value }) {
  if (!value) return null;
  const label = String(value).replaceAll("_", " ").toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase());
  const cls = BADGE_MAP[TONE[value]] || "badge-neutral";
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle mb-0">{subtitle}</p>}
      </div>
      {children && <div className="page-header__actions">{children}</div>}
    </div>
  );
}

export function StatCard({ icon, label, value, tone = "primary", hint, to }) {
  const variant =
    {
      primary: "primary",
      success: "success",
      warning: "warning",
      danger: "danger",
      info: "info",
      secondary: "secondary",
      dark: "secondary",
    }[tone] || "primary";

  const body = (
    <div className={`dm-card dm-card--${variant} h-100`}>
      <div className="dm-card__top">
        <span className="dm-card__label">{label}</span>
        <span className="dm-card__icon">
          <i className={`bi ${icon}`}></i>
        </span>
      </div>
      <div className="dm-card__num">{value}</div>
      {hint && <div className="dm-card__sub text-danger">{hint}</div>}
    </div>
  );

  return to ? <Link to={to} className="text-decoration-none text-reset">{body}</Link> : body;
}

export function Alert({ kind = "danger", children, onClose }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind} ${onClose ? "alert-dismissible" : ""}`} role="alert">
      {kind === "danger" && <i className="bi bi-exclamation-circle me-2"></i>}
      {kind === "success" && <i className="bi bi-check2-circle me-2"></i>}
      {kind === "warning" && <i className="bi bi-exclamation-triangle me-2"></i>}
      {children}
      {onClose && (
        <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
      )}
    </div>
  );
}

export function Loading({ text = "Loading…" }) {
  return (
    <div className="page-loader page-loader--inline" aria-busy="true">
      <div className="page-loader__ring" aria-hidden="true" />
      <span className="sr-only">{text}</span>
    </div>
  );
}

export function Empty({ icon = "bi-inbox", text = "Nothing here yet." }) {
  return (
    <div className="empty-state">
      <i className={`bi ${icon}`}></i>
      <p className="text-muted-soft mb-0">{text}</p>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, size = "lg" }) {
  return (
    <>
      <div
        className="modal fade show d-block modal-scrim"
        tabIndex="-1"
        role="dialog"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        <div className={`modal-dialog modal-${size} modal-dialog-scrollable`}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

// Small form dialog used for approve / reject / pay etc. `fields` = [{name,label,type,options,required,placeholder,default}]
export function PromptModal({ title, intro, fields, confirmLabel = "Confirm", tone = "primary", onSubmit, onClose }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.default ?? ""])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const missing = fields.some((f) => f.required && !String(vals[f.name] ?? "").trim());

  const go = async () => {
    setBusy(true); setErr("");
    try { await onSubmit(vals); onClose(); } catch (e) { setErr(e.message || String(e)); setBusy(false); }
  };

  return (
    <Modal
      title={title}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={`btn btn-${tone}`} onClick={go} disabled={busy || missing}>
            {busy && <span className="spinner-border spinner-border-sm me-2" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {intro && <p className="form-text-hint">{intro}</p>}
      <Alert>{err}</Alert>
      {fields.map((f) => (
        <div className="mb-3" key={f.name}>
          <label className="form-label">
            {f.label}
            {f.required && <span className="text-danger"> *</span>}
          </label>
          {f.type === "select" ? (
            <select
              className="form-select"
              value={vals[f.name]}
              onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "textarea" ? (
            <textarea
              className="form-control"
              rows={3}
              placeholder={f.placeholder}
              value={vals[f.name]}
              onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
            />
          ) : (
            <input
              className="form-control"
              type={f.type || "text"}
              placeholder={f.placeholder}
              value={vals[f.name]}
              onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
            />
          )}
        </div>
      ))}
    </Modal>
  );
}

export const COMMENT_REQ = [{ name: "comment", label: "Reason / comment", type: "textarea", required: true }];
export const COMMENT_OPT = [{ name: "comment", label: "Comment (optional)", type: "textarea" }];