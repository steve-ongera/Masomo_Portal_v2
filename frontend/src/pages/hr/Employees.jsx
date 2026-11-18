import { useEffect, useState, useCallback } from "react";
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
          <TableSkeleton rows={10} columns={7} />
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
                  <th>Category</th>
                  <th>Department</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th style={{ width: "250px" }}>Actions</th>
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
                          <span className="cell-name">{r.full_name}</span>
                        </div>
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