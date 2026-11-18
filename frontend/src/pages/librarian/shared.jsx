import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { libraryApi } from "../../services/api";
import ERPModal from "../../components/Modal";

export { libraryApi };

export const errMsg = (e, fallback = "Something went wrong. Try again.") =>
  e?.response?.data?.detail ||
  (typeof e?.response?.data === "object" &&
    e.response.data &&
    Object.entries(e.response.data)
      .map(([k, v]) => `${k}: ${[].concat(v).join(" ")}`)
      .join(" ")) ||
  fallback;

export const asList = (r) =>
  Array.isArray(r.data) ? r.data : r.data?.results || [];

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};

export const fmtDate = (iso) =>
  iso
    ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

export const kes = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

export const spineColor = (name = "") => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 38%)`;
};

export const COPY_LABEL = {
  AVAILABLE: "Available",
  ON_LOAN: "On loan",
  DAMAGED: "Damaged",
  LOST: "Lost",
  WITHDRAWN: "Withdrawn",
};

export const COPY_BADGE = {
  AVAILABLE: "badge-success",
  ON_LOAN: "badge-gold",
  DAMAGED: "badge-warning",
  LOST: "badge-danger",
  WITHDRAWN: "badge-neutral",
};

export const COPY_DOT = {
  AVAILABLE: "status-dot--online",
  ON_LOAN: "status-dot--pending",
  DAMAGED: "status-dot--pending",
  LOST: "status-dot--offline",
  WITHDRAWN: "status-dot--offline",
};

export function LoanState({ loan }) {
  if (!loan.is_active) {
    return (
      <span className="badge badge-success">
        <span className="status-dot status-dot--online"></span>
        Returned
      </span>
    );
  }
  if (loan.is_overdue) {
    return (
      <span className="badge badge-danger">
        <span className="status-dot status-dot--offline"></span>
        {loan.days_overdue}d overdue
      </span>
    );
  }
  return (
    <span className="badge badge-gold">
      <span className="status-dot status-dot--pending"></span>
      On loan
    </span>
  );
}

export function LibNav() {
  return null;
}

export function Modal({ title, onClose, children }) {
  return (
    <ERPModal show={true} onClose={onClose} title={title}>
      {children}
    </ERPModal>
  );
}

export function Pager({ page, count, size = 25, onPage }) {
  const pages = Math.max(Math.ceil(count / size), 1);
  if (pages <= 1) return null;

  const start = (page - 1) * size + 1;
  const end = Math.min(page * size, count);

  return (
    <div className="table-wrap__footer">
      <span className="table-wrap__footer-info">
        Showing <strong>{start}</strong>–<strong>{end}</strong> of <strong>{count}</strong>
      </span>

      <div className="d-flex align-items-center gap-2">
        <span className="form-text-hint me-1">
          Page {page} of {pages}
        </span>

        <button
          className="btn btn-sm btn-outline-primary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <i className="bi bi-chevron-left me-1"></i>
          Previous
        </button>

        <button
          className="btn btn-sm btn-outline-primary"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
          <i className="bi bi-chevron-right ms-1"></i>
        </button>
      </div>
    </div>
  );
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}