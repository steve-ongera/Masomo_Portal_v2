// pages/admin/SecurityMonitor.jsx
import { useEffect, useState, useCallback } from "react";
import { securityApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";

const RESULT_CONFIG = {
  SUCCESS: { className: "badge-success", label: "Success", icon: "bi-check-circle" },
  OTP_SUCCESS: { className: "badge-success", label: "OTP Verified", icon: "bi-shield-check" },
  OTP_SENT: { className: "badge-blue", label: "OTP Sent", icon: "bi-send" },
  BAD_PASSWORD: { className: "badge-warning", label: "Bad Password", icon: "bi-x-circle" },
  UNKNOWN_USER: { className: "badge-warning", label: "Unknown Username", icon: "bi-question-circle" },
  INVALID_FORMAT: { className: "badge-warning", label: "Invalid Format", icon: "bi-exclamation-circle" },
  OTP_FAILED: { className: "badge-warning", label: "OTP Failed", icon: "bi-shield-x" },
  ACCOUNT_LOCKED: { className: "badge-danger", label: "Account Locked", icon: "bi-lock" },
};

const ROLE_BADGE = {
  ADMIN: "badge-danger",
  TEACHER: "badge-blue",
  STUDENT: "badge-success",
  PARENT: "badge-gold",
  FINANCE: "badge-neutral",
};

const ROLE_ICON = {
  ADMIN: "bi-shield-lock",
  TEACHER: "bi-person-workspace",
  STUDENT: "bi-person",
  PARENT: "bi-people",
  FINANCE: "bi-cash-stack",
};

export default function SecurityMonitor() {
  const [summary, setSummary] = useState(null);
  const [lockedUsers, setLockedUsers] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unlockingId, setUnlockingId] = useState(null);
  const [resultFilter, setResultFilter] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("attempts");

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, lockedRes, attemptsRes] = await Promise.all([
        securityApi.loginAttemptsSummary(),
        securityApi.lockedUsers(),
        securityApi.loginAttempts({
          ...(resultFilter ? { result: resultFilter } : {}),
          ...(search ? { search } : {}),
        }),
      ]);
      setSummary(summaryRes.data);
      setLockedUsers(lockedRes.data);
      setAttempts(attemptsRes.data.results || attemptsRes.data);
    } catch (error) {
      console.error("Failed to load security data:", error);
    } finally {
      setLoading(false);
    }
  }, [resultFilter, search]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleUnlock = async (userId) => {
    if (!window.confirm("Unlock this account? The user will be able to log in again immediately.")) return;
    setUnlockingId(userId);
    try {
      await securityApi.unlockUser(userId);
      await loadAll();
    } finally {
      setUnlockingId(null);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setResultFilter("");
  };

  const hasActiveFilters = search || resultFilter;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Security Monitor</h1>
          <p className="page-subtitle">
            Login attempts, account lockouts, and account recovery
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="stat-grid">
        <div className="dm-card dm-card--danger">
          <div className="dm-card__top">
            <span className="dm-card__label">Failed Attempts (24h)</span>
            <span className="dm-card__icon">
              <i className="bi bi-x-circle"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: 60, height: 28 }}></div>
            ) : (
              summary?.failed_last_24h ?? "—"
            )}
          </div>
        </div>

        <div className="dm-card dm-card--warning">
          <div className="dm-card__top">
            <span className="dm-card__label">Locked Accounts</span>
            <span className="dm-card__icon">
              <i className="bi bi-lock"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: 60, height: 28 }}></div>
            ) : (
              summary?.locked_accounts ?? "—"
            )}
          </div>
        </div>

        <div className="dm-card dm-card--success">
          <div className="dm-card__top">
            <span className="dm-card__label">Successful Logins (24h)</span>
            <span className="dm-card__icon">
              <i className="bi bi-check-circle"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: 60, height: 28 }}></div>
            ) : (
              summary?.successful_last_24h ?? "—"
            )}
          </div>
        </div>
      </div>

      {/* Tabs + Table */}
      <div className="table-wrap">
        <ul className="nav nav-tabs">
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === "attempts" ? "active" : ""}`}
              onClick={() => setActiveTab("attempts")}
            >
              <i className="bi bi-clock-history me-1"></i>
              Login Attempt Log
              {attempts.length > 0 && (
                <span className="badge badge-blue ms-2">
                  {attempts.length}
                </span>
              )}
            </button>
          </li>
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link ${activeTab === "locked" ? "active" : ""}`}
              onClick={() => setActiveTab("locked")}
            >
              <i className="bi bi-lock me-1"></i>
              Locked Accounts
              {lockedUsers.length > 0 && (
                <span className="badge badge-danger ms-2">
                  {lockedUsers.length}
                </span>
              )}
            </button>
          </li>
        </ul>

        {/* ---- Login Attempts Tab ---- */}
        {activeTab === "attempts" && (
          <>
            {/* Filters */}
            <div className="toolbar p-3 mb-0 border-bottom">
              <div className="toolbar__search" style={{ maxWidth: "none" }}>
                <i className="bi bi-search"></i>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search username or IP..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="form-select w-auto"
                value={resultFilter}
                onChange={(e) => setResultFilter(e.target.value)}
              >
                <option value="">All results</option>
                {Object.entries(RESULT_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
              {hasActiveFilters && (
                <button className="btn btn-sm btn-light" onClick={clearFilters}>
                  <i className="bi bi-x-lg"></i> Clear
                </button>
              )}
            </div>

            {/* Active filter chips */}
            {hasActiveFilters && (
              <div className="chip-row">
                {search && (
                  <span className="filter-chip">
                    Search: "{search}"
                    <button onClick={() => setSearch("")}><i className="bi bi-x"></i></button>
                  </span>
                )}
                {resultFilter && (
                  <span className="filter-chip">
                    Result: {RESULT_CONFIG[resultFilter]?.label || resultFilter}
                    <button onClick={() => setResultFilter("")}><i className="bi bi-x"></i></button>
                  </span>
                )}
              </div>
            )}

            {/* Attempts Table */}
            {loading ? (
              <TableSkeleton rows={5} columns={5} />
            ) : attempts.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-shield-check"></i>
                <h6>No login attempts found</h6>
                <p className="text-muted-soft">
                  {hasActiveFilters
                    ? "No attempts match your filters. Try adjusting your search criteria."
                    : "Login attempts will appear here."}
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Username Attempted</th>
                      <th>Matched User</th>
                      <th>IP Address</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a) => {
                      const cfg = RESULT_CONFIG[a.result] || { className: "badge-neutral", label: a.result, icon: "bi-question" };
                      return (
                        <tr key={a.id}>
                          <td className="cell-mono small">
                            {new Date(a.created_at).toLocaleString('en-KE', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td>
                            <span className="cell-name">
                              {a.username_attempted}
                            </span>
                          </td>
                          <td>
                            {a.user_full_name ? (
                              <div>
                                <span className="cell-name">
                                  {a.user_full_name}
                                </span>
                                <span className={`badge ${ROLE_BADGE[a.user_role] || "badge-neutral"} ms-2`}>
                                  <i className={`bi ${ROLE_ICON[a.user_role] || "bi-person"} me-1`}></i>
                                  {a.user_role}
                                </span>
                              </div>
                            ) : (
                              <span className="cell-muted">—</span>
                            )}
                          </td>
                          <td>
                            {a.ip_address ? (
                              <span className="cell-mono">
                                {a.ip_address}
                              </span>
                            ) : (
                              <span className="cell-muted">—</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${cfg.className}`}>
                              <i className={`bi ${cfg.icon} me-1`}></i>
                              {cfg.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer */}
            {!loading && attempts.length > 0 && (
              <div className="table-wrap__footer">
                <span className="table-wrap__footer-info">
                  Showing <strong>{attempts.length}</strong> attempt{attempts.length !== 1 ? "s" : ""}
                </span>
                <div className="d-flex gap-2 small">
                  <span className="text-ok">
                    <i className="bi bi-check-circle me-1"></i>
                    Success: {attempts.filter(a => a.result === "SUCCESS" || a.result === "OTP_SUCCESS").length}
                  </span>
                  <span className="text-owe">
                    <i className="bi bi-x-circle me-1"></i>
                    Failed: {attempts.filter(a => a.result !== "SUCCESS" && a.result !== "OTP_SUCCESS" && a.result !== "OTP_SENT").length}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* ---- Locked Accounts Tab ---- */}
        {activeTab === "locked" && (
          <>
            {loading ? (
              <TableSkeleton rows={3} columns={5} />
            ) : lockedUsers.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-shield-check text-ok"></i>
                <h6>No locked accounts</h6>
                <p className="text-muted-soft">
                  All user accounts are currently accessible. No action needed.
                </p>
              </div>
            ) : (
              <>
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th className="text-center">Failed Attempts</th>
                        <th>Locked Until</th>
                        <th className="text-end">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lockedUsers.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <div className="table-avatar-cell">
                              <div className="avatar-sm">
                                {u.first_name?.[0]}{u.last_name?.[0]}
                              </div>
                              <div>
                                <div className="cell-name">{u.first_name} {u.last_name}</div>
                                <div className="cell-muted small">
                                  @{u.username}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${ROLE_BADGE[u.role] || "badge-neutral"}`}>
                              <i className={`bi ${ROLE_ICON[u.role] || "bi-person"} me-1`}></i>
                              {u.role}
                            </span>
                          </td>
                          <td className="text-center">
                            <span className="badge badge-danger">
                              <i className="bi bi-x-circle me-1"></i>
                              {u.failed_login_attempts}
                            </span>
                          </td>
                          <td className="cell-mono small">
                            {u.locked_until ? (
                              <span>
                                <i className="bi bi-clock me-1"></i>
                                {new Date(u.locked_until).toLocaleString('en-KE', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            ) : (
                              <span className="cell-muted">—</span>
                            )}
                          </td>
                          <td className="text-end">
                            <button
                              className="btn btn-sm btn-outline-danger"
                              disabled={unlockingId === u.id}
                              onClick={() => handleUnlock(u.id)}
                            >
                              {unlockingId === u.id ? (
                                <>
                                  <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                                  Unlocking...
                                </>
                              ) : (
                                <>
                                  <i className="bi bi-unlock me-1"></i>
                                  Unlock
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div className="table-wrap__footer">
                  <span className="table-wrap__footer-info">
                    Showing <strong>{lockedUsers.length}</strong> locked account{lockedUsers.length !== 1 ? "s" : ""}
                  </span>
                  <span className="form-text-hint text-owe m-0">
                    <i className="bi bi-exclamation-triangle me-1"></i>
                    Users will be able to log in after unlocking
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Info Card */}
      <div className="note-card mt-3 mb-0">
        <i className="bi bi-info-circle"></i>
        <span>
          <strong>About this page:</strong> This monitor tracks all login attempts including OTP verification.
          Accounts are automatically locked after multiple failed attempts. Use the <strong>Locked Accounts</strong> tab
          to manually unlock users when needed.
        </span>
      </div>
    </div>
  );
}