import { useEffect, useMemo, useRef, useState } from "react";
import { financeApi, academicsApi } from "../../services/api";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const currency = (value) =>
  Number(value || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

// Work in whole cents so 3,000.10 + 3,999.90 === 7,000 exactly.
const toCents = (v) => Math.round(Number(v || 0) * 100);

const METHOD_LABEL = { MPESA: "M-Pesa", BANK: "Bank", CASH: "Cash", CHEQUE: "Cheque" };

const METHOD_OPTIONS = [
  { value: "MPESA", label: "M-Pesa" },
  { value: "BANK", label: "Bank" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
];

// Turns a DRF error response into one readable sentence.
const errText = (err, fallback = "Something went wrong. Please try again.") => {
  const d = err?.response?.data;
  if (!d) return err?.message || fallback;
  if (typeof d === "string") return d.slice(0, 300);
  if (d.detail) return d.detail;
  const flat = (v) =>
    Array.isArray(v)
      ? v.map(flat).join(" ")
      : v && typeof v === "object"
      ? Object.values(v).map(flat).join(" ")
      : String(v);
  return Object.entries(d)
    .map(([k, v]) => (k === "non_field_errors" ? flat(v) : `${k.replaceAll("_", " ")}: ${flat(v)}`))
    .join(" | ");
};

// "Owes KES x" / "Credit KES x" / "Fully paid"
const balanceText = (balance) => {
  const b = Number(balance || 0);
  if (b > 0) return { text: `Owes KES ${currency(b)}`, color: "var(--danger-600, #dc3545)" };
  if (b < 0) return { text: `Credit KES ${currency(Math.abs(b))}`, color: "var(--success-600, #198754)" };
  return { text: "Fully paid", color: "var(--ink-600, #475569)" };
};

const formatDateTime = (value) => (value ? new Date(value).toLocaleString("en-KE") : "-");

let rowCounter = 0;
const newRow = () => ({
  key: ++rowCounter,
  admission_no: "",
  amount: "",
  info: { status: "idle", data: null, error: "" },
});

// One-line result of a student lookup, shown under an admission number field.
function LookupNote({ info }) {
  if (info.status === "loading") {
    return (
      <div className="form-text-hint">
        <span className="spinner-border spinner-border-sm me-1"></span>
        Looking up...
      </div>
    );
  }
  if (info.status === "error") {
    return (
      <div className="form-text-hint text-danger">
        <i className="bi bi-exclamation-circle me-1"></i>
        {info.error}
      </div>
    );
  }
  if (info.status === "ok" && info.data) {
    const bal = balanceText(info.data.balance);
    return (
      <div className="form-text-hint">
        <strong>{info.data.student_name}</strong> · {info.data.classroom} ·{" "}
        <span style={{ color: bal.color, fontWeight: 600 }}>{bal.text}</span>
        {info.data.is_active === false && <span className="badge badge-neutral ms-1">Alumni</span>}
      </div>
    );
  }
  return null;
}

async function lookupStudent(admissionNo) {
  const { data } = await financeApi.studentLookup(admissionNo.trim());
  return data;
}

// ===========================================================================
// 1. SPLIT PAYMENT
//    One M-Pesa code / one deposit shared by several students.
//    Each student gets their own receipt; all share the same reference.
// ===========================================================================
export function SplitPaymentPanel({ onMessage, onPrint, onChanged }) {
  const [method, setMethod] = useState("MPESA");
  const [reference, setReference] = useState("");
  const [totalReceived, setTotalReceived] = useState("");
  const [rows, setRows] = useState([newRow(), newRow()]);

  const [refUsage, setRefUsage] = useState(null); // { count, total, receipts }
  const [refChecking, setRefChecking] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [receipts, setReceipts] = useState([]); // result of the last successful split
  const [printingId, setPrintingId] = useState(null);

  const updateRow = (key, patch) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (key) => setRows((prev) => (prev.length > 2 ? prev.filter((r) => r.key !== key) : prev));

  const runLookup = async (row) => {
    const adm = row.admission_no.trim();
    if (!adm) {
      updateRow(row.key, { info: { status: "idle", data: null, error: "" } });
      return;
    }
    updateRow(row.key, { info: { status: "loading", data: null, error: "" } });
    try {
      const data = await lookupStudent(adm);
      updateRow(row.key, { info: { status: "ok", data, error: "" } });
    } catch (err) {
      updateRow(row.key, {
        info: { status: "error", data: null, error: errText(err, "Student not found.") },
      });
    }
  };

  // Warn when the same M-Pesa code / reference was already used on another receipt.
  const checkReference = async () => {
    const ref = reference.trim();
    if (!ref) {
      setRefUsage(null);
      return;
    }
    setRefChecking(true);
    try {
      const { data } = await financeApi.referenceUsage(ref);
      setRefUsage(data.count > 0 ? data : null);
    } catch {
      setRefUsage(null);
    } finally {
      setRefChecking(false);
    }
  };

  const allocatedCents = useMemo(() => rows.reduce((sum, r) => sum + toCents(r.amount), 0), [rows]);
  const receivedCents = toCents(totalReceived);
  const differenceCents = receivedCents - allocatedCents;

  const duplicateAdmissions = useMemo(() => {
    const seen = new Set();
    const dupes = new Set();
    rows.forEach((r) => {
      const a = r.admission_no.trim();
      if (!a) return;
      if (seen.has(a)) dupes.add(a);
      seen.add(a);
    });
    return dupes;
  }, [rows]);

  const rowsComplete = rows.every((r) => r.admission_no.trim() && toCents(r.amount) > 0);
  const canSubmit =
    !saving &&
    rowsComplete &&
    receivedCents > 0 &&
    differenceCents === 0 &&
    duplicateAdmissions.size === 0 &&
    rows.length >= 2;

  const reset = () => {
    setReference("");
    setTotalReceived("");
    setRows([newRow(), newRow()]);
    setRefUsage(null);
    setError("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const { data } = await financeApi.paySplit({
        method,
        reference: reference.trim(),
        total_received: totalReceived,
        allocations: rows.map((r) => ({ admission_no: r.admission_no.trim(), amount: r.amount })),
      });
      setReceipts(data.receipts || []);
      onMessage?.(
        `Split payment of KES ${currency(totalReceived)} recorded across ${data.receipts?.length || rows.length} students.`,
        "success"
      );
      onChanged?.();
      reset();
    } catch (err) {
      setError(errText(err, "Could not record the split payment."));
    } finally {
      setSaving(false);
    }
  };

  const print = async (receipt) => {
    setPrintingId(receipt.payment_id);
    try {
      await onPrint?.({ id: receipt.payment_id });
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <>
      <div className="card p-4 mb-4">
        <h6 className="mb-1" style={{ fontWeight: 700, color: "var(--ink-900)" }}>
          <i className="bi bi-diagram-2 me-2" style={{ color: "var(--blue-700)" }}></i>
          Split Payment
        </h6>
        <p className="text-muted-soft mb-3" style={{ fontSize: "var(--fs-sm)" }}>
          Use this when one payment (one M-Pesa code or one bank slip) covers several students, for example
          KES 7,000 shared as 3,000 and 4,000. Each student gets their own receipt, and the amounts must add up to
          exactly what was received.
        </p>

        <form onSubmit={submit}>
          {error && (
            <div className="alert alert-danger py-2" style={{ fontSize: "var(--fs-sm)" }}>
              {error}
            </div>
          )}

          <div className="row g-3 mb-3">
            <div className="col-md-3">
              <label className="form-label">Method</label>
              <select className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-5">
              <label className="form-label">Reference</label>
              <div className="input-group">
                <input
                  className="form-control"
                  placeholder="M-Pesa code / slip no."
                  value={reference}
                  maxLength={60}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setRefUsage(null);
                  }}
                  onBlur={checkReference}
                />
                {refChecking && (
                  <span className="input-group-text bg-white">
                    <span className="spinner-border spinner-border-sm"></span>
                  </span>
                )}
              </div>
              {refUsage && (
                <div className="alert alert-warning py-2 mt-2 mb-0" style={{ fontSize: "var(--fs-sm)" }}>
                  <i className="bi bi-exclamation-triangle me-1"></i>
                  This reference is already on {refUsage.count} receipt{refUsage.count !== 1 ? "s" : ""} (KES{" "}
                  {currency(refUsage.total)} in total):
                  <ul className="mb-0 mt-1 ps-3">
                    {refUsage.receipts.map((r, i) => (
                      <li key={i}>
                        {r.receipt_no} · {r.student_name} ({r.admission_no}) · KES {currency(r.amount)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="col-md-4">
              <label className="form-label">Total Received (KES)</label>
              <input
                type="number"
                className="form-control"
                min="0.01"
                step="0.01"
                required
                value={totalReceived}
                onChange={(e) => setTotalReceived(e.target.value)}
              />
            </div>
          </div>

          <div className="border rounded-3 overflow-hidden mb-3">
            <div
              className="px-3 py-2 d-flex justify-content-between align-items-center"
              style={{ background: "var(--surface-100, #f8f9fa)" }}
            >
              <span style={{ fontWeight: 600 }}>Students sharing this payment</span>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={addRow}>
                <i className="bi bi-plus-lg me-1"></i>
                Add student
              </button>
            </div>

            {rows.map((row, idx) => (
              <div key={row.key} className="row g-2 px-3 py-3 border-top align-items-start">
                <div className="col-md-5">
                  <label className="form-label mb-1">Student {idx + 1} · Admission No.</label>
                  <input
                    className="form-control"
                    placeholder="e.g. 00081"
                    value={row.admission_no}
                    onChange={(e) =>
                      updateRow(row.key, {
                        admission_no: e.target.value,
                        info: { status: "idle", data: null, error: "" },
                      })
                    }
                    onBlur={() => runLookup(row)}
                  />
                  {duplicateAdmissions.has(row.admission_no.trim()) && row.admission_no.trim() && (
                    <div className="form-text-hint text-danger">This student is listed more than once.</div>
                  )}
                  <LookupNote info={row.info} />
                </div>
                <div className="col-md-4">
                  <label className="form-label mb-1">Amount (KES)</label>
                  <input
                    type="number"
                    className="form-control"
                    min="1"
                    step="0.01"
                    value={row.amount}
                    onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                  />
                </div>
                <div className="col-md-3 d-flex align-items-end" style={{ minHeight: 58 }}>
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length <= 2}
                    title={rows.length <= 2 ? "A split needs at least two students" : "Remove this student"}
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* running tally */}
          <div
            className="d-flex flex-wrap justify-content-between align-items-center p-3 rounded-3 mb-3"
            style={{
              background: differenceCents === 0 && receivedCents > 0 ? "#f0fdf4" : "#fffbeb",
              border: `1px solid ${differenceCents === 0 && receivedCents > 0 ? "#bbf7d0" : "#fde68a"}`,
            }}
          >
            <div>
              <div className="text-muted-soft" style={{ fontSize: "var(--fs-xs)" }}>
                Allocated so far
              </div>
              <div className="fw-bold">
                KES {currency(allocatedCents / 100)} of KES {currency(receivedCents / 100)}
              </div>
            </div>
            <div className="text-end">
              {receivedCents === 0 ? (
                <span className="text-muted-soft">Enter the total received.</span>
              ) : differenceCents === 0 ? (
                <span className="text-success fw-bold">
                  <i className="bi bi-check-circle-fill me-1"></i>
                  Amounts match
                </span>
              ) : differenceCents > 0 ? (
                <span style={{ color: "#b45309", fontWeight: 600 }}>
                  KES {currency(differenceCents / 100)} still to allocate
                </span>
              ) : (
                <span className="text-danger fw-bold">
                  KES {currency(Math.abs(differenceCents) / 100)} over the total received
                </span>
              )}
            </div>
          </div>

          <div className="d-flex justify-content-end gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={reset} disabled={saving}>
              Clear
            </button>
            <button type="submit" className="btn btn-success" disabled={!canSubmit}>
              {saving ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Recording...
                </>
              ) : (
                <>
                  <i className="bi bi-check2-circle me-1"></i>
                  Record Split Payment
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {receipts.length > 0 && (
        <div className="card p-4 mb-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h6 className="mb-0" style={{ fontWeight: 700, color: "var(--ink-900)" }}>
              <i className="bi bi-receipt-cutoff me-2" style={{ color: "var(--success-600, #198754)" }}></i>
              Receipts issued
            </h6>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setReceipts([])}>
              Dismiss
            </button>
          </div>
          <div className="table-responsive">
            <table className="table table-sm mb-0">
              <thead>
                <tr>
                  <th>Receipt No</th>
                  <th>Admission No</th>
                  <th>Student</th>
                  <th className="text-end">Amount</th>
                  <th className="text-center">Print</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.receipt_no}>
                    <td className="fw-bold">{r.receipt_no}</td>
                    <td>{r.admission_no}</td>
                    <td>{r.student_name}</td>
                    <td className="text-end fw-bold" style={{ color: "var(--success-600, #198754)" }}>
                      KES {currency(r.amount)}
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        onClick={() => print(r)}
                        disabled={printingId === r.payment_id}
                      >
                        {printingId === r.payment_id ? (
                          <span className="spinner-border spinner-border-sm"></span>
                        ) : (
                          <i className="bi bi-printer"></i>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// 2. CORRECT RECEIPT
//    Fix a receipt that was recorded wrongly (wrong student, amount, method,
//    reference) or void it. The receipt number and original date are kept.
//    Admin / Finance only (the backend enforces this).
// ===========================================================================
export function CorrectReceiptPanel({ onMessage, onPrint, onChanged }) {
  const [receiptNo, setReceiptNo] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [found, setFound] = useState(null); // lookup payload (found or voided)

  const [mode, setMode] = useState("correct"); // "correct" | "void"
  const [form, setForm] = useState({ new_admission_no: "", new_amount: "", new_method: "", new_reference: "" });
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [newStudentInfo, setNewStudentInfo] = useState({ status: "idle", data: null, error: "" });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { voided, receipt_no, payment_id }
  const [printing, setPrinting] = useState(false);

  const resetForm = (payload) => {
    setMode("correct");
    setForm({
      new_admission_no: "",
      new_amount: "",
      new_method: payload?.method || "",
      new_reference: payload?.reference || "",
    });
    setReason("");
    setConfirmed(false);
    setNewStudentInfo({ status: "idle", data: null, error: "" });
    setError("");
  };

  const search = async (e, keepResult = false) => {
    e?.preventDefault();
    const no = receiptNo.trim().toUpperCase();
    if (!no) return;
    setSearching(true);
    setSearchError("");
    setFound(null);
    if (!keepResult) setResult(null);
    try {
      const { data } = await financeApi.receiptLookup(no);
      setFound(data);
      resetForm(data);
    } catch (err) {
      setSearchError(errText(err, "No receipt found with this number."));
    } finally {
      setSearching(false);
    }
  };

  const lookupNewStudent = async () => {
    const adm = form.new_admission_no.trim();
    if (!adm) {
      setNewStudentInfo({ status: "idle", data: null, error: "" });
      return;
    }
    setNewStudentInfo({ status: "loading", data: null, error: "" });
    try {
      const data = await lookupStudent(adm);
      setNewStudentInfo({ status: "ok", data, error: "" });
    } catch (err) {
      setNewStudentInfo({ status: "error", data: null, error: errText(err, "Student not found.") });
    }
  };

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  // Only the fields that actually differ from the current receipt are sent.
  const changes = useMemo(() => {
    if (!found?.found) return {};
    const out = {};
    const adm = form.new_admission_no.trim();
    if (adm && adm !== found.admission_no) out.new_admission_no = adm;
    if (form.new_amount !== "" && toCents(form.new_amount) !== toCents(found.amount)) {
      out.new_amount = form.new_amount;
    }
    if (form.new_method && form.new_method !== found.method) out.new_method = form.new_method;
    if (form.new_reference.trim() !== (found.reference || "")) out.new_reference = form.new_reference.trim();
    return out;
  }, [form, found]);

  const hasChanges = Object.keys(changes).length > 0;
  const canSubmit =
    !saving && confirmed && reason.trim().length > 0 && (mode === "void" || hasChanges) && found?.found;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const payload =
        mode === "void"
          ? { receipt_no: found.receipt_no, reason: reason.trim(), void: true }
          : { receipt_no: found.receipt_no, reason: reason.trim(), void: false, ...changes };
      const { data } = await financeApi.correctReceipt(payload);

      setResult(data);
      onMessage?.(
        data.voided ? `Receipt ${data.receipt_no} has been voided.` : `Receipt ${data.receipt_no} has been corrected.`,
        "success"
      );
      onChanged?.();
      await search(null, true); // refresh details + correction history
    } catch (err) {
      setError(errText(err, "Could not save this correction."));
    } finally {
      setSaving(false);
    }
  };

  const print = async () => {
    if (!result?.payment_id) return;
    setPrinting(true);
    try {
      await onPrint?.({ id: result.payment_id });
    } finally {
      setPrinting(false);
    }
  };

  const bal = found?.found ? balanceText(found.balance) : null;

  return (
    <>
      <div className="card p-4 mb-4">
        <h6 className="mb-1" style={{ fontWeight: 700, color: "var(--ink-900)" }}>
          <i className="bi bi-pencil-square me-2" style={{ color: "var(--blue-700)" }}></i>
          Correct a Receipt
        </h6>
        <p className="text-muted-soft mb-3" style={{ fontSize: "var(--fs-sm)" }}>
          Recorded a payment against the wrong student or with the wrong amount? Find the receipt, then correct or
          void it. The receipt number and date stay the same, so the printed receipt and its QR code remain valid.
          Every change is saved in an audit trail.
        </p>

        <form onSubmit={search} className="row g-2 align-items-end">
          <div className="col-md-6">
            <label className="form-label">Receipt Number</label>
            <div className="input-group">
              <span className="input-group-text bg-white">
                <i className="bi bi-receipt"></i>
              </span>
              <input
                className="form-control"
                placeholder="e.g. RCT-2026-00123"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-primary" disabled={searching || !receiptNo.trim()}>
              {searching ? (
                <span className="spinner-border spinner-border-sm me-2"></span>
              ) : (
                <i className="bi bi-search me-2"></i>
              )}
              Find Receipt
            </button>
          </div>
        </form>

        {searchError && (
          <div className="alert alert-warning py-2 mt-3 mb-0" style={{ fontSize: "var(--fs-sm)" }}>
            <i className="bi bi-info-circle me-1"></i>
            {searchError}
          </div>
        )}
      </div>

      {result && (
        <div className={`alert ${result.voided ? "alert-secondary" : "alert-success"} d-flex align-items-center`}>
          <div className="flex-grow-1">
            {result.voided ? (
              <>
                Receipt <strong>{result.receipt_no}</strong> was voided and the student's balance has been
                recalculated.
              </>
            ) : (
              <>
                Receipt <strong>{result.receipt_no}</strong> was corrected and the student's balance has been
                recalculated.
              </>
            )}
          </div>
          {!result.voided && result.payment_id && (
            <button type="button" className="btn btn-sm btn-primary ms-3" onClick={print} disabled={printing}>
              {printing ? (
                <span className="spinner-border spinner-border-sm me-2"></span>
              ) : (
                <i className="bi bi-printer me-2"></i>
              )}
              Print corrected receipt
            </button>
          )}
        </div>
      )}

      {/* ---- voided receipt: only history is left ---- */}
      {found && !found.found && found.voided && (
        <div className="card p-4 mb-4">
          <h6 className="mb-2" style={{ fontWeight: 700 }}>
            <i className="bi bi-slash-circle me-2 text-secondary"></i>
            Receipt {found.receipt_no} has been voided
          </h6>
          <p className="text-muted-soft" style={{ fontSize: "var(--fs-sm)" }}>
            No payment rows remain under this number. Its correction history is below.
          </p>
          <HistoryTable history={found.history} />
        </div>
      )}

      {/* ---- live receipt ---- */}
      {found?.found && (
        <>
          <div className="card p-4 mb-4">
            <h6 className="mb-3" style={{ fontWeight: 700, color: "var(--ink-900)" }}>
              Receipt {found.receipt_no}
            </h6>
            <div className="row g-3">
              <div className="col-md-6">
                <DetailRow label="Student" value={`${found.student_name} (${found.admission_no})`} />
                <DetailRow label="Class" value={found.classroom || "-"} />
                <DetailRow
                  label="Amount"
                  value={<strong style={{ color: "var(--success-600, #198754)" }}>KES {currency(found.amount)}</strong>}
                />
                <DetailRow label="Method" value={METHOD_LABEL[found.method] || found.method} />
              </div>
              <div className="col-md-6">
                <DetailRow label="Reference" value={found.reference || "-"} />
                <DetailRow label="Date" value={formatDateTime(found.paid_at)} />
                <DetailRow label="Recorded by" value={found.recorded_by_name || "-"} />
                <DetailRow
                  label="Current balance"
                  value={
                    <strong style={{ color: bal.color }}>{bal.text}</strong>
                  }
                />
              </div>
            </div>

            {found.pieces?.length > 1 && (
              <div className="mt-3">
                <div className="text-muted-soft mb-1" style={{ fontSize: "var(--fs-sm)" }}>
                  Applied to
                </div>
                <table className="table table-sm mb-0">
                  <tbody>
                    {found.pieces.map((p, i) => (
                      <tr key={i}>
                        <td>{p.term}</td>
                        <td className="text-end">KES {currency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card p-4 mb-4">
            <div className="btn-group mb-3" role="group" style={{ maxWidth: 360 }}>
              <button
                type="button"
                className={`btn ${mode === "correct" ? "btn-primary" : "btn-outline-secondary"}`}
                onClick={() => {
                  setMode("correct");
                  setConfirmed(false);
                }}
              >
                <i className="bi bi-pencil me-1"></i>
                Correct details
              </button>
              <button
                type="button"
                className={`btn ${mode === "void" ? "btn-danger" : "btn-outline-secondary"}`}
                onClick={() => {
                  setMode("void");
                  setConfirmed(false);
                }}
              >
                <i className="bi bi-slash-circle me-1"></i>
                Void receipt
              </button>
            </div>

            <form onSubmit={submit}>
              {error && (
                <div className="alert alert-danger py-2" style={{ fontSize: "var(--fs-sm)" }}>
                  {error}
                </div>
              )}

              {mode === "correct" ? (
                <>
                  <p className="text-muted-soft" style={{ fontSize: "var(--fs-sm)" }}>
                    Change only what was wrong. Fields you leave as they are will not be touched.
                  </p>
                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <label className="form-label">Move to another student (admission no.)</label>
                      <input
                        className="form-control"
                        placeholder={`Currently ${found.admission_no}`}
                        value={form.new_admission_no}
                        onChange={(e) => {
                          setField("new_admission_no", e.target.value);
                          setNewStudentInfo({ status: "idle", data: null, error: "" });
                        }}
                        onBlur={lookupNewStudent}
                      />
                      <LookupNote info={newStudentInfo} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Correct amount (KES)</label>
                      <input
                        type="number"
                        className="form-control"
                        min="0.01"
                        step="0.01"
                        placeholder={`Currently ${currency(found.amount)}`}
                        value={form.new_amount}
                        onChange={(e) => setField("new_amount", e.target.value)}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Method</label>
                      <select
                        className="form-select"
                        value={form.new_method}
                        onChange={(e) => setField("new_method", e.target.value)}
                      >
                        {METHOD_OPTIONS.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Reference</label>
                      <input
                        className="form-control"
                        maxLength={60}
                        value={form.new_reference}
                        onChange={(e) => setField("new_reference", e.target.value)}
                      />
                    </div>
                  </div>

                  {hasChanges && (
                    <div className="alert alert-light border py-2" style={{ fontSize: "var(--fs-sm)" }}>
                      <strong>This will change:</strong>
                      <ul className="mb-0 ps-3">
                        {changes.new_admission_no && (
                          <li>
                            Student: {found.admission_no} → {changes.new_admission_no}
                            {newStudentInfo.status === "ok" && ` (${newStudentInfo.data.student_name})`}
                          </li>
                        )}
                        {changes.new_amount && (
                          <li>
                            Amount: KES {currency(found.amount)} → KES {currency(changes.new_amount)}
                          </li>
                        )}
                        {changes.new_method && (
                          <li>
                            Method: {METHOD_LABEL[found.method] || found.method} → {METHOD_LABEL[changes.new_method]}
                          </li>
                        )}
                        {"new_reference" in changes && (
                          <li>
                            Reference: {found.reference || "-"} → {changes.new_reference || "-"}
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="alert alert-danger py-2" style={{ fontSize: "var(--fs-sm)" }}>
                  <i className="bi bi-exclamation-triangle me-1"></i>
                  Voiding removes the whole payment of <strong>KES {currency(found.amount)}</strong> from{" "}
                  {found.student_name}'s account and recalculates their balance. The receipt number stays on record
                  as voided.
                </div>
              )}

              <div className="mb-3">
                <label className="form-label">Reason for this change (required)</label>
                <input
                  className="form-control"
                  maxLength={255}
                  placeholder="e.g. Paid under the wrong admission number"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              <div
                className="form-check mb-3 p-2 ps-5 rounded-2"
                style={{ background: "#fef2f2", border: "1px solid #fecaca" }}
              >
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="confirmCorrection"
                  checked={confirmed}
                  disabled={saving}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <label
                  className="form-check-label"
                  htmlFor="confirmCorrection"
                  style={{ fontSize: "var(--fs-sm)", fontWeight: 600, color: "#b91c1c" }}
                >
                  I have checked the paper receipt and the payment proof, and I want to{" "}
                  {mode === "void" ? "void" : "correct"} receipt {found.receipt_no}.
                </label>
              </div>

              <div className="d-flex justify-content-end">
                <button
                  type="submit"
                  className={`btn ${mode === "void" ? "btn-danger" : "btn-success"}`}
                  disabled={!canSubmit}
                >
                  {saving ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2"></span>
                      Saving...
                    </>
                  ) : mode === "void" ? (
                    <>
                      <i className="bi bi-slash-circle me-1"></i>
                      Void Receipt
                    </>
                  ) : (
                    <>
                      <i className="bi bi-check2-circle me-1"></i>
                      Save Correction
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {found.history?.length > 0 && (
            <div className="card p-4 mb-4">
              <h6 className="mb-3" style={{ fontWeight: 700, color: "var(--ink-900)" }}>
                <i className="bi bi-clock-history me-2" style={{ color: "var(--blue-700)" }}></i>
                Correction history
              </h6>
              <HistoryTable history={found.history} />
            </div>
          )}
        </>
      )}
    </>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="d-flex justify-content-between py-1 border-bottom" style={{ fontSize: "var(--fs-sm)" }}>
      <span className="text-muted-soft">{label}</span>
      <span className="text-end">{value}</span>
    </div>
  );
}

function HistoryTable({ history }) {
  if (!history || history.length === 0) {
    return <div className="text-muted-soft">No corrections have been made to this receipt.</div>;
  }
  return (
    <div className="table-responsive">
      <table className="table table-sm mb-0" style={{ fontSize: "var(--fs-sm)" }}>
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>By</th>
            <th>Student</th>
            <th className="text-end">Amount</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h, i) => (
            <tr key={i}>
              <td>{formatDateTime(h.at)}</td>
              <td>
                <span className={`badge ${h.action === "VOIDED" ? "badge-neutral" : "badge-gold"}`}>
                  {h.action === "VOIDED" ? "Voided" : "Corrected"}
                </span>
              </td>
              <td>{h.by}</td>
              <td>
                {h.before_student || "-"}
                {h.after_student && h.after_student !== h.before_student ? ` → ${h.after_student}` : ""}
              </td>
              <td className="text-end">
                {h.before_amount != null ? `KES ${currency(h.before_amount)}` : "-"}
                {h.after_amount != null && h.after_amount !== h.before_amount
                  ? ` → KES ${currency(h.after_amount)}`
                  : ""}
              </td>
              <td>{h.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// 3. ALUMNI BALANCE
//    Bring a past student who still owes fees into the system, without making
//    them a current student. Creates an inactive profile and ONE opening
//    balance invoice, so Pay Balance, receipts and QR codes all work as usual.
// ===========================================================================
const EMPTY_ALUMNI = {
  first_name: "",
  last_name: "",
  admission_no: "",
  gender: "M",
  balance: "",
  year_left: String(new Date().getFullYear() - 1),
  grade_level_id: "",
  stream_id: "",
  phone_number: "",
  guardian_name: "",
  guardian_phone: "",
  guardian_relationship: "GUARDIAN",
};

export function AlumniBalancePanel({ onMessage }) {
  const [form, setForm] = useState(EMPTY_ALUMNI);
  const [gradeLevels, setGradeLevels] = useState([]);
  const [streams, setStreams] = useState([]);
  const [optionsError, setOptionsError] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null); // { admission_no, student_name, balance }
  const firstFieldRef = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.all([academicsApi.gradeLevels(), academicsApi.streams()])
      .then(([g, s]) => {
        if (!active) return;
        setGradeLevels(g.data.results ?? g.data);
        setStreams(s.data.results ?? s.data);
      })
      .catch(() => active && setOptionsError("Could not load grades and streams. Refresh the page to try again."));
    return () => {
      active = false;
    };
  }, []);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit =
    !saving &&
    form.first_name.trim() &&
    form.last_name.trim() &&
    form.admission_no.trim() &&
    toCents(form.balance) > 0 &&
    form.year_left &&
    form.grade_level_id;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        admission_no: form.admission_no.trim(),
        gender: form.gender,
        balance: form.balance,
        year_left: Number(form.year_left),
        grade_level_id: Number(form.grade_level_id),
        guardian_relationship: form.guardian_relationship,
      };
      if (form.stream_id) payload.stream_id = Number(form.stream_id);
      if (form.phone_number.trim()) payload.phone_number = form.phone_number.trim();
      if (form.guardian_name.trim()) payload.guardian_name = form.guardian_name.trim();
      if (form.guardian_phone.trim()) payload.guardian_phone = form.guardian_phone.trim();

      const { data } = await financeApi.addAlumniBalance(payload);
      setCreated(data);
      onMessage?.(
        `${data.student_name} (${data.admission_no}) was added with a balance of KES ${currency(data.balance)}. ` +
          "You can now record their payments from the Payment tab.",
        "success"
      );
      setForm(EMPTY_ALUMNI);
      firstFieldRef.current?.focus();
    } catch (err) {
      setError(errText(err, "Could not add this alumni balance."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card p-4 mb-4">
        <h6 className="mb-1" style={{ fontWeight: 700, color: "var(--ink-900)" }}>
          <i className="bi bi-mortarboard me-2" style={{ color: "var(--blue-700)" }}></i>
          Add Alumni Balance
        </h6>
        <p className="text-muted-soft mb-3" style={{ fontSize: "var(--fs-sm)" }}>
          Register a past student who still owes fees. They are saved as alumni, not as a current student, with one
          opening balance. Afterwards, search them by admission number on the Payment tab to record what they pay.
        </p>

        {optionsError && (
          <div className="alert alert-warning py-2" style={{ fontSize: "var(--fs-sm)" }}>
            {optionsError}
          </div>
        )}
        {error && (
          <div className="alert alert-danger py-2" style={{ fontSize: "var(--fs-sm)" }}>
            {error}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="fw-bold mb-2" style={{ fontSize: "var(--fs-sm)" }}>
            Student
          </div>
          <div className="row g-3 mb-4">
            <div className="col-md-4">
              <label className="form-label">First name</label>
              <input
                ref={firstFieldRef}
                className="form-control"
                required
                value={form.first_name}
                onChange={(e) => setField("first_name", e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label">Last name</label>
              <input
                className="form-control"
                required
                value={form.last_name}
                onChange={(e) => setField("last_name", e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label className="form-label">Gender</label>
              <select className="form-select" value={form.gender} onChange={(e) => setField("gender", e.target.value)}>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Admission No.</label>
              <input
                className="form-control"
                required
                maxLength={30}
                placeholder="Old number"
                value={form.admission_no}
                onChange={(e) => setField("admission_no", e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label">Phone (optional)</label>
              <input
                className="form-control"
                maxLength={20}
                value={form.phone_number}
                onChange={(e) => setField("phone_number", e.target.value)}
              />
            </div>
          </div>

          <div className="fw-bold mb-2" style={{ fontSize: "var(--fs-sm)" }}>
            Last class and balance
          </div>
          <div className="row g-3 mb-4">
            <div className="col-md-3">
              <label className="form-label">Grade / Form they left from</label>
              <select
                className="form-select"
                required
                value={form.grade_level_id}
                onChange={(e) => setField("grade_level_id", e.target.value)}
              >
                <option value="">Select grade</option>
                {gradeLevels.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.curriculum_type})
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Stream (optional)</label>
              <select className="form-select" value={form.stream_id} onChange={(e) => setField("stream_id", e.target.value)}>
                <option value="">First stream</option>
                {streams.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Year they left</label>
              <input
                type="number"
                className="form-control"
                required
                min="1990"
                max={new Date().getFullYear()}
                value={form.year_left}
                onChange={(e) => setField("year_left", e.target.value)}
              />
              <div className="form-text-hint">Must be before the current academic year.</div>
            </div>
            <div className="col-md-3">
              <label className="form-label">Balance owed (KES)</label>
              <input
                type="number"
                className="form-control"
                required
                min="1"
                step="0.01"
                value={form.balance}
                onChange={(e) => setField("balance", e.target.value)}
              />
            </div>
          </div>

          <div className="fw-bold mb-2" style={{ fontSize: "var(--fs-sm)" }}>
            Guardian (optional)
          </div>
          <div className="row g-3 mb-4">
            <div className="col-md-4">
              <label className="form-label">Guardian name</label>
              <input
                className="form-control"
                value={form.guardian_name}
                onChange={(e) => setField("guardian_name", e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label">Guardian phone</label>
              <input
                className="form-control"
                maxLength={20}
                value={form.guardian_phone}
                onChange={(e) => setField("guardian_phone", e.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label">Relationship</label>
              <select
                className="form-select"
                value={form.guardian_relationship}
                onChange={(e) => setField("guardian_relationship", e.target.value)}
              >
                <option value="MOTHER">Mother</option>
                <option value="FATHER">Father</option>
                <option value="GUARDIAN">Guardian</option>
              </select>
            </div>
          </div>

          <div className="d-flex justify-content-end gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={saving}
              onClick={() => {
                setForm(EMPTY_ALUMNI);
                setError("");
              }}
            >
              Clear
            </button>
            <button type="submit" className="btn btn-success" disabled={!canSubmit}>
              {saving ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Saving...
                </>
              ) : (
                <>
                  <i className="bi bi-person-plus me-1"></i>
                  Add Alumni Balance
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {created && (
        <div className="card p-4 mb-4">
          <div className="d-flex justify-content-between align-items-start">
            <div>
              <h6 className="mb-1" style={{ fontWeight: 700 }}>
                <i className="bi bi-check-circle-fill me-2 text-success"></i>
                {created.student_name} added
              </h6>
              <div className="text-muted-soft" style={{ fontSize: "var(--fs-sm)" }}>
                Admission No. <strong>{created.admission_no}</strong> · Opening balance{" "}
                <strong style={{ color: "var(--danger-600, #dc3545)" }}>KES {currency(created.balance)}</strong>
              </div>
            </div>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setCreated(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}