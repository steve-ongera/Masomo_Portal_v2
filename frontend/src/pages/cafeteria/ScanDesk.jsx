import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { mealApi } from "../../services/api";

const MEALS = [
  ["BREAKFAST", "Breakfast"],
  ["MORNING_SNACK", "Morning Snack"],
  ["LUNCH", "Lunch"],
  ["AFTERNOON_SNACK", "Afternoon Snack"],
  ["SUPPER", "Supper"],
];
const QUEUE_KEY = "meal_offline_queue";
const ROSTER_KEY = "meal_roster";

const RESULT_TONE = {
  issued: { alert: "alert-success", icon: "bi-check2-circle", label: "Meal Issued" },
  eligible: { alert: "alert-primary", icon: "bi-person-check", label: "Student Found" },
  notEligible: { alert: "alert-danger", icon: "bi-x-circle", label: "Not Eligible" },
  notFound: { alert: "alert-danger", icon: "bi-question-circle", label: "Card Not Found" },
};

const guessMeal = () => {
  const h = new Date().getHours();
  if (h < 9) return "BREAKFAST";
  if (h < 11) return "MORNING_SNACK";
  if (h < 15) return "LUNCH";
  if (h < 17) return "AFTERNOON_SNACK";
  return "SUPPER";
};

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

export default function ScanDesk() {
  const [meal, setMeal] = useState(guessMeal());
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [autoIssue, setAutoIssue] = useState(false);
  const [queue, setQueue] = useState(() => read(QUEUE_KEY, []));
  const [roster, setRoster] = useState(() => read(ROSTER_KEY, { entries: [] }));
  const [syncReport, setSyncReport] = useState([]);

  const inputRef = useRef(null);
  const queueRef = useRef(queue);
  const lookupRef = useRef(null);

  const saveQueue = (q) => {
    queueRef.current = q;
    setQueue(q);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  };

  const loadRoster = async () => {
    try {
      const { data } = await mealApi.roster();
      localStorage.setItem(ROSTER_KEY, JSON.stringify(data));
      setRoster(data);
    } catch {
      /* keep the cached copy */
    }
  };

  const sync = async () => {
    const pending = queueRef.current;
    if (!pending.length) return;
    try {
      const { data } = await mealApi.sync(pending);
      const sent = new Set(data.results.map((r) => r.client_uuid));
      saveQueue(queueRef.current.filter((q) => !sent.has(q.client_uuid)));
      setSyncReport(
        data.results.filter((r) => r.status === "REJECTED" || r.status === "ERROR")
      );
    } catch {
      /* still offline */
    }
  };

  useEffect(() => {
    loadRoster();
    sync();
    const onOnline = () => {
      sync();
      loadRoster();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offlineLookup = (token) => {
    const entry = roster.entries?.find((r) => r.qr_token === token);
    if (!entry) {
      return setResult({
        found: false,
        reason: "Offline: card is not in today's roster.",
      });
    }
    const queued = queueRef.current.some(
      (q) => q.qr_token === token && q.meal_type === meal
    );
    const included = entry.meals.includes(meal);
    const already = entry.collected.includes(meal) || queued;
    setResult({
      found: true,
      offline: true,
      token,
      eligible: included && !already,
      reason: !included
        ? "Meal not in this student's plan."
        : already
        ? "Already collected."
        : "",
      student: {
        name: entry.name,
        admission_no: entry.admission_no,
        classroom: entry.classroom,
      },
    });
  };

  const queueOffline = (token) => {
    saveQueue([
      ...queueRef.current,
      {
        client_uuid: uuid(),
        qr_token: token,
        meal_type: meal,
        scanned_at: new Date().toISOString(),
      },
    ]);
    setResult((r) => ({ ...r, issued: true, offline: true }));
  };

  const issue = async (token) => {
    setBusy(true);
    try {
      const { data } = await mealApi.issue(token, meal);
      setResult((r) => ({ ...r, issued: true, issued_at: data.collected_at }));
    } catch (e) {
      if (e.response) {
        setResult((r) => ({
          ...r,
          eligible: false,
          reason: e.response.data?.reason || "Could not issue meal.",
        }));
      } else {
        queueOffline(token);
      }
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const lookup = async (raw) => {
    const token = (raw || "").trim();
    if (!token) return;
    setResult(null);
    try {
      const { data } = await mealApi.scan(token, meal);
      setResult({ ...data, token });
      if (autoIssue && data.eligible) issue(token);
    } catch (e) {
      if (e.response?.status === 404)
        setResult({ found: false, reason: "Card not recognised." });
      else if (e.response)
        setResult({ found: false, reason: e.response.data?.detail || "Something went wrong." });
      else offlineLookup(token);
    }
  };
  lookupRef.current = lookup;

  useEffect(() => {
    if (!cameraOn) return undefined;
    const scanner = new Html5Qrcode("qr-reader");
    let last = { text: "", at: 0 };
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        (text) => {
          const now = Date.now();
          if (text === last.text && now - last.at < 3000) return;
          last = { text, at: now };
          lookupRef.current(text);
        },
        () => {}
      )
      .catch(() => setCameraOn(false));
    return () => {
      scanner.stop().then(() => scanner.clear()).catch(() => {});
    };
  }, [cameraOn]);

  const submitManual = (e) => {
    e.preventDefault();
    lookup(manual);
    setManual("");
  };

  const toneKey = !result
    ? null
    : result.issued
    ? "issued"
    : !result.found
    ? "notFound"
    : result.eligible
    ? "eligible"
    : "notEligible";
  const tone = toneKey ? RESULT_TONE[toneKey] : null;

  const mealLabel = MEALS.find((m) => m[0] === meal)?.[1] || meal;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Meal Scan Desk</h1>
          <p className="page-subtitle">
            Scan a student's meal card, check eligibility, then issue the meal
          </p>
        </div>
      </div>

      {/* ---- Current Meal selector ---- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-egg-fried me-2 text-brand"></i>
            Current Meal
          </span>
          <span className="badge badge-blue">
            {mealLabel}
          </span>
        </div>

        <div className="p-3">
          <ul className="nav nav-pills mb-0 flex-wrap gap-1">
            {MEALS.map(([value, label]) => (
              <li className="nav-item" key={value}>
                <button
                  type="button"
                  className={`nav-link ${meal === value ? "active" : ""}`}
                  onClick={() => {
                    setMeal(value);
                    setResult(null);
                  }}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ---- Scan / Enter ---- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-upc-scan me-2 text-brand"></i>
            Scan or Enter Card Code
          </span>
          <div className="d-flex align-items-center gap-2">
            <div className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                id="autoIssue"
                checked={autoIssue}
                onChange={(e) => setAutoIssue(e.target.checked)}
              />
              <label className="form-check-label small" htmlFor="autoIssue">
                Auto-issue when eligible
              </label>
            </div>
          </div>
        </div>

        <div className="p-3">
          <form onSubmit={submitManual}>
            <div className="d-flex flex-wrap gap-2">
              <div className="toolbar__search" style={{ flex: "1 1 260px", maxWidth: "none" }}>
                <i className="bi bi-upc-scan"></i>
                <input
                  ref={inputRef}
                  autoFocus
                  className="form-control"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Scan with USB scanner, or paste the card code or admission number"
                  style={{ fontFamily: "var(--font-mono)" }}
                />
              </div>

              <button className="btn btn-primary" type="submit">
                <i className="bi bi-search me-1"></i>
                Check
              </button>

              <button
                type="button"
                className={`btn ${cameraOn ? "btn-danger" : "btn-outline-secondary"}`}
                onClick={() => setCameraOn((v) => !v)}
              >
                <i className="bi bi-camera me-1"></i>
                {cameraOn ? "Stop Camera" : "Camera"}
              </button>
            </div>
          </form>

          {cameraOn && (
            <div
              id="qr-reader"
              className="note-card p-0 mt-3 mb-0"
              style={{ overflow: "hidden" }}
            />
          )}
        </div>
      </div>

      {/* ---- Result ---- */}
      {result && tone && (
        <div className={`alert ${tone.alert}`} role="status">
          <div className="d-flex align-items-center gap-2 mb-2 fw-bold">
            <i className={`bi ${tone.icon}`}></i>
            <span>{tone.label.toUpperCase()}</span>
            {result.offline && (
              <span className="badge badge-gold ms-1">
                <span className="status-dot status-dot--pending"></span>
                Offline
              </span>
            )}
          </div>

          {result.student && (
            <>
              <div className="d-flex align-items-center gap-2 mb-2 pb-2 border-bottom">
                <div className="avatar-md">
                  {(result.student.name || "")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div className="min-w-0">
                  <div className="cell-name">
                    {result.student.name}
                  </div>
                  <div className="cell-muted small mt-1">
                    ADM {result.student.admission_no}
                    {result.student.classroom ? ` · ${result.student.classroom}` : ""}
                  </div>
                </div>
              </div>

              <div className="d-flex flex-wrap gap-3 small mb-2">
                <span>
                  <strong>{mealLabel}</strong>
                </span>
                {result.plan && <span>{result.plan}</span>}
                {Number(result.price) > 0 && <span>KES {result.price}</span>}
                {result.wallet_balance != null && (
                  <span>Wallet KES {result.wallet_balance}</span>
                )}
              </div>

              {result.on_credit && (
                <div className="d-flex align-items-center gap-2 mb-2 small fw-semibold">
                  <i className="bi bi-exclamation-circle"></i>
                  Wallet is short. Serve the meal anyway: the balance will go negative and the
                  parent pays later.
                </div>
              )}
            </>
          )}

          {!result.eligible && !result.issued && (
            <div className="d-flex align-items-center gap-2 mt-2 fw-semibold">
              <i className="bi bi-exclamation-triangle"></i>
              {result.reason}
            </div>
          )}

          {result.issued && (
            <div className="d-flex align-items-center gap-2 mt-2 fw-semibold">
              <i className="bi bi-check2-circle"></i>
              {result.offline
                ? "Saved on this device. It will sync when you're back online."
                : result.on_credit
                ? "Recorded on credit."
                : "Recorded."}
            </div>
          )}

          {result.eligible && !result.issued && (
            <button
              className="btn btn-success w-100 mt-3"
              disabled={busy}
              onClick={() => issue(result.token)}
            >
              {busy ? (
                "Issuing..."
              ) : (
                <>
                  <i className="bi bi-check2 me-1"></i>
                  Issue Meal
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* ---- Offline queue strip ---- */}
      <div className="table-wrap">
        <div className="table-wrap__footer">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <span className={`badge ${queue.length ? "badge-gold" : "badge-neutral"}`}>
              <span
                className={`status-dot ${
                  queue.length ? "status-dot--pending" : "status-dot--online"
                }`}
              ></span>
              {queue.length} waiting to sync
            </span>

            {queue.length > 0 && (
              <button className="btn btn-sm btn-outline-secondary" onClick={sync}>
                <i className="bi bi-arrow-repeat me-1"></i>
                Sync Now
              </button>
            )}

            <span className="form-text-hint m-0">
              <i className="bi bi-database me-1"></i>
              {roster.entries?.length || 0} students cached for offline
            </span>
          </div>
        </div>
      </div>

      {/* ---- Sync report ---- */}
      {syncReport.length > 0 && (
        <div className="alert alert-warning mt-3" role="alert">
          <div className="d-flex align-items-center gap-2 mb-2 fw-bold">
            <i className="bi bi-exclamation-triangle"></i>
            {syncReport.length} offline scan{syncReport.length === 1 ? " was" : "s were"} rejected
          </div>
          <ul className="mb-0 small" style={{ paddingLeft: "1.2rem" }}>
            {syncReport.map((r) => (
              <li key={r.client_uuid}>
                {r.student ? `${r.student} (${r.meal}): ` : ""}
                {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}