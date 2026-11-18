import { useEffect, useState } from "react";
import { teacherApi } from "../../services/api";

export default function TeacherClasses() {
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    teacherApi
      .myAllocations()
      .then(({ data }) => setAllocations(data.results ?? data))
      .catch((error) => console.error("Failed to load allocations:", error))
      .finally(() => setLoading(false));
  }, []);

  // Filter allocations by search
  const filteredAllocations = allocations.filter((a) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    return (
      a.subject_name?.toLowerCase().includes(query) ||
      a.classroom_label?.toLowerCase().includes(query)
    );
  });

  // Group allocations by classroom for better organization
  const groupedByClassroom = filteredAllocations.reduce((acc, alloc) => {
    const key = alloc.classroom_label || "Unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(alloc);
    return acc;
  }, {});

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">My Classes</h1>
          <p className="page-subtitle">
            Every subject/classroom pair you're allocated to this academic year.
          </p>
        </div>
        <div className="page-header__actions">
          <span className="badge badge-neutral">
            <i className="bi bi-door-open me-1"></i>
            {allocations.length} allocation{allocations.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="table-wrap mb-4">
        <div className="toolbar p-3 mb-0">
          <div className="toolbar__search" style={{ maxWidth: "none" }}>
            <i className="bi bi-search"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by subject or classroom..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {searchQuery && (
            <button
              type="button"
              className="btn btn-sm btn-light"
              onClick={() => setSearchQuery("")}
            >
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="row g-3">
          {[1, 2, 3].map((i) => (
            <div className="col-12 col-md-6 col-lg-4" key={i}>
              <div className="table-wrap">
                <div className="p-3">
                  <div className="skeleton skeleton-text" style={{ width: "60%", height: 24, marginBottom: "0.5rem" }}></div>
                  <div className="skeleton skeleton-text" style={{ width: "40%", height: 16 }}></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredAllocations.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-door-open"></i>
          <h6>
            {searchQuery ? "No classes match your search" : "No classes allocated yet"}
          </h6>
          <p className="text-muted-soft">
            {searchQuery
              ? "Try adjusting your search criteria."
              : "Your subject/classroom allocations will appear here once assigned by the administrator."}
          </p>
        </div>
      ) : (
        <>
          {/* Grouped by Classroom Cards */}
          <div className="row g-3">
            {Object.entries(groupedByClassroom).map(([classroom, allocs]) => (
              <div className="col-12 col-md-6 col-lg-4" key={classroom}>
                <div className="table-wrap h-100">
                  {/* Classroom Header */}
                  <div className="table-wrap__header">
                    <div className="d-flex align-items-center gap-3 min-w-0">
                      <div
                        className="dm-card__icon"
                        style={{ width: 40, height: 40, fontSize: "1.1rem" }}
                      >
                        <i className="bi bi-door-open"></i>
                      </div>
                      <div className="min-w-0">
                        <div className="chart-card__title text-truncate mb-0">
                          {classroom}
                        </div>
                        <div className="chart-card__subtitle">
                          <i className="bi bi-book me-1"></i>
                          {allocs.length} subject{allocs.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Subjects List */}
                  <div className="p-3">
                    <div className="form-text-hint mb-2">
                      <i className="bi bi-list-ul me-1"></i> Subjects taught:
                    </div>
                    <div className="pick-list">
                      {allocs.map((a) => (
                        <div key={a.id} className="pick-item">
                          <i className="bi bi-journal-bookmark text-brand"></i>
                          <span className="cell-name flex-grow-1 text-start">
                            {a.subject_name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Summary Footer */}
          <div className="note-card mt-4 mb-0">
            <i className="bi bi-info-circle"></i>
            <span>
              You teach <strong>{allocations.length}</strong> subject{allocations.length !== 1 ? "s" : ""} across{" "}
              <strong>{Object.keys(groupedByClassroom).length}</strong> classroom{Object.keys(groupedByClassroom).length !== 1 ? "s" : ""}.
            </span>
          </div>
        </>
      )}
    </div>
  );
}