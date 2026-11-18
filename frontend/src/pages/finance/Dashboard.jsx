// src/pages/finance/FinanceDashboard.jsx
import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { financeReportsApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import { MetricCard } from "../../components/MetricCard";

// Chart colours come from the design tokens so every chart matches the portal
const PALETTE = [
  "var(--blue-700)",
  "var(--success-600)",
  "var(--gold-500)",
  "var(--danger-600)",
  "var(--info-600)",
  "var(--blue-400)",
];

const currency = (value) =>
  `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const STATUS_BADGE = {
  paid: { className: "badge-success", label: "Fully paid", icon: "bi-check-circle" },
  partial: { className: "badge-warning", label: "Partial", icon: "bi-hourglass-split" },
  unpaid: { className: "badge-danger", label: "Unpaid", icon: "bi-x-circle" },
};

// Shared chart styling (same as the Admin dashboard)
const TOOLTIP_STYLE = {
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-color)",
  boxShadow: "var(--shadow-sm)",
  fontSize: 12,
};
const AXIS_TICK = { fontSize: 12, fill: "var(--ink-400)" };

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        ...TOOLTIP_STYLE,
        background: "var(--surface)",
        padding: "0.6rem 0.8rem",
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--ink-900)", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, marginTop: 2 }}>
          {p.name}: {currency(p.value)}
        </div>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div
      style={{
        ...TOOLTIP_STYLE,
        background: "var(--surface)",
        padding: "0.6rem 0.8rem",
      }}
    >
      <div style={{ fontWeight: 700, color: "var(--ink-900)" }}>{p.name}</div>
      <div style={{ color: "var(--blue-700)" }}>{currency(p.value)}</div>
      <div className="text-muted-soft">{p.payload.count} payment(s)</div>
    </div>
  );
}

export default function FinanceDashboard() {
  const [statCards, setStatCards] = useState(null);
  const [revenueTrend, setRevenueTrend] = useState([]);
  const [yearKeys, setYearKeys] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [classroomPayments, setClassroomPayments] = useState([]);
  const [latestInvoices, setLatestInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: collections } = await financeReportsApi.collections();
        if (cancelled) return;

        setStatCards(collections.stat_cards);

        const years = [...(collections.academic_years || [])]
          .sort((a, b) => b.year - a.year)
          .slice(0, 5)
          .sort((a, b) => a.year - b.year);

        const perYearTrends = await Promise.all(
          years.map((y) =>
            financeReportsApi
              .collections({ academic_year: y.id })
              .then((res) => ({ year: y.year, monthly_trend: res.data.monthly_trend }))
          )
        );
        if (cancelled) return;

        const monthCount = Math.max(0, ...perYearTrends.map((t) => t.monthly_trend.length));
        const merged = Array.from({ length: monthCount }, (_, i) => {
          const row = { period: perYearTrends[0]?.monthly_trend[i]?.label ?? "" };
          perYearTrends.forEach(({ year, monthly_trend }) => {
            row[year] = monthly_trend[i]?.revenue ?? 0;
          });
          return row;
        });
        setRevenueTrend(merged);
        setYearKeys(years.map((y) => String(y.year)));

        const { data: classAnalysis } = await financeReportsApi.classAnalysis();
        if (cancelled) return;
        setPaymentMethods(classAnalysis.payment_method_breakdown || []);
        setClassroomPayments(classAnalysis.classroom_outstanding || []);

        const { data: detailed } = await financeReportsApi.detailed({ page_size: 10 });
        if (cancelled) return;
        setLatestInvoices(detailed.results ?? detailed);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.detail || "Failed to load finance dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const statCardConfig = useMemo(
    () => [
      { key: "total_collected", label: "Total (All Time)", icon: "bi-cash-stack", variant: "primary", format: currency },
      { key: "outstanding_balance", label: "Outstanding Balance", icon: "bi-exclamation-circle", variant: "danger", format: currency },
      { key: "fully_paid_invoices", label: "Fully Paid Invoices", icon: "bi-check-circle", variant: "success", format: (v) => v ?? 0 },
      { key: "partially_paid_invoices", label: "Partially Paid Invoices", icon: "bi-hourglass-split", variant: "warning", format: (v) => v ?? 0 },
      { key: "unpaid_invoices", label: "Unpaid Invoices", icon: "bi-x-circle", variant: "danger", format: (v) => v ?? 0 },
    ],
    []
  );

  /* ------------------------------ LOADING ------------------------------ */
  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Finance Dashboard</h1>
            <p className="page-subtitle">Loading your dashboard...</p>
          </div>
        </div>

        <div className="stat-grid">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="dm-card" aria-hidden="true">
              <div className="dm-card__top">
                <div className="skeleton" style={{ width: 90, height: 12 }}></div>
                <div className="skeleton" style={{ width: 30, height: 30 }}></div>
              </div>
              <div className="skeleton" style={{ width: 70, height: 24 }}></div>
            </div>
          ))}
        </div>

        <div className="chart-card mb-3">
          <div className="skeleton" style={{ width: 220, height: 18, marginBottom: 16 }}></div>
          <div className="skeleton" style={{ width: "100%", height: 280 }}></div>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-12 col-lg-5">
            <div className="chart-card h-100">
              <div className="skeleton" style={{ width: 160, height: 18, marginBottom: 16 }}></div>
              <div className="skeleton" style={{ width: "100%", height: 250 }}></div>
            </div>
          </div>
          <div className="col-12 col-lg-7">
            <div className="chart-card h-100">
              <div className="skeleton" style={{ width: 180, height: 18, marginBottom: 16 }}></div>
              <div className="skeleton" style={{ width: "100%", height: 250 }}></div>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <div className="table-wrap__header">
            <div className="skeleton" style={{ width: 150, height: 18 }}></div>
          </div>
          <TableSkeleton rows={5} columns={8} />
        </div>
      </div>
    );
  }

  /* ------------------------------- ERROR ------------------------------- */
  if (error) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Finance Dashboard</h1>
          </div>
        </div>
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }

  /* ------------------------------- PAGE -------------------------------- */
  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Finance Dashboard</h1>
          <p className="page-subtitle">Overview of school finances, collections, and payment trends</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-outline-primary btn-sm">
            <i className="bi bi-download"></i>Export
          </button>
          <button className="btn btn-primary btn-sm">
            <i className="bi bi-printer"></i>Print
          </button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="stat-grid">
        {statCardConfig.map((cfg) => (
          <MetricCard
            key={cfg.key}
            icon={cfg.icon}
            variant={cfg.variant}
            label={cfg.label}
            value={cfg.format(statCards?.[cfg.key])}
          />
        ))}
      </div>

      {/* Multi-year Revenue Trend */}
      <div className="chart-card mb-3">
        <div className="chart-card__header">
          <div>
            <div className="chart-card__title">
              <i className="bi bi-graph-up-arrow me-2 text-brand"></i>
              Revenue by Month, Across Academic Years
            </div>
            <div className="chart-card__subtitle">Monthly collection trends compared across years</div>
          </div>
          {yearKeys.length > 0 && (
            <span className="badge badge-neutral">
              {yearKeys.length} year{yearKeys.length !== 1 ? "s" : ""} compared
            </span>
          )}
        </div>
        {revenueTrend.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-graph-up"></i>
            <h6>No revenue data</h6>
            <p className="text-muted-soft">No revenue data available for the selected years.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={revenueTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" vertical={false} />
              <XAxis
                dataKey="period"
                tick={AXIS_TICK}
                axisLine={{ stroke: "var(--border-color)" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)" }}
              />
              {yearKeys.map((year, idx) => (
                <Line
                  key={year}
                  type="monotone"
                  dataKey={year}
                  name={year}
                  stroke={PALETTE[idx % PALETTE.length]}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="row g-3 mb-3">
        {/* Payment Method Pie Chart */}
        <div className="col-12 col-lg-5">
          <div className="chart-card h-100">
            <div className="chart-card__header">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-pie-chart me-2 text-brand"></i>
                  Payment Methods
                </div>
                <div className="chart-card__subtitle">Current academic year</div>
              </div>
            </div>
            {paymentMethods.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-pie-chart"></i>
                <h6>No payment data</h6>
                <p className="text-muted-soft">No payments recorded for this academic year.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={paymentMethods}
                    dataKey="amount"
                    nameKey="method"
                    outerRadius={100}
                    innerRadius={55}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                    paddingAngle={2}
                  >
                    {paymentMethods.map((entry, idx) => (
                      <Cell key={entry.method} fill={PALETTE[idx % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Classroom Payment Bar Chart */}
        <div className="col-12 col-lg-7">
          <div className="chart-card h-100">
            <div className="chart-card__header">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-building me-2 text-brand"></i>
                  Fees Due vs Paid by Class
                </div>
                <div className="chart-card__subtitle">Current academic year</div>
              </div>
              {classroomPayments.length > 0 && (
                <span className="badge badge-neutral">{classroomPayments.length} classes</span>
              )}
            </div>
            {classroomPayments.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-bar-chart"></i>
                <h6>No class data</h6>
                <p className="text-muted-soft">No classroom fee data available for this academic year.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={classroomPayments}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" vertical={false} />
                  <XAxis
                    dataKey="classroom"
                    angle={-30}
                    textAnchor="end"
                    interval={0}
                    height={70}
                    tick={{ fontSize: 11, fill: "var(--ink-400)" }}
                    axisLine={{ stroke: "var(--border-color)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    tick={AXIS_TICK}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip formatter={(value) => currency(value)} contentStyle={TOOLTIP_STYLE} />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)" }}
                  />
                  <Bar dataKey="due" name="Due" fill={PALETTE[0]} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="paid" name="Paid" fill={PALETTE[1]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Latest Invoices Table */}
      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title">
            <i className="bi bi-receipt me-2 text-brand"></i>
            Latest Invoices
          </span>
          <span className="chart-card__subtitle">
            {latestInvoices.length} recent invoice{latestInvoices.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Admission No</th>
                <th>Student</th>
                <th>Classroom</th>
                <th>Term</th>
                <th className="text-end">Due</th>
                <th className="text-end">Paid</th>
                <th className="text-end">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {latestInvoices.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="table-empty-state">
                      <i className="bi bi-inbox"></i>
                      No invoices found
                    </div>
                  </td>
                </tr>
              )}
              {latestInvoices.map((inv) => {
                const badge = STATUS_BADGE[inv.status] || STATUS_BADGE.unpaid;
                return (
                  <tr key={inv.id}>
                    <td className="cell-mono text-brand fw-semibold">{inv.admission_no}</td>
                    <td>
                      <div className="table-avatar-cell">
                        <div className="avatar-sm">
                          {(inv.student_name || "")
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((n) => n[0])
                            .join("")}
                        </div>
                        <span className="cell-name">{inv.student_name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{inv.classroom}</span>
                    </td>
                    <td>{inv.term}</td>
                    <td className="cell-num">{currency(inv.due)}</td>
                    <td className="cell-num text-ok">{currency(inv.paid)}</td>
                    <td className="cell-num">
                      <span className={inv.balance > 0 ? "text-owe fw-semibold" : "cell-muted"}>
                        {currency(inv.balance)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${badge.className}`}>
                        <i className={`bi ${badge.icon} me-1`}></i>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}