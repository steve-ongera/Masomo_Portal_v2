// src/pages/examofficer/Dashboard.jsx
import { useEffect, useState } from "react";
import { dashboardApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";

const BLUE = "#0d6efd";
const GREEN = "#198754";
const AMBER = "#f59f00";
const RED = "#dc3545";
const BAND_COLORS = [RED, AMBER, "#4dabf7", BLUE, GREEN];

const trunc = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

// ---- Graph 1: vertical bars -------------------------------------------------
function VBarChart({ data, xKey, yKey, color = BLUE }) {
  if (!data?.length) return <p className="form-text-hint mb-0">No marks recorded yet.</p>;
  const W = Math.max(320, data.length * 52);
  const H = 220;
  const pad = { t: 22, b: 40, l: 8, r: 8 };
  const bw = (W - pad.l - pad.r) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {[0, 25, 50, 75, 100].map((g) => {
        const y = pad.t + (H - pad.t - pad.b) * (1 - g / 100);
        return <line key={g} x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#eceff2" />;
      })}
      {data.map((d, i) => {
        const h = (H - pad.t - pad.b) * (Math.min(d[yKey], 100) / 100);
        const x = pad.l + i * bw + bw * 0.18;
        const y = H - pad.b - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw * 0.64} height={h} rx="3" fill={color} />
            <text x={x + bw * 0.32} y={y - 5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">
              {d[yKey]}
            </text>
            <text x={x + bw * 0.32} y={H - pad.b + 14} textAnchor="middle" fontSize="9" fill="#64748b">
              {trunc(d[xKey], 9)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---- Graphs 2 & 3: horizontal bars ------------------------------------------
function HBarChart({ data, labelKey, valueKey, max, colors, suffix = "" }) {
  if (!data?.length) return <p className="form-text-hint mb-0">No marks recorded yet.</p>;
  const top = max ?? Math.max(...data.map((d) => d[valueKey]), 1);
  return (
    <div className="d-flex flex-column gap-2">
      {data.map((d, i) => (
        <div key={i} className="d-flex align-items-center gap-2 small">
          <div className="cell-muted" style={{ width: 110, flexShrink: 0 }} title={d[labelKey]}>
            {trunc(d[labelKey], 16)}
          </div>
          <div
            style={{
              flex: 1,
              background: "var(--ink-100)",
              borderRadius: "var(--radius-sm)",
              height: 14,
            }}
          >
            <div
              style={{
                width: `${Math.min((d[valueKey] / top) * 100, 100)}%`,
                height: "100%",
                borderRadius: "var(--radius-sm)",
                background: colors ? colors[i % colors.length] : BLUE,
              }}
            />
          </div>
          <div className="cell-mono fw-semibold" style={{ width: 52, textAlign: "right" }}>
            {d[valueKey]}
            {suffix}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Graph 4: line chart ------------------------------------------------------
function LineChart({ data, xKey, yKey }) {
  const pts = (data || []).filter((d) => d[yKey] !== null && d[yKey] !== undefined);
  if (!pts.length) return <p className="form-text-hint mb-0">No marks recorded yet.</p>;
  const W = 360, H = 220, pad = { t: 24, b: 34, l: 30, r: 20 };
  const step = pts.length > 1 ? (W - pad.l - pad.r) / (pts.length - 1) : 0;
  const xy = pts.map((d, i) => [
    pad.l + (pts.length > 1 ? i * step : (W - pad.l - pad.r) / 2),
    pad.t + (H - pad.t - pad.b) * (1 - Math.min(d[yKey], 100) / 100),
  ]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {[0, 25, 50, 75, 100].map((g) => {
        const y = pad.t + (H - pad.t - pad.b) * (1 - g / 100);
        return (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="#eceff2" />
            <text x={pad.l - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{g}</text>
          </g>
        );
      })}
      <polyline fill="none" stroke={BLUE} strokeWidth="2.5" points={xy.map((p) => p.join(",")).join(" ")} />
      {xy.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="4" fill="#fff" stroke={BLUE} strokeWidth="2" />
          <text x={x} y={y - 9} textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">{pts[i][yKey]}</text>
          <text x={x} y={H - pad.b + 16} textAnchor="middle" fontSize="10" fill="#64748b">{pts[i][xKey]}</text>
        </g>
      ))}
    </svg>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div className="dm-card">
      <div className="dm-card__top">
        <span className="dm-card__label">{label}</span>
        <span
          className="dm-card__icon"
          style={{ background: `${color}1a`, color }}
        >
          <i className={`bi ${icon}`}></i>
        </span>
      </div>
      <div className="dm-card__num">{value}</div>
      {sub && <div className="dm-card__sub">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="col-12 col-lg-6">
      <div className="chart-card h-100">
        <div className="chart-card__header">
          <div className="chart-card__title">{title}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ExamOfficerDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    dashboardApi
      .examOfficerStats()
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.data?.detail || "Could not load the dashboard."))
      .finally(() => setLoading(false));
  }, []);

  const s = data?.stat_cards;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Examination Dashboard</h1>
          <p className="page-subtitle">
            {data?.current_term
              ? `${data.current_term} · performance, grading and promotion overview`
              : "Performance, grading and promotion overview"}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-warning">{error}</div>}

      {loading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : data ? (
        <>
          {/* Key metrics */}
          <div className="stat-grid">
            <StatCard icon="bi-people" label="Active Students" value={s.total_students} color={BLUE} />
            <StatCard icon="bi-door-open" label="Classes" value={s.total_classes} color="#6f42c1" />
            <StatCard
              icon="bi-pencil-square" label="Exams This Term" value={s.exams_this_term}
              sub={`${s.exams_published} published`} color={AMBER}
            />
            <StatCard icon="bi-bar-chart-line" label="Term Average" value={`${s.overall_average}%`} color={GREEN} />
            <StatCard icon="bi-patch-check" label="Pass Rate" value={`${s.overall_pass_rate}%`} color="#0aa2c0" />
          </div>

          {/* 4 charts */}
          <div className="row g-3 mb-3">
            <ChartCard title="Average Performance by Grade (%)">
              <VBarChart data={data.grade_performance} xKey="grade" yKey="average" />
            </ChartCard>
            <ChartCard title="Results by Score Band">
              <HBarChart data={data.score_bands} labelKey="band" valueKey="count" colors={BAND_COLORS} />
            </ChartCard>
            <ChartCard title="Subject Performance (average %)">
              <HBarChart data={data.subject_performance} labelKey="subject" valueKey="average" max={100} suffix="%" />
            </ChartCard>
            <ChartCard title="Term-by-Term Average (%)">
              <LineChart data={data.term_trend} xKey="term" yKey="average" />
            </ChartCard>
          </div>

          {/* Grade summary */}
          <div className="table-wrap">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-table me-2 text-brand"></i>
                Grade Summary &amp; Promotion Progress
              </span>
            </div>
            <div className="table-responsive">
              <table className="table table-bordered align-middle mb-0">
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th className="text-center">Classes</th>
                    <th className="text-center">Students</th>
                    <th className="text-center">Average</th>
                    <th className="text-center">Pass Rate</th>
                    <th className="text-center">Promotion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summary_table.length === 0 && (
                    <tr>
                      <td colSpan={6} className="cell-muted text-center">
                        No classes set up for this academic year.
                      </td>
                    </tr>
                  )}
                  {data.summary_table.map((r) => {
                    const done = r.classrooms > 0 && r.promoted_classrooms === r.classrooms;
                    return (
                      <tr key={r.grade}>
                        <td className="cell-name">{r.grade}</td>
                        <td className="cell-mono text-center">{r.classrooms}</td>
                        <td className="cell-mono text-center">{r.students}</td>
                        <td className="cell-mono text-center">
                          {r.average !== null ? `${r.average}%` : "—"}
                        </td>
                        <td className="cell-mono text-center">
                          {r.pass_rate !== null ? `${r.pass_rate}%` : "—"}
                        </td>
                        <td className="text-center">
                          <span className={`badge ${done ? "badge-success" : r.promoted_classrooms ? "badge-blue" : "badge-neutral"}`}>
                            {r.promoted_classrooms}/{r.classrooms} promoted
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}