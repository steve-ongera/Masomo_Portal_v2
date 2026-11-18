import { useMemo, useState } from "react";
import { boardingApi, unwrap } from "../../services/boardingApi";
import { Loading, Msg, NoHostelNotice, useAccess, useAction, useLoad } from "./common";

export default function Allocations() {
  const access = useAccess();
  const act = useAction();

  const dorms = useLoad(
    async () => unwrap(await boardingApi.dormitories({ active: 1 })),
    []
  );

  const [dormId, setDormId] = useState("");
  const [picked, setPicked] = useState(null); // registration awaiting / changing a bed
  const [mode, setMode] = useState("allocate"); // allocate | transfer
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("unplaced"); // unplaced | placed

  const unplaced = useLoad(
    async () =>
      unwrap(
        await boardingApi.registrations({
          allocated: 0,
          status: "REGISTERED",
          q: q || undefined,
          page_size: 200,
        })
      ),
    [q]
  );

  const placed = useLoad(
    async () =>
      unwrap(
        await boardingApi.registrations({
          allocated: 1,
          status: "REGISTERED",
          q: q || undefined,
          page_size: 200,
        })
      ),
    [q]
  );

  const dormObj = (dorms.data || []).find((d) => String(d.id) === String(dormId));

  const vacant = useLoad(
    async () =>
      dormId
        ? unwrap(await boardingApi.beds({ dormitory: dormId, status: "vacant", page_size: 500 }))
        : [],
    [dormId]
  );

  const refresh = () => {
    unplaced.reload();
    placed.reload();
    vacant.reload();
    dorms.reload();
  };

  const give = async (bed) => {
    if (!picked) return;
    const fn =
      mode === "allocate"
        ? () => boardingApi.allocate({ registration: picked.id, bed: bed.id })
        : () => boardingApi.transfer({ registration: picked.id, bed: bed.id });
    const r = await act.run(fn, `${picked.student_name} → ${bed.label}`);
    if (r) {
      setPicked(null);
      refresh();
    }
  };

  const release = async (reg) => {
    if (!window.confirm(`Free ${reg.student_name}'s bed? The history is kept.`)) return;
    const r = await act.run(
      () => boardingApi.release(reg.current_bed.allocation, { reason: "CORRECTION" }),
      "Bed freed."
    );
    if (r) refresh();
  };

  const autoAllocate = async () => {
    if (!dormId) return;
    if (
      !window.confirm(
        `Auto-fill vacant beds in ${dormObj?.name} with unplaced boarders of the right gender?`
      )
    )
      return;
    const r = await act.run(() => boardingApi.autoAllocate({ dormitory: dormId }), "Done.");
    if (r) {
      act.setOk(
        `Allocated ${r.data.allocated}. Still without a bed: ${r.data.still_unplaced}. Beds left: ${r.data.beds_left}.`
      );
      refresh();
    }
  };

  // Only beds of the right gender are useful for the picked student.
  const bedsForPicked = useMemo(
    () => (vacant.data || []).filter((b) => !picked || b.dormitory_gender === picked.gender),
    [vacant.data, picked]
  );

  const hasFilters = !!(q || dormId);
  const activeList = tab === "unplaced" ? unplaced : placed;
  const activeRows = activeList.data || [];
  const combinedError = act.error || dorms.error || unplaced.error || placed.error || vacant.error;

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Bed Allocation</h1>
          <p className="page-subtitle">Allocate, move and free boarders' beds across the hostels</p>
        </div>
        <div className="page-header__actions">
          {access?.can_operate && (
            <button
              className="btn btn-outline-primary btn-sm"
              onClick={autoAllocate}
              disabled={!dormId || act.busy}
              title={!dormId ? "Choose a hostel first" : undefined}
            >
              <i className="bi bi-magic" />
              Auto-allocate
            </button>
          )}
        </div>
      </div>

      <NoHostelNotice />
      <Msg error={combinedError} ok={act.ok} />

      {/* ---------- Chosen student banner ---------- */}
      {picked && (
        <div
          className="alert alert-primary d-flex align-items-center flex-wrap gap-2"
          role="status"
        >
          <i className="bi bi-person-check" />
          <span>
            <strong>{mode === "allocate" ? "Allocating" : "Moving"}:</strong>{" "}
            <span className="font-mono">{picked.admission_no}</span> {picked.student_name}{" "}
            <span className="badge badge-neutral">{picked.gender}</span>
          </span>
          <span className="ms-auto d-flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-light"
              onClick={() => setPicked(null)}
            >
              <i className="bi bi-x-lg" /> Cancel
            </button>
          </span>
        </div>
      )}

      <div className="row g-3">
        {/* ---------- Left: boarders list ---------- */}
        <div className="col-12 col-lg-7">
          <div className="table-wrap">
            <div className="table-wrap__header flex-column align-items-stretch gap-3">
              {/* Search + hostel + auto-allocate */}
              <div className="toolbar mb-0">
                <div className="toolbar__search">
                  <i className="bi bi-search" />
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search name / adm no..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>

                <select
                  className="form-select w-auto"
                  value={dormId}
                  onChange={(e) => setDormId(e.target.value)}
                  aria-label="Hostel"
                >
                  <option value="">All hostels</option>
                  {(dorms.data || []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.vacant_count} vacant)
                    </option>
                  ))}
                </select>

                <div className="toolbar__spacer" />

                {hasFilters && (
                  <button
                    className="btn btn-sm btn-light"
                    onClick={() => {
                      setQ("");
                      setDormId("");
                    }}
                  >
                    <i className="bi bi-x-lg" /> Clear
                  </button>
                )}
              </div>

              {/* Filter chips */}
              {hasFilters && (
                <div className="d-flex flex-wrap gap-1">
                  {q && (
                    <span className="filter-chip">
                      Search: "{q}"
                      <button onClick={() => setQ("")} aria-label="Clear search">
                        <i className="bi bi-x" />
                      </button>
                    </span>
                  )}
                  {dormObj && (
                    <span className="filter-chip">
                      Hostel: {dormObj.name}
                      <button onClick={() => setDormId("")} aria-label="Clear hostel">
                        <i className="bi bi-x" />
                      </button>
                    </span>
                  )}
                </div>
              )}

              {/* Tabs + count */}
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <ul className="nav nav-tabs" role="tablist">
                  <li className="nav-item" role="presentation">
                    <button
                      type="button"
                      className={`nav-link ${tab === "unplaced" ? "active" : ""}`}
                      onClick={() => setTab("unplaced")}
                    >
                      Without a bed
                      <span className="badge badge-gold ms-2">
                        {(unplaced.data || []).length}
                      </span>
                    </button>
                  </li>
                  <li className="nav-item" role="presentation">
                    <button
                      type="button"
                      className={`nav-link ${tab === "placed" ? "active" : ""}`}
                      onClick={() => setTab("placed")}
                    >
                      With a bed
                      <span className="badge badge-success ms-2">
                        {(placed.data || []).length}
                      </span>
                    </button>
                  </li>
                </ul>
                <span className="chart-card__subtitle">
                  {activeRows.length} boarder{activeRows.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {activeList.loading ? (
              <div className="text-center py-4">
                <span className="spinner-border spinner-border-sm me-2" />
                Loading boarders...
              </div>
            ) : activeRows.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-person-bed" />
                <h6>
                  {tab === "unplaced"
                    ? q || dormId
                      ? "No boarders match your search"
                      : "Every boarder has a bed"
                    : q || dormId
                    ? "No placed boarders match your search"
                    : "No boarders have a bed yet"}
                </h6>
                <p className="text-muted-soft">
                  {tab === "unplaced"
                    ? "New registrations will appear here."
                    : "Allocate a bed to a boarder to see them here."}
                </p>
              </div>
            ) : tab === "unplaced" ? (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th>Admission No</th>
                      <th>Name</th>
                      <th>Gender</th>
                      <th>Class</th>
                      <th style={{ width: 110 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Admission No" className="cell-mono text-brand fw-semibold">
                          {r.admission_no}
                        </td>
                        <td data-label="Name">
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">
                              {(r.student_name || "")
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <span className="cell-name">{r.student_name}</span>
                          </div>
                        </td>
                        <td data-label="Gender">
                          <span
                            className={`badge ${
                              r.gender === "M" ? "badge-blue" : "badge-gold"
                            }`}
                          >
                            {r.gender === "M" ? "Male" : "Female"}
                          </span>
                        </td>
                        <td data-label="Class">{r.class_name || "-"}</td>
                        <td data-label="Actions">
                          <div className="table-actions">
                            {access?.can_operate && (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary btn-icon"
                                title="Pick boarder"
                                aria-label="Pick boarder"
                                onClick={() => {
                                  setPicked(r);
                                  setMode("allocate");
                                }}
                              >
                                <i className="bi bi-hand-index" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th>Admission No</th>
                      <th>Name</th>
                      <th>Class</th>
                      <th>Bed</th>
                      <th style={{ width: 140 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.map((r) => (
                      <tr key={r.id}>
                        <td data-label="Admission No" className="cell-mono text-brand fw-semibold">
                          {r.admission_no}
                        </td>
                        <td data-label="Name">
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">
                              {(r.student_name || "")
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <span className="cell-name">{r.student_name}</span>
                          </div>
                        </td>
                        <td data-label="Class">{r.class_name || "-"}</td>
                        <td data-label="Bed">
                          <span className="badge badge-neutral">
                            {r.current_bed?.label || "-"}
                          </span>
                        </td>
                        <td data-label="Actions">
                          <div className="table-actions">
                            {access?.can_operate && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-secondary btn-icon"
                                  title="Move to another bed"
                                  aria-label="Move to another bed"
                                  onClick={() => {
                                    setPicked(r);
                                    setMode("transfer");
                                  }}
                                >
                                  <i className="bi bi-arrow-left-right" />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger btn-icon"
                                  title="Free bed"
                                  aria-label="Free bed"
                                  onClick={() => release(r)}
                                >
                                  <i className="bi bi-box-arrow-up" />
                                </button>
                              </>
                            )}
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

        {/* ---------- Right: bed picker ---------- */}
        <div className="col-12 col-lg-5">
          <div className="chart-card h-100">
            <div className="chart-card__header">
              <div>
                <div className="chart-card__title">
                  <i className="bi bi-door-closed me-2 text-brand" />
                  Vacant beds{dormObj ? ` in ${dormObj.name}` : ""}
                </div>
                <div className="chart-card__subtitle">
                  {picked
                    ? `Showing beds for a ${picked.gender === "M" ? "male" : "female"} boarder`
                    : "Pick a boarder on the left to assign a bed"}
                </div>
              </div>
              {picked && (
                <span className="badge badge-blue">
                  {mode === "allocate" ? "Allocate" : "Transfer"}
                </span>
              )}
            </div>

            {!dormId ? (
              <div className="empty-state">
                <i className="bi bi-building" />
                <h6>Choose a hostel</h6>
                <p className="text-muted-soft">
                  Pick a hostel from the dropdown to see its vacant beds.
                </p>
              </div>
            ) : vacant.loading ? (
              <div className="text-center py-4">
                <span className="spinner-border spinner-border-sm me-2" />
                Loading beds...
              </div>
            ) : bedsForPicked.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-door-closed" />
                <h6>
                  {picked
                    ? `No vacant beds for a ${picked.gender === "M" ? "male" : "female"} boarder`
                    : "No vacant beds here"}
                </h6>
                <p className="text-muted-soft">
                  {picked
                    ? "Try a different hostel, or free a bed first."
                    : "All beds in this hostel are occupied."}
                </p>
              </div>
            ) : (
              <div className="pick-list">
                {bedsForPicked.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="pick-item"
                    disabled={!picked || act.busy}
                    onClick={() => give(b)}
                  >
                    <span>
                      <span className="pick-item__adm">
                        R{b.room_number} · Bed {b.number}
                      </span>
                      {b.label && <span className="text-muted-soft small">{b.label}</span>}
                    </span>
                    <i className="bi bi-arrow-right-circle" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
