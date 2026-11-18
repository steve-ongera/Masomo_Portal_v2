import { Link } from "react-router-dom";
import { boardingApi } from "../../services/boardingApi";
import { Msg, NoHostelNotice, useLoad } from "./common";

export default function BoardingDashboard() {
  const { data, loading, error } = useLoad(
    async () => (await boardingApi.dashboard()).data,
    []
  );
  const d = data;

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Boarding Dashboard</h1>
          <p className="page-subtitle">Overview of hostels, beds, and exeats</p>
        </div>
      </div>

      <NoHostelNotice />

      {loading ? (
        <div className="text-center py-4">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading dashboard...
        </div>
      ) : (
        <>
          <Msg error={error} />

          {d && (
            <>
              <p className="chart-card__subtitle mb-3">
                Academic year: <strong>{d.academic_year ?? "not set"}</strong>
              </p>

              {d.stale_allocations > 0 && (
                <div className="alert alert-warning d-flex align-items-start gap-2" role="alert">
                  <i className="bi bi-exclamation-triangle mt-1" />
                  <span>
                    {d.stale_allocations} bed(s) are still held by students from a past year.{" "}
                    <Link to="/warden/rollover">Run the year rollover</Link> to free them.
                  </span>
                </div>
              )}

              {/* ---------- Key metrics ---------- */}
              <div className="stat-grid">
                <div className="dm-card dm-card--primary">
                  <div className="dm-card__top">
                    <span className="dm-card__label">Boarders registered</span>
                    <span className="dm-card__icon">
                      <i className="bi bi-people" />
                    </span>
                  </div>
                  <div className="dm-card__num">{d.boarders}</div>
                  {d.unplaced_boarders > 0 && (
                    <div className="dm-card__sub text-owe">
                      <i className="bi bi-exclamation-circle me-1" />
                      {d.unplaced_boarders} without a bed
                    </div>
                  )}
                </div>

                <div className="dm-card dm-card--success">
                  <div className="dm-card__top">
                    <span className="dm-card__label">Beds occupied</span>
                    <span className="dm-card__icon">
                      <i className="bi bi-bed" />
                    </span>
                  </div>
                  <div className="dm-card__num">
                    {d.occupied_beds}
                    <span className="text-muted-soft small fw-normal ms-1">
                      / {d.total_beds}
                    </span>
                  </div>
                  <div className="dm-card__sub">{d.vacant_beds} vacant</div>
                </div>

                <div
                  className={`dm-card ${
                    d.pending_exeats > 0 ? "dm-card--warning" : "dm-card--primary"
                  }`}
                >
                  <div className="dm-card__top">
                    <span className="dm-card__label">Exeats awaiting decision</span>
                    <span className="dm-card__icon">
                      <i className="bi bi-clipboard-check" />
                    </span>
                  </div>
                  <div className="dm-card__num">{d.pending_exeats}</div>
                  <div className="dm-card__sub">
                    {d.approved_waiting} approved, not yet left
                  </div>
                </div>
              </div>

              {/* ---------- Secondary metrics ---------- */}
              <div className="table-wrap mb-3">
                <div className="table-wrap__header">
                  <span className="chart-card__title">
                    <i className="bi bi-clipboard-data me-2 text-brand" />
                    More metrics
                  </span>
                </div>
                <div className="p-3">
                  <div className="profile-info-row">
                    <span>Boarders without a bed</span>
                    <span className={d.unplaced_boarders > 0 ? "text-owe" : ""}>
                      {d.unplaced_boarders}
                    </span>
                  </div>
                  <div className="profile-info-row">
                    <span>Approved, not yet left</span>
                    <span>{d.approved_waiting}</span>
                  </div>
                  <div className="profile-info-row">
                    <span>Out of school now</span>
                    <span>{d.out_now}</span>
                  </div>
                  <div className="profile-info-row">
                    <span>Overdue (should be back)</span>
                    <span className={d.overdue > 0 ? "text-owe" : ""}>{d.overdue}</span>
                  </div>
                </div>
              </div>

              {/* ---------- Hostels ---------- */}
              <div className="table-wrap mb-3">
                <div className="table-wrap__header">
                  <span className="chart-card__title">
                    <i className="bi bi-building me-2 text-brand" />
                    Hostels
                  </span>
                  <span className="chart-card__subtitle">
                    {d.dormitories.length} hostel{d.dormitories.length === 1 ? "" : "s"}
                  </span>
                </div>
                {d.dormitories.length === 0 ? (
                  <div className="empty-state">
                    <i className="bi bi-building" />
                    <h6>No hostels yet</h6>
                    <p className="text-muted-soft">Add hostels under Hostels &amp; beds.</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover mb-0">
                      <thead>
                        <tr>
                          <th>Hostel</th>
                          <th>Type</th>
                          <th className="text-center">Rooms</th>
                          <th className="text-center">Beds</th>
                          <th className="text-center">Occupied</th>
                          <th className="text-center">Vacant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.dormitories.map((h) => (
                          <tr key={h.id}>
                            <td>
                              <span className="cell-name">{h.name}</span>
                              {!h.is_active && (
                                <span className="text-muted-soft small ms-1">(inactive)</span>
                              )}
                            </td>
                            <td className="cell-muted small">
                              {h.gender === "M" ? "Boys" : "Girls"}
                            </td>
                            <td className="cell-num">{h.room_count}</td>
                            <td className="cell-num">{h.bed_count}</td>
                            <td className="cell-num">{h.occupied_count}</td>
                            <td className="cell-num">{h.vacant_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ---------- Roll call today ---------- */}
              <div className="table-wrap">
                <div className="table-wrap__header">
                  <span className="chart-card__title">
                    <i className="bi bi-clock-history me-2 text-brand" />
                    Roll call today
                  </span>
                  <span className="chart-card__subtitle">Morning · Evening · Night</span>
                </div>
                {d.roll_call_today.length === 0 ? (
                  <div className="empty-state">
                    <i className="bi bi-clock-history" />
                    <h6>No roll calls recorded today</h6>
                    <p className="text-muted-soft">
                      Roll calls appear here as wardens take them.
                    </p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover mb-0">
                      <thead>
                        <tr>
                          <th>Hostel</th>
                          <th className="text-center">Morning</th>
                          <th className="text-center">Evening</th>
                          <th className="text-center">Night</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.roll_call_today.map((r) => (
                          <tr key={r.dormitory}>
                            <td>
                              <span className="cell-name">{r.name}</span>
                            </td>
                            {["MORNING", "EVENING", "NIGHT"].map((s) => (
                              <td key={s} className="text-center">
                                {r.done.includes(s) ? (
                                  <span className="badge badge-success">Started</span>
                                ) : (
                                  <span className="cell-muted">—</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
