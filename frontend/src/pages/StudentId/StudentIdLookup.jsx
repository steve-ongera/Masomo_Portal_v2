import { useState } from "react";
import { studentIdApi } from "../../services/studentIdApi";
import QrScanner from "../../components/QrScanner";
import { fmtDate } from "./StudentIdCardView";

const kes = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const FEE_COLOR = { CLEARED: "#15803d", GRACE: "#d97706", OWING: "#b91c1c" };

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
        <div>
          <h1 className="page-title">Student ID Lookup</h1>
          <p className="page-subtitle">Scan a student's ID card to see their live fee, cafeteria and attendance details.</p>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-4">
          <div className="table-wrap p-3">
            <QrScanner onScan={(text) => lookup({ qr_token: text })} />
            <div className="input-group mt-3">
              <input
                className="form-control"
                placeholder="Or type admission number"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && manual.trim() && lookup({ admission_no: manual.trim() })}
              />
              <button
                className="btn btn-outline-primary"
                disabled={!manual.trim() || loading}
                onClick={() => lookup({ admission_no: manual.trim() })}
              >
                Look up
              </button>
            </div>
          </div>
        </div>

        <div className="col-lg-8">
          {error && <div className="alert alert-danger">{error}</div>}
          {!data && !error && (
            <div className="empty-state">
              <i className="bi bi-qr-code-scan"></i>
              <h6>No student scanned</h6>
              <p className="text-muted-soft">Scan an ID card to load the student's details.</p>
            </div>
          )}

          {data && (
            <>
              {/* Identity */}
              <div className="table-wrap mb-3">
                <div className="p-3 d-flex gap-3">
                  <div
                    style={{
                      width: 110, height: 140, flex: "0 0 110px", borderRadius: 8, overflow: "hidden",
                      background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {data.student.photo_url ? (
                      <img src={data.student.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <i className="bi bi-person fs-1 text-muted"></i>
                    )}
                  </div>
                  <div className="flex-grow-1">
                    <div className="fs-4 fw-bold text-uppercase">
                      {data.student.surname} {data.student.given_names}
                    </div>
                    <div className="cell-muted mb-2">
                      Adm {data.student.admission_no} · {data.student.sex} · {data.student.nationality}
                    </div>
                    <div className="row small g-2">
                      <div className="col-sm-6"><b>Class:</b> {data.class.classroom || "-"}</div>
                      <div className="col-sm-6"><b>Stream:</b> {data.class.stream || "-"}</div>
                      <div className="col-sm-6"><b>D.O.B:</b> {fmtDate(data.student.date_of_birth)}</div>
                      <div className="col-sm-6"><b>Address:</b> {data.student.address || "-"}</div>
                      {data.card && (
                        <>
                          <div className="col-sm-6">
                            <b>Card:</b> {data.card.card_number}{" "}
                            <span className={`badge ${data.card.status === "ACTIVE" && !data.card.expired ? "badge-success" : "badge-danger"}`}>
                              {data.card.expired ? "EXPIRED" : data.card.status_display}
                            </span>
                          </div>
                          <div className="col-sm-6"><b>Expires:</b> {fmtDate(data.card.expiry_date)}</div>
                        </>
                      )}
                    </div>
                    <div className="mt-2">
                      {data.today.checked_in ? (
                        <span className="badge badge-success">In school today · {data.today.time} ({data.today.status})</span>
                      ) : (
                        <span className="badge badge-neutral">Not scanned in today</span>
                      )}
                      {!data.student.is_active && <span className="badge badge-danger ms-2">Inactive student</span>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="row g-3 mb-3">
                {/* Fees */}
                <div className="col-md-6">
                  <div className="table-wrap h-100">
                    <div className="p-3">
                      <div className="chart-card__title mb-2">Fees</div>
                      <div className="fs-3 fw-bold" style={{ color: FEE_COLOR[fee.status] }}>
                        {bal < 0 ? `Credit KES ${kes(Math.abs(bal))}` : `KES ${kes(bal)}`}
                      </div>
                      <span className="badge" style={{ background: FEE_COLOR[fee.status] }}>{fee.status}</span>
                      <div className="small mt-2">{fee.message}</div>
                      {fee.term && (
                        <div className="small cell-muted mt-1">
                          {fee.term}: {fee.days_covered} of {fee.term_days} days covered
                        </div>
                      )}
                      {data.ledger && (
                        <div className="small mt-2 border-top pt-2">
                          Opening KES {kes(data.ledger.opening)} · Charged KES {kes(data.ledger.charged)} · Paid KES {kes(data.ledger.paid)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cafeteria */}
                <div className="col-md-6">
                  <div className="table-wrap h-100">
                    <div className="p-3">
                      <div className="chart-card__title mb-2">Cafeteria</div>
                      {data.cafeteria?.available ? (
                        <>
                          <div className="fs-3 fw-bold">KES {kes(data.cafeteria.wallet_balance)}</div>
                          <div className="small cell-muted">Wallet balance</div>
                          <div className="mt-2"><b>Plan:</b> {data.cafeteria.plan || "No active plan"}</div>
                        </>
                      ) : (
                        <div className="cell-muted">Cafeteria data is not linked yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Guardians */}
              {data.guardians?.length > 0 && (
                <div className="table-wrap mb-3">
                  <div className="p-3">
                    <div className="chart-card__title mb-2">Parents / guardians</div>
                    {data.guardians.map((g, i) => (
                      <div key={i} className="small">
                        <b>{g.name}</b> ({g.relationship}) · {g.phone_number || "no phone"} · {g.email || "no email"}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attendance history */}
              <div className="table-wrap">
                <div className="table-wrap__header">
                  <span className="chart-card__title mb-0">Recent arrivals</span>
                </div>
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr><th>Date</th><th>Time</th><th>Status</th><th>Fees</th></tr></thead>
                    <tbody>
                      {data.recent.length === 0 && (
                        <tr><td colSpan="4" className="text-center cell-muted py-3">No scans recorded yet.</td></tr>
                      )}
                      {data.recent.map((r) => (
                        <tr key={r.date}>
                          <td>{fmtDate(r.date)}</td>
                          <td className="cell-mono">{r.time}</td>
                          <td><span className={`badge ${r.status === "LATE" ? "badge-warning" : "badge-success"}`}>{r.status}</span></td>
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