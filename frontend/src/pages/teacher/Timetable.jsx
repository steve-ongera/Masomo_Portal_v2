// src/pages/teacher/Timetable.jsx
import { useEffect, useState } from "react";
import { calendarApi, timetableApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import TimetableGrid, { downloadTimetablePdf, shortTeacherName } from "../../components/TimetableGrid";

export default function TeacherTimetable() {
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
      .myTeaching(termId ? { term: termId } : {})
      .then((r) => {
        setData(r.data);
        if (!termId) setTermId(String(r.data.term_id));
      })
      .catch((e) => setError(e.response?.data?.detail || "Could not load your timetable."))
      .finally(() => setLoading(false));
  }, [termId]);

  const downloadPdf = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      await downloadTimetablePdf({
        days: data.days,
        mode: "teacher",
        title: "Teacher Weekly Timetable",
        meta: [
          `Teacher: ${shortTeacherName(data.teacher_name)}`,
          `Term: ${data.term_label}`,
          `Lessons per week: ${data.total_lessons_per_week}`,
        ],
        filename: `my_timetable_${String(data.term_label).replace(/\s+/g, "_")}.pdf`,
        signatures: false,
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Timetable</h1>
          <p className="page-subtitle">
            Your weekly lessons across every class you teach. Each cell shows the time, the class and the subject.
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
              <span className="chart-card__subtitle mb-0">
                {data.total_lessons_per_week} lessons per week
              </span>
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
        <>
          <TimetableGrid days={data.days} mode="teacher" />
          {data.total_lessons_per_week === 0 && (
            <div className="alert alert-info mt-3">
              No lessons have been placed on the timetable for you in this term yet. Please check with the timetable office.
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}