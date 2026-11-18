import { useCallback, useEffect, useState } from "react";
import { bursaryApi, errMsg, unwrap } from "../../services/api";
import Modal from "../../components/Modal";

const fmt = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 2 }).format(Number(n) || 0);

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Remittances() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState([]);
  const [recording, setRecording] = useState(false);
  const [allocating, setAllocating] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [msg, setMsg] = useState({ kind: "", text: "" });

  const load = useCallback(() => {
    setLoading(true);
    bursaryApi.remittances
      .list({ page_size: 100 })
      .then((r) => setRows(unwrap(r)))
      .catch((e) => setMsg({ kind: "error", text: errMsg(e) }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    bursaryApi.sources
      .list({ is_active: true })
      .then((r) => setSources(unwrap(r)))
      .catch(() => {});
  }, [load]);

  const totalUnallocated = rows.reduce(
    (s, r) => s + (Number(r.unallocated) || 0),
    0
  );

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Funds Received</h1>
          <p className="page-subtitle">
            Record every cheque or transfer from a funder, then share it among the
            students it covers
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setRecording(true)}>
            <i className="bi bi-cash-stack" />
            Record money received
          </button>
        </div>
      </div>

      {/* ---------- Page-level message ---------- */}
      {msg.text && (
        <div
          className={`alert alert-${msg.kind === "error" ? "danger" : "success"} alert-dismissible fade show`}
          role={msg.kind === "error" ? "alert" : "status"}
        >
          {msg.text}
          <button
            type="button"
            className="btn-close"
            onClick={() => setMsg({ kind: "", text: "" })}
            aria-label="Dismiss"
          />
        </div>
      )}

      {/* ---------- Remittances list ---------- */}
      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <div className="chart-card__title">
                <i className="bi bi-wallet2 me-2 text-brand" />
                Recorded receipts from funders
              </div>
              <div className="chart-card__subtitle">
                {rows.length} remittance{rows.length !== 1 ? "s" : ""}
                {totalUnallocated > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <span className="text-gold fw-semibold">
                      KES {fmt(totalUnallocated)} still to share
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-4">
            <span className="spinner-border spinner-border-sm me-2" />
            Loading remittances...
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-inbox" />
            <h6>Nothing recorded yet</h6>
            <p className="text-muted-soft">
              Click "Record money received" to log the first cheque or transfer
              from a funder.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table--stack mb-0">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Funder</th>
                  <th>Reference</th>
                  <th className="text-end">Amount</th>
                  <th className="text-end">Shared out</th>
                  <th className="text-end">Left to share</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const unallocated = Number(r.unallocated) || 0;
                  return (
                    <tr key={r.id}>
                      <td data-label="Received" className="cell-mono">
                        {r.received_on}
                      </td>
                      <td data-label="Funder" className="cell-name">
                        {r.source_name}
                      </td>
                      <td data-label="Reference">
                        <span className="cell-mono">{r.reference}</span>
                        <div className="text-muted-soft small">
                          {r.method_display}
                        </div>
                      </td>
                      <td data-label="Amount" className="cell-num">
                        {fmt(r.amount)}
                      </td>
                      <td data-label="Shared out" className="cell-num">
                        {fmt(r.allocated)}
                      </td>
                      <td data-label="Left to share" className="cell-num">
                        {unallocated > 0 ? (
                          <span className="badge badge-warning">
                            {fmt(unallocated)}
                          </span>
                        ) : (
                          <span className="text-muted-soft">0.00</span>
                        )}
                      </td>
                      <td data-label="Actions">
                        <div className="table-actions">
                          {unallocated > 0 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary btn-icon"
                              title="Share among students"
                              aria-label="Share among students"
                              onClick={() => setAllocating(r)}
                            >
                              <i className="bi bi-people" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary btn-icon"
                            title="View receipts"
                            aria-label="View receipts"
                            onClick={() => setViewing(r)}
                          >
                            <i className="bi bi-receipt" />
                          </button>
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

      {/* ---------- Record money modal ---------- */}
      <Modal
        show={recording}
        onClose={() => setRecording(false)}
        title="Record money received"
        size="lg"
      >
        <RecordForm
          sources={sources}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            setMsg({
              kind: "ok",
              text: "Recorded. Now share it among the students.",
            });
            load();
          }}
        />
      </Modal>

      {/* ---------- Allocate modal ---------- */}
      <Modal
        show={!!allocating}
        onClose={() => setAllocating(null)}
        title={
          allocating
            ? `Share ${allocating.reference} (${allocating.source_name})`
            : "Share remittance"
        }
        size="lg"
      >
        {allocating && (
          <Allocate
            remittance={allocating}
            onClose={() => setAllocating(null)}
            onDone={(t) => {
              setAllocating(null);
              setMsg({ kind: "ok", text: t });
              load();
            }}
          />
        )}
      </Modal>

      {/* ---------- Receipts modal ---------- */}
      <Modal
        show={!!viewing}
        onClose={() => setViewing(null)}
        title={
          viewing ? `Receipts issued from ${viewing.reference}` : "Receipts"
        }
        size="lg"
      >
        {viewing && (
          <Receipts
            remittance={viewing}
            onClose={() => setViewing(null)}
            onChanged={() => {
              load();
              setMsg({ kind: "ok", text: "Allocation reversed." });
            }}
          />
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record money
// ---------------------------------------------------------------------------
function RecordForm({ sources, onClose, onSaved }) {
  const [f, setF] = useState({
    source: "",
    amount: "",
    method: "CHEQUE",
    reference: "",
    received_on: todayStr(),
    notes: "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setErr("");
    if (!f.source || !f.amount || !f.reference.trim()) {
      return setErr(
        "Choose the funder, and enter the amount and the cheque or transfer reference."
      );
    }
    setBusy(true);
    try {
      await bursaryApi.remittances.create({ ...f, source: Number(f.source) });
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}

      <h6 className="settings-section__title mb-2">Funder</h6>
      <label className="form-label">Funder account</label>
      <select className="form-select" value={f.source} onChange={set("source")}>
        <option value="">Choose a funder</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <h6 className="settings-section__title mt-4 mb-2">Amount &amp; date</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Amount (KES)</label>
          <input
            className="form-control"
            type="number"
            min="0"
            step="0.01"
            value={f.amount}
            onChange={set("amount")}
          />
        </div>
        <div className="col-md-6">
          <label className="form-label">Date received</label>
          <input
            className="form-control"
            type="date"
            value={f.received_on}
            onChange={set("received_on")}
          />
        </div>
      </div>

      <h6 className="settings-section__title mt-4 mb-2">Method &amp; reference</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Paid by</label>
          <select className="form-select" value={f.method} onChange={set("method")}>
            <option value="CHEQUE">Cheque</option>
            <option value="BANK">Bank transfer / EFT</option>
            <option value="MPESA">M-Pesa</option>
            <option value="CASH">Cash</option>
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label">Cheque or transfer number</label>
          <input
            className="form-control"
            value={f.reference}
            onChange={set("reference")}
          />
        </div>
      </div>

      <h6 className="settings-section__title mt-4 mb-2">Notes</h6>
      <label className="form-label">Notes (optional)</label>
      <input
        className="form-control"
        value={f.notes}
        onChange={set("notes")}
      />

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy}
        >
          {busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Saving...
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share among students
// ---------------------------------------------------------------------------
function Allocate({ remittance, onClose, onDone }) {
  const [entries, setEntries] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bursaryApi.remittances
      .candidates(remittance.id)
      .then((r) => setEntries(r.data))
      .catch((e) => setErr(errMsg(e)));
  }, [remittance.id]);

  const total = Object.values(amounts).reduce(
    (s, v) => s + (Number(v) || 0),
    0
  );
  const left = Number(remittance.unallocated) - total;

  const fillInOrder = () => {
    let remaining = Number(remittance.unallocated);
    const next = {};
    for (const e of entries) {
      const give = Math.min(remaining, Number(e.outstanding));
      if (give > 0) {
        next[e.id] = give.toFixed(2);
        remaining -= give;
      }
    }
    setAmounts(next);
  };

  const save = async () => {
    setErr("");
    const rows = Object.entries(amounts)
      .filter(([, v]) => Number(v) > 0)
      .map(([id, v]) => ({ award_term: Number(id), amount: v }));
    if (!rows.length) return setErr("Enter an amount for at least one student.");
    setBusy(true);
    try {
      const r = await bursaryApi.remittances.allocate(remittance.id, rows);
      onDone(
        `Shared among ${r.data.allocated} student${r.data.allocated === 1 ? "" : "s"}. A receipt was issued for each.`
      );
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}

      {/* ---------- Header strip ---------- */}
      <div className="summary-strip mb-3">
        <span>
          <strong>KES {fmt(remittance.unallocated)}</strong> available to share
        </span>
        <span>·</span>
        <span>
          After this:{" "}
          <strong className={left < 0 ? "text-owe" : ""}>
            KES {fmt(left)}
          </strong>
        </span>
        <span className="ms-auto">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={fillInOrder}
            disabled={!entries?.length}
          >
            <i className="bi bi-lightning-charge me-1" />
            Fill oldest first
          </button>
        </span>
      </div>

      {/* ---------- Candidates table ---------- */}
      {entries === null && !err ? (
        <div className="text-center py-4">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading candidates...
        </div>
      ) : entries?.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-people" />
          <h6>No student is waiting on this funder</h6>
          <p className="text-muted-soft">
            Approve awards under this funder's schemes first, then come back.
          </p>
        </div>
      ) : entries ? (
        <div className="table-wrap">
          <div className="table-responsive" style={{ maxHeight: "24rem" }}>
            <table className="table table-hover table-sm mb-0">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Term</th>
                  <th className="text-end">Still expected</th>
                  <th className="text-end" style={{ width: 140 }}>
                    Amount now
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="cell-name">{e.student_name}</div>
                      <div className="text-muted-soft small">
                        <span className="cell-mono">{e.admission_no}</span>
                        {e.scheme_name ? ` · ${e.scheme_name}` : ""}
                      </div>
                    </td>
                    <td>{e.term_label}</td>
                    <td className="cell-num">{fmt(e.outstanding)}</td>
                    <td className="text-end">
                      <input
                        className="form-control form-control-sm text-end"
                        type="number"
                        min="0"
                        max={e.outstanding}
                        step="0.01"
                        value={amounts[e.id] ?? ""}
                        onChange={(ev) =>
                          setAmounts({ ...amounts, [e.id]: ev.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || total <= 0 || left < 0}
          onClick={save}
        >
          {busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Sharing...
            </>
          ) : (
            <>
              <i className="bi bi-share me-1" />
              Share KES {fmt(total)}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------
function Receipts({ remittance, onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    bursaryApi.remittances
      .allocations(remittance.id)
      .then((r) => setRows(r.data))
      .catch((e) => setErr(errMsg(e)));
  }, [remittance.id]);

  useEffect(() => {
    load();
  }, [load]);

  const reverse = async (a) => {
    const reason = window.prompt(
      `Why reverse ${a.receipt_no}? The receipt will be voided and ${a.student_name}'s balance will go back up.`
    );
    if (!reason) return;
    setBusy(true);
    try {
      await bursaryApi.remittances.reverseAllocation(remittance.id, a.id, reason);
      load();
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}

      {rows === null ? (
        <div className="text-center py-4">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading receipts...
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-receipt" />
          <h6>Nothing has been shared out yet</h6>
          <p className="text-muted-soft">
            Once you share this remittance among students, receipts appear here.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover table--stack mb-0">
            <thead>
              <tr>
                <th>Student</th>
                <th>Term</th>
                <th>Receipt</th>
                <th className="text-end">Amount</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={a.reversed ? "text-muted-soft" : ""}>
                  <td data-label="Student">
                    <div className="cell-name">{a.student_name}</div>
                    <div className="text-muted-soft small">
                      <span className="cell-mono">{a.admission_no}</span>
                    </div>
                  </td>
                  <td data-label="Term">{a.term_label}</td>
                  <td data-label="Receipt">
                    <span className="cell-mono">{a.receipt_no}</span>
                    {a.reversed && (
                      <span className="badge badge-danger ms-2">Reversed</span>
                    )}
                  </td>
                  <td data-label="Amount" className="cell-num">
                    <span className={a.reversed ? "text-decoration-line-through" : ""}>
                      {fmt(a.amount)}
                    </span>
                  </td>
                  <td data-label="Actions">
                    <div className="table-actions">
                      {!a.reversed && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger btn-icon"
                          title="Reverse receipt"
                          aria-label="Reverse receipt"
                          disabled={busy}
                          onClick={() => reverse(a)}
                        >
                          <i className="bi bi-arrow-counterclockwise" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}