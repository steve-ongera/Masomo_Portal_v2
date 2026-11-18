// src/pages/teacher/assignments/Tracking.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { assignmentsApi, errMsg } from "../../../services/api";
import Breadcrumb from "../../../components/Breadcrumb";
import TableSkeleton from "../../../components/TableSkeleton";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

export default function TeacherAssignmentTracking() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [classroom, setClassroom] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null);
    setLoading(true);
    setError("");
    assignmentsApi.teacher
      .tracking(id, classroom ? { classroom } : {})
      .then((r) => {
        if (alive) setData(r.data);
      })
      .catch((e) => {
        if (alive) setError(errMsg(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, classroom]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.students.filter(
      (s) =>
        (!onlyMissing || !s.viewed) &&
        (!q ||
          s.name.toLowerCase().includes(q) ||
          s.admission_no.toLowerCase().includes(q))
    );
  }, [data, onlyMissing, search]);

  const exportCsv = () => {
    const head = [
      "Admission No",
      "Name",
      "Class",
      "Opened",
      "First opened",
      "Times opened",
      "Downloaded",
      "Last downloaded",
      "Times downloaded",
    ];
    const lines = rows.map((s) => [
      s.admission_no,
      s.name,
      s.classroom,
      s.viewed ? "Yes" : "No",
      s.first_viewed_at || "",
      s.view_count,
      s.downloaded ? "Yes" : "No",
      s.last_downloaded_at || "",
      s.download_count,
    ]);
    const csv = [head, ...lines]
      .map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracking-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div>
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/teacher" },
            { label: "Assignments", href: "/teacher/assignments" },
          ]}
        />
        <div className="page-header">
          <div>
            <h1 className="page-title">Tracking</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/teacher" },
            { label: "Assignments", href: "/teacher/assignments" },
          ]}
        />
        <div className="page-header">
          <div>
            <h1 className="page-title">Tracking</h1>
          </div>
        </div>
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
        </div>
        <Link
          to="/teacher/assignments"
          className="btn btn-secondary mt-3"
        >
          <i className="bi bi-arrow-left me-1"></i>
          Back to Assignments
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const { material, summary } = data;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/teacher" },
          { label: "Assignments", href: "/teacher/assignments" },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">{material.title}</h1>
          <p className="page-subtitle">
            {material.kind_display} · {material.subject_name}
            {!material.is_published && (
              <>
                {" · "}
                <span
                  className="badge badge-neutral"
                  style={{ verticalAlign: "middle" }}
                >
                  <span className="status-dot status-dot--offline"></span>
                  Draft — students cannot see it yet
                </span>
              </>
            )}
          </p>
        </div>
        <Link
          to="/teacher/assignments"
          className="btn btn-outline-secondary"
        >
          <i className="bi bi-arrow-left me-1"></i>
          Back
        </Link>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-6 col-md-3">
          <div className="stat-card">
            <i className="bi bi-people"></i>
            <div>
              <div className="stat-card__value">{summary.recipients}</div>
              <div className="stat-card__label">Students</div>
            </div>
          </div>
        </div>

        <div className="col-6 col-md-3">
          <div className="stat-card stat-card--success">
            <i className="bi bi-eye"></i>
            <div>
              <div className="stat-card__value">{summary.viewed}</div>
              <div className="stat-card__label">Opened</div>
            </div>
          </div>
        </div>

        <div className="col-6 col-md-3">
          <div
            className={`stat-card ${
              summary.not_viewed > 0 ? "stat-card--danger" : ""
            }`}
          >
            <i className="bi bi-eye-slash"></i>
            <div>
              <div className="stat-card__value">{summary.not_viewed}</div>
              <div className="stat-card__label">Not opened yet</div>
            </div>
          </div>
        </div>

        <div className="col-6 col-md-3">
          <div
            className={`stat-card ${
              material.has_file ? "stat-card--gold" : ""
            }`}
          >
            <i className="bi bi-download"></i>
            <div>
              <div className="stat-card__value">
                {material.has_file ? summary.downloaded : "—"}
              </div>
              <div className="stat-card__label">
                {material.has_file ? "Downloaded" : "No file attached"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <div
          className="table-wrap__header"
          style={{
            flexDirection: "column",
            alignItems: "stretch",
            gap: "0.75rem",
          }}
        >
          <div className="d-flex flex-wrap gap-2 align-items-end" style={{ width: "100%" }}>
            <div style={{ minWidth: "180px" }}>
              <label className="form-label">Class</label>
              <select
                className="form-select"
                value={classroom}
                onChange={(e) => setClassroom(e.target.value)}
              >
                <option value="">All classes</option>
                {data.classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                flex: "1 1 240px",
                minWidth: "200px",
                position: "relative",
              }}
            >
              <label className="form-label">Search</label>
              <i
                className="bi bi-search"
                style={{
                  position: "absolute",
                  left: "0.85rem",
                  bottom: "0.75rem",
                  color: "var(--ink-400)",
                }}
              ></i>
              <input
                type="text"
                className="form-control"
                placeholder="Name or admission no..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: "2.4rem" }}
              />
            </div>

            <div style={{ minWidth: "240px" }}>
              <label className="form-label">Filter</label>
              <div
                className="d-flex align-items-center gap-2"
                style={{
                  border: "1px solid var(--border-color-strong)",
                  borderRadius: "var(--radius-md)",
                  padding: "0.42rem 0.75rem",
                  background: "var(--surface)",
                  minHeight: "36px",
                }}
              >
                <div className="form-check form-switch mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="missing"
                    checked={onlyMissing}
                    onChange={(e) => setOnlyMissing(e.target.checked)}
                  />
                  <label
                    className="form-check-label"
                    htmlFor="missing"
                    style={{ fontSize: "var(--fs-xs)" }}
                  >
                    Only students who haven't opened it
                  </label>
                </div>
              </div>
            </div>

            <button
              className="btn btn-outline-primary"
              onClick={exportCsv}
              disabled={!rows.length}
            >
              <i className="bi bi-download me-1"></i>
              Export CSV
            </button>
          </div>

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
              Students
            </span>
            <span
              style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}
            >
              {rows.length} of {data.students.length} shown
            </span>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>No students match</h6>
            <p className="text-muted-soft">
              Try a different search or clear the filters.
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th style={{ width: "130px" }}>Adm No</th>
                  <th>Student</th>
                  <th style={{ width: "160px" }}>Class</th>
                  <th style={{ width: "150px" }}>Opened</th>
                  <th style={{ width: "180px" }}>Last Opened</th>
                  <th style={{ width: "160px" }}>Downloaded</th>
                  <th style={{ width: "180px" }}>Last Downloaded</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.student_id}>
                    <td>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--blue-700)",
                          fontSize: "var(--fs-sm)",
                        }}
                      >
                        {s.admission_no}
                      </span>
                    </td>

                    <td>
                      <div className="table-avatar-cell">
                        <div className="avatar-sm">
                          {(s.name || "")
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((n) => n[0])
                            .join("")}
                        </div>
                        <span className="cell-name">{s.name}</span>
                      </div>
                    </td>

                    <td
                      style={{
                        fontSize: "var(--fs-xs)",
                        color: "var(--ink-700)",
                      }}
                    >
                      {s.classroom || (
                        <span className="cell-muted">—</span>
                      )}
                    </td>

                    <td>
                      {s.viewed ? (
                        <span className="badge badge-success">
                          <span className="status-dot status-dot--online"></span>
                          Yes ({s.view_count}×)
                        </span>
                      ) : (
                        <span className="badge badge-danger">
                          <span className="status-dot status-dot--offline"></span>
                          Not yet
                        </span>
                      )}
                    </td>

                    <td
                      style={{
                        fontSize: "var(--fs-xs)",
                        color: "var(--ink-700)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmt(s.last_viewed_at)}
                    </td>

                    <td>
                      {!material.has_file ? (
                        <span className="cell-muted">—</span>
                      ) : s.downloaded ? (
                        <span className="badge badge-blue">
                          <span className="status-dot status-dot--online"></span>
                          Yes ({s.download_count}×)
                        </span>
                      ) : (
                        <span className="badge badge-neutral">
                          <span className="status-dot status-dot--offline"></span>
                          No
                        </span>
                      )}
                    </td>

                    <td
                      style={{
                        fontSize: "var(--fs-xs)",
                        color: "var(--ink-700)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmt(s.last_downloaded_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              <strong>{rows.length}</strong> student
              {rows.length === 1 ? "" : "s"} shown
              {onlyMissing ? " (unopened only)" : ""}
              {search ? ` matching "${search}"` : ""}
            </span>
            <button
              className="btn btn-sm btn-outline-primary"
              onClick={exportCsv}
            >
              <i className="bi bi-download me-1"></i>
              Export CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}