import { useEffect, useState } from "react";
import { errMsg, libraryApi } from "./shared";
import Breadcrumb from "../../components/Breadcrumb";

export default function LibrarySettings() {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    libraryApi
      .settings()
      .then((r) => {
        if (alive) setF(r.data);
      })
      .catch((e) => {
        if (alive) setMsg({ kind: "error", text: errMsg(e) });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const num = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const bool = (k) => (e) => setF({ ...f, [k]: e.target.checked });

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const { data } = await libraryApi.saveSettings(f);
      setF(data);
      setMsg({
        kind: "ok",
        text: "Lending rules saved. They apply to new loans straight away.",
      });
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e, "Couldn't save.") });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/librarian" },
            { label: "Library", href: "/librarian" },
          ]}
        />
        <div className="page-header">
          <div>
            <h1 className="page-title">Lending Rules</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/librarian" },
          { label: "Library", href: "/librarian" },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Lending Rules</h1>
          <p className="page-subtitle">How long, how many, and what a late book costs</p>
        </div>
        {f && (
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? (
              "Saving..."
            ) : (
              <>
                <i className="bi bi-check2 me-1"></i>
                Save Rules
              </>
            )}
          </button>
        )}
      </div>

      {msg && (
        <div
          className={`alert alert-${msg.kind === "ok" ? "success" : "danger"} alert-dismissible fade show`}
          role="status"
        >
          <i
            className={`bi ${
              msg.kind === "ok" ? "bi-check2-circle" : "bi-exclamation-triangle"
            } me-1`}
          ></i>
          {msg.text}
          <button type="button" className="btn-close" onClick={() => setMsg(null)}></button>
        </div>
      )}

      {f && (
        <>
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                <i className="bi bi-clock-history me-2"></i>
                Loan Limits
              </span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
                Applied when a book is issued
              </span>
            </div>

            <div className="p-3">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Loan Period (days)</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={f.loan_days}
                    onChange={num("loan_days")}
                  />
                  <div className="form-text-hint">
                    How long a book may be kept before it's due back.
                  </div>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Books a Learner Can Hold</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control"
                    value={f.max_active_loans}
                    onChange={num("max_active_loans")}
                  />
                  <div className="form-text-hint">Maximum concurrent loans per learner.</div>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Renewals Allowed</label>
                  <input
                    type="number"
                    min="0"
                    className="form-control"
                    value={f.max_renewals}
                    onChange={num("max_renewals")}
                  />
                  <div className="form-text-hint">How many times a loan may be extended.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                <i className="bi bi-cash-coin me-2"></i>
                Fines
              </span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
                Charged on overdue returns
              </span>
            </div>

            <div className="p-3">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Fine per Overdue Day (KES)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    className="form-control"
                    value={f.fine_per_day}
                    onChange={num("fine_per_day")}
                  />
                  <div className="form-text-hint">Applied for each day past the due date.</div>
                </div>

                <div className="col-md-6">
                  <label className="form-label">Grace Days Before Fines</label>
                  <input
                    type="number"
                    min="0"
                    className="form-control"
                    value={f.grace_days}
                    onChange={num("grace_days")}
                  />
                  <div className="form-text-hint">
                    Days after the due date before a fine starts accruing.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                <i className="bi bi-shield-lock me-2"></i>
                Blocking Rules
              </span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
                When a learner is blocked from new loans
              </span>
            </div>

            <div className="p-3">
              <div
                className="d-flex align-items-center gap-2 mb-2 p-3"
                style={{
                  background: f.block_if_overdue ? "var(--danger-100)" : "var(--bg-app)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="blockOverdue"
                    checked={f.block_if_overdue}
                    onChange={bool("block_if_overdue")}
                  />
                  <label
                    className="form-check-label"
                    htmlFor="blockOverdue"
                    style={{ fontSize: "var(--fs-xs)", fontWeight: 600 }}
                  >
                    No new loans while a learner has an overdue book
                  </label>
                </div>
              </div>

              <div
                className="d-flex align-items-center gap-2 p-3"
                style={{
                  background: f.block_if_unpaid_fines ? "var(--danger-100)" : "var(--bg-app)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="blockFines"
                    checked={f.block_if_unpaid_fines}
                    onChange={bool("block_if_unpaid_fines")}
                  />
                  <label
                    className="form-check-label"
                    htmlFor="blockFines"
                    style={{ fontSize: "var(--fs-xs)", fontWeight: 600 }}
                  >
                    No new loans while a learner has unpaid library fines
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <i className="bi bi-info-circle me-1"></i>
                These rules apply to all new loans straight away
              </span>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? (
                  "Saving..."
                ) : (
                  <>
                    <i className="bi bi-check2 me-1"></i>
                    Save Rules
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}