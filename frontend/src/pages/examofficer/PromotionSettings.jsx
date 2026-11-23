// src/pages/examofficer/PromotionSettings.jsx
import { useEffect, useState } from "react";
import { promotionSettingsApi } from "../../services/api";

const errText = (e) =>
  e?.response?.data?.detail || e?.message || "Something went wrong.";

export default function PromotionSettings() {
  const [cfg, setCfg] = useState(null);
  const [report, setReport] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    promotionSettingsApi
      .get()
      .then((r) => {
        if (alive) setCfg(r.data);
      })
      .catch((e) => {
        if (alive) setMsg({ type: "danger", text: errText(e) });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Automatic Promotion</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Automatic Promotion</h1>
          </div>
        </div>
        {msg && (
          <div className="alert alert-danger" role="alert">
            <i className="bi bi-exclamation-triangle me-1"></i>
            {msg.text}
          </div>
        )}
      </div>
    );
  }

  const set = (patch) => setCfg({ ...cfg, ...patch });

  const act = async (fn, ok) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ type: "success", text: ok });
    } catch (e) {
      setMsg({ type: "danger", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    act(async () => {
      const {
        auto_promote_enabled,
        mode,
        days_after_year_end,
        auto_activate_next_year,
      } = cfg;
      const { data } = await promotionSettingsApi.save({
        auto_promote_enabled,
        mode,
        days_after_year_end,
        auto_activate_next_year,
      });
      setCfg(data);
    }, "Settings saved.");

  const run = (dry) => {
    if (
      !dry &&
      !window.confirm(
        "Promote every unpromoted class of the latest finished year now?"
      )
    )
      return;
    act(async () => {
      const { data } = await promotionSettingsApi.run(dry);
      setReport(data);
      if (!dry) setCfg((await promotionSettingsApi.get()).data);
    }, dry ? "Preview ready. Nothing was changed." : "Promotion complete.");
  };

  const classesNeedingAttention = (report?.classes || []).filter(
    (c) => c.repeating.length || c.held.length
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Automatic Promotion</h1>
          <p className="page-subtitle">
            When the last term of an academic year has ended, classes are
            promoted to the next grade (final-year classes graduate). Each
            class is promoted once, so running it again is safe.
          </p>
        </div>
      </div>

      {msg && (
        <div
          className={`alert alert-${msg.type} alert-dismissible fade show`}
          role="alert"
        >
          <i
            className={`bi ${
              msg.type === "success"
                ? "bi-check2-circle"
                : "bi-exclamation-triangle"
            } me-1`}
          ></i>
          {msg.text}
          <button
            type="button"
            className="btn-close"
            onClick={() => setMsg(null)}
          ></button>
        </div>
      )}

      {/* ==================== SETTINGS ==================== */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-sliders me-2 text-brand"></i>
            Rules
          </span>
          <span
            className={`badge ${
              cfg.auto_promote_enabled ? "badge-success" : "badge-neutral"
            }`}
          >
            <span
              className={`status-dot ${
                cfg.auto_promote_enabled
                  ? "status-dot--online"
                  : "status-dot--offline"
              }`}
            ></span>
            {cfg.auto_promote_enabled ? "Auto-promote on" : "Auto-promote off"}
          </span>
        </div>

        <div className="p-3">
          <div
            className={`status-panel mb-3 ${
              cfg.auto_promote_enabled ? "status-panel--active" : ""
            }`}
          >
            <div className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                id="en"
                checked={cfg.auto_promote_enabled}
                onChange={(e) =>
                  set({ auto_promote_enabled: e.target.checked })
                }
              />
              <label
                className="form-check-label small fw-semibold"
                htmlFor="en"
              >
                Promote automatically at the end of the year
              </label>
            </div>
          </div>

          <div className="row g-3">
            <div className="col-md-7">
              <label className="form-label">Who Is Promoted</label>
              <select
                className="form-select"
                value={cfg.mode}
                onChange={(e) => set({ mode: e.target.value })}
              >
                <option value="RULE_BASED">
                  Only students who meet the class's promotion rule — the rest
                  repeat
                </option>
                <option value="PROMOTE_ALL">Every active student</option>
              </select>
            </div>

            <div className="col-md-5">
              <label className="form-label">
                Wait After the Last Term Ends (days)
              </label>
              <input
                type="number"
                min="0"
                className="form-control"
                value={cfg.days_after_year_end}
                onChange={(e) =>
                  set({ days_after_year_end: Number(e.target.value) })
                }
              />
              <div className="form-text-hint">
                Grace period before the automatic run.
              </div>
            </div>
          </div>

          <div
            className={`status-panel mt-3 ${
              cfg.auto_activate_next_year ? "status-panel--active" : ""
            }`}
          >
            <div className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                id="cal"
                checked={cfg.auto_activate_next_year}
                onChange={(e) =>
                  set({ auto_activate_next_year: e.target.checked })
                }
              />
              <label
                className="form-check-label small fw-semibold"
                htmlFor="cal"
              >
                Also switch to the new academic year and term when they start
              </label>
            </div>
          </div>
        </div>

        <div className="table-wrap__footer">
          <span className="table-wrap__footer-info">
            <i className="bi bi-info-circle me-1"></i>
            These settings apply on the next automatic run
          </span>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? (
              "Saving..."
            ) : (
              <>
                <i className="bi bi-check2 me-1"></i>
                Save Settings
              </>
            )}
          </button>
        </div>
      </div>

      {/* ==================== RUN NOW ==================== */}
      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-play-circle me-2 text-brand"></i>
            Run Now
          </span>
          {cfg.last_run_at && (
            <span className="chart-card__subtitle mb-0">
              <i className="bi bi-clock-history me-1"></i>
              Last run: {new Date(cfg.last_run_at).toLocaleString()}
            </span>
          )}
        </div>

        <div className="p-3">
          <div className="d-flex flex-wrap gap-2">
            <button
              className="btn btn-outline-primary"
              disabled={busy}
              onClick={() => run(true)}
            >
              <i className="bi bi-eye me-1"></i>
              Preview What Would Happen
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(false)}
            >
              <i className="bi bi-people me-1"></i>
              Promote Now
            </button>
          </div>

          {report && (
            <div className="mt-3">
              {!report.ran ? (
                <div
                  className="alert alert-primary d-flex align-items-start gap-2 mb-0"
                  role="status"
                >
                  <i className="bi bi-info-circle mt-1"></i>
                  <span>{report.detail}</span>
                </div>
              ) : (
                <>
                  {/* Summary stat cards */}
                  <div className="stat-grid">
                    <div className="dm-card dm-card--success">
                      <div className="dm-card__top">
                        <span className="dm-card__label">Promoted</span>
                        <span className="dm-card__icon">
                          <i className="bi bi-arrow-up-circle"></i>
                        </span>
                      </div>
                      <div className="dm-card__num">{report.promoted}</div>
                    </div>

                    <div className="dm-card dm-card--primary">
                      <div className="dm-card__top">
                        <span className="dm-card__label">Graduated</span>
                        <span className="dm-card__icon">
                          <i className="bi bi-mortarboard"></i>
                        </span>
                      </div>
                      <div className="dm-card__num">{report.graduated}</div>
                    </div>

                    <div
                      className={`dm-card ${
                        report.repeating > 0
                          ? "dm-card--warning"
                          : "dm-card--primary"
                      }`}
                    >
                      <div className="dm-card__top">
                        <span className="dm-card__label">Repeating</span>
                        <span className="dm-card__icon">
                          <i className="bi bi-arrow-repeat"></i>
                        </span>
                      </div>
                      <div className="dm-card__num">{report.repeating}</div>
                    </div>

                    <div
                      className={`dm-card ${
                        report.held > 0 ? "dm-card--danger" : "dm-card--primary"
                      }`}
                    >
                      <div className="dm-card__top">
                        <span className="dm-card__label">Held for review</span>
                        <span className="dm-card__icon">
                          <i className="bi bi-pause-circle"></i>
                        </span>
                      </div>
                      <div className="dm-card__num">{report.held}</div>
                    </div>
                  </div>

                  <div className="chart-card__subtitle mb-3 d-flex align-items-center gap-2">
                    <span
                      className={`badge ${
                        report.dry_run ? "badge-blue" : "badge-success"
                      }`}
                    >
                      <span
                        className={`status-dot ${
                          report.dry_run
                            ? "status-dot--pending"
                            : "status-dot--online"
                        }`}
                      ></span>
                      {report.dry_run ? "Preview" : "Applied"}
                    </span>
                    <span>
                      Academic year <strong>{report.academic_year}</strong>
                    </span>
                  </div>

                  {/* Nothing left to promote */}
                  {report.classes_processed === 0 &&
                    !(report.errors?.length > 0) && (
                      <div className="alert alert-primary mb-3" role="status">
                        <i className="bi bi-info-circle me-1"></i>
                        No unpromoted classes with active students were found
                        for {report.academic_year}.
                      </div>
                    )}

                  {/* Classes not yet promoted -> where they will go */}
                  {report.classes?.length > 0 && (
                    <div className="mb-3">
                      <div className="section-label mb-2">
                        {report.dry_run
                          ? "Classes Not Yet Promoted"
                          : "Classes Promoted In This Run"}{" "}
                        ({report.classes.length})
                      </div>
                      <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0">
                          <thead>
                            <tr>
                              <th>Class</th>
                              <th>Students</th>
                              <th>{report.dry_run ? "Will Move To" : "Moved To"}</th>
                              <th>Year</th>
                              <th>Promote</th>
                              <th>Repeat</th>
                              <th>Held</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.classes.map((c) => {
                              const graduating = c.target === "Graduation";
                              return (
                                <tr key={c.classroom}>
                                  <td>{c.classroom}</td>
                                  <td>{c.students}</td>
                                  <td>
                                    {graduating ? (
                                      <span className="badge badge-blue">
                                        Graduates
                                      </span>
                                    ) : (
                                      c.target
                                    )}
                                  </td>
                                  <td>{graduating ? "—" : c.target_year}</td>
                                  <td>{graduating ? c.graduated : c.promoted}</td>
                                  <td>{c.repeating.length}</td>
                                  <td>{c.held.length}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Already promoted classes */}
                  {report.already_promoted?.length > 0 && (
                    <div className="mb-3">
                      <div className="section-label mb-2">
                        Already Promoted ({report.already_promoted.length})
                      </div>
                      <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0">
                          <thead>
                            <tr>
                              <th>Class</th>
                              <th>Moved To</th>
                              <th>Students</th>
                              <th>Date</th>
                              <th>By</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.already_promoted.map((p) => (
                              <tr key={p.classroom}>
                                <td>{p.classroom}</td>
                                <td>{p.target}</td>
                                <td>{p.students}</td>
                                <td>
                                  {new Date(p.promoted_at).toLocaleString()}
                                </td>
                                <td>{p.promoted_by}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Errors */}
                  {report.errors?.length > 0 && (
                    <div className="alert alert-warning" role="alert">
                      <div className="d-flex align-items-center gap-2 mb-2 fw-bold">
                        <i className="bi bi-exclamation-triangle"></i>
                        {report.errors.length} issue
                        {report.errors.length === 1 ? "" : "s"} encountered
                      </div>
                      <ul
                        className="mb-0 small"
                        style={{ paddingLeft: "1.2rem" }}
                      >
                        {report.errors.map((x) => (
                          <li key={x.classroom}>
                            <strong>{x.classroom}</strong> — {x.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Classes with repeating / held students */}
                  {classesNeedingAttention.length > 0 && (
                    <div>
                      <div className="section-label mb-2">
                        Classes Needing Attention
                      </div>
                      {classesNeedingAttention.map((c) => (
                        <div key={c.classroom} className="table-wrap mb-2">
                          <div className="p-3">
                            <div className="cell-name mb-2">
                              <i className="bi bi-people me-1 text-muted-soft"></i>
                              {c.classroom}
                            </div>

                            {c.repeating.length > 0 && (
                              <div className="mb-2">
                                <div className="section-label mb-1 text-gold">
                                  Repeating
                                </div>
                                <ul
                                  className="mb-0 small"
                                  style={{
                                    paddingLeft: "1.2rem",
                                    color: "var(--ink-700)",
                                  }}
                                >
                                  {c.repeating.map((s) => (
                                    <li key={s.admission_no}>
                                      <strong>{s.name}</strong> (
                                      {s.admission_no}) — {s.reason}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {c.held.length > 0 && (
                              <div>
                                <div className="section-label mb-1 text-owe">
                                  Held for Review
                                </div>
                                <ul
                                  className="mb-0 small"
                                  style={{
                                    paddingLeft: "1.2rem",
                                    color: "var(--ink-700)",
                                  }}
                                >
                                  {c.held.map((s) => (
                                    <li key={s.admission_no}>
                                      <strong>{s.name}</strong> (
                                      {s.admission_no}) — {s.reason}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}