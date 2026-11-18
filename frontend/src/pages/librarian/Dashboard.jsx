import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoanState, errMsg, fmtDate, kes, libraryApi } from "./shared";

const barOpacity = (count, max) => {
  if (!max || !count) return 0.25;
  return 0.4 + (count / max) * 0.6;
};

function LoanList({ title, rows, empty, icon, tone }) {
  return (
    <div className="table-wrap h-100">
      <div className="table-wrap__header">
        <span className="chart-card__title mb-0">
          <i className={`bi ${icon} me-2 text-brand`}></i>
          {title}
        </span>
        <span className={`badge ${rows.length > 0 ? tone : "badge-neutral"}`}>
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-check2-circle"></i>
          <h6>{empty}</h6>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <tbody>
              {rows.map((l) => (
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

                  <td className="text-nowrap">
                    <LoanState loan={l} />
                    <div className="cell-muted small mt-1">
                      <i className="bi bi-calendar-event me-1"></i>
                      Due {fmtDate(l.due_on)}
                    </div>
                  </td>

                  <td className="text-end">
                    <Link
                      className="btn btn-sm btn-outline-primary"
                      to={`/librarian/desk?return=${l.accession_no}`}
                    >
                      <i className="bi bi-box-arrow-in-down me-1"></i>
                      Receive
                    </Link>
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

export default function LibraryDashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    libraryApi
      .dashboard()
      .then((r) => {
        if (alive) setD(r.data);
      })
      .catch((e) => {
        if (alive) setError(errMsg(e, "Couldn't load the dashboard."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const max = d ? Math.max(...d.issued_per_day.map((x) => x.count), 1) : 1;

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Library</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-subtitle">Stock, lending, and what needs chasing today</p>
        </div>
        <div className="page-header__actions">
          <Link className="btn btn-primary btn-sm" to="/librarian/desk">
            <i className="bi bi-arrow-left-right"></i>
            Issue or Return a Book
          </Link>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError("")}></button>
        </div>
      )}

      {d && (
        <>
          {/* ---- Stat tiles ---- */}
          <div className="stat-grid">
            <div className="dm-card dm-card--primary">
              <div className="dm-card__top">
                <span className="dm-card__label">Titles</span>
                <span className="dm-card__icon">
                  <i className="bi bi-book"></i>
                </span>
              </div>
              <div className="dm-card__num">{d.titles}</div>
            </div>

            <div className="dm-card dm-card--primary">
              <div className="dm-card__top">
                <span className="dm-card__label">Copies</span>
                <span className="dm-card__icon">
                  <i className="bi bi-collection"></i>
                </span>
              </div>
              <div className="dm-card__num">{d.copies.total}</div>
            </div>

            <div className="dm-card dm-card--success">
              <div className="dm-card__top">
                <span className="dm-card__label">On the Shelf</span>
                <span className="dm-card__icon">
                  <i className="bi bi-check2-circle"></i>
                </span>
              </div>
              <div className="dm-card__num">{d.copies.available}</div>
            </div>

            <div className="dm-card dm-card--warning">
              <div className="dm-card__top">
                <span className="dm-card__label">On Loan</span>
                <span className="dm-card__icon">
                  <i className="bi bi-box-arrow-up-right"></i>
                </span>
              </div>
              <div className="dm-card__num">{d.copies.on_loan}</div>
            </div>

            <div className={`dm-card ${d.overdue ? "dm-card--danger" : "dm-card--primary"}`}>
              <div className="dm-card__top">
                <span className="dm-card__label">Overdue</span>
                <span className="dm-card__icon">
                  <i className="bi bi-exclamation-triangle"></i>
                </span>
              </div>
              <div className="dm-card__num">{d.overdue}</div>
            </div>

            <div className="dm-card dm-card--primary">
              <div className="dm-card__top">
                <span className="dm-card__label">Due Today</span>
                <span className="dm-card__icon">
                  <i className="bi bi-calendar-event"></i>
                </span>
              </div>
              <div className="dm-card__num">{d.due_today}</div>
            </div>

            <div className={`dm-card ${d.unpaid_fines_count ? "dm-card--danger" : "dm-card--primary"}`}>
              <div className="dm-card__top">
                <span className="dm-card__label">
                  {d.unpaid_fines_count} unpaid fine{d.unpaid_fines_count === 1 ? "" : "s"}
                </span>
                <span className="dm-card__icon">
                  <i className="bi bi-cash-coin"></i>
                </span>
              </div>
              <div className="dm-card__num">{kes(d.unpaid_fines_total)}</div>
            </div>

            {(d.copies.lost > 0 || d.copies.damaged > 0) && (
              <div className="dm-card dm-card--danger">
                <div className="dm-card__top">
                  <span className="dm-card__label">Out of circulation</span>
                  <span className="dm-card__icon">
                    <i className="bi bi-tools"></i>
                  </span>
                </div>
                <div className="dm-card__num">{d.copies.damaged + d.copies.lost}</div>
              </div>
            )}
          </div>

          {/* ---- 14-day issuance chart ---- */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-bar-chart-line me-2 text-brand"></i>
                Books Issued, Last 14 Days
              </span>
              <span className="chart-card__subtitle mb-0">
                {d.issued_per_day.reduce((sum, x) => sum + (x.count || 0), 0)} total
              </span>
            </div>

            <div className="p-3" role="img" aria-label="Books issued per day">
              {d.issued_per_day.length === 0 ? (
                <p className="form-text-hint mb-0">
                  No issuance data to show.
                </p>
              ) : (
                <div
                  className="d-flex align-items-end gap-1"
                  style={{
                    minHeight: "120px",
                    paddingBottom: "0.4rem",
                    borderBottom: "1px solid var(--border-color)",
                    overflowX: "auto",
                  }}
                >
                  {d.issued_per_day.map((x) => {
                    const pct = max > 0 ? Math.round((x.count / max) * 100) : 0;
                    return (
                      <div
                        key={x.date}
                        title={`${fmtDate(x.date)}: ${x.count}`}
                        style={{
                          flex: "1 0 18px",
                          minWidth: "14px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <div
                          style={{
                            height: "90px",
                            width: "100%",
                            display: "flex",
                            alignItems: "flex-end",
                            justifyContent: "center",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              maxWidth: "14px",
                              height: `${pct}%`,
                              minHeight: x.count > 0 ? "4px" : "0",
                              background: "var(--blue-600)",
                              opacity: barOpacity(x.count, max),
                              borderRadius: "var(--radius-sm)",
                              transition: "height 0.2s ease",
                            }}
                          ></div>
                        </div>
                        <span
                          className="text-muted-soft"
                          style={{
                            fontSize: "0.6rem",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {String(x.date).slice(8)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ---- Overdue + Due Today ---- */}
          <div className="row g-3">
            <div className="col-12 col-xl-6">
              <LoanList
                title="Overdue"
                rows={d.overdue_list}
                empty="Nothing overdue — well done"
                icon="bi-exclamation-triangle"
                tone="badge-danger"
              />
            </div>
            <div className="col-12 col-xl-6">
              <LoanList
                title="Due Today"
                rows={d.due_today_list}
                empty="Nothing due today"
                icon="bi-calendar-event"
                tone="badge-gold"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}