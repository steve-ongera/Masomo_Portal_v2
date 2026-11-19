import { useEffect, useRef, useState } from "react";
import { studentsApi, student360Api } from "../../services/api";

const kes = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const errText = (e, fallback) => e?.response?.data?.detail || fallback;

// Display only: "15 Jan 2009 (Age 16)"
const ageOf = (d) => {
  if (!d) return null;
  const b = new Date(d);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a -= 1;
  return a >= 0 ? a : null;
};
const dobText = (d) => {
  if (!d) return "-";
  const a = ageOf(d);
  return a === null ? fmtDate(d) : `${fmtDate(d)} (Age ${a})`;
};

const TABS = [
  ["overview", "Personal Info", "bi-person"],
  ["fees", "Fees", "bi-cash-coin"],
  ["academics", "Marks", "bi-journal-check"],
  ["discipline", "Discipline", "bi-exclamation-triangle"],
  ["meals", "Meals", "bi-cup-hot"],
  ["library", "Library", "bi-book"],
  ["account", "Account", "bi-gear"],
];

const CATEGORIES = [
  ["LATENESS", "Lateness / truancy"], ["DISRESPECT", "Disrespect / insubordination"],
  ["FIGHTING", "Fighting / bullying"], ["THEFT", "Theft"], ["VANDALISM", "Vandalism / property damage"],
  ["CHEATING", "Exam malpractice"], ["SUBSTANCE", "Drugs / prohibited items"],
  ["UNIFORM", "Uniform / grooming"], ["OTHER", "Other"],
];
const SEVERITIES = [["MINOR", "Minor"], ["MODERATE", "Moderate"], ["SERIOUS", "Serious"]];
const ACTIONS = [
  ["WARNING", "Verbal / written warning"], ["DETENTION", "Detention / manual work"],
  ["COUNSELLING", "Referred to counselling"], ["PARENT_MEETING", "Parent summoned"],
  ["SUSPENSION", "Suspension"], ["OTHER", "Other"],
];
const label = (list, v) => list.find(([k]) => k === v)?.[1] || v;
const todayISO = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Styles (scoped with the sp- prefix so nothing else in the app is affected)
// Sizes are rem + design tokens from main.css, so the modal follows the
// app's responsive root scale instead of using fixed pixels.
// ---------------------------------------------------------------------------
const CSS = `
.sp-overlay{position:fixed;inset:0;z-index:2000;background:rgba(17,22,51,.5);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;padding:1rem}
.sp-card{width:100%;max-width:64rem;height:min(46rem,92vh);display:flex;flex-direction:column;overflow:hidden;
  background:var(--surface,#fff);color:var(--ink-900);border-radius:var(--radius-xl);
  box-shadow:var(--shadow-xl);border:1px solid var(--border-color)}

/* title bar (drag handle) */
.sp-drag{cursor:grab;touch-action:none;user-select:none}
.sp-drag:active{cursor:grabbing}
@media (max-width:700px){.sp-drag{cursor:default;touch-action:auto}}
.sp-top{flex:0 0 auto;display:flex;align-items:center;gap:.85rem;padding:1.1rem 1.3rem;
  border-bottom:1px solid var(--border-color)}
.sp-top__icon{font-size:1.7rem;color:var(--blue-600);line-height:1;flex-shrink:0}
.sp-top__text{flex:1;min-width:0}
.sp-top__title{margin:0;font-size:var(--fs-lg);font-weight:700;letter-spacing:-.01em;line-height:1.25}
.sp-top__sub{margin:.1rem 0 0;font-size:var(--fs-sm);color:var(--ink-500)}
.sp-close{width:2.1rem;height:2.1rem;border-radius:var(--radius-md);border:0;background:transparent;
  color:var(--ink-600);font-size:1rem;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.sp-close:hover{background:var(--bg-app);color:var(--ink-900)}

/* two columns: profile card | tabs + content */
.sp-main{flex:1 1 auto;min-height:0;display:flex;gap:1.25rem;padding:1.1rem 1.3rem 1.3rem}

/* left profile card */
.sp-side{position:relative;flex:0 0 16rem;display:flex;flex-direction:column;align-items:stretch;
  background:var(--blue-50);border:1px solid var(--blue-100);border-radius:var(--radius-lg);
  padding:1.25rem 1.1rem;overflow-y:auto;text-align:center}
.sp-status{position:absolute;top:.8rem;right:.8rem;display:inline-flex;align-items:center;gap:.35rem;
  padding:.2rem .6rem;border-radius:var(--radius-md);font-weight:600;font-size:var(--fs-xs)}
.sp-status--on{background:var(--success-100);color:#15803d}
.sp-status--off{background:var(--danger-100);color:#c2272d}
.sp-dot{width:.45rem;height:.45rem;border-radius:50%;background:currentColor}
.sp-avatar-wrap{position:relative;align-self:center;margin:1.4rem 0 .8rem}
.sp-avatar{width:7rem;height:7rem;border-radius:50%;border:4px solid #fff;object-fit:cover;background:var(--blue-100);
  display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:var(--blue-600);
  box-shadow:var(--shadow-md)}
.sp-camera{position:absolute;right:.1rem;bottom:.2rem;width:1.9rem;height:1.9rem;border-radius:50%;
  border:2px solid #fff;background:var(--blue-600);color:#fff;display:flex;align-items:center;
  justify-content:center;cursor:pointer;font-size:.8rem;padding:0}
.sp-camera:hover{background:var(--blue-700)}
.sp-camera[disabled]{opacity:.6;cursor:wait}
.sp-side__name{margin:0;font-size:var(--fs-xl);font-weight:700;letter-spacing:-.02em;line-height:1.2}
.sp-side__adm{margin-top:.15rem;color:var(--ink-600);font-size:var(--fs-base)}
.sp-side__list{margin:1rem 0 0;padding:.9rem 0 0;border-top:1px solid var(--blue-100);list-style:none;
  display:flex;flex-direction:column;gap:.7rem;text-align:left}
.sp-side__row{display:flex;gap:.65rem;align-items:flex-start;min-width:0}
.sp-side__row>i{font-size:1rem;color:var(--blue-600);width:1.2rem;text-align:center;margin-top:.1rem}
.sp-side__l{display:block;font-size:var(--fs-xs);color:var(--ink-500);line-height:1.2}
.sp-side__v{display:block;font-size:var(--fs-base);font-weight:500;overflow-wrap:anywhere;line-height:1.3}
.sp-side__actions{margin-top:1.1rem;display:flex;flex-direction:column;gap:.5rem}
.sp-btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;border-radius:var(--radius-md);
  padding:.55rem 1rem;font-size:var(--fs-sm);font-weight:600;cursor:pointer;border:1px solid var(--border-color-strong);
  background:var(--surface);color:var(--ink-900)}
.sp-btn:hover{background:var(--bg-app)}
.sp-btn--primary{background:var(--blue-600);border-color:var(--blue-600);color:#fff;box-shadow:var(--shadow-xs)}
.sp-btn--primary:hover{background:var(--blue-700);border-color:var(--blue-700)}

/* right: tabs + body */
.sp-content{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column}
.sp-tabs{flex:0 0 auto;display:flex;gap:.2rem;border-bottom:1px solid var(--border-color);
  overflow-x:auto;scrollbar-width:none;background:var(--surface)}
.sp-tabs::-webkit-scrollbar{display:none}
.sp-tab{display:inline-flex;align-items:center;gap:.45rem;white-space:nowrap;background:none;border:0;
  padding:.6rem .85rem;font-size:var(--fs-sm);font-weight:600;color:var(--ink-500);
  border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer}
.sp-tab i{font-size:.95rem}
.sp-tab:hover{color:var(--blue-600)}
.sp-tab.is-active{color:var(--blue-600);border-bottom-color:var(--blue-600)}

/* body = the only scrolling area */
.sp-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:1.1rem .25rem .25rem 0}

/* label / value list */
.sp-dl{display:grid;grid-template-columns:11rem minmax(0,1fr);gap:.7rem 1rem;margin:0;font-size:var(--fs-base)}
.sp-dl dt{color:var(--ink-500);font-weight:400}
.sp-dl dd{margin:0;color:var(--ink-900);font-weight:500;overflow-wrap:anywhere}
.sp-chip{display:inline-flex;align-items:center;padding:.2rem .6rem;border-radius:var(--radius-md);
  background:var(--blue-100);color:var(--blue-700);font-size:var(--fs-xs);font-weight:600}
.sp-pill{display:inline-flex;align-items:center;gap:.35rem;padding:.2rem .6rem;border-radius:var(--radius-md);
  font-weight:600;font-size:var(--fs-xs)}
.sp-pill--on{background:var(--success-100);color:#15803d}
.sp-pill--off{background:var(--danger-100);color:#c2272d}
.sp-section{margin:1.2rem 0 .7rem;padding-top:1.1rem;border-top:1px solid var(--border-color);
  font-size:var(--fs-md);font-weight:700;color:var(--ink-900)}
.sp-section:first-child{margin-top:0;padding-top:0;border-top:0}

/* data inside tabs: denser, so more rows fit without scrolling */
.sp-body .table{font-size:var(--fs-xs)}
.sp-body .table thead th{padding:.5rem .7rem;font-size:var(--fs-xs)}
.sp-body .table tbody td{padding:.45rem .7rem}
.sp-body .alert{font-size:var(--fs-xs);padding:.45rem .75rem}
.sp-body .form-label{font-size:var(--fs-xs)}
.sp-body .border.rounded{border-radius:var(--radius-md)!important;border-color:var(--border-color)!important}

@media (max-width:860px){
  .sp-side{flex-basis:14rem}
  .sp-dl{grid-template-columns:8.5rem minmax(0,1fr)}
}
@media (max-width:700px){
  .sp-overlay{padding:0}
  .sp-card{height:100dvh;max-width:none;border-radius:0;border:0}
  .sp-top{padding:.9rem 1rem}
  .sp-main{display:block;overflow-y:auto;padding:.9rem 1rem calc(1rem + var(--safe-bottom))}
  .sp-side{padding:1rem}
  .sp-content{display:block;margin-top:1rem}
  .sp-tabs{position:sticky;top:-.9rem;z-index:2}
  .sp-body{overflow:visible;padding:1rem 0 0}
  .sp-dl{grid-template-columns:1fr;gap:.1rem 0}
  .sp-dl dd{margin-bottom:.6rem}
}
`;

// dt/dd pair for .sp-dl
function Field({ label: l, children, value }) {
  return (
    <>
      <dt>{l}</dt>
      <dd>{children ?? value ?? "-"}</dd>
    </>
  );
}

function Info({ label: l, value }) {
  return (
    <div className="col-12 col-md-6">
      <div className="profile-info-row"><span>{l}</span><span>{value ?? "-"}</span></div>
    </div>
  );
}

function Stat({ title, value, tone }) {
  return (
    <div className="col-6 col-md-3">
      <div className="border rounded p-2 h-100">
        <div className="text-muted small">{title}</div>
        <div className={`fw-bold ${tone || ""}`}>{value}</div>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <p className="form-text-hint">{text}</p>;
}

function printLetter(rec, ctx) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(`<html><head><title>Disciplinary letter - ${esc(ctx.student_name)}</title>
    <style>body{font-family:Georgia,serif;padding:56px;line-height:1.6;color:#111}
    h2{margin:0 0 4px}.meta{color:#555;font-size:13px;margin-bottom:28px}
    pre{white-space:pre-wrap;font-family:inherit;font-size:15px}</style></head><body>
    <h2>${esc(ctx.school_name)}</h2>
    <div class="meta">Disciplinary letter - ${esc(rec.category_display)} (${esc(rec.severity_display)})</div>
    <pre>${esc(rec.letter_body)}</pre></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

function buildLetter(ctx, f) {
  const action = label(ACTIONS, f.action_taken);
  return (
`Date: ${fmtDate(todayISO())}

Dear ${ctx.guardian_name || "Parent/Guardian"},

RE: ${ctx.student_name} (Admission No. ${ctx.admission_no}), ${ctx.class_label}

We write to inform you that on ${fmtDate(f.incident_date)} your child was involved in the following matter: ${f.summary || "[summary]"}.

${f.description || "[Describe what happened]"}

Action taken: ${action}.

We kindly ask for your support in guiding ${ctx.student_name.split(" ")[0]} so that this does not happen again. Please contact the school office if you would like to discuss the matter.

Yours faithfully,
${ctx.issuer_name}
${ctx.school_name}`
  );
}

/**
 * Props: show, studentId, onClose, onChanged(), isAdmin,
 *        onEdit(studentId) - optional; shows the "Edit Profile" button.
 */
export default function StudentProfileModal({ show, studentId, onClose, onChanged, onEdit, isAdmin = false }) {
  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [sections, setSections] = useState({});
  const [loadingKey, setLoadingKey] = useState(null);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState(null); // { type, text }
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef(null);

  // ---- drag to move (grab the title bar) ----
  const cardRef = useRef(null);
  const dragRef = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const onDragStart = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest("button, input, a")) return;
    if (window.innerWidth <= 700 || !cardRef.current) return; // full-screen on phones
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, rect: cardRef.current.getBoundingClientRect() };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    // keep the card inside the screen, with its top bar always reachable
    const dx = Math.min(Math.max(e.clientX - d.sx, -d.rect.left), window.innerWidth - d.rect.right);
    const dy = Math.min(Math.max(e.clientY - d.sy, -d.rect.top), window.innerHeight - 48 - d.rect.top);
    setPos({ x: d.ox + dx, y: d.oy + dy });
  };
  const onDragEnd = () => { dragRef.current = null; };
  const dragProps = {
    onPointerDown: onDragStart, onPointerMove: onDragMove,
    onPointerUp: onDragEnd, onPointerCancel: onDragEnd,
  };

  const loaders = {
    overview: student360Api.overview, fees: student360Api.fees, academics: student360Api.academics,
    discipline: student360Api.discipline, meals: student360Api.meals, library: student360Api.library,
    account: student360Api.account,
  };

  const fetchSection = async (key) => {
    setLoadingKey(key);
    setErr("");
    try {
      const { data } = await loaders[key](studentId);
      setSections((s) => ({ ...s, [key]: data }));
    } catch (e) {
      setErr(errText(e, "Could not load this section."));
    } finally {
      setLoadingKey(null);
    }
  };

  const reload = (key) => {
    setSections((s) => { const n = { ...s }; delete n[key]; return n; });
    fetchSection(key);
  };

  // open / close
  useEffect(() => {
    if (!show) { setSections({}); setDetail(null); setFlash(null); setErr(""); return; }
    setTab("overview");
    setPos({ x: 0, y: 0 });
    studentsApi.detail(studentId).then(({ data }) => setDetail(data)).catch(() => setErr("Could not load student."));
  }, [show, studentId]);

  // lazy-load the tab being viewed
  useEffect(() => {
    if (show && studentId && !sections[tab]) fetchSection(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, studentId, tab]);

  // Esc closes
  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, onClose]);

  const data = sections[tab];
  const ov = sections.overview;
  const busy = loadingKey === tab && !data;
  const photo = ov?.id_card?.photo;
  const initials = (detail?.full_name || "").split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("");

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      await student360Api.uploadPhoto(studentId, fd);
      setFlash({ type: "success", text: "Photo updated." });
      reload("overview");
    } catch (ex) {
      setFlash({ type: "danger", text: errText(ex, "Could not upload the photo.") });
    } finally {
      setPhotoBusy(false);
    }
  };

  // ---------------- PERSONAL INFO ----------------
  const renderOverview = () => {
    if (!detail) return <div className="text-center py-4"><span className="spinner-border spinner-border-sm me-2"></span>Loading...</div>;
    const idc = ov?.id_card;
    const g = detail.guardian;
    return (
      <>
        <h3 className="sp-section">Personal Information</h3>
        <dl className="sp-dl">
          <Field label="Full name" value={detail.full_name} />
          <Field label="Admission number" value={detail.admission_no} />
          <Field label="Class">
            {detail.current_classroom?.label
              ? <span className="sp-chip">{detail.current_classroom.label}</span>
              : "Not enrolled"}
          </Field>
          <Field label="Gender" value={detail.gender === "M" ? "Male" : "Female"} />
          <Field label="Date of birth" value={dobText(detail.date_of_birth)} />
          <Field label="Phone" value={detail.user.phone_number || "-"} />
          <Field label="Email" value={detail.user.email || "-"} />
          <Field label="Curriculum" value={detail.curriculum_type} />
          <Field label="Date admitted" value={fmtDate(detail.date_admitted)} />
          <Field label="National ID / Birth No" value={detail.user.national_id || "-"} />
          <Field label="UPI / NEMIS" value={detail.upi_number || "-"} />
          <Field label="Username" value={detail.user.username} />
          <Field label="Enrollment status">
            <span className={`sp-pill ${detail.is_active ? "sp-pill--on" : "sp-pill--off"}`}>
              <span className="sp-dot"></span>{detail.is_active ? "Active" : "Inactive"}
            </span>
          </Field>
        </dl>

        <h3 className="sp-section">Parent / Guardian Information</h3>
        {g ? (
          <dl className="sp-dl">
            <Field label="Name" value={g.name} />
            <Field label="Phone" value={g.phone_number || "no phone"} />
            <Field label="Relationship" value={g.relationship_display} />
            {g.email ? <Field label="Email" value={g.email} /> : null}
          </dl>
        ) : <Empty text="No guardian linked to this student." />}

        {ov && (
          <>
            <h3 className="sp-section">At a glance</h3>
            <div className="row g-2">
              <Stat title="Fee balance" value={kes(ov.balance)} tone={ov.balance > 0 ? "text-danger" : "text-success"} />
              <Stat title="Disciplinary records" value={ov.discipline_count} />
              <Stat title="Last login" value={ov.last_login ? fmtDate(ov.last_login) : "Never"} />
              <Stat title="Login" value={ov.login_enabled ? "Enabled" : "Disabled"} tone={ov.login_enabled ? "text-success" : "text-danger"} />
            </div>

            <h3 className="sp-section">Student ID</h3>
            {idc ? (
              idc.card_number ? (
                <div className="row g-x-3">
                  <Info label="Card number" value={idc.card_number} />
                  <Info label="Card status" value={idc.status_display} />
                  <Info label="Expiry date" value={fmtDate(idc.expiry_date)} />
                  <Info label="Issued" value={fmtDate(idc.issued_at)} />
                  <Info label="Nationality" value={idc.nationality} />
                  <Info label="Address" value={idc.address || "-"} />
                </div>
              ) : <Empty text="No ID card has been issued to this student yet." />
            ) : <Empty text="ID card module not available." />}
          </>
        )}
      </>
    );
  };

  // ---------------- FEES ----------------
  const renderFees = () => {
    const s = data.summary;
    return (
      <>
        <div className="row g-2 mb-3">
          <Stat title="Brought forward (opening)" value={kes(s.opening_balance)} />
          <Stat title="Total charged" value={kes(s.total_charged)} />
          <Stat title="Total paid" value={kes(s.total_paid)} tone="text-success" />
          <Stat title={s.balance < 0 ? "Prepaid credit" : "Balance owing"} value={kes(Math.abs(s.balance))}
            tone={s.balance > 0 ? "text-danger" : "text-success"} />
        </div>
        {s.other_charges_outstanding > 0 && (
          <div className="alert alert-warning py-2">
            Also owes {kes(s.other_charges_outstanding)} in other charges (uniform, trips, etc.). Not included in the balance above.
          </div>
        )}

        <h3 className="sp-section" style={{ marginTop: 8 }}>Fee statement</h3>
        {data.invoices.length === 0 ? <Empty text="No invoices yet." /> : (
          <div className="table-responsive mb-4">
            <table className="table table-sm">
              <thead><tr><th>Term</th><th>Class</th><th className="text-end">B/F</th><th className="text-end">Term fee</th>
                <th className="text-end">Due</th><th className="text-end">Paid</th><th className="text-end">Balance</th></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{i.term}</td><td>{i.classroom}</td>
                    <td className="text-end">{kes(i.brought_forward)}</td>
                    <td className="text-end">{kes(i.term_charge)}</td>
                    <td className="text-end">{kes(i.amount_due)}</td>
                    <td className="text-end">{kes(i.amount_paid)}</td>
                    <td className={`text-end fw-semibold ${i.balance > 0 ? "text-danger" : "text-success"}`}>{kes(i.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="sp-section" style={{ marginTop: 8 }}>Payments</h3>
        {data.payments.length === 0 ? <Empty text="No payments recorded." /> : (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>Date</th><th>Receipt</th><th>Term</th><th>Method</th><th>Reference</th>
                <th className="text-end">Amount</th><th>Recorded by</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{fmtDate(p.paid_at)}</td><td className="cell-mono">{p.receipt_no}</td><td>{p.term}</td>
                    <td>{p.method}</td><td className="cell-mono">{p.reference || "-"}</td>
                    <td className="text-end">{kes(p.amount)}</td><td>{p.recorded_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  // ---------------- ACADEMICS ----------------
  const renderAcademics = () => {
    if (data.years.length === 0) return <Empty text="No enrollment history." />;
    return data.years.map((y) => (
      <div key={y.enrollment_id} className="mb-4">
        <div className="d-flex justify-content-between align-items-center border-bottom pb-1 mb-2">
          <h6 className="mb-0 fw-bold">{y.classroom} <span className="text-muted fw-normal">- {y.academic_year}</span></h6>
          <span className="badge badge-neutral">{y.status}{y.is_current ? " (current)" : ""}</span>
        </div>
        {y.exams.length === 0 ? <Empty text="No marks recorded for this year." /> : y.exams.map((ex) => (
          <div key={ex.exam_id} className="border rounded p-2 mb-2">
            <div className="d-flex flex-wrap justify-content-between gap-2 mb-1">
              <strong>{ex.exam} <span className="text-muted fw-normal">({ex.term})</span></strong>
              <span className="small">
                Avg <strong>{ex.average ?? "-"}%</strong> - Grade <strong>{ex.overall_grade ?? "-"}</strong>
                {ex.class_position ? <> - Class <strong>{ex.class_position}/{ex.class_size}</strong></> : null}
                {ex.grade_position ? <> - Overall <strong>{ex.grade_position}/{ex.grade_size}</strong></> : null}
                {!ex.is_published && <span className="badge badge-neutral ms-2">Unpublished</span>}
              </span>
            </div>
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead><tr><th>Subject</th><th className="text-end">Marks</th><th className="text-end">%</th><th>Grade</th><th>Remark</th></tr></thead>
                <tbody>
                  {ex.subjects.map((s) => (
                    <tr key={s.subject}>
                      <td>{s.subject}</td><td className="text-end">{s.marks}/{s.out_of}</td>
                      <td className="text-end">{s.percentage}</td><td>{s.grade}</td><td>{s.remark || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    ));
  };

  // ---------------- DISCIPLINE ----------------
  const [dForm, setDForm] = useState(null);
  const [dSaving, setDSaving] = useState(false);

  const openDForm = () => setDForm({
    incident_date: todayISO(), category: "LATENESS", severity: "MINOR", action_taken: "WARNING",
    summary: "", description: "", letter_body: "",
  });

  const saveDiscipline = async (e) => {
    e.preventDefault();
    setDSaving(true);
    try {
      await student360Api.addDiscipline(studentId, dForm);
      setFlash({ type: "success", text: "Disciplinary letter saved." });
      setDForm(null);
      reload("discipline");
      reload("overview");
    } catch (ex) {
      setFlash({ type: "danger", text: errText(ex, "Could not save the letter.") });
    } finally {
      setDSaving(false);
    }
  };

  const renderDiscipline = () => {
    const ctx = data.context;
    return (
      <>
        {!dForm && (
          <button className="btn btn-primary btn-sm mb-3" onClick={openDForm}>
            <i className="bi bi-pencil-square me-1"></i>Write disciplinary letter
          </button>
        )}

        {dForm && (
          <form onSubmit={saveDiscipline} className="border rounded p-3 mb-4">
            <div className="row g-2">
              <div className="col-md-3">
                <label className="form-label small">Incident date</label>
                <input type="date" className="form-control" required value={dForm.incident_date}
                  onChange={(e) => setDForm({ ...dForm, incident_date: e.target.value })} />
              </div>
              <div className="col-md-5">
                <label className="form-label small">Category</label>
                <select className="form-select" value={dForm.category}
                  onChange={(e) => setDForm({ ...dForm, category: e.target.value })}>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label small">Severity</label>
                <select className="form-select" value={dForm.severity}
                  onChange={(e) => setDForm({ ...dForm, severity: e.target.value })}>
                  {SEVERITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label small">Action taken</label>
                <select className="form-select" value={dForm.action_taken}
                  onChange={(e) => setDForm({ ...dForm, action_taken: e.target.value })}>
                  {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label small">Short summary</label>
                <input className="form-control" required maxLength={200} placeholder="e.g. Was found out of bounds during prep"
                  value={dForm.summary} onChange={(e) => setDForm({ ...dForm, summary: e.target.value })} />
              </div>
              <div className="col-12">
                <label className="form-label small">What happened</label>
                <textarea className="form-control" rows={3} value={dForm.description}
                  onChange={(e) => setDForm({ ...dForm, description: e.target.value })} />
              </div>
              <div className="col-12">
                <div className="d-flex justify-content-between align-items-center">
                  <label className="form-label small mb-1">Letter to parent / guardian</label>
                  <button type="button" className="btn btn-sm btn-outline-primary"
                    onClick={() => setDForm({ ...dForm, letter_body: buildLetter(ctx, dForm) })}>
                    <i className="bi bi-magic me-1"></i>Generate from details
                  </button>
                </div>
                <textarea className="form-control" rows={12} required value={dForm.letter_body}
                  onChange={(e) => setDForm({ ...dForm, letter_body: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setDForm(null)}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={dSaving}>{dSaving ? "Saving..." : "Save letter"}</button>
            </div>
          </form>
        )}

        <h3 className="sp-section" style={{ marginTop: 8 }}>Previous records ({data.records.length})</h3>
        {data.records.length === 0 ? <Empty text="No disciplinary records. A clean file." /> : data.records.map((r) => (
          <div key={r.id} className="border rounded p-2 mb-2">
            <div className="d-flex flex-wrap justify-content-between gap-2">
              <div>
                <strong>{r.summary}</strong>
                <div className="text-muted small">
                  {fmtDate(r.incident_date)} - {r.category_display} - {r.class_label || "-"} - by {r.issued_by}
                </div>
              </div>
              <div className="d-flex gap-2 align-items-start">
                <span className={`badge ${r.severity === "SERIOUS" ? "badge-danger" : r.severity === "MODERATE" ? "badge-gold" : "badge-neutral"}`}>
                  {r.severity_display}
                </span>
                <span className="badge badge-neutral">{r.action_display}</span>
                <button className="btn btn-sm btn-outline-primary" onClick={() => printLetter(r, ctx)}>
                  <i className="bi bi-printer"></i> Print
                </button>
              </div>
            </div>
            <details className="mt-1">
              <summary className="small text-brand" style={{ cursor: "pointer" }}>View letter</summary>
              <pre className="small mt-2 mb-0" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{r.letter_body}</pre>
            </details>
          </div>
        ))}
      </>
    );
  };

  // ---------------- MEALS ----------------
  const renderMeals = () => {
    if (!data.available) return <Empty text="Meal management is not available." />;
    return (
      <>
        <h3 className="sp-section">Meal plan (current year)</h3>
        {data.plan ? (
          <>
            <div className="row g-x-3">
              <Info label="Plan" value={data.plan.name} />
              <Info label="Billing" value={data.plan.billing_display} />
            </div>
            <div className="d-flex flex-wrap gap-2 mt-2">
              {data.plan.meals.map((m) => (
                <span key={m.meal} className="badge badge-neutral">
                  {m.meal}{data.plan.billing_mode === "WALLET" ? ` - ${kes(m.price)}` : ""}
                </span>
              ))}
            </div>
          </>
        ) : <Empty text="Not on any meal plan this year." />}

        <h3 className="sp-section">Meal card & wallet</h3>
        <div className="row g-x-3">
          <Info label="Card number" value={data.card?.card_number || "No active card"} />
          <Info label="Card status" value={data.card?.status || "-"} />
          <Info label="Wallet balance" value={data.wallet ? kes(data.wallet.balance) : "No wallet"} />
        </div>

        <h3 className="sp-section">Recent meals</h3>
        {data.recent_meals.length === 0 ? <Empty text="No meals collected yet." /> : (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>Date</th><th>Meal</th><th className="text-end">Charged</th></tr></thead>
              <tbody>{data.recent_meals.map((m, i) => (
                <tr key={i}><td>{fmtDate(m.date)}</td><td>{m.meal}</td><td className="text-end">{kes(m.charged)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {data.wallet_transactions.length > 0 && (
          <>
            <h3 className="sp-section">Wallet transactions</h3>
            <div className="table-responsive">
              <table className="table table-sm">
                <thead><tr><th>Date</th><th>Type</th><th className="text-end">Amount</th><th className="text-end">Balance</th><th>Reference</th></tr></thead>
                <tbody>{data.wallet_transactions.map((t, i) => (
                  <tr key={i}><td>{fmtDate(t.date)}</td><td>{t.kind}</td><td className="text-end">{kes(t.amount)}</td>
                    <td className="text-end">{kes(t.balance_after)}</td><td className="cell-mono">{t.reference || "-"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </>
    );
  };

  // ---------------- LIBRARY ----------------
  const renderLibrary = () => {
    if (!data.available) return <Empty text={data.detail || "Library data is not available."} />;
    return (
      <>
        <div className="row g-2 mb-3">
          <Stat title="Currently borrowed" value={data.currently_borrowed} />
          <Stat title="Total loans" value={data.loans.length} />
        </div>
        <h3 className="sp-section" style={{ marginTop: 8 }}>Loans</h3>
        {data.loans.length === 0 ? <Empty text="No books borrowed." /> : (
          <div className="table-responsive mb-3">
            <table className="table table-sm">
              <thead><tr><th>Book</th><th>Accession</th><th>Issued</th><th>Due</th><th>Returned</th></tr></thead>
              <tbody>{data.loans.map((l) => (
                <tr key={l.id}>
                  <td>{l.book}</td><td className="cell-mono">{l.accession_no || "-"}</td>
                  <td>{fmtDate(l.issued_on)}</td><td>{fmtDate(l.due_on)}</td>
                  <td>{l.returned_on ? fmtDate(l.returned_on) : <span className="badge badge-gold">Out</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <h3 className="sp-section" style={{ marginTop: 8 }}>Fines</h3>
        {data.fines.length === 0 ? <Empty text="No library fines." /> : (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>Date</th><th>Reason</th><th>Status</th><th className="text-end">Amount</th></tr></thead>
              <tbody>{data.fines.map((f) => (
                <tr key={f.id}><td>{fmtDate(f.created)}</td><td>{f.reason || "-"}</td><td>{f.status || "-"}</td>
                  <td className="text-end">{kes(f.amount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  // ---------------- ACCOUNT ----------------
  const [newPw, setNewPw] = useState("");
  const [pwResult, setPwResult] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const resetPassword = async (e) => {
    e.preventDefault();
    setPwBusy(true);
    try {
      const { data: res } = await studentsApi.resetPassword(studentId, { new_password: newPw || undefined });
      setPwResult(res.new_password);
      setNewPw("");
    } catch (ex) {
      setFlash({ type: "danger", text: errText(ex, "Could not reset password.") });
    } finally {
      setPwBusy(false);
    }
  };

  const changeStatus = async (active) => {
    if (!active && !window.confirm("Deactivate this student? They will no longer be able to log in.")) return;
    setStatusBusy(true);
    try {
      const { data: res } = await student360Api.setActive(studentId, { active, reason });
      setFlash({ type: "success", text: res.detail });
      setReason("");
      reload("account");
      reload("overview");
      studentsApi.detail(studentId).then(({ data: d }) => setDetail(d)).catch(() => {});
      onChanged?.();
    } catch (ex) {
      setFlash({ type: "danger", text: errText(ex, "Could not change status.") });
    } finally {
      setStatusBusy(false);
    }
  };

  const renderAccount = () => (
    <>
      <h3 className="sp-section">Reset password</h3>
      {pwResult ? (
        <div className="alert alert-success">
          New password: <code>{pwResult}</code>
          <div className="form-text-hint mb-0">Share it with the student securely. It won't be shown again.</div>
          <button className="btn btn-sm btn-light mt-2" onClick={() => setPwResult(null)}>Done</button>
        </div>
      ) : (
        <form onSubmit={resetPassword} className="d-flex gap-2 flex-wrap mb-1">
          <input className="form-control" style={{ maxWidth: 320 }} placeholder="New password (blank = default)"
            value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <button className="btn btn-warning" disabled={pwBusy}>{pwBusy ? "Resetting..." : "Reset password"}</button>
        </form>
      )}
      <div className="form-text-hint">No need to know the old password. Also clears any lockout.</div>

      <h3 className="sp-section">Account status</h3>
      <div className="row g-x-3 mb-2">
        <Info label="Student profile" value={data.profile_active ? "Active" : "Inactive"} />
        <Info label="Can log in" value={data.login_enabled ? "Yes" : "No"} />
        <Info label="Locked out" value={data.locked ? "Yes" : "No"} />
        <Info label="Last login" value={data.last_login ? fmtDate(data.last_login) : "Never"} />
      </div>

      {isAdmin ? (
        data.login_enabled ? (
          <div className="border border-danger rounded p-3">
            <div className="fw-semibold text-danger mb-1">Deactivate student</div>
            <p className="small mb-2">Disables the login and marks the profile inactive. Records, fees and marks are kept.</p>
            <input className="form-control mb-2" placeholder="Reason (required)" maxLength={255}
              value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn btn-danger" disabled={statusBusy || !reason.trim()} onClick={() => changeStatus(false)}>
              {statusBusy ? "Working..." : "Deactivate account & profile"}
            </button>
          </div>
        ) : (
          <div className="border rounded p-3">
            <p className="small mb-2">This student cannot log in.</p>
            <input className="form-control mb-2" placeholder="Reason (optional)" maxLength={255}
              value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn btn-success" disabled={statusBusy} onClick={() => changeStatus(true)}>
              {statusBusy ? "Working..." : "Reactivate student"}
            </button>
          </div>
        )
      ) : <Empty text="Only an administrator can deactivate or reactivate a student." />}

      <h3 className="sp-section">Status history</h3>
      {data.history.length === 0 ? <Empty text="No status changes." /> : data.history.map((h, i) => (
        <div key={i} className="small border-bottom py-1">
          <strong>{h.action}</strong> - {fmtDate(h.at)} by {h.by}{h.reason ? ` - ${h.reason}` : ""}
        </div>
      ))}
    </>
  );

  const renderers = {
    overview: renderOverview, fees: renderFees, academics: renderAcademics, discipline: renderDiscipline,
    meals: renderMeals, library: renderLibrary, account: renderAccount,
  };

  if (!show) return null; // after every hook, so hook order never changes

  const isActive = detail ? detail.is_active : true;
  const phone = detail?.user.phone_number || detail?.guardian?.phone_number;
  const email = detail?.user.email || detail?.guardian?.email;

  return (
    <div className="sp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div ref={cardRef} className="sp-card" role="dialog" aria-modal="true" aria-label="Student details"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>

        {/* Title bar - drag here to move */}
        <div className="sp-top sp-drag" title="Drag to move" {...dragProps}>
          <i className="bi bi-mortarboard sp-top__icon" aria-hidden="true"></i>
          <div className="sp-top__text">
            <h2 className="sp-top__title">Student Details</h2>
            <p className="sp-top__sub">View complete information about this student</p>
          </div>
          <button className="sp-close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg"></i></button>
        </div>

        <div className="sp-main">
          {/* Left: profile card */}
          <aside className="sp-side">
            <span className={`sp-status ${isActive ? "sp-status--on" : "sp-status--off"}`}>
              <span className="sp-dot"></span>{isActive ? "Active" : "Inactive"}
            </span>

            <div className="sp-avatar-wrap">
              {photo ? <img className="sp-avatar" src={photo} alt="" /> : <div className="sp-avatar">{initials || <i className="bi bi-person"></i>}</div>}
              <button className="sp-camera" title="Change photo" aria-label="Change photo" disabled={photoBusy}
                onClick={() => fileRef.current?.click()}>
                {photoBusy ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-camera-fill"></i>}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={uploadPhoto} />
            </div>

            <h3 className="sp-side__name">{detail?.full_name || "Loading..."}</h3>
            <div className="sp-side__adm">{detail?.admission_no || ""}</div>

            {detail && (
              <ul className="sp-side__list">
                <li className="sp-side__row">
                  <i className="bi bi-mortarboard"></i>
                  <span><span className="sp-side__l">Class</span><span className="sp-side__v">{detail.current_classroom?.label || "Not enrolled"}</span></span>
                </li>
                <li className="sp-side__row">
                  <i className="bi bi-gender-ambiguous"></i>
                  <span><span className="sp-side__l">Gender</span><span className="sp-side__v">{detail.gender === "M" ? "Male" : "Female"}</span></span>
                </li>
                <li className="sp-side__row">
                  <i className="bi bi-calendar-event"></i>
                  <span><span className="sp-side__l">Date of birth</span><span className="sp-side__v">{dobText(detail.date_of_birth)}</span></span>
                </li>
                {phone && (
                  <li className="sp-side__row">
                    <i className="bi bi-telephone"></i>
                    <span><span className="sp-side__l">Phone</span><span className="sp-side__v">{phone}</span></span>
                  </li>
                )}
                {email && (
                  <li className="sp-side__row">
                    <i className="bi bi-envelope"></i>
                    <span><span className="sp-side__l">Email</span><span className="sp-side__v">{email}</span></span>
                  </li>
                )}
              </ul>
            )}

            {onEdit && (
              <div className="sp-side__actions">
                <button className="sp-btn sp-btn--primary" onClick={() => onEdit(studentId)}>
                  <i className="bi bi-pencil-square"></i>Edit Profile
                </button>
              </div>
            )}
          </aside>

          {/* Right: tabs + content */}
          <section className="sp-content">
            <div className="sp-tabs" role="tablist">
              {TABS.map(([key, text, icon]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key}
                  className={`sp-tab ${tab === key ? "is-active" : ""}`} onClick={() => setTab(key)}>
                  <i className={`bi ${icon}`}></i>{text}
                </button>
              ))}
            </div>

            <div className="sp-body">
              {flash && (
                <div className={`alert alert-${flash.type} alert-dismissible py-2`}>
                  {flash.text}
                  <button type="button" className="btn-close" onClick={() => setFlash(null)}></button>
                </div>
              )}
              {err && !data && <div className="alert alert-danger py-2">{err}</div>}

              {tab === "overview" ? renderOverview() : busy ? (
                <div className="text-center py-4"><span className="spinner-border spinner-border-sm me-2"></span>Loading...</div>
              ) : data ? renderers[tab]() : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}