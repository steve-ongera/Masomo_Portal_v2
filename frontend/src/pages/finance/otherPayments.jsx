import { useEffect, useState } from "react";
import { otherPaymentsApi, academicsApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";

/* =====================================================================
   OTHER PAYMENTS - admission, uniform, student ID, graduation, trip,
   damages and any other non-tuition payment.

   Sits next to ./paymentTools (same props pattern: onMessage, onPrint...)
   and is mounted as the "Other Payments" tab on the Payments page.
   These payments never touch school-fee balances or invoices.

   Layout: shown inside the Payments page card, so there is no outer card
   here - just bordered .panel sections (see main.css section 33).
   ===================================================================== */

const currency = (value) =>
  Number(value || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

const METHOD_LABEL = { MPESA: "M-Pesa", BANK: "Bank", CASH: "Cash", CHEQUE: "Cheque" };
const METHOD_BADGE = {
  MPESA: "badge-success",
  BANK: "badge-blue",
  CASH: "badge-gold",
  CHEQUE: "badge-neutral",
};
const METHOD_ICON = {
  MPESA: "bi-phone",
  BANK: "bi-building",
  CASH: "bi-cash",
  CHEQUE: "bi-file-text",
};

const STATUS_PILL = {
  UNPAID: "status-pill status-pill--danger",
  PARTIAL: "status-pill status-pill--warning",
  PAID: "status-pill status-pill--success",
  WAIVED: "status-pill status-pill--neutral",
  CANCELLED: "status-pill status-pill--neutral",
};

const STARTER_TYPES = [
  { name: "Admission Fee", code: "ADMISSION" },
  { name: "Uniform", code: "UNIFORM" },
  { name: "Student ID", code: "STUDENT_ID" },
  { name: "Graduation Fee", code: "GRADUATION" },
  { name: "Trip Fee", code: "TRIP" },
  { name: "Damage Charges", code: "DAMAGES" },
];

// Panel with no padding, for tables that run edge to edge
const FLUSH = { padding: 0, overflow: "hidden" };

const listOf = (res) => res.data?.results ?? res.data ?? [];

const errorText = (err, fallback) => {
  const d = err?.response?.data;
  if (!d || typeof d === "string") return fallback;
  if (d.detail) return d.detail;
  return Object.values(d).flat().join(" ") || fallback;
};

const classroomLabel = (c) =>
  c.name ||
  c.label ||
  c.display_name ||
  [c.grade_level_name, c.stream_name].filter(Boolean).join(" ") ||
  `Classroom #${c.id}`;

const initialsOf = (name = "") =>
  name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();

/* ---------------------------------------------------------------------
   Small shared pieces
   --------------------------------------------------------------------- */

// Method picker (same selectable cards as the Payments page)
function MethodPicker({ value, onChange }) {
  return (
    <div className="option-grid">
      {Object.keys(METHOD_LABEL).map((m) => (
        <button
          key={m}
          type="button"
          className={`option-card${value === m ? " is-selected" : ""}`}
          aria-pressed={value === m}
          onClick={() => onChange(m)}
        >
          <i className={`bi ${METHOD_ICON[m]}`} aria-hidden="true"></i>
          {METHOD_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

// Panel heading: icon + title (+ optional help text)
function PanelHead({ icon, title, children }) {
  return (
    <div className="panel__head">
      <i className={`bi ${icon}`} aria-hidden="true"></i>
      <div>
        <h6 className="panel__title">{title}</h6>
        {children && <p className="panel__text">{children}</p>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Student picker (debounced search -> dropdown)
   --------------------------------------------------------------------- */
function StudentPicker({ onSelect, label = "Admission No. or Student Name", autoFocus = false }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await otherPaymentsApi.lookup(term);
        if (live) setResults(res.data);
      } catch {
        if (live) setResults([]);
      } finally {
        if (live) setLoading(false);
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="position-relative">
      <label className="form-label">{label}</label>
      <div className="input-icon-group">
        <i className="bi bi-person-badge input-icon-leading" aria-hidden="true"></i>
        <input
          className="form-control"
          placeholder="e.g. 00081 or Jane Wanjiru"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={autoFocus}
          autoComplete="off"
        />
        {loading && (
          <span className="input-suffix" style={{ border: "none" }}>
            <span className="spinner-border spinner-border-sm"></span>
          </span>
        )}
      </div>

      {results.length > 0 && (
        <div
          className="panel pick-list"
          style={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            top: "100%",
            marginTop: "0.3rem",
            padding: "0.35rem",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              className="pick-item"
              onClick={() => {
                onSelect(s);
                setQuery("");
                setResults([]);
              }}
            >
              <span>
                <span className="pick-item__adm">{s.admission_no}</span>
                <span className="cell-name">{s.name}</span>
              </span>
              <span className="chip">{s.class_label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------
   1. TAKE PAYMENT
   --------------------------------------------------------------------- */
const EMPTY_DRAFT = { charge_type: "", amount: "", method: "MPESA", reference: "", notes: "" };

function TakePayment({
  types,
  prefill,
  onPrefillDone,
  onGoToTypes,
  onMessage,
  onPrintReceipt,
  onDownloadReceipt,
  printingId,
}) {
  const [student, setStudent] = useState(null);
  const [charge, setCharge] = useState(null); // paying an existing charge, or null = walk-in
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [lastPayment, setLastPayment] = useState(null);

  const activeTypes = types.filter((t) => t.is_active);
  const selectedType = types.find((t) => String(t.id) === String(draft.charge_type));
  const amountNumber = Number(draft.amount || 0);
  const chargeBalance = charge ? Number(charge.balance) : null;
  const balanceAfter = charge ? chargeBalance - amountNumber : null;

  const chooseStudent = (s) => {
    setStudent(s);
    setCharge(null);
    setDraft((d) => ({ ...EMPTY_DRAFT, method: d.method }));
    setError("");
    setLastPayment(null);
  };

  const chooseCharge = (c) => {
    setCharge(c);
    setDraft((d) => ({ ...d, charge_type: String(c.charge_type), amount: c.balance }));
    setError("");
  };

  const clearCharge = () => {
    setCharge(null);
    setDraft((d) => ({ ...d, charge_type: "", amount: "" }));
  };

  const chooseType = (id) => {
    const t = types.find((x) => String(x.id) === String(id));
    setDraft((d) => ({
      ...d,
      charge_type: id,
      amount: t && t.default_amount != null ? String(t.default_amount) : "",
    }));
  };

  const refreshStudent = async (s) => {
    try {
      const res = await otherPaymentsApi.lookup(s.admission_no);
      const fresh = res.data.find((x) => x.id === s.id);
      if (fresh) setStudent(fresh);
    } catch {
      /* keep what is on screen */
    }
  };

  // "Collect" on the Charges list jumps here with the student + charge already chosen.
  useEffect(() => {
    if (!prefill) return;
    (async () => {
      try {
        const res = await otherPaymentsApi.lookup(prefill.admission_no);
        const s = res.data.find((x) => x.id === prefill.student);
        if (s) {
          chooseStudent(s);
          const c = s.open_charges.find((x) => x.id === prefill.id);
          if (c) chooseCharge(c);
        }
      } catch (err) {
        onMessage(errorText(err, "Could not open that charge."), "danger");
      } finally {
        onPrefillDone();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const requestConfirmation = (e) => {
    e.preventDefault();
    if (!student || saving) return;
    if (!draft.charge_type) {
      setError("Choose what this payment is for.");
      return;
    }
    if (!(amountNumber > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (charge && amountNumber > chargeBalance) {
      setError(`This charge only has KES ${currency(chargeBalance)} left to pay.`);
      return;
    }
    setError("");
    setConfirmChecked(false);
    setShowConfirm(true);
  };

  const record = async () => {
    if (!student || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        student: student.id,
        amount: draft.amount,
        method: draft.method,
        reference: draft.reference.trim(),
        notes: draft.notes.trim(),
      };
      if (charge) body.charge = charge.id;
      else body.charge_type = draft.charge_type;

      const { data } = await otherPaymentsApi.record(body);
      setLastPayment(data);
      onMessage(
        `Payment of KES ${currency(data.amount)} recorded for ${data.student_name} (${data.charge_type_name}). Receipt ${data.receipt_no}.`,
        "success"
      );
      setCharge(null);
      setDraft((d) => ({ ...EMPTY_DRAFT, method: d.method }));
      await refreshStudent(student);
    } catch (err) {
      setError(errorText(err, "Could not record this payment."));
    } finally {
      setSaving(false);
      setShowConfirm(false);
      setConfirmChecked(false);
    }
  };

  return (
    <>
      <div className="row g-4">
        {/* ---------- left: student + payment form ---------- */}
        <div className="col-lg-7">
          <div className="panel h-100">
            <PanelHead icon="bi-bag-check" title="Record an Other Payment">
              For admission, uniform, student ID, graduation, trips, damages and anything else that is not
              school fees. These never change the student's fee balance.
            </PanelHead>

            {activeTypes.length === 0 && (
              <div className="alert alert-warning">
                <i className="bi bi-info-circle me-1"></i>
                No payment types have been set up yet.{" "}
                <button type="button" className="btn btn-link p-0 align-baseline" onClick={onGoToTypes}>
                  Add payment types
                </button>
              </div>
            )}

            <StudentPicker onSelect={chooseStudent} autoFocus />

            {student && (
              <div className="pay-student mt-3 mb-0">
                <div className="table-avatar-cell">
                  <div className="avatar avatar-md">{initialsOf(student.name)}</div>
                  <div>
                    <div className="cell-name">{student.name}</div>
                    <div className="balance-card__sub">
                      {student.admission_no} · {student.class_label}
                    </div>
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setStudent(null)}>
                  Change
                </button>
              </div>
            )}

            {student && (
              <form onSubmit={requestConfirmation} className="mt-3">
                {error && <div className="alert alert-danger">{error}</div>}

                <label className="form-label">
                  Payment Method <span className="req">*</span>
                </label>
                <MethodPicker value={draft.method} onChange={(m) => setDraft({ ...draft, method: m })} />

                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">
                      Payment For <span className="req">*</span>
                    </label>
                    <select
                      className="form-select"
                      value={draft.charge_type}
                      onChange={(e) => chooseType(e.target.value)}
                      disabled={!!charge}
                      required
                    >
                      <option value="">Select...</option>
                      {activeTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    {charge && (
                      <div className="form-text-hint">
                        Paying: {charge.description || charge.charge_type_name}
                      </div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">
                      Amount Received <span className="req">*</span>
                    </label>
                    <div className="input-icon-group">
                      <input
                        type="number"
                        className="form-control cell-mono"
                        style={{ paddingLeft: "0.8rem", paddingRight: "4.5rem" }}
                        required
                        min="0.01"
                        step="0.01"
                        value={draft.amount}
                        onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                      />
                      <span className="input-suffix">KES</span>
                    </div>
                    {charge && <div className="form-text-hint">Balance on this charge: KES {currency(chargeBalance)}</div>}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Reference</label>
                    <input
                      className="form-control"
                      placeholder="M-Pesa code / slip no."
                      value={draft.reference}
                      onChange={(e) => setDraft({ ...draft, reference: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Notes (optional)</label>
                    <input
                      className="form-control"
                      placeholder="e.g. Size 34 blazer"
                      value={draft.notes}
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className="d-flex flex-wrap gap-2 mt-3">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    <i className="bi bi-check2-circle"></i>
                    Confirm Payment
                  </button>
                  {charge && (
                    <button type="button" className="btn btn-secondary" onClick={clearCharge}>
                      Take as walk-in instead
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>

        {/* ---------- right: what this student owes ---------- */}
        <div className="col-lg-5">
          <div className="panel panel--tint h-100 d-flex flex-column">
            <PanelHead icon="bi-list-check" title="Outstanding Charges" />

            {!student && (
              <div className="empty-state py-4">
                <i className="bi bi-person-lines-fill"></i>
                <p className="text-muted-soft mb-0">Select a student to see what they owe.</p>
              </div>
            )}
            {student && student.open_charges.length === 0 && (
              <div className="empty-state py-4">
                <i className="bi bi-check2-all"></i>
                <p className="text-muted-soft mb-0">No outstanding charges. You can still take a walk-in payment.</p>
              </div>
            )}
            {student && student.open_charges.length > 0 && (
              <>
                <div className="pick-list">
                  {student.open_charges.map((c) => (
                    <div key={c.id} className={`pick-item${charge?.id === c.id ? " is-selected" : ""}`}>
                      <div>
                        <div className="cell-name">{c.charge_type_name}</div>
                        <div className="text-muted-soft" style={{ fontSize: "var(--fs-xs)" }}>
                          {c.description || "-"}
                        </div>
                        <div style={{ fontSize: "var(--fs-sm)" }}>
                          Balance <strong>KES {currency(c.balance)}</strong> of KES {currency(c.amount)}
                        </div>
                      </div>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => chooseCharge(c)}>
                        Pay
                      </button>
                    </div>
                  ))}
                </div>
                <div className="total-bar mt-auto">
                  <span className="total-bar__label">Total owed</span>
                  <span className="total-bar__value text-owe">KES {currency(student.other_outstanding)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ---------- last receipt ---------- */}
      {lastPayment && (
        <div className="panel mt-4">
          <div className="receipt-hero">
            <div className="modal-icon-circle modal-icon-circle--success">
              <i className="bi bi-receipt-cutoff"></i>
            </div>
            <div>
              <h6 className="panel-title">Receipt {lastPayment.receipt_no}</h6>
              <div className="chart-card__subtitle">Payment recorded successfully</div>
            </div>
          </div>

          <div style={{ maxWidth: "34rem" }}>
            <div className="profile-info-row">
              <span>Student</span>
              <span>
                {lastPayment.student_name} ({lastPayment.admission_no})
              </span>
            </div>
            <div className="profile-info-row">
              <span>Payment For</span>
              <span>
                {lastPayment.charge_type_name}
                {lastPayment.charge_description ? ` - ${lastPayment.charge_description}` : ""}
              </span>
            </div>
            <div className="profile-info-row">
              <span>Amount Paid</span>
              <span className="cell-mono text-ok">KES {currency(lastPayment.amount)}</span>
            </div>
            <div className="profile-info-row">
              <span>Method</span>
              <span>
                <span className={`badge ${METHOD_BADGE[lastPayment.method] || "badge-neutral"}`}>
                  <i className={`bi ${METHOD_ICON[lastPayment.method] || "bi-credit-card"} me-1`}></i>
                  {METHOD_LABEL[lastPayment.method] || lastPayment.method}
                </span>
              </span>
            </div>
            <div className="profile-info-row">
              <span>Reference</span>
              <span className="cell-mono">{lastPayment.reference || "-"}</span>
            </div>
          </div>

          <div className="d-flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn btn-success" onClick={() => onDownloadReceipt(lastPayment.id)}>
              <i className="bi bi-file-earmark-pdf"></i>
              Download Receipt (PDF)
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onPrintReceipt(lastPayment.id)}
              disabled={printingId === lastPayment.id}
            >
              {printingId === lastPayment.id ? (
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
              ) : (
                <i className="bi bi-printer"></i>
              )}
              Print Receipt
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setLastPayment(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ---------- verify before recording (same bank-style step as school fees) ---------- */}
      {student && showConfirm && (
        <div
          className="modal fade show d-block modal-scrim modal-scrim--top verify-modal"
          tabIndex="-1"
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <span className="modal-header__icon" aria-hidden="true">
                  <i className="bi bi-shield-check" style={{ color: "var(--warning-600)" }}></i>
                </span>
                <div className="modal-header__text">
                  <h6 className="modal-title">Review Transaction</h6>
                  <p className="modal-subtitle">Please verify the amount received before proceeding</p>
                </div>
              </div>

              <div className="modal-body">
                <div className="amount-hero">
                  <div className="amount-hero__label">Amount Received</div>
                  <div className="amount-hero__value">KES {currency(amountNumber)}</div>
                </div>

                <div className="tx-box">
                  <div className="profile-info-row">
                    <span>Student</span>
                    <span>{student.name}</span>
                  </div>
                  <div className="profile-info-row">
                    <span>Admission No</span>
                    <span className="cell-mono">{student.admission_no}</span>
                  </div>
                  <div className="profile-info-row">
                    <span>Payment For</span>
                    <span>{selectedType?.name || "-"}</span>
                  </div>
                  <div className="profile-info-row">
                    <span>Payment Method</span>
                    <span>{METHOD_LABEL[draft.method]}</span>
                  </div>
                  <div className="profile-info-row">
                    <span>Reference</span>
                    <span className="cell-mono">{draft.reference || "-"}</span>
                  </div>
                  {charge && (
                    <>
                      <div className="profile-info-row">
                        <span>Charge Balance Before</span>
                        <span className="cell-mono">KES {currency(chargeBalance)}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Balance After</span>
                        <span className={`cell-mono ${balanceAfter > 0 ? "text-owe" : ""}`}>
                          {balanceAfter === 0 ? "KES 0 (Fully paid)" : `KES ${currency(balanceAfter)}`}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                <div className="form-check confirm-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="confirmOtherAmountVerified"
                    checked={confirmChecked}
                    disabled={saving}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="confirmOtherAmountVerified">
                    I have verified that KES {currency(amountNumber)} was received (cash count, M-Pesa message or
                    bank slip).
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    if (!saving) setShowConfirm(false);
                  }}
                  disabled={saving}
                >
                  <i className="bi bi-arrow-left"></i>
                  Back
                </button>
                <button type="button" className="btn btn-success" onClick={record} disabled={!confirmChecked || saving}>
                  {saving ? (
                    <>
                      <span className="spinner-border spinner-border-sm"></span>
                      Processing...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-check2-circle"></i>
                      Confirm &amp; Record
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------
   2. CHARGES (what students owe)
   --------------------------------------------------------------------- */
function NewChargeForm({ types, onMessage, onDone }) {
  const [student, setStudent] = useState(null);
  const [form, setForm] = useState({ charge_type: "", amount: "", description: "", due_date: "" });
  const [saving, setSaving] = useState(false);

  const chooseType = (id) => {
    const t = types.find((x) => String(x.id) === String(id));
    setForm((f) => ({
      ...f,
      charge_type: id,
      amount: t && t.default_amount != null ? String(t.default_amount) : f.amount,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!student) {
      onMessage("Pick a student first.", "danger");
      return;
    }
    setSaving(true);
    try {
      await otherPaymentsApi.createCharge({ student: student.id, ...form, due_date: form.due_date || null });
      onMessage(`Charge added for ${student.name}.`, "success");
      onDone();
    } catch (err) {
      onMessage(errorText(err, "Could not add this charge."), "danger");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel mb-3">
      <PanelHead icon="bi-person-plus" title="Charge one student" />
      <div className="row g-3">
        <div className="col-md-4">
          {student ? (
            <>
              <label className="form-label">Student</label>
              <div className="form-control d-flex justify-content-between align-items-center">
                <span>
                  {student.name} ({student.admission_no})
                </span>
                <button type="button" className="btn-close" aria-label="Change student" onClick={() => setStudent(null)}></button>
              </div>
            </>
          ) : (
            <StudentPicker onSelect={setStudent} label="Student" />
          )}
        </div>
        <div className="col-md-3">
          <label className="form-label">Type</label>
          <select
            className="form-select"
            value={form.charge_type}
            onChange={(e) => chooseType(e.target.value)}
            required
          >
            <option value="">Select...</option>
            {types
              .filter((t) => t.is_active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        <div className="col-md-2">
          <label className="form-label">Amount</label>
          <input
            type="number"
            min="1"
            step="0.01"
            className="form-control cell-mono"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </div>
        <div className="col-md-3">
          <label className="form-label">Due date</label>
          <input
            type="date"
            className="form-control"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
        </div>
        <div className="col-md-9">
          <input
            className="form-control"
            placeholder="Description (e.g. Broken window, Lab 2)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="col-md-3">
          <button className="btn btn-primary w-100" disabled={saving}>
            {saving ? "Saving..." : "Add charge"}
          </button>
        </div>
      </div>
    </form>
  );
}

function BulkChargeForm({ types, onMessage, onDone }) {
  const [scope, setScope] = useState("grade_level");
  const [grades, setGrades] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [form, setForm] = useState({ target: "", charge_type: "", amount: "", description: "", due_date: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    academicsApi
      .gradeLevels()
      .then((res) => setGrades(listOf(res)))
      .catch(() => {});
    otherPaymentsApi
      .classrooms()
      .then((res) => setClassrooms(listOf(res)))
      .catch(() => {});
  }, []);

  const chooseType = (id) => {
    const t = types.find((x) => String(x.id) === String(id));
    setForm((f) => ({
      ...f,
      charge_type: id,
      amount: t && t.default_amount != null ? String(t.default_amount) : f.amount,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await otherPaymentsApi.bulkCharges({
        [scope]: form.target,
        charge_type: form.charge_type,
        amount: form.amount,
        description: form.description,
        due_date: form.due_date || null,
      });
      const skipped = data.skipped?.length || 0;
      onMessage(
        `${data.created} charge(s) created${skipped ? `, ${skipped} skipped (already charged)` : ""}.`,
        "success"
      );
      onDone();
    } catch (err) {
      onMessage(errorText(err, "Could not create these charges."), "danger");
    } finally {
      setSaving(false);
    }
  };

  const options = scope === "grade_level" ? grades : classrooms;

  return (
    <form onSubmit={submit} className="panel mb-3">
      <PanelHead icon="bi-people" title="Charge a whole class or grade">
        Creates the same charge for every active student (e.g. a trip fee). Students who already have it are skipped.
      </PanelHead>
      <div className="row g-3">
        <div className="col-md-2">
          <label className="form-label">Charge</label>
          <select
            className="form-select"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setForm((f) => ({ ...f, target: "" }));
            }}
          >
            <option value="grade_level">Whole grade</option>
            <option value="classroom">One classroom</option>
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label">{scope === "grade_level" ? "Grade" : "Classroom"}</label>
          <select
            className="form-select"
            value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })}
            required
          >
            <option value="">Select...</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {scope === "grade_level" ? o.name : classroomLabel(o)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <label className="form-label">Type</label>
          <select
            className="form-select"
            value={form.charge_type}
            onChange={(e) => chooseType(e.target.value)}
            required
          >
            <option value="">Select...</option>
            {types
              .filter((t) => t.is_active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
        <div className="col-md-2">
          <label className="form-label">Amount</label>
          <input
            type="number"
            min="1"
            step="0.01"
            className="form-control cell-mono"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </div>
        <div className="col-md-2">
          <label className="form-label">Due date</label>
          <input
            type="date"
            className="form-control"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
        </div>
        <div className="col-md-9">
          <input
            className="form-control"
            placeholder="Description (e.g. Mombasa trip, Term 3)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="col-md-3">
          <button className="btn btn-primary w-100" disabled={saving}>
            {saving ? "Creating..." : "Create charges"}
          </button>
        </div>
      </div>
    </form>
  );
}

function ChargesSection({ types, onMessage, onCollect }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [panel, setPanel] = useState(null); // "new" | "bulk" | null
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const res = await otherPaymentsApi.charges({
          status: status || undefined,
          q: debouncedSearch || undefined,
          page_size: 200,
        });
        if (live) setRows(listOf(res));
      } catch (err) {
        if (live) onMessage(errorText(err, "Could not load charges."), "danger");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, debouncedSearch, reloadKey]);

  const closeCharge = async (row, kind) => {
    const reason = window.prompt(`Reason for ${kind === "waive" ? "waiving" : "cancelling"} this charge:`);
    if (!reason) return;
    try {
      if (kind === "waive") await otherPaymentsApi.waiveCharge(row.id, reason);
      else await otherPaymentsApi.cancelCharge(row.id, reason);
      onMessage(`Charge ${kind === "waive" ? "waived" : "cancelled"}.`, "success");
      setReloadKey((k) => k + 1);
    } catch (err) {
      onMessage(errorText(err, "Could not update this charge."), "danger");
    }
  };

  const done = () => {
    setPanel(null);
    setReloadKey((k) => k + 1);
  };

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          className={`btn ${panel === "new" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setPanel(panel === "new" ? null : "new")}
        >
          <i className="bi bi-person-plus"></i>
          Charge one student
        </button>
        <button
          type="button"
          className={`btn ${panel === "bulk" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setPanel(panel === "bulk" ? null : "bulk")}
        >
          <i className="bi bi-people"></i>
          Charge a class / grade
        </button>
      </div>

      {panel === "new" && <NewChargeForm types={types} onMessage={onMessage} onDone={done} />}
      {panel === "bulk" && <BulkChargeForm types={types} onMessage={onMessage} onDone={done} />}

      <div className="panel" style={FLUSH}>
        <div className="table-wrap__header">
          <span className="panel-title">
            <i className="bi bi-list-check text-brand"></i>
            Charges
          </span>
          <span className="chart-card__subtitle">
            {rows.length} charge{rows.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="search-bar" style={{ paddingTop: 0 }}>
          <div className="search-bar__field">
            <i className="bi bi-search" aria-hidden="true"></i>
            <input
              className="form-control"
              placeholder="Search student or description..."
              aria-label="Search charges"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="form-select"
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIAL">Partially paid</option>
            <option value="PAID">Paid</option>
            <option value="WAIVED">Waived</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        {loading ? (
          <TableSkeleton rows={5} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-list-check"></i>
            <h6>No charges found</h6>
            <p className="text-muted-soft">Charges you add for students will show up here.</p>
          </div>
        ) : (
          <div className="table-responsive" style={{ borderTop: "1px solid var(--border-color)" }}>
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th className="text-end">Amount</th>
                  <th className="text-end">Paid</th>
                  <th className="text-end">Balance</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const open = c.status === "UNPAID" || c.status === "PARTIAL";
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">{initialsOf(c.student_name)}</div>
                          <div>
                            <span className="cell-name">{c.student_name}</span>
                            <span className="cell-sub">{c.admission_no}</span>
                          </div>
                        </div>
                      </td>
                      <td>{c.charge_type_name}</td>
                      <td>{c.description || <span className="cell-muted">-</span>}</td>
                      <td className="cell-num">KES {currency(c.amount)}</td>
                      <td className="cell-num text-ok">KES {currency(c.amount_paid)}</td>
                      <td className="cell-num fw-bold">KES {currency(c.balance)}</td>
                      <td>{c.due_date || <span className="cell-muted">-</span>}</td>
                      <td>
                        <span className={STATUS_PILL[c.status] || "status-pill status-pill--neutral"}>
                          {c.status_display}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          {open && (
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => onCollect(c)}>
                              Collect
                            </button>
                          )}
                          {c.status === "UNPAID" && (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                onClick={() => closeCharge(c, "waive")}
                              >
                                Waive
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => closeCharge(c, "cancel")}
                              >
                                Cancel
                              </button>
                            </>
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
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------
   3. HISTORY
   --------------------------------------------------------------------- */
const HISTORY_LIMIT = 100;

function HistorySection({ types, onMessage, onPrintReceipt, onDownloadReceipt, printingId }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ charge_type: "", method: "", date_from: "", date_to: "" });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const params = {};
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params[k] = v;
      });
      if (debouncedSearch) params.q = debouncedSearch;
      try {
        const [list, sum] = await Promise.all([
          otherPaymentsApi.payments({ ...params, page_size: HISTORY_LIMIT }),
          otherPaymentsApi.summary(params),
        ]);
        if (!live) return;
        const data = listOf(list);
        setRows(data);
        setTotal(list.data?.count ?? data.length);
        setSummary(sum.data);
      } catch (err) {
        if (live) onMessage(errorText(err, "Could not load payments."), "danger");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, debouncedSearch]);

  const update = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="panel" style={FLUSH}>
      <div className="table-wrap__header">
        <span className="panel-title">
          <i className="bi bi-clock-history text-brand"></i>
          Other Payments History
        </span>
        <span className="chart-card__subtitle">
          {total} payment{total !== 1 ? "s" : ""} found
        </span>
      </div>

      <div className="search-bar" style={{ paddingTop: 0 }}>
        <div className="search-bar__field">
          <i className="bi bi-search" aria-hidden="true"></i>
          <input
            className="form-control"
            placeholder="Receipt, reference, student..."
            aria-label="Search other payments"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-select"
          aria-label="Payment type"
          value={filters.charge_type}
          onChange={(e) => update("charge_type", e.target.value)}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className="form-select"
          aria-label="Method"
          value={filters.method}
          onChange={(e) => update("method", e.target.value)}
        >
          <option value="">Method</option>
          <option value="MPESA">M-Pesa</option>
          <option value="BANK">Bank</option>
          <option value="CASH">Cash</option>
          <option value="CHEQUE">Cheque</option>
        </select>
        <input
          type="date"
          className="form-control"
          style={{ width: "auto" }}
          title="From date"
          aria-label="From date"
          value={filters.date_from}
          max={filters.date_to || undefined}
          onChange={(e) => update("date_from", e.target.value)}
        />
        <span className="range-sep">&rarr;</span>
        <input
          type="date"
          className="form-control"
          style={{ width: "auto" }}
          title="To date"
          aria-label="To date"
          value={filters.date_to}
          min={filters.date_from || undefined}
          onChange={(e) => update("date_to", e.target.value)}
        />
      </div>

      {summary && (
        <div style={{ padding: "0 1.1rem" }}>
          <div className="stat-grid">
            <div className="stat-card stat-card--success">
              <i className="bi bi-cash-stack" aria-hidden="true"></i>
              <div>
                <p className="stat-card__label">Total collected</p>
                <div className="stat-card__value">KES {currency(summary.grand_total)}</div>
                <p className="stat-card__delta">
                  {summary.count} receipt{summary.count !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            {summary.rows.map((r) => (
              <div key={r.charge_type} className="stat-card">
                <i className="bi bi-tag" aria-hidden="true"></i>
                <div>
                  <p className="stat-card__label">{r.charge_type}</p>
                  <div className="stat-card__value">KES {currency(r.total)}</div>
                  <p className="stat-card__delta">
                    {r.count} receipt{r.count !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={5} columns={8} />
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-bag"></i>
          <h6>No payments found</h6>
          <p className="text-muted-soft">No other payments match these filters yet.</p>
        </div>
      ) : (
        <>
          <div className="table-responsive" style={{ borderTop: "1px solid var(--border-color)" }}>
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th>Student</th>
                  <th>Payment For</th>
                  <th className="text-end">Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Recorded By</th>
                  <th className="text-center">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="cell-mono text-brand fw-semibold">{p.receipt_no}</td>
                    <td className="cell-muted">
                      {p.paid_at ? new Date(p.paid_at).toLocaleDateString("en-KE") : "-"}
                    </td>
                    <td>
                      <div className="table-avatar-cell">
                        <div className="avatar-sm">{initialsOf(p.student_name)}</div>
                        <div>
                          <span className="cell-name">{p.student_name}</span>
                          <span className="cell-sub">{p.admission_no}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      {p.charge_type_name}
                      {p.charge_description && <span className="cell-sub">{p.charge_description}</span>}
                    </td>
                    <td className="cell-num fw-bold text-ok">KES {currency(p.amount)}</td>
                    <td>
                      <span className={`badge ${METHOD_BADGE[p.method] || "badge-neutral"}`}>
                        <i className={`bi ${METHOD_ICON[p.method] || "bi-credit-card"} me-1`}></i>
                        {METHOD_LABEL[p.method] || p.method}
                      </span>
                    </td>
                    <td className="cell-mono">{p.reference || <span className="cell-muted">-</span>}</td>
                    <td className="cell-muted">{p.recorded_by_name}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-icon"
                          title="Print this receipt"
                          aria-label="Print this receipt"
                          onClick={() => onPrintReceipt(p.id)}
                          disabled={printingId === p.id}
                        >
                          {printingId === p.id ? (
                            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                          ) : (
                            <i className="bi bi-printer"></i>
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon"
                          title="Download receipt PDF"
                          aria-label="Download receipt PDF"
                          onClick={() => onDownloadReceipt(p.id)}
                        >
                          <i className="bi bi-file-earmark-pdf"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > rows.length && (
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                Showing the latest <strong>{rows.length}</strong> of <strong>{total}</strong>. Use the search or date
                filters to narrow down.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------
   4. PAYMENT TYPES (add new kinds of payment without touching code)
   --------------------------------------------------------------------- */
const EMPTY_TYPE = { id: null, name: "", code: "", default_amount: "", description: "", is_active: true };

function TypesSection({ types, onMessage, onChanged }) {
  const [form, setForm] = useState(EMPTY_TYPE);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: form.name,
      code: form.code,
      description: form.description,
      is_active: form.is_active,
      default_amount: form.default_amount === "" || form.default_amount == null ? null : form.default_amount,
    };
    try {
      if (form.id) await otherPaymentsApi.updateType(form.id, body);
      else await otherPaymentsApi.createType(body);
      onMessage(form.id ? "Payment type updated." : "Payment type added.", "success");
      setForm(EMPTY_TYPE);
      onChanged();
    } catch (err) {
      onMessage(errorText(err, "Could not save this payment type."), "danger");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t) => {
    try {
      await otherPaymentsApi.updateType(t.id, { is_active: !t.is_active });
      onChanged();
    } catch (err) {
      onMessage(errorText(err, "Could not update this payment type."), "danger");
    }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try {
      await otherPaymentsApi.deleteType(t.id);
      onMessage("Payment type deleted.", "success");
      onChanged();
    } catch (err) {
      onMessage(errorText(err, "Could not delete this payment type."), "danger");
    }
  };

  const addStarterTypes = async () => {
    setSaving(true);
    try {
      for (const t of STARTER_TYPES) {
        await otherPaymentsApi.createType({ ...t, description: "", is_active: true, default_amount: null });
      }
      onMessage("Standard payment types added. Set a default amount on each one you want pre-filled.", "success");
      onChanged();
    } catch (err) {
      onMessage(errorText(err, "Could not add the standard types."), "danger");
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="row g-4">
      <div className="col-lg-4">
        <form onSubmit={submit} className="panel">
          <PanelHead icon={form.id ? "bi-pencil-square" : "bi-plus-circle"} title={form.id ? "Edit payment type" : "Add payment type"} />
          <div className="mb-3">
            <label className="form-label">
              Name <span className="req">*</span>
            </label>
            <input
              className="form-control"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. School Trip"
              required
            />
          </div>
          <div className="mb-3">
            <label className="form-label">
              Code <span className="req">*</span>
            </label>
            <input
              className="form-control cell-mono"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="e.g. TRIP"
              required
            />
          </div>
          <div className="mb-3">
            <label className="form-label">Default amount (optional)</label>
            <div className="input-icon-group">
              <input
                type="number"
                min="0"
                step="0.01"
                className="form-control cell-mono"
                style={{ paddingLeft: "0.8rem", paddingRight: "4.5rem" }}
                value={form.default_amount ?? ""}
                onChange={(e) => setForm({ ...form, default_amount: e.target.value })}
              />
              <span className="input-suffix">KES</span>
            </div>
            <div className="form-text-hint">Pre-fills the amount when this type is chosen.</div>
          </div>
          <div className="mb-3">
            <label className="form-label">Description</label>
            <input
              className="form-control"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="form-check form-switch mb-3">
            <input
              id="otherTypeActive"
              type="checkbox"
              className="form-check-input"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <label htmlFor="otherTypeActive" className="form-check-label">
              Active
            </label>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : form.id ? "Update" : "Add"}
            </button>
            {form.id && (
              <button type="button" className="btn btn-secondary" onClick={() => setForm(EMPTY_TYPE)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="col-lg-8">
        <div className="panel" style={FLUSH}>
          <div className="table-wrap__header">
            <span className="panel-title">
              <i className="bi bi-tags text-brand"></i>
              Payment Types
            </span>
            <span className="chart-card__subtitle">{types.length} types</span>
          </div>

          {types.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-tags"></i>
              <h6>No payment types yet</h6>
              <p className="text-muted-soft">
                Add your own on the left, or start with the standard set: Admission, Uniform, Student ID,
                Graduation, Trip and Damages.
              </p>
              <button type="button" className="btn btn-primary" onClick={addStarterTypes} disabled={saving}>
                <i className="bi bi-magic"></i>
                Add the standard types
              </button>
            </div>
          ) : (
            <div className="table-responsive" style={{ borderTop: "1px solid var(--border-color)" }}>
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Code</th>
                    <th className="text-end">Default</th>
                    <th>Status</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className="cell-name">{t.name}</span>
                        {t.description && <span className="cell-sub text-muted-soft">{t.description}</span>}
                      </td>
                      <td className="cell-mono">{t.code}</td>
                      <td className="cell-num">
                        {t.default_amount != null ? `KES ${currency(t.default_amount)}` : <span className="cell-muted">-</span>}
                      </td>
                      <td>
                        <span className={`status-pill ${t.is_active ? "status-pill--success" : "status-pill--neutral"}`}>
                          {t.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setForm({ ...t, default_amount: t.default_amount ?? "" })}
                          >
                            Edit
                          </button>
                          <button type="button" className="btn btn-sm btn-secondary" onClick={() => toggleActive(t)}>
                            {t.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => remove(t)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   MAIN PANEL - mounted by the Payments page as the "Other Payments" tab
   --------------------------------------------------------------------- */
const SECTIONS = [
  ["take", "Take Payment", "bi-cash-coin"],
  ["charges", "Charges", "bi-list-check"],
  ["history", "History", "bi-clock-history"],
  ["types", "Payment Types", "bi-tags"],
];

export function OtherPaymentsPanel({ onMessage, onPrintReceipt, onDownloadReceipt, printingId }) {
  const [section, setSection] = useState("take");
  const [types, setTypes] = useState([]);
  const [prefill, setPrefill] = useState(null);

  const loadTypes = async () => {
    try {
      const res = await otherPaymentsApi.types();
      setTypes(listOf(res));
    } catch (err) {
      onMessage(errorText(err, "Could not load payment types."), "danger");
    }
  };

  useEffect(() => {
    loadTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const collect = (charge) => {
    setPrefill(charge);
    setSection("take");
  };

  return (
    <div>
      <ul className="nav nav-pills mb-3" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
        {SECTIONS.map(([key, label, icon]) => (
          <li className="nav-item" key={key}>
            <button
              type="button"
              className={`nav-link ${section === key ? "active" : ""}`}
              onClick={() => setSection(key)}
            >
              <i className={`bi ${icon} me-1`}></i>
              {label}
            </button>
          </li>
        ))}
      </ul>

      {section === "take" && (
        <TakePayment
          types={types}
          prefill={prefill}
          onPrefillDone={() => setPrefill(null)}
          onGoToTypes={() => setSection("types")}
          onMessage={onMessage}
          onPrintReceipt={onPrintReceipt}
          onDownloadReceipt={onDownloadReceipt}
          printingId={printingId}
        />
      )}
      {section === "charges" && <ChargesSection types={types} onMessage={onMessage} onCollect={collect} />}
      {section === "history" && (
        <HistorySection
          types={types}
          onMessage={onMessage}
          onPrintReceipt={onPrintReceipt}
          onDownloadReceipt={onDownloadReceipt}
          printingId={printingId}
        />
      )}
      {section === "types" && <TypesSection types={types} onMessage={onMessage} onChanged={loadTypes} />}
    </div>
  );
}