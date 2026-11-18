import { useMemo, useState } from "react";
import Modal from "../../components/Modal";
import { boardingApi, unwrap } from "../../services/boardingApi";
import {
  fmtDate,
  fmtDateTime,
  Msg,
  NoHostelNotice,
  useAction,
  useLoad,
  useYears,
  YearSelect,
} from "./common";

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------
export default function History() {
  const [tab, setTab] = useState("byYear"); // byYear | byStudent

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Boarding History</h1>
          <p className="page-subtitle">
            Who slept where, in any year — past years stay intact
          </p>
        </div>
      </div>

      <NoHostelNotice />

      {/* ---------- Tabs ---------- */}
      <ul className="nav nav-tabs mb-3" role="tablist">
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            className={`nav-link ${tab === "byYear" ? "active" : ""}`}
            onClick={() => setTab("byYear")}
          >
            <i className="bi bi-building me-2" />
            By hostel &amp; year
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            className={`nav-link ${tab === "byStudent" ? "active" : ""}`}
            onClick={() => setTab("byStudent")}
          >
            <i className="bi bi-person-lines-fill me-2" />
            By student
          </button>
        </li>
      </ul>

      {tab === "byYear" ? <HostelByYear /> : <StudentHistory />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header — same title/subtitle treatment as `table-wrap__header`
// ---------------------------------------------------------------------------
function SectionHeader({ icon, title, subtitle, count }) {
  return (
    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
      <div>
        <div className="chart-card__title">
          {icon && <i className={`bi ${icon} me-2 text-brand`} />}
          {title}
        </div>
        {subtitle && <div className="chart-card__subtitle">{subtitle}</div>}
      </div>
      {count != null && (
        <span className="chart-card__subtitle">
          {count} item{count !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hostel-by-year occupancy
// ---------------------------------------------------------------------------
function HostelByYear() {
  const act = useAction();
  const { years, current } = useYears();
  const dorms = useLoad(async () => unwrap(await boardingApi.dormitories()), []);
  const [dormId, setDormId] = useState("");
  const [year, setYear] = useState("");
  const [occ, setOcc] = useState(null);
  const [bedHist, setBedHist] = useState(null);
  const yearId = year || current?.id || "";

  const show = async () => {
    setBedHist(null);
    const r = await act.run(() => boardingApi.occupancy(dormId, yearId), "");
    if (r) setOcc(r.data);
  };

  const showBed = async (bedId) => {
    const r = await act.run(() => boardingApi.bedHistory(bedId), "");
    if (r) setBedHist(r.data);
  };

  const hasFilters = !!(dormId || yearId);

  return (
    <div>
      <Msg error={act.error || dorms.error} />

      {/* ---------- Filters ---------- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0">
            <select
              className="form-select w-auto"
              value={dormId}
              onChange={(e) => setDormId(e.target.value)}
              aria-label="Hostel"
            >
              <option value="">Hostel...</option>
              {(dorms.data || []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <YearSelect years={years} value={yearId} onChange={setYear} />

            <div className="toolbar__spacer" />

            <button
              className="btn btn-sm btn-primary"
              onClick={show}
              disabled={!dormId || !yearId || act.busy}
            >
              {act.busy ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Loading...
                </>
              ) : (
                <>
                  <i className="bi bi-search me-1" />
                  Show
                </>
              )}
            </button>

            {hasFilters && (
              <button
                className="btn btn-sm btn-light"
                onClick={() => {
                  setDormId("");
                  setYear("");
                  setOcc(null);
                }}
              >
                <i className="bi bi-x-lg" /> Clear
              </button>
            )}
          </div>

          {hasFilters && (
            <div className="d-flex flex-wrap gap-1">
              {dormId && (
                <span className="filter-chip">
                  Hostel:{" "}
                  {(dorms.data || []).find((d) => String(d.id) === String(dormId))?.name || "-"}
                  <button onClick={() => setDormId("")} aria-label="Clear hostel">
                    <i className="bi bi-x" />
                  </button>
                </span>
              )}
              {yearId && (
                <span className="filter-chip">
                  Year: {years?.find((y) => String(y.id) === String(yearId))?.year ?? yearId}
                  <button onClick={() => setYear("")} aria-label="Clear year">
                    <i className="bi bi-x" />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Results ---------- */}
      {!occ ? (
        <div className="empty-state">
          <i className="bi bi-calendar3" />
          <h6>Choose a hostel and a year</h6>
          <p className="text-muted-soft">
            Pick both, then press Show to see who slept where.
          </p>
        </div>
      ) : (
        <>
          <SectionHeader
            icon="bi-door-open"
            title={`${occ.dormitory.name} — ${occ.academic_year.year}`}
            subtitle="Occupants by room and bed for the selected year"
            count={occ.rooms.length}
          />

          {occ.rooms.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-door-closed" />
              <h6>No rooms in this hostel</h6>
              <p className="text-muted-soft">
                Rooms have not been set up for this hostel yet.
              </p>
            </div>
          ) : (
            <div className="row g-3">
              {occ.rooms.map((room) => (
                <div key={room.room} className="col-12 col-lg-6">
                  <div className="chart-card h-100">
                    <div className="chart-card__header">
                      <div>
                        <div className="chart-card__title">
                          <i className="bi bi-door-closed me-2 text-brand" />
                          Room {room.number}
                        </div>
                        <div className="chart-card__subtitle">
                          {room.beds.length} bed{room.beds.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>

                    {room.beds.length === 0 ? (
                      <p className="text-muted-soft small mb-0">No beds in this room.</p>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-hover table--stack table-sm mb-0">
                          <thead>
                            <tr>
                              <th>Bed</th>
                              <th>Occupants this year</th>
                              <th style={{ width: 100 }} />
                            </tr>
                          </thead>
                          <tbody>
                            {room.beds.map((b) => (
                              <tr key={b.bed}>
                                <td data-label="Bed" className="cell-mono fw-semibold">
                                  {b.number}
                                </td>
                                <td data-label="Occupants">
                                  {b.occupants.length === 0 ? (
                                    <span className="text-muted-soft">Vacant all year</span>
                                  ) : (
                                    <ul className="list-unstyled mb-0">
                                      {b.occupants.map((o) => (
                                        <li key={o.allocation} className="small">
                                          <span className="cell-mono text-brand fw-semibold">
                                            {o.admission_no}
                                          </span>{" "}
                                          {o.student_name}{" "}
                                          <span className="text-muted-soft">
                                            ({o.grade_name})
                                          </span>{" "}
                                          — {fmtDate(o.allocated_from)} to{" "}
                                          {o.is_current ? "now" : fmtDate(o.released_at)}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </td>
                                <td data-label="All years">
                                  <div className="table-actions">
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline-secondary btn-icon"
                                      title="Show every occupant of this bed"
                                      aria-label="Show every occupant of this bed"
                                      onClick={() => showBed(b.bed)}
                                    >
                                      <i className="bi bi-clock-history" />
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
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---------- Bed history modal ---------- */}
      <Modal
        show={!!bedHist}
        onClose={() => setBedHist(null)}
        title={bedHist ? `Every occupant of ${bedHist.bed.label}` : "Bed history"}
        size="lg"
      >
        {!bedHist ? null : bedHist.history.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-clock-history" />
            <h6>No occupants recorded</h6>
            <p className="text-muted-soft">
              Nobody has ever been assigned to this bed.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table--stack mb-0">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Adm no</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>From</th>
                  <th>Until</th>
                  <th>Why it ended</th>
                </tr>
              </thead>
              <tbody>
                {bedHist.history.map((h) => (
                  <tr key={h.id}>
                    <td data-label="Year" className="cell-num">
                      {h.year}
                    </td>
                    <td data-label="Adm no" className="cell-mono text-brand fw-semibold">
                      {h.admission_no}
                    </td>
                    <td data-label="Name" className="cell-name">
                      {h.student_name}
                    </td>
                    <td data-label="Class">{h.grade_name}</td>
                    <td data-label="From">{fmtDate(h.allocated_from)}</td>
                    <td data-label="Until">
                      {h.is_current ? (
                        <span className="badge badge-success">Now</span>
                      ) : (
                        fmtDateTime(h.released_at)
                      )}
                    </td>
                    <td data-label="Why it ended">
                      {h.release_reason_display || (h.is_current ? "—" : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student-by-student history
// ---------------------------------------------------------------------------
function StudentHistory() {
  const [q, setQ] = useState("");
  const act = useAction();
  const found = useLoad(
    async () =>
      q.trim().length >= 2
        ? unwrap(
            await boardingApi.registrations({
              academic_year: "all",
              q: q.trim(),
              page_size: 10,
            })
          )
        : [],
    [q]
  );
  const [pickedStudent, setPickedStudent] = useState(null);
  const [hist, setHist] = useState(null);

  const open = async (studentId) => {
    const r = await act.run(() => boardingApi.studentHistory(studentId), "");
    if (r) {
      setHist(r.data);
      setPickedStudent(
        (found.data || []).find((x) => x.student === studentId) || { student: studentId }
      );
    }
  };

  const closeModal = () => {
    setHist(null);
    setPickedStudent(null);
  };

  // One row per student in the search results.
  const students = useMemo(
    () => [...new Map((found.data || []).map((r) => [r.student, r])).values()],
    [found.data]
  );

  return (
    <div>
      <Msg error={act.error || found.error} />

      {/* ---------- Search ---------- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0">
            <div className="toolbar__search">
              <i className="bi bi-search" />
              <input
                type="text"
                className="form-control"
                placeholder="Search by name or admission no (min 2 letters)..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="toolbar__spacer" />
            {q && (
              <button className="btn btn-sm btn-light" onClick={() => setQ("")}>
                <i className="bi bi-x-lg" /> Clear
              </button>
            )}
          </div>

          {q.trim().length > 0 && q.trim().length < 2 && (
            <div className="form-text-hint mt-0">
              Type at least 2 characters to search.
            </div>
          )}
        </div>
      </div>

      {/* ---------- Result list ---------- */}
      {found.loading ? (
        <div className="text-center py-4">
          <span className="spinner-border spinner-border-sm me-2" />
          Searching...
        </div>
      ) : students.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-person-lines-fill" />
          <h6>
            {q.trim().length >= 2
              ? "No students match your search"
              : "Start typing to find a student"}
          </h6>
          <p className="text-muted-soft">
            {q.trim().length >= 2
              ? "Try a different name or admission number."
              : "Search by name or admission number, then open a student to see their beds year by year."}
          </p>
        </div>
      ) : (
        <div className="pick-list">
          {students.map((s) => (
            <button
              key={s.student}
              type="button"
              className="pick-item"
              onClick={() => open(s.student)}
            >
              <span>
                <span className="pick-item__adm">{s.admission_no}</span>
                <span className="cell-name">{s.student_name}</span>
                {s.class_name && (
                  <span className="text-muted-soft small ms-2">({s.class_name})</span>
                )}
              </span>
              <i className="bi bi-arrow-right-circle" />
            </button>
          ))}
        </div>
      )}

      {/* ---------- Student history modal ---------- */}
      <Modal
        show={!!pickedStudent}
        onClose={closeModal}
        title={
          pickedStudent
            ? `Beds for ${pickedStudent.student_name || pickedStudent.admission_no}`
            : "Student boarding history"
        }
        size="lg"
      >
        {!hist ? (
          <div className="text-center py-4">
            <span className="spinner-border spinner-border-sm me-2" />
            Loading history...
          </div>
        ) : hist.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-journal-x" />
            <h6>No boarding records</h6>
            <p className="text-muted-soft">
              This student has never boarded in any year.
            </p>
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {hist.map((h) => (
              <div key={h.registration.id} className="chart-card">
                <div className="chart-card__header">
                  <div>
                    <div className="chart-card__title">
                      <i className="bi bi-calendar3 me-2 text-brand" />
                      {h.registration.year} — {h.registration.grade_name}
                    </div>
                    <div className="chart-card__subtitle">
                      <span
                        className={`badge ${
                          h.registration.status === "ACTIVE" ||
                          h.registration.status === "REGISTERED"
                            ? "badge-success"
                            : "badge-neutral"
                        }`}
                      >
                        {h.registration.status}
                      </span>
                    </div>
                  </div>
                </div>

                {h.allocations.length === 0 ? (
                  <p className="text-muted-soft small mb-0">No bed that year.</p>
                ) : (
                  <ul className="list-unstyled mb-0">
                    {h.allocations.map((a) => (
                      <li
                        key={a.id}
                        className="d-flex justify-content-between align-items-start gap-2 border-bottom py-2"
                      >
                        <div>
                          <div className="fw-semibold">{a.bed_label}</div>
                          <div className="text-muted-soft small">
                            {fmtDate(a.allocated_from)} to{" "}
                            {a.is_current ? "now" : fmtDate(a.released_at)}
                            {a.release_reason_display && (
                              <> — {a.release_reason_display}</>
                            )}
                          </div>
                        </div>
                        {a.carried_over && (
                          <span className="badge badge-gold">Carried over</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
