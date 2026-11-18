import { useEffect, useState } from "react";
import api, { academicsApi, calendarApi, teacherApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import Pagination from "../../components/Pagination";

// IDs can be integers (subject, classroom, year) OR UUID strings (teacher/user),
// so always compare them as strings. Never use parseInt() on an ID.
const sameId = (a, b) => String(a) === String(b);

export default function AdminTeacherAllocation() {
  const [activeTab, setActiveTab] = useState("all"); // "all" | "unallocated"

  const [allocations, setAllocations] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [form, setForm] = useState({ teacher: "", subject: "", classroom: "", academic_year: "" });

  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({ teacher: "", subject: "", classroom: "", academic_year: "" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // ---- unallocated-subjects tab state ----
  const [gaps, setGaps] = useState([]);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [gapYear, setGapYear] = useState("");
  const [gapClassroom, setGapClassroom] = useState("");
  const [assigningKey, setAssigningKey] = useState(null); // `${classroomId}-${subjectId}`
  const [assignTeacher, setAssignTeacher] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [a, u, s, c, y] = await Promise.all([
        api.get("/teacher-allocations/"),
        api.get("/users/", { params: { role: "TEACHER", page_size: 500 } }),
        academicsApi.subjects(),
        academicsApi.allClassrooms(), // unpaginated, so no classroom is missing from the dropdowns
        calendarApi.academicYears(),
      ]);
      setAllocations(a.data.results ?? a.data);
      setTeachers(u.data.results ?? u.data);
      setSubjects(s.data.results ?? s.data);
      setClassrooms(c.data.results ?? c.data);
      const yearList = y.data.results ?? y.data;
      setYears(yearList);
      const current = yearList.find((yr) => yr.is_current) || yearList[0];
      if (current) {
        setForm((f) => ({ ...f, academic_year: f.academic_year || current.id }));
        setGapYear((v) => v || current.id);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const loadGaps = async () => {
    if (!gapYear) return;
    setGapsLoading(true);
    try {
      const params = { academic_year: gapYear };
      if (gapClassroom) params.classroom = gapClassroom;
      const res = await teacherApi.unallocated(params);
      setGaps(res.data);
    } catch (err) {
      console.error("Failed to load unallocated subjects:", err);
    } finally {
      setGapsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "unallocated") loadGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, gapYear, gapClassroom]);

  const addAllocation = async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      await api.post("/teacher-allocations/", form);
      setForm((f) => ({ ...f, teacher: "", subject: "", classroom: "" }));
      await loadAll();
      setMessage("Allocation saved. This teacher can now enter marks for this subject/classroom.");
      setMessageType("success");
    } catch (err) {
      setMessage(err.response?.data ? JSON.stringify(err.response.data) : "Could not save allocation.");
      setMessageType("danger");
    } finally {
      setLoading(false);
    }
  };

  const deleteAllocation = async (id) => {
    try {
      await api.delete(`/teacher-allocations/${id}/`);
      await loadAll();
    } catch (err) {
      setMessage(err.response?.data ? JSON.stringify(err.response.data) : "Could not delete allocation.");
      setMessageType("danger");
    }
  };

  const assignFromGap = async (classroomId, subjectId) => {
    if (!assignTeacher) return;
    try {
      await api.post("/teacher-allocations/", {
        teacher: assignTeacher, subject: subjectId, classroom: classroomId, academic_year: gapYear,
      });
      setAssigningKey(null);
      setAssignTeacher("");
      await Promise.all([loadAll(), loadGaps()]);
      setMessage("Teacher assigned. This gap is now closed.");
      setMessageType("success");
    } catch (err) {
      setMessage(err.response?.data ? JSON.stringify(err.response.data) : "Could not assign teacher.");
      setMessageType("danger");
    }
  };

  // ---- Filter and Search Logic (client-side) ----
  const filteredAllocations = allocations.filter((a) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      const matchTeacher = a.teacher_name?.toLowerCase().includes(query);
      const matchSubject = a.subject_name?.toLowerCase().includes(query);
      const matchClassroom = a.classroom_label?.toLowerCase().includes(query);
      if (!matchTeacher && !matchSubject && !matchClassroom) return false;
    }
    if (filters.teacher && !sameId(a.teacher, filters.teacher)) return false;
    if (filters.subject && !sameId(a.subject, filters.subject)) return false;
    if (filters.classroom && !sameId(a.classroom, filters.classroom)) return false;
    if (filters.academic_year && !sameId(a.academic_year, filters.academic_year)) return false;
    return true;
  });

  const totalItems = filteredAllocations.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = filteredAllocations.slice(startIndex, endIndex);

  // reset to page 1 whenever the search/filters/page size change
  useEffect(() => { setCurrentPage(1); }, [searchQuery, filters, itemsPerPage]);

  const handlePageChange = (page) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setFilters({ teacher: "", subject: "", classroom: "", academic_year: "" });
    setCurrentPage(1);
  };

  const activeFilterCount =
    (searchQuery ? 1 : 0) + (filters.teacher ? 1 : 0) + (filters.subject ? 1 : 0) +
    (filters.classroom ? 1 : 0) + (filters.academic_year ? 1 : 0);

  const gapTotal = gaps.reduce((n, g) => n + g.subjects.length, 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Teacher Allocation</h1>
          <p className="page-subtitle">
            A teacher can be allocated the same subject in multiple classrooms — e.g. Grade 9 Red
            English and Grade 9 Green English are two separate allocations below.
          </p>
        </div>
      </div>

      {message && (
        <div className={`alert alert-${messageType} alert-dismissible fade show`} role="alert">
          {message}
          <button type="button" className="btn-close" onClick={() => setMessage("")}></button>
        </div>
      )}

      {/* Tab strip */}
      <ul className="nav nav-tabs mb-4" role="tablist">
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "all"}
            className={`nav-link${activeTab === "all" ? " active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            <i className="bi bi-person-lines-fill me-2"></i>All Allocations
            <span className="badge badge-neutral ms-2">{allocations.length}</span>
          </button>
        </li>
        <li className="nav-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "unallocated"}
            className={`nav-link${activeTab === "unallocated" ? " active" : ""}`}
            onClick={() => setActiveTab("unallocated")}
          >
            <i className="bi bi-exclamation-triangle me-2"></i>Unallocated Subjects
            {gaps.length > 0 && <span className="badge badge-danger ms-2">{gapTotal}</span>}
          </button>
        </li>
      </ul>

      {activeTab === "all" ? (
        <>
          {/* Add Allocation Form */}
          <form className="card mb-3" onSubmit={addAllocation}>
            <div className="card-header d-flex align-items-center gap-2">
              <i className="bi bi-person-plus text-brand"></i>
              Add New Allocation
            </div>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12 col-md-3">
                  <label className="form-label">Academic Year</label>
                  <select className="form-select" required value={form.academic_year}
                    onChange={(e) => setForm({ ...form, academic_year: e.target.value, classroom: "" })}>
                    <option value="">Select...</option>
                    {years.map((y) => <option key={y.id} value={y.id}>{y.year}{y.is_current ? " (current)" : ""}</option>)}
                  </select>
                </div>
                <div className="col-12 col-md-3">
                  <label className="form-label">Teacher</label>
                  <select className="form-select" required value={form.teacher}
                    onChange={(e) => setForm({ ...form, teacher: e.target.value })}>
                    <option value="">Select...</option>
                    {teachers.map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
                  </select>
                </div>
                <div className="col-12 col-md-3">
                  <label className="form-label">Subject</label>
                  <select className="form-select" required value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                    <option value="">Select...</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="col-12 col-md-3">
                  <label className="form-label">Classroom</label>
                  <select className="form-select" required value={form.classroom}
                    onChange={(e) => setForm({ ...form, classroom: e.target.value })}>
                    <option value="">Select...</option>
                    {classrooms
                      .filter((c) => !form.academic_year || sameId(c.academic_year, form.academic_year))
                      .map((c) => (
                        <option key={c.id} value={c.id}>{c.grade_level_name} {c.stream_name} ({c.academic_year_year})</option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 pt-3 border-top d-flex gap-2 justify-content-end">
                <button className="btn btn-primary" type="submit" disabled={loading}>
                  {loading ? "Saving..." : (<><i className="bi bi-check2"></i>Save Allocation</>)}
                </button>
              </div>
            </div>
          </form>

          {/* Table with Search & Filters */}
          <div className="table-wrap">
            <div className="table-wrap__header flex-column align-items-stretch gap-3">
              <div className="toolbar mb-0">
                <div className="toolbar__search">
                  <i className="bi bi-search"></i>
                  <input type="text" className="form-control" placeholder="Search teacher, subject, classroom..."
                    value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                </div>
                <select className="form-select w-auto" aria-label="Year" value={filters.academic_year}
                  onChange={(e) => setFilters({ ...filters, academic_year: e.target.value })}>
                  <option value="">All Years</option>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.year}</option>)}
                </select>
                <select className="form-select w-auto" aria-label="Teacher" value={filters.teacher}
                  onChange={(e) => setFilters({ ...filters, teacher: e.target.value })}>
                  <option value="">All Teachers</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
                </select>
                <select className="form-select w-auto" aria-label="Subject" value={filters.subject}
                  onChange={(e) => setFilters({ ...filters, subject: e.target.value })}>
                  <option value="">All Subjects</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="form-select w-auto" aria-label="Classroom" value={filters.classroom}
                  onChange={(e) => setFilters({ ...filters, classroom: e.target.value })}>
                  <option value="">All Classrooms</option>
                  {classrooms
                    .filter((c) => !filters.academic_year || sameId(c.academic_year, filters.academic_year))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.grade_level_name} {c.stream_name}{!filters.academic_year ? ` (${c.academic_year_year})` : ""}
                      </option>
                    ))}
                </select>
                {activeFilterCount > 0 && (
                  <button type="button" className="btn btn-sm btn-light" onClick={clearFilters}>
                    <i className="bi bi-x-lg"></i> Clear
                  </button>
                )}
              </div>

              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span className="chart-card__title">
                  <i className="bi bi-person-lines-fill me-2 text-brand"></i>
                  All Allocations
                </span>
                <span className="chart-card__subtitle">
                  {totalItems} allocation{totalItems !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {loading ? (
              <TableSkeleton rows={5} columns={4} />
            ) : currentItems.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-person-x"></i>
                <h6>{activeFilterCount ? "No allocations match your search" : "No allocations created yet"}</h6>
                <p className="text-muted-soft">
                  {activeFilterCount ? "Try adjusting your search or filters" : "Use the form above to create your first teacher allocation"}
                </p>
              </div>
            ) : (
              <>
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th>Teacher</th>
                        <th>Subject</th>
                        <th>Classroom</th>
                        <th>Year</th>
                        <th style={{ width: "80px" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentItems.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <div className="table-avatar-cell">
                              <div className="avatar-sm">{(a.teacher_name || "").split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("") || "T"}</div>
                              <span className="cell-name">{a.teacher_name}</span>
                            </div>
                          </td>
                          <td><span className="badge badge-blue">{a.subject_name}</span></td>
                          <td><span className="badge badge-neutral">{a.classroom_label}</span></td>
                          <td className="cell-mono">{years.find((y) => sameId(y.id, a.academic_year))?.year || "-"}</td>
                          <td>
                            <div className="table-actions">
                              <button className="btn btn-sm btn-outline-danger btn-icon" title="Delete" aria-label="Delete"
                                onClick={() => deleteAllocation(a.id)}>
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange}
                  itemsPerPage={itemsPerPage} setItemsPerPage={setItemsPerPage}
                  startIndex={startIndex} endIndex={endIndex} totalItems={totalItems} />
              </>
            )}
          </div>
        </>
      ) : (
        // ---- Unallocated Subjects tab ----
        <div className="table-wrap">
          <div className="table-wrap__header flex-column align-items-stretch gap-3">
            <div className="toolbar mb-0">
              <select className="form-select w-auto" aria-label="Academic year" value={gapYear}
                onChange={(e) => { setGapYear(e.target.value); setGapClassroom(""); }}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.year}{y.is_current ? " (current)" : ""}</option>)}
              </select>
              <select className="form-select w-auto" aria-label="Classroom" value={gapClassroom} onChange={(e) => setGapClassroom(e.target.value)}>
                <option value="">All Classrooms</option>
                {classrooms.filter((c) => !gapYear || sameId(c.academic_year, gapYear)).map((c) => (
                  <option key={c.id} value={c.id}>{c.grade_level_name} {c.stream_name}</option>
                ))}
              </select>
            </div>
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <span className="chart-card__title">
                <i className="bi bi-exclamation-triangle me-2 text-brand"></i>
                Unallocated Subjects
              </span>
              <span className="chart-card__subtitle">
                {gapTotal} gap{gapTotal !== 1 ? "s" : ""} across {gaps.length} classroom{gaps.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {gapsLoading ? (
            <TableSkeleton rows={4} columns={2} />
          ) : gaps.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-check-circle text-success"></i>
              <h6>All subjects are allocated</h6>
              <p className="text-muted-soft">Every classroom for this academic year has a teacher for every offered subject.</p>
            </div>
          ) : (
            <div className="p-3 d-flex flex-column gap-3">
              {gaps.map((g) => (
                <div key={g.classroom_id} className="card">
                  <div className="card-header d-flex justify-content-between align-items-center gap-2">
                    <span>{g.classroom_label}</span>
                    <span className="badge badge-danger">{g.subjects.length} unallocated</span>
                  </div>
                  <div className="card-body d-flex flex-column gap-2">
                    {g.subjects.map((subj) => {
                      const key = `${g.classroom_id}-${subj.id}`;
                      const isAssigning = assigningKey === key;
                      return (
                        <div key={subj.id} className="gap-row">
                          <span className="badge badge-blue">{subj.name}</span>
                          {isAssigning ? (
                            <div className="d-flex gap-2 align-items-center flex-wrap">
                              <select className="form-select form-select-sm w-auto gap-row__select"
                                value={assignTeacher} onChange={(e) => setAssignTeacher(e.target.value)}>
                                <option value="">Choose teacher...</option>
                                {teachers.map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
                              </select>
                              <button className="btn btn-sm btn-primary" disabled={!assignTeacher}
                                onClick={() => assignFromGap(g.classroom_id, subj.id)}>
                                <i className="bi bi-check-lg"></i> Assign
                              </button>
                              <button className="btn btn-sm btn-light" onClick={() => { setAssigningKey(null); setAssignTeacher(""); }}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button className="btn btn-sm btn-outline-primary" onClick={() => setAssigningKey(key)}>
                              <i className="bi bi-person-plus"></i> Assign Teacher
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}