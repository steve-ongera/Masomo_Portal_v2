import { useEffect, useState } from "react";
import { studentsApi, financeApi, performanceApi } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const PIE_COLORS = ["#1d4ed8", "#d97706", "#16a34a", "#7c3aed", "#dc2626"];

// "Term 1 - 2026" -> sortable number (20261). null if the label isn't in that shape.
const termOrder = (inv) => {
  const m = /Term\s+(\d+)\s*-\s*(\d{4})/i.exec(inv.term_label || "");
  return m ? Number(m[2]) * 10 + Number(m[1]) : null;
};

export default function StudentDashboard() {
  const { user } = useAuth();
  const [enrollment, setEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);

  const [netBalance, setNetBalance] = useState(0);
  const [feeLoading, setFeeLoading] = useState(true);

  const [performance, setPerformance] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(true);

  // Which academic year the "Performance Across the Academic Year" bar
  // chart is showing. Empty string = not yet chosen -> defer to whatever
  // the backend picks as default (the student's current academic year).
  const [trendYear, setTrendYear] = useState("");
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    // ---- current enrollment (class card) ----
    (async () => {
      setLoading(true);
      try {
        const { data } = await studentsApi.enrollments({ status: "ACTIVE" });
        const list = data.results ?? data;
        setEnrollment(list[0] || null);
      } catch (error) {
        console.error("Failed to load dashboard:", error);
      } finally {
        setLoading(false);
      }
    })();

    // ---- fee balance ----
    financeApi.invoices({ page_size: 200 })
      .then(({ data }) => {
        const list = data.results ?? data;
        // Use term_charge (amount_due - brought_forward), NOT raw
        // amount_due, when summing across invoices. Each invoice's
        // amount_due already folds in every prior term's unpaid balance
        // via brought_forward (see Invoice.brought_forward /
        // services.generate_invoice on the backend). Summing amount_due
        // directly re-adds the same arrears once per later invoice and
        // overstates the balance - term_charge is each invoice's OWN fee
        // for that term alone, so summing that avoids double-counting.
        const chronological = [...list].sort((a, b) => {
          const ka = termOrder(a);
          const kb = termOrder(b);
          if (ka !== null && kb !== null && ka !== kb) return ka - kb;
          return new Date(a.issued_at) - new Date(b.issued_at);
        });
        const opening = chronological.length ? Number(chronological[0].brought_forward) : 0;
        const termCharges = list.reduce((s, i) => s + Number(i.term_charge), 0);
        const totalPaid = list.reduce((s, i) => s + Number(i.amount_paid), 0);
        setNetBalance(opening + termCharges - totalPaid);
      })
      .catch((error) => console.error("Failed to load fee balance:", error))
      .finally(() => setFeeLoading(false));

    // ---- performance (current term, charts, subjects) ----
    // With no academic_year param the backend defaults to the student's
    // current academic year and current term. The .finally() guarantees the
    // loading skeletons stop even if the request fails.
    performanceApi.dashboard()
      .then(({ data }) => {
        setPerformance(data);
        // keep the year dropdown in sync with what the server picked
        if (data.selected_academic_year_id) {
          setTrendYear(String(data.selected_academic_year_id));
        }
      })
      .catch((error) => console.error("Failed to load performance:", error))
      .finally(() => setPerformanceLoading(false));
  }, []);

  const handleTrendYearChange = async (e) => {
    const yearId = e.target.value;
    setTrendYear(yearId);
    setTrendLoading(true);
    try {
      const { data } = await performanceApi.dashboard({ academic_year: yearId });
      setPerformance(data);
    } catch (error) {
      console.error("Failed to load performance for that year:", error);
    } finally {
      setTrendLoading(false);
    }
  };

  // Get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  const subjectsCount = performance?.subjects_summary?.length ?? null;

  return (
    <div>
      {/* Page Header with Welcome */}
      <div className="page-header">
        <div>
          <h1 className="page-title mb-0">
            {getGreeting()}, {user?.first_name || "Student"}!
          </h1>
          <p className="page-subtitle mb-0">
            Welcome to your student dashboard
          </p>
        </div>
        <div className="chart-card__subtitle mb-0">
          <i className="bi bi-calendar3 me-1"></i>
          {new Date().toLocaleDateString("en-KE", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="stat-grid">
        <div className="dm-card dm-card--primary">
          <div className="dm-card__top">
            <span className="dm-card__label">Current Class</span>
            <span className="dm-card__icon">
              <i className="bi bi-door-open"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: "80px", height: "24px" }}></div>
            ) : (
              enrollment?.classroom_label || "-"
            )}
          </div>
        </div>

        <div className="dm-card dm-card--primary">
          <div className="dm-card__top">
            <span className="dm-card__label">Current Term</span>
            <span className="dm-card__icon">
              <i className="bi bi-calendar-week"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {performanceLoading ? (
              <div className="skeleton skeleton-text" style={{ width: "70px", height: "24px" }}></div>
            ) : (
              performance?.current_term || "-"
            )}
          </div>
        </div>

        <div className="dm-card dm-card--warning">
          <div className="dm-card__top">
            <span className="dm-card__label">Subjects Registered</span>
            <span className="dm-card__icon">
              <i className="bi bi-journal-bookmark"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {performanceLoading ? (
              <div className="skeleton skeleton-text" style={{ width: "40px", height: "24px" }}></div>
            ) : (
              subjectsCount ?? "-"
            )}
          </div>
        </div>

        <div className={`dm-card ${netBalance > 0 ? "dm-card--danger" : "dm-card--success"}`}>
          <div className="dm-card__top">
            <span className="dm-card__label">
              {netBalance > 0 ? "Fee Balance Owed" : netBalance < 0 ? "Fee Credit" : "Fee Balance"}
            </span>
            <span className="dm-card__icon">
              <i className="bi bi-cash-coin"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {feeLoading ? (
              <div className="skeleton skeleton-text" style={{ width: "90px", height: "24px" }}></div>
            ) : (
              `KES ${Math.abs(netBalance).toLocaleString()}`
            )}
          </div>
        </div>
      </div>

      {/* Performance Overview */}
      <div className="mb-3 mt-4">
        <span className="chart-card__title mb-0">
          
          Performance Overview
        </span>
      </div>

      <div className="row g-3">
        {/* Line chart: performance within the current term */}
        <div className="col-12 col-lg-6">
          <div className="chart-card">
            <div className="chart-card__header">
              <div className="chart-card__title">
                <i className="bi bi-graph-up me-2 text-brand"></i>
                Performance This Term{performance?.current_term ? ` — ${performance.current_term}` : ""}
              </div>
            </div>
            <div>
              {performanceLoading ? (
                <div className="skeleton skeleton-text" style={{ width: "100%", height: "220px" }}></div>
              ) : performance?.term_trend?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={performance.term_trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="exam" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Line type="monotone" dataKey="average" stroke="#1d4ed8" strokeWidth={2} name="Average %" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-soft mb-0">No exam results recorded yet for this term.</p>
              )}
            </div>
          </div>
        </div>

        {/* Bar chart: performance across Term 1, 2, 3 of a chosen academic year */}
        <div className="col-12 col-lg-6">
          <div className="chart-card">
            <div className="chart-card__header">
              <div className="chart-card__title">
                <i className="bi bi-bar-chart-line me-2 text-gold"></i>
                Performance Across the Academic Year
              </div>
              {performance?.available_academic_years?.length > 0 && (
                <select
                  className="form-select form-select-sm w-auto"
                  value={trendYear}
                  onChange={handleTrendYearChange}
                  disabled={trendLoading}
                >
                  {performance.available_academic_years.map((ay) => (
                    <option key={ay.id} value={ay.id}>
                      {ay.year}{ay.is_current ? " (Current)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              {performanceLoading || trendLoading ? (
                <div className="skeleton skeleton-text" style={{ width: "100%", height: "220px" }}></div>
              ) : performance?.academic_year_trend?.some((t) => t.average !== null) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={performance.academic_year_trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="term" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(v) => (v === null ? "No data" : `${v}%`)} />
                    <Bar dataKey="average" fill="#d97706" name="Average %" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-soft mb-0">
                  No term averages recorded yet for {performance?.selected_academic_year || "this academic year"}.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Pie chart: best performing subjects this term */}
        <div className="col-12 col-lg-6">
          <div className="chart-card">
            <div className="chart-card__header">
              <div className="chart-card__title">
                <i className="bi bi-pie-chart me-2 text-ok"></i>
                Best Performing Subjects This Term
              </div>
            </div>
            <div>
              {performanceLoading ? (
                <div className="skeleton skeleton-text" style={{ width: "100%", height: "220px" }}></div>
              ) : performance?.subject_performance?.length ? (
                <ResponsiveContainer width="100%" height={290}>
                  <PieChart>
                    <Pie
                      data={performance.subject_performance}
                      dataKey="average"
                      nameKey="subject"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ subject, average }) => `${subject}: ${average}%`}
                    >
                      {performance.subject_performance.map((_, index) => (
                        <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-soft mb-0">No subject results recorded yet for this term.</p>
              )}
            </div>
          </div>
        </div>

        {/* Subjects summary table */}
        <div className="col-12 col-lg-6">
          <div className="chart-card p-0">
            <div className="chart-card__header" style={{ padding: "1.1rem 1.2rem" }}>
              <div className="chart-card__title">
                <i className="bi bi-journal-bookmark me-2 text-brand"></i>
                My Subjects{performance?.current_class ? ` — ${performance.current_class}` : ""}
              </div>
            </div>
            {performanceLoading ? (
              <div className="p-3">
                <div className="skeleton skeleton-text" style={{ width: "100%", height: "180px" }}></div>
              </div>
            ) : performance?.subjects_summary?.length ? (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th className="text-end">Latest Mark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.subjects_summary.map((s) => (
                      <tr key={s.subject}>
                        <td>{s.subject}</td>
                        <td className="text-end">
                          {s.marks !== null ? (
                            <span className="badge badge-blue">{s.marks}%</span>
                          ) : (
                            <span className="text-muted-soft">Not yet examined</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-soft mb-0 p-3">No subjects registered for this class yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Empty State for No Data */}
      {!loading && !enrollment && (
        <div className="table-wrap mt-3">
          <div className="empty-state">
            <i className="bi bi-person-x"></i>
            <h6>No Enrollment Found</h6>
            <p className="text-muted-soft">
              You are not currently enrolled in any active class.
              Please contact the school administration for assistance.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}