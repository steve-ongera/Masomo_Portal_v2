// src/pages/admin/Dashboard.jsx
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, Area, AreaChart, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { dashboardApi } from "../../services/api";
import { MetricCard } from "../../components/MetricCard";

const KES = (n) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n || 0);

const GENDER_COLORS = ["#3b82f6", "#ec4899"];

// Shared chart styling so every chart matches the rest of the portal
const TOOLTIP_STYLE = {
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-color)",
  boxShadow: "var(--shadow-sm)",
  fontSize: 12,
};
const AXIS_TICK = { fontSize: 12, fill: "var(--ink-400)" };

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await dashboardApi.stats();
        if (alive) setData(res.data);
      } catch (err) {
        if (alive) setError(err.response?.data?.detail || "Failed to load dashboard.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Dashboard</h1>
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

        <div className="row g-3">
          <div className="col-12 col-lg-8">
            <div className="chart-card h-100">
              <div className="skeleton" style={{ width: 200, height: 18, marginBottom: 16 }}></div>
              <div className="skeleton" style={{ width: "100%", height: 250 }}></div>
            </div>
          </div>
          <div className="col-12 col-lg-4">
            <div className="chart-card h-100">
              <div className="skeleton" style={{ width: 150, height: 18, marginBottom: 16 }}></div>
              <div className="skeleton" style={{ width: "100%", height: 250 }}></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
        </div>
      </div>
      <div className="alert alert-danger">{error}</div>
    </div>
  );

  if (!data) return null;

  const { stat_cards, revenue_trend, class_population, gender_population, admission_trend, recent_students } = data;

  const genderData = [
    { name: "Boys", value: gender_population.male },
    { name: "Girls", value: gender_population.female },
  ];
  const genderTotal = genderData.reduce((s, g) => s + g.value, 0);

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Welcome back! Here's an overview of your school</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-outline-primary btn-sm">
            <i className="bi bi-download"></i>Export Report
          </button>
          <button className="btn btn-primary btn-sm">
            <i className="bi bi-refresh"></i>Refresh
          </button>
        </div>
      </div>

      {/* Key metrics */}
      <div className="stat-grid">
        <MetricCard icon="bi-people" variant="primary" label="Total Students" value={stat_cards.total_students} />
        <MetricCard icon="bi-door-open" variant="warning" label="Active Classes" value={stat_cards.total_classes} />
        <MetricCard icon="bi-person-badge" variant="success" label="Teachers" value={stat_cards.total_teachers} />
        <MetricCard icon="bi-cash-coin" variant="success" label="Revenue (This Year)" value={KES(stat_cards.revenue_this_year)} />
        <MetricCard icon="bi-exclamation-circle" variant="danger" label="Outstanding Fees" value={KES(stat_cards.outstanding_balance)} />
      </div>

      <div className="row g-3">
        {/* Revenue Trend — with fading area shadow under the line */}
        <div className="col-12 col-lg-8">
          <div className="chart-card h-100">
            <div className="chart-card__header">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-graph-up-arrow me-2 text-brand"></i>
                  Fee Revenue — Last 12 Months
                </div>
                <div className="chart-card__subtitle">Monthly fee collection trend</div>
              </div>
              <span className="badge badge-blue">
                <i className="bi bi-arrow-up me-1"></i>
                +{((stat_cards.revenue_this_year / 12) / 1000).toFixed(0)}k avg
              </span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={revenue_trend}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--blue-700)" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="var(--blue-700)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" />
                <XAxis dataKey="label" tick={AXIS_TICK} />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={AXIS_TICK} />
                <Tooltip formatter={(v) => KES(v)} contentStyle={TOOLTIP_STYLE} />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--blue-700)"
                  strokeWidth={2.5}
                  fill="url(#revenueGradient)"
                  dot={{ fill: "var(--blue-700)", r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gender Population */}
        <div className="col-12 col-lg-4">
          <div className="chart-card h-100">
            <div className="chart-card__header">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-gender-ambiguous me-2 text-brand"></i>
                  Boys vs Girls
                </div>
                <div className="chart-card__subtitle">Total: {genderTotal} students</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={genderData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {genderData.map((_, i) => <Cell key={i} fill={GENDER_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(v) => `${v} students`} contentStyle={TOOLTIP_STYLE} />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Class Population */}
        <div className="col-12 col-lg-6">
          <div className="chart-card h-100">
            <div className="chart-card__header">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-building me-2 text-brand"></i>
                  Students per Class
                </div>
                <div className="chart-card__subtitle">Current year distribution</div>
              </div>
              <span className="badge badge-neutral">{class_population.length} classes</span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={class_population} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" />
                <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} />
                <YAxis
                  type="category"
                  dataKey="classroom"
                  width={110}
                  tick={{ fontSize: 12, fill: "var(--ink-600)" }}
                />
                <Tooltip formatter={(v) => `${v} students`} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="var(--success-600)" radius={[0, 3, 3, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Admission Trend */}
        <div className="col-12 col-lg-6">
          <div className="chart-card h-100">
            <div className="chart-card__header">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-person-plus me-2 text-brand"></i>
                  Admissions Trend
                </div>
                <div className="chart-card__subtitle">Last 5 years</div>
              </div>
              <span className="badge badge-gold">
                <i className="bi bi-arrow-up me-1"></i>
                +{admission_trend.length > 1 ? Math.round((admission_trend[admission_trend.length - 1]?.count - admission_trend[0]?.count) / admission_trend[0]?.count * 100) : 0}%
              </span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={admission_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ink-100)" />
                <XAxis dataKey="year" tick={AXIS_TICK} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} />
                <Tooltip formatter={(v) => `${v} students`} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="var(--gold-500)" radius={[3, 3, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Students Table */}
      <div className="table-wrap mt-3">
        <div className="table-wrap__header">
          <span className="chart-card__title">
            <i className="bi bi-clock-history me-2 text-brand"></i>
            Recently Admitted Students
          </span>
          <span className="chart-card__subtitle">
            {recent_students.length} recent admission{recent_students.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Admission No</th>
                <th>Name</th>
                <th>Gender</th>
                <th>Class</th>
                <th>Status</th>
                <th>Date Admitted</th>
              </tr>
            </thead>
            <tbody>
              {recent_students.map((s) => (
                <tr key={s.id}>
                  <td className="cell-mono text-brand fw-semibold">{s.admission_no}</td>
                  <td>
                    <div className="table-avatar-cell">
                      <div className="avatar-sm">
                        {s.name?.split(' ').map(n => n[0]).join('') || 'S'}
                      </div>
                      <span className="cell-name">{s.name}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${s.gender === "M" ? "badge-blue" : "badge-gold"}`}>
                      {s.gender === "M" ? "Male" : "Female"}
                    </span>
                  </td>
                  <td>
                    <span className="badge badge-neutral">{s.classroom || "-"}</span>
                  </td>
                  <td>
                    <span className={`badge ${s.status === "ACTIVE" ? "badge-success" : "badge-danger"}`}>
                      <span className={`status-dot ${s.status === "ACTIVE" ? "status-dot--online" : "status-dot--offline"}`}></span>
                      {s.status || "Active"}
                    </span>
                  </td>
                  <td className="text-body-secondary">{s.date_admitted}</td>
                </tr>
              ))}
              {recent_students.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="table-empty-state">
                      <i className="bi bi-inbox"></i>
                      No students admitted recently
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}