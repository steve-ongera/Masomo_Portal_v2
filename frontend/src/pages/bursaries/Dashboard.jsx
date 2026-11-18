import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { bursaryApi, calendarApi, errMsg, unwrap } from "../../services/api";

const KIND_LABEL = {
  SCHOLARSHIP: "Scholarship",
  BURSARY: "Bursary",
  SPONSORSHIP: "Sponsorship",
  STAFF_DISCOUNT: "Staff discount",
  SIBLING_DISCOUNT: "Sibling discount",
  OTHER: "Other",
};

const fmt = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0);

export default function BursaryDashboard() {
  const [years, setYears] = useState([]);
  const [year, setYear] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    calendarApi
      .academicYears()
      .then((r) => setYears(unwrap(r)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setError("");
    setLoading(true);
    bursaryApi
      .dashboard(year ? { academic_year: year } : {})
      .then((r) => setData(r.data))
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [year]);

  const pending = data?.awards_by_status?.PENDING || 0;

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Bursaries &amp; Discounts</h1>
          <p className="page-subtitle">
            Track awards, funder pledges, and school-waived discounts
            {data?.academic_year ? ` — ${data.academic_year}` : ""}
          </p>
        </div>
        <div className="page-header__actions">
          <select
            className="form-select w-auto"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label="Academic year"
          >
            <option value="">Current year</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.year}
              </option>
            ))}
          </select>
          <Link to="/bursaries/awards" className="btn btn-primary">
            <i className="bi bi-plus-lg" />
            Add an award
          </Link>
        </div>
      </div>

      {/* ---------- Error banner ---------- */}
      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          {error}
          <button
            type="button"
            className="btn-close"
            onClick={() => setError("")}
            aria-label="Dismiss"
          />
        </div>
      )}

      {/* ---------- Loading ---------- */}
      {loading && !data ? (
        <div className="text-center py-5">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading dashboard...
        </div>
      ) : !data ? null : (
        <>
          {/* ---------- Pending awards alert ---------- */}
          {pending > 0 && (
            <Link
              to="/bursaries/awards?status=PENDING"
              className="alert alert-warning d-flex align-items-center gap-2 text-decoration-none"
            >
              <i className="bi bi-hourglass-split" />
              <span>
                {pending} award{pending === 1 ? " is" : "s are"} waiting for approval.
              </span>
              <i className="bi bi-arrow-right ms-auto" />
            </Link>
          )}

          {/* ---------- KPI grid ---------- */}
          <div className="stat-grid">
            <div className="dm-card dm-card--primary">
              <div className="dm-card__top">
                <span className="dm-card__label">Students supported</span>
                <span className="dm-card__icon">
                  <i className="bi bi-people" />
                </span>
              </div>
              <div className="dm-card__num">{data.students_supported}</div>
            </div>

            <div className="dm-card dm-card--warning">
              <div className="dm-card__top">
                <span className="dm-card__label">Discounts given by the school</span>
                <span className="dm-card__icon">
                  <i className="bi bi-percent" />
                </span>
              </div>
              <div className="dm-card__num">KES {fmt(data.waived_total)}</div>
              <div className="dm-card__sub">Reduced from fees charged</div>
            </div>

            <div className="dm-card dm-card--info">
              <div className="dm-card__top">
                <span className="dm-card__label">Pledged by funders</span>
                <span className="dm-card__icon">
                  <i className="bi bi-hand-thumbs-up" />
                </span>
              </div>
              <div className="dm-card__num">KES {fmt(data.pledged_total)}</div>
            </div>

            <div className="dm-card dm-card--success">
              <div className="dm-card__top">
                <span className="dm-card__label">Received from funders</span>
                <span className="dm-card__icon">
                  <i className="bi bi-cash-coin" />
                </span>
              </div>
              <div className="dm-card__num">KES {fmt(data.received_total)}</div>
            </div>

            <div className="dm-card dm-card--danger">
              <div className="dm-card__top">
                <span className="dm-card__label">Still owed by funders</span>
                <span className="dm-card__icon">
                  <i className="bi bi-exclamation-circle" />
                </span>
              </div>
              <div className="dm-card__num">KES {fmt(data.receivable_total)}</div>
              <div className="dm-card__sub">Receivable</div>
            </div>
          </div>

          {/* ---------- Unallocated remittances alert ---------- */}
          {data.unallocated_remittances > 0 && (
            <Link
              to="/bursaries/remittances"
              className="alert alert-primary d-flex align-items-center gap-2 text-decoration-none"
            >
              <i className="bi bi-info-circle" />
              <span>
                KES {fmt(data.unallocated_remittances)} received from funders has not
                been shared among students yet.
              </span>
              <i className="bi bi-arrow-right ms-auto" />
            </Link>
          )}

          {/* ---------- By funder ---------- */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-building me-2 text-brand" />
                Owed by each funder
              </span>
              <span className="chart-card__subtitle">
                {(data.by_source || []).length} funder
                {(data.by_source || []).length !== 1 ? "s" : ""}
              </span>
            </div>

            {(data.by_source || []).length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-building" />
                <h6>No funder-paid awards</h6>
                <p className="text-muted-soft">
                  No funder has pledged or paid an award this year.
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th>Funder</th>
                      <th className="text-end">Pledged</th>
                      <th className="text-end">Received</th>
                      <th className="text-end">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_source.map((s) => (
                      <tr key={s.source_id}>
                        <td data-label="Funder" className="cell-name">
                          {s.source}
                        </td>
                        <td data-label="Pledged" className="cell-num">
                          {fmt(s.pledged)}
                        </td>
                        <td data-label="Received" className="cell-num">
                          {fmt(s.received)}
                        </td>
                        <td
                          data-label="Outstanding"
                          className="cell-num fw-semibold"
                        >
                          {fmt(s.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---------- By scheme ---------- */}
          <div className="table-wrap">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-tags me-2 text-brand" />
                By scheme
              </span>
              <span className="chart-card__subtitle">
                {(data.by_scheme || []).length} scheme
                {(data.by_scheme || []).length !== 1 ? "s" : ""}
              </span>
            </div>

            {(data.by_scheme || []).length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-tags" />
                <h6>Nothing applied yet</h6>
                <p className="text-muted-soft">
                  No awards have been created for this academic year.
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th>Scheme</th>
                      <th>Type</th>
                      <th className="text-end">Students</th>
                      <th className="text-end">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_scheme.map((s) => (
                      <tr key={s.scheme_id}>
                        <td data-label="Scheme" className="cell-name">
                          {s.scheme}
                        </td>
                        <td data-label="Type">
                          <span className="badge badge-neutral">
                            {KIND_LABEL[s.kind] || s.kind}
                          </span>
                        </td>
                        <td data-label="Students" className="cell-num">
                          {s.students}
                        </td>
                        <td data-label="Amount" className="cell-num fw-semibold">
                          {fmt(s.amount)}
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