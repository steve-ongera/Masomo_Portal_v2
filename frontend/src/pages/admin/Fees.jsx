import { useEffect, useState, useMemo } from "react";
import { financeApi, academicsApi, calendarApi } from "../../services/api";
import Pagination from "../../components/Pagination";

const money = (v) => Number(v || 0).toLocaleString();

export default function AdminFees() {
  const [structures, setStructures] = useState([]);
  const [gradeLevels, setGradeLevels] = useState([]);
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    grade: "",
    term: "",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const loadAll = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [f, g, t] = await Promise.all([
        financeApi.feeStructures(),
        academicsApi.gradeLevels(),
        calendarApi.terms(),
      ]);
      setStructures(f.data.results ?? f.data);
      setGradeLevels(g.data.results ?? g.data);
      setTerms(t.data.results ?? t.data);
    } catch (error) {
      console.error("Failed to load data:", error);
      setLoadError("Could not load fee structures. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // Filter and Search Logic
  // NOTE: ids are compared as strings so filter values ("3") match whether
  // the backend serializes them as numbers or strings. The serializer sends
  // the raw foreign keys as `grade_level` / `term`, so we read those, and
  // fall back to `grade_level_id` / `term_id` in case they are added later.
  const filteredStructures = useMemo(() => {
    let result = structures;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((f) =>
        (f.grade_level_name || "").toLowerCase().includes(query) ||
        (f.term_label || "").toLowerCase().includes(query)
      );
    }

    if (filters.grade) {
      result = result.filter(
        (f) => String(f.grade_level_id ?? f.grade_level) === String(filters.grade)
      );
    }

    if (filters.term) {
      result = result.filter(
        (f) => String(f.term_id ?? f.term) === String(filters.term)
      );
    }

    return result;
  }, [structures, searchQuery, filters]);

  const totalItems = filteredStructures.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = filteredStructures.slice(startIndex, endIndex);

  // Reset to page 1 whenever the filter inputs change, and clamp the page
  // if the current page falls out of range after filtering.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filters.grade, filters.term]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handlePageChange = (page) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setFilters({ grade: "", term: "" });
    setCurrentPage(1);
  };

  const hasActiveFilters = !!(searchQuery || filters.grade || filters.term);

  const termOptionLabel = (t) => `Term ${t.term_number} - ${t.academic_year_label}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Fee Structures</h1>
          <p className="page-subtitle">
            The fees set for each grade and term, with the breakdown of what makes up each total.
          </p>
        </div>
      </div>

      {loadError && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          {loadError}
          <button type="button" className="btn-close" onClick={() => setLoadError("")}></button>
        </div>
      )}

      {/* Search & Filters */}
      <div className="table-wrap mb-4">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-funnel me-2 text-brand"></i>
            Filters
            {!loading && (
              <span className="badge badge-neutral ms-2">{totalItems}</span>
            )}
          </span>
          {hasActiveFilters && (
            <button type="button" className="btn btn-sm btn-light" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}
        </div>

        <div className="toolbar p-3 mb-0">
          <div className="toolbar__search" style={{ maxWidth: "none" }}>
            <i className="bi bi-search"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Search by grade or term..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="form-select w-auto"
            value={filters.grade}
            onChange={(e) => setFilters({ ...filters, grade: e.target.value })}
          >
            <option value="">All Grades</option>
            {gradeLevels.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select
            className="form-select w-auto"
            value={filters.term}
            onChange={(e) => setFilters({ ...filters, term: e.target.value })}
          >
            <option value="">All Terms</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{termOptionLabel(t)}</option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <div className="chip-row">
            {searchQuery && (
              <span className="filter-chip">
                Search: "{searchQuery}"
                <button onClick={() => setSearchQuery("")}><i className="bi bi-x"></i></button>
              </span>
            )}
            {filters.grade && (
              <span className="filter-chip">
                Grade: {gradeLevels.find((g) => String(g.id) === String(filters.grade))?.name}
                <button onClick={() => setFilters({ ...filters, grade: "" })}><i className="bi bi-x"></i></button>
              </span>
            )}
            {filters.term && (
              <span className="filter-chip">
                Term: {(() => {
                  const t = terms.find((x) => String(x.id) === String(filters.term));
                  return t ? termOptionLabel(t) : "";
                })()}
                <button onClick={() => setFilters({ ...filters, term: "" })}><i className="bi bi-x"></i></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Results heading */}
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <span className="chart-card__title mb-0">
          <i className="bi bi-cash-stack me-2 text-brand"></i>
          All Fee Structures
          {!loading && <span className="badge badge-neutral ms-2">{totalItems}</span>}
        </span>
        {!loading && (
          <span className="chart-card__subtitle mb-0">
            {totalItems === 0
              ? "0 structures"
              : `Showing ${startIndex + 1}-${Math.min(endIndex, totalItems)} of ${totalItems}`}
          </span>
        )}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="row g-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="col-12 col-md-6 col-xl-4">
              <div className="fee-card">
                <div className="d-flex gap-2 mb-3">
                  <div className="skeleton" style={{ height: 20, width: 70 }}></div>
                  <div className="skeleton" style={{ height: 20, width: 100 }}></div>
                </div>
                <div className="skeleton" style={{ height: 30, width: 150, marginBottom: 8 }}></div>
                <div className="skeleton" style={{ height: 12, width: 90, marginBottom: 18 }}></div>
                <div className="skeleton skeleton-text"></div>
                <div className="skeleton skeleton-text"></div>
                <div className="skeleton skeleton-text"></div>
              </div>
            </div>
          ))}
        </div>
      ) : currentItems.length === 0 ? (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-cash-stack"></i>
            <h6>
              {hasActiveFilters
                ? "No fee structures match your search"
                : "No fee structures created yet"}
            </h6>
            <p className="text-muted-soft">
              {hasActiveFilters
                ? "Try adjusting your search or filters"
                : "Fee structures will appear here once they have been set up"}
            </p>
          </div>
        </div>
      ) : (
        <div className="row g-3">
          {currentItems.map((f) => {
            const lineItems = f.items || [];
            return (
              <div key={f.id} className="col-12 col-md-6 col-xl-4">
                <div className="fee-card h-100 d-flex flex-column">
                  {/* Grade + term */}
                  <div className="fee-card__tags">
                    <span className="badge badge-blue">{f.grade_level_name}</span>
                    <span className="badge badge-neutral">{f.term_label}</span>
                    {f.curriculum_display && (
                      <span className="badge badge-gold">{f.curriculum_display}</span>
                    )}
                  </div>

                  {/* Total */}
                  <div className="fee-card__total-label">Total per term</div>
                  <div className="fee-card__total">KES {money(f.total_amount)}</div>

                  {/* Breakdown */}
                  <div className="fee-box mt-auto mb-0">
                    <div className="fee-box__label">
                      <i className="bi bi-list-ul"></i>
                      <span className="section-label">Breakdown</span>
                    </div>
                    {lineItems.length > 0 ? (
                      lineItems.map((i, idx) => (
                        <div key={idx} className="fee-line">
                          <span className="fee-line__name">{i.name}</span>
                          <span className="fee-line__amt">KES {money(i.amount)}</span>
                        </div>
                      ))
                    ) : (
                      <span className="text-muted-soft small">
                        No line items recorded
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && currentItems.length > 0 && (
        <div className="mt-3">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            itemsPerPage={itemsPerPage}
            setItemsPerPage={setItemsPerPage}
            startIndex={startIndex}
            endIndex={endIndex}
            totalItems={totalItems}
          />
        </div>
      )}
    </div>
  );
}