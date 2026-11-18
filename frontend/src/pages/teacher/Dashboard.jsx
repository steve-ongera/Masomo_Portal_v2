// src/pages/teacher/Dashboard.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { teacherApi } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";

export default function TeacherDashboard() {
  const { user } = useAuth();
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    teacherApi
      .myAllocations()
      .then(({ data }) => setAllocations(data.results ?? data))
      .catch((error) => console.error("Failed to load allocations:", error))
      .finally(() => setLoading(false));
  }, []);

  const classroomCount = new Set(allocations.map((a) => a.classroom_label)).size;
  const subjectCount = new Set(allocations.map((a) => a.subject_name)).size;

  // Get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  // Group allocations by classroom
  const groupedByClassroom = allocations.reduce((acc, alloc) => {
    const key = alloc.classroom_label || "Unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(alloc);
    return acc;
  }, {});

  return (
    <div>
      {/* Page Header with Welcome */}
      <div className="page-header">
        <div>
          <h1 className="page-title mb-0">
            {getGreeting()}, {user?.first_name || "Teacher"}!
          </h1>
          <p className="page-subtitle mb-0">
            Welcome to your teaching dashboard
          </p>
        </div>
        <div className="page-header__actions">
          <Link to="/teacher/marks" className="btn btn-primary btn-sm">
            <i className="bi bi-pencil-square"></i>
            Enter Marks
          </Link>
          <Link to="/teacher/classes" className="btn btn-outline-primary btn-sm">
            <i className="bi bi-door-open"></i>
            My Classes
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="stat-grid">
        <div className="dm-card dm-card--primary">
          <div className="dm-card__top">
            <span className="dm-card__label">Classes Taught</span>
            <span className="dm-card__icon">
              <i className="bi bi-door-open"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: 40, height: 24 }}></div>
            ) : classroomCount}
          </div>
        </div>

        <div className="dm-card dm-card--warning">
          <div className="dm-card__top">
            <span className="dm-card__label">Subjects Taught</span>
            <span className="dm-card__icon">
              <i className="bi bi-journal-bookmark"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: 40, height: 24 }}></div>
            ) : subjectCount}
          </div>
        </div>

        <div className="dm-card dm-card--success">
          <div className="dm-card__top">
            <span className="dm-card__label">Total Allocations</span>
            <span className="dm-card__icon">
              <i className="bi bi-people"></i>
            </span>
          </div>
          <div className="dm-card__num">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ width: 40, height: 24 }}></div>
            ) : allocations.length}
          </div>
        </div>

        <div className="dm-card dm-card--primary">
          <div className="dm-card__top">
            <span className="dm-card__label">Academic Year</span>
            <span className="dm-card__icon">
              <i className="bi bi-calendar3"></i>
            </span>
          </div>
          <div className="dm-card__num">{new Date().getFullYear()}</div>
        </div>
      </div>

      {/* Allocations Section */}
      <div className="table-wrap">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-list-ul me-2 text-brand"></i>
            This Year's Allocations
          </span>
          {!loading && allocations.length > 0 && (
            <span className="badge badge-neutral">
              {Object.keys(groupedByClassroom).length} classroom{Object.keys(groupedByClassroom).length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {loading ? (
          <div className="p-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton skeleton-text" style={{ height: 18, marginBottom: 14 }} />
            ))}
          </div>
        ) : allocations.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-inbox"></i>
            <h6>No allocations yet</h6>
            <p className="text-muted-soft">
              Ask an admin to allocate you a subject and classroom.
            </p>
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "60px" }}>#</th>
                    <th>Subject</th>
                    <th>Classroom</th>
                    <th style={{ width: "100px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((a, idx) => (
                    <tr key={a.id}>
                      <td className="cell-muted cell-mono">
                        {idx + 1}
                      </td>
                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">
                            <i className="bi bi-journal-bookmark" style={{ fontSize: "0.75rem" }}></i>
                          </div>
                          <span className="cell-name">{a.subject_name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-blue">
                          <i className="bi bi-door-open me-1"></i>
                          {a.classroom_label}
                        </span>
                      </td>
                      <td>
                        <Link
                          to="/teacher/marks"
                          className="btn btn-sm btn-outline-primary"
                          title="Enter marks for this class"
                        >
                          <i className="bi bi-pencil-square me-1"></i>
                          Marks
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quick Actions Footer */}
            <div className="table-wrap__footer justify-content-between">
              <span className="table-wrap__footer-info">
                <i className="bi bi-info-circle me-1"></i>
                Showing <strong>{allocations.length}</strong> allocation{allocations.length !== 1 ? "s" : ""} across{" "}
                <strong>{Object.keys(groupedByClassroom).length}</strong> classroom{Object.keys(groupedByClassroom).length !== 1 ? "s" : ""}
              </span>
              <div className="d-flex gap-2">
                <Link to="/teacher/classes" className="btn btn-sm btn-light">
                  <i className="bi bi-door-open me-1"></i>
                  View All Classes
                </Link>
                <Link to="/teacher/rankings" className="btn btn-sm btn-light">
                  <i className="bi bi-bar-chart-line me-1"></i>
                  Class Rankings
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}