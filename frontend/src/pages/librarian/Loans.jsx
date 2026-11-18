import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LoanState, Modal, Pager, errMsg, fmtDate, kes, libraryApi, useDebounced } from "./shared";
import TableSkeleton from "../../components/TableSkeleton";

const FINE_BADGE = {
  UNPAID: { badge: "badge-danger", dot: "status-dot--offline" },
  PAID: { badge: "badge-success", dot: "status-dot--online" },
  WAIVED: { badge: "badge-neutral", dot: "status-dot--offline" },
};

function LoansTab() {
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ count: 0, results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await libraryApi.loans({
        status: status || undefined,
        q: dq || undefined,
        page,
      });
      setData(r.data);
    } catch (e) {
      setError(errMsg(e, "Couldn't load loans."));
      setData({ count: 0, results: [] });
    } finally {
      setLoading(false);
    }
  }, [status, dq, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status, dq]);

  const renew = async (l) => {
    setNote("");
    setError("");
    try {
      const { data: r } = await libraryApi.renew(l.id);
      setNote(`Renewed. New due date ${fmtDate(r.due_on)}.`);
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const hasFilters = !!(dq || status !== "active");

  return (
    <>
      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError("")}></button>
        </div>
      )}

      {note && (
        <div className="alert alert-success alert-dismissible fade show" role="status">
          <i className="bi bi-check2-circle me-1"></i>
          {note}
          <button type="button" className="btn-close" onClick={() => setNote("")}></button>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0" style={{ width: "100%" }}>
            <select
              className="form-select w-auto"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Currently on loan</option>
              <option value="overdue">Overdue</option>
              <option value="returned">Returned</option>
              <option value="">All</option>
            </select>

            <div className="toolbar__search" style={{ maxWidth: "none" }}>
              <i className="bi bi-search"></i>
              <input
                type="text"
                className="form-control"
                placeholder="Learner, admission no., title or accession no..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            {hasFilters && (
              <button
                className="btn btn-sm btn-light"
                onClick={() => {
                  setQ("");
                  setStatus("active");
                }}
              >
                <i className="bi bi-x-lg me-1"></i>
                Clear
              </button>
            )}
          </div>

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title mb-0">
              <i className="bi bi-journal-text me-2 text-brand"></i>
              Loans
            </span>
            <span className="chart-card__subtitle mb-0">
              {data.count} record{data.count === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={7} />
        ) : data.results.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-journal-x"></i>
            <h6>No loans match</h6>
            <p className="text-muted-soft">Try a different status, or clear the search.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Borrower</th>
                  <th style={{ width: "130px" }}>Issued</th>
                  <th style={{ width: "130px" }}>Due</th>
                  <th style={{ width: "200px" }}>Status</th>
                  <th className="text-end" style={{ width: "100px" }}>Renewals</th>
                  <th style={{ width: "200px" }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div className="cell-name">{l.title}</div>
                      <div className="cell-muted small mt-1">
                        <i className="bi bi-upc me-1"></i>
                        {l.accession_no}
                      </div>
                    </td>

                    <td>
                      <div className="cell-name">
                        {l.student_name}
                      </div>
                      <div className="cell-muted small mt-1">
                        {l.admission_no}
                      </div>
                    </td>

                    <td className="cell-mono text-nowrap">
                      {fmtDate(l.issued_on)}
                    </td>

                    <td className="cell-mono text-nowrap">
                      {fmtDate(l.due_on)}
                    </td>

                    <td className="text-nowrap">
                      <LoanState loan={l} />
                      {l.accrued_fine > 0 && (
                        <div className="cell-muted small mt-1 text-danger">
                          <i className="bi bi-cash-coin me-1"></i>
                          Fine so far {kes(l.accrued_fine)}
                        </div>
                      )}
                    </td>

                    <td className="text-end">
                      <span className="cell-mono fw-semibold">
                        {l.renewals}
                      </span>
                    </td>

                    <td className="text-end">
                      {l.is_active ? (
                        <div className="table-actions justify-content-end">
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => renew(l)}
                          >
                            <i className="bi bi-arrow-clockwise me-1"></i>
                            Renew
                          </button>
                          <Link
                            className="btn btn-sm btn-primary"
                            to={`/librarian/desk?return=${l.accession_no}`}
                          >
                            <i className="bi bi-box-arrow-in-down me-1"></i>
                            Receive
                          </Link>
                        </div>
                      ) : (
                        <span className="cell-muted small">
                          Closed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && data.results.length > 0 && (
          <Pager page={page} count={data.count} onPage={setPage} />
        )}
      </div>
    </>
  );
}

function FinesTab() {
  const [status, setStatus] = useState("UNPAID");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ count: 0, results: [], unpaid_total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [waiving, setWaiving] = useState(null);
  const [reason, setReason] = useState("");
  const [waivingBusy, setWaivingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await libraryApi.fines({
        status: status || undefined,
        q: dq || undefined,
        page,
      });
      setData(r.data);
    } catch (e) {
      setError(errMsg(e, "Couldn't load fines."));
      setData({ count: 0, results: [], unpaid_total: 0 });
    } finally {
      setLoading(false);
    }
  }, [status, dq, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status, dq]);

  const pay = async (f) => {
    if (!window.confirm(`Mark ${kes(f.amount)} from ${f.student_name} as paid?`)) return;
    try {
      await libraryApi.payFine(f.id);
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const waive = async () => {
    setWaivingBusy(true);
    try {
      await libraryApi.waiveFine(waiving.id, reason);
      setWaiving(null);
      setReason("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setWaivingBusy(false);
    }
  };

  const hasFilters = !!(dq || status !== "UNPAID");

  return (
    <>
      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError("")}></button>
        </div>
      )}

      {/* ---- Unpaid-total tile ---- */}
      <div className="stat-grid">
        <div className={`dm-card ${data.unpaid_total > 0 ? "dm-card--danger" : "dm-card--primary"}`}>
          <div className="dm-card__top">
            <span className="dm-card__label">Total unpaid fines</span>
            <span className="dm-card__icon">
              <i className="bi bi-cash-coin"></i>
            </span>
          </div>
          <div className="dm-card__num">{kes(data.unpaid_total)}</div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0" style={{ width: "100%" }}>
            <select
              className="form-select w-auto"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="UNPAID">Unpaid</option>
              <option value="PAID">Paid</option>
              <option value="WAIVED">Waived</option>
              <option value="">All</option>
            </select>

            <div className="toolbar__search" style={{ maxWidth: "none" }}>
              <i className="bi bi-search"></i>
              <input
                type="text"
                className="form-control"
                placeholder="Learner, admission no. or title..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            {hasFilters && (
              <button
                className="btn btn-sm btn-light"
                onClick={() => {
                  setQ("");
                  setStatus("UNPAID");
                }}
              >
                <i className="bi bi-x-lg me-1"></i>
                Clear
              </button>
            )}
          </div>

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title mb-0">
              <i className="bi bi-receipt me-2 text-brand"></i>
              Fines
            </span>
            <span className="chart-card__subtitle mb-0">
              {data.count} record{data.count === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={6} />
        ) : data.results.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt"></i>
            <h6>No fines here</h6>
            <p className="text-muted-soft">
              {hasFilters ? "Try a different status or clear the search." : "Nothing to collect right now."}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Book</th>
                  <th>Reason</th>
                  <th className="text-end" style={{ width: "130px" }}>Amount</th>
                  <th style={{ width: "140px" }}>Status</th>
                  <th style={{ width: "220px" }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((f) => {
                  const meta =
                    FINE_BADGE[f.status] || {
                      badge: "badge-neutral",
                      dot: "status-dot--offline",
                    };
                  return (
                    <tr key={f.id}>
                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">
                            {(f.student_name || "")
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <div>
                            <div className="cell-name">{f.student_name}</div>
                            <div className="cell-muted small mt-1">
                              {f.admission_no}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="cell-name">
                          {f.title}
                        </div>
                        <div className="cell-muted small mt-1">
                          <i className="bi bi-upc me-1"></i>
                          {f.accession_no}
                        </div>
                      </td>

                      <td>
                        <div className="cell-muted small">
                          {f.reason_display}
                        </div>
                        {f.note && (
                          <div className="cell-muted small mt-1">
                            {f.note}
                          </div>
                        )}
                      </td>

                      <td className="text-end">
                        <span className="cell-mono fw-bold">
                          {kes(f.amount)}
                        </span>
                      </td>

                      <td>
                        <span className={`badge ${meta.badge}`}>
                          <span className={`status-dot ${meta.dot}`}></span>
                          {f.status_display}
                        </span>
                      </td>

                      <td className="text-end">
                        {f.status === "UNPAID" ? (
                          <div className="table-actions justify-content-end">
                            <button className="btn btn-sm btn-primary" onClick={() => pay(f)}>
                              <i className="bi bi-check2 me-1"></i>
                              Mark Paid
                            </button>
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => setWaiving(f)}
                            >
                              <i className="bi bi-slash-circle me-1"></i>
                              Waive
                            </button>
                          </div>
                        ) : (
                          <span className="cell-muted small">
                            No action
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && data.results.length > 0 && (
          <Pager page={page} count={data.count} onPage={setPage} />
        )}
      </div>

      {waiving && (
        <Modal
          title={`Waive ${kes(waiving.amount)} for ${waiving.student_name}`}
          onClose={() => setWaiving(null)}
        >
          <div className="modal-icon-circle modal-icon-circle--info">
            <i className="bi bi-slash-circle"></i>
          </div>

          <p className="text-center mb-3">
            Waiving this fine removes it from the learner's outstanding balance. The reason is kept
            on record.
          </p>

          <label className="form-label">Reason (required)</label>
          <input
            className="form-control"
            value={reason}
            maxLength={255}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            placeholder="e.g. Book found and returned late"
          />
          <div className="form-text-hint">This is stored with the fine for audit.</div>

          <div className="mt-3 d-flex gap-2 justify-content-end">
            <button className="btn btn-secondary" onClick={() => setWaiving(null)}>
              Cancel
            </button>
            <button
              className="btn btn-warning"
              disabled={!reason.trim() || waivingBusy}
              onClick={waive}
            >
              {waivingBusy ? "Waiving..." : "Waive Fine"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Loans() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "fines" ? "fines" : "loans";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Loans &amp; Fines</h1>
          <p className="page-subtitle">Everything lent out, and what is owed</p>
        </div>
      </div>

      <ul className="nav nav-tabs mb-3" role="tablist">
        <li className="nav-item">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "loans"}
            className={`nav-link ${tab === "loans" ? "active" : ""}`}
            onClick={() => setParams({})}
          >
            <i className="bi bi-journal-text me-1"></i>
            Loans
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "fines"}
            className={`nav-link ${tab === "fines" ? "active" : ""}`}
            onClick={() => setParams({ tab: "fines" })}
          >
            <i className="bi bi-cash-coin me-1"></i>
            Fines
          </button>
        </li>
      </ul>

      {tab === "loans" ? <LoansTab /> : <FinesTab />}
    </div>
  );
}