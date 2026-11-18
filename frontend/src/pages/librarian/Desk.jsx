import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { errMsg, fmtDate, kes, libraryApi, useDebounced } from "./shared";

function IssuePanel() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [student, setStudent] = useState(null);
  const [acc, setAcc] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const accRef = useRef(null);

  useEffect(() => {
    if (student || dq.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    libraryApi
      .searchStudents(dq)
      .then((r) => {
        if (alive) setResults(r.data);
      })
      .catch(() => {
        if (alive) setResults([]);
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [dq, student]);

  const pick = (s) => {
    setStudent(s);
    setResults([]);
    setMsg(null);
    setTimeout(() => accRef.current?.focus(), 50);
  };

  const refreshStanding = async (s) => {
    const r = await libraryApi.searchStudents(s.admission_no);
    const fresh = r.data.find((x) => x.admission_no === s.admission_no);
    if (fresh) setStudent(fresh);
  };

  const issue = async () => {
    if (!acc.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await libraryApi.issue({
        admission_no: student.admission_no,
        accession_no: acc.trim(),
        due_on: due || null,
      });
      setMsg({
        kind: "ok",
        text: `Issued "${data.title}" to ${student.full_name}. Due ${fmtDate(data.due_on)}.`,
      });
      setAcc("");
      await refreshStanding(student);
      accRef.current?.focus();
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e, "Couldn't issue the book.") });
    } finally {
      setBusy(false);
    }
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="table-wrap">
      <div className="table-wrap__header">
        <span className="chart-card__title mb-0">
          <i className="bi bi-person-badge me-2 text-brand"></i>
          Who is borrowing?
        </span>
        {student && (
          <button
            className="btn btn-sm btn-light"
            onClick={() => {
              setStudent(null);
              setQ("");
              setMsg(null);
            }}
          >
            <i className="bi bi-arrow-repeat me-1"></i>
            Change Learner
          </button>
        )}
      </div>

      <div className="p-3">
        {!student ? (
          <>
            <label className="form-label">Admission number or name</label>
            <div className="toolbar__search" style={{ maxWidth: "420px" }}>
              <i className="bi bi-search"></i>
              <input
                className="form-control"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
                placeholder="Search by name or admission no..."
              />
            </div>

            {searching && (
              <p className="form-text-hint mt-3 mb-0">
                <span className="dot-loader me-2">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
                Searching...
              </p>
            )}

            {!searching && results.length > 0 && (
              <div className="pick-list mt-3">
                {results.map((s) => (
                  <button
                    key={s.student_id}
                    type="button"
                    onClick={() => pick(s)}
                    className="pick-item"
                  >
                    <div className="min-w-0">
                      <div className="cell-name">{s.full_name}</div>
                      <div className="cell-muted small mt-1">
                        {s.admission_no} · {s.classroom}
                      </div>
                    </div>
                    <span
                      className={`badge ${s.can_borrow ? "badge-success" : "badge-danger"} text-nowrap`}
                    >
                      <span
                        className={`status-dot ${
                          s.can_borrow ? "status-dot--online" : "status-dot--offline"
                        }`}
                      ></span>
                      {s.can_borrow ? "Can Borrow" : "Blocked"}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {!searching && dq.trim().length >= 2 && results.length === 0 && (
              <p className="form-text-hint mt-3 mb-0">
                <i className="bi bi-info-circle me-1"></i>
                No active learner matches.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 pb-3 mb-3 border-bottom">
              <div className="table-avatar-cell">
                <div className="avatar-sm">
                  {(student.full_name || "")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div>
                  <div className="cell-name">{student.full_name}</div>
                  <div className="cell-muted small mt-1">
                    {student.admission_no} · {student.classroom}
                  </div>
                </div>
              </div>

              <span
                className={`badge ${student.can_borrow ? "badge-success" : "badge-danger"}`}
              >
                <span
                  className={`status-dot ${
                    student.can_borrow ? "status-dot--online" : "status-dot--offline"
                  }`}
                ></span>
                {student.can_borrow ? "Can Borrow" : "Blocked"}
              </span>
            </div>

            <div className="row g-3 mb-3">
              <div className="col-6 col-md-4">
                <div className="section-label mb-1">Holding</div>
                <div className="cell-mono fw-bold">
                  {student.active_loans}{" "}
                  <span className="cell-muted small">
                    of {student.max_active_loans} books
                  </span>
                </div>
              </div>

              <div className="col-6 col-md-4">
                <div className="section-label mb-1">Overdue</div>
                <div
                  className="cell-mono fw-bold"
                  style={{ color: student.overdue_loans ? "var(--danger-600)" : "var(--ink-900)" }}
                >
                  {student.overdue_loans}
                </div>
              </div>

              <div className="col-6 col-md-4">
                <div className="section-label mb-1">Unpaid Fines</div>
                <div
                  className="cell-mono fw-bold"
                  style={{ color: student.unpaid_fines ? "var(--danger-600)" : "var(--ink-900)" }}
                >
                  {kes(student.unpaid_fines)}
                </div>
              </div>
            </div>

            {!student.can_borrow && (
              <div className="alert alert-danger d-flex align-items-start gap-2">
                <i className="bi bi-exclamation-triangle mt-1"></i>
                <span>{student.blocked_reasons.join(" ")}</span>
              </div>
            )}

            {student.can_borrow && (
              <>
                <h6 className="settings-section__title mb-2">
                  <span className="badge badge-blue me-2">2</span>
                  Scan or Type the Book's Accession Number
                </h6>

                <div
                  className="d-flex flex-wrap gap-2 align-items-stretch"
                  style={{ maxWidth: "560px" }}
                >
                  <input
                    ref={accRef}
                    className="form-control"
                    value={acc}
                    placeholder="LIB-000123"
                    onChange={(e) => setAcc(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && issue()}
                    aria-label="Accession number"
                    style={{
                      flex: "1 1 200px",
                      fontFamily: "var(--font-mono)",
                      letterSpacing: "0.02em",
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={issue}
                    disabled={busy || !acc.trim()}
                  >
                    {busy ? (
                      "Issuing..."
                    ) : (
                      <>
                        <i className="bi bi-box-arrow-up-right me-1"></i>
                        Issue Book
                      </>
                    )}
                  </button>
                </div>

                <div className="mt-3" style={{ maxWidth: "260px" }}>
                  <label className="form-label">Due Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={due}
                    min={todayStr}
                    onChange={(e) => setDue(e.target.value)}
                  />
                  <div className="form-text-hint">Leave blank to use the standard loan period.</div>
                </div>
              </>
            )}
          </>
        )}

        {msg && (
          <div
            className={`alert alert-${msg.kind === "ok" ? "success" : "danger"} mt-3 d-flex align-items-start gap-2`}
            role="status"
          >
            <i
              className={`bi ${
                msg.kind === "ok" ? "bi-check2-circle" : "bi-exclamation-triangle"
              } mt-1`}
            ></i>
            <span>{msg.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ReturnPanel({ initial }) {
  const [acc, setAcc] = useState(initial || "");
  const [loan, setLoan] = useState(null);
  const [condition, setCondition] = useState("GOOD");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [done, setDone] = useState(null);

  const find = async (code = acc) => {
    if (!code.trim()) return;
    setMsg(null);
    setDone(null);
    setLoan(null);
    try {
      const { data } = await libraryApi.returnPreview(code.trim());
      setLoan(data);
      setCondition("GOOD");
      setAmount("");
      setNote("");
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e) });
    }
  };

  useEffect(() => {
    if (initial) find(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await libraryApi.returnBook({
        accession_no: loan.accession_no,
        condition,
        fine_amount: amount === "" ? null : amount,
        note,
      });
      setDone(data);
      setLoan(null);
      setAcc("");
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e, "Couldn't receive the book.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="table-wrap">
      <div className="table-wrap__header">
        <span className="chart-card__title mb-0">
          <i className="bi bi-box-arrow-in-down me-2 text-brand"></i>
          Receive a Book
        </span>
        <span className="chart-card__subtitle mb-0">
          Scan the accession number to load the loan
        </span>
      </div>

      <div className="p-3">
        <div className="d-flex flex-wrap gap-2 align-items-stretch" style={{ maxWidth: "560px" }}>
          <input
            className="form-control"
            value={acc}
            placeholder="LIB-000123"
            onChange={(e) => setAcc(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && find()}
            aria-label="Accession number"
            autoFocus
            style={{
              flex: "1 1 200px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.02em",
            }}
          />
          <button className="btn btn-primary" onClick={() => find()} disabled={!acc.trim()}>
            <i className="bi bi-search me-1"></i>
            Find Loan
          </button>
        </div>

        {msg && (
          <div
            className={`alert alert-${msg.kind === "ok" ? "success" : "danger"} mt-3 d-flex align-items-start gap-2`}
            role="status"
          >
            <i
              className={`bi ${
                msg.kind === "ok" ? "bi-check2-circle" : "bi-exclamation-triangle"
              } mt-1`}
            ></i>
            <span>{msg.text}</span>
          </div>
        )}

        {loan && (
          <div className="mt-3 pt-3 border-top">
            <div className="cell-name mb-1">{loan.title}</div>
            <div className="cell-muted small mb-2">
              <i className="bi bi-upc me-1"></i>
              {loan.accession_no}
            </div>

            <div className="row g-3 mb-3">
              <div className="col-6 col-md-3">
                <div className="section-label mb-1">Borrower</div>
                <div className="cell-name">{loan.student_name}</div>
                <div className="cell-muted small mt-1">{loan.admission_no}</div>
              </div>

              <div className="col-6 col-md-3">
                <div className="section-label mb-1">Issued</div>
                <div className="cell-mono fw-semibold">{fmtDate(loan.issued_on)}</div>
              </div>

              <div className="col-6 col-md-3">
                <div className="section-label mb-1">Due</div>
                <div className="cell-mono fw-semibold">{fmtDate(loan.due_on)}</div>
              </div>

              <div className="col-6 col-md-3">
                <div className="section-label mb-1">Status</div>
                {loan.is_overdue ? (
                  <span className="badge badge-danger">
                    <span className="status-dot status-dot--offline"></span>
                    {loan.days_overdue} day{loan.days_overdue === 1 ? "" : "s"} overdue
                  </span>
                ) : (
                  <span className="badge badge-success">
                    <span className="status-dot status-dot--online"></span>
                    On time
                  </span>
                )}
              </div>
            </div>

            {loan.is_overdue && loan.accrued_fine > 0 && (
              <div className="alert alert-warning d-flex align-items-center gap-2 mb-3" role="alert">
                <i className="bi bi-cash-coin"></i>
                <span>
                  Late fine accrued: <strong>{kes(loan.accrued_fine)}</strong>
                </span>
              </div>
            )}

            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Condition on Return</label>
                <select
                  className="form-select"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                >
                  <option value="GOOD">Good</option>
                  <option value="DAMAGED">Damaged</option>
                  <option value="LOST">Lost</option>
                </select>
              </div>

              {condition !== "GOOD" && (
                <div className="col-md-4">
                  <label className="form-label">
                    {condition === "LOST"
                      ? `Replacement Fee (KES)${loan.book_price ? ` — default ${loan.book_price}` : ""}`
                      : "Damage Fee (KES, optional)"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    className="form-control"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              )}

              <div className="col-md-4 flex-grow-1">
                <label className="form-label">Note (optional)</label>
                <input
                  className="form-control"
                  value={note}
                  maxLength={255}
                  placeholder="e.g. Torn cover on page 42"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-3 d-flex justify-content-end">
              <button className="btn btn-primary" onClick={confirm} disabled={busy}>
                {busy ? (
                  "Saving..."
                ) : (
                  <>
                    <i className="bi bi-check2 me-1"></i>
                    Confirm Return
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className="mt-3">
            <div className="alert alert-success d-flex align-items-start gap-2">
              <i className="bi bi-check2-circle mt-1"></i>
              <div>
                <strong>
                  "{done.loan.title}" received from {done.loan.student_name}.
                </strong>
                {done.fines.length === 0 ? (
                  <div className="mt-1">No fines.</div>
                ) : (
                  <div className="mt-1">
                    {done.fines.map((f) => (
                      <div key={f.id}>
                        Fine raised: {kes(f.amount)} ({f.reason_display}
                        {f.note ? `, ${f.note}` : ""}). Collect it at the desk, then mark it paid
                        under Loans &amp; Fines.
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Desk() {
  const [params] = useSearchParams();
  const initialReturn = params.get("return") || "";
  const [tab, setTab] = useState(initialReturn ? "return" : "issue");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Issue &amp; Return</h1>
          <p className="page-subtitle">
            Keep the cursor in the box and scan the barcode — Enter does the rest
          </p>
        </div>
      </div>

      <ul className="nav nav-tabs mb-3" role="tablist">
        <li className="nav-item">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "issue"}
            className={`nav-link ${tab === "issue" ? "active" : ""}`}
            onClick={() => setTab("issue")}
          >
            <i className="bi bi-box-arrow-up-right me-1"></i>
            Issue a Book
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "return"}
            className={`nav-link ${tab === "return" ? "active" : ""}`}
            onClick={() => setTab("return")}
          >
            <i className="bi bi-box-arrow-in-down me-1"></i>
            Receive a Book
          </button>
        </li>
      </ul>

      {tab === "issue" ? <IssuePanel /> : <ReturnPanel initial={initialReturn} />}
    </div>
  );
}