// pages/finance/ClassAnalysis.jsx
import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { financeReportsApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";

const formatKES = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

const PIE_COLORS = [
  "var(--blue-700)",
  "var(--gold-500)",
  "var(--success-600)",
  "var(--blue-400)",
  "var(--danger-600)",
];

// Shared chart styling so every chart matches the rest of the portal
const TOOLTIP_STYLE = {
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-color)",
  boxShadow: "var(--shadow-sm)",
  fontSize: 12,
};
const AXIS_TICK = { fontSize: 12, fill: "var(--ink-400)" };

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ ...TOOLTIP_STYLE, background: "var(--surface)", padding: "0.6rem 0.8rem" }}>
      <div style={{ fontWeight: 700, color: "var(--ink-900)", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, marginTop: 2 }}>
          {p.name}: {p.dataKey === "invoice_count" ? p.value : formatKES(p.value)}
        </div>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div style={{ ...TOOLTIP_STYLE, background: "var(--surface)", padding: "0.6rem 0.8rem" }}>
      <div style={{ fontWeight: 700, color: "var(--ink-900)" }}>{p.name}</div>
      <div>{formatKES(p.value)}</div>
      <div className="text-muted-soft">{p.payload.count} payment(s)</div>
    </div>
  );
}

/**
 * Finance - Page 2 of the finance reports suite: everything scoped to
 * one academic year (tab strip at the top, same pattern as Collections).
 *   - classroom_outstanding: worst-first table of unpaid balances by class
 *   - monthly_trend: 4 series (due, paid, outstanding, invoice count) -
 *     money series on the left axis, count on the right
 *   - payment_method_breakdown: pie of amount collected per method
 *   - gender_balance_analysis: side-by-side male/female balance cards
 */
export default function FinanceClassAnalysis() {
  const [data, setData] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(null);

  const load = (yearId) => {
    const isInitial = yearId === undefined;
    if (isInitial) setLoading(true);
    else setSwitching(true);
    setError(null);
    financeReportsApi
      .classAnalysis(isInitial ? undefined : { academic_year: yearId })
      .then(({ data: res }) => {
        setData(res);
        setSelectedYear(res.selected_academic_year);
      })
      .catch(() => setError("Could not load the class analysis report."))
      .finally(() => {
        setLoading(false);
        setSwitching(false);
      });
  };

  useEffect(() => {
    load(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabClick = (yearId) => {
    if (yearId === selectedYear) return;
    load(yearId);
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Class Analysis</h1>
          <p className="page-subtitle">
            Which classes are carrying the most unpaid fees, how collection has moved through the year, and
            how payments break down by method and gender.
          </p>
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

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-circle me-2"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError(null)}></button>
        </div>
      )}

      {loading ? (
        <>
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <div className="skeleton" style={{ width: 220, height: 18 }}></div>
            </div>
            <TableSkeleton rows={5} columns={5} />
          </div>
          <div className="chart-card mb-3">
            <div className="skeleton" style={{ width: 200, height: 18, marginBottom: 16 }}></div>
            <div className="skeleton" style={{ width: "100%", height: 280 }}></div>
          </div>
          <div className="row g-3">
            <div className="col-12 col-lg-6">
              <div className="chart-card h-100">
                <div className="skeleton" style={{ width: 180, height: 18, marginBottom: 16 }}></div>
                <div className="skeleton" style={{ width: "100%", height: 220 }}></div>
              </div>
            </div>
            <div className="col-12 col-lg-6">
              <div className="chart-card h-100">
                <div className="skeleton" style={{ width: 180, height: 18, marginBottom: 16 }}></div>
                <div className="skeleton" style={{ width: "100%", height: 220 }}></div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="relative-wrap">
          {switching && (
            <div className="loading-overlay loading-overlay--top">
              <div className="loading-overlay__spinner" />
            </div>
          )}

          {/* Classroom outstanding, worst-first */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-building me-2 text-brand"></i>
                Classroom Outstanding Balances
              </span>
              {data.classroom_outstanding.length > 0 && (
                <span className="badge badge-neutral">{data.classroom_outstanding.length} classes</span>
              )}
            </div>
            {data.classroom_outstanding.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-check2-circle text-ok"></i>
                <h6>All clear!</h6>
                <p className="text-muted-soft">No outstanding balances for this academic year.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th className="text-end">Total Due</th>
                      <th className="text-end">Total Paid</th>
                      <th className="text-end">Outstanding</th>
                      <th style={{ width: "30%", minWidth: 160 }}>Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.classroom_outstanding.map((c) => {
                      const pctCollected = c.due > 0 ? Math.round((c.paid / c.due) * 100) : 100;
                      return (
                        <tr key={c.classroom_id}>
                          <td data-label="Class">
                            <span className="cell-name">{c.classroom}</span>
                          </td>
                          <td data-label="Total due" className="cell-num">
                            {formatKES(c.due)}
                          </td>
                          <td data-label="Total paid" className="cell-num text-ok">
                            {formatKES(c.paid)}
                          </td>
                          <td data-label="Outstanding" className="cell-num">
                            <span className={c.outstanding > 0 ? "text-owe fw-semibold" : "cell-muted"}>
                              {formatKES(c.outstanding)}
                            </span>
                          </td>
                          <td data-label="Collected">
                            <div className="progress-label">
                              <span className="cell-mono">{pctCollected}%</span>
                            </div>
                            <div className="progress-track">
                              <div
                                className={`progress-fill ${
                                  pctCollected < 50
                                    ? "progress-fill--danger"
                                    : pctCollected < 100
                                    ? "progress-fill--gold"
                                    : "progress-fill--success"
                                }`}
                                style={{ width: `${Math.min(pctCollected, 100)}%` }}
                              />
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

          {/* 4-line monthly trend: due / paid / outstanding (money) + invoice count */}
          <div className="chart-card mb-3">
            <div className="chart-card__header">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-graph-up-arrow me-2 text-brand"></i>
                  Monthly Trend
                </div>
                <div className="chart-card__subtitle">
                  Invoiced, collected, outstanding, and invoice count per month
                </div>
              </div>
            </div>
            {data.monthly_trend.months.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-graph-up"></i>
                <h6>Nothing to show yet</h6>
                <p className="text-muted-soft">No data available for the selected period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={data.monthly_trend.months.map((m, i) => ({
                    label: m,
                    total_due: data.monthly_trend.total_due[i],
                    total_paid: data.monthly_trend.total_paid[i],
                    outstanding: data.monthly_trend.outstanding[i],
                    invoice_count: data.monthly_trend.invoice_count[i],
                  }))}
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={AXIS_TICK}
                    axisLine={{ stroke: "var(--border-color)" }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="money"
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    width={44}
                  />
                  <YAxis
                    yAxisId="count"
                    orientation="right"
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    width={32}
                  />
                  <Tooltip content={<TrendTooltip />} />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)" }}
                  />
                  <Line
                    yAxisId="money"
                    type="monotone"
                    dataKey="total_due"
                    name="Invoiced"
                    stroke="var(--blue-700)"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "var(--blue-700)" }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="money"
                    type="monotone"
                    dataKey="total_paid"
                    name="Collected"
                    stroke="var(--success-600)"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "var(--success-600)" }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="money"
                    type="monotone"
                    dataKey="outstanding"
                    name="Outstanding"
                    stroke="var(--danger-600)"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "var(--danger-600)" }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="count"
                    type="monotone"
                    dataKey="invoice_count"
                    name="Invoices issued"
                    stroke="var(--gold-500)"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={{ r: 3, fill: "var(--gold-500)" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="row g-3">
            {/* Payment method pie */}
            <div className="col-12 col-lg-6">
              <div className="chart-card h-100">
                <div className="chart-card__header">
                  <div>
                    <div className="chart-card__title">
                      <i className="bi bi-pie-chart me-2 text-brand"></i>
                      Payments by Method
                    </div>
                    <div className="chart-card__subtitle">Amount collected per payment channel</div>
                  </div>
                </div>
                {data.payment_method_breakdown.length === 0 ? (
                  <div className="empty-state">
                    <i className="bi bi-pie-chart"></i>
                    <h6>No payments recorded</h6>
                    <p className="text-muted-soft">Payment data will appear here once available</p>
                  </div>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={data.payment_method_breakdown}
                          dataKey="amount"
                          nameKey="method"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={2}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {data.payment_method_breakdown.map((entry, i) => (
                            <Cell key={entry.method} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="chart-legend justify-content-center">
                      {data.payment_method_breakdown.map((entry, i) => (
                        <div className="chart-legend__item" key={entry.method}>
                          <span
                            className="chart-legend__swatch"
                            style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                          />
                          {entry.method} · <span className="cell-mono">{formatKES(entry.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Gender balance analysis */}
            <div className="col-12 col-lg-6">
              <div className="chart-card h-100">
                <div className="chart-card__header">
                  <div>
                    <div className="chart-card__title">
                      <i className="bi bi-gender-ambiguous me-2 text-brand"></i>
                      Balances by Gender
                    </div>
                    <div className="chart-card__subtitle">Who's carrying more outstanding fees</div>
                  </div>
                </div>
                {!data.gender_balance_analysis.male && !data.gender_balance_analysis.female ? (
                  <div className="empty-state">
                    <i className="bi bi-people"></i>
                    <h6>No data yet</h6>
                    <p className="text-muted-soft">Gender data will appear here once available</p>
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {["male", "female"].map((key) => {
                      const g = data.gender_balance_analysis[key];
                      if (!g) return null;
                      const isMale = key === "male";
                      return (
                        <div key={key} className={`gender-card gender-card--${key}`}>
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <span className="gender-card__title">
                              <i className={`bi ${isMale ? "bi-gender-male" : "bi-gender-female"}`}></i>
                              {g.label}
                            </span>
                            <span className="badge badge-neutral">{g.invoice_count} invoices</span>
                          </div>
                          <div className="row g-2">
                            <div className="col-6">
                              <div className="gender-stat__label">Total due</div>
                              <div className="gender-stat__value">{formatKES(g.total_due)}</div>
                            </div>
                            <div className="col-6">
                              <div className="gender-stat__label">Total paid</div>
                              <div className="gender-stat__value text-ok">{formatKES(g.total_paid)}</div>
                            </div>
                            <div className="col-6">
                              <div className="gender-stat__label">Outstanding</div>
                              <div className="gender-stat__value text-owe">{formatKES(g.total_outstanding)}</div>
                            </div>
                            <div className="col-6">
                              <div className="gender-stat__label">Avg. per student</div>
                              <div className="gender-stat__value">{formatKES(g.average_outstanding)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}