import { useEffect, useState } from "react";
import { teacherApi, academicsApi, calendarApi, examsApi } from "../../services/api";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoImage from "../../assets/nyali_school_logo.png";

// ---------------------------------------------------------------------------
// Shared PDF look (same as report card / roster / payslip)
// ---------------------------------------------------------------------------
const SCHOOL_NAME = "The Nyali School";
const SCHOOL_ADDRESS = "P.O BOX 87073-80100, MOMBASA   |   Email: info@nyalischool.com";
const SCHOOL_MOTTO = "STRIVE TO EXCELL";

// Load an image URL as a base64 data URL (for embedding the logo in PDFs)
const getImageBase64 = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
  });

// Logo at its natural aspect ratio (never squashed)
const placeLogo = (doc, logo, x, y, maxH, maxW) => {
  if (!logo) return;
  const props = doc.getImageProperties(logo);
  const ratio = props.width / props.height;
  let h = maxH;
  let w = h * ratio;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  doc.addImage(logo, "PNG", x, y, w, h);
};

// ---------------------------------------------------------------------------
// Compact subject abbreviations for PDF headers.
// Falls back to the first 3 letters for anything not listed.
// ---------------------------------------------------------------------------
const SUBJECT_ABBREVIATIONS = {
  "english": "Eng",
  "kiswahili": "Kis",
  "mathematics": "Maths",
  "maths": "Maths",
  "math": "Maths",
  "biology": "Bio",
  "chemistry": "Chem",
  "physics": "Phy",
  "geography": "Geo",
  "history": "Hist",
  "history and government": "Hist",
  "history & government": "Hist",
  "cre": "CRE",
  "christian religious education": "CRE",
  "ire": "IRE",
  "islamic religious education": "IRE",
  "hre": "HRE",
  "hindu religious education": "HRE",
  "business studies": "Bus",
  "business": "Bus",
  "agriculture": "Agri",
  "computer studies": "Comp",
  "computer science": "Comp",
  "home science": "Home",
  "social studies": "S.St",
  "science": "Sci",
  "science and technology": "Sci",
  "physical education": "PE",
  "music": "Mus",
  "art": "Art",
  "art and design": "Art",
  "design and technology": "D&T",
  "integrated science": "Int.Sci",
  "pre-technical studies": "PTS",
  "pre technical studies": "PTS",
  "agriculture and nutrition": "Agri",
  "religious education": "RE",
};

function abbreviateSubject(name) {
  if (!name) return "-";
  const key = String(name).trim().toLowerCase();
  if (SUBJECT_ABBREVIATIONS[key]) return SUBJECT_ABBREVIATIONS[key];
  const trimmed = String(name).trim();
  return trimmed.length <= 3 ? trimmed : trimmed.slice(0, 3);
}

export default function TeacherRankings() {
  const [initializing, setInitializing] = useState(true);
  const [noClassTeacherRole, setNoClassTeacherRole] = useState(false);
  const [classrooms, setClassrooms] = useState([]);
  const [terms, setTerms] = useState([]);
  const [exams, setExams] = useState([]);

  const [form, setForm] = useState({ classroom_id: "", term_id: "", exam_id: "" });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [data, setData] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // ---- step 1: which classrooms is this teacher the class teacher of ----
  useEffect(() => {
    teacherApi.myClassTeacherClassrooms().then(({ data: res }) => {
      const rows = res.results ?? res;
      setClassrooms(rows);
      setNoClassTeacherRole(rows.length === 0);
      if (rows.length > 0) {
        setForm((f) => ({ ...f, classroom_id: String(rows[0].id) }));
      }
      setInitializing(false);
    });
  }, []);

  const selectedClassroom = classrooms.find((c) => String(c.id) === String(form.classroom_id));

  // ---- step 2: terms for that classroom's academic year ----
  useEffect(() => {
    if (!selectedClassroom) return;
    calendarApi.terms({ academic_year: selectedClassroom.academic_year }).then(({ data: res }) => {
      const rows = res.results ?? res;
      const current = rows.find((t) => t.is_current) || rows[0];
      setTerms(rows);
      setForm((f) => ({ ...f, term_id: current ? String(current.id) : "", exam_id: "" }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.classroom_id]);

  // ---- step 3: exams for that term + grade level ----
  useEffect(() => {
    if (!form.term_id || !selectedClassroom) {
      setExams([]);
      return;
    }
    examsApi
      .exams({
        term: form.term_id,
        grade_level: selectedClassroom.grade_level_id ?? selectedClassroom.grade_level,
      })
      .then(({ data: res }) => setExams(res.results ?? res))
      .catch(() => setExams([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.term_id, form.classroom_id]);

  const runRanking = async (e) => {
    e.preventDefault();
    setMessage("");
    setData(null);

    if (!form.classroom_id || !form.term_id) {
      setMessage("Select a classroom and term first.");
      return;
    }

    const params = { term: form.term_id };
    if (form.exam_id) params.exam = form.exam_id;

    setLoading(true);
    try {
      const { data: res } = await academicsApi.classroomResults(form.classroom_id, params);
      setData(res);
      if (!res.results?.length) setMessage("No active students found for this selection.");
    } catch (err) {
      setMessage(err.response?.data?.detail || "Could not compute ranking.");
    } finally {
      setLoading(false);
    }
  };

  const selectedExamLabel = form.exam_id
    ? exams.find((ex) => String(ex.id) === String(form.exam_id))?.name
    : "All Exams (Combined)";

  const handleDownloadRankingPdf = async () => {
    if (!data || !data.results?.length) return;
    try {
      setDownloadingPdf(true);

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const M = 12;
      const cw = pageWidth - M * 2;
      const navy = [31, 56, 100];
      const grey = [242, 242, 242];
      const border = [166, 166, 166];
      const black = [0, 0, 0];
      const footerLineY = pageHeight - 14;

      const base64Logo = await getImageBase64(logoImage);

      const generatedOn = new Date().toLocaleDateString("en-KE", {
        year: "numeric", month: "long", day: "numeric",
      });

      placeLogo(doc, base64Logo, M, 9, 21, 34);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.setTextColor(...navy);
      doc.text(SCHOOL_NAME, pageWidth / 2, 17, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...black);
      doc.text(SCHOOL_ADDRESS, pageWidth / 2, 23, { align: "center" });

      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(110, 110, 110);
      doc.text(SCHOOL_MOTTO, pageWidth / 2, 27.5, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      doc.text(`Generated ${generatedOn}`, pageWidth - M, 12, { align: "right" });

      doc.setDrawColor(...navy);
      doc.setLineWidth(0.6);
      doc.line(M, 34, pageWidth - M, 34);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...navy);
      doc.text("CLASS RANKINGS REPORT", pageWidth / 2, 41, { align: "center" });

      const drawCell = (x, y, w, h, text, { bold = false, fill = false, align = "left", size = 8.5 } = {}) => {
        doc.setDrawColor(...border);
        doc.setLineWidth(0.2);
        if (fill) {
          doc.setFillColor(...grey);
          doc.rect(x, y, w, h, "FD");
        } else {
          doc.rect(x, y, w, h, "S");
        }
        const str = String(text ?? "-");
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setTextColor(...black);
        let fs = size;
        doc.setFontSize(fs);
        while (fs > 5.5 && doc.getTextWidth(str) > w - 4) {
          fs -= 0.5;
          doc.setFontSize(fs);
        }
        const tx = align === "center" ? x + w / 2 : x + 2;
        doc.text(str, tx, y + h / 2, { align, baseline: "middle" });
      };

      const rowH = 7.5;
      const labelW = 32;
      const valW = (cw - labelW * 3) / 3;
      const subjects = data.subjects || [];

      let infoY = 46;
      const infoRow = (pairs) => {
        let x = M;
        pairs.forEach(([label, value]) => {
          drawCell(x, infoY, labelW, rowH, label, { bold: true, fill: true });
          x += labelW;
          drawCell(x, infoY, valW, rowH, value);
          x += valW;
        });
        infoY += rowH;
      };
      infoRow([
        ["Class", data.classroom || "-"],
        ["Term / Year", `${data.term || "-"}${data.academic_year ? ` (${data.academic_year})` : ""}`],
        ["Exam", selectedExamLabel || "-"],
      ]);
      infoRow([
        ["Students", String(data.results.length)],
        ["Subjects", String(subjects.length)],
        ["Class Teacher", selectedClassroom?.class_teacher_name || "-"],
      ]);

      const subjectHeaders = subjects.map((s) => abbreviateSubject(s));
      const tableColumn = ["#", "Name", "Reg No", ...subjectHeaders, "Tot", "Pts", "Grd", "Avg%"];

      const tableRows = data.results.map((r) => {
        const base = [r.class_position ?? "-", r.full_name, r.admission_no];
        const subjectCells = subjects.map((s) => {
          const entry = r.subjects.find((sub) => sub.subject === s);
          const avg = entry?.average;
          return avg === null || avg === undefined ? "-" : `${avg}`;
        });
        const totalCell = r.total_marks === null || r.total_marks === undefined ? "-" : `${r.total_marks}`;
        const pointsCell = r.total_points === null || r.total_points === undefined ? "-" : `${r.total_points}`;
        const gradeCell = r.overall_grade || "-";
        const avgCell = r.average_marks === null || r.average_marks === undefined ? "-" : `${r.average_marks}`;
        return [...base, ...subjectCells, totalCell, pointsCell, gradeCell, avgCell];
      });

      const fixedW = 6 + 34 + 18;
      const tailW = 11 + 9 + 9 + 12;
      const n = subjects.length || 1;
      const subjectColWidth = Math.min(14, Math.max(9, (cw - fixedW - tailW) / n));
      const fontSize = subjects.length > 14 ? 6 : 6.5;

      const columnStyles = {
        0: { cellWidth: 6, halign: "center" },
        1: { cellWidth: 34, halign: "left", overflow: "ellipsize" },
        2: { cellWidth: 18, halign: "left", overflow: "ellipsize" },
      };
      let nextIdx = 3;
      subjects.forEach(() => {
        columnStyles[nextIdx] = { cellWidth: subjectColWidth, halign: "center" };
        nextIdx += 1;
      });
      columnStyles[nextIdx] = { cellWidth: 11, halign: "center" }; nextIdx += 1;
      columnStyles[nextIdx] = { cellWidth: 9, halign: "center" };  nextIdx += 1;
      columnStyles[nextIdx] = { cellWidth: 9, halign: "center" };  nextIdx += 1;
      columnStyles[nextIdx] = { cellWidth: 12, halign: "center" };

      autoTable(doc, {
        startY: infoY + 5,
        head: [tableColumn],
        body: tableRows,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize,
          cellPadding: 1,
          lineColor: [191, 191, 191],
          lineWidth: 0.2,
          textColor: black,
          overflow: "ellipsize",
          valign: "middle",
        },
        headStyles: {
          fillColor: navy,
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: fontSize + 0.5,
          cellPadding: 1.4,
          halign: "center",
          lineColor: navy,
        },
        alternateRowStyles: { fillColor: grey },
        columnStyles,
        margin: { top: 14, left: M, right: M, bottom: 22 },
        horizontalPageBreak: true,
        horizontalPageBreakRepeat: [0, 1, 2],
        didParseCell: (d) => {
          if (d.section !== "body") return;
          const lastColIdx = tableColumn.length - 1;
          if (d.column.index === lastColIdx) {
            d.cell.styles.fontStyle = "bold";
          }
          if (d.column.index === lastColIdx - 1) {
            d.cell.styles.fontStyle = "bold";
          }
          if (d.column.index === 0) {
            d.cell.styles.fontStyle = "bold";
          }
          if (String(d.cell.raw).trim() === "-") {
            d.cell.styles.textColor = [148, 163, 184];
            d.cell.styles.fontStyle = "italic";
          }
        },
      });

      let finalY = doc.lastAutoTable.finalY + 14;
      if (finalY > pageHeight - 36) {
        doc.addPage();
        finalY = 24;
      }

      doc.setDrawColor(...black);
      doc.setLineWidth(0.25);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...black);
      doc.text("Class Teacher's Signature:", M, finalY);
      doc.line(M, finalY + 10, 90, finalY + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text("Sign & Date", M, finalY + 14);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...black);
      doc.text("Headteacher's Sign:", pageWidth - 90, finalY);
      doc.line(pageWidth - 90, finalY + 10, pageWidth - M, finalY + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text("Sign & Official Stamp", pageWidth - 90, finalY + 14);

      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);

        doc.setDrawColor(...black);
        doc.setLineWidth(0.15);
        doc.line(M, footerLineY, pageWidth - M, footerLineY);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(6);
        doc.setTextColor(...black);
        doc.text("© The Nyali School. All rights reserved.", M, footerLineY + 4);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.text(`Page ${p} of ${totalPages}`, pageWidth / 2, footerLineY + 4, { align: "center" });

        doc.setFont("helvetica", "italic");
        doc.setFontSize(5.5);
        doc.setTextColor(90, 90, 90);
        doc.text(
          " Powered by Masomo Portal (www.masomoportal.com).",
          pageWidth - M,
          footerLineY + 4,
          { align: "right" }
        );

        doc.setFont("helvetica", "normal");
        doc.setFontSize(5.2);
        doc.text(
          "This document is the property of The Nyali School. It contains confidential student information. Duplication or unauthorized printing is prohibited.",
          M,
          footerLineY + 7.5
        );
      }

      const scopeSlug = (data.classroom || "ranking").replace(/\s+/g, "_");
      const termSlug = (data.term || "term").replace(/\s+/g, "_");
      doc.save(`Class_Rankings_${scopeSlug}_${termSlug}.pdf`);
    } catch (err) {
      console.error("Failed to generate rankings PDF:", err);
      setMessage("Could not generate the rankings PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (initializing) {
    return (
      <div>
        <div className="page-header">
          <div className="d-flex align-items-center gap-3">
            <img src={logoImage} alt="The Nyali School" className="page-header__logo" />
            <h1 className="page-title mb-0">Class Rankings</h1>
          </div>
        </div>
        <p className="page-subtitle">Loading...</p>
      </div>
    );
  }

  if (noClassTeacherRole) {
    return (
      <div>
        <div className="page-header">
          <div className="d-flex align-items-center gap-3">
           
            <div>
              <h1 className="page-title mb-0">Class Rankings</h1>
              <p className="page-subtitle mb-0">
                Ranked results for the class(es) you're assigned to as class teacher.
              </p>
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-people"></i>
            <h6>No class teacher role</h6>
            <p className="text-muted-soft">
              You don't have a class teacher role assigned for this or previous
              academic years, so there's no class ranking to show. Ask an
              administrator to assign you as a class teacher first.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="d-flex align-items-center gap-3">
         
          <div>
            <h1 className="page-title mb-0">Class Rankings</h1>
            <p className="page-subtitle mb-0">
              Ranks every active student in your class by average percentage.
              Pick a single exam (e.g. Midterm) to rank on that exam alone, or leave
              "All Exams" for a combined end-of-term ranking. Ties share a position
              and are broken by admission number.
            </p>
          </div>
        </div>
      </div>

      {message && <div className="alert alert-info">{message}</div>}

      {/* Filters */}
      <div className="table-wrap mb-4">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-funnel me-2 text-brand"></i>
            Compute Ranking
          </span>
        </div>
        <form className="p-3" onSubmit={runRanking}>
          <div className="row g-3 align-items-end">
            <div className="col-md-4">
              <label className="form-label">Classroom</label>
              <select
                className="form-select"
                required
                value={form.classroom_id}
                onChange={(e) => setForm({ ...form, classroom_id: e.target.value })}
              >
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.grade_level_name} {c.stream_name} ({c.academic_year_year})
                    {c.is_promoted ? " - Promoted" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-md-4">
              <label className="form-label">Term</label>
              <select
                className="form-select"
                required
                value={form.term_id}
                onChange={(e) => setForm({ ...form, term_id: e.target.value })}
              >
                <option value="">Select...</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    Term {t.term_number}{t.is_current ? " (Current)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-md-4">
              <label className="form-label">Exam</label>
              <select
                className="form-select"
                value={form.exam_id}
                onChange={(e) => setForm({ ...form, exam_id: e.target.value })}
                disabled={!form.term_id}
              >
                <option value="">All Exams (Combined)</option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} — {ex.exam_type_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button className="btn btn-primary mt-3" disabled={loading}>
            <i className="bi bi-bar-chart-line me-1"></i>
            {loading ? "Computing..." : "Compute Ranking"}
          </button>
        </form>
      </div>

      {/* Results */}
      {data && data.results?.length > 0 && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <div className="min-w-0">
              <div className="chart-card__title mb-0">
                <i className="bi bi-bar-chart-line me-2 text-brand"></i>
                {data.classroom}
                {" · "}{data.term} {data.academic_year ? `(${data.academic_year})` : ""}
                {" · "}{selectedExamLabel}
              </div>
              <div className="chart-card__subtitle mb-0">
                {data.results.length} student(s)
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline-success"
              onClick={handleDownloadRankingPdf}
              disabled={downloadingPdf}
              title="Download this ranking as a landscape PDF"
            >
              {downloadingPdf ? (
                <>
                  <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                  Preparing...
                </>
              ) : (
                <>
                  <i className="bi bi-file-earmark-pdf me-1"></i>
                  Download PDF
                </>
              )}
            </button>
          </div>

          <div className="table-responsive" style={{ maxHeight: "70vh", overflow: "auto" }}>
            <table className="table table-hover table-bordered mb-0">
              <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--surface)" }}>
                <tr>
                  <th style={{ position: "sticky", left: 0, zIndex: 3, background: "var(--surface)", minWidth: 55 }}>#</th>
                  <th style={{ position: "sticky", left: 55, zIndex: 3, background: "var(--surface)", minWidth: 180 }}>
                    Student Name
                  </th>
                  <th style={{ position: "sticky", left: 235, zIndex: 3, background: "var(--surface)", minWidth: 130 }}>
                    Reg No
                  </th>
                  {data.subjects.map((s) => (
                    <th key={s} className="text-center" style={{ minWidth: 100 }}>{s}</th>
                  ))}
                  <th className="text-center" style={{ minWidth: 90 }}>Total Marks</th>
                  <th className="text-center" style={{ minWidth: 80 }}>Total Pts</th>
                  <th className="text-center" style={{ minWidth: 70 }}>Grade</th>
                  <th className="text-center" style={{ minWidth: 110, background: "var(--bg-app)" }}>
                    Average %
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.enrollment_id}>
                    <td style={{ position: "sticky", left: 0, background: "var(--surface)" }} className="fw-semibold cell-mono">
                      {r.class_position}
                    </td>
                    <td style={{ position: "sticky", left: 55, background: "var(--surface)" }}>{r.full_name}</td>
                    <td style={{ position: "sticky", left: 235, background: "var(--surface)" }} className="cell-mono">{r.admission_no}</td>
                    {data.subjects.map((s) => {
                      const entry = r.subjects.find((sub) => sub.subject === s);
                      const avg = entry?.average;
                      return (
                        <td key={s} className="text-center cell-mono">
                          {avg === null || avg === undefined ? <span className="cell-muted">N/A</span> : `${avg}%`}
                        </td>
                      );
                    })}
                    <td className="text-center cell-mono">
                      {r.total_marks === null || r.total_marks === undefined
                        ? <span className="cell-muted">N/A</span>
                        : r.total_marks}
                    </td>
                    <td className="text-center cell-mono">
                      {r.total_points === null || r.total_points === undefined
                        ? <span className="cell-muted">N/A</span>
                        : r.total_points}
                    </td>
                    <td className="text-center fw-semibold">
                      {r.overall_grade || <span className="cell-muted">N/A</span>}
                    </td>
                    <td className="text-center fw-bold cell-mono" style={{ background: "var(--bg-app)" }}>
                      {r.average_marks === null || r.average_marks === undefined
                        ? <span className="cell-muted">N/A</span>
                        : `${r.average_marks}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}