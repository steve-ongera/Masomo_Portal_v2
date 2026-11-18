import { useEffect, useState, useCallback } from "react";
import { recruitmentApi as api, hrList as list } from "../../services/api";
import Breadcrumb from "../../components/Breadcrumb";
import TableSkeleton from "../../components/TableSkeleton";
import Modal from "../../components/Modal";

const STAGE_LABEL = {
  APPLIED: "Applied",
  SHORTLISTED: "Shortlisted",
  INTERVIEWED: "Interviewed",
  SELECTED: "Selected",
  HIRED: "Hired",
  REJECTED: "Rejected",
};

const STAGE_META = {
  APPLIED: { badge: "badge-neutral", dot: "status-dot--pending" },
  SHORTLISTED: { badge: "badge-blue", dot: "status-dot--online" },
  INTERVIEWED: { badge: "badge-gold", dot: "status-dot--pending" },
  SELECTED: { badge: "badge-warning", dot: "status-dot--pending" },
  HIRED: { badge: "badge-success", dot: "status-dot--online" },
  REJECTED: { badge: "badge-danger", dot: "status-dot--offline" },
};

const NEXT = {
  APPLIED: ["SHORTLISTED", "REJECTED"],
  SHORTLISTED: ["INTERVIEWED", "REJECTED"],
  INTERVIEWED: ["SELECTED", "REJECTED"],
  SELECTED: [],
  REJECTED: [],
  HIRED: [],
};

const CATEGORY = {
  TEACHER: "Teacher",
  ADMINISTRATION: "Administration",
  ACCOUNTS: "Accounts",
  ICT: "ICT",
  SUPPORT: "Support staff",
};

const blankVacancy = { title: "", openings: 1 };
const blankApplicant = {
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  national_id: "",
};

export default function Recruitment() {
  const [vacancies, setVacancies] = useState([]);
  const [vacanciesLoading, setVacanciesLoading] = useState(true);
  const [currentVacancyId, setCurrentVacancyId] = useState(null);

  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);

  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("info");

  const [showVacancyModal, setShowVacancyModal] = useState(false);
  const [vacancyForm, setVacancyForm] = useState(blankVacancy);
  const [vacancySaving, setVacancySaving] = useState(false);

  const [showApplicantModal, setShowApplicantModal] = useState(false);
  const [applicantForm, setApplicantForm] = useState(blankApplicant);
  const [applicantSaving, setApplicantSaving] = useState(false);

  const [showHireModal, setShowHireModal] = useState(false);
  const [hireTarget, setHireTarget] = useState(null);
  const [hireCategory, setHireCategory] = useState("TEACHER");
  const [hireSaving, setHireSaving] = useState(false);
  const [hireResult, setHireResult] = useState(null);

  const err = (e) => {
    setMsg(
      e.response?.data?.detail || "That did not work. Please check the details."
    );
    setMsgType("danger");
  };

  const loadVacancies = useCallback(async () => {
    setVacanciesLoading(true);
    try {
      const r = await api.vacancies();
      setVacancies(list(r));
    } catch (e) {
      err(e);
    } finally {
      setVacanciesLoading(false);
    }
  }, []);

  const loadApplications = useCallback(async (vacancyId) => {
    setApplicationsLoading(true);
    try {
      const r = await api.applications(vacancyId);
      setApplications(list(r));
    } catch (e) {
      err(e);
    } finally {
      setApplicationsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVacancies();
  }, [loadVacancies]);

  useEffect(() => {
    if (currentVacancyId) loadApplications(currentVacancyId);
    else setApplications([]);
  }, [currentVacancyId, loadApplications]);

  const currentVacancy = vacancies.find((v) => v.id === currentVacancyId) || null;

  const openVacancyModal = () => {
    setVacancyForm(blankVacancy);
    setShowVacancyModal(true);
  };

  const submitVacancy = async (e) => {
    e.preventDefault();
    setVacancySaving(true);
    try {
      await api.createVacancy({
        ...vacancyForm,
        openings: Number(vacancyForm.openings) || 1,
      });
      setMsg("Vacancy posted successfully.");
      setMsgType("success");
      setShowVacancyModal(false);
      setVacancyForm(blankVacancy);
      await loadVacancies();
    } catch (x) {
      err(x);
    } finally {
      setVacancySaving(false);
    }
  };

  const openApplicantModal = () => {
    setApplicantForm(blankApplicant);
    setShowApplicantModal(true);
  };

  const submitApplicant = async (e) => {
    e.preventDefault();
    setApplicantSaving(true);
    try {
      await api.addApplication({ ...applicantForm, vacancy: currentVacancyId });
      setMsg("Applicant added.");
      setMsgType("success");
      setShowApplicantModal(false);
      setApplicantForm(blankApplicant);
      await Promise.all([loadApplications(currentVacancyId), loadVacancies()]);
    } catch (x) {
      err(x);
    } finally {
      setApplicantSaving(false);
    }
  };

  const move = async (id, stage) => {
    try {
      await api.update(id, { stage });
      setMsg(`Moved to ${STAGE_LABEL[stage]}.`);
      setMsgType("success");
      await loadApplications(currentVacancyId);
    } catch (e) {
      err(e);
    }
  };

  const openHire = (applicant) => {
    setHireTarget(applicant);
    setHireCategory("TEACHER");
    setHireResult(null);
    setShowHireModal(true);
  };

  const submitHire = async (e) => {
    e.preventDefault();
    if (!hireTarget) return;
    setHireSaving(true);
    try {
      const { data } = await api.hire(hireTarget.id, { category: hireCategory });
      setHireResult({
        applicant_name: `${hireTarget.first_name} ${hireTarget.last_name}`,
        employee_no: data.employee_no,
      });
      await Promise.all([loadApplications(currentVacancyId), loadVacancies()]);
    } catch (e) {
      err(e);
      setShowHireModal(false);
    } finally {
      setHireSaving(false);
    }
  };

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "HR", href: "/admin/hr" },
          { label: "Recruitment", href: "#" },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">Recruitment</h1>
          <p className="page-subtitle">
            Post vacancies, track applicants and hire into the payroll register
          </p>
        </div>
        <button className="btn btn-primary" onClick={openVacancyModal}>
          <i className="bi bi-plus-lg me-1"></i>
          Post Vacancy
        </button>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show`} role="alert">
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      <div className="row g-3">
        <div className="col-lg-4">
          <div className="table-wrap">
            <div className="table-wrap__header">
              <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                <i className="bi bi-megaphone me-2"></i>
                Open Vacancies
              </span>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
                {vacancies.length} total
              </span>
            </div>

            {vacanciesLoading ? (
              <div className="p-3">
                <div className="skeleton skeleton-text" style={{ width: "70%" }}></div>
                <div className="skeleton skeleton-text" style={{ width: "50%" }}></div>
                <div className="skeleton skeleton-text" style={{ width: "60%" }}></div>
              </div>
            ) : vacancies.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-megaphone"></i>
                <h6>No vacancies posted yet</h6>
                <p className="text-muted-soft">Click "Post Vacancy" to advertise your first opening.</p>
              </div>
            ) : (
              <div className="list-group list-group-flush">
                {vacancies.map((x) => {
                  const active = x.id === currentVacancyId;
                  return (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setCurrentVacancyId(x.id)}
                      className="text-start"
                      style={{
                        display: "block",
                        width: "100%",
                        border: "none",
                        borderBottom: "1px solid var(--border-color)",
                        padding: "0.75rem 0.9rem",
                        background: active ? "var(--blue-50)" : "transparent",
                        borderLeft: active ? "3px solid var(--blue-700)" : "3px solid transparent",
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "var(--fs-md)",
                          color: active ? "var(--blue-800)" : "var(--ink-900)",
                        }}
                      >
                        {x.title}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginTop: "0.2rem",
                          fontSize: "var(--fs-xs)",
                          color: "var(--ink-400)",
                        }}
                      >
                        <span>
                          <i className="bi bi-people me-1"></i>
                          {x.applicants} applicant{x.applicants === 1 ? "" : "s"}
                        </span>
                        {x.openings ? (
                          <span>
                            <i className="bi bi-briefcase me-1"></i>
                            {x.openings} opening{x.openings === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="col-lg-8">
          {!currentVacancy ? (
            <div className="table-wrap">
              <div className="empty-state">
                <i className="bi bi-arrow-left-circle"></i>
                <h6>Select a vacancy to see its applicants</h6>
                <p className="text-muted-soft">
                  Pick a vacancy on the left to review applicants and progress them
                  through the pipeline.
                </p>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <div
                className="table-wrap__header"
                style={{ flexDirection: "column", alignItems: "stretch", gap: "0.75rem" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                    <i className="bi bi-people me-2"></i>
                    {currentVacancy.title} — Applicants
                  </span>
                  <div className="d-flex align-items-center gap-2">
                    <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
                      {applications.length} applicant{applications.length !== 1 ? "s" : ""}
                    </span>
                    <button className="btn btn-sm btn-primary" onClick={openApplicantModal}>
                      <i className="bi bi-plus-lg me-1"></i>
                      Add Applicant
                    </button>
                  </div>
                </div>
              </div>

              {applicationsLoading ? (
                <TableSkeleton rows={6} columns={4} />
              ) : applications.length === 0 ? (
                <div className="empty-state">
                  <i className="bi bi-person-plus"></i>
                  <h6>No applicants yet</h6>
                  <p className="text-muted-soft">
                    Click "Add Applicant" to register the first candidate for this vacancy.
                  </p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th>Applicant</th>
                        <th>Contact</th>
                        <th>Stage</th>
                        <th style={{ width: "260px" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applications.map((x) => {
                        const meta = STAGE_META[x.stage] || STAGE_META.APPLIED;
                        const nextStages = NEXT[x.stage] || [];
                        const fullName = `${x.first_name} ${x.last_name}`.trim();
                        return (
                          <tr key={x.id}>
                            <td>
                              <div className="table-avatar-cell">
                                <div className="avatar-sm">
                                  {(fullName || "")
                                    .split(" ")
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((n) => n[0])
                                    .join("")}
                                </div>
                                <span className="cell-name">{fullName}</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ fontSize: "var(--fs-xs)", lineHeight: 1.35 }}>
                                {x.phone ? (
                                  <div>
                                    <i className="bi bi-telephone me-1 text-muted-soft"></i>
                                    {x.phone}
                                  </div>
                                ) : null}
                                {x.email ? (
                                  <div>
                                    <i className="bi bi-envelope me-1 text-muted-soft"></i>
                                    {x.email}
                                  </div>
                                ) : null}
                                {!x.phone && !x.email ? <span className="cell-muted">—</span> : null}
                              </div>
                            </td>
                            <td>
                              <span className={`badge ${meta.badge}`}>
                                <span className={`status-dot ${meta.dot}`}></span>
                                {STAGE_LABEL[x.stage] || x.stage}
                              </span>
                            </td>
                            <td>
                              <div className="table-actions">
                                {nextStages.map((s) => (
                                  <button
                                    key={s}
                                    className={`btn btn-sm btn-icon ${
                                      s === "REJECTED" ? "btn-outline-danger" : "btn-outline-primary"
                                    }`}
                                    title={s === "REJECTED" ? "Reject" : `Move to ${STAGE_LABEL[s]}`}
                                    onClick={() => move(x.id, s)}
                                  >
                                    <i
                                      className={`bi ${
                                        s === "REJECTED" ? "bi-x-lg" : "bi-arrow-right-circle"
                                      }`}
                                    ></i>
                                  </button>
                                ))}
                                {x.stage === "SELECTED" && (
                                  <button
                                    className="btn btn-sm btn-success"
                                    onClick={() => openHire(x)}
                                    title="Hire and create employee"
                                  >
                                    <i className="bi bi-person-check me-1"></i>
                                    Hire
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
            </div>
          )}
        </div>
      </div>

      <Modal show={showVacancyModal} onClose={() => setShowVacancyModal(false)} title="Post Vacancy">
        <form onSubmit={submitVacancy}>
          <div className="row g-3">
            <div className="col-12">
              <label className="form-label">Vacancy Title</label>
              <input
                className="form-control"
                required
                placeholder="e.g. Grade 4 Class Teacher"
                value={vacancyForm.title}
                onChange={(e) => setVacancyForm({ ...vacancyForm, title: e.target.value })}
              />
            </div>
            <div className="col-12">
              <label className="form-label">Number of Openings</label>
              <input
                type="number"
                min={1}
                className="form-control"
                required
                value={vacancyForm.openings}
                onChange={(e) => setVacancyForm({ ...vacancyForm, openings: e.target.value })}
              />
              <div className="form-text" style={{ fontSize: "var(--fs-xs)" }}>
                How many hires this vacancy is intended to fill.
              </div>
            </div>
          </div>

          <div className="mt-3 d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-secondary" onClick={() => setShowVacancyModal(false)}>
              Cancel
            </button>
            <button className="btn btn-success" type="submit" disabled={vacancySaving}>
              {vacancySaving ? "Posting..." : "Post Vacancy"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal show={showApplicantModal} onClose={() => setShowApplicantModal(false)} title="Add Applicant" size="lg">
        {currentVacancy && (
          <form onSubmit={submitApplicant}>
            <p className="text-muted-soft" style={{ fontSize: "var(--fs-xs)" }}>
              Applying for: <strong>{currentVacancy.title}</strong>
            </p>

            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">First Name</label>
                <input
                  className="form-control"
                  required
                  value={applicantForm.first_name}
                  onChange={(e) => setApplicantForm({ ...applicantForm, first_name: e.target.value })}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Last Name</label>
                <input
                  className="form-control"
                  required
                  value={applicantForm.last_name}
                  onChange={(e) => setApplicantForm({ ...applicantForm, last_name: e.target.value })}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Phone</label>
                <input
                  className="form-control"
                  placeholder="07XXXXXXXX"
                  value={applicantForm.phone}
                  onChange={(e) => setApplicantForm({ ...applicantForm, phone: e.target.value })}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">National ID</label>
                <input
                  className="form-control"
                  value={applicantForm.national_id}
                  onChange={(e) => setApplicantForm({ ...applicantForm, national_id: e.target.value })}
                />
              </div>
              <div className="col-12">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  className="form-control"
                  value={applicantForm.email}
                  onChange={(e) => setApplicantForm({ ...applicantForm, email: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-3 d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowApplicantModal(false)}>
                Cancel
              </button>
              <button className="btn btn-success" type="submit" disabled={applicantSaving}>
                {applicantSaving ? "Saving..." : "Add Applicant"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        show={showHireModal}
        onClose={() => {
          setShowHireModal(false);
          setHireResult(null);
        }}
        title="Hire Applicant"
      >
        {hireTarget && (
          hireResult ? (
            <div>
              <div className="alert alert-success">
                <strong>{hireResult.applicant_name}</strong> hired as{" "}
                <strong>{hireResult.employee_no}</strong>.
              </div>
              <p className="text-muted-soft" style={{ fontSize: "var(--fs-xs)" }}>
                Add their salary under <strong>Payroll</strong> to complete onboarding.
              </p>
              <div className="d-flex justify-content-end">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowHireModal(false);
                    setHireResult(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submitHire}>
              <div className="modal-icon-circle modal-icon-circle--success">
                <i className="bi bi-person-check"></i>
              </div>
              <p className="text-center mb-3">
                Hiring <strong>{hireTarget.first_name} {hireTarget.last_name}</strong>.
                A staff record and an employee number will be created.
              </p>

              <label className="form-label">Staff Category</label>
              <select className="form-select" value={hireCategory} onChange={(e) => setHireCategory(e.target.value)}>
                {Object.entries(CATEGORY).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <div className="form-text" style={{ fontSize: "var(--fs-xs)" }}>
                Their category drives the payroll rules and default permissions.
              </div>

              <div className="mt-3 d-flex gap-2 justify-content-end">
                <button type="button" className="btn btn-secondary" onClick={() => setShowHireModal(false)}>
                  Cancel
                </button>
                <button className="btn btn-success" type="submit" disabled={hireSaving}>
                  {hireSaving ? "Hiring..." : "Hire and Create Employee"}
                </button>
              </div>
            </form>
          )
        )}
      </Modal>
    </div>
  );
}