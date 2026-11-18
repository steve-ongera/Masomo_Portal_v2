import { useState } from "react";
import { boardingApi, unwrap } from "../../services/boardingApi";
import {  Loading, Msg, NoHostelNotice, useAccess, useAction, useLoad } from "./common";

export default function Hostels() {
  const access = useAccess();
  const act = useAction();
  const [selected, setSelected] = useState(null);
  const dorms = useLoad(async () => unwrap(await boardingApi.dormitories()), []);
  const [form, setForm] = useState({ name: "", gender: "M", description: "" });

  const create = async (e) => {
    e.preventDefault();
    const r = await act.run(() => boardingApi.createDormitory(form), "Hostel created.");
    if (r) { setForm({ name: "", gender: "M", description: "" }); dorms.reload(); }
  };

  const toggleActive = async (d) => {
    const r = await act.run(() => boardingApi.updateDormitory(d.id, { is_active: !d.is_active }), "Updated.");
    if (r) dorms.reload();
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.name}? This only works if nobody has ever slept in it.`)) return;
    const r = await act.run(() => boardingApi.deleteDormitory(d.id), "Deleted.");
    if (r) { if (selected === d.id) setSelected(null); dorms.reload(); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Hostels &amp; beds</h1>
          <p className="page-subtitle">Dormitories, rooms, and bed allocation</p>
        </div>
      </div>

      <NoHostelNotice />
      <Msg error={act.error || dorms.error} ok={act.ok} />
      <Loading loading={dorms.loading} />

      {access?.can_manage_structure && (
        <form className="table-wrap mb-3" onSubmit={create}>
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-plus-circle me-2 text-brand"></i>
              New hostel
            </span>
          </div>
          <div className="p-3">
            <div className="row g-3 align-items-end">
              <div className="col-md-5">
                <label className="form-label">Hostel name</label>
                <input
                  className="form-control"
                  placeholder="e.g. Mt Kenya"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Gender</label>
                <select
                  className="form-select"
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                >
                  <option value="M">Boys</option>
                  <option value="F">Girls</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">Description (optional)</label>
                <input
                  className="form-control"
                  placeholder="Description (optional)"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="col-12">
                <button className="btn btn-primary" disabled={act.busy}>
                  <i className="bi bi-check2 me-1"></i>
                  Create
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-building me-2 text-brand"></i>
            Hostels
          </span>
          {dorms.data && dorms.data.length > 0 && (
            <span className="chart-card__subtitle mb-0">
              {dorms.data.length} hostel{dorms.data.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {!dorms.loading && (dorms.data || []).length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-building"></i>
            <h6>No hostels yet</h6>
            <p className="text-muted-soft">
              Create your first hostel above to start setting up rooms and beds.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table-bordered mb-0">
              <thead>
                <tr>
                  <th>Hostel</th>
                  <th>Type</th>
                  <th>Wardens</th>
                  <th className="text-center">Rooms</th>
                  <th className="text-center">Beds</th>
                  <th className="text-center">Occupied</th>
                  <th className="text-center">Vacant</th>
                  <th style={{ width: 260 }} />
                </tr>
              </thead>
              <tbody>
                {(dorms.data || []).map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="cell-name">{d.name}</span>
                      {!d.is_active && <span className="text-muted-soft small ms-1">(inactive)</span>}
                    </td>
                    <td className="cell-muted small">{d.gender_display}</td>
                    <td className="cell-muted small">
                      {d.wardens.map((w) => w.name).join(", ") || "—"}
                    </td>
                    <td className="cell-mono text-center">{d.room_count}</td>
                    <td className="cell-mono text-center">{d.bed_count}</td>
                    <td className="cell-mono text-center">{d.occupied_count}</td>
                    <td className="cell-mono text-center">{d.vacant_count}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => setSelected(selected === d.id ? null : d.id)}
                        >
                          {selected === d.id ? "Close" : "Manage"}
                        </button>
                        {access?.can_manage_structure && (
                          <>
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => toggleActive(d)}
                            >
                              {d.is_active ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => remove(d)}
                            >
                              Delete
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

      {selected && (
        <HostelDetail
          dorm={(dorms.data || []).find((d) => d.id === selected)}
          access={access}
          onChanged={dorms.reload}
        />
      )}
    </div>
  );
}

function HostelDetail({ dorm, access, onChanged }) {
  const act = useAction();
  const beds = useLoad(async () => unwrap(await boardingApi.beds({ dormitory: dorm.id, page_size: 500 })), [dorm.id]);
  const [gen, setGen] = useState({ prefix: "", start: "", end: "", beds_per_room: 4 });

  const refresh = () => { beds.reload(); onChanged(); };

  const generate = async (e) => {
    e.preventDefault();
    const r = await act.run(() => boardingApi.generateRooms(dorm.id, gen), "Rooms generated.");
    if (r) {
      act.setOk(`Created ${r.data.rooms_created} room(s) and ${r.data.beds_created} bed(s).`);
      refresh();
    }
  };

  const toggleBed = async (b) => {
    const r = await act.run(() => boardingApi.updateBed(b.id, { is_active: !b.is_active }), "Bed updated.");
    if (r) refresh();
  };

  const addBeds = async (roomId) => {
    const n = window.prompt("How many beds to add to this room?", "1");
    if (!n) return;
    const r = await act.run(() => boardingApi.addBeds(roomId, Number(n)), "Beds added.");
    if (r) refresh();
  };

  const rooms = {};
  (beds.data || []).forEach((b) => {
    (rooms[b.room] = rooms[b.room] || { id: b.room, number: b.room_number, beds: [] }).beds.push(b);
  });

  return (
    <section className="mt-4">
      <div className="section-label mb-2">
        <i className="bi bi-building me-1"></i>
        {dorm.name}
      </div>
      <Msg error={act.error || beds.error} ok={act.ok} />

      {access?.can_manage_structure && <WardenPicker dorm={dorm} onSaved={onChanged} />}

      {access?.can_operate && (
        <form className="table-wrap mb-3" onSubmit={generate}>
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-grid-3x3-gap me-2 text-brand"></i>
              Generate rooms and beds
            </span>
          </div>
          <div className="p-3">
            <div className="row g-3 align-items-end">
              <div className="col-md-3">
                <label className="form-label">Prefix (optional)</label>
                <input
                  className="form-control"
                  placeholder="e.g. A"
                  value={gen.prefix}
                  onChange={(e) => setGen({ ...gen, prefix: e.target.value })}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">First room no.</label>
                <input
                  type="number"
                  className="form-control"
                  value={gen.start}
                  onChange={(e) => setGen({ ...gen, start: e.target.value })}
                  required
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Last room no.</label>
                <input
                  type="number"
                  className="form-control"
                  value={gen.end}
                  onChange={(e) => setGen({ ...gen, end: e.target.value })}
                  required
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Beds per room</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  className="form-control"
                  value={gen.beds_per_room}
                  onChange={(e) => setGen({ ...gen, beds_per_room: e.target.value })}
                  required
                />
              </div>
              <div className="col-12">
                <button className="btn btn-success" disabled={act.busy}>
                  <i className="bi bi-magic me-1"></i>
                  Generate
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      <Loading loading={beds.loading} />

      {Object.values(rooms).map((room) => (
        <div key={room.id} className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-door-open me-2 text-brand"></i>
              Room {room.number}
            </span>
            {access?.can_operate && (
              <button className="btn btn-sm btn-outline-primary" onClick={() => addBeds(room.id)}>
                <i className="bi bi-plus-lg me-1"></i>
                Add beds
              </button>
            )}
          </div>
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Bed</th>
                  <th>Status</th>
                  <th>Occupant</th>
                  <th style={{ width: 180 }} />
                </tr>
              </thead>
              <tbody>
                {room.beds.map((b) => (
                  <tr key={b.id}>
                    <td className="cell-mono">{b.number}</td>
                    <td>
                      {b.is_active ? (
                        <span className="badge badge-success">In use</span>
                      ) : (
                        <span className="badge badge-neutral">Out of service</span>
                      )}
                    </td>
                    <td>
                      {b.occupant ? (
                        <span className="cell-name">
                          {b.occupant.admission_no} {b.occupant.student_name}
                        </span>
                      ) : (
                        <span className="cell-muted">vacant</span>
                      )}
                    </td>
                    <td>
                      {access?.can_operate && (
                        <button
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => toggleBed(b)}
                        >
                          {b.is_active ? "Take out of service" : "Put back"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

function WardenPicker({ dorm, onSaved }) {
  const act = useAction();
  const users = useLoad(async () => (await boardingApi.wardenUsers()).data, []);
  const [picked, setPicked] = useState(dorm.wardens.map((w) => w.id));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = async () => {
    const r = await act.run(() => boardingApi.setWardens(dorm.id, picked), "Wardens saved.");
    if (r) onSaved();
  };
  return (
    <div className="table-wrap mb-3">
      <div className="table-wrap__header">
        <span className="chart-card__title mb-0">
          <i className="bi bi-people me-2 text-brand"></i>
          Hostel wardens
        </span>
      </div>
      <div className="p-3">
        <Msg error={act.error || users.error} ok={act.ok} />
        {(users.data || []).length === 0 && !users.loading && (
          <p className="form-text-hint">
            No users with the Hostel Warden role yet. Create one under Users.
          </p>
        )}
        {(users.data || []).length > 0 && (
          <div className="bulk-list list-unstyled mb-3">
            {(users.data || []).map((u) => (
              <div key={u.id} className="form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`warden-${u.id}`}
                  checked={picked.includes(u.id)}
                  onChange={() => toggle(u.id)}
                />
                <label className="form-check-label" htmlFor={`warden-${u.id}`}>
                  {u.name} ({u.username})
                </label>
              </div>
            ))}
          </div>
        )}
        <button className="btn btn-primary btn-sm" onClick={save} disabled={act.busy}>
          <i className="bi bi-check2 me-1"></i>
          Save wardens
        </button>
      </div>
    </div>
  );
}
