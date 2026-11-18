import { useEffect, useState, useCallback } from "react";
import { LoanState, downloadCsv, errMsg, fmtDate, libraryApi, todayISO } from "./shared";
import TableSkeleton from "../../components/TableSkeleton";

const TABS = [
  { key: "overdue", label: "Overdue Books", icon: "bi-exclamation-triangle" },
  { key: "popular", label: "Most Borrowed", icon: "bi-graph-up-arrow" },
  { key: "stock", label: "Stock Summary", icon: "bi-collection" },
];

export default function Reports() {
  const [tab, setTab] = useState("overdue");
  const [rows, setRows] = useState(null);
  const [popular, setPopular] = useState(null);
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(todayISO());
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMsg("");
    try {
      if (tab === "overdue") {
        const r = await libraryApi.overdueReport();
        setRows(r.data);
      } else if (tab === "stock") {
        const r = await libraryApi.stockReport();
        setRows(r.data);
      } else if (tab === "popular") {
        const r = await libraryApi.popularReport({ date_from: from, date_to: to });
        setPopular(r.data);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tab, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const remind = async () => {
    if (
      !window.confirm(
        "Send an in-app reminder to every learner (and guardians) with an overdue book?"
      )
    )
      return;
    try {
      const { data } = await libraryApi.remindOverdue();
      setMsg(`Reminded ${data.learners_reminded} of ${data.learners_overdue} learners.`);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const exportOverdue = () =>
    downloadCsv(`overdue_books_${todayISO()}.csv`, [
      ["Admission no", "Name", "Class", "Book", "Accession no", "Due", "Days overdue", "Fine so far (KES)"],
      ...rows.map((r) => [
        r.admission_no,
        r.student_name,
        r.classroom,
        r.title,
        r.accession_no,
        r.due_on,
        r.days_overdue,
        r.accrued_fine,
      ]),
    ]);

  const exportStock = () =>
    downloadCsv(`library_stock_${todayISO()}.csv`, [
      ["Category", "Titles", "Copies", "Available", "On loan", "Damaged", "Lost"],
      ...rows.map((r) => [
        r.category,
        r.titles,
        r.copies,
        r.available,
        r.on_loan,
        r.damaged,
        r.lost,
      ]),
    ]);

  const switchTab = (t) => {
    setRows(null);
    setPopular(null);
    setTab(t);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Library Reports</h1>
          <p className="page-subtitle">
            Who owes books, what is read most, and what is on the shelves
          </p>
        </div>
      </div>

      <ul className="nav nav-tabs mb-3" role="tablist">
        {TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`nav-link ${tab === t.key ? "active" : ""}`}
              onClick={() => switchTab(t.key)}
            >
              <i className={`bi ${t.icon} me-1`}></i>
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError("")}></button>
        </div>
      )}

      {msg && (
        <div className="alert alert-success alert-dismissible fade show" role="status">
          <i className="bi bi-check2-circle me-1"></i>
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      {/* ================== OVERDUE ================== */}
      {tab === "overdue" && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-exclamation-triangle me-2 text-brand"></i>
              Overdue Books
            </span>
            <div className="d-flex flex-wrap gap-2 align-items-center">
              {rows && (
                <span className={`badge ${rows.length > 0 ? "badge-danger" : "badge-neutral"}`}>
                  <span
                    className={`status-dot ${
                      rows.length > 0 ? "status-dot--offline" : "status-dot--online"
                    }`}
                  ></span>
                  {rows.length} overdue
                </span>
              )}
              {rows && rows.length > 0 && (
                <>
                  <button className="btn btn-sm btn-outline-primary" onClick={exportOverdue}>
                    <i className="bi bi-download me-1"></i>
                    CSV
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={remind}>
                    <i className="bi bi-bell me-1"></i>
                    Send Reminders
                  </button>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <TableSkeleton rows={8} columns={5} />
          ) : !rows || rows.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-check2-circle"></i>
              <h6>Nothing is overdue</h6>
              <p className="text-muted-soft">Every borrowed book is still within its loan period.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Learner</th>
                    <th style={{ width: "140px" }}>Class</th>
                    <th>Book</th>
                    <th style={{ width: "150px" }}>Due</th>
                    <th style={{ width: "220px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">
                            {(r.student_name || "")
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <div>
                            <div className="cell-name">{r.student_name}</div>
                            <div className="cell-muted small mt-1">
                              {r.admission_no}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="cell-muted small">
                        {r.classroom || <span className="cell-muted">—</span>}
                      </td>
                      <td>
                        <div className="cell-name">
                          {r.title}
                        </div>
                        <div className="cell-muted small mt-1">
                          <i className="bi bi-upc me-1"></i>
                          {r.accession_no}
                        </div>
                      </td>
                      <td className="cell-mono text-nowrap">
                        {fmtDate(r.due_on)}
                      </td>
                      <td>
                        <LoanState loan={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && rows && rows.length > 0 && (
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <strong>{rows.length}</strong> overdue book{rows.length === 1 ? "" : "s"}
              </span>
              <span className="form-text-hint m-0">
                Fines accrue daily until the book is returned
              </span>
            </div>
          )}
        </div>
      )}

      {/* ================== POPULAR ================== */}
      {tab === "popular" && (
        <>
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-calendar-range me-2 text-brand"></i>
                Date Range
              </span>
              <button
                className="btn btn-sm btn-light"
                onClick={() => {
                  setFrom(`${new Date().getFullYear()}-01-01`);
                  setTo(todayISO());
                }}
              >
                <i className="bi bi-arrow-counterclockwise me-1"></i>
                Reset
              </button>
            </div>

            <div className="p-3">
              <div className="row g-3">
                <div className="col-sm-6 col-md-4">
                  <label className="form-label">From</label>
                  <input
                    type="date"
                    className="form-control"
                    value={from}
                    max={to}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div className="col-sm-6 col-md-4">
                  <label className="form-label">To</label>
                  <input
                    type="date"
                    className="form-control"
                    value={to}
                    min={from}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="table-wrap">
              <TableSkeleton rows={6} columns={3} />
            </div>
          ) : (
            popular && (
              <div className="row g-3">
                <div className="col-12 col-xl-6">
                  <div className="table-wrap h-100">
                    <div className="table-wrap__header">
                      <span className="chart-card__title mb-0">
                        <i className="bi bi-book me-2 text-brand"></i>
                        Most Borrowed Books
                      </span>
                      <span className="chart-card__subtitle mb-0">
                        {popular.books.length} title{popular.books.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {popular.books.length === 0 ? (
                      <div className="empty-state">
                        <i className="bi bi-graph-up"></i>
                        <h6>No loans in this period</h6>
                        <p className="text-muted-soft">Try a wider date range.</p>
                      </div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-hover mb-0">
                          <thead>
                            <tr>
                              <th style={{ width: "50px" }}>#</th>
                              <th>Title</th>
                              <th className="text-end" style={{ width: "90px" }}>Loans</th>
                            </tr>
                          </thead>
                          <tbody>
                            {popular.books.map((b, i) => (
                              <tr key={b.book_id}>
                                <td>
                                  <span
                                    className={`badge ${
                                      i === 0 ? "badge-gold" : i === 1 ? "badge-blue" : "badge-neutral"
                                    }`}
                                    style={{ minWidth: 28, textAlign: "center" }}
                                  >
                                    {i + 1}
                                  </span>
                                </td>
                                <td>
                                  <div className="cell-name">{b.title}</div>
                                  <div className="cell-muted small mt-1">
                                    {b.author || "Unknown author"}
                                  </div>
                                </td>
                                <td className="text-end">
                                  <span className="cell-mono fw-bold">
                                    {b.loans}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-12 col-xl-6">
                  <div className="table-wrap h-100">
                    <div className="table-wrap__header">
                      <span className="chart-card__title mb-0">
                        <i className="bi bi-people me-2 text-brand"></i>
                        Most Active Readers
                      </span>
                      <span className="chart-card__subtitle mb-0">
                        {popular.borrowers.length} reader{popular.borrowers.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {popular.borrowers.length === 0 ? (
                      <div className="empty-state">
                        <i className="bi bi-people"></i>
                        <h6>No loans in this period</h6>
                        <p className="text-muted-soft">Try a wider date range.</p>
                      </div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-hover mb-0">
                          <thead>
                            <tr>
                              <th style={{ width: "50px" }}>#</th>
                              <th>Reader</th>
                              <th className="text-end" style={{ width: "90px" }}>Loans</th>
                            </tr>
                          </thead>
                          <tbody>
                            {popular.borrowers.map((b, i) => (
                              <tr key={b.admission_no}>
                                <td>
                                  <span
                                    className={`badge ${
                                      i === 0 ? "badge-gold" : i === 1 ? "badge-blue" : "badge-neutral"
                                    }`}
                                    style={{ minWidth: 28, textAlign: "center" }}
                                  >
                                    {i + 1}
                                  </span>
                                </td>
                                <td>
                                  <div className="table-avatar-cell">
                                    <div className="avatar-sm">
                                      {(b.name || "")
                                        .split(" ")
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((n) => n[0])
                                        .join("")}
                                    </div>
                                    <div>
                                      <div className="cell-name">{b.name}</div>
                                      <div className="cell-muted small mt-1">
                                        {b.admission_no}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="text-end">
                                  <span className="cell-mono fw-bold">
                                    {b.loans}
                                  </span>
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
            )
          )}
        </>
      )}

      {/* ================== STOCK ================== */}
      {tab === "stock" && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-collection me-2 text-brand"></i>
              Stock Summary by Category
            </span>
            {rows && rows.length > 0 && (
              <button className="btn btn-sm btn-outline-primary" onClick={exportStock}>
                <i className="bi bi-download me-1"></i>
                CSV
              </button>
            )}
          </div>

          {loading ? (
            <TableSkeleton rows={6} columns={7} />
          ) : !rows || rows.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-collection"></i>
              <h6>No books in the catalogue yet</h6>
              <p className="text-muted-soft">Add titles to see the stock summary.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="text-end" style={{ width: "100px" }}>Titles</th>
                    <th className="text-end" style={{ width: "100px" }}>Copies</th>
                    <th className="text-end" style={{ width: "110px" }}>Available</th>
                    <th className="text-end" style={{ width: "100px" }}>On Loan</th>
                    <th className="text-end" style={{ width: "100px" }}>Damaged</th>
                    <th className="text-end" style={{ width: "80px" }}>Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.category}>
                      <td>
                        <span className="cell-name">{r.category}</span>
                      </td>
                      <td className="text-end">
                        <span className="cell-mono fw-semibold">{r.titles}</span>
                      </td>
                      <td className="text-end">
                        <span className="cell-mono fw-semibold">{r.copies}</span>
                      </td>
                      <td className="text-end">
                        <span
                          className="cell-mono fw-semibold"
                          style={{
                            color: r.available > 0 ? "var(--success-600)" : "var(--ink-400)",
                          }}
                        >
                          {r.available}
                        </span>
                      </td>
                      <td className="text-end">
                        <span
                          className="cell-mono fw-semibold"
                          style={{
                            color: r.on_loan > 0 ? "var(--gold-600)" : "var(--ink-400)",
                          }}
                        >
                          {r.on_loan}
                        </span>
                      </td>
                      <td className="text-end">
                        <span
                          className="cell-mono fw-semibold"
                          style={{
                            color: r.damaged > 0 ? "var(--warning-600)" : "var(--ink-400)",
                          }}
                        >
                          {r.damaged}
                        </span>
                      </td>
                      <td className="text-end">
                        <span
                          className="cell-mono fw-semibold"
                          style={{
                            color: r.lost > 0 ? "var(--danger-600)" : "var(--ink-400)",
                          }}
                        >
                          {r.lost}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && rows && rows.length > 0 && (
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <strong>{rows.length}</strong> categor{rows.length === 1 ? "y" : "ies"} ·{" "}
                {rows.reduce((sum, r) => sum + (r.copies || 0), 0)} total copies
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}