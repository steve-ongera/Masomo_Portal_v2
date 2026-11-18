import { useState } from "react";
import { academicsApi } from "../../services/api";
import { boardingApi, unwrap } from "../../services/boardingApi";
import {  classLabel, Loading, Msg, NoHostelNotice, useAccess, useAction, useLoad, useYears, YearSelect } from "./common";

export default function Boarders() {
  const access = useAccess();
  const act = useAction();
  const { years, current } = useYears();
  const [year, setYear] = useState("");
  const [q, setQ] = useState("");
  const [allocated, setAllocated] = useState("");
  const yearId = year || current?.id || "";

  const list = useLoad(
    async () => unwrap(await boardingApi.registrations({
      academic_year: yearId || undefined, q: q || undefined, allocated: allocated || undefined, page_size: 500,
    })),
    [yearId, q, allocated]
  );

  const withdraw = async (r) => {
    const reason = window.prompt(`Withdraw ${r.student_name} from boarding? Their bed will be freed.\nReason:`, "");
    if (reason === null) return;
    const res = await act.run(() => boardingApi.withdraw(r.id, reason), "Withdrawn from boarding.");
    if (res) list.reload();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Boarders</h1>
          <p className="page-subtitle">Registered boarders and bed allocation</p>
        </div>
      </div>

      <NoHostelNotice />
      <Msg error={act.error || list.error} ok={act.ok} />

      {/* Toolbar */}
      <div className="table-wrap mb-3">
        <div className="toolbar p-3 mb-0">
          <YearSelect years={years} value={yearId} onChange={setYear} />
          <div className="toolbar__search" style={{ maxWidth: 260 }}>
            <i className="bi bi-search"></i>
            <input
              className="form-control"
              placeholder="Search name / adm no"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="form-select w-auto"
            value={allocated}
            onChange={(e) => setAllocated(e.target.value)}
          >
            <option value="">All</option>
            <option value="1">With a bed</option>
            <option value="0">Without a bed</option>
          </select>
        </div>
      </div>

      {access?.can_operate && yearId && <RegisterPanel yearId={yearId} onDone={list.reload} />}

      <Loading loading={list.loading} />

      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-people me-2 text-brand"></i>
            Boarders
          </span>
          <span className="chart-card__subtitle mb-0">
            {(list.data || []).length} boarder{(list.data || []).length === 1 ? "" : "s"}
          </span>
        </div>

        {!list.loading && (list.data || []).length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>No boarders registered</h6>
            <p className="text-muted-soft">
              {access?.can_operate && yearId
                ? "Use the panel above to register boarders for this year."
                : "Boarders appear here once registered."}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table-bordered mb-0">
              <thead>
                <tr>
                  <th>Adm no</th>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Class</th>
                  <th>Bed</th>
                  <th>Status</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {(list.data || []).map((r) => (
                  <tr key={r.id}>
                    <td className="cell-mono text-brand fw-semibold">{r.admission_no}</td>
                    <td className="cell-name">{r.student_name}</td>
                    <td>
                      <span className={`badge ${r.gender === "M" ? "badge-blue" : "badge-gold"}`}>
                        {r.gender === "M" ? "Male" : "Female"}
                      </span>
                    </td>
                    <td className="cell-muted small">{r.class_name}</td>
                    <td>
                      {r.current_bed ? (
                        <span className="cell-mono">{r.current_bed.label}</span>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${r.status === "REGISTERED" ? "badge-success" : "badge-neutral"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      {access?.can_operate && r.status === "REGISTERED" && (
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => withdraw(r)}
                        >
                          <i className="bi bi-box-arrow-right me-1"></i>
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RegisterPanel({ yearId, onDone }) {
  const act = useAction();
  const [q, setQ] = useState("");
  const [classroom, setClassroom] = useState("");
  const classrooms = useLoad(async () => unwrap(await academicsApi.classrooms({ academic_year: yearId })), [yearId]);
  const eligible = useLoad(
    async () => (q.trim().length >= 2 || classroom
      ? (await boardingApi.eligible({ academic_year: yearId, q: q.trim() || undefined, classroom: classroom || undefined })).data
      : []),
    [yearId, q, classroom]
  );

  const registerOne = async (s) => {
    const r = await act.run(() => boardingApi.registerStudent({ student: s.student, academic_year: yearId }), `${s.name} registered.`);
    if (r) { eligible.reload(); onDone(); }
  };

  const registerClass = async () => {
    if (!classroom) return;
    const r = await act.run(() => boardingApi.registerClassroom(classroom), "Class registered.");
    if (r) {
      const d = r.data;
      act.setOk(`Registered ${d.registered}, already registered ${d.already_registered}, skipped ${d.skipped.length}.`);
      eligible.reload();
      onDone();
    }
  };

  return (
    <section className="table-wrap mb-3">
      <div className="table-wrap__header">
        <span className="chart-card__title mb-0">
          <i className="bi bi-person-plus me-2 text-brand"></i>
          Register boarders
        </span>
      </div>
      <div className="p-3">
        <Msg error={act.error || eligible.error} ok={act.ok} />

        <div className="toolbar mb-3">
          <select
            className="form-select w-auto"
            value={classroom}
            onChange={(e) => setClassroom(e.target.value)}
          >
            <option value="">Pick a class…</option>
            {(classrooms.data || []).map((c) => (
              <option key={c.id} value={c.id}>{classLabel(c)}</option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            onClick={registerClass}
            disabled={!classroom || act.busy}
          >
            <i className="bi bi-people me-1"></i>
            Register the whole class
          </button>
        </div>

        <div className="toolbar mb-3">
          <div className="toolbar__search" style={{ maxWidth: 320 }}>
            <i className="bi bi-search"></i>
            <input
              className="form-control"
              placeholder="Or search a student (2+ letters)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {(eligible.data || []).length > 0 && (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Adm no</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th style={{ width: 180 }} />
                </tr>
              </thead>
              <tbody>
                {eligible.data.map((s) => (
                  <tr key={s.student}>
                    <td className="cell-mono text-brand">{s.admission_no}</td>
                    <td className="cell-name">{s.name}</td>
                    <td className="cell-muted small">{s.class_name}</td>
                    <td>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => registerOne(s)}
                        disabled={act.busy}
                      >
                        Register as boarder
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
