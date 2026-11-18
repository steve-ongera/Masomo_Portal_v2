// pages/finance/Collections.jsx
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { financeReportsApi } from "../../services/api";
import { MetricCard } from "../../components/MetricCard";

const formatKES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

const AXIS_TICK = { fontSize: 12, fill: "var(--ink-400)" };

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "0.6rem 0.8rem",
        boxShadow: "var(--shadow-sm)",
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--ink-900)", marginBottom: 2 }}>{label}</div>
      <div style={{ color: "var(--blue-700)", fontWeight: 600 }}>{formatKES(payload[0].value)}</div>
    </div>
  );
}

/**
 * Finance - Page 1 of the finance reports suite: lifetime collection
 * totals as 5 stat cards, plus a per-academic-year monthly revenue
 * trend. Switching the academic-year tab only re-fetches the trend
 * line - the stat cards stay lifetime totals, since "how much have I
 * collected since students started paying" isn't scoped to one year.
 */
export default function FinanceCollections() {
  const [data, setData] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    financeReportsApi
      .collections()
      .then(({ data: res }) => {
        if (cancelled) return;
        setData(res);
        setSelectedYear(res.selected_academic_year);
      })
      .catch(() => !cancelled && setError("Could not load the collections report."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTabClick = (yearId) => {
    if (yearId === selectedYear) return;
    setSelectedYear(yearId);
    setTrendLoading(true);
    financeReportsApi
      .collections({ academic_year: yearId })
      .then(({ data: res }) => setData((prev) => ({ ...prev, monthly_trend: res.monthly_trend })))
      .catch(() => setError("Could not load that academic year's trend."))
      .finally(() => setTrendLoading(false));
  };

  const trendTotal = data?.monthly_trend?.reduce((sum, m) => sum + Number(m.revenue || 0), 0) || 0;

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Collections Report</h1>
          <p className="page-subtitle">
            Lifetime fee collection totals and how revenue has moved through each academic year.
          </p>
        </div>
        {!loading && data && (
          <div className="page-header__actions">
            <button className="btn btn-outline-primary btn-sm">
              <i className="bi bi-download"></i>Export
            </button>
            <button className="btn btn-primary btn-sm">
              <i className="bi bi-printer"></i>Print
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-circle me-2"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError(null)}></button>
        </div>
      )}

      {/* Key metrics */}
      <div className="stat-grid">
        {loading || !data ? (
          [1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="dm-card" aria-hidden="true">
              <div className="dm-card__top">
                <div className="skeleton" style={{ width: 90, height: 12 }}></div>
                <div className="skeleton" style={{ width: 30, height: 30 }}></div>
              </div>
              <div className="skeleton" style={{ width: 70, height: 24 }}></div>
            </div>
          ))
        ) : (
          <>
            <MetricCard
              icon="bi-cash-stack"
              variant="primary"
              label="Total collected (all time)"
              value={formatKES(data.stat_cards.total_collected)}
            />
            <MetricCard
              icon="bi-exclamation-circle"
              variant="danger"
              label="Outstanding balance"
              value={formatKES(data.stat_cards.outstanding_balance)}
            />
            <MetricCard
              icon="bi-check-circle"
              variant="success"
              label="Fully paid invoices"
              value={data.stat_cards.fully_paid_invoices}
            />
            <MetricCard
              icon="bi-hourglass-split"
              variant="warning"
              label="Partially paid invoices"
              value={data.stat_cards.partially_paid_invoices}
            />
            <MetricCard
              icon="bi-x-circle"
              variant="danger"
              label="Unpaid invoices"
              value={data.stat_cards.unpaid_invoices}
            />
          </>
        )}
      </div>

      {/* Monthly Revenue Chart */}
      <div className="chart-card">
        <div className="chart-card__header">
          <div>
            <div className="chart-card__title">
              <i className="bi bi-graph-up-arrow me-2 text-brand"></i>
              Monthly Revenue
            </div>
            <div className="chart-card__subtitle">Payments received, by month, for the selected year</div>
          </div>
          {!loading && data?.academic_years?.length > 0 && (
            <ul className="nav nav-pills academic-year-tabs mb-0">
              {data.academic_years.map((ay) => (
                <li className="nav-item" key={ay.id}>
                  <button
                    type="button"
                    className={`nav-link ${selectedYear === ay.id ? "active" : ""}`}
                    onClick={() => handleTabClick(ay.id)}
                  >
                    {ay.year}
                    {ay.is_current && <span className="status-dot status-dot--pending ms-2 me-0"></span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 280, width: "100%", borderRadius: "var(--radius-md)" }} />
        ) : !data?.monthly_trend?.length ? (
          <div className="empty-state">
            <i className="bi bi-graph-up"></i>
            <h6>No payments recorded yet</h6>
            <p className="text-muted-soft mb-0">Nothing has been collected for this academic year.</p>
          </div>
        ) : (
          <div className="relative-wrap">
            {trendLoading && (
              <div className="loading-overlay">
                <div className="loading-overlay__spinner" />
              </div>
            )}
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.monthly_trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  axisLine={{ stroke: "var(--border-color)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  width={44}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--blue-700)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "var(--blue-700)" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Summary stats below chart */}
            <div className="chart-footer">
              <span>
                Total collected this year: <strong>{formatKES(trendTotal)}</strong>
              </span>
              <span>
                Average per month: <strong>{formatKES(trendTotal / data.monthly_trend.length)}</strong>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Additional info */}
      {!loading && data && (
        <div className="note-card">
          <i className="bi bi-info-circle"></i>
          <span>
            <strong>Note:</strong> Stat cards show <strong>lifetime</strong> totals across all academic years. The
            monthly trend chart updates when you switch years.
          </span>
        </div>
      )}
    </div>
  );
}