/* eslint-disable react-refresh/only-export-components */
// Small shared pieces for the Bursaries pages. Tailwind utility classes, matching the rest of the app shell.
export const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30";
export const primaryBtn =
  "rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50";
export const ghostBtn =
  "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50";
export const linkBtn = "text-sm font-medium text-emerald-700 hover:underline disabled:opacity-50";

const TONES = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  gray: "bg-gray-100 text-gray-700 ring-gray-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
};

export const STATUS_TONE = {
  PENDING: "amber", APPROVED: "green", REJECTED: "red", SUSPENDED: "gray", ENDED: "gray",
  ACTIVE: "green", REVERSED: "red", SKIPPED: "gray",
};

export function Badge({ tone = "gray", children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div
        className={`my-8 w-full ${wide ? "max-w-4xl" : "max-w-xl"} rounded-xl bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Alert({ kind = "error", children }) {
  if (!children) return null;
  const cls = kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800";
  return <div className={`rounded-lg px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">{children}</div>;
}

export const KIND_LABEL = { BURSARY: "Bursary", SCHOLARSHIP: "Scholarship", DISCOUNT: "Discount" };
export const valueLabel = (type, value) => (type === "PERCENT" ? `${Number(value)}%` : `KES ${fmt(value)}`);