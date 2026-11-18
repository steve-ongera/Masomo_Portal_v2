import { useEffect, useState } from "react";
import {
  LoanState,
  errMsg,
  fmtDate,
  kes,
  libraryApi,
  spineColor,
  useDebounced,
} from "../librarian/shared";
import Breadcrumb from "../../components/Breadcrumb";

export default function MyLibrary() {
  const [studentId, setStudentId] = useState(null);
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [books, setBooks] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    libraryApi
      .my(studentId ? { student_id: studentId } : undefined)
      .then((r) => {
        if (alive) setD(r.data);
      })
      .catch((e) => {
        if (alive) setError(errMsg(e, "Couldn't load the library page."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [studentId]);

  useEffect(() => {
    if (dq.trim().length < 2) {
      setBooks(null);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    libraryApi
      .books({ q: dq })
      .then((r) => {
        if (alive) setBooks(r.data.results || []);
      })
      .catch(() => {
        if (alive) setBooks([]);
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [dq]);

  if (loading) {
    return (
      <div>
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/student" },
            { label: "Library", href: "/student/library" },
          ]}
        />
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
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/student" },
          { label: "Library", href: "/student/library" },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-subtitle">
            {d
              ? `${d.student.name} · ${d.student.admission_no}`
              : "Your borrowed books and the catalogue"}
          </p>
        </div>

        {d?.children?.length > 1 && (
          <div style={{ minWidth: "200px" }}>
            <label className="form-label">Child</label>
            <select
              className="form-select"
              value={d.student.student_id}
              onChange={(e) => setStudentId(Number(e.target.value))}
            >
              {d.children.map((c) => (
                <option key={c.student_id} value={c.student_id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
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
          {d.unpaid_fines > 0 && (
            <div className="alert alert-danger d-flex align-items-start gap-2">
              <i className="bi bi-exclamation-octagon mt-1"></i>
              <div>
                <strong>Unpaid library fines: {kes(d.unpaid_fines)}</strong>
                <div style={{ fontSize: "var(--fs-xs)", marginTop: "0.2rem" }}>
                  Please settle them at the library to keep borrowing books.
                </div>
              </div>
            </div>
          )}

          <div
            className="mb-3 p-3"
            style={{
              background: "var(--blue-50)",
              border: "1px solid var(--blue-200)",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--fs-xs)",
              color: "var(--blue-800)",
              lineHeight: 1.55,
            }}
          >
            <i className="bi bi-info-circle me-1"></i>
            Books can be borrowed for <strong>{d.rules.loan_days} days</strong>, up to{" "}
            <strong>{d.rules.max_active_loans}</strong> at a time, and renewed{" "}
            <strong>{d.rules.max_renewals}</strong> times at the library. Late books cost{" "}
            <strong>{kes(d.rules.fine_per_day)} per day</strong>.
          </div>

          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                <i className="bi bi-journal-text me-2"></i>
                Borrowed Now
              </span>
              <span className={`badge ${d.current.length > 0 ? "badge-blue" : "badge-neutral"}`}>
                {d.current.length}
              </span>
            </div>

            {d.current.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-journal"></i>
                <h6>No books borrowed right now</h6>
                <p className="text-muted-soft">Borrowed books will appear here.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Book</th>
                      <th style={{ width: "140px" }}>Borrowed</th>
                      <th style={{ width: "140px" }}>Due</th>
                      <th style={{ width: "220px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.current.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <div className="cell-name">{l.title}</div>
                          <div
                            style={{
                              fontSize: "var(--fs-xs)",
                              color: "var(--ink-400)",
                              marginTop: "2px",
                            }}
                          >
                            {l.author || "Unknown author"}
                          </div>
                        </td>
                        <td style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                          {fmtDate(l.issued_on)}
                        </td>
                        <td style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                          {fmtDate(l.due_on)}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <LoanState loan={l} />
                          {l.accrued_fine > 0 && (
                            <div
                              style={{
                                fontSize: "var(--fs-xs)",
                                color: "var(--danger-600)",
                                marginTop: "4px",
                              }}
                            >
                              <i className="bi bi-cash-coin me-1"></i>
                              Fine so far {kes(l.accrued_fine)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                <i className="bi bi-search me-2"></i>
                Find a Book
              </span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
                Search the catalogue
              </span>
            </div>

            <div className="p-3">
              <div style={{ position: "relative", maxWidth: "440px" }}>
                <i
                  className="bi bi-search"
                  style={{
                    position: "absolute",
                    left: "0.85rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--ink-400)",
                  }}
                ></i>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search by title, author or ISBN..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  style={{ paddingLeft: "2.4rem" }}
                />
              </div>

              {searching && (
                <p className="text-muted-soft mt-3 mb-0" style={{ fontSize: "var(--fs-xs)" }}>
                  <span className="dot-loader me-2">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                  Searching...
                </p>
              )}
            </div>

            {!searching &&
              books &&
              (books.length === 0 ? (
                <div className="empty-state">
                  <i className="bi bi-search"></i>
                  <h6>No books match "{q}"</h6>
                  <p className="text-muted-soft">Try a different title or author.</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th style={{ width: "160px" }}>Category</th>
                        <th style={{ width: "100px" }}>Shelf</th>
                        <th style={{ width: "160px" }}>Availability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {books.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <div className="d-flex align-items-center gap-2">
                              <span
                                style={{
                                  width: 4,
                                  height: 32,
                                  borderRadius: "var(--radius-sm)",
                                  background: spineColor(b.category_name || ""),
                                  flexShrink: 0,
                                }}
                                title={b.category_name || ""}
                              ></span>
                              <div style={{ minWidth: 0 }}>
                                <div className="cell-name">{b.title}</div>
                                <div
                                  style={{
                                    fontSize: "var(--fs-xs)",
                                    color: "var(--ink-400)",
                                    marginTop: "2px",
                                  }}
                                >
                                  {b.author || "Unknown author"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            {b.category_name ? (
                              <span className="badge badge-blue">{b.category_name}</span>
                            ) : (
                              <span className="cell-muted">—</span>
                            )}
                          </td>
                          <td style={{ fontSize: "var(--fs-xs)", color: "var(--ink-700)" }}>
                            {b.shelf_location || <span className="cell-muted">—</span>}
                          </td>
                          <td>
                            {b.available_copies > 0 ? (
                              <span className="badge badge-success">
                                <span className="status-dot status-dot--online"></span>
                                {b.available_copies} available
                              </span>
                            ) : (
                              <span className="badge badge-neutral">
                                <span className="status-dot status-dot--offline"></span>
                                All out
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>

          {d.fines.length > 0 && (
            <div className="table-wrap mb-3">
              <div className="table-wrap__header">
                <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                  <i className="bi bi-cash-coin me-2"></i>
                  Fines
                </span>
                <span className="badge badge-danger">{d.fines.length}</span>
              </div>

              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Book</th>
                      <th>Reason</th>
                      <th className="text-end" style={{ width: "130px" }}>Amount</th>
                      <th style={{ width: "140px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.fines.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <span className="cell-name">{f.title}</span>
                        </td>
                        <td style={{ fontSize: "var(--fs-xs)", color: "var(--ink-700)" }}>
                          {f.reason_display}
                        </td>
                        <td className="text-end">
                          <span style={{ fontWeight: 700, color: "var(--ink-900)" }}>
                            {kes(f.amount)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              f.status === "PAID"
                                ? "badge-success"
                                : f.status === "WAIVED"
                                ? "badge-neutral"
                                : "badge-danger"
                            }`}
                          >
                            <span
                              className={`status-dot ${
                                f.status === "PAID" ? "status-dot--online" : "status-dot--offline"
                              }`}
                            ></span>
                            {f.status_display}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="table-wrap">
            <div className="table-wrap__header">
              <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                <i className="bi bi-clock-history me-2"></i>
                Past Loans
              </span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
                {d.history.length} record{d.history.length === 1 ? "" : "s"}
              </span>
            </div>

            {d.history.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-clock-history"></i>
                <h6>Nothing returned yet</h6>
                <p className="text-muted-soft">Books you've returned will appear here.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Book</th>
                      <th style={{ width: "140px" }}>Borrowed</th>
                      <th style={{ width: "140px" }}>Returned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.history.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <span className="cell-name">{l.title}</span>
                        </td>
                        <td style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                          {fmtDate(l.issued_on)}
                        </td>
                        <td style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                          {fmtDate(l.returned_on)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}