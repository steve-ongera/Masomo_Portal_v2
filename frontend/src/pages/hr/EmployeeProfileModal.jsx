import { useEffect, useState, useCallback } from "react";
import { hrApi, employee360Api } from "../../services/api";
import Modal from "../../components/Modal";

const CATEGORY = {
  TEACHER: "Teacher", ADMINISTRATION: "Administration", ACCOUNTS: "Accounts", ICT: "ICT", SUPPORT: "Support staff",
};
const EMPLOYMENT_TYPE = { PERMANENT: "Permanent", CONTRACT: "Contract", PROBATION: "Probation", CASUAL: "Casual" };

const MONEY = /amount|salary|deduction|tax|nssf|nhif|shif|housing|allowance|gross|net|paye|basic|relief|levy|total|pay$/i;
const hidden = (k) =>
  k === "id" || k.endsWith("_id") || k.endsWith("_code") || k === "employee" ||
  k === "created_at" || k === "updated_at";
const pretty = (k) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "-";
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";
const errText = (e, fb) => {
  const d = e?.response?.data;
  return d?.detail || (d && typeof d === "object" ? Object.values(d).flat().join(" ") : null) || fb;
};

const fmtVal = (k, v) => {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "boolean") return <span className={`badge ${v ? "badge-success" : "badge-neutral"}`}>{v ? "Yes" : "No"}</span>;
  if (typeof v === "number") {
    return MONEY.test(k) ? `KES ${v.toLocaleString("en-KE", { maximumFractionDigits: 2 })}` : v.toLocaleString("en-KE");
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return v.length > 10 ? fmtDateTime(v) : fmtDate(v);
  return String(v);
};

function Empty({ text }) { return <p className="form-text-hint">{text}</p>; }
function Spinner() { return <div className="text-center py-4"><span className="spinner-border spinner-border-sm me-2"></span>Loading...</div>; }

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

function DataTable({ rows, empty }) {
  if (!rows || rows.length === 0) return <Empty text={empty} />;
  const cols = [...new Set(rows.slice(0, 30).flatMap((r) => Object.keys(r)))].filter((k) => !hidden(k));
  return (
    <div className="table-responsive">
      <table className="table table-sm table-hover">
        <thead><tr>{cols.map((c) => <th key={c}>{pretty(c)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>{cols.map((c) => <td key={c}>{fmtVal(c, r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountChips({ counts }) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return null;
  return (
    <div className="d-flex flex-wrap gap-2 mb-3">
      {entries.map(([k, v]) => <span key={k} className="badge badge-neutral">{k}: {v}</span>)}
    </div>
  );
}

/**
 * Props: show, employeeId, onClose, onChanged(), depts, positions
 */
export default function EmployeeProfileModal({ show, employeeId, onClose, onChanged, depts = [], positions = [] }) {
  const [tab, setTab] = useState("overview");
  const [sections, setSections] = useState({});
  const [loadingKey, setLoadingKey] = useState(null);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState(null);

  // teaching
  const [teachYear, setTeachYear] = useState("");

  // edit
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  // account
  const [availableUsers, setAvailableUsers] = useState([]);
  const [linkUserId, setLinkUserId] = useState("");
  const [accBusy, setAccBusy] = useState(false);
  const [loginResult, setLoginResult] = useState(null);

  const keyFor = (t) => (t === "teaching" ? `teaching:${teachYear}` : t);

  const fetchSection = useCallback(async (t, yearOverride) => {
    const k = t === "teaching" ? `teaching:${yearOverride ?? teachYear}` : t;
    setLoadingKey(k);
    setErr("");
    try {
      const params = t === "teaching" && (yearOverride ?? teachYear) ? { academic_year: yearOverride ?? teachYear } : undefined;
      const { data } = await employee360Api.section(employeeId, t, params);
      setSections((s) => ({ ...s, [k]: data }));
      if (t === "teaching" && !teachYear && data.selected_academic_year) setTeachYear(String(data.selected_academic_year));
    } catch (e) {
      setErr(errText(e, "Could not load this section."));
    } finally {
      setLoadingKey(null);
    }
  }, [employeeId, teachYear]);

  const reload = (t) => {
    setSections((s) => { const n = { ...s }; delete n[keyFor(t)]; return n; });
    fetchSection(t);
  };

  const reloadAll = () => { setSections({}); fetchSection("overview"); if (tab !== "overview") fetchSection(tab); };

  // open / close
  useEffect(() => {
    if (!show) { setSections({}); setFlash(null); setErr(""); setEditing(false); setTeachYear(""); setLoginResult(null); return; }
    setTab("overview");
  }, [show, employeeId]);

  // lazy-load active tab
  useEffect(() => {
    if (show && employeeId && !sections[keyFor(tab)]) fetchSection(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, employeeId, tab, teachYear]);

  // Esc is handled by Modal; account tab needs the user list
  useEffect(() => {
    if (show && tab === "account") {
      hrApi.employees.availableUsers().then((r) => setAvailableUsers(r.data)).catch(() => setAvailableUsers([]));
    }
  }, [show, tab]);

  const ov = sections.overview;
  const data = sections[keyFor(tab)];
  const busy = loadingKey === keyFor(tab) && !data;

  const tabs = [
    ["overview", "Profile", "bi-person-vcard"],
    ["attendance", "Attendance", "bi-calendar-check"],
    ["payroll", "Payroll", "bi-cash-coin"],
    ["leave", "Leave", "bi-calendar2-x"],
    ...(ov?.is_teacher ? [["teaching", "Teaching", "bi-mortarboard"]] : []),
    ["account", "Account", "bi-gear"],
  ];

  // ---------------- edit ----------------
  const startEdit = () => {
    const f = ov.fields;
    setForm({
      first_name: f.first_name || "",
      last_name: f.last_name || "",
      gender: f.gender_code || f.gender || "M",
      national_id: f.national_id || "",
      phone: f.phone || "",
      email: f.email || "",
      category: f.category_code || f.category || "TEACHER",
      employment_type: f.employment_type_code || f.employment_type || "PERMANENT",
      department: f.department_id || "",
      position: f.position_id || "",
    });
    setEditing(true);
  };
  const setF = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const saveEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await hrApi.employees.update(employeeId, {
        ...form,
        department: form.department || null,
        position: form.position || null,
      });
      setFlash({ type: "success", text: "Employee details updated." });
      setEditing(false);
      reloadAll();
      onChanged?.();
    } catch (ex) {
      setFlash({ type: "danger", text: errText(ex, "Could not update the employee.") });
    } finally {
      setSaving(false);
    }
  };

  // ---------------- account actions ----------------
  const doLink = async () => {
    if (!linkUserId) return;
    setAccBusy(true);
    try {
      await hrApi.employees.update(employeeId, { user_id: linkUserId });
      setFlash({ type: "success", text: "Account linked." });
      setLinkUserId("");
      reloadAll(); onChanged?.();
    } catch (ex) { setFlash({ type: "danger", text: errText(ex, "Could not link the account.") }); }
    finally { setAccBusy(false); }
  };

  const doUnlink = async () => {
    if (!window.confirm("Unlink this account from the employee? The account itself is not deleted.")) return;
    setAccBusy(true);
    try {
      await hrApi.employees.unlinkUser(employeeId);
      setFlash({ type: "success", text: "Account unlinked." });
      reloadAll(); onChanged?.();
    } catch (ex) { setFlash({ type: "danger", text: errText(ex, "Could not unlink.") }); }
    finally { setAccBusy(false); }
  };

  const doCreateLogin = async () => {
    setAccBusy(true);
    try {
      const { data: res } = await hrApi.employees.createLogin(employeeId);
      setLoginResult({ username: res.username, initial_password: res.initial_password });
      reloadAll(); onChanged?.();
    } catch (ex) { setFlash({ type: "danger", text: errText(ex, "Could not create the login.") }); }
    finally { setAccBusy(false); }
  };

  // ---------------- renderers ----------------
  const renderOverview = () => {
    if (!ov) return <Spinner />;
    if (editing && form) {
      return (
        <form onSubmit={saveEdit}>
          <div className="row g-3">
            <div className="col-md-6"><label className="form-label">First Name</label>
              <input className="form-control" required value={form.first_name} onChange={setF("first_name")} /></div>
            <div className="col-md-6"><label className="form-label">Last Name</label>
              <input className="form-control" required value={form.last_name} onChange={setF("last_name")} /></div>
            <div className="col-md-4"><label className="form-label">Gender</label>
              <select className="form-select" value={form.gender} onChange={setF("gender")}>
                <option value="M">Male</option><option value="F">Female</option></select></div>
            <div className="col-md-4"><label className="form-label">National ID</label>
              <input className="form-control" required value={form.national_id} onChange={setF("national_id")} /></div>
            <div className="col-md-4"><label className="form-label">Phone</label>
              <input className="form-control" value={form.phone} onChange={setF("phone")} /></div>
            <div className="col-12"><label className="form-label">Email</label>
              <input type="email" className="form-control" value={form.email} onChange={setF("email")} /></div>
            <div className="col-md-6"><label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={setF("category")}>
                {Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="col-md-6"><label className="form-label">Employment Type</label>
              <select className="form-select" value={form.employment_type} onChange={setF("employment_type")}>
                {Object.entries(EMPLOYMENT_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="col-md-6"><label className="form-label">Department</label>
              <select className="form-select" value={form.department} onChange={setF("department")}>
                <option value="">No department</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div className="col-md-6"><label className="form-label">Position</label>
              <select className="form-select" value={form.position} onChange={setF("position")}>
                <option value="">No position</option>
                {positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div>
          </div>
          <div className="mt-3 d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-success" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
          </div>
        </form>
      );
    }

    const fields = Object.entries(ov.fields).filter(([k, v]) => !hidden(k) && v !== null && v !== "");
    const att = ov.stats?.attendance_last_90_days || {};
    const leave = ov.stats?.leave_by_status || {};
    return (
      <>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="fw-bold mb-0">Employee profile</h6>
          <button className="btn btn-sm btn-outline-primary" onClick={startEdit}>
            <i className="bi bi-pencil me-1"></i>Edit details
          </button>
        </div>
        <dl className="row mb-4">
          {fields.map(([k, v]) => (
            <div key={k} className="col-12 col-md-6 d-flex gap-2 mb-1">
              <dt className="text-muted fw-normal" style={{ minWidth: "9rem" }}>{pretty(k)}</dt>
              <dd className="mb-0 fw-medium">{fmtVal(k, v)}</dd>
            </div>
          ))}
        </dl>

        <h6 className="fw-bold">At a glance</h6>
        <div className="row g-2">
          <Stat title="Present (90 days)" value={att.PRESENT ?? att.Present ?? "-"} />
          <Stat title="Absent (90 days)" value={att.ABSENT ?? att.Absent ?? "-"} />
          <Stat title="Leave requests" value={Object.values(leave).reduce((a, b) => a + b, 0)} />
          <Stat title="Account" value={ov.linked_user ? ov.linked_user.username : "Not linked"}
            tone={ov.linked_user ? "text-success" : "text-muted"} />
        </div>
        {ov.stats?.latest_payslip && (
          <>
            <h6 className="fw-bold mt-4">Latest payslip</h6>
            <DataTable rows={[ov.stats.latest_payslip]} empty="" />
          </>
        )}
      </>
    );
  };

  const renderAttendance = () => (
    <>
      {!data.available && <Empty text={data.detail} />}
      <CountChips counts={data.summary} />
      <div className="small text-muted mb-2">Showing {fmtDate(data.from)} to {fmtDate(data.to)}</div>
      <DataTable rows={data.rows} empty="No attendance records in this period." />
    </>
  );

  const renderPayroll = () => (
    <>
      {!data.available && <Empty text="Payroll data is not available for this employee." />}
      <h6 className="fw-bold">Salary</h6>
      <DataTable rows={data.salary} empty="No salary set up yet." />
      <h6 className="fw-bold mt-4">Payslips</h6>
      <DataTable rows={data.payslips} empty="No payslips yet." />
    </>
  );

  const renderLeave = () => (
    <>
      <CountChips counts={data.summary} />
      <DataTable rows={data.rows} empty="No leave requests." />
    </>
  );

  const renderTeaching = () => {
    if (!data.linked) return <Empty text={data.detail} />;
    return (
      <>
        <div className="row g-2 mb-3">
          <Stat title="Class teacher now" value={data.is_class_teacher_now ? "Yes" : "No"}
            tone={data.is_class_teacher_now ? "text-success" : ""} />
          <Stat title="Ever class teacher" value={data.ever_class_teacher ? "Yes" : "No"} />
          <Stat title="Subjects (selected year)" value={data.allocations.length} />
          <Stat title="Periods / week" value={data.total_periods_per_week} />
        </div>

        <div className="d-flex align-items-center gap-2 mb-2">
          <label className="form-label mb-0">Academic year</label>
          <select className="form-select" style={{ maxWidth: 260 }} value={teachYear}
            onChange={(e) => setTeachYear(e.target.value)}>
            {data.academic_years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.year}{y.is_current ? " (current)" : ""} - {y.allocations} allocation{y.allocations !== 1 ? "s" : ""}{y.class_teacher ? " - class teacher" : ""}
              </option>
            ))}
          </select>
        </div>

        <h6 className="fw-bold mt-3">Subject allocations</h6>
        {data.allocations.length === 0 ? <Empty text="No subjects allocated in this year." /> : (
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead><tr><th>Subject</th><th>Class</th><th>Grade</th><th className="text-end">Periods/wk</th><th>Double</th></tr></thead>
              <tbody>
                {data.allocations.map((a) => (
                  <tr key={a.id}>
                    <td>{a.subject} <span className="text-muted small">({a.subject_code})</span></td>
                    <td>{a.classroom}</td><td>{a.grade_level}</td>
                    <td className="text-end">{a.periods_per_week}</td>
                    <td>{a.double_lesson ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h6 className="fw-bold mt-4">Class teacher history</h6>
        {data.class_teacher_history.length === 0 ? <Empty text="Has never been a class teacher." /> : (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>Year</th><th>Class</th><th className="text-end">Active students</th><th></th></tr></thead>
              <tbody>
                {data.class_teacher_history.map((c) => (
                  <tr key={c.id}>
                    <td>{c.academic_year}</td><td>{c.classroom}</td>
                    <td className="text-end">{c.students}</td>
                    <td>{c.is_current_year && <span className="badge badge-success">Current</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  const renderAccount = () => {
    const u = data.user;
    return (
      <>
        {loginResult && (
          <div className="alert alert-success">
            Login created. Username <code>{loginResult.username}</code>, initial password{" "}
            <code>{loginResult.initial_password}</code>
            <div className="form-text-hint mb-0">Share securely. It won't be shown again.</div>
          </div>
        )}
        {u ? (
          <>
            <dl className="row mb-3">
              {[
                ["Username", u.username], ["Name", u.full_name], ["Role", u.role_display],
                ["Email", u.email || "-"], ["Phone", u.phone_number || "-"],
                ["Can log in", u.is_active ? "Yes" : "No"], ["Locked out", u.locked ? "Yes" : "No"],
                ["Last login", fmtDateTime(u.last_login)],
              ].map(([l, v]) => (
                <div key={l} className="col-12 col-md-6 d-flex gap-2 mb-1">
                  <dt className="text-muted fw-normal" style={{ minWidth: "8rem" }}>{l}</dt>
                  <dd className="mb-0 fw-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <button className="btn btn-outline-secondary btn-sm" disabled={accBusy} onClick={doUnlink}>
              <i className="bi bi-link-45deg me-1" style={{ textDecoration: "line-through" }}></i>Unlink account
            </button>
          </>
        ) : (
          <>
            <p className="form-text-hint">No user account is linked. Link an existing one, or create a new login.</p>
            <label className="form-label">Link to an existing account</label>
            <div className="d-flex gap-2 flex-wrap mb-3">
              <select className="form-select" style={{ maxWidth: 380 }} value={linkUserId}
                onChange={(e) => setLinkUserId(e.target.value)}>
                <option value="">Select account...</option>
                {availableUsers.map((x) => (
                  <option key={x.id} value={x.id}>{`${x.full_name || x.username} (${x.username}) — ${x.role}`}</option>
                ))}
              </select>
              <button className="btn btn-success" disabled={!linkUserId || accBusy} onClick={doLink}>Link account</button>
            </div>
            {availableUsers.length === 0 && <div className="form-text-hint">No unlinked staff accounts available.</div>}
            <hr />
            <button className="btn btn-outline-primary" disabled={accBusy} onClick={doCreateLogin}>
              <i className="bi bi-key me-1"></i>Create new login
            </button>
          </>
        )}
      </>
    );
  };

  const renderers = { overview: renderOverview, attendance: renderAttendance, payroll: renderPayroll, leave: renderLeave, teaching: renderTeaching, account: renderAccount };

  const initials = (ov?.full_name || "").split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("");

  return (
    <Modal show={show} onClose={onClose} title="Employee Details" subtitle="Complete 360° view of this employee" icon="bi-person-vcard" size="xl">
      <div className="row g-3">
        <div className="col-md-4 col-lg-3">
          <div className="border rounded p-3 text-center h-100">
            <div className="avatar-sm mx-auto mb-2" style={{ width: "5rem", height: "5rem", fontSize: "1.6rem" }}>
              {initials || <i className="bi bi-person"></i>}
            </div>
            <h6 className="fw-bold mb-0">{ov?.full_name || "Loading..."}</h6>
            <div className="cell-mono text-brand">{ov?.employee_no}</div>
            {ov?.status && <span className="badge badge-neutral mt-2">{ov.status}</span>}
            {ov && (
              <ul className="list-unstyled text-start small mt-3 mb-0">
                <li className="mb-1"><i className="bi bi-briefcase me-2"></i>{ov.position_title || "No position"}</li>
                <li className="mb-1"><i className="bi bi-diagram-3 me-2"></i>{ov.department_name || "No department"}</li>
                {ov.phone && <li className="mb-1"><i className="bi bi-telephone me-2"></i>{ov.phone}</li>}
                {ov.email && <li className="mb-1" style={{ overflowWrap: "anywhere" }}><i className="bi bi-envelope me-2"></i>{ov.email}</li>}
                <li><i className="bi bi-link-45deg me-2"></i>{ov.linked_user ? ov.linked_user.username : "No account linked"}</li>
              </ul>
            )}
          </div>
        </div>

        <div className="col-md-8 col-lg-9">
          <ul className="nav nav-tabs mb-3 flex-nowrap" style={{ overflowX: "auto" }}>
            {tabs.map(([key, text, icon]) => (
              <li className="nav-item" key={key}>
                <button type="button" className={`nav-link text-nowrap ${tab === key ? "active" : ""}`}
                  onClick={() => { setTab(key); setEditing(false); }}>
                  <i className={`bi ${icon} me-1`}></i>{text}
                </button>
              </li>
            ))}
          </ul>

          {flash && (
            <div className={`alert alert-${flash.type} alert-dismissible py-2`}>
              {flash.text}
              <button type="button" className="btn-close" onClick={() => setFlash(null)}></button>
            </div>
          )}
          {err && !data && <div className="alert alert-danger py-2">{err}</div>}

          {busy ? <Spinner /> : tab === "overview" ? renderOverview() : data ? renderers[tab]() : null}
        </div>
      </div>
    </Modal>
  );
}