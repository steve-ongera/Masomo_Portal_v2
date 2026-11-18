import { useEffect, useState, useCallback } from "react";
import api from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import TableSkeleton from "../../components/TableSkeleton";
import Pagination from "../../components/Pagination";
import Modal from "../../components/Modal";

const ROLE_OPTIONS = [
  "ADMIN",
  "PRINCIPAL",
  "SECRETARY",
  "TEACHER",
  "STUDENT",
  "PARENT",
  "FINANCE",
  "HR",
  "PROCUREMENT",
  "LIBRARIAN",
  "STAFF",
  "CAFETERIA",
  "EXAM_OFFICER",
  "HOSTEL_WARDEN"
];

const ROLE_BADGE_COLORS = {
  ADMIN: "badge-danger",
  PRINCIPAL: "badge-blue",
  TEACHER: "badge-blue",
  PARENT: "badge-gold",
  FINANCE: "badge-success",
};

const ROLE_ICONS = {
  ADMIN: "bi-shield-lock",
  PRINCIPAL: "bi-award",
  SECRETARY: "bi-journal-text",
  TEACHER: "bi-person-workspace",
  PARENT: "bi-people",
  FINANCE: "bi-cash-stack",
  HR: "bi-person-vcard",
  PROCUREMENT: "bi-cart",
  LIBRARIAN: "bi-book",
  CAFETERIA: "bi-cup-hot",
  EXAM_OFFICER: "bi-clipboard-check",
};

const emptyCreateForm = {
  username: "",
  first_name: "",
  last_name: "",
  email: "",
  phone_number: "",
  role: "TEACHER",
  password: "",
};

const emptyEditForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone_number: "",
  national_id: "",
  role: "TEACHER",
  is_active_staff: true,
};

function errorText(err, fallback) {
  const data = err?.response?.data;
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (data.detail) return data.detail;
  if (typeof data === "object") {
    return Object.entries(data)
      .map(
        ([field, errors]) =>
          `${field}: ${Array.isArray(errors) ? errors.join(" ") : errors}`
      )
      .join(" | ");
  }
  return fallback;
}

// Random password without look-alike characters (no 0/O, 1/l/I).
function generatePassword(length = 10) {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// ===========================================================================
// Password input with eye toggle
// ===========================================================================
function PasswordInput({ value, onChange, required, placeholder }) {
  const [show, setShow] = useState(false);

  return (
    <div className="input-icon-group has-toggle">
      <i className="bi bi-lock input-icon-leading"></i>
      <input
        type={show ? "text" : "password"}
        className="form-control"
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        className="input-password-toggle"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
      >
        <i className={`bi ${show ? "bi-eye-slash" : "bi-eye"}`}></i>
      </button>
    </div>
  );
}

// ===========================================================================
// Create User modal
// ===========================================================================
function CreateUserModal({ form, setForm, saving, error, onSubmit, onCancel }) {
  return (
    <Modal
      show={true}
      onClose={onCancel}
      title="Create New User Account"
      size="lg"
    >
      <form onSubmit={onSubmit}>
        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            <i className="bi bi-exclamation-triangle me-1"></i>
            {error}
          </div>
        )}

        <h6 className="settings-section__title mb-2">Personal Details</h6>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label">First Name</label>
            <input
              className="form-control"
              required
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Last Name</label>
            <input
              className="form-control"
              required
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-control"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Phone</label>
            <input
              className="form-control"
              value={form.phone_number}
              onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
            />
          </div>
        </div>

        <h6 className="settings-section__title mt-4 mb-2">Account</h6>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label">Username</label>
            <input
              className="form-control"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            <div className="form-text-hint">
              The login identity for this user.
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label">Password</label>
            <PasswordInput
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Enter password"
            />
          </div>
        </div>

        <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-success" type="submit" disabled={saving}>
            {saving ? (
              "Creating..."
            ) : (
              <>
                <i className="bi bi-check2"></i>
                Create Account
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ===========================================================================
// Edit User modal
// ===========================================================================
function EditUserModal({ user, form, setForm, saving, error, onSave, onCancel, isSelf }) {
  return (
    <Modal
      show={true}
      onClose={onCancel}
      title={`Edit User — ${user.username}`}
    >
      <form onSubmit={onSave}>
        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            <i className="bi bi-exclamation-triangle me-1"></i>
            {error}
          </div>
        )}

        <div className="row g-3">
          <div className="col-12">
            <label className="form-label">Username</label>
            <input className="form-control cell-mono" value={user.username} disabled />
            <div className="form-text-hint">
              Username is the login identity and can't be changed here.
            </div>
          </div>
          <div className="col-md-6">
            <label className="form-label">First Name</label>
            <input
              className="form-control"
              required
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Last Name</label>
            <input
              className="form-control"
              required
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="col-md-6">
            <label className="form-label">National ID</label>
            <input
              className="form-control"
              value={form.national_id}
              onChange={(e) => setForm({ ...form, national_id: e.target.value })}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-control"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label">Phone</label>
            <input
              className="form-control"
              value={form.phone_number}
              onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
            />
          </div>

          <div className="col-12">
            <div className={`status-panel${form.is_active_staff ? " status-panel--active" : ""}`}>
              <div className="form-check form-switch mb-0">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="editIsActiveStaff"
                  checked={form.is_active_staff}
                  disabled={isSelf}
                  onChange={(e) =>
                    setForm({ ...form, is_active_staff: e.target.checked })
                  }
                />
                <label className="form-check-label fw-semibold" htmlFor="editIsActiveStaff">
                  {form.is_active_staff
                    ? "Account active — user can log in"
                    : "Account deactivated — user cannot log in"}
                </label>
              </div>
              {isSelf && (
                <div className="form-text-hint mt-1">
                  You can't deactivate your own account.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? (
              "Saving..."
            ) : (
              <>
                <i className="bi bi-check2"></i>
                Save Changes
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ===========================================================================
// Reset Password modal
// The admin never needs to know the old password. They type a new one (or
// leave it blank / press Generate) and the new password is shown ONCE so it
// can be handed to the user.
// ===========================================================================
function ResetPasswordModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // the password that was set
  const [copied, setCopied] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const { data } = await api.post(`/users/${user.id}/reset_password/`, {
        new_password: password.trim(),
      });
      setResult(data.new_password);
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not reset the password."));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked - the password is still visible on screen */
    }
  };

  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.username;

  return (
    <Modal show={true} onClose={onClose} title={`Reset Password — ${user.username}`}>
      {result ? (
        <div>
          <div className="alert alert-success" role="status">
            <i className="bi bi-check2-circle me-1"></i>
            Password reset for <strong>{fullName}</strong>. They can log in with it straight away
            (any lockout was also cleared).
          </div>

          <label className="form-label">New password (shown once)</label>
          <div className="d-flex gap-2">
            <input className="form-control cell-mono fw-semibold" readOnly value={result} />
            <button type="button" className="btn btn-secondary" onClick={copy}>
              <i className={`bi ${copied ? "bi-check2" : "bi-clipboard"}`}></i>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="form-text-hint mt-2">
            Share it with the user privately and ask them to change it from My Profile → Change Password.
            It can't be viewed again after you close this window.
          </div>

          <div className="mt-4 pt-3 border-top d-flex justify-content-end">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          {error && (
            <div className="alert alert-danger mb-3" role="alert">
              <i className="bi bi-exclamation-triangle me-1"></i>
              {error}
            </div>
          )}

          <p className="mb-3">
            Set a new password for <strong>{fullName}</strong>. You do <strong>not</strong> need
            their current password.
          </p>

          <label className="form-label">New password</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank to auto-generate one"
          />
          <div className="d-flex justify-content-between align-items-center mt-2">
            <span className="form-text-hint">At least 4 characters.</span>
            <button
              type="button"
              className="btn btn-sm btn-light"
              onClick={() => setPassword(generatePassword())}
            >
              <i className="bi bi-shuffle"></i> Generate
            </button>
          </div>

          <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? (
                "Resetting..."
              ) : (
                <>
                  <i className="bi bi-key"></i>
                  Reset Password
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();

  const [users, setUsers] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");

  // ---- Create user modal ----------------------------------------------
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyCreateForm);
  const [formSaving, setFormSaving] = useState(false);
  const [createError, setCreateError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // ---- Edit user modal state ---------------------------------------------
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // ---- Reset password / activate-deactivate state -------------------------
  const [resetUser, setResetUser] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: currentPage, page_size: itemsPerPage };
      if (searchQuery) params.search = searchQuery;
      if (roleFilter) params.role = roleFilter;

      const { data } = await api.get("/users/", { params });
      if (Array.isArray(data)) {
        setUsers(data);
        setTotalItems(data.length);
      } else {
        setUsers(data.results ?? []);
        setTotalItems(data.count ?? 0);
      }
    } catch (error) {
      console.error("Failed to load users:", error);
      setMessage("Could not load users.");
      setMessageType("danger");
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, searchQuery, roleFilter]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const isSelf = (u) => !!me && String(u.id) === String(me.id);

  // ---------------------------------------------------------------------
  // Create user
  // ---------------------------------------------------------------------
  const openCreate = () => {
    setForm(emptyCreateForm);
    setCreateError("");
    setShowCreate(true);
  };

  const closeCreate = () => {
    setShowCreate(false);
    setCreateError("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setMessage("");
    setCreateError("");
    setFormSaving(true);
    try {
      await api.post("/users/", form);
      setForm(emptyCreateForm);
      setCurrentPage(1);
      await loadUsers();
      setMessage("Account created successfully.");
      setMessageType("success");
      closeCreate();
    } catch (err) {
      setCreateError(errorText(err, "Could not create account."));
    } finally {
      setFormSaving(false);
    }
  };

  // ---------------------------------------------------------------------
  // Edit user
  // ---------------------------------------------------------------------
  const startEdit = (user) => {
    setEditingUser(user);
    setEditError("");
    setEditForm({
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      phone_number: user.phone_number || "",
      national_id: user.national_id || "",
      role: user.role,
      is_active_staff: user.is_active_staff ?? true,
    });
  };

  const cancelEdit = () => {
    setEditingUser(null);
    setEditForm(emptyEditForm);
    setEditError("");
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setEditSaving(true);
    setEditError("");
    try {
      const payload = {
        ...editForm,
        national_id: editForm.national_id || null,
      };
      await api.patch(`/users/${editingUser.id}/`, payload);
      cancelEdit();
      await loadUsers();
      setMessage("User account updated.");
      setMessageType("success");
    } catch (err) {
      setEditError(errorText(err, "Could not update this user."));
    } finally {
      setEditSaving(false);
    }
  };

  // ---------------------------------------------------------------------
  // Activate / deactivate
  // ---------------------------------------------------------------------
  const toggleActive = async (u) => {
    const activate = !u.is_active_staff;
    const name = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username;
    const ok = window.confirm(
      activate
        ? `Reactivate ${name}? They will be able to log in again.`
        : `Deactivate ${name}?\n\nThey will be blocked from logging in and any session they have open will stop working.`
    );
    if (!ok) return;

    setTogglingId(u.id);
    setMessage("");
    try {
      await api.post(`/users/${u.id}/set_active/`, { active: activate });
      await loadUsers();
      setMessage(
        activate ? `${name} has been reactivated.` : `${name} has been deactivated and can no longer log in.`
      );
      setMessageType("success");
    } catch (err) {
      setMessage(errorText(err, "Could not change this account's status."));
      setMessageType("danger");
    } finally {
      setTogglingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + users.length;
  const hasActiveFilters = !!(searchInput || roleFilter);

  const handlePageChange = (page) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setRoleFilter("");
    setCurrentPage(1);
  };

  const getRoleBadge = (role) => ROLE_BADGE_COLORS[role] || "badge-neutral";
  const getRoleIcon = (role) => ROLE_ICONS[role] || "bi-person";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">User Accounts</h1>
          <p className="page-subtitle">
            Admin, Teacher, Parent and Finance accounts. Students are created
            via Admit Student. Use the key button to reset a forgotten password and the
            ban button to deactivate an account so the person can no longer log in.
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={openCreate}>
            <i className="bi bi-person-plus"></i>
            Add User
          </button>
        </div>
      </div>

      {message && (
        <div className={`alert alert-${messageType} alert-dismissible fade show`} role="alert">
          {message}
          <button type="button" className="btn-close" onClick={() => setMessage("")}></button>
        </div>
      )}

      {/* ==================== TABLE ==================== */}
      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0">
            <div className="toolbar__search">
              <i className="bi bi-search"></i>
              <input
                type="text"
                className="form-control"
                placeholder="Search name, username, email, phone..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <select
              className="form-select w-auto"
              aria-label="Role"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setCurrentPage(1);
              }}
            >
              <option value="">All Roles</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {hasActiveFilters && (
              <button className="btn btn-sm btn-light" onClick={clearFilters}>
                <i className="bi bi-x-lg"></i> Clear
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <div className="d-flex flex-wrap gap-1">
              {searchQuery && (
                <span className="filter-chip">
                  Search: "{searchQuery}"
                  <button onClick={() => setSearchInput("")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
              {roleFilter && (
                <span className="filter-chip">
                  Role: {roleFilter}
                  <button
                    onClick={() => {
                      setRoleFilter("");
                      setCurrentPage(1);
                    }}
                  >
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title">
              <i className="bi bi-people me-2 text-brand"></i>
              All Users
            </span>
            <span className="chart-card__subtitle">
              {totalItems} user{totalItems !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={Math.min(itemsPerPage, 10)} columns={7} />
        ) : users.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>
              {hasActiveFilters
                ? "No users match your search"
                : "No users created yet"}
            </h6>
            <p className="text-muted-soft mb-3">
              {hasActiveFilters
                ? "Try adjusting your search or filters"
                : "Click 'Add User' to create your first user account"}
            </p>
            {!hasActiveFilters && (
              <button className="btn btn-primary" onClick={openCreate}>
                <i className="bi bi-person-plus"></i>
                Add User
              </button>
            )}
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th style={{ width: "150px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.is_active_staff ? "" : "text-muted"}>
                    <td className="cell-mono text-brand fw-semibold">{u.username}</td>
                    <td>
                      <div className="table-avatar-cell">
                        <div className="avatar-sm">
                          {u.first_name?.[0]}
                          {u.last_name?.[0]}
                        </div>
                        <span className="cell-name">
                          {u.first_name} {u.last_name}
                          {isSelf(u) && <span className="badge badge-neutral ms-2">You</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${getRoleBadge(u.role)}`}>
                        <i className={`bi ${getRoleIcon(u.role)} me-1`}></i>
                        {u.role}
                      </span>
                    </td>
                    <td>{u.email || <span className="cell-muted">-</span>}</td>
                    <td className="cell-mono">{u.phone_number || <span className="cell-muted">-</span>}</td>
                    <td>
                      {u.is_active_staff ? (
                        <span className="badge badge-success">
                          <span className="status-dot status-dot--online"></span>
                          Active
                        </span>
                      ) : (
                        <span className="badge badge-danger">
                          <span className="status-dot status-dot--offline"></span>
                          Deactivated
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary btn-icon"
                          title="Edit"
                          aria-label="Edit"
                          onClick={() => startEdit(u)}
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary btn-icon"
                          title="Reset password"
                          aria-label="Reset password"
                          onClick={() => setResetUser(u)}
                        >
                          <i className="bi bi-key"></i>
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm btn-icon ${u.is_active_staff ? "btn-danger" : "btn-success"}`}
                          title={
                            isSelf(u)
                              ? "You can't deactivate your own account"
                              : u.is_active_staff
                              ? "Deactivate account"
                              : "Reactivate account"
                          }
                          aria-label={u.is_active_staff ? "Deactivate account" : "Reactivate account"}
                          disabled={togglingId === u.id || (isSelf(u) && u.is_active_staff)}
                          onClick={() => toggleActive(u)}
                        >
                          <i className={`bi ${u.is_active_staff ? "bi-slash-circle" : "bi-check-circle"}`}></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && users.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          itemsPerPage={itemsPerPage}
          setItemsPerPage={(n) => {
            setItemsPerPage(n);
            setCurrentPage(1);
          }}
          startIndex={startIndex}
          endIndex={endIndex}
          totalItems={totalItems}
        />
      )}

      {/* ==================== CREATE MODAL ==================== */}
      {showCreate && (
        <CreateUserModal
          form={form}
          setForm={setForm}
          saving={formSaving}
          error={createError}
          onSubmit={submit}
          onCancel={closeCreate}
        />
      )}

      {/* ==================== EDIT MODAL ==================== */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          form={editForm}
          setForm={setEditForm}
          saving={editSaving}
          error={editError}
          onSave={saveEdit}
          onCancel={cancelEdit}
          isSelf={isSelf(editingUser)}
        />
      )}

      {/* ==================== RESET PASSWORD MODAL ==================== */}
      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
          onDone={loadUsers}
        />
      )}
    </div>
  );
}