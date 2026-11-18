// src/pages/student/Timetable.jsx
// Also works for parents: pass ?student_id=<id> (see timetableApi.myClass).
import { useEffect, useState } from "react";
import { calendarApi, timetableApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import TimetableGrid, { downloadTimetablePdf } from "../../components/TimetableGrid";

export default function StudentTimetable() {
  const [terms, setTerms] = useState([]);
  const [termId, setTermId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    calendarApi
      .terms()
      .then((r) => setTerms(r.data.results ?? r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    timetableApi
      .myClass(termId ? { term: termId } : {})
      .then((r) => {
        setData(r.data);
        if (!termId) setTermId(String(r.data.term_id));
      })
      .catch((e) => setError(e.response?.data?.detail || "Could not load the class timetable."))
      .finally(() => setLoading(false));
  }, [termId]);

  const downloadPdf = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      await downloadTimetablePdf({
        days: data.days,
        mode: "student",
        title: "Class Weekly Timetable",
        meta: [`Class: ${data.classroom}`, `Term: ${data.term_label}`, `Learner: ${data.student_name}`],
        filename: `class_timetable_${String(data.classroom).replace(/\s+/g, "_")}.pdf`,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Class Timetable</h1>
          <p className="page-subtitle">
            Who teaches your class, which subject, and at what time. Today's row is highlighted.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-calendar3 me-2 text-brand"></i>
            Term
          </span>
          <div className="toolbar mb-0">
            <select
              className="form-select w-auto"
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.academic_year_label} - {t.get_term_number_display || `Term ${t.term_number}`}
                  {t.is_current ? " (current)" : ""}
                </option>
              ))}
            </select>
            {data && (
              <span className="badge badge-blue">{data.classroom}</span>
            )}
            <button
              className="btn btn-outline-primary ms-auto"
              onClick={downloadPdf}
              disabled={!data || loading || downloading}
            >
              {downloading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Preparing...
                </>
              ) : (
                <>
                  <i className="bi bi-file-earmark-pdf me-1"></i>Download PDF
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-warning">{error}</div>}

      {loading ? (
        <TableSkeleton rows={6} columns={7} />
      ) : data ? (
        <TimetableGrid days={data.days} mode="student" />
      ) : null}
    </div>
  );
}