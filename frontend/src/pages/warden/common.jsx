// Shared helpers for the boarding pages.
import { useCallback, useEffect, useState } from "react";
import { boardingApi, errMsg, unwrap } from "../../services/boardingApi";
import { calendarApi } from "../../services/api";

export { errMsg, unwrap };

// ---------------------------------------------------------------------------
// Data helpers — unchanged
// ---------------------------------------------------------------------------
export function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, loading, error, reload, setData };
}

let accessCache = null;
export function useAccess() {
  const [access, setAccess] = useState(accessCache);
  useEffect(() => {
    if (accessCache) return;
    boardingApi
      .access()
      .then((r) => {
        accessCache = r.data;
        setAccess(r.data);
      })
      .catch(() => setAccess({ can_operate: false }));
  }, []);
  return access;
}

export function useYears() {
  const { data } = useLoad(async () => unwrap(await calendarApi.academicYears()), []);
  const years = data || [];
  const current = years.find((y) => y.is_current);
  return { years, current };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const run = useCallback(async (fn, okText = "Done.") => {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const res = await fn();
      setOk(okText);
      return res;
    } catch (e) {
      setError(errMsg(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, ok, run, setError, setOk };
}

export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString() : "—");
export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : "—");
export const localToIso = (v) => (v ? new Date(v).toISOString() : "");
export const todayStr = () => new Date().toISOString().slice(0, 10);

export function classLabel(c) {
  const direct = c.name || c.display_name || c.label || c.title;
  if (direct) return direct;
  const grade = c.grade_level_name ?? c.grade_name ?? c.grade_level?.name ?? "";
  const stream = c.stream_name ?? c.stream?.name ?? "";
  const year = c.academic_year_name ?? c.year ?? c.academic_year?.year ?? "";
  return `${grade} ${stream} ${year ? `(${year})` : ""}`.trim() || `Class ${c.id}`;
}

// ---------------------------------------------------------------------------
// UI helpers — now styled from MAIN.CSS
// ---------------------------------------------------------------------------

// Page-level message banner. Uses the standard `.alert` classes.
// Usage: <Msg error={...} ok={...} onClose={() => act.setError("")} />
export function Msg({ error, ok, onClose }) {
  if (!error && !ok) return null;
  const type = error ? "danger" : "success";
  const text = error || ok;
  return (
    <div className={`alert alert-${type} alert-dismissible fade show`} role={error ? "alert" : "status"}>
      {text}
      {onClose && (
        <button
          type="button"
          className="btn-close"
          onClick={onClose}
          aria-label="Dismiss"
        />
      )}
    </div>
  );
}

// Inline loading spinner (use inside a card/table).
export function Loading({ loading, text = "Loading..." }) {
  if (!loading) return null;
  return (
    <div className="text-center py-4" role="status" aria-live="polite">
      <span className="spinner-border spinner-border-sm me-2" />
      {text}
    </div>
  );
}

// Year selector styled to match `.form-select` (drop into a toolbar).
// Pass className="form-select w-auto" if you want it beside filters.
export function YearSelect({ years, value, onChange, allowAll = false, className = "form-select" }) {
  return (
    <select
      className={className}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Academic year"
    >
      {allowAll && <option value="all">All years</option>}
      {years.map((y) => (
        <option key={y.id} value={y.id}>
          {y.year}
          {y.is_current ? " (current)" : ""}
        </option>
      ))}
    </select>
  );
}

// Shown on the boarding pages when the warden has no dormitory yet.
export function NoHostelNotice() {
  const access = useAccess();
  if (!access || !access.is_warden || access.has_dormitories) return null;
  return (
    <div className="alert alert-warning" role="alert">
      <i className="bi bi-exclamation-triangle me-2" />
      You have not been assigned to any hostel yet. Ask the Admin to assign you.
    </div>
  );
}
