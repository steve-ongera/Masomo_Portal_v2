// src/pages/student/assignments/Assignments.jsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { assignmentsApi, errMsg } from "../../../services/api";
import { downloadMaterial, fmtSize } from "./downloadFile";
import TableSkeleton from "../../../components/TableSkeleton";

const WORK_KINDS = [
  ["ASSIGNMENT", "Assignment"],
  ["CAT", "CAT"],
  ["TAKEAWAY", "Take-away"],
  ["HOMEWORK", "Homework"],
  ["HOLIDAY", "Holiday Homework"],
];

export default function StudentAssignments() {
  const [tab, setTab] = useState("work");
  const [filters, setFilters] = useState({
    subject: "",
    kind: "",
    unread: false,
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ results: [], count: 0 });
  const [summary, setSummary] = useState({
    unread_work: 0,
    unread_revision: 0,
    subjects: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadSummary = useCallback(() => {
    assignmentsApi.student
      .summary()
      .then((r) => setSummary(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { group: tab, page };
      if (filters.subject) params.subject = filters.subject;
      if (filters.kind && tab === "work") params.kind = filters.kind;
      if (filters.unread) params.unread = 1;
      if (search) params.search = search;
      const r = await assignmentsApi.student.list(params);
      setData(r.data);
      setError("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tab, page, filters, search]);

  useEffect(() => {
    load();
  }, [load]);

  const switchTab = (t) => {
    setTab(t);
    setPage(1);
    setFilters((f) => ({ ...f, kind: "" }));
  };

  const setFilter = (k, v) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };

  const download = async (item) => {
    setBusyId(item.id);
    try {
      await downloadMaterial(item);
      load();
      loadSummary();
    } catch (e) {
      setError(
        e?.response?.status === 404
          ? "This file is not available. Please tell your teacher."
          : "Download failed. Check your connection and try again."
      );
    } finally {
      setBusyId(null);
    }
  };

  const pages = Math.max(1, Math.ceil(data.count / 20));
  const hasFilters = !!(search || filters.subject || filters.kind || filters.unread);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setFilters({ subject: "", kind: "", unread: false });
    setPage(1);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Assignments &amp; Revision</h1>
          <p className="page-subtitle">
            Download the work from your teachers and do it on paper — nothing
            is submitted here.
          </p>
        </div>
      </div>

      <ul className="nav nav-tabs mb-3" role="tablist">
        <li className="nav-item">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "work"}
            className={`nav-link ${tab === "work" ? "active" : ""}`}
            onClick={() => switchTab("work")}
          >
            <i className="bi bi-journal-text me-1"></i>
            Assignments &amp; Homework
            {summary.unread_work > 0 && (
              <span className="badge badge-danger ms-2">
                {summary.unread_work}
              </span>
            )}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "revision"}
            className={`nav-link ${tab === "revision" ? "active" : ""}`}
            onClick={() => switchTab("revision")}
          >
            <i className="bi bi-book me-1"></i>
            Revision Material
            {summary.unread_revision > 0 && (
              <span className="badge badge-danger ms-2">
                {summary.unread_revision}
              </span>
            )}
          </button>
        </li>
      </ul>

      {/* Filters */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-funnel me-2 text-brand"></i>
            Filters
          </span>
          {hasFilters && (
            <button className="btn btn-sm btn-light" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i>
              Clear
            </button>
          )}
        </div>

        <div className="toolbar p-3 mb-0">
          <div className="toolbar__search" style={{ maxWidth: "none" }}>
            <i className="bi bi-search"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Title, teacher, description..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <select
            className="form-select w-auto"
            value={filters.subject}
            onChange={(e) => setFilter("subject", e.target.value)}
          >
            <option value="">All subjects</option>
            {summary.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {tab === "work" && (
            <select
              className="form-select w-auto"
              value={filters.kind}
              onChange={(e) => setFilter("kind", e.target.value)}
            >
              <option value="">All types</option>
              {WORK_KINDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}

          <div className="toolbar__filter">
            <div className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                id="unread"
                checked={filters.unread}
                onChange={(e) => setFilter("unread", e.target.checked)}
              />
              <label className="form-check-label small" htmlFor="unread">
                New only
              </label>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          className="alert alert-danger alert-dismissible fade show"
          role="alert"
        >
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button
            type="button"
            className="btn-close"
            onClick={() => setError("")}
          ></button>
        </div>
      )}

      {loading ? (
        <div className="row g-3">
          {[0, 1, 2].map((i) => (
            <div className="col-md-6 col-xl-4" key={i}>
              <div className="table-wrap h-100">
                <div className="p-3">
                  <div className="skeleton skeleton-text" style={{ width: "50%" }}></div>
                  <div className="skeleton skeleton-text" style={{ width: "80%" }}></div>
                  <div className="skeleton skeleton-text" style={{ width: "60%" }}></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : data.results.length === 0 ? (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-inbox"></i>
            <h6>
              {hasFilters
                ? "Nothing matches your filters"
                : "Nothing here yet"}
            </h6>
            <p className="text-muted-soft">
              {hasFilters
                ? "Try a different search or clear the filters."
                : "Your teachers haven't posted anything here yet."}
            </p>
            {hasFilters && (
              <button className="btn btn-light mt-2" onClick={clearFilters}>
                <i className="bi bi-x-lg me-1"></i>
                Clear Filters
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="row g-3">
          {data.results.map((m) => (
            <div className="col-md-6 col-xl-4" key={m.id}>
              <div className="table-wrap h-100">
                <div className="p-3 d-flex flex-column h-100">
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <span className="badge badge-blue">{m.subject_name}</span>
                    <div className="d-flex gap-1 flex-wrap justify-content-end">
                      {m.is_new && (
                        <span className="badge badge-danger">
                          <span className="status-dot status-dot--offline"></span>
                          New
                        </span>
                      )}
                      {m.downloaded && (
                        <span className="badge badge-success">
                          <span className="status-dot status-dot--online"></span>
                          Downloaded
                        </span>
                      )}
                    </div>
                  </div>

                  <h6 className="cell-name mb-2">{m.title}</h6>

                  <div className="form-text-hint mb-2">
                    <div>
                      <i className="bi bi-tag me-1 text-muted-soft"></i>
                      {m.kind_display} · {m.teacher_name}
                    </div>
                    <div>
                      <i className="bi bi-calendar-event me-1 text-muted-soft"></i>
                      Posted{" "}
                      {m.published_at
                        ? new Date(m.published_at).toLocaleDateString()
                        : "—"}
                    </div>
                    {m.due_date && (
                      <div className="text-gold fw-semibold">
                        <i className="bi bi-alarm me-1"></i>
                        Due{" "}
                        {new Date(m.due_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>

                  {m.description && (
                    <p
                      className="small text-muted-soft mb-3"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {m.description}
                    </p>
                  )}

                  <div className="mt-auto d-flex flex-wrap gap-2 pt-2 border-top">
                    <Link
                      className="btn btn-sm btn-outline-primary"
                      to={`/student/assignments/${m.id}`}
                    >
                      <i className="bi bi-eye me-1"></i>
                      {m.has_text ? "Read" : "Open"}
                    </Link>
                    {m.has_file && (
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busyId === m.id}
                        onClick={() => download(m)}
                      >
                        {busyId === m.id ? (
                          <>
                            <span className="dot-loader me-2">
                              <span></span>
                              <span></span>
                              <span></span>
                            </span>
                            Downloading...
                          </>
                        ) : (
                          <>
                            <i className="bi bi-download me-1"></i>
                            Download ({fmtSize(m.file_size)})
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && pages > 1 && (
        <div className="table-wrap mt-3">
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              Page <strong>{page}</strong> of <strong>{pages}</strong> ·{" "}
              <strong>{data.count}</strong> item
              {data.count === 1 ? "" : "s"}
            </span>
            <div className="d-flex gap-2">
              <button
                className="btn btn-sm btn-outline-primary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <i className="bi bi-chevron-left me-1"></i>
                Previous
              </button>
              <button
                className="btn btn-sm btn-outline-primary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next
                <i className="bi bi-chevron-right ms-1"></i>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}