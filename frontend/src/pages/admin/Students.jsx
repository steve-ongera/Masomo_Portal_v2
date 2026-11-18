import { useEffect, useState, useCallback, useMemo } from "react";
import { studentsApi, academicsApi, authApi, admissionFeeApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import Pagination from "../../components/Pagination";
import Modal from "../../components/Modal";
import StudentProfileModal from "./StudentProfileModal";

const emptyAddForm = {
  first_name: "", last_name: "", email: "", phone_number: "", national_id: "",
  gender: "M", curriculum_type: "CBC", classroom_id: "", date_of_birth: "", upi_number: "",
  // For migrating a student who already has an admission number and
  // a real admission date from a previous system. Leave both blank for a
  // genuinely new admission: behavior is identical to before (auto-generated
  // admission number, date_admitted defaults to today on the backend).
  admission_no: "", date_admitted: "",
  parent_name: "", parent_phone: "", parent_email: "", parent_relationship: "GUARDIAN",
};

const emptyEditForm = {
  first_name: "", last_name: "", email: "", phone_number: "", national_id: "",
  gender: "M", date_of_birth: "", curriculum_type: "CBC", upi_number: "", is_active: true,
  classroom_id: "",
  guardian_name: "", guardian_phone: "", guardian_email: "", guardian_relationship: "GUARDIAN",
};

const emptyFilters = {
  gender: "", curriculum_type: "", status: "",
  academic_year: "", grade_level: "", classroom_id: "",
};

const kes = (n) => `KES ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

export default function AdminStudents() {
  const [students, setStudents] = useState([]);
  const [totalItems, setTotalItems] = useState(0);

  // Full, unfiltered classroom list — used to build the Academic Year /
  // Grade / Classroom filter dropdowns (needs to see every year, every
  // curriculum, not just a first page of results).
  const [allClassrooms, setAllClassrooms] = useState([]);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");

  // ---- Current logged-in user's role — controls which action icons show
  // (e.g. only an Admin or Secretary gets the Edit pencil). Backend
  // permissions are the real enforcement; this just keeps the UI honest
  // for other roles.
  const [currentUserRole, setCurrentUserRole] = useState(null);

  useEffect(() => {
    authApi.me().then(({ data }) => setCurrentUserRole(data.role)).catch(() => {});
  }, []);

  // Admin AND Secretary may edit a student's record (the backend's
  // StudentProfileViewSet allows both for retrieve/update).
  const canEditStudents = currentUserRole === "ADMIN" || currentUserRole === "SECRETARY";

  // ---- Add modal ----
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [addSaving, setAddSaving] = useState(false);

  // ---- Admission term fee (optional pro-rating for students joining mid-term) ----
  const [feePreview, setFeePreview] = useState(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [reduceFee, setReduceFee] = useState(false);
  const [termFee, setTermFee] = useState("");
  const [termFeeTouched, setTermFeeTouched] = useState(false);
  const [feeReason, setFeeReason] = useState("");
  const [feeError, setFeeError] = useState("");

  const resetFeeState = () => {
    setFeePreview(null);
    setFeeLoading(false);
    setReduceFee(false);
    setTermFee("");
    setTermFeeTouched(false);
    setFeeReason("");
    setFeeError("");
  };

  // ---- Student 360 profile modal (replaces the old View modal) ----
  const [profileId, setProfileId] = useState(null);

  // ---- Edit modal ----
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // { id, admission_no, username }
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editSaving, setEditSaving] = useState(false);

  // ---- Reset password modal ----
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetResult, setResetResult] = useState(null);

  // Debounce the search box so we're not firing a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: currentPage, page_size: itemsPerPage };
      if (searchQuery) params.search = searchQuery;
      if (filters.gender) params.gender = filters.gender;
      if (filters.curriculum_type) params.curriculum_type = filters.curriculum_type;
      if (filters.status) params.is_active = filters.status === "active";
      // Enrollment-based filters. The backend (StudentProfileFilter) applies
      // these together to one enrollment: academic_year is the year NUMBER
      // (e.g. 2026), grade_level and classroom are ids.
      if (filters.academic_year) params.academic_year = filters.academic_year;
      if (filters.grade_level) params.grade_level = filters.grade_level;
      if (filters.classroom_id) params.classroom = filters.classroom_id;

      const { data } = await studentsApi.list(params);
      if (Array.isArray(data)) {
        // Pagination disabled server-side — fall back gracefully.
        setStudents(data);
        setTotalItems(data.length);
      } else {
        setStudents(data.results ?? []);
        setTotalItems(data.count ?? 0);
      }
    } catch (error) {
      console.error("Failed to load students:", error);
      setMessage("Could not load students.");
      setMessageType("danger");
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, searchQuery, filters]);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    // Unpaginated on purpose — the default /classrooms/ list pages at 12,
    // and since CBC grades sort before legacy 8-4-4 forms, a paginated
    // fetch here would silently hide every Form 1-4 classroom for the
    // current year once a school has more than a page's worth of classes.
    academicsApi.allClassrooms().then(({ data }) => setAllClassrooms(data.results ?? data));
  }, []);

  // Classrooms allowed in the Admit / Edit forms — current academic year
  // only, so new admissions can never land in a stale/past year again.
  const admitClassrooms = useMemo(
    () => allClassrooms.filter((c) => c.academic_year_is_current),
    [allClassrooms]
  );

  // Load the pro-rated fee suggestion whenever the class or admission date changes.
  useEffect(() => {
    if (!showAddModal || !addForm.classroom_id) {
      setFeePreview(null);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setFeeLoading(true);
      admissionFeeApi
        .preview({
          classroom: addForm.classroom_id,
          date_admitted: addForm.date_admitted || undefined,
        })
        .then(({ data }) => {
          if (cancelled) return;
          setFeePreview(data);
          // Keep the amount in step with the suggestion until the school types its own.
          if (data.applicable && !termFeeTouched) setTermFee(String(data.prorated_fee));
        })
        .catch(() => { if (!cancelled) setFeePreview(null); })
        .finally(() => { if (!cancelled) setFeeLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddModal, addForm.classroom_id, addForm.date_admitted]);

  // Distinct academic years, newest first, for the filter dropdown.
  // Uses academic_year_year (the actual year integer from the serializer),
  // not academic_year (the AcademicYear FK id) — the two are different
  // fields and mixing them up silently breaks the year filter/options.
  const academicYearOptions = useMemo(() => {
    const years = [...new Set(allClassrooms.map((c) => c.academic_year_year))];
    return years.sort((a, b) => b - a);
  }, [allClassrooms]);

  // Distinct grade levels for the filter dropdown, scoped to the selected
  // academic year (if any) so the list doesn't show grades that don't
  // exist in that year.
  const gradeLevelOptions = useMemo(() => {
    const pool = filters.academic_year
      ? allClassrooms.filter((c) => String(c.academic_year_year) === String(filters.academic_year))
      : allClassrooms;
    const seen = new Map();
    pool.forEach((c) => seen.set(c.grade_level, c.grade_level_name));
    return [...seen.entries()]; // [ [id, name], ... ]
  }, [allClassrooms, filters.academic_year]);

  // Classrooms for the filter dropdown, scoped to selected year + grade.
  const classroomOptions = useMemo(() => {
    return allClassrooms.filter((c) => {
      if (filters.academic_year && String(c.academic_year_year) !== String(filters.academic_year)) return false;
      if (filters.grade_level && String(c.grade_level) !== String(filters.grade_level)) return false;
      return true;
    });
  }, [allClassrooms, filters.academic_year, filters.grade_level]);

  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + students.length;
  const hasActiveFilters = !!(
    searchInput || filters.gender || filters.curriculum_type || filters.status ||
    filters.academic_year || filters.grade_level || filters.classroom_id
  );

  const handlePageChange = (page) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setFilters(emptyFilters);
    setCurrentPage(1);
  };

  const updateFilter = (patch) => {
    // Changing academic_year or grade_level invalidates a more specific
    // downstream selection (grade/classroom), so clear those to avoid an
    // impossible combination silently returning zero results.
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      if ("academic_year" in patch) {
        next.grade_level = "";
        next.classroom_id = "";
      } else if ("grade_level" in patch) {
        next.classroom_id = "";
      }
      return next;
    });
    setCurrentPage(1);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    resetFeeState();
  };

  // ---------------- ADD ----------------
  const handleAdmit = async (e) => {
    e.preventDefault();

    // Validate the optional reduced fee BEFORE admitting, so we never admit and then fail on a typo.
    const wantsReducedFee = reduceFee && feePreview?.applicable;
    if (wantsReducedFee) {
      const amt = Number(termFee);
      if (termFee === "" || Number.isNaN(amt) || amt < 0) {
        setFeeError("Enter the term fee this student will pay (0 or more).");
        return;
      }
    }
    setFeeError("");

    setAddSaving(true);
    try {
      const payload = {
        ...addForm,
        date_of_birth: addForm.date_of_birth || null,
        // Blank means "let the backend auto-generate / default to today".
        // A non-blank value is only meant for migrating a student who
        // already has these from a prior system.
        admission_no: addForm.admission_no.trim(),
        date_admitted: addForm.date_admitted || null,
      };
      const { data } = await studentsApi.admit(payload);

      // Optional: set the reduced term fee now that the student (and their invoice) exist.
      let feeNote = "";
      let feeFailed = false;
      if (wantsReducedFee) {
        try {
          const { data: fee } = await admissionFeeApi.apply({
            admission_no: data.admission_no,
            amount: Number(termFee),
            reason: feeReason.trim(),
          });
          feeNote = ` — ${fee.term} fee set to ${kes(fee.amount_charged)} (full fee ${kes(fee.full_fee)})`;
        } catch (feeErr) {
          feeFailed = true;
          feeNote =
            ` — BUT the reduced term fee could NOT be applied: ` +
            `${feeErr.response?.data?.detail || "unknown error"}. ` +
            `The student has the full term fee for now; ask Finance to adjust it.`;
        }
      }

      setMessage(
        `Admitted successfully. Admission No / login username: ${data.admission_no}` +
        (data.current_classroom ? ` — enrolled in ${data.current_classroom}` : "") +
        (data.guardian ? ` — guardian ${data.guardian.name} linked${data.guardian.email ? ` (${data.guardian.email})` : ""}` : "") +
        feeNote
      );
      setMessageType(feeFailed ? "warning" : "success");
      closeAddModal();
      setAddForm(emptyAddForm);
      setCurrentPage(1);
      await loadStudents();
    } catch (err) {
      const data = err.response?.data;
      const detail =
        data?.detail ||
        data?.admission_no?.[0] ||
        data?.classroom_id?.[0] ||
        "Could not admit student.";
      setMessage(detail);
      setMessageType("danger");
    } finally {
      setAddSaving(false);
    }
  };

  // ---------------- EDIT ----------------
  const openEdit = async (student) => {
    setShowEditModal(true);
    setEditTarget(null);
    try {
      const { data } = await studentsApi.detail(student.id);
      setEditTarget({ id: data.id, admission_no: data.admission_no, username: data.user.username });
      setEditForm({
        first_name: data.user.first_name || "",
        last_name: data.user.last_name || "",
        email: data.user.email || "",
        phone_number: data.user.phone_number || "",
        national_id: data.user.national_id || "",
        gender: data.gender,
        date_of_birth: data.date_of_birth || "",
        curriculum_type: data.curriculum_type,
        upi_number: data.upi_number || "",
        is_active: data.is_active,
        classroom_id: data.current_classroom?.id || "",
        guardian_name: data.guardian?.name || "",
        guardian_phone: data.guardian?.phone_number || "",
        guardian_email: data.guardian?.email || "",
        guardian_relationship: data.guardian?.relationship || "GUARDIAN",
      });
    } catch (err) {
      setMessage("Could not load student for editing.");
      setMessageType("danger");
      setShowEditModal(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const payload = {
        user: {
          first_name: editForm.first_name,
          last_name: editForm.last_name,
          email: editForm.email,
          phone_number: editForm.phone_number,
          national_id: editForm.national_id,
        },
        gender: editForm.gender,
        date_of_birth: editForm.date_of_birth || null,
        curriculum_type: editForm.curriculum_type,
        upi_number: editForm.upi_number,
        is_active: editForm.is_active,
      };
      if (editForm.classroom_id) payload.classroom_id = editForm.classroom_id;
      if (editForm.guardian_phone) {
        payload.guardian_name = editForm.guardian_name;
        payload.guardian_phone = editForm.guardian_phone;
        payload.guardian_email = editForm.guardian_email;
        payload.guardian_relationship = editForm.guardian_relationship;
      }

      await studentsApi.update(editTarget.id, payload);
      setMessage("Student updated successfully.");
      setMessageType("success");
      setShowEditModal(false);
      await loadStudents();
    } catch (err) {
      const data = err.response?.data;
      const detail =
        data?.detail ||
        data?.user?.national_id?.[0] ||
        data?.user?.email?.[0] ||
        (typeof data === "string" ? data : null) ||
        "Could not update student.";
      setMessage(detail);
      setMessageType("danger");
    } finally {
      setEditSaving(false);
    }
  };

  // ---------------- RESET PASSWORD ----------------
  const openReset = (student) => {
    setResetTarget(student);
    setResetPasswordValue("");
    setResetResult(null);
    setShowResetModal(true);
  };

  const handleReset = async (e) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetSaving(true);
    try {
      const { data } = await studentsApi.resetPassword(resetTarget.id, {
        new_password: resetPasswordValue || undefined,
      });
      setResetResult(data.new_password);
    } catch (err) {
      setMessage(err.response?.data?.detail || "Could not reset password.");
      setMessageType("danger");
      setShowResetModal(false);
    } finally {
      setResetSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="page-subtitle">Manage all students across the school</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <i className="bi bi-plus-lg"></i>
            Admit Student
          </button>
        </div>
      </div>

      {message && (
        <div className={`alert alert-${messageType} alert-dismissible fade show`} role="alert">
          {message}
          <button type="button" className="btn-close" onClick={() => setMessage("")}></button>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          {/* Search + all filters share one toolbar; it wraps on small screens */}
          <div className="toolbar mb-0">
            <div className="toolbar__search">
              <i className="bi bi-search"></i>
              <input
                type="text"
                className="form-control"
                placeholder="Search name / adm no..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <select
              className="form-select w-auto"
              value={filters.gender}
              onChange={(e) => updateFilter({ gender: e.target.value })}
              aria-label="Gender"
            >
              <option value="">Gender</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
            <select
              className="form-select w-auto"
              value={filters.curriculum_type}
              onChange={(e) => updateFilter({ curriculum_type: e.target.value })}
              aria-label="Curriculum"
            >
              <option value="">Curriculum</option>
              <option value="CBC">CBC</option>
              <option value="8-4-4">8-4-4</option>
            </select>
            <select
              className="form-select w-auto"
              value={filters.status}
              onChange={(e) => updateFilter({ status: e.target.value })}
              aria-label="Status"
            >
              <option value="">Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              className="form-select w-auto"
              value={filters.academic_year}
              onChange={(e) => updateFilter({ academic_year: e.target.value })}
              aria-label="Academic year"
            >
              <option value="">Year</option>
              {academicYearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select
              className="form-select w-auto"
              value={filters.grade_level}
              onChange={(e) => updateFilter({ grade_level: e.target.value })}
              aria-label="Grade"
            >
              <option value="">Grade</option>
              {gradeLevelOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <select
              className="form-select w-auto"
              value={filters.classroom_id}
              onChange={(e) => updateFilter({ classroom_id: e.target.value })}
              aria-label="Class"
            >
              <option value="">Class</option>
              {classroomOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.grade_level_name} {c.stream_name}
                  {!filters.academic_year ? ` (${c.academic_year_year})` : ""}
                </option>
              ))}
            </select>
            {hasActiveFilters && (
              <button className="btn btn-sm btn-light" onClick={clearFilters}>
                <i className="bi bi-x-lg"></i> Clear
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <div className="d-flex flex-wrap gap-1">
              {searchQuery && (
                <span className="filter-chip">
                  Search: "{searchQuery}"
                  <button onClick={() => setSearchInput("")}><i className="bi bi-x"></i></button>
                </span>
              )}
              {filters.gender && (
                <span className="filter-chip">
                  Gender: {filters.gender === "M" ? "Male" : "Female"}
                  <button onClick={() => updateFilter({ gender: "" })}><i className="bi bi-x"></i></button>
                </span>
              )}
              {filters.curriculum_type && (
                <span className="filter-chip">
                  Curriculum: {filters.curriculum_type}
                  <button onClick={() => updateFilter({ curriculum_type: "" })}><i className="bi bi-x"></i></button>
                </span>
              )}
              {filters.status && (
                <span className="filter-chip">
                  Status: {filters.status}
                  <button onClick={() => updateFilter({ status: "" })}><i className="bi bi-x"></i></button>
                </span>
              )}
              {filters.academic_year && (
                <span className="filter-chip">
                  Year: {filters.academic_year}
                  <button onClick={() => updateFilter({ academic_year: "" })}><i className="bi bi-x"></i></button>
                </span>
              )}
              {filters.grade_level && (
                <span className="filter-chip">
                  Grade: {gradeLevelOptions.find(([id]) => String(id) === String(filters.grade_level))?.[1]}
                  <button onClick={() => updateFilter({ grade_level: "" })}><i className="bi bi-x"></i></button>
                </span>
              )}
              {filters.classroom_id && (
                <span className="filter-chip">
                  Class: {(() => {
                    const c = allClassrooms.find((x) => String(x.id) === String(filters.classroom_id));
                    return c ? `${c.grade_level_name} ${c.stream_name}` : "";
                  })()}
                  <button onClick={() => updateFilter({ classroom_id: "" })}><i className="bi bi-x"></i></button>
                </span>
              )}
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title">
              <i className="bi bi-person-lines-fill me-2 text-brand"></i>
              Student List
            </span>
            <span className="chart-card__subtitle">
              {totalItems} student{totalItems !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={Math.min(itemsPerPage, 10)} columns={7} />
        ) : students.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>{hasActiveFilters ? "No students match your search" : "No students admitted yet"}</h6>
            <p className="text-muted-soft">
              {hasActiveFilters ? "Try adjusting your search or filters" : "Click 'Admit Student' to add your first student"}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Admission No</th>
                  <th>Name</th>
                  <th>Gender</th>
                  <th>Curriculum</th>
                  <th>Current Class</th>
                  <th>Status</th>
                  <th style={{ width: "120px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-mono text-brand fw-semibold">{s.admission_no}</td>
                    <td>
                      <div className="table-avatar-cell">
                        <div className="avatar-sm">
                          {(s.full_name || "").split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("")}
                        </div>
                        <span className="cell-name">{s.full_name}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${s.gender === "M" ? "badge-blue" : "badge-gold"}`}>
                        {s.gender === "M" ? "Male" : "Female"}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-neutral">{s.curriculum_type}</span>
                    </td>
                    <td>{s.current_classroom || "-"}</td>
                    <td>
                      <span className={`badge ${s.is_active ? "badge-success" : "badge-danger"}`}>
                        <span className={`status-dot ${s.is_active ? "status-dot--online" : "status-dot--offline"}`}></span>
                        {s.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn-sm btn-outline-primary btn-icon" title="View full profile" aria-label="View" onClick={() => setProfileId(s.id)}>
                          <i className="bi bi-eye"></i>
                        </button>
                        {canEditStudents && (
                          <button className="btn btn-sm btn-secondary btn-icon" title="Edit" aria-label="Edit" onClick={() => openEdit(s)}>
                            <i className="bi bi-pencil"></i>
                          </button>
                        )}
                        <button className="btn btn-sm btn-secondary btn-icon" title="Reset Password" aria-label="Reset Password" onClick={() => openReset(s)}>
                          <i className="bi bi-key"></i>
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

      {!loading && students.length > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          itemsPerPage={itemsPerPage}
          setItemsPerPage={(n) => { setItemsPerPage(n); setCurrentPage(1); }}
          startIndex={startIndex}
          endIndex={endIndex}
          totalItems={totalItems}
        />
      )}

      {/* ---------------- ADD MODAL ---------------- */}
      <Modal show={showAddModal} onClose={closeAddModal} title="Admit New Student" size="lg">
        <form onSubmit={handleAdmit}>
          <h6 className="settings-section__title mb-2">Student Details</h6>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">First Name</label>
              <input className="form-control" required
                value={addForm.first_name}
                onChange={(e) => setAddForm({ ...addForm, first_name: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Last Name</label>
              <input className="form-control" required
                value={addForm.last_name}
                onChange={(e) => setAddForm({ ...addForm, last_name: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Email (optional)</label>
              <input type="email" className="form-control"
                value={addForm.email}
                onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Phone Number (optional)</label>
              <input className="form-control"
                value={addForm.phone_number}
                onChange={(e) => setAddForm({ ...addForm, phone_number: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label">National ID / Birth No (optional)</label>
              <input className="form-control"
                value={addForm.national_id}
                onChange={(e) => setAddForm({ ...addForm, national_id: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label">UPI / NEMIS No (optional)</label>
              <input className="form-control" value={addForm.upi_number}
                onChange={(e) => setAddForm({ ...addForm, upi_number: e.target.value })} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Gender</label>
              <select className="form-select" value={addForm.gender}
                onChange={(e) => setAddForm({ ...addForm, gender: e.target.value })}>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Date of Birth</label>
              <input type="date" className="form-control" value={addForm.date_of_birth}
                onChange={(e) => setAddForm({ ...addForm, date_of_birth: e.target.value })} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Curriculum</label>
              <select className="form-select" value={addForm.curriculum_type}
                onChange={(e) => setAddForm({ ...addForm, curriculum_type: e.target.value })}>
                <option value="CBC">CBC</option>
                <option value="8-4-4">8-4-4 (Legacy)</option>
              </select>
            </div>

            {/* Migrating an already-admitted student */}
            <div className="col-md-6">
              <label className="form-label">Admission Number (optional)</label>
              <input
                className="form-control"
                placeholder="Leave blank to auto-generate"
                value={addForm.admission_no}
                onChange={(e) => setAddForm({ ...addForm, admission_no: e.target.value })}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label">Date Admitted (optional)</label>
              <input
                type="date"
                className="form-control"
                value={addForm.date_admitted}
                onChange={(e) => setAddForm({ ...addForm, date_admitted: e.target.value })}
              />
            </div>
            <div className="col-12">
              <div className="form-text-hint mt-0">
                Leave both blank for a brand-new admission — the admission number auto-generates and
                today's date is used, exactly as before. Only fill these in when migrating a student
                who was already admitted under your previous system and already has these on record.
              </div>
            </div>

            <div className="col-md-12">
              <label className="form-label">Classroom</label>
              <select className="form-select" required value={addForm.classroom_id}
                onChange={(e) => setAddForm({ ...addForm, classroom_id: e.target.value })}>
                <option value="">Select...</option>
                {admitClassrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.grade_level_name} {c.stream_name} - {c.academic_year_year}
                  </option>
                ))}
              </select>
              <div className="form-text-hint">
                Only classrooms in the current academic year are shown — CBC and 8-4-4 alike.
              </div>
            </div>

            {/* ---------- Optional: term fee for a student joining part-way through the term ---------- */}
            {addForm.classroom_id && (
              <div className="col-12">
                <div className="border rounded p-3">
                  <div className="fw-semibold mb-2">
                    <i className="bi bi-calendar2-range me-2 text-brand"></i>
                    First-term fee (optional)
                  </div>

                  {feeLoading && !feePreview ? (
                    <div className="form-text-hint mt-0">
                      <span className="spinner-border spinner-border-sm me-2"></span>
                      Checking the term dates...
                    </div>
                  ) : !feePreview ? (
                    <div className="form-text-hint mt-0">
                      Could not work out the term fee. The student will be charged the normal term fee.
                    </div>
                  ) : !feePreview.applicable ? (
                    <div className="form-text-hint mt-0">
                      <i className="bi bi-info-circle me-1"></i>
                      {feePreview.message}
                    </div>
                  ) : (
                    <>
                      <div className="small mb-2">
                        <strong>{feePreview.term_label}</strong> runs {feePreview.term_start} to{" "}
                        {feePreview.term_end} ({feePreview.total_days} days).{" "}
                        {feePreview.days_remaining === feePreview.total_days ? (
                          <>The student joins at the start of the term, so the full fee of{" "}
                            <strong>{kes(feePreview.full_fee)}</strong> applies.</>
                        ) : (
                          <>From the admission date, <strong>{feePreview.days_remaining} of{" "}
                            {feePreview.total_days} days</strong> remain. Full fee{" "}
                            <strong>{kes(feePreview.full_fee)}</strong>; pro-rated suggestion{" "}
                            <strong>{kes(feePreview.prorated_fee)}</strong>.</>
                        )}
                      </div>

                      <div className="form-check mb-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="reduceFee"
                          checked={reduceFee}
                          onChange={(e) => {
                            setReduceFee(e.target.checked);
                            setFeeError("");
                            if (e.target.checked && !termFeeTouched) setTermFee(String(feePreview.prorated_fee));
                          }}
                        />
                        <label className="form-check-label" htmlFor="reduceFee">
                          Charge a different amount for this term (instead of the full {kes(feePreview.full_fee)})
                        </label>
                      </div>

                      {reduceFee && (
                        <div className="row g-2 align-items-end">
                          <div className="col-md-4">
                            <label className="form-label small">Term fee for this student (KES)</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="form-control"
                              value={termFee}
                              onChange={(e) => { setTermFee(e.target.value); setTermFeeTouched(true); setFeeError(""); }}
                            />
                          </div>
                          <div className="col-md-3">
                            <button
                              type="button"
                              className="btn btn-outline-secondary w-100"
                              onClick={() => { setTermFee(String(feePreview.prorated_fee)); setTermFeeTouched(false); setFeeError(""); }}
                            >
                              Use suggested
                            </button>
                          </div>
                          <div className="col-md-5">
                            <label className="form-label small">Reason (optional)</label>
                            <input
                              className="form-control"
                              placeholder="e.g. Joined 3 weeks before term end"
                              maxLength={200}
                              value={feeReason}
                              onChange={(e) => setFeeReason(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                      {feeError && <div className="text-danger small mt-2">{feeError}</div>}
                      <div className="form-text-hint mb-0 mt-2">
                        Days are counted as calendar days from the admission date to the end of the term. The
                        suggestion is only a guide — you decide the amount. Leave this unticked to charge the normal
                        full term fee. Later terms are charged in full as usual.
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <h6 className="settings-section__title mt-4 mb-2">Parent / Guardian</h6>
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label">Parent/Guardian Name</label>
              <input className="form-control"
                placeholder="e.g. Jane Wanjiku"
                value={addForm.parent_name}
                onChange={(e) => setAddForm({ ...addForm, parent_name: e.target.value })} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Parent/Guardian Phone</label>
              <input className="form-control"
                placeholder="07XXXXXXXX"
                value={addForm.parent_phone}
                onChange={(e) => setAddForm({ ...addForm, parent_phone: e.target.value })} />
            </div>
            <div className="col-md-2">
              <label className="form-label">Relationship</label>
              <select className="form-select" value={addForm.parent_relationship}
                onChange={(e) => setAddForm({ ...addForm, parent_relationship: e.target.value })}>
                <option value="MOTHER">Mother</option>
                <option value="FATHER">Father</option>
                <option value="GUARDIAN">Guardian</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Parent/Guardian Email</label>
              <input type="email" className="form-control"
                placeholder="optional"
                value={addForm.parent_email}
                onChange={(e) => setAddForm({ ...addForm, parent_email: e.target.value })} />
            </div>
            <div className="col-12">
              <div className="form-text-hint mt-0">
                If this phone number already belongs to a registered parent (e.g. an older sibling),
                the student is linked to that existing parent account instead of creating a duplicate.
                An email entered here fills in a blank one on that existing account, but never overwrites one already on file.
              </div>
            </div>
          </div>

          <p className="form-text-hint mt-3">
            When left blank, the admission number is generated automatically and used as the student's
            login username. The initial password for every new student is their admission number.
          </p>
          <div className="mt-3 pt-3 border-top d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-secondary" onClick={closeAddModal}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={addSaving}>
              {addSaving ? "Saving..." : "Save Student"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ---------------- STUDENT 360 PROFILE MODAL ---------------- */}
      <StudentProfileModal
        show={profileId !== null}
        studentId={profileId}
        onClose={() => setProfileId(null)}
        onChanged={loadStudents}
        isAdmin={currentUserRole === "ADMIN"}
      />

      {/* ---------------- EDIT MODAL ---------------- */}
      <Modal show={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Student & Account" size="lg">
        {!editTarget ? (
          <div className="text-center py-4"><span className="spinner-border spinner-border-sm me-2"></span>Loading...</div>
        ) : (
          <form onSubmit={handleEditSubmit}>
            <div className="d-flex flex-wrap gap-3 mb-2 form-text-hint">
              <span><strong>Admission No:</strong> {editTarget.admission_no}</span>
              <span><strong>Username:</strong> {editTarget.username}</span>
            </div>

            <h6 className="settings-section__title mt-2 mb-2">Account</h6>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">First Name</label>
                <input className="form-control" required value={editForm.first_name}
                  onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
              </div>
              <div className="col-md-6">
                <label className="form-label">Last Name</label>
                <input className="form-control" required value={editForm.last_name}
                  onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
              </div>
              <div className="col-md-6">
                <label className="form-label">Email</label>
                <input type="email" className="form-control" value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div className="col-md-6">
                <label className="form-label">Phone Number</label>
                <input className="form-control" value={editForm.phone_number}
                  onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })} />
              </div>
              <div className="col-md-6">
                <label className="form-label">National ID / Birth No</label>
                <input className="form-control" value={editForm.national_id}
                  onChange={(e) => setEditForm({ ...editForm, national_id: e.target.value })} />
                <div className="form-text-hint">
                  Leaving this exactly as-is is fine — saving no longer wrongly flags it as a duplicate.
                </div>
              </div>
            </div>

            <h6 className="settings-section__title mt-4 mb-2">Student Profile</h6>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Gender</label>
                <select className="form-select" value={editForm.gender}
                  onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">Date of Birth</label>
                <input type="date" className="form-control" value={editForm.date_of_birth || ""}
                  onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Curriculum</label>
                <select className="form-select" value={editForm.curriculum_type}
                  onChange={(e) => setEditForm({ ...editForm, curriculum_type: e.target.value })}>
                  <option value="CBC">CBC</option>
                  <option value="8-4-4">8-4-4 (Legacy)</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">UPI / NEMIS No</label>
                <input className="form-control" value={editForm.upi_number}
                  onChange={(e) => setEditForm({ ...editForm, upi_number: e.target.value })} />
              </div>
              <div className="col-md-4 d-flex align-items-end">
                <div className="form-check mb-2">
                  <input className="form-check-input" type="checkbox" id="editIsActive"
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} />
                  <label className="form-check-label" htmlFor="editIsActive">Active</label>
                </div>
              </div>
            </div>

            <h6 className="settings-section__title mt-4 mb-2">Classroom</h6>
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label">Current Classroom</label>
                <select className="form-select" value={editForm.classroom_id}
                  onChange={(e) => setEditForm({ ...editForm, classroom_id: e.target.value })}>
                  <option value="">Keep current classroom</option>
                  {admitClassrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.grade_level_name} {c.stream_name} - {c.academic_year_year}
                    </option>
                  ))}
                </select>
                <div className="form-text-hint">
                  Only reassigns their current-year class. To move a student up a grade, use Promote instead.
                </div>
              </div>
            </div>

            <h6 className="settings-section__title mt-4 mb-2">Parent / Guardian</h6>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Guardian Name</label>
                <input className="form-control" value={editForm.guardian_name}
                  onChange={(e) => setEditForm({ ...editForm, guardian_name: e.target.value })} />
              </div>
              <div className="col-md-3">
                <label className="form-label">Guardian Phone</label>
                <input className="form-control" placeholder="07XXXXXXXX" value={editForm.guardian_phone}
                  onChange={(e) => setEditForm({ ...editForm, guardian_phone: e.target.value })} />
              </div>
              <div className="col-md-3">
                <label className="form-label">Guardian Email</label>
                <input type="email" className="form-control" placeholder="optional" value={editForm.guardian_email}
                  onChange={(e) => setEditForm({ ...editForm, guardian_email: e.target.value })} />
              </div>
              <div className="col-md-2">
                <label className="form-label">Relationship</label>
                <select className="form-select" value={editForm.guardian_relationship}
                  onChange={(e) => setEditForm({ ...editForm, guardian_relationship: e.target.value })}>
                  <option value="MOTHER">Mother</option>
                  <option value="FATHER">Father</option>
                  <option value="GUARDIAN">Guardian</option>
                </select>
              </div>
              <div className="col-12">
                <div className="form-text-hint mt-0">
                  Leave phone blank to leave the current guardian link unchanged. Changing the phone
                  number replaces the linked guardian entirely (reusing an existing parent account if
                  that number is already registered). Email only fills in / updates the guardian's
                  email — it never touches the phone-based link on its own.
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={editSaving}>
                {editSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---------------- RESET PASSWORD MODAL ---------------- */}
      <Modal show={showResetModal} onClose={() => setShowResetModal(false)} title="Reset Password">
        {resetTarget && (
          resetResult ? (
            <div>
              <div className="alert alert-success">
                Password reset for <strong>{resetTarget.full_name}</strong>.
              </div>
              <p>New password: <code>{resetResult}</code></p>
              <p className="form-text-hint">
                Share this with the student securely — it won't be shown again.
              </p>
              <div className="d-flex justify-content-end">
                <button className="btn btn-secondary" onClick={() => setShowResetModal(false)}>Close</button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleReset}>
              <p>Resetting password for <strong>{resetTarget.full_name}</strong> ({resetTarget.admission_no}).</p>
              <label className="form-label">New Password (optional)</label>
              <input
                className="form-control"
                placeholder="Leave blank to reset to password123"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
              />
              <div className="mt-3 pt-3 border-top d-flex gap-2 justify-content-end">
                <button type="button" className="btn btn-secondary" onClick={() => setShowResetModal(false)}>Cancel</button>
                <button className="btn btn-warning" type="submit" disabled={resetSaving}>
                  {resetSaving ? "Resetting..." : "Reset Password"}
                </button>
              </div>
            </form>
          )
        )}
      </Modal>
    </div>
  );
}