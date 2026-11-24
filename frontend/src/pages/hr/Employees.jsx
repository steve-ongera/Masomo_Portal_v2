import { Fragment, useEffect, useState, useCallback } from "react";
import { hrApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import Modal from "../../components/Modal";

const CATEGORY = {
  TEACHER: "Teacher",
  ADMINISTRATION: "Administration",
  ACCOUNTS: "Accounts",
  ICT: "ICT",
  SUPPORT: "Support staff",
};

const EMPLOYMENT_TYPE = {
  PERMANENT: "Permanent",
  CONTRACT: "Contract",
  PROBATION: "Probation",
  CASUAL: "Casual",
};

const STATUS_META = {
  ACTIVE: { badge: "badge-success", dot: "status-dot--online", label: "Active" },
  PROBATION: { badge: "badge-warning", dot: "status-dot--pending", label: "Probation" },
  SUSPENDED: { badge: "badge-warning", dot: "status-dot--pending", label: "Suspended" },
  EXITED: { badge: "badge-neutral", dot: "status-dot--offline", label: "Exited" },
};

// account_mode: "none"   = no login yet (can be linked later)
//               "link"   = link to an EXISTING user account (admin, HR, teacher...)
//               "create" = create a brand-new login right after saving
const blank = {
  first_name: "",
  last_name: "",
  gender: "M",
  national_id: "",
  phone: "",
  email: "",
  category: "TEACHER",
  employment_type: "PERMANENT",
  department: "",
  position: "",
  account_mode: "none",
  user_id: "",
};

const errorDetail = (err, fallback) => {
  const data = err.response?.data;
  return (
    data?.detail ||
    (data && typeof data === "object" ? Object.values(data).flat().join(" ") : null) ||
    fallback
  );
};

// =====================================================================
// EMPLOYEE 360 PROFILE (used by the Employees page below)
// =====================================================================
const ATT_BADGE = {
  PRESENT: "badge-success", LATE: "badge-warning", EARLY_DEPARTURE: "badge-warning",
  ABSENT: "badge-danger", ON_LEAVE: "badge-blue", OFF_DUTY: "badge-neutral",
};
const ATT_LABEL = {
  PRESENT: "Present", LATE: "Late", EARLY_DEPARTURE: "Early departure",
  ABSENT: "Absent", ON_LEAVE: "On leave", OFF_DUTY: "Off duty",
};
const LEAVE_BADGE = { PENDING: "badge-warning", APPROVED: "badge-success", REJECTED: "badge-danger", CANCELLED: "badge-neutral" };
const STATUS_BADGE = { ACTIVE: "badge-success", ON_LEAVE: "badge-blue", SUSPENDED: "badge-warning", EXITED: "badge-neutral" };

const kes = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "-");
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";
const fmtTime = (t) => (t ? t.slice(0, 5) : "-");
const monthLabel = (p) => {
  const [y, mo] = p.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-KE", { month: "long", year: "numeric" });
};

function Empty({ text }) { return <p className="form-text-hint">{text}</p>; }
function Spinner() { return <div className="text-center py-4"><span className="spinner-border spinner-border-sm me-2"></span>Loading...</div>; }
function Section({ children }) { return <h6 className="fw-bold mt-4 mb-2 pb-1 border-bottom">{children}</h6>; }

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

function Field({ label, value }) {
  return (
    <div className="col-12 col-md-6 d-flex gap-2 mb-2">
      <div className="text-muted" style={{ minWidth: "9.5rem" }}>{label}</div>
      <div className="fw-medium" style={{ overflowWrap: "anywhere" }}>{value === null || value === undefined || value === "" ? "-" : value}</div>
    </div>
  );
}

const DATE_KEYS = ["date_of_birth", "contract_end_date"];

function EmployeeProfileModal({ show, employeeId, onClose, onChanged, depts = [], positions = [] }) {
  const [tab, setTab] = useState("overview");
  const [sections, setSections] = useState({});
  const [loadingKey, setLoadingKey] = useState(null);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState(null);

  // per-tab filters
  const [attFrom, setAttFrom] = useState("");
  const [attTo, setAttTo] = useState("");
  const [payYear, setPayYear] = useState("");
  const [leaveYear, setLeaveYear] = useState("");
  const [teachYear, setTeachYear] = useState("");
  const [openSlip, setOpenSlip] = useState(null);

  // edit
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  // account
  const [availableUsers, setAvailableUsers] = useState([]);
  const [linkUserId, setLinkUserId] = useState("");
  const [accBusy, setAccBusy] = useState(false);
  const [loginResult, setLoginResult] = useState(null);

  const paramsFor = (t) => {
    if (t === "attendance") return { from: attFrom || undefined, to: attTo || undefined };
    if (t === "payroll") return payYear ? { year: payYear } : {};
    if (t === "leave") return leaveYear ? { year: leaveYear } : {};
    if (t === "teaching") return teachYear ? { academic_year: teachYear } : {};
    return {};
  };
  const keyFor = (t) => t + JSON.stringify(paramsFor(t));

  const load = useCallback(async (t) => {
    const k = keyFor(t);
    setLoadingKey(k);
    setErr("");
    try {
      const { data } = await hrApi.employees.view360(employeeId, t, paramsFor(t));
      setSections((s) => ({ ...s, [k]: data }));
    } catch (e) {
      setErr(errorDetail(e, "Could not load this section."));
    } finally {
      setLoadingKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, attFrom, attTo, payYear, leaveYear, teachYear]);

  useEffect(() => {
    if (!show) {
      setSections({}); setFlash(null); setErr(""); setEditing(false); setLoginResult(null);
      setAttFrom(""); setAttTo(""); setPayYear(""); setLeaveYear(""); setTeachYear(""); setOpenSlip(null);
      return;
    }
    setTab("overview");
  }, [show, employeeId]);

  useEffect(() => {
    if (show && employeeId && !sections[keyFor(tab)]) load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, employeeId, tab, attFrom, attTo, payYear, leaveYear, teachYear]);

  const ov = sections[keyFor("overview")];
  const data = sections[keyFor(tab)];
  const busy = loadingKey === keyFor(tab) && !data;
  const p = ov?.profile;

  useEffect(() => {
    if (show && tab === "account" && data && !data.linked) {
      hrApi.employees.availableUsers().then((r) => setAvailableUsers(r.data)).catch(() => setAvailableUsers([]));
    }
  }, [show, tab, data]);

  const reloadAll = () => {
    setSections({});
    load("overview");
    if (tab !== "overview") load(tab);
    onChanged?.();
  };

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
    setForm({
      first_name: p.first_name, last_name: p.last_name, gender: p.gender,
      date_of_birth: p.date_of_birth || "", national_id: p.national_id,
      phone: p.phone || "", email: p.email || "", address: p.address || "", emergency_contact: p.emergency_contact || "",
      category: p.category, employment_type: p.employment_type,
      department: p.department || "", position: p.position || "",
      date_joined: p.date_joined || "", contract_end_date: p.contract_end_date || "",
      kra_pin: p.kra_pin || "", nssf_no: p.nssf_no || "", sha_no: p.sha_no || "",
      bank_name: p.bank_name || "", bank_account: p.bank_account || "",
    });
    setEditing(true);
  };
  const setF = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const saveEdit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, department: form.department || null, position: form.position || null };
      DATE_KEYS.forEach((k) => { payload[k] = form[k] || null; });
      if (!form.date_joined) delete payload.date_joined;
      await hrApi.employees.update(employeeId, payload);
      setFlash({ type: "success", text: "Employee details updated." });
      setEditing(false);
      reloadAll();
    } catch (ex) {
      setFlash({ type: "danger", text: errorDetail(ex, "Could not update the employee.") });
    } finally {
      setSaving(false);
    }
  };

  // ---------------- account actions ----------------
  const accAction = async (fn, okText, failText) => {
    setAccBusy(true);
    try { await fn(); if (okText) setFlash({ type: "success", text: okText }); reloadAll(); }
    catch (ex) { setFlash({ type: "danger", text: errorDetail(ex, failText) }); }
    finally { setAccBusy(false); }
  };
  const doLink = () => accAction(() => hrApi.employees.update(employeeId, { user_id: linkUserId }), "Account linked.", "Could not link the account.");
  const doUnlink = () => {
    if (!window.confirm("Unlink this account from the employee? The account itself is not deleted.")) return;
    accAction(() => hrApi.employees.unlinkUser(employeeId), "Account unlinked.", "Could not unlink.");
  };
  const doCreateLogin = () =>
    accAction(async () => {
      const { data: res } = await hrApi.employees.createLogin(employeeId);
      setLoginResult({ username: res.username, initial_password: res.initial_password });
    }, null, "Could not create the login.");

  // ---------------- tabs ----------------
  const renderOverview = () => {
    if (!ov) return <Spinner />;

    if (editing && form) {
      const inp = (label, key, extra = {}, col = "col-md-6") => (
        <div className={col}>
          <label className="form-label">{label}</label>
          <input className="form-control" value={form[key]} onChange={setF(key)} {...extra} />
        </div>
      );
      return (
        <form onSubmit={saveEdit}>
          <Section>Personal details</Section>
          <div className="row g-3">
            {inp("First name", "first_name", { required: true })}
            {inp("Last name", "last_name", { required: true })}
            <div className="col-md-4"><label className="form-label">Gender</label>
              <select className="form-select" value={form.gender} onChange={setF("gender")}>
                <option value="M">Male</option><option value="F">Female</option></select></div>
            {inp("Date of birth", "date_of_birth", { type: "date" }, "col-md-4")}
            {inp("National ID", "national_id", { required: true }, "col-md-4")}
            {inp("Phone", "phone")}
            {inp("Email", "email", { type: "email" })}
            {inp("Address", "address", {}, "col-12")}
            {inp("Emergency contact", "emergency_contact", { placeholder: "Name and phone" }, "col-12")}
          </div>

          <Section>Employment</Section>
          <div className="row g-3">
            <div className="col-md-6"><label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={setF("category")}>
                {Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="col-md-6"><label className="form-label">Employment type</label>
              <select className="form-select" value={form.employment_type} onChange={setF("employment_type")}>
                {Object.entries(EMPLOYMENT_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="col-md-6"><label className="form-label">Department</label>
              <select className="form-select" value={form.department} onChange={setF("department")}>
                <option value="">No department</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div className="col-md-6"><label className="form-label">Position</label>
              <select className="form-select" value={form.position} onChange={setF("position")}>
                <option value="">No position</option>
                {positions.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></div>
            {inp("Date joined", "date_joined", { type: "date" })}
            {inp("Contract end date", "contract_end_date", { type: "date" })}
          </div>

          <Section>Statutory &amp; bank</Section>
          <div className="row g-3">
            {inp("KRA PIN", "kra_pin")}
            {inp("NSSF no", "nssf_no")}
            {inp("SHA no", "sha_no")}
            {inp("Bank name", "bank_name")}
            {inp("Bank account", "bank_account")}
          </div>
          <div className="form-text-hint mt-2">Status changes use "Record exit" in the list. Login links are managed in the Account tab.</div>

          <div className="mt-3 pt-3 border-top d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-success" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
          </div>
        </form>
      );
    }

    const att = ov.stats.attendance_this_month || {};
    const slip = ov.stats.latest_payslip;
    return (
      <>
        <div className="d-flex justify-content-between align-items-center">
          <h6 className="fw-bold mb-0">Employee profile</h6>
          <button className="btn btn-sm btn-outline-primary" onClick={startEdit}>
            <i className="bi bi-pencil me-1"></i>Edit details
          </button>
        </div>

        <div className="row g-2 mt-1">
          <Stat title="Present/Late this month" value={(att.PRESENT || 0) + (att.LATE || 0)} />
          <Stat title="Absent this month" value={att.ABSENT || 0} tone={att.ABSENT ? "text-danger" : ""} />
          <Stat title="Pending leave" value={ov.stats.pending_leave} />
          <Stat title="Latest net pay" value={slip ? kes(slip.net) : "-"} />
        </div>

        <Section>Personal details</Section>
        <div className="row">
          <Field label="Full name" value={p.full_name} />
          <Field label="Employee no" value={p.employee_no} />
          <Field label="Gender" value={p.gender_display} />
          <Field label="Date of birth" value={p.date_of_birth ? `${fmtDate(p.date_of_birth)}${p.age !== null ? ` (Age ${p.age})` : ""}` : "-"} />
          <Field label="National ID" value={p.national_id} />
          <Field label="Phone" value={p.phone} />
          <Field label="Email" value={p.email} />
          <Field label="Address" value={p.address} />
          <Field label="Emergency contact" value={p.emergency_contact} />
        </div>

        <Section>Employment</Section>
        <div className="row">
          <Field label="Category" value={p.category_display} />
          <Field label="Employment type" value={p.employment_type_display} />
          <Field label="Department" value={p.department_name} />
          <Field label="Position" value={p.position_title} />
          <Field label="Reports to" value={p.manager_name} />
          <Field label="Date joined" value={`${fmtDate(p.date_joined)}${p.years_of_service !== null ? ` (${p.years_of_service} yrs)` : ""}`} />
          <Field label="Contract ends" value={p.contract_end_date
            ? `${fmtDate(p.contract_end_date)}${p.contract_days_left !== null ? (p.contract_days_left < 0 ? " (expired)" : ` (${p.contract_days_left} days left)`) : ""}`
            : "-"} />
          <Field label="Status" value={<span className={`badge ${STATUS_BADGE[p.status] || "badge-neutral"}`}>{p.status_display}</span>} />
          {p.status === "EXITED" && <Field label="Exit" value={`${fmtDate(p.exit_date)} - ${p.exit_reason || "no reason recorded"}`} />}
        </div>

        <Section>Statutory &amp; bank</Section>
        <div className="row">
          <Field label="KRA PIN" value={p.kra_pin} />
          <Field label="NSSF no" value={p.nssf_no} />
          <Field label="SHA no" value={p.sha_no} />
          <Field label="Bank" value={p.bank_name} />
          <Field label="Bank account" value={p.bank_account} />
        </div>
      </>
    );
  };

  const renderAttendance = () => {
    const s = data.summary || {};
    return (
      <>
        <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
          <div><label className="form-label small mb-1">From</label>
            <input type="date" className="form-control form-control-sm" value={attFrom || data.from} onChange={(e) => setAttFrom(e.target.value)} /></div>
          <div><label className="form-label small mb-1">To</label>
            <input type="date" className="form-control form-control-sm" value={attTo || data.to} onChange={(e) => setAttTo(e.target.value)} /></div>
        </div>
        <div className="row g-2 mb-3">
          <Stat title="Attendance rate" value={data.attendance_rate !== null ? `${data.attendance_rate}%` : "-"} />
          <Stat title="Present" value={s.PRESENT || 0} tone="text-success" />
          <Stat title="Late" value={s.LATE || 0} />
          <Stat title="Absent" value={s.ABSENT || 0} tone={s.ABSENT ? "text-danger" : ""} />
        </div>
        {data.rows.length === 0 ? <Empty text="No attendance records in this period." /> : (
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th className="text-end">Hours</th><th>Source</th><th>Remarks</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.date)}</td>
                    <td><span className={`badge ${ATT_BADGE[r.status] || "badge-neutral"}`}>{ATT_LABEL[r.status] || r.status_display}</span>
                      {r.flagged && <i className="bi bi-flag-fill text-danger ms-1" title="Flagged"></i>}</td>
                    <td>{fmtTime(r.check_in)}</td><td>{fmtTime(r.check_out)}</td>
                    <td className="text-end">{r.hours ?? "-"}</td>
                    <td>{r.source}</td><td>{r.remarks || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Section>Scan device &amp; recent scans</Section>
        <p className="small mb-2">
          {data.device ? <>Phone registered on {fmtDateTime(data.device.bound_at)}.</> : "No phone registered yet."}
        </p>
        {data.recent_scans.length === 0 ? <Empty text="No scans yet." /> : (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>When</th><th>Result</th><th className="text-end">Distance</th><th>Note</th></tr></thead>
              <tbody>
                {data.recent_scans.map((x) => (
                  <tr key={x.id}>
                    <td>{fmtDateTime(x.at)}</td>
                    <td><span className={`badge ${x.kind === "FAIL" ? "badge-danger" : "badge-success"}`}>{x.kind}</span></td>
                    <td className="text-end">{x.distance_m !== null ? `${x.distance_m} m` : "-"}</td>
                    <td>{x.note || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  const renderPayroll = () => {
    const sal = data.salary;
    const t = data.totals;
    return (
      <>
        <h6 className="fw-bold">Salary structure</h6>
        {sal ? (
          <div className="row g-2">
            <Stat title="Basic" value={kes(sal.basic)} />
            <Stat title="House allowance" value={kes(sal.house_allowance)} />
            <Stat title="Transport allowance" value={kes(sal.transport_allowance)} />
            <Stat title="Other allowance" value={kes(sal.other_allowance)} />
            <Stat title="Gross (monthly)" value={kes(sal.gross)} tone="text-brand" />
          </div>
        ) : <Empty text="No salary structure set up yet. This employee is skipped when payroll is generated." />}

        <Section>Recurring deductions</Section>
        {data.deductions.length === 0 ? <Empty text="None." /> : (
          <ul className="list-unstyled mb-0">
            {data.deductions.map((d) => (
              <li key={d.id} className="d-flex justify-content-between border-bottom py-1">
                <span>{d.name} {!d.active && <span className="badge badge-neutral ms-1">Inactive</span>}</span>
                <strong>{kes(d.amount)}</strong>
              </li>
            ))}
          </ul>
        )}

        <Section>Payslips</Section>
        <div className="d-flex align-items-center gap-2 mb-2">
          <label className="form-label mb-0 small">Year</label>
          <select className="form-select form-select-sm" style={{ maxWidth: 140 }} value={payYear} onChange={(e) => setPayYear(e.target.value)}>
            <option value="">All (latest 36)</option>
            {data.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="row g-2 mb-3">
          <Stat title={`Gross (${data.payslip_count} released)`} value={kes(t.gross)} />
          <Stat title="PAYE" value={kes(t.paye)} />
          <Stat title="NSSF + SHIF + Housing" value={kes(Number(t.nssf) + Number(t.shif) + Number(t.housing_levy))} />
          <Stat title="Net pay" value={kes(t.net)} tone="text-success" />
        </div>
        {data.payslips.length === 0 ? <Empty text="No payslips yet." /> : (
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead><tr><th>Month</th><th>Run</th><th className="text-end">Gross</th><th className="text-end">PAYE</th>
                <th className="text-end">NSSF</th><th className="text-end">SHIF</th><th className="text-end">Housing</th>
                <th className="text-end">Other</th><th className="text-end">Net</th><th></th></tr></thead>
              <tbody>
                {data.payslips.map((sl) => (
                  <Fragment key={sl.id}>
                    <tr>
                      <td>{monthLabel(sl.period)}{sl.breakdown?.edited && <span className="badge badge-gold ms-1">Edited</span>}</td>
                      <td><span className={`badge ${sl.run_status === "PAID" ? "badge-success" : sl.run_status === "APPROVED" ? "badge-blue" : "badge-neutral"}`}>{sl.run_status}</span></td>
                      <td className="text-end">{kes(sl.gross)}</td><td className="text-end">{kes(sl.paye)}</td>
                      <td className="text-end">{kes(sl.nssf)}</td><td className="text-end">{kes(sl.shif)}</td>
                      <td className="text-end">{kes(sl.housing_levy)}</td><td className="text-end">{kes(sl.other_deductions)}</td>
                      <td className="text-end fw-semibold">{kes(sl.net)}</td>
                      <td><button className="btn btn-sm btn-light" onClick={() => setOpenSlip(openSlip === sl.id ? null : sl.id)}>
                        <i className={`bi bi-chevron-${openSlip === sl.id ? "up" : "down"}`}></i></button></td>
                    </tr>
                    {openSlip === sl.id && (
                      <tr><td colSpan={10} className="bg-light">
                        <div className="row small">
                          <div className="col-md-6">
                            <strong>Earnings</strong>
                            {Object.entries(sl.breakdown?.earnings || {}).map(([k, v]) => (
                              <div key={k} className="d-flex justify-content-between"><span>{k}</span><span>{kes(v)}</span></div>
                            ))}
                            <div className="d-flex justify-content-between text-muted"><span>Taxable pay</span><span>{kes(sl.breakdown?.taxable_pay)}</span></div>
                          </div>
                          <div className="col-md-6">
                            <strong>Other deductions</strong>
                            {(sl.breakdown?.deductions || []).length === 0 ? <div className="text-muted">None</div> :
                              sl.breakdown.deductions.map((d, i) => (
                                <div key={i} className="d-flex justify-content-between"><span>{d.name}</span><span>{kes(d.amount)}</span></div>
                              ))}
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  const renderLeave = () => (
    <>
      <div className="d-flex align-items-center gap-2 mb-2">
        <label className="form-label mb-0 small">Balances for</label>
        <input type="number" className="form-control form-control-sm" style={{ maxWidth: 100 }}
          value={leaveYear || data.year} onChange={(e) => setLeaveYear(e.target.value)} />
      </div>
      <div className="table-responsive mb-3">
        <table className="table table-sm">
          <thead><tr><th>Leave type</th><th>Paid</th><th className="text-end">Entitled</th><th className="text-end">Used</th><th className="text-end">Remaining</th></tr></thead>
          <tbody>
            {data.balances.map((b) => (
              <tr key={b.leave_type}>
                <td>{b.name}</td><td>{b.is_paid ? "Yes" : "No"}</td>
                <td className="text-end">{b.entitled}</td><td className="text-end">{b.used}</td>
                <td className={`text-end fw-semibold ${b.remaining <= 0 ? "text-danger" : "text-success"}`}>{b.remaining}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h6 className="fw-bold">Requests</h6>
      {data.requests.length === 0 ? <Empty text="No leave requests." /> : (
        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead><tr><th>Type</th><th>From</th><th>To</th><th className="text-end">Days</th><th>Status</th><th>Reason</th><th>Review</th></tr></thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.leave_type_name}</td><td>{fmtDate(r.start_date)}</td><td>{fmtDate(r.end_date)}</td>
                  <td className="text-end">{r.days}</td>
                  <td><span className={`badge ${LEAVE_BADGE[r.status] || "badge-neutral"}`}>{r.status_display}</span></td>
                  <td>{r.reason || "-"}</td>
                  <td className="small">{r.reviewed_by_name ? `${r.reviewed_by_name}${r.review_remarks ? ` - ${r.review_remarks}` : ""}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  const renderTeaching = () => {
    if (!data.linked) return <Empty text={data.detail} />;
    return (
      <>
        <div className="row g-2 mb-3">
          <Stat title="Class teacher now" value={data.is_class_teacher_now ? "Yes" : "No"} tone={data.is_class_teacher_now ? "text-success" : ""} />
          <Stat title="Ever class teacher" value={data.ever_class_teacher ? "Yes" : "No"} />
          <Stat title="Subjects (selected year)" value={data.allocations.length} />
          <Stat title="Periods / week" value={data.total_periods_per_week} />
        </div>
        <div className="d-flex align-items-center gap-2 mb-2">
          <label className="form-label mb-0">Academic year</label>
          <select className="form-select" style={{ maxWidth: 320 }} value={teachYear || data.selected_academic_year || ""}
            onChange={(e) => setTeachYear(e.target.value)}>
            {data.academic_years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.year}{y.is_current ? " (current)" : ""} - {y.allocations} allocation{y.allocations !== 1 ? "s" : ""}{y.class_teacher ? " - class teacher" : ""}
              </option>
            ))}
          </select>
        </div>

        <Section>Subject allocations</Section>
        {data.allocations.length === 0 ? <Empty text="No subjects allocated in this year." /> : (
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead><tr><th>Subject</th><th>Class</th><th>Grade</th><th className="text-end">Periods/wk</th><th>Double</th></tr></thead>
              <tbody>
                {data.allocations.map((a) => (
                  <tr key={a.id}>
                    <td>{a.subject} <span className="text-muted small">({a.subject_code})</span></td>
                    <td>{a.classroom}</td><td>{a.grade_level}</td>
                    <td className="text-end">{a.periods_per_week}</td><td>{a.double_lesson ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Section>Class teacher history</Section>
        {data.class_teacher_history.length === 0 ? <Empty text="Has never been a class teacher." /> : (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead><tr><th>Year</th><th>Class</th><th className="text-end">Active students</th><th></th></tr></thead>
              <tbody>
                {data.class_teacher_history.map((c) => (
                  <tr key={c.id}>
                    <td>{c.academic_year}</td><td>{c.classroom}</td><td className="text-end">{c.students}</td>
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
            Login created. Username <code>{loginResult.username}</code>, initial password <code>{loginResult.initial_password}</code>
            <div className="form-text-hint mb-0">Share securely. It won't be shown again.</div>
          </div>
        )}
        {u ? (
          <>
            <div className="row">
              <Field label="Username" value={u.username} />
              <Field label="Name" value={u.full_name} />
              <Field label="Role" value={u.role_display} />
              <Field label="Email" value={u.email} />
              <Field label="Phone" value={u.phone_number} />
              <Field label="Can log in" value={u.can_log_in ? "Yes" : "No"} />
              <Field label="Locked out" value={u.locked ? "Yes" : "No"} />
              <Field label="Last login" value={fmtDateTime(u.last_login)} />
            </div>
            <button className="btn btn-outline-secondary btn-sm mt-2" disabled={accBusy} onClick={doUnlink}>
              <i className="bi bi-link-45deg me-1" style={{ textDecoration: "line-through" }}></i>Unlink account
            </button>
          </>
        ) : (
          <>
            <p className="form-text-hint">No user account is linked. Link an existing one, or create a new login.</p>
            <label className="form-label">Link to an existing account</label>
            <div className="d-flex gap-2 flex-wrap mb-2">
              <select className="form-select" style={{ maxWidth: 400 }} value={linkUserId} onChange={(e) => setLinkUserId(e.target.value)}>
                <option value="">Select account...</option>
                {availableUsers.map((x) => <option key={x.id} value={x.id}>{`${x.full_name || x.username} (${x.username}) — ${x.role}`}</option>)}
              </select>
              <button className="btn btn-success" disabled={!linkUserId || accBusy} onClick={doLink}>Link account</button>
            </div>
            {availableUsers.length === 0 && <div className="form-text-hint">No unlinked staff accounts available.</div>}
            <hr />
            {data.can_create_login ? (
              <button className="btn btn-outline-primary" disabled={accBusy} onClick={doCreateLogin}>
                <i className="bi bi-key me-1"></i>Create new login
              </button>
            ) : <div className="form-text-hint">A new login can't be created for this employee (exited, or no login role for this category). Link an existing account instead.</div>}
          </>
        )}
      </>
    );
  };

  const renderers = { overview: renderOverview, attendance: renderAttendance, payroll: renderPayroll, leave: renderLeave, teaching: renderTeaching, account: renderAccount };
  const initials = (p?.full_name || "").split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("");

  return (
    <Modal show={show} onClose={onClose} title="Employee Details" subtitle="Complete 360° view of this employee" icon="bi-person-vcard" size="xl">
      <div className="row g-3">
        <div className="col-md-4 col-lg-3">
          <div className="border rounded p-3 text-center h-100">
            <div className="avatar-sm mx-auto mb-2" style={{ width: "5rem", height: "5rem", fontSize: "1.6rem" }}>
              {initials || <i className="bi bi-person"></i>}
            </div>
            <h6 className="fw-bold mb-0">{p?.full_name || "Loading..."}</h6>
            <div className="cell-mono text-brand">{p?.employee_no}</div>
            {p && <span className={`badge mt-2 ${STATUS_BADGE[p.status] || "badge-neutral"}`}>{p.status_display}</span>}
            {p && (
              <ul className="list-unstyled text-start small mt-3 mb-0">
                <li className="mb-1"><i className="bi bi-briefcase me-2"></i>{p.position_title || "No position"}</li>
                <li className="mb-1"><i className="bi bi-diagram-3 me-2"></i>{p.department_name || "No department"}</li>
                <li className="mb-1"><i className="bi bi-person-badge me-2"></i>{p.category_display} · {p.employment_type_display}</li>
                {p.phone && <li className="mb-1"><i className="bi bi-telephone me-2"></i>{p.phone}</li>}
                {p.email && <li className="mb-1" style={{ overflowWrap: "anywhere" }}><i className="bi bi-envelope me-2"></i>{p.email}</li>}
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

          {busy ? <Spinner /> : data ? renderers[tab]() : null}
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// EMPLOYEES PAGE
// =====================================================================
export default function Employees() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [depts, setDepts] = useState([]);
  const [positions, setPositions] = useState([]);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("info");

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const [showExitModal, setShowExitModal] = useState(false);
  const [exitTarget, setExitTarget] = useState(null);
  const [exitReason, setExitReason] = useState("");
  const [exitSaving, setExitSaving] = useState(false);

  const [loginResult, setLoginResult] = useState(null);

  // ---- 360 profile modal ----
  const [profileId, setProfileId] = useState(null);

  // ---- user accounts that can still be linked to an employee ----
  const [availableUsers, setAvailableUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // ---- "Link account" modal (for employees that already exist) ----
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkUserId, setLinkUserId] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (searchQuery) params.search = searchQuery;
      const { data } = await hrApi.employees.list(params);
      setRows(data.results ?? data);
    } catch {
      setMsg("Could not load employees.");
      setMsgType("danger");
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    hrApi.departments.list().then((r) => setDepts(r.data.results ?? r.data)).catch(() => {});
    hrApi.positions.list().then((r) => setPositions(r.data.results ?? r.data)).catch(() => {});
  }, []);

  const loadAvailableUsers = async () => {
    setUsersLoading(true);
    try {
      const { data } = await hrApi.employees.availableUsers();
      setAvailableUsers(data);
    } catch {
      setAvailableUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  const hasActiveFilters = !!searchInput;

  const clearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  const setField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const openAdd = () => {
    setForm({ ...blank });
    setShowAddModal(true);
    loadAvailableUsers();
  };

  const userLabel = (u) => `${u.full_name || u.username} (${u.username}) — ${u.role}`;

  const save = async (e) => {
    e.preventDefault();
    if (form.account_mode === "link" && !form.user_id) {
      setMsg("Choose the user account to link, or pick another account option.");
      setMsgType("danger");
      return;
    }
    setSaving(true);
    try {
      const { account_mode, user_id, ...rest } = form;
      const payload = {
        ...rest,
        department: form.department || null,
        position: form.position || null,
      };
      if (account_mode === "link") payload.user_id = user_id;

      const { data: created } = await hrApi.employees.create(payload);
      setShowAddModal(false);
      setForm(blank);

      if (account_mode === "create") {
        // saved first, then the login is created exactly like the existing "Create login" button
        setMsg("Employee added successfully.");
        setMsgType("success");
        await giveLogin(created);
      } else {
        setMsg(
          account_mode === "link"
            ? "Employee added and linked to the user account. They can now see their payslips."
            : "Employee added successfully."
        );
        setMsgType("success");
        await load();
      }
    } catch (err) {
      setMsg(errorDetail(err, "Could not save the employee."));
      setMsgType("danger");
    } finally {
      setSaving(false);
    }
  };

  const giveLogin = async (employee) => {
    try {
      const { data } = await hrApi.employees.createLogin(employee.id);
      setLoginResult({
        employee_name: employee.full_name,
        employee_no: employee.employee_no,
        username: data.username,
        initial_password: data.initial_password,
      });
      await load();
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not create the login.");
      setMsgType("danger");
      await load();
    }
  };

  // ---------------- link an existing employee to an existing account ----------------
  const openLink = (employee) => {
    setLinkTarget(employee);
    setLinkUserId("");
    setShowLinkModal(true);
    loadAvailableUsers();
  };

  const confirmLink = async (e) => {
    e.preventDefault();
    if (!linkTarget || !linkUserId) return;
    setLinkSaving(true);
    try {
      await hrApi.employees.update(linkTarget.id, { user_id: linkUserId });
      setMsg(`${linkTarget.full_name} is now linked to the account. They can see their payslips.`);
      setMsgType("success");
      setShowLinkModal(false);
      await load();
    } catch (err) {
      setMsg(errorDetail(err, "Could not link the account."));
      setMsgType("danger");
    } finally {
      setLinkSaving(false);
    }
  };

  const unlink = async (employee) => {
    if (!window.confirm(`Unlink ${employee.full_name} from account "${employee.linked_username}"? The account itself is not deleted.`)) {
      return;
    }
    try {
      await hrApi.employees.unlinkUser(employee.id);
      setMsg("Account unlinked. The employee record is unchanged.");
      setMsgType("success");
      await load();
    } catch (err) {
      setMsg(errorDetail(err, "Could not unlink the account."));
      setMsgType("danger");
    }
  };

  const openExit = (employee) => {
    setExitTarget(employee);
    setExitReason("");
    setShowExitModal(true);
  };

  const confirmExit = async (e) => {
    e.preventDefault();
    if (!exitTarget) return;
    setExitSaving(true);
    try {
      await hrApi.employees.exit(exitTarget.id, { reason: exitReason.trim() });
      setMsg("Employee marked as exited. Records are kept.");
      setMsgType("success");
      setShowExitModal(false);
      await load();
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not record the exit.");
      setMsgType("danger");
      setShowExitModal(false);
    } finally {
      setExitSaving(false);
    }
  };

  const totalEmployees = rows.length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">All staff on the payroll register</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            <i className="bi bi-plus-lg"></i>
            Add Employee
          </button>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show`} role="alert">
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0" style={{ width: "100%" }}>
            <div className="toolbar__search" style={{ maxWidth: "none" }}>
              <i className="bi bi-search"></i>
              <input
                type="text"
                className="form-control"
                placeholder="Search name or employee no..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            {hasActiveFilters && (
              <button className="btn btn-sm btn-light" onClick={clearFilters}>
                <i className="bi bi-x-lg"></i> Clear
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <div className="chip-row p-0 border-0">
              {searchQuery && (
                <span className="filter-chip">
                  Search: "{searchQuery}"
                  <button onClick={() => setSearchInput("")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title mb-0">
              <i className="bi bi-person-vcard me-2 text-brand"></i>
              Employee List
            </span>
            <span className="chart-card__subtitle mb-0">
              {totalEmployees} employee{totalEmployees !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={10} columns={9} />
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-person-vcard"></i>
            <h6>{hasActiveFilters ? "No employees match your search" : "No employees yet"}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters
                ? "Try adjusting your search"
                : "Click 'Add Employee' to create the first record"}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Employee No</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Category</th>
                  <th>Department</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th style={{ width: "290px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const statusMeta = STATUS_META[r.status] || {
                    badge: "badge-neutral",
                    dot: "status-dot--offline",
                    label: r.status,
                  };
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className="cell-mono text-brand fw-semibold">
                          {r.employee_no}
                        </span>
                      </td>
                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">
                            {(r.full_name || "")
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <button
                            type="button"
                            className="btn btn-link p-0 cell-name text-start"
                            title="View full profile"
                            onClick={() => setProfileId(r.id)}
                          >
                            {r.full_name}
                          </button>
                        </div>
                      </td>
                      <td className="text-nowrap">
                        {r.phone ? (
                          <a href={`tel:${r.phone}`} className="text-decoration-none">
                            <i className="bi bi-telephone me-1 text-muted"></i>
                            {r.phone}
                          </a>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td style={{ overflowWrap: "anywhere", minWidth: "180px" }}>
                        {r.email ? (
                          <a href={`mailto:${r.email}`} className="text-decoration-none">
                            <i className="bi bi-envelope me-1 text-muted"></i>
                            {r.email}
                          </a>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-blue">
                          {CATEGORY[r.category] || r.category}
                        </span>
                      </td>
                      <td>{r.department_name || <span className="cell-muted">—</span>}</td>
                      <td>
                        {r.has_login ? (
                          <span
                            className="badge badge-success"
                            title={r.linked_role ? `Role: ${r.linked_role}` : ""}
                          >
                            <i className="bi bi-link-45deg me-1"></i>
                            {r.linked_username}
                          </span>
                        ) : (
                          <span className="cell-muted">Not linked</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${statusMeta.badge}`}>
                          <span className={`status-dot ${statusMeta.dot}`}></span>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="btn btn-sm btn-outline-info btn-icon"
                            title="View full profile (360°)"
                            aria-label="View full profile"
                            onClick={() => setProfileId(r.id)}
                          >
                            <i className="bi bi-eye"></i>
                          </button>
                          {!r.has_login && r.status !== "EXITED" && (
                            <>
                              <button
                                className="btn btn-sm btn-outline-success btn-icon"
                                title="Link to an existing user account"
                                aria-label="Link to an existing user account"
                                onClick={() => openLink(r)}
                              >
                                <i className="bi bi-link-45deg"></i>
                              </button>
                              <button
                                className="btn btn-sm btn-outline-primary btn-icon"
                                title="Create new login"
                                aria-label="Create new login"
                                onClick={() => giveLogin(r)}
                              >
                                <i className="bi bi-key"></i>
                              </button>
                            </>
                          )}
                          {r.has_login && r.status !== "EXITED" && (
                            <button
                              className="btn btn-sm btn-outline-secondary btn-icon"
                              title="Unlink user account"
                              aria-label="Unlink user account"
                              onClick={() => unlink(r)}
                            >
                              <i className="bi bi-link-45deg" style={{ textDecoration: "line-through" }}></i>
                            </button>
                          )}
                          {r.status !== "EXITED" && (
                            <button
                              className="btn btn-sm btn-outline-warning btn-icon"
                              title="Record exit"
                              aria-label="Record exit"
                              onClick={() => openExit(r)}
                            >
                              <i className="bi bi-box-arrow-right"></i>
                            </button>
                          )}
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

      {/* ---------------- EMPLOYEE 360 PROFILE ---------------- */}
      <EmployeeProfileModal
        show={profileId !== null}
        employeeId={profileId}
        onClose={() => setProfileId(null)}
        onChanged={load}
        depts={depts}
        positions={positions}
      />

      {/* ---------------- ADD EMPLOYEE ---------------- */}
      <Modal
        show={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Employee"
        size="lg"
      >
        <form onSubmit={save}>
          <h6 className="settings-section__title mb-2">Personal Details</h6>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">First Name</label>
              <input className="form-control" required value={form.first_name} onChange={setField("first_name")} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Last Name</label>
              <input className="form-control" required value={form.last_name} onChange={setField("last_name")} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Gender</label>
              <select className="form-select" value={form.gender} onChange={setField("gender")}>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">National ID</label>
              <input className="form-control" required value={form.national_id} onChange={setField("national_id")} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Phone</label>
              <input className="form-control" placeholder="07XXXXXXXX" value={form.phone} onChange={setField("phone")} />
            </div>
            <div className="col-md-12">
              <label className="form-label">Email</label>
              <input type="email" className="form-control" value={form.email} onChange={setField("email")} />
            </div>
          </div>

          <h6 className="settings-section__title mt-4 mb-2">Employment</h6>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">Category</label>
              <select className="form-select" value={form.category} onChange={setField("category")}>
                {Object.entries(CATEGORY).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label">Employment Type</label>
              <select className="form-select" value={form.employment_type} onChange={setField("employment_type")}>
                {Object.entries(EMPLOYMENT_TYPE).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label">Department</label>
              <select className="form-select" value={form.department} onChange={setField("department")}>
                <option value="">No department</option>
                {depts.map((dep) => (
                  <option key={dep.id} value={dep.id}>{dep.name}</option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label">Position</label>
              <select className="form-select" value={form.position} onChange={setField("position")}>
                <option value="">No position</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
          </div>

          <h6 className="settings-section__title mt-4 mb-2">User Account (for payslips)</h6>
          <p className="form-text-hint">
            An employee sees their payslips only when their record is linked to a user account.
            You can also do this later from the employee list.
          </p>
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label">Account</label>
              <select
                className="form-select"
                value={form.account_mode}
                onChange={(e) => setForm((prev) => ({ ...prev, account_mode: e.target.value, user_id: "" }))}
              >
                <option value="none">Don't link now</option>
                <option value="link">Link to an existing user account</option>
                <option value="create">Create a new login</option>
              </select>
            </div>
            {form.account_mode === "link" && (
              <div className="col-md-7">
                <label className="form-label">Existing account</label>
                <select
                  className="form-select"
                  required
                  value={form.user_id}
                  onChange={setField("user_id")}
                  disabled={usersLoading}
                >
                  <option value="">{usersLoading ? "Loading accounts..." : "Select account..."}</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>{userLabel(u)}</option>
                  ))}
                </select>
                {!usersLoading && availableUsers.length === 0 && (
                  <div className="form-text-hint">Every staff account is already linked to an employee.</div>
                )}
              </div>
            )}
            {form.account_mode === "create" && (
              <div className="col-md-7">
                <div className="form-text-hint align-self-end">
                  A login is created right after saving and the initial password is shown once.
                  Not available for every category; use "link" for HR or Admin staff.
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </button>
            <button className="btn btn-success" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Employee"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ---------------- LINK ACCOUNT (existing employee) ---------------- */}
      <Modal show={showLinkModal} onClose={() => setShowLinkModal(false)} title="Link User Account">
        {linkTarget && (
          <form onSubmit={confirmLink}>
            <p>
              Link <strong>{linkTarget.full_name}</strong> ({linkTarget.employee_no}) to an existing
              user account so they can see their payslips when signed in.
            </p>
            <label className="form-label">User account</label>
            <select
              className="form-select"
              required
              value={linkUserId}
              onChange={(e) => setLinkUserId(e.target.value)}
              disabled={usersLoading}
            >
              <option value="">{usersLoading ? "Loading accounts..." : "Select account..."}</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>{userLabel(u)}</option>
              ))}
            </select>
            {!usersLoading && availableUsers.length === 0 && (
              <div className="form-text-hint">No unlinked staff accounts available.</div>
            )}
            <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowLinkModal(false)}>
                Cancel
              </button>
              <button className="btn btn-success" type="submit" disabled={linkSaving || !linkUserId}>
                {linkSaving ? "Linking..." : "Link Account"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---------------- EXIT ---------------- */}
      <Modal show={showExitModal} onClose={() => setShowExitModal(false)} title="Record Employee Exit">
        {exitTarget && (
          <form onSubmit={confirmExit}>
            <div className="modal-icon-circle modal-icon-circle--danger">
              <i className="bi bi-box-arrow-right"></i>
            </div>
            <p className="text-center mb-3">
              Marking <strong>{exitTarget.full_name}</strong> ({exitTarget.employee_no}) as exited.
              Their records will be kept — this only closes the active employment.
            </p>

            <label className="form-label">Reason for exit</label>
            <textarea
              className="form-control"
              rows={3}
              required
              placeholder="Resignation, retirement, contract expiry…"
              value={exitReason}
              onChange={(e) => setExitReason(e.target.value)}
            />
            <div className="form-text-hint">
              This reason is stored with the employee record and can be reviewed later.
            </div>

            <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowExitModal(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" type="submit" disabled={exitSaving || !exitReason.trim()}>
                {exitSaving ? "Recording..." : "Record Exit"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---------------- LOGIN CREATED ---------------- */}
      <Modal show={!!loginResult} onClose={() => setLoginResult(null)} title="Login Created">
        {loginResult && (
          <div>
            <div className="alert alert-success">
              Login created for <strong>{loginResult.employee_name}</strong> ({loginResult.employee_no}).
            </div>
            <div className="row g-2 mb-3">
              <div className="col-6">
                <div className="section-label">Username</div>
                <div className="cell-mono fw-bold">{loginResult.username}</div>
              </div>
              <div className="col-6">
                <div className="section-label">Initial Password</div>
                <div className="cell-mono fw-bold">
                  <code>{loginResult.initial_password}</code>
                </div>
              </div>
            </div>
            <p className="form-text-hint">
              Share these credentials securely — the password won't be shown again.
            </p>
            <div className="mt-4 pt-3 border-top d-flex justify-content-end">
              <button className="btn btn-secondary" onClick={() => setLoginResult(null)}>Close</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}