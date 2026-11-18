import { useEffect, useState, useCallback, useMemo } from "react";
import { hrApi, payrollApi, hrList as list } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import Modal from "../../components/Modal";
import PayslipView from "./PayslipView";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const RUN_STATUS_META = {
  DRAFT: { badge: "badge-warning", dot: "status-dot--pending", label: "Draft" },
  APPROVED: { badge: "badge-blue", dot: "status-dot--online", label: "Approved" },
  PAID: { badge: "badge-success", dot: "status-dot--online", label: "Paid" },
  CANCELLED: { badge: "badge-neutral", dot: "status-dot--offline", label: "Cancelled" },
};

const fmtMoney = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const now = new Date();

export default function Payroll() {
  const [staff, setStaff] = useState([]);
  const [salaries, setSalaries] = useState({});
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [generating, setGenerating] = useState(false);

  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("info");

  const [activeTab, setActiveTab] = useState("runs");

  const [openRun, setOpenRun] = useState(null);
  const [slips, setSlips] = useState(null);
  const [slipsLoading, setSlipsLoading] = useState(false);

  const [shown, setShown] = useState(null);

  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approveTarget, setApproveTarget] = useState(null);
  const [approveSaving, setApproveSaving] = useState(false);

  const [showPaidModal, setShowPaidModal] = useState(false);
  const [paidTarget, setPaidTarget] = useState(null);
  const [paidSaving, setPaidSaving] = useState(false);

  // payslip editing
  const [editSlip, setEditSlip] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [override, setOverride] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const err = (e) => {
    setMsg(e.response?.data?.detail || "That did not work. Please try again.");
    setMsgType("danger");
  };

  // returns the fresh list of runs so callers don't rely on stale state
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, salRes, runRes] = await Promise.all([
        hrApi.employees.list({ status: "ACTIVE" }),
        payrollApi.salaries(),
        payrollApi.runs(),
      ]);
      const fresh = list(runRes);
      setStaff(list(empRes));
      setSalaries(Object.fromEntries(list(salRes).map((s) => [s.employee, s])));
      setRuns(fresh);
      return fresh;
    } catch (e) {
      err(e);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fetchSlips = async (id) => {
    setSlipsLoading(true);
    try {
      const res = await payrollApi.payslips(id);
      setSlips(list(res));
    } catch (e) {
      err(e);
    } finally {
      setSlipsLoading(false);
    }
  };

  const viewRun = async (id, source = runs) => {
    setOpenRun(source.find((r) => r.id === id) || { id });
    setSlips(null);
    await fetchSlips(id);
  };

  const generate = async () => {
    const existing = runs.find((r) => r.year === ym.year && r.month === ym.month);
    if (
      existing?.status === "DRAFT" &&
      !window.confirm(
        "A draft already exists for this month. Generating again rebuilds ALL payslips and discards any manual edits.\n\nTo only add newly added staff, use “Add missing staff” instead.\n\nRebuild anyway?"
      )
    ) {
      return;
    }
    setGenerating(true);
    try {
      const { data } = await payrollApi.generate(ym.year, ym.month);
      setMsg(`Generated ${data.payslips} payslips as a draft.`);
      setMsgType("success");
      const fresh = await load();
      await viewRun(data.id, fresh);
    } catch (e) {
      err(e);
    } finally {
      setGenerating(false);
    }
  };

  const addMissing = async (run) => {
    setSyncing(true);
    try {
      const { data } = await payrollApi.syncRun(run.id);
      const parts = [`Added ${data.added} missing staff to the draft.`];
      if (data.skipped.length) {
        parts.push(`No salary structure yet for: ${data.skipped.join(", ")}.`);
      }
      setMsg(parts.join(" "));
      setMsgType(data.added || !data.skipped.length ? "success" : "warning");
      const fresh = await load();
      if (openRun?.id === run.id) {
        setOpenRun(fresh.find((r) => r.id === run.id) || openRun);
        await fetchSlips(run.id);
      }
    } catch (e) {
      err(e);
    } finally {
      setSyncing(false);
    }
  };

  const openApprove = (run) => {
    setApproveTarget(run);
    setShowApproveModal(true);
  };

  const confirmApprove = async (e) => {
    e.preventDefault();
    if (!approveTarget) return;
    setApproveSaving(true);
    try {
      await payrollApi.approve(approveTarget.id);
      setMsg("Approved and locked. Staff can now see their payslips.");
      setMsgType("success");
      setShowApproveModal(false);
      const fresh = await load();
      if (openRun?.id === approveTarget.id) await viewRun(approveTarget.id, fresh);
    } catch (e) {
      err(e);
      setShowApproveModal(false);
    } finally {
      setApproveSaving(false);
    }
  };

  const openPaid = (run) => {
    setPaidTarget(run);
    setShowPaidModal(true);
  };

  const confirmPaid = async (e) => {
    e.preventDefault();
    if (!paidTarget) return;
    setPaidSaving(true);
    try {
      await payrollApi.markPaid(paidTarget.id);
      setMsg("Marked as paid.");
      setMsgType("success");
      setShowPaidModal(false);
      await load();
    } catch (e) {
      err(e);
      setShowPaidModal(false);
    } finally {
      setPaidSaving(false);
    }
  };

  const saveSalary = async (emp, f) => {
    const body = {
      employee: emp.id,
      basic: f.basic,
      house_allowance: f.house_allowance || 0,
      transport_allowance: f.transport_allowance || 0,
      other_allowance: f.other_allowance || 0,
    };
    try {
      await payrollApi.saveSalary(body, salaries[emp.id]?.id);
      setMsg(`Salary saved for ${emp.full_name}.`);
      setMsgType("success");
      await load();
    } catch (e) {
      err(e);
    }
  };

  // ---- payslip editing ----
  const openEdit = (s) => {
    const e = s.breakdown?.earnings || {};
    setEditSlip(s);
    setOverride(false);
    setEditForm({
      basic: e["Basic salary"] ?? "",
      house_allowance: e["House allowance"] ?? 0,
      transport_allowance: e["Transport allowance"] ?? 0,
      other_allowance: e["Other allowance"] ?? 0,
      other_deductions: s.other_deductions,
      paye: s.paye,
      nssf: s.nssf,
      shif: s.shif,
      housing_levy: s.housing_levy,
    });
  };

  const ef = (k) => (e) => setEditForm({ ...editForm, [k]: e.target.value });

  const saveEdit = async (ev) => {
    ev.preventDefault();
    setEditSaving(true);
    try {
      const payload = { ...editForm };
      if (!override) ["paye", "nssf", "shif", "housing_levy"].forEach((k) => delete payload[k]);
      await payrollApi.editPayslip(openRun.id, editSlip.id, payload);
      setMsg(`Payslip updated for ${editSlip.employee_name}.`);
      setMsgType("success");
      setEditSlip(null);
      const fresh = await load();
      setOpenRun(fresh.find((r) => r.id === openRun.id) || openRun);
      await fetchSlips(openRun.id);
    } catch (e) {
      err(e);
    } finally {
      setEditSaving(false);
    }
  };

  const totalNetThisPage = useMemo(
    () => runs.reduce((sum, r) => sum + (Number(r.total_net) || 0), 0),
    [runs]
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-subtitle">
            Generate monthly payslips, review runs, and manage salary structures
          </p>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show`} role="alert">
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      {/* ---- Run Payroll panel ---- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-play-circle me-2 text-brand"></i>
            Run Payroll
          </span>
          <span className="chart-card__subtitle mb-0">
            Generates draft payslips for all active staff
          </span>
        </div>

        <div className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-sm-4 col-md-3">
              <label className="form-label">Month</label>
              <select
                className="form-select"
                value={ym.month}
                onChange={(e) => setYm({ ...ym, month: Number(e.target.value) })}
              >
                {MONTHS.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
            <div className="col-sm-4 col-md-3">
              <label className="form-label">Year</label>
              <input
                type="number"
                className="form-control"
                value={ym.year}
                min={2000}
                max={2100}
                onChange={(e) => setYm({ ...ym, year: Number(e.target.value) })}
              />
            </div>
            <div className="col-sm-4 col-md-6 d-flex justify-content-sm-start justify-content-md-end">
              <button className="btn btn-primary" onClick={generate} disabled={generating}>
                {generating ? (
                  "Generating..."
                ) : (
                  <>
                    <i className="bi bi-receipt me-1"></i>
                    Generate Payslips
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="form-text-hint mt-3">
            Generates draft payslips for every active staff member. Generating again for a month that
            already has a draft rebuilds every payslip and discards manual edits — to add newly hired
            staff to an existing draft, use <strong>Add missing</strong> on the run instead. Statutory
            rates (PAYE, NSSF, SHIF, housing levy) are effective-dated records in the database —
            confirm them before your first real run.
          </div>
        </div>
      </div>

      {/* ---- Tab strip ---- */}
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === "runs" ? "active" : ""}`}
            onClick={() => setActiveTab("runs")}
          >
            <i className="bi bi-list-check me-1"></i>
            Payroll Runs
            {runs.length > 0 && (
              <span className="badge badge-neutral ms-2">
                {runs.length}
              </span>
            )}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === "structures" ? "active" : ""}`}
            onClick={() => setActiveTab("structures")}
          >
            <i className="bi bi-cash-stack me-1"></i>
            Salary Structures
            {staff.length > 0 && (
              <span className="badge badge-neutral ms-2">
                {staff.length}
              </span>
            )}
          </button>
        </li>
      </ul>

      {/* ---- Payroll Runs tab ---- */}
      {activeTab === "runs" && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-journal-text me-2 text-brand"></i>
              Payroll Runs
            </span>
            <span className="chart-card__subtitle mb-0">
              {runs.length} run{runs.length === 1 ? "" : "s"}
            </span>
          </div>

          {loading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-journal-text"></i>
              <h6>No payroll runs yet</h6>
              <p className="text-muted-soft">Use the panel above to generate the first payroll run.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "140px" }}>Period</th>
                    <th style={{ width: "100px" }}>Staff</th>
                    <th style={{ width: "160px" }}>Net Total</th>
                    <th style={{ width: "140px" }}>Status</th>
                    <th style={{ width: "340px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const meta = RUN_STATUS_META[r.status] || {
                      badge: "badge-neutral",
                      dot: "status-dot--offline",
                      label: r.status,
                    };
                    return (
                      <tr key={r.id}>
                        <td>
                          <span className="cell-name">
                            {MONTHS[r.month - 1]} {r.year}
                          </span>
                        </td>
                        <td>
                          <span className="cell-mono fw-semibold">{r.staff}</span>
                        </td>
                        <td>
                          <span className="cell-mono text-brand fw-semibold">
                            {fmtMoney(r.total_net)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${meta.badge}`}>
                            <span className={`status-dot ${meta.dot}`}></span>
                            {meta.label}
                          </span>
                        </td>
                        <td>
                          <div className="table-actions">
                            <button className="btn btn-sm btn-outline-primary" onClick={() => viewRun(r.id)} title="View payslips">
                              <i className="bi bi-eye me-1"></i>
                              View
                            </button>
                            {r.status === "DRAFT" && (
                              <button
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => addMissing(r)}
                                disabled={syncing}
                                title="Add staff who have no payslip in this draft"
                              >
                                <i className="bi bi-person-plus me-1"></i>
                                Add missing
                              </button>
                            )}
                            {r.status === "DRAFT" && (
                              <button className="btn btn-sm btn-success" onClick={() => openApprove(r)}>
                                <i className="bi bi-check2 me-1"></i>
                                Approve
                              </button>
                            )}
                            {r.status === "APPROVED" && (
                              <button className="btn btn-sm btn-primary" onClick={() => openPaid(r)}>
                                <i className="bi bi-cash-coin me-1"></i>
                                Mark Paid
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && runs.length > 0 && (
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <strong>{runs.length}</strong> run{runs.length === 1 ? "" : "s"} · Total net{" "}
                <strong>{fmtMoney(totalNetThisPage)}</strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ---- Salary Structures tab ---- */}
      {activeTab === "structures" && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-cash-stack me-2 text-brand"></i>
              Salary Structures
            </span>
            <span className="chart-card__subtitle mb-0">
              {staff.length} active staff
            </span>
          </div>

          {loading ? (
            <TableSkeleton rows={8} columns={6} />
          ) : staff.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-people"></i>
              <h6>No active staff</h6>
              <p className="text-muted-soft">
                Once employees are hired and active, their salary structures can be set here.
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th style={{ width: "130px" }}>Basic</th>
                    <th style={{ width: "130px" }}>House</th>
                    <th style={{ width: "130px" }}>Transport</th>
                    <th style={{ width: "130px" }}>Other</th>
                    <th style={{ width: "110px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((e) => (
                    <SalaryRow key={e.id} emp={e} s={salaries[e.id]} onSave={saveSalary} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---- Payslips modal ---- */}
      <Modal
        show={!!openRun}
        onClose={() => {
          setOpenRun(null);
          setSlips(null);
        }}
        title={openRun?.month ? `Payslips — ${MONTHS[openRun.month - 1]} ${openRun.year}` : "Payslips"}
        size="lg"
      >
        {openRun && (
          <div>
            {openRun.status && (
              <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                <span
                  className={`badge ${
                    (RUN_STATUS_META[openRun.status] || {}).badge || "badge-neutral"
                  }`}
                >
                  <span
                    className={`status-dot ${
                      (RUN_STATUS_META[openRun.status] || {}).dot || "status-dot--offline"
                    }`}
                  ></span>
                  {(RUN_STATUS_META[openRun.status] || {}).label || openRun.status}
                </span>
                {openRun.staff && (
                  <span className="form-text-hint m-0">
                    {openRun.staff} staff · net total <strong>{fmtMoney(openRun.total_net)}</strong>
                  </span>
                )}
                {openRun.status === "DRAFT" && (
                  <button
                    className="btn btn-sm btn-outline-primary ms-auto"
                    onClick={() => addMissing(openRun)}
                    disabled={syncing}
                  >
                    <i className="bi bi-person-plus me-1"></i>
                    {syncing ? "Adding..." : "Add missing staff"}
                  </button>
                )}
              </div>
            )}

            {slipsLoading ? (
              <div className="text-center py-4">
                <div className="page-loader__ring" style={{ margin: "0 auto" }} />
              </div>
            ) : !slips || slips.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-receipt"></i>
                <h6>No payslips</h6>
                <p className="text-muted-soft">This run has no payslips attached yet.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th className="text-end">Gross</th>
                      <th className="text-end">PAYE</th>
                      <th className="text-end">NSSF</th>
                      <th className="text-end">SHIF</th>
                      <th className="text-end">Housing</th>
                      <th className="text-end">Other</th>
                      <th className="text-end">Net</th>
                      <th style={{ width: "120px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {slips.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <span className="cell-name">{s.employee_name}</span>
                          {s.breakdown?.edited && (
                            <span className="badge badge-neutral ms-2" title="Manually edited">Edited</span>
                          )}
                        </td>
                        <td className="cell-mono text-end">{fmtMoney(s.gross)}</td>
                        <td className="cell-mono text-end">{fmtMoney(s.paye)}</td>
                        <td className="cell-mono text-end">{fmtMoney(s.nssf)}</td>
                        <td className="cell-mono text-end">{fmtMoney(s.shif)}</td>
                        <td className="cell-mono text-end">{fmtMoney(s.housing_levy)}</td>
                        <td className="cell-mono text-end">{fmtMoney(s.other_deductions)}</td>
                        <td className="cell-mono text-end fw-bold">
                          {fmtMoney(s.net)}
                        </td>
                        <td className="text-nowrap">
                          {openRun.status === "DRAFT" && (
                            <button
                              className="btn btn-sm btn-outline-secondary btn-icon me-1"
                              title="Edit payslip"
                              aria-label="Edit payslip"
                              onClick={() => openEdit(s)}
                            >
                              <i className="bi bi-pencil"></i>
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-outline-primary btn-icon"
                            title="Open payslip"
                            aria-label="Open payslip"
                            onClick={() => setShown(s)}
                          >
                            <i className="bi bi-file-earmark-text"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ---- Edit payslip modal ---- */}
      <Modal
        show={!!editSlip}
        onClose={() => setEditSlip(null)}
        title={`Edit payslip — ${editSlip?.employee_name || ""}`}
      >
        {editSlip && (
          <form onSubmit={saveEdit}>
            <div className="row g-3">
              {[
                ["basic", "Basic salary"],
                ["house_allowance", "House allowance"],
                ["transport_allowance", "Transport allowance"],
                ["other_allowance", "Other allowance"],
                ["other_deductions", "Other deductions"],
              ].map(([k, label]) => (
                <div className="col-6" key={k}>
                  <label className="form-label">{label}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="form-control"
                    value={editForm[k]}
                    onChange={ef(k)}
                  />
                </div>
              ))}
            </div>

            <div className="form-check mt-3">
              <input
                id="override-statutory"
                type="checkbox"
                className="form-check-input"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              <label htmlFor="override-statutory" className="form-check-label">
                Override PAYE / NSSF / SHIF / Housing levy manually
              </label>
            </div>

            {override ? (
              <div className="row g-3 mt-1">
                {[
                  ["paye", "PAYE"],
                  ["nssf", "NSSF"],
                  ["shif", "SHIF"],
                  ["housing_levy", "Housing levy"],
                ].map(([k, label]) => (
                  <div className="col-6" key={k}>
                    <label className="form-label">{label}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="form-control"
                      value={editForm[k]}
                      onChange={ef(k)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="form-text-hint mt-2">
                PAYE, NSSF, SHIF and housing levy are recalculated automatically from the new earnings.
              </div>
            )}

            <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setEditSlip(null)}>
                Cancel
              </button>
              <button className="btn btn-success" type="submit" disabled={editSaving}>
                {editSaving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---- Approve modal ---- */}
      <Modal show={showApproveModal} onClose={() => setShowApproveModal(false)} title="Approve Payroll Run">
        {approveTarget && (
          <form onSubmit={confirmApprove}>
            <div className="modal-icon-circle modal-icon-circle--success">
              <i className="bi bi-check2-circle"></i>
            </div>
            <p className="text-center mb-3">
              Approve <strong>{MONTHS[approveTarget.month - 1]} {approveTarget.year}</strong>{" "}
              payroll run for <strong>{approveTarget.staff}</strong> staff?
            </p>

            <div className="note-card">
              <div>
                <strong>Net total:</strong> {fmtMoney(approveTarget.total_net)}
              </div>
              <div className="mt-1 small">
                Once approved, the run is <strong>locked</strong> and staff can see their payslips. It
                cannot be edited afterwards.
              </div>
            </div>

            <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowApproveModal(false)}>
                Cancel
              </button>
              <button className="btn btn-success" type="submit" disabled={approveSaving}>
                {approveSaving ? "Approving..." : "Approve and Lock"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---- Mark Paid modal ---- */}
      <Modal show={showPaidModal} onClose={() => setShowPaidModal(false)} title="Mark as Paid">
        {paidTarget && (
          <form onSubmit={confirmPaid}>
            <div className="modal-icon-circle modal-icon-circle--info">
              <i className="bi bi-cash-coin"></i>
            </div>
            <p className="text-center mb-3">
              Mark <strong>{MONTHS[paidTarget.month - 1]} {paidTarget.year}</strong> payroll run as paid?
            </p>

            <div className="note-card">
              <div>
                <strong>Net total:</strong> {fmtMoney(paidTarget.total_net)}
              </div>
              <div className="mt-1 small">
                Use this only after salaries have been paid out — it settles the run and closes it off.
              </div>
            </div>

            <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowPaidModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={paidSaving}>
                {paidSaving ? "Marking..." : "Mark as Paid"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {shown && <PayslipView slip={shown} onClose={() => setShown(null)} />}
    </div>
  );
}

function SalaryRow({ emp, s, onSave }) {
  const [f, setF] = useState({
    basic: s?.basic || "",
    house_allowance: s?.house_allowance || "",
    transport_allowance: s?.transport_allowance || "",
    other_allowance: s?.other_allowance || "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (s) {
      setF({
        basic: s.basic,
        house_allowance: s.house_allowance,
        transport_allowance: s.transport_allowance,
        other_allowance: s.other_allowance,
      });
    }
  }, [s]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(emp, f);
    } finally {
      setSaving(false);
    }
  };

  const gross = [f.basic, f.house_allowance, f.transport_allowance, f.other_allowance].reduce(
    (sum, v) => sum + (Number(v) || 0),
    0
  );

  const dirty = !!s
    ? Number(s.basic) !== Number(f.basic) ||
      Number(s.house_allowance || 0) !== Number(f.house_allowance || 0) ||
      Number(s.transport_allowance || 0) !== Number(f.transport_allowance || 0) ||
      Number(s.other_allowance || 0) !== Number(f.other_allowance || 0)
    : !!f.basic;

  const input = (k) => (
    <input
      type="number"
      min={0}
      className="form-control"
      style={{ minWidth: "110px" }}
      value={f[k]}
      onChange={set(k)}
    />
  );

  return (
    <tr>
      <td>
        <div className="table-avatar-cell">
          <div className="avatar-sm">
            {(emp.full_name || "")
              .split(" ")
              .filter(Boolean)
              .slice(0, 2)
              .map((n) => n[0])
              .join("")}
          </div>
          <div>
            <div className="cell-name">{emp.full_name}</div>
            <div className="cell-muted small mt-1">
              {emp.employee_no}
            </div>
          </div>
        </div>
      </td>
      <td>{input("basic")}</td>
      <td>{input("house_allowance")}</td>
      <td>{input("transport_allowance")}</td>
      <td>{input("other_allowance")}</td>
      <td>
        <div className="d-flex flex-column align-items-start gap-1">
          <button
            className="btn btn-sm btn-success"
            disabled={!f.basic || !dirty || saving}
            onClick={handleSave}
            title={!dirty ? "No changes to save" : "Save salary"}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {dirty && f.basic && (
            <span className="form-text-hint text-nowrap m-0">
              Gross: {fmtMoney(gross)}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}