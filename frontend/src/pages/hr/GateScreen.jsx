import { useEffect, useState, useCallback } from "react";
import { gateApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";

const SCAN_KIND = {
  IN: { label: "Signed in", badge: "badge-success", dot: "status-dot--online" },
  OUT: { label: "Signed out", badge: "badge-blue", dot: "status-dot--online" },
  FAIL: { label: "Refused", badge: "badge-danger", dot: "status-dot--offline" },
};

export default function GateScreen() {
  const [qr, setQr] = useState(null);
  const [qrError, setQrError] = useState("");

  const [cfg, setCfg] = useState(null);
  const [cfgSaving, setCfgSaving] = useState(false);

  const [log, setLog] = useState([]);
  const [logLoading, setLogLoading] = useState(true);

  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("info");

  useEffect(() => {
    let t;
    const tick = async () => {
      try {
        const { data } = await gateApi.code();
        setQr(data.qr);
        setQrError("");
        t = setTimeout(tick, data.refresh_in * 1000);
      } catch {
        setQrError("Could not refresh the code. Check the connection.");
        t = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => clearTimeout(t);
  }, []);

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const r = await gateApi.log();
      setLog(r.data);
    } catch {
      setMsg("Could not load the scan log.");
      setMsgType("danger");
    } finally {
      setLogLoading(false);
    }
  }, []);

  useEffect(() => {
    gateApi
      .settings()
      .then((r) => setCfg(r.data))
      .catch(() => {
        setMsg("Could not load attendance rules.");
        setMsgType("danger");
      });
    loadLog();
  }, [loadLog]);

  const set = (key) => (e) =>
    setCfg({
      ...cfg,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    });

  const useHere = () => {
    if (!navigator.geolocation) {
      setMsg("This device cannot share its location.");
      setMsgType("danger");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCfg({
          ...cfg,
          latitude: p.coords.latitude.toFixed(6),
          longitude: p.coords.longitude.toFixed(6),
        });
        setMsg("Location captured. Remember to save.");
        setMsgType("info");
      },
      () => {
        setMsg("Allow location access to set the school position.");
        setMsgType("danger");
      }
    );
  };

  const save = async () => {
    setCfgSaving(true);
    try {
      await gateApi.saveSettings(cfg);
      setMsg("Attendance settings saved.");
      setMsgType("success");
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not save the settings.");
      setMsgType("danger");
    } finally {
      setCfgSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Gate Attendance</h1>
          <p className="page-subtitle">
            Screen at the school gate — staff scan the rotating code to sign in or out
          </p>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show`} role="alert">
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      <div className="row g-3">
        {/* ---- QR code card ---- */}
        <div className="col-lg-5">
          <div className="table-wrap h-100">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-qr-code me-2 text-brand"></i>
                Scan to sign in or out
              </span>
              {qr && (
                <span className="badge badge-success">
                  <span className="status-dot status-dot--online"></span>
                  Live
                </span>
              )}
            </div>

            <div className="p-3">
              <div className="note-card justify-content-center p-3 mb-0 mt-0" style={{ overflow: "hidden" }}>
                {qr ? (
                  <img
                    alt="Attendance code"
                    width={320}
                    height={320}
                    src={`data:image/png;base64,${qr}`}
                    className="rounded-md"
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      height: "auto",
                    }}
                  />
                ) : qrError ? (
                  <div className="empty-state py-4 px-3 mw-100" style={{ maxWidth: 320 }}>
                    <i className="bi bi-wifi-off"></i>
                    <h6>No code right now</h6>
                    <p className="text-muted-soft">{qrError}</p>
                  </div>
                ) : (
                  <div
                    className="d-flex align-items-center justify-content-center"
                    style={{ width: 320, height: 320, maxWidth: "100%" }}
                  >
                    <div className="page-loader__ring" />
                  </div>
                )}
              </div>

              <div className="note-card mt-3 mb-0">
                <i className="bi bi-info-circle"></i>
                <span>
                  Open your Masomo account on your own phone, then scan this code. The
                  code refreshes every few seconds and only works while you are on
                  school premises.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Attendance rules card ---- */}
        <div className="col-lg-7">
          {!cfg ? (
            <div className="table-wrap h-100">
              <div className="table-wrap__header">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-sliders me-2 text-brand"></i>
                  Attendance Rules
                </span>
              </div>
              <div className="p-4 d-flex justify-content-center">
                <div className="page-loader__ring" />
              </div>
            </div>
          ) : (
            <div className="table-wrap h-100">
              <div className="table-wrap__header">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-sliders me-2 text-brand"></i>
                  Attendance Rules
                </span>
                <span className="chart-card__subtitle mb-0">
                  Applied to every staff sign-in
                </span>
              </div>

              <div className="p-3">
                <div className="row g-3">
                  <div className="col-sm-6">
                    <label className="form-label">Late After</label>
                    <input
                      type="time"
                      className="form-control"
                      value={cfg.late_after || ""}
                      onChange={set("late_after")}
                    />
                    <div className="form-text-hint">Sign-ins after this time are marked late.</div>
                  </div>

                  <div className="col-sm-6">
                    <label className="form-label">Work Ends</label>
                    <input
                      type="time"
                      className="form-control"
                      value={cfg.work_end || ""}
                      onChange={set("work_end")}
                    />
                    <div className="form-text-hint">
                      Sign-outs before this time are flagged as early departures.
                    </div>
                  </div>

                  <div className="col-sm-6">
                    <label className="form-label">Geofence Radius (m)</label>
                    <input
                      type="number"
                      min={0}
                      className="form-control"
                      value={cfg.radius_m || ""}
                      onChange={set("radius_m")}
                    />
                    <div className="form-text-hint">
                      How far from the school a scan is still accepted.
                    </div>
                  </div>

                  <div className="col-sm-6">
                    <label className="form-label">Enforcement</label>
                    <div className="toolbar__filter w-100">
                      <div className="form-check form-switch mb-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="requireGeofence"
                          checked={!!cfg.require_geofence}
                          onChange={set("require_geofence")}
                        />
                        <label
                          className="form-check-label small"
                          htmlFor="requireGeofence"
                        >
                          Require staff to be on site
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="col-12">
                    <label className="form-label">School Position</label>
                    <div className="fee-box d-flex align-items-center justify-content-between gap-2 flex-wrap">
                      <div className="small">
                        {cfg.latitude && cfg.longitude ? (
                          <>
                            <div>
                              <i className="bi bi-geo-alt me-1 text-brand"></i>
                              <strong>{cfg.latitude}</strong>, <strong>{cfg.longitude}</strong>
                            </div>
                            <div className="text-muted-soft">
                              Every scan must fall within the radius above.
                            </div>
                          </>
                        ) : (
                          <div className="text-muted-soft">
                            <i className="bi bi-geo me-1"></i>
                            Not set — scans can't be geofenced yet.
                          </div>
                        )}
                      </div>
                      <button type="button" className="btn btn-sm btn-outline-primary" onClick={useHere}>
                        <i className="bi bi-crosshair me-1"></i>
                        Use This Device
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 d-flex justify-content-end gap-2">
                  <button className="btn btn-success" onClick={save} disabled={cfgSaving}>
                    {cfgSaving ? (
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
            </div>
          )}
        </div>
      </div>

      {/* ---- Recent Scans ---- */}
      <div className="table-wrap mt-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-clock-history me-2 text-brand"></i>
            Recent Scans
          </span>
          <div className="d-flex align-items-center gap-2">
            <span className="chart-card__subtitle mb-0">
              {log.length} entr{log.length === 1 ? "y" : "ies"}
            </span>
            <button className="btn btn-sm btn-light" onClick={loadLog} disabled={logLoading}>
              <i className="bi bi-arrow-clockwise"></i>
              Refresh
            </button>
          </div>
        </div>

        {logLoading ? (
          <TableSkeleton rows={5} columns={4} />
        ) : log.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-clock-history"></i>
            <h6>No scans yet</h6>
            <p className="text-muted-soft">
              Sign-ins and sign-outs will appear here as staff scan the code.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th style={{ width: "200px" }}>When</th>
                  <th>Staff</th>
                  <th style={{ width: "140px" }}>Result</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r, i) => {
                  const kind = SCAN_KIND[r.kind] || {
                    label: r.kind,
                    badge: "badge-neutral",
                    dot: "status-dot--offline",
                  };
                  return (
                    <tr key={i}>
                      <td className="cell-mono">
                        {new Date(r.at).toLocaleString()}
                      </td>
                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">
                            {(r.employee || "")
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <span className="cell-name">{r.employee || "—"}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${kind.badge}`}>
                          <span className={`status-dot ${kind.dot}`}></span>
                          {kind.label}
                        </span>
                      </td>
                      <td>
                        {r.note ? (
                          <span className="small">{r.note}</span>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}