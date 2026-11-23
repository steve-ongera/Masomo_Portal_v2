import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  studentsApi, financeApi, performanceApi, profileApi,
  notificationApi, examsApi, calendarApi,
} from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ---- EDIT these to match your student routes ---------------------------
const ROUTES = {
  timetable: "/student/timetable",
  results: "/student/results",
  fees: "/student/fees",
  notifications: "/student/notifications",
  profile: "/student/profile",
  calendar: "/student/timetable",
};

const PIE_COLORS = ["#1d4ed8", "#d97706", "#16a34a", "#7c3aed", "#dc2626"];

// "Term 1 - 2026" -> sortable number (20261). null if the label isn't in that shape.
const termOrder = (inv) => {
  const m = /Term\s+(\d+)\s*-\s*(\d{4})/i.exec(inv.term_label || "");
  return m ? Number(m[2]) * 10 + Number(m[1]) : null;
};

const asList = (res) => res?.data?.results ?? res?.data ?? [];
const fmtKES = (n) => `KES ${Math.abs(Number(n) || 0).toLocaleString()}`;

const timeAgo = (iso) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins > 1 ? "s" : ""} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
};

const ACTIVITY_ICON = {
  payment: { icon: "bi-check-lg", tone: "ok" },
  ACADEMIC: { icon: "bi-file-earmark-text", tone: "brand" },
  FEE_REMINDER: { icon: "bi-cash-coin", tone: "gold" },
  EVENT: { icon: "bi-calendar-event", tone: "purple" },
  CLOSING: { icon: "bi-calendar-x", tone: "purple" },
  GENERAL: { icon: "bi-bell", tone: "brand" },
};

function CapIllustration() {
  return (
    <svg className="sd-banner__art" viewBox="0 0 220 140" aria-hidden="true">
      <ellipse cx="110" cy="124" rx="80" ry="8" fill="currentColor" opacity=".12" />
      <rect x="52" y="86" width="116" height="24" rx="5" fill="currentColor" opacity=".35" />
      <rect x="58" y="80" width="116" height="22" rx="5" fill="currentColor" opacity=".55" />
      <path d="M62 52v26c0 10 22 18 48 18s48-8 48-18V52z" fill="currentColor" opacity=".9" />
      <path d="M110 18 24 50l86 30 86-30z" fill="currentColor" />
      <path d="M110 18 24 50l86 30z" fill="#fff" opacity=".12" />
      <line x1="184" y1="50" x2="184" y2="88" stroke="var(--sd-gold)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="184" cy="92" r="6" fill="var(--sd-gold)" />
    </svg>
  );
}

function StatCard({ tone, icon, label, onClick, extraClass = "", children }) {
  return (
    <div
      className={`sd-stat ${extraClass}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick?.()}
    >
      <span className={`sd-stat__icon sd-tone-${tone}`}><i className={`bi ${icon}`} /></span>
      <div className="sd-stat__body">
        <div className="sd-stat__top">
          <span className="sd-stat__label">{label}</span>
          <i className="bi bi-chevron-right sd-stat__chev" />
        </div>
        {children}
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [enrollment, setEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [netBalance, setNetBalance] = useState(0);
  const [feeLoading, setFeeLoading] = useState(true);
  const [payments, setPayments] = useState([]);

  const [notices, setNotices] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const [performance, setPerformance] = useState(null);
  const [performanceLoading, setPerformanceLoading] = useState(true);

  const [trendYear, setTrendYear] = useState("");
  const [trendLoading, setTrendLoading] = useState(false);
  const [tab, setTab] = useState("term"); // "term" | "year"

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    // ---- current enrollment ----
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

    // ---- profile ----
    profileApi.me()
      .then(({ data }) => setProfile(data))
      .catch((e) => console.error("Failed to load profile:", e))
      .finally(() => setProfileLoading(false));

    // ---- fee balance (+ payments for the activity feed) ----
    financeApi.invoices({ page_size: 200 })
      .then(({ data }) => {
        const list = data.results ?? data;
        // term_charge (NOT amount_due) so brought-forward arrears aren't double counted.
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
        setPayments(list.flatMap((i) => i.payments || []));
      })
      .catch((error) => console.error("Failed to load fee balance:", error))
      .finally(() => setFeeLoading(false));

    // ---- notifications ----
    notificationApi.list({ page_size: 10 })
      .then((res) => setNotices(asList(res)))
      .catch((e) => console.error("Failed to load notifications:", e))
      .finally(() => setActivityLoading(false));

    // ---- performance ----
    performanceApi.dashboard()
      .then(({ data }) => {
        setPerformance(data);
        if (data.selected_academic_year_id) setTrendYear(String(data.selected_academic_year_id));
      })
      .catch((error) => console.error("Failed to load performance:", error))
      .finally(() => setPerformanceLoading(false));
  }, []);

  // ---- upcoming events: exams for this grade + current term closing date ----
  useEffect(() => {
    if (loading) return;
    (async () => {
      setEventsLoading(true);
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const toDate = (d) => new Date(`${d}T00:00:00`);
        const items = [];

        if (enrollment?.grade_level_id) {
          const res = await examsApi.exams({ grade_level: enrollment.grade_level_id, page_size: 50 });
          asList(res)
            .filter((e) => toDate(e.end_date) >= today)
            .forEach((e) =>
              items.push({
                key: `exam-${e.id}`,
                date: toDate(e.start_date) < today ? today : toDate(e.start_date),
                title: e.name,
                sub: e.term_label || e.exam_type_name,
              })
            );
        }

        const termRes = await calendarApi.terms({ is_current: true });
        const term = asList(termRes)[0];
        if (term && toDate(term.end_date) >= today) {
          items.push({
            key: `term-${term.id}`, date: toDate(term.end_date),
            title: "Term Closing Day", sub: "School calendar",
          });
        }

        items.sort((a, b) => a.date - b.date);
        setEvents(items.slice(0, 3));
      } catch (e) {
        console.error("Failed to load events:", e);
      } finally {
        setEventsLoading(false);
      }
    })();
  }, [loading, enrollment]);

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

  const subjectsCount = performance?.subjects_summary?.length ?? null;

  const termStats = useMemo(() => {
    const t = performance?.term_trend || [];
    if (!t.length) return { avg: null, delta: null };
    const avg = Math.round((t.reduce((s, x) => s + x.average, 0) / t.length) * 10) / 10;
    const delta = t.length > 1
      ? Math.round((t[t.length - 1].average - t[t.length - 2].average) * 10) / 10
      : null;
    return { avg, delta };
  }, [performance]);

  const activities = useMemo(() => {
    const fromPayments = payments.map((p) => ({
      key: `pay-${p.id}`, at: p.paid_at, type: "payment",
      title: "Fee Payment Successful",
      sub: `${fmtKES(p.amount)} paid on ${new Date(p.paid_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}`,
    }));
    const fromNotices = notices.map((n) => ({
      key: `note-${n.id}`, at: n.created_at, type: n.category || "GENERAL",
      title: n.subject,
      sub: (n.body || "").slice(0, 70) + ((n.body || "").length > 70 ? "…" : ""),
    }));
    return [...fromPayments, ...fromNotices]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 4);
  }, [payments, notices]);

  const unread = notices.filter((n) => !n.is_read).length;
  const firstName = user?.first_name || profile?.first_name || "Student";
  const lastName = user?.last_name || profile?.last_name || "";
  const fullName = `${firstName} ${lastName}`.trim();
  const initials = `${firstName[0] || "S"}${lastName[0] || ""}`.toUpperCase();

  const quickLinks = [
    { label: "View Timetable", icon: "bi-calendar3", tone: "purple", to: ROUTES.timetable },
    { label: "Check Results", icon: "bi-file-earmark-text-fill", tone: "ok", to: ROUTES.results },
    { label: "Pay Fees", icon: "bi-credit-card-fill", tone: "gold", to: ROUTES.fees },
    { label: "Notifications", icon: "bi-bell-fill", tone: "brand", to: ROUTES.notifications },
  ];

  const feeTone = netBalance > 0 ? "danger" : "ok";
  const feePill = netBalance > 0 ? "Payment Due" : netBalance < 0 ? "In Credit" : "Up to Date";

  return (
    <div className="sd">
      {/* ===== Welcome banner ===== */}
      <section className="sd-banner">
        <div className="sd-banner__text">
          <h1 className="sd-banner__title">
            <span className="sd-banner__hello">Welcome Back,</span>{" "}
            <span className="sd-banner__name">
              
              <span className="sd-only-mobile">{firstName}</span>
            </span>
          </h1>
          <p className="sd-banner__sub sd-only-desktop">
            Here&apos;s what&apos;s happening with your academic journey.
          </p>
          <p className="sd-banner__sub sd-only-mobile">
            {loading ? "\u00A0" : enrollment?.classroom_label || "Student"}
          </p>
          <div className="sd-banner__chips">
            <span className="sd-chip">
              <i className="bi bi-calendar-week" />
              {performanceLoading ? "…" : performance?.current_term || "No active term"}
            </span>
            <span className="sd-chip sd-only-desktop">
              <i className="bi bi-calendar3" />
              {new Date().toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>
        </div>
        <CapIllustration />
      </section>

      {/* ===== Stat cards ===== */}
      <div className="sd-stats">
        <StatCard tone="purple" icon="bi-mortarboard-fill" label="Term Average" onClick={() => navigate(ROUTES.results)}>
          <div className="sd-stat__num">
            {performanceLoading ? (
              <div className="skeleton skeleton-text" style={{ width: 80, height: 26 }} />
            ) : termStats.avg !== null ? (
              <>{termStats.avg}<small> / 100</small></>
            ) : "-"}
          </div>
          {!performanceLoading && termStats.delta !== null && (
            <span className={`sd-pill ${termStats.delta >= 0 ? "sd-pill--ok" : "sd-pill--danger"}`}>
              <i className={`bi ${termStats.delta >= 0 ? "bi-arrow-up" : "bi-arrow-down"}`} />
              {termStats.delta >= 0 ? "+" : ""}{termStats.delta}
            </span>
          )}
        </StatCard>

        <StatCard tone="ok" icon="bi-door-open-fill" label="Current Class" onClick={() => navigate(ROUTES.timetable)}>
          <div className="sd-stat__num sd-stat__num--sm">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: 90, height: 22 }} />
            ) : enrollment?.classroom_label || "-"}
          </div>
          <span className="sd-stat__hint">{enrollment?.grade_level_name || "\u00A0"}</span>
        </StatCard>

        <StatCard tone="brand" icon="bi-journal-bookmark-fill" label="Active Courses" onClick={() => navigate(ROUTES.results)}>
          <div className="sd-stat__num">
            {performanceLoading ? (
              <div className="skeleton skeleton-text" style={{ width: 40, height: 26 }} />
            ) : subjectsCount ?? "-"}
          </div>
          <span className="sd-stat__hint">Subjects this term</span>
        </StatCard>

        <StatCard
          tone={feeTone} icon="bi-wallet2" extraClass={`sd-stat--${feeTone}`}
          label={netBalance > 0 ? "Fee Balance Owed" : netBalance < 0 ? "Fee Credit" : "Fee Balance"}
          onClick={() => navigate(ROUTES.fees)}
        >
          <div className="sd-stat__num">
            {feeLoading ? (
              <div className="skeleton skeleton-text" style={{ width: 100, height: 26 }} />
            ) : fmtKES(netBalance)}
          </div>
          {!feeLoading && (
            <span className={`sd-pill sd-pill--${feeTone}`}>
              <i className={`bi ${netBalance > 0 ? "bi-exclamation-circle" : "bi-check2"}`} /> {feePill}
            </span>
          )}
        </StatCard>
      </div>

      {/* ===== Main grid ===== */}
      <div className="sd-grid">
        {/* ---------- LEFT ---------- */}
        <div className="sd-col">
          {/* Academic performance */}
          <section className="sd-card sd-o-perf">
            <header className="sd-card__head">
              <h2 className="sd-card__title">
                <i className="bi bi-bar-chart-fill sd-text-brand" /> Academic Performance
              </h2>
              <button className="sd-link" onClick={() => navigate(ROUTES.results)}>
                View Details <i className="bi bi-arrow-right" />
              </button>
            </header>

            <div className="sd-card__actions">
              <div className="sd-tabs" role="tablist">
                <button className={tab === "term" ? "is-active" : ""} onClick={() => setTab("term")}>This Term</button>
                <button className={tab === "year" ? "is-active" : ""} onClick={() => setTab("year")}>Academic Year</button>
              </div>
              {tab === "year" && performance?.available_academic_years?.length > 0 && (
                <select
                  className="form-select form-select-sm w-auto"
                  value={trendYear}
                  onChange={handleTrendYearChange}
                  disabled={trendLoading}
                >
                  {performance.available_academic_years.map((ay) => (
                    <option key={ay.id} value={ay.id}>{ay.year}{ay.is_current ? " (Current)" : ""}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="sd-chart">
              {tab === "term" ? (
                performanceLoading ? (
                  <div className="skeleton skeleton-text" style={{ width: "100%", height: 260 }} />
                ) : performance?.term_trend?.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={performance.term_trend} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="sdArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1d4ed8" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(100,116,139,.25)" />
                      <XAxis dataKey="exam" tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} />
                      <Tooltip formatter={(v) => `${v}%`} />
                      <Area type="monotone" dataKey="average" name="Your Average %" stroke="#1d4ed8"
                        strokeWidth={2.5} fill="url(#sdArea)"
                        dot={{ r: 4, fill: "#1d4ed8", strokeWidth: 0 }} activeDot={{ r: 6 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="sd-empty">No exam results recorded yet for this term.</p>
                )
              ) : performanceLoading || trendLoading ? (
                <div className="skeleton skeleton-text" style={{ width: "100%", height: 260 }} />
              ) : performance?.academic_year_trend?.some((t) => t.average !== null) ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={performance.academic_year_trend} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(100,116,139,.25)" />
                    <XAxis dataKey="term" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} />
                    <Tooltip formatter={(v) => (v === null ? "No data" : `${v}%`)} />
                    <Bar dataKey="average" name="Average %" fill="#d97706" radius={[8, 8, 0, 0]} maxBarSize={64} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="sd-empty">
                  No term averages recorded yet for {performance?.selected_academic_year || "this academic year"}.
                </p>
              )}
            </div>
          </section>

          {/* Best subjects + My subjects */}
          <div className="sd-duo">
            <section className="sd-card sd-o-best">
              <header className="sd-card__head">
                <h2 className="sd-card__title">
                  <i className="bi bi-pie-chart-fill sd-text-ok" /> Best Performing Subjects
                </h2>
              </header>
              {performanceLoading ? (
                <div className="skeleton skeleton-text" style={{ width: "100%", height: 240 }} />
              ) : performance?.subject_performance?.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={performance.subject_performance} dataKey="average" nameKey="subject"
                      cx="50%" cy="46%" innerRadius={52} outerRadius={84} paddingAngle={3}>
                      {performance.subject_performance.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Legend iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="sd-empty">No subject results recorded yet for this term.</p>
              )}
            </section>

            <section className="sd-card sd-card--flush sd-o-subjects">
              <header className="sd-card__head sd-card__head--pad">
                <h2 className="sd-card__title">
                  <i className="bi bi-journal-bookmark-fill sd-text-gold" /> My Subjects
                  {performance?.current_class ? <small> — {performance.current_class}</small> : null}
                </h2>
              </header>
              {performanceLoading ? (
                <div className="p-3"><div className="skeleton skeleton-text" style={{ width: "100%", height: 200 }} /></div>
              ) : performance?.subjects_summary?.length ? (
                <div className="table-responsive sd-table-scroll">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr><th>Subject</th><th className="text-end">Latest Mark</th></tr>
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
                <p className="sd-empty">No subjects registered for this class yet.</p>
              )}
            </section>
          </div>

          {/* Recent activities */}
          <section className="sd-card sd-o-activity">
            <header className="sd-card__head">
              <h2 className="sd-card__title"><i className="bi bi-clock-history sd-text-brand" /> Recent Activities</h2>
              <button className="sd-link" onClick={() => navigate(ROUTES.notifications)}>
                View All <i className="bi bi-arrow-right" />
              </button>
            </header>
            {activityLoading || feeLoading ? (
              <div className="skeleton skeleton-text" style={{ width: "100%", height: 150 }} />
            ) : activities.length ? (
              <ul className="sd-activity">
                {activities.map((a) => {
                  const meta = ACTIVITY_ICON[a.type] || ACTIVITY_ICON.GENERAL;
                  return (
                    <li key={a.key}>
                      <span className={`sd-activity__icon sd-tone-${meta.tone}`}><i className={`bi ${meta.icon}`} /></span>
                      <div className="sd-activity__text">
                        <strong>{a.title}</strong>
                        <span>{a.sub}</span>
                      </div>
                      <time>{timeAgo(a.at)}</time>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="sd-empty">Nothing yet. Your payments and school notices will show up here.</p>
            )}
          </section>
        </div>

        {/* ---------- RIGHT ---------- */}
        <aside className="sd-col">
          {/* Profile */}
          <section className="sd-card sd-o-profile">
            <header className="sd-card__head">
              <h2 className="sd-card__title"><i className="bi bi-person-badge-fill sd-text-brand" /> My Profile</h2>
              <button className="sd-link" onClick={() => navigate(ROUTES.profile)}>
                Edit Profile <i className="bi bi-arrow-right" />
              </button>
            </header>
            {profileLoading ? (
              <div className="skeleton skeleton-text" style={{ width: "100%", height: 190 }} />
            ) : (
              <>
                <div className="sd-profile__top">
                  <span className="sd-avatar">{initials}</span>
                  <div>
                    <div className="sd-profile__name">{fullName || "Student"}</div>
                    <div className="sd-profile__meta">
                      {enrollment?.classroom_label || "Not enrolled"}
                      {profile?.student_profile?.curriculum_type ? ` · ${profile.student_profile.curriculum_type}` : ""}
                    </div>
                  </div>
                </div>
                <dl className="sd-profile__list">
                  <div><dt><i className="bi bi-person-vcard" /> Admission No</dt><dd>{profile?.student_profile?.admission_no || profile?.username || "-"}</dd></div>
                  <div><dt><i className="bi bi-envelope" /> Email</dt><dd>{profile?.email || "-"}</dd></div>
                  <div><dt><i className="bi bi-telephone" /> Phone</dt><dd>{profile?.phone_number || "-"}</dd></div>
                </dl>
              </>
            )}
          </section>

          {/* Quick links */}
          <section className="sd-card sd-o-quick">
            <header className="sd-card__head">
              <h2 className="sd-card__title"><i className="bi bi-lightning-charge-fill sd-text-brand" /> Quick Links</h2>
            </header>
            <div className="sd-quick">
              {quickLinks.map((q) => (
                <button key={q.label} className={`sd-quick__item sd-tone-${q.tone}`} onClick={() => navigate(q.to)}>
                  <i className={`bi ${q.icon}`} />
                  <span>{q.label}</span>
                  {q.label === "Notifications" && unread > 0 && <b className="sd-quick__badge">{unread}</b>}
                </button>
              ))}
            </div>
          </section>

          {/* Upcoming events */}
          <section className="sd-card sd-o-events">
            <header className="sd-card__head">
              <h2 className="sd-card__title"><i className="bi bi-calendar-event-fill sd-text-brand" /> Upcoming Events</h2>
              <button className="sd-link" onClick={() => navigate(ROUTES.calendar)}>
                View Calendar <i className="bi bi-arrow-right" />
              </button>
            </header>
            {eventsLoading ? (
              <div className="skeleton skeleton-text" style={{ width: "100%", height: 90 }} />
            ) : events.length ? (
              <ul className="sd-events">
                {events.map((ev) => (
                  <li key={ev.key}>
                    <div className="sd-events__date">
                      <strong>{ev.date.getDate()}</strong>
                      <span>{ev.date.toLocaleDateString("en-KE", { month: "short" })}</span>
                    </div>
                    <div className="sd-events__text">
                      <strong>{ev.title}</strong>
                      <span>{ev.sub}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sd-empty">No upcoming exams or events.</p>
            )}
          </section>
        </aside>
      </div>

      {/* Empty state */}
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