import { useState } from "react";
import { studentIdApi } from "../../services/studentIdApi";
import QrScanner from "../../components/QrScanner";
import { fmtDate } from "./StudentIdCardView";

const kes = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Fee status -> text colour class + pill tone
const FEE_TEXT = { CLEARED: "text-ok", GRACE: "text-gold", OWING: "text-owe" };
const FEE_PILL = { CLEARED: "status-pill--success", GRACE: "status-pill--warning", OWING: "status-pill--danger" };

// Panel with no padding, for tables that run edge to edge
const FLUSH = { padding: 0, overflow: "hidden" };

export default function StudentIdLookup() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const [loading, setLoading] = useState(false);

  const lookup = async (body) => {
    setLoading(true);
    setError("");
    try {
      const res = await studentIdApi.lookup(body);
      setData(res.data);
    } catch (e) {
      setData(null);
      setError(e.response?.data?.detail || "Lookup failed.");
    } finally {
      setLoading(false);
    }
  };

  const fee = data?.fee;
  const bal = Number(fee?.balance || 0);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true">
            <i className="bi bi-person-vcard"></i>
          </span>
          <div className="page-header__text">
            <h1 className="page-title">Student ID Lookup</h1>
            <p className="page-subtitle">Scan a student's ID card to see their live fee, cafeteria and attendance details.</p>
          </div>
        </div>
      </div>

      <div className="row g-3">
        {/* ---------- left: scanner + manual lookup ---------- */}
        <div className="col-lg-4">
          <div className="panel">
            <div className="panel__head">
              <i className="bi bi-qr-code-scan" aria-hidden="true"></i>
              <div>
                <h6 className="panel__title">Scan ID card</h6>
                <p className="panel__text">Hold the card's QR code in front of the camera.</p>
              </div>
            </div>

            <QrScanner onScan={(text) => lookup({ qr_token: text })} />

            <div className="section-label mt-3 mb-1">Or type the admission number</div>
            <div className="d-flex gap-2">
              <div className="input-icon-group" style={{ flex: 1 }}>
                <i className="bi bi-person-badge input-icon-leading" aria-hidden="true"></i>
                <input
                  className="form-control"
                  placeholder="Admission number"
                  aria-label="Admission number"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && manual.trim() && lookup({ admission_no: manual.trim() })}
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={!manual.trim() || loading}
                onClick={() => lookup({ admission_no: manual.trim() })}
              >
                {loading ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-search"></i>}
                Look up
              </button>
            </div>
          </div>
        </div>

        {/* ---------- right: results ---------- */}
        <div className="col-lg-8">
          {error && <div className="alert alert-danger">{error}</div>}
          {!data && !error && (
            <div className="page-card">
              <div className="empty-state">
                <i className="bi bi-qr-code-scan"></i>
                <h6>No student scanned</h6>
                <p className="text-muted-soft">Scan an ID card to load the student's details.</p>
              </div>
            </div>
          )}

          {data && (
            <>
              {/* Identity */}
              <section className="page-card mb-3">
                <div className="person-card" style={{ margin: "1.1rem", gridTemplateColumns: "auto minmax(0, 1fr)" }}>
                  <div
                    style={{
                      width: "6.5rem",
                      height: "8.25rem",
                      borderRadius: "var(--radius-lg)",
                      overflow: "hidden",
                      background: "var(--blue-100)",
                      color: "var(--blue-600)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "3px solid #fff",
                      boxShadow: "var(--shadow-md)",
                    }}
                  >
                    {data.student.photo_url ? (
                      <img src={data.student.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <i className="bi bi-person" style={{ fontSize: "2.6rem" }}></i>
                    )}
                  </div>

                  <div>
                    <div className="person-card__name">
                      <span className="text-uppercase">
                        {data.student.surname} {data.student.given_names}
                      </span>
                      {!data.student.is_active && <span className="status-pill status-pill--danger">Inactive</span>}
                    </div>
                    <div className="person-card__meta">
                      <span>
                        {data.student.admission_no} • {data.student.sex} • {data.student.nationality}
                      </span>
                    </div>

                    <dl className="detail-grid mt-3" style={{ gridTemplateColumns: "6.5rem minmax(0, 1fr)", fontSize: "var(--fs-sm)" }}>
                      <dt>Class</dt>
                      <dd>{data.class.classroom || "-"}</dd>
                      <dt>Stream</dt>
                      <dd>{data.class.stream || "-"}</dd>
                      <dt>D.O.B</dt>
                      <dd>{fmtDate(data.student.date_of_birth)}</dd>
                      <dt>Address</dt>
                      <dd>{data.student.address || "-"}</dd>
                      {data.card && (
                        <>
                          <dt>Card</dt>
                          <dd>
                            <span className="cell-mono">{data.card.card_number}</span>{" "}
                            <span
                              className={`status-pill ${
                                data.card.status === "ACTIVE" && !data.card.expired ? "status-pill--success" : "status-pill--danger"
                              }`}
                            >
                              {data.card.expired ? "EXPIRED" : data.card.status_display}
                            </span>
                          </dd>
                          <dt>Expires</dt>
                          <dd>{fmtDate(data.card.expiry_date)}</dd>
                        </>
                      )}
                    </dl>

                    <div className="mt-3">
                      {data.today.checked_in ? (
                        <span className="status-pill status-pill--success">
                          In school today · {data.today.time} ({data.today.status})
                        </span>
                      ) : (
                        <span className="status-pill status-pill--neutral">Not scanned in today</span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <div className="row g-3 mb-3">
                {/* Fees */}
                <div className="col-md-6">
                  <div className="panel h-100">
                    <div className="panel__head">
                      <i className="bi bi-cash-coin" aria-hidden="true"></i>
                      <h6 className="panel__title">Fees</h6>
                    </div>
                    <div className={`fw-bold ${FEE_TEXT[fee.status] || ""}`} style={{ fontSize: "var(--fs-2xl)", lineHeight: 1.1 }}>
                      {bal < 0 ? `Credit KES ${kes(Math.abs(bal))}` : `KES ${kes(bal)}`}
                    </div>
                    <div className="mt-2">
                      <span className={`status-pill ${FEE_PILL[fee.status] || "status-pill--neutral"}`}>{fee.status}</span>
                    </div>
                    <div className="panel__text mt-2">{fee.message}</div>
                    {fee.term && (
                      <div className="form-text-hint">
                        {fee.term}: {fee.days_covered} of {fee.term_days} days covered
                      </div>
                    )}
                    {data.ledger && (
                      <div className="kv-row mt-2" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "0.6rem", flexWrap: "wrap", justifyContent: "flex-start", gap: "0.35rem 1rem" }}>
                        <span>Opening <strong>KES {kes(data.ledger.opening)}</strong></span>
                        <span>Charged <strong>KES {kes(data.ledger.charged)}</strong></span>
                        <span>Paid <strong className="text-ok">KES {kes(data.ledger.paid)}</strong></span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Cafeteria */}
                <div className="col-md-6">
                  <div className="panel h-100">
                    <div className="panel__head">
                      <i className="bi bi-cup-hot" aria-hidden="true"></i>
                      <h6 className="panel__title">Cafeteria</h6>
                    </div>
                    {data.cafeteria?.available ? (
                      <>
                        <div className="fw-bold" style={{ fontSize: "var(--fs-2xl)", lineHeight: 1.1 }}>
                          KES {kes(data.cafeteria.wallet_balance)}
                        </div>
                        <div className="form-text-hint">Wallet balance</div>
                        <div className="kv-row mt-2">
                          <span>Plan</span>
                          <span>{data.cafeteria.plan || "No active plan"}</span>
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-soft">Cafeteria data is not linked yet.</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Guardians */}
              {data.guardians?.length > 0 && (
                <div className="panel mb-3">
                  <div className="panel__head">
                    <i className="bi bi-shield-check" aria-hidden="true"></i>
                    <h6 className="panel__title">Parents / guardians</h6>
                  </div>
                  {data.guardians.map((g, i) => (
                    <div key={i} className="profile-info-row">
                      <span>
                        <strong className="text-brand" style={{ color: "var(--ink-900)" }}>{g.name}</strong> ({g.relationship})
                      </span>
                      <span>
                        {g.phone_number || "no phone"} · {g.email || "no email"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Attendance history */}
              <div className="panel" style={FLUSH}>
                <div className="table-wrap__header">
                  <span className="panel-title">
                    <i className="bi bi-clock-history text-brand"></i>
                    Recent arrivals
                  </span>
                </div>
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Status</th>
                        <th>Fees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent.length === 0 && (
                        <tr>
                          <td colSpan="4" className="text-center cell-muted py-3">
                            No scans recorded yet.
                          </td>
                        </tr>
                      )}
                      {data.recent.map((r) => (
                        <tr key={r.date}>
                          <td>{fmtDate(r.date)}</td>
                          <td className="cell-mono">{r.time}</td>
                          <td>
                            <span className={`status-pill ${r.status === "LATE" ? "status-pill--warning" : "status-pill--success"}`}>
                              {r.status}
                            </span>
                          </td>
                          <td>{r.fee_status || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}