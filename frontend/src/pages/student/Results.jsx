import { useEffect, useMemo, useState } from "react";
import { studentsApi, examsApi, calendarApi, academicsApi, profileApi, timetableApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoImage from "../../assets/nyali_school_logo.png";

// ---------------------------------------------------------------------------
// Fallback grading bands, used ONLY when /grading-scales/ isn't reachable or
// doesn't have a row that covers a given percentage.
// ---------------------------------------------------------------------------
const FALLBACK_844 = [
  { min: 80, max: 100, letter: "A", points: 12 },
  { min: 75, max: 79.99, letter: "A-", points: 11 },
  { min: 70, max: 74.99, letter: "B+", points: 10 },
  { min: 65, max: 69.99, letter: "B", points: 9 },
  { min: 60, max: 64.99, letter: "B-", points: 8 },
  { min: 55, max: 59.99, letter: "C+", points: 7 },
  { min: 50, max: 54.99, letter: "C", points: 6 },
  { min: 45, max: 49.99, letter: "C-", points: 5 },
  { min: 40, max: 44.99, letter: "D+", points: 4 },
  { min: 35, max: 39.99, letter: "D", points: 3 },
  { min: 30, max: 34.99, letter: "D-", points: 2 },
  { min: 0, max: 29.99, letter: "E", points: 1 },
];

const FALLBACK_CBC = [
  { min: 75, max: 100, letter: "EE", points: null, remark: "Exceeding Expectation" },
  { min: 50, max: 74.99, letter: "ME", points: null, remark: "Meeting Expectation" },
  { min: 30, max: 49.99, letter: "AE", points: null, remark: "Approaching Expectation" },
  { min: 0, max: 29.99, letter: "BE", points: null, remark: "Below Expectation" },
];

function fallbackGrade(curriculumType, percentage) {
  const table = curriculumType === "CBC" ? FALLBACK_CBC : FALLBACK_844;
  return table.find((b) => percentage >= b.min && percentage <= b.max) || null;
}

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

// ---- Report card wording (matches the school's official report card) ----
const SCHOOL_NAME = "The Nyali School";
const SCHOOL_ADDRESS = "P.O BOX 87073-80100, MOMBASA   |   Email: info@nyalischool.com";
const SCHOOL_MOTTO = "STRIVE TO EXCELL";
const PASS_MARK = 50; // mean score below this = "has not attained a pass mark"

// Draws the logo at its natural aspect ratio (never squashed into a square)
const placeLogo = (doc, logo, x, y, maxH, maxW) => {
  if (!logo) return { w: 0, h: 0 };
  const props = doc.getImageProperties(logo);
  const ratio = props.width / props.height;
  let h = maxH;
  let w = h * ratio;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  doc.addImage(logo, "PNG", x, y, w, h);
  return { w, h };
};

// Per-subject teacher remark, by the subject's average %.
const subjectRemark = (avg) => {
  if (avg === null || avg === undefined) return "Did not sit for this paper.";
  if (avg >= 80) return "Excellent performance. Keep up the good work.";
  if (avg >= 60) return "Good performance. Keep working hard to reach the top grade.";
  if (avg >= 45) return "Fair performance. More consistency and effort required.";
  if (avg >= 30) return "Below average. Needs close attention and extra practice.";
  return "Poor performance. Requires urgent remedial support.";
};

const firstNameOf = (fullName) => {
  const first = String(fullName || "The student").trim().split(/\s+/)[0] || "The student";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
};

const classTeacherRemark = (name, mean) => {
  if (mean === null || mean === undefined) {
    return `No examination marks have been recorded for ${name} this term.`;
  }
  let text;
  if (mean >= 80) text = `${name} has performed excellently this term. Keep up the outstanding work and aim even higher.`;
  else if (mean >= 60) text = `${name} has performed well this term. With continued effort, the top grade is within reach.`;
  else if (mean >= 45) text = `${name} has shown a fair performance this term. With more focus, a higher grade is achievable.`;
  else if (mean >= 30) text = `${name} has performed below average this term and needs to put in significantly more effort.`;
  else text = `${name} has performed poorly this term and requires urgent remedial support and closer supervision.`;
  if (mean < PASS_MARK) text += " The student has not attained a pass mark this term and needs to work much harder.";
  return text;
};

const principalRemark = (name, mean) => {
  if (mean === null || mean === undefined) {
    return `The school administration encourages ${name} to consult subject teachers and sit all papers next term.`;
  }
  if (mean < PASS_MARK) {
    return `The student has not attained a pass mark this term and needs to work much harder. The school administration encourages ${name} to maintain close consultation with subject teachers next term.`;
  }
  return `The student has attained a pass mark this term. The school administration encourages ${name} to keep up the good work and aim even higher next term.`;
};

// "#3 of 42" or "-" when there is no position
const positionText = (pos, size) => (pos ? `#${pos}${size ? ` of ${size}` : ""}` : "-");

export default function StudentResults() {
  // ---- identity / curriculum ----
  const [profile, setProfile] = useState(null);

  // ---- full academic history ----
  const [enrollmentHistory, setEnrollmentHistory] = useState([]);
  const [classroomsById, setClassroomsById] = useState({});
  const [academicYears, setAcademicYears] = useState([]);
  const [gradingScales, setGradingScales] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // ---- drilldown selection: year -> term -> exam ----
  const [selectedYear, setSelectedYear] = useState("");
  const [terms, setTerms] = useState([]);
  const [termsLoading, setTermsLoading] = useState(false);
  const [selectedTerm, setSelectedTerm] = useState("");
  const [exams, setExams] = useState([]);
  const [examsLoading, setExamsLoading] = useState(false);
  const [selectedExam, setSelectedExam] = useState("");

  // ---- results for the chosen exam ----
  const [results, setResults] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  // ---- per-exam summary (total marks, points, overall grade, position) ----
  const [examSummary, setExamSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // ---- term ranking ----
  const [ranking, setRanking] = useState(null);
  const [rankingCheckpoint, setRankingCheckpoint] = useState(null);
  const [rankingLoading, setRankingLoading] = useState(false);

  // ---- PDF download state ----
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // ---------------------------------------------------------------------
  // Initial load
  // ---------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      setHistoryLoading(true);
      try {
        const [profileRes, enrollRes, classroomsRes, yearsRes] = await Promise.all([
          profileApi.me(),
          studentsApi.enrollments({ page_size: 200 }),
          academicsApi.classrooms({ page_size: 500 }),
          calendarApi.academicYears(),
        ]);

        setProfile(profileRes.data);

        const history = (enrollRes.data.results ?? enrollRes.data)
          .slice()
          .sort((a, b) => a.academic_year - b.academic_year);
        setEnrollmentHistory(history);

        const cMap = {};
        (classroomsRes.data.results ?? classroomsRes.data).forEach((c) => { cMap[c.id] = c; });
        setClassroomsById(cMap);

        const yearsList = yearsRes.data.results ?? yearsRes.data;
        setAcademicYears(yearsList);

        try {
          if (academicsApi.gradingScales) {
            const { data } = await academicsApi.gradingScales();
            setGradingScales(data.results ?? data);
          }
        } catch {
          setGradingScales([]);
        }

        if (history.length > 0) {
          const currentYearObj = yearsList.find((y) => y.is_current);
          const hasCurrent = currentYearObj && history.some((e) => e.academic_year === currentYearObj.id);
          const defaultYear = hasCurrent
            ? currentYearObj.id
            : history[history.length - 1].academic_year;
          setSelectedYear(defaultYear);
        }
      } catch (error) {
        console.error("Failed to load student history:", error);
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, []);

  const yearLabel = (yearId) => academicYears.find((y) => y.id === yearId)?.year ?? yearId;

  const currentEnrollment = useMemo(
    () => enrollmentHistory.find((e) => String(e.academic_year) === String(selectedYear)),
    [enrollmentHistory, selectedYear]
  );
  const currentClassroom = currentEnrollment ? classroomsById[currentEnrollment.classroom] : null;

  // ---------------------------------------------------------------------
  // Terms
  // ---------------------------------------------------------------------
  useEffect(() => {
    setSelectedTerm("");
    setTerms([]);
    if (!selectedYear) return;
    setTermsLoading(true);
    calendarApi.terms({ academic_year: selectedYear })
      .then(({ data }) => {
        const list = (data.results ?? data).slice().sort((a, b) => a.term_number - b.term_number);
        setTerms(list);
        const current = list.find((t) => t.is_current);
        setSelectedTerm(current ? current.id : (list[list.length - 1]?.id ?? ""));
      })
      .catch((err) => { console.error("Failed to load terms:", err); setTerms([]); })
      .finally(() => setTermsLoading(false));
  }, [selectedYear]);

  // ---------------------------------------------------------------------
  // Exams
  // ---------------------------------------------------------------------
  useEffect(() => {
    setSelectedExam("");
    setExams([]);
    if (!selectedTerm || !currentClassroom) return;
    setExamsLoading(true);
    examsApi.exams({ term: selectedTerm, grade_level: currentClassroom.grade_level })
      .then(({ data }) => {
        const list = (data.results ?? data)
          .filter((ex) => ex.is_published)
          .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
        setExams(list);
        setSelectedExam(list.length ? list[list.length - 1].id : "");
      })
      .catch((err) => { console.error("Failed to load exams:", err); setExams([]); })
      .finally(() => setExamsLoading(false));
  }, [selectedTerm, currentClassroom]);

  // ---------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------
  useEffect(() => {
    setResults([]);
    if (!currentEnrollment || !selectedExam) return;
    setResultsLoading(true);
    examsApi.results({ enrollment: currentEnrollment.id, exam: selectedExam, page_size: 500 })
      .then(({ data }) => setResults(data.results ?? data))
      .catch((err) => console.error("Failed to load results:", err))
      .finally(() => setResultsLoading(false));
  }, [currentEnrollment, selectedExam]);

  // ---------------------------------------------------------------------
  // Per-exam summary: total marks, points, overall grade, class position
  // ---------------------------------------------------------------------
  useEffect(() => {
    setExamSummary(null);
    if (!currentEnrollment || !selectedExam) return;
    let cancelled = false;
    setSummaryLoading(true);
    examsApi.summary({ enrollment: currentEnrollment.id, exam: selectedExam })
      .then(({ data }) => { if (!cancelled) setExamSummary(data); })
      .catch((err) => console.error("Failed to load exam summary:", err))
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [currentEnrollment, selectedExam]);

  // ---------------------------------------------------------------------
  // Term ranking (midterm / end of term)
  // ---------------------------------------------------------------------
  useEffect(() => {
    setRanking(null);
    setRankingCheckpoint(null);
    if (!currentEnrollment || !selectedTerm) return;

    let cancelled = false;
    const fetchCheckpoint = (checkpoint) =>
      examsApi
        .rankings({ enrollment: currentEnrollment.id, term: selectedTerm, checkpoint })
        .then(({ data }) => (data.results ?? data)[0] || null);

    setRankingLoading(true);
    fetchCheckpoint("ENDTERM")
      .then((endterm) => {
        if (cancelled) return;
        if (endterm) {
          setRanking(endterm);
          setRankingCheckpoint("ENDTERM");
          return;
        }
        return fetchCheckpoint("MIDTERM").then((midterm) => {
          if (cancelled) return;
          if (midterm) {
            setRanking(midterm);
            setRankingCheckpoint("MIDTERM");
          }
        });
      })
      .catch((err) => console.error("Failed to load ranking:", err))
      .finally(() => { if (!cancelled) setRankingLoading(false); });

    return () => { cancelled = true; };
  }, [currentEnrollment, selectedTerm]);

  // ---------------------------------------------------------------------
  // Group papers into one row per subject + attach grade
  // ---------------------------------------------------------------------
  const curriculumType = profile?.student_profile?.curriculum_type;

  const gradeFor = (subjectId, rawPct) => {
    if (rawPct === null || rawPct === undefined) return null;
    // Round to 2dp so values like 74.995 don't fall between two bands
    const percentage = Math.round(rawPct * 100) / 100;
    const scaleRows = gradingScales.filter(
      (s) => s.curriculum_type === curriculumType && percentage >= Number(s.min_percentage) && percentage <= Number(s.max_percentage)
    );
    const specific = scaleRows.find((s) => s.subject === subjectId);
    const generic = scaleRows.find((s) => s.subject === null);
    const match = specific || generic;
    if (match) {
      return { letter: match.grade_letter, points: match.points !== undefined ? Number(match.points) : null, remark: match.remark };
    }
    return fallbackGrade(curriculumType, percentage);
  };

  const subjectRows = useMemo(() => {
    const map = {};
    results.forEach((r) => {
      const key = r.subject;
      if (!map[key]) {
        map[key] = { subject_id: r.subject, subject_name: r.subject_name, papers: [], marksTotal: 0, maxTotal: 0, hasMarks: false, anyAbsent: false };
      }
      map[key].papers.push(r);
      if (r.is_absent) {
        map[key].anyAbsent = true;
      } else if (r.marks_obtained !== null && r.marks_obtained !== undefined) {
        map[key].marksTotal += Number(r.marks_obtained);
        map[key].maxTotal += Number(r.max_marks);
        map[key].hasMarks = true;
      }
    });
    return Object.values(map).map((row) => {
      const percentage = row.hasMarks && row.maxTotal > 0 ? (row.marksTotal / row.maxTotal) * 100 : null;
      const grade = percentage !== null ? gradeFor(row.subject_id, percentage) : null;
      return { ...row, percentage, grade };
    });
  }, [results, gradingScales, curriculumType]);

  // ---------------------------------------------------------------------
  // Overall stats (computed locally from the subject rows)
  // ---------------------------------------------------------------------
  const stats = useMemo(() => {
    const scored = subjectRows.filter((r) => r.percentage !== null);
    if (scored.length === 0) return null;
    const totalMarks = scored.reduce((s, r) => s + r.marksTotal, 0);
    const totalMax = scored.reduce((s, r) => s + r.maxTotal, 0);
    const average = totalMax > 0 ? (totalMarks / totalMax) * 100 : 0;
    const allHavePoints = scored.every((r) => r.grade && r.grade.points !== null && r.grade.points !== undefined);
    const totalPoints = allHavePoints ? scored.reduce((s, r) => s + r.grade.points, 0) : null;
    return { subjectCount: scored.length, totalMarks, totalMax, average, totalPoints };
  }, [subjectRows]);

  // ---------------------------------------------------------------------
  // Overall block: server values first, local calculation as a fallback
  // ---------------------------------------------------------------------
  const overall = useMemo(() => {
    if (!stats) return null;
    const is844 = curriculumType !== "CBC";
    const local = gradeFor(null, stats.average);
    return {
      average: Number(examSummary?.average ?? stats.average),
      grade: examSummary?.overall_grade ?? local?.letter ?? "-",
      remark: examSummary?.overall_remark || local?.remark || "",
      totalPoints: is844 ? (examSummary?.total_points ?? stats.totalPoints) : null,
      classPosition: examSummary?.class_position ?? null,
      classSize: examSummary?.class_size ?? null,
      gradePosition: examSummary?.grade_position ?? null,
      gradeSize: examSummary?.grade_size ?? null,
    };
  }, [stats, examSummary, curriculumType, gradingScales]);

  const perfBadgeClass = (percentage) => {
    if (percentage === null || percentage === undefined) return "badge-neutral";
    if (percentage >= 80) return "badge-success";
    if (percentage >= 60) return "badge-gold";
    if (percentage >= 40) return "badge-blue";
    return "badge-danger";
  };

  const selectedExamObj = exams.find((e) => String(e.id) === String(selectedExam));
  const selectedTermObj = terms.find((t) => String(t.id) === String(selectedTerm));

  // ---------------------------------------------------------------------
  // Subject -> teacher name(s) for this student's class, read from the class
  // timetable (students can read it; the teacher-allocations endpoint is
  // admin-only). If it can't be loaded, the Teacher column shows "-".
  // ---------------------------------------------------------------------
  const loadSubjectTeachers = async () => {
    if (!selectedTerm) return {};
    try {
      const { data } = await timetableApi.myClass({ term: selectedTerm });
      const map = {};
      (data.days || []).forEach((day) =>
        (day.periods || []).forEach((p) =>
          (p.lessons || []).forEach((l) => {
            const subject = String(l.subject || "").trim().toLowerCase();
            const teacher = String(l.teacher_name || "").trim();
            if (!subject || !teacher) return;
            map[subject] = map[subject] || [];
            if (!map[subject].includes(teacher)) map[subject].push(teacher);
          })
        )
      );
      return map;
    } catch (err) {
      console.error("Could not load subject teachers for the report card:", err);
      return {};
    }
  };

  // ---------------------------------------------------------------------
  // Download report card PDF - ONE A4 page, same layout as the admin report card
  // ---------------------------------------------------------------------
  const handleDownloadReportPdf = async () => {
    if (!subjectRows.length) return;
    try {
      setDownloadingPdf(true);

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const M = 12;
      const cw = pageWidth - M * 2;
      const navy = [31, 56, 100];
      const grey = [242, 242, 242];
      const border = [166, 166, 166];
      const black = [0, 0, 0];

      const [logoBase64, teacherMap] = await Promise.all([
        getImageBase64(logoImage),
        loadSubjectTeachers(),
      ]);
      // QR PNG is generated by the backend (see StudentExamSummaryView)
      const qrCodeBase64 = examSummary?.qr_code_base64 || null;

      // ---- values ----
      const studentName = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() || "-";
      const admissionNo = profile?.student_profile?.admission_no || "-";
      const className = currentClassroom
        ? `${currentClassroom.grade_level_name} ${currentClassroom.stream_name || ""}`.trim()
        : "-";
      const termLabel = selectedTermObj
        ? `Term ${selectedTermObj.term_number}, ${yearLabel(selectedYear)}`
        : String(yearLabel(selectedYear));
      const examWord = (selectedExamObj?.exam_type_name || selectedExamObj?.name || "End of Term")
        .replace(/\s*exam(ination)?s?$/i, "")
        .trim();
      const titleText = `${termLabel.toUpperCase()} ${examWord.toUpperCase()} EXAMINATION REPORT`;

      const hasMarks = !!overall;
      const mean = hasMarks ? Math.round(overall.average * 10) / 10 : null;
      const name = firstNameOf(studentName);
      const subjects = subjectRows.map((r) => ({
        subject: r.subject_name,
        average: r.percentage !== null ? Math.round(r.percentage * 10) / 10 : null,
        grade: r.grade?.letter || null,
      }));

      // ---- Header: logo (left), school details (centre), QR (right) ----
      placeLogo(doc, logoBase64, M, 9, 21, 34);

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

      if (qrCodeBase64) {
        const qrSize = 20;
        const qrX = pageWidth - M - qrSize;
        doc.addImage(`data:image/png;base64,${qrCodeBase64}`, "PNG", qrX, 9, qrSize, qrSize);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(4.8);
        doc.setTextColor(110, 110, 110);
        doc.text("Scan to verify", qrX + qrSize / 2, 31, { align: "center" });
      }

      doc.setDrawColor(...navy);
      doc.setLineWidth(0.6);
      doc.line(M, 34, pageWidth - M, 34);

      // ---- Title ----
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...navy);
      doc.text(titleText, pageWidth / 2, 41, { align: "center" });

      // one bordered cell with auto-shrinking text
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

      // ---- Student / term info table ----
      let y = 46;
      const rowH = 7.5;
      const labelW = 36;
      const valW = (cw - labelW * 2) / 2;
      drawCell(M, y, labelW, rowH, "Student Name", { bold: true, fill: true });
      drawCell(M + labelW, y, valW, rowH, studentName);
      drawCell(M + labelW + valW, y, labelW, rowH, "Admission No.", { bold: true, fill: true });
      drawCell(M + labelW * 2 + valW, y, valW, rowH, admissionNo);
      y += rowH;
      drawCell(M, y, labelW, rowH, "Term / Year", { bold: true, fill: true });
      drawCell(M + labelW, y, valW, rowH, termLabel);
      drawCell(M + labelW + valW, y, labelW, rowH, "Class / Form", { bold: true, fill: true });
      drawCell(M + labelW * 2 + valW, y, valW, rowH, className);
      y += rowH + 6;

      // ---- Pre-calculate fixed-size sections so the subject table fits ----
      const footerLineY = pageHeight - 14;
      const blockH = 26;
      const blockTop = footerLineY - 4 - blockH;

      const measureRemark = (text) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        const lines = doc.splitTextToSize(text, cw - 8);
        return { lines, h: 10 + lines.length * 3.5 + 2.5 };
      };
      const ctRemark = measureRemark(classTeacherRemark(name, mean));
      const prRemark = measureRemark(principalRemark(name, mean));

      const n = subjects.length;
      const fontSize = n <= 9 ? 8 : n <= 12 ? 7.5 : n <= 16 ? 7 : 6.5;
      const sumH = 7;
      const fixedBelow = 6 + sumH * 2 + 5 + ctRemark.h + 4 + prRemark.h + 4;
      const headH = 8;
      const availForRows = blockTop - 3 - y - fixedBelow - headH;
      const lineH = fontSize * 0.3528 * 1.15;
      const perRow = n > 0 ? availForRows / n : 6;
      const pad = Math.min(2.2, Math.max(0.35, (perRow - lineH) / 2));

      const body = subjects.map((s, i) => {
        const teachers = teacherMap[String(s.subject || "").trim().toLowerCase()];
        return [
          String(i + 1),
          s.subject,
          s.average != null ? String(s.average) : "-",
          s.grade || "-",
          subjectRemark(s.average),
          teachers && teachers.length ? teachers.join(" / ") : "-",
        ];
      });

      const colNo = 8, colSubject = 42, colMarks = 15, colGrade = 12, colTeacher = 34;
      const colRemarks = cw - colNo - colSubject - colMarks - colGrade - colTeacher;

      autoTable(doc, {
        startY: y,
        head: [["No", "Subject", "Marks\n/100", "Grade", "Teacher's Remarks", "Teacher"]],
        body,
        theme: "grid",
        margin: { left: M, right: M },
        styles: {
          font: "helvetica",
          fontSize,
          textColor: black,
          lineColor: [191, 191, 191],
          lineWidth: 0.2,
          cellPadding: { top: pad, bottom: pad, left: 1.6, right: 1.6 },
          valign: "middle",
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: navy,
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 7.5,
          halign: "left",
          lineColor: navy,
          cellPadding: { top: 1, bottom: 1, left: 1.6, right: 1.6 },
        },
        alternateRowStyles: { fillColor: grey },
        columnStyles: {
          0: { cellWidth: colNo, halign: "center" },
          1: { cellWidth: colSubject },
          2: { cellWidth: colMarks, halign: "center" },
          3: { cellWidth: colGrade, halign: "center", fontStyle: "bold" },
          4: { cellWidth: colRemarks, fontSize: Math.max(5.8, fontSize - 1) },
          5: { cellWidth: colTeacher, fontSize: Math.max(5.8, fontSize - 0.5) },
        },
        didParseCell: (d) => {
          if (d.section === "head" && [0, 2, 3].includes(d.column.index)) d.cell.styles.halign = "center";
        },
      });

      y = doc.lastAutoTable.finalY + 6;

      // ---- Summary: Total Marks / Mean Score / Mean Grade ----
      const w1 = 28, v1 = 66, w2 = 28, v2 = 22, w3 = 26;
      const v3 = cw - w1 - v1 - w2 - v2 - w3;
      let x = M;
      drawCell(x, y, w1, sumH, "Total Marks", { bold: true, fill: true }); x += w1;
      drawCell(x, y, v1, sumH, stats ? `${stats.totalMarks} / ${stats.totalMax}` : "-", { align: "center" }); x += v1;
      drawCell(x, y, w2, sumH, "Mean Score", { bold: true, fill: true }); x += w2;
      drawCell(x, y, v2, sumH, hasMarks ? mean : "-", { align: "center" }); x += v2;
      drawCell(x, y, w3, sumH, "Mean Grade", { bold: true, fill: true }); x += w3;
      drawCell(x, y, v3, sumH, overall?.grade || "-", { align: "center", bold: true });
      y += sumH;

      // ---- Class Position + Overall (grade-wide) Position ----
      drawCell(M, y, w1, sumH, "Class Position", { bold: true, fill: true });
      drawCell(
        M + w1, y, v1, sumH,
        overall?.classPosition != null ? `${overall.classPosition} out of ${overall.classSize ?? "-"}` : "-",
        { align: "center" }
      );
      drawCell(M + w1 + v1, y, w2, sumH, "Overall Position", { bold: true, fill: true });
      drawCell(
        M + w1 + v1 + w2, y, cw - w1 - v1 - w2, sumH,
        overall?.gradePosition != null
          ? `${overall.gradePosition} out of ${overall.gradeSize ?? "-"} (${currentClassroom?.grade_level_name || "grade"}, all streams)`
          : "-",
        { align: "center" }
      );
      y += sumH + 5;

      // ---- Remarks boxes ----
      const drawRemarkBox = (top, title, remark) => {
        doc.setDrawColor(...border);
        doc.setLineWidth(0.2);
        doc.rect(M, top, cw, remark.h);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...navy);
        doc.text(title, M + 4, top + 5.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...black);
        doc.text(remark.lines, M + 4, top + 10);
        return top + remark.h;
      };
      y = drawRemarkBox(y, "Class Teacher's Remarks:", ctRemark) + 4;
      y = drawRemarkBox(y, "Principal's Remarks:", prRemark);

      // ---- Bottom block: [Class Teacher] [Official Stamp] [Principal] ----
      const stampW = 46;
      const stampX = pageWidth / 2 - stampW / 2;
      const sigGap = 6;
      const leftEnd = stampX - sigGap;
      const rightStart = stampX + stampW + sigGap;

      doc.setDrawColor(...black);
      doc.setLineWidth(0.25);
      doc.rect(stampX, blockTop, stampW, blockH);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...black);
      doc.text("Official School Stamp", pageWidth / 2, blockTop + 5, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(120, 120, 120);
      doc.text("(Stamp here)", pageWidth / 2, blockTop + blockH / 2 + 3, { align: "center" });

      const drawSignature = (x1, x2, label, printedName) => {
        if (printedName) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(...black);
          let fs = 8;
          while (fs > 5.5 && doc.getTextWidth(printedName) > x2 - x1) {
            fs -= 0.5;
            doc.setFontSize(fs);
          }
          doc.text(printedName, x1, blockTop + 12);
        }
        doc.setDrawColor(...black);
        doc.setLineWidth(0.25);
        doc.line(x1, blockTop + 15, x2, blockTop + 15);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...black);
        doc.text(label, x1, blockTop + 19.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text("Date: ____________________", x1, blockTop + 25);
      };
      drawSignature(M, leftEnd, "Class Teacher's Signature", currentClassroom?.class_teacher_name || "");
      drawSignature(rightStart, pageWidth - M, "Headteacher's Sign");

      // ---- Footer ----
      doc.setDrawColor(...black);
      doc.setLineWidth(0.15);
      doc.line(M, footerLineY, pageWidth - M, footerLineY);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(...black);
      doc.text("© The Nyali School. All rights reserved.", M, footerLineY + 4);

      doc.setFont("helvetica", "italic");
      doc.setFontSize(5.5);
      doc.setTextColor(90, 90, 90);
      doc.text(" Powered by Masomo Portal (www.masomoportal.com).", pageWidth - M, footerLineY + 4, { align: "right" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.2);
      doc.text(
        "This document is the property of The Nyali School. Parents/guardians should keep it safe. Duplication or unauthorized printing is prohibited.",
        M,
        footerLineY + 7.5
      );

      const safeName = (studentName || "student").replace(/\s+/g, "_");
      const safeExam = (selectedExamObj?.name || "exam").replace(/\s+/g, "_");
      doc.save(`Report_Card_${safeName}_${safeExam}.pdf`);
    } catch (err) {
      console.error("Failed to generate report card PDF:", err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const statsTiles = stats && overall && !resultsLoading && [
    { label: "Subjects", value: stats.subjectCount, variant: "secondary" },
    { label: "Total Marks (this exam)", value: `${stats.totalMarks} / ${stats.totalMax}`, variant: "success" },
    { label: "Exam Average", value: `${overall.average.toFixed(1)}%`, variant: "warning" },
    curriculumType === "CBC"
      ? { label: "Overall Level", value: overall.remark || "-", variant: "primary" }
      : { label: "Total Points", value: overall.totalPoints ?? "-", variant: "primary" },
    { label: "Overall Grade", value: overall.grade, variant: "success" },
    {
      label: "Class Position (this exam)",
      value: summaryLoading ? "…" : positionText(overall.classPosition, overall.classSize),
      sub: overall.gradePosition ? `Grade-wide ${positionText(overall.gradePosition, overall.gradeSize)}` : null,
      variant: "warning",
    },
  ];

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-report, #printable-report * { visibility: visible; }
          #printable-report { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        {/* ---- Page Header ---- */}
        <div className="page-header">
          <div>
            <h1 className="page-title">My Results</h1>
            <p className="page-subtitle">
              Browse your results by academic year, term and exam — or print a report card.
            </p>
          </div>
          <div className="page-header__actions">
            {curriculumType && (
              <span className="badge badge-blue">
                <i className="bi bi-mortarboard me-1"></i>
                {curriculumType === "CBC" ? "CBC" : "8-4-4"}
              </span>
            )}
            {currentClassroom && (
              <span className="badge badge-neutral">
                <i className="bi bi-door-open me-1"></i>
                {currentClassroom.grade_level_name} {currentClassroom.stream_name}
              </span>
            )}
          </div>
        </div>

        {/* ---- Unified filter bar (history + year + term + exam) ---- */}
        {!historyLoading && enrollmentHistory.length > 0 && (
          <div className="table-wrap mb-4">
            <div className="table-wrap__header flex-column align-items-stretch gap-3">
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-funnel me-2 text-brand"></i>
                  Filters
                </span>
                <span className="chart-card__subtitle mb-0">
                  {enrollmentHistory.length} year{enrollmentHistory.length !== 1 ? "s" : ""} on record
                </span>
              </div>

              <div className="chip-row p-0 border-0">
                {enrollmentHistory.map((e) => {
                  const active = String(e.academic_year) === String(selectedYear);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className={`filter-chip ${active ? "filter-chip--selected" : ""}`}
                      onClick={() => setSelectedYear(e.academic_year)}
                      title={e.classroom_label}
                    >
                      {yearLabel(e.academic_year)} — {e.classroom_label}
                      {e.status !== "ACTIVE" && (
                        <span className="text-muted-soft ms-1">({e.status})</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="toolbar mb-0">
                <select
                  className="form-select w-auto"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                >
                  {enrollmentHistory
                    .slice()
                    .sort((a, b) => b.academic_year - a.academic_year)
                    .map((e) => (
                      <option key={e.academic_year} value={e.academic_year}>
                        {yearLabel(e.academic_year)} ({e.classroom_label})
                      </option>
                    ))}
                </select>
                <select
                  className="form-select w-auto"
                  value={selectedTerm}
                  onChange={(e) => setSelectedTerm(e.target.value)}
                  disabled={termsLoading || terms.length === 0}
                >
                  {terms.length === 0 && <option value="">{termsLoading ? "Loading..." : "No terms"}</option>}
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>Term {t.term_number}</option>
                  ))}
                </select>
                <select
                  className="form-select w-auto"
                  value={selectedExam}
                  onChange={(e) => setSelectedExam(e.target.value)}
                  disabled={examsLoading || exams.length === 0}
                >
                  {exams.length === 0 && (
                    <option value="">{examsLoading ? "Loading..." : "No published exams"}</option>
                  )}
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.name} ({ex.exam_type_name})</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {historyLoading && <TableSkeleton rows={2} columns={4} />}

        {!historyLoading && enrollmentHistory.length === 0 && (
          <div className="table-wrap">
            <div className="empty-state">
              <i className="bi bi-journal-x"></i>
              <h6>No Enrollment Records</h6>
              <p className="text-muted-soft">We couldn't find any enrollment history for your account.</p>
            </div>
          </div>
        )}
      </div>

      {/* ================= PRINTABLE REPORT AREA ================= */}
      {selectedExam && (
        <div id="printable-report">
          {/* print-only header */}
          <div className="d-none d-print-block mb-3">
            <h4 className="mb-0">Report Card</h4>
            <div className="small">
              {profile?.first_name} {profile?.last_name} ({profile?.student_profile?.admission_no}) —{" "}
              {currentClassroom ? `${currentClassroom.grade_level_name} ${currentClassroom.stream_name}` : ""} —{" "}
              {selectedTermObj ? `Term ${selectedTermObj.term_number}, ${yearLabel(selectedYear)}` : ""} —{" "}
              {selectedExamObj?.name}
            </div>
            <hr />
          </div>

          {/* ---- Term ranking banner ---- */}
          {rankingLoading && (
            <div className="alert alert-light no-print">
              <span className="text-muted-soft">
                <i className="bi bi-hourglass-split me-2"></i>
                Loading term position...
              </span>
            </div>
          )}

          {!rankingLoading && ranking && (
            <div className="alert alert-success d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <i className="bi bi-trophy me-2 text-gold"></i>
                <strong>Term Position:</strong>
                <span className="fw-bold text-body ms-2" style={{ fontSize: "1.1rem" }}>
                  #{ranking.class_position}
                </span>
                {ranking.grade_position && (
                  <span className="cell-muted ms-2">
                    (Grade-wide #{ranking.grade_position})
                  </span>
                )}
              </div>
              <div>
                <strong>Term Average ({rankingCheckpoint === "MIDTERM" ? "Midterm" : "End of Term"}):</strong>
                <span
                  className="fw-bold ms-2"
                  style={{
                    fontSize: "1.1rem",
                    color: Number(ranking.average_marks) >= 60 ? "var(--success-600)" : "var(--danger-600)",
                  }}
                >
                  {ranking.average_marks}%
                </span>
              </div>
            </div>
          )}

          {/* ---- Stats tiles ---- */}
          {statsTiles && (
            <div className="stat-grid">
              {statsTiles.map((c) => (
                <div className={`dm-card dm-card--${c.variant}`} key={c.label}>
                  <div className="dm-card__top">
                    <span className="dm-card__label">{c.label}</span>
                  </div>
                  <div className="dm-card__num">{c.value}</div>
                  {c.sub && <div className="dm-card__sub">{c.sub}</div>}
                </div>
              ))}
            </div>
          )}

          {/* ---- Per-subject table ---- */}
          {resultsLoading ? (
            <TableSkeleton rows={5} columns={4} />
          ) : subjectRows.length === 0 ? (
            <div className="table-wrap">
              <div className="empty-state">
                <i className="bi bi-journal-text"></i>
                <h6>No Results Found</h6>
                <p className="text-muted-soft">
                  No marks have been entered for this exam yet, or it hasn't been published.
                </p>
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <div className="table-wrap__header">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-journal-text me-2 text-brand"></i>
                  {selectedExamObj?.name}
                  <span className="badge badge-neutral ms-2">{subjectRows.length}</span>
                </span>
                <span className="chart-card__subtitle mb-0">
                  <i className="bi bi-calendar3 me-1"></i>
                  Term {selectedTermObj?.term_number}, {yearLabel(selectedYear)}
                </span>
              </div>
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th style={{ width: "120px" }} className="text-end">Percentage</th>
                      <th style={{ width: "100px" }} className="text-center">Grade</th>
                      {curriculumType === "CBC" ? (
                        <th style={{ width: "200px" }}>Remark</th>
                      ) : (
                        <th style={{ width: "100px" }} className="text-center">Points</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {subjectRows.map((row) => (
                      <tr key={row.subject_id}>
                        <td>
                          <span className="cell-name">{row.subject_name}</span>
                        </td>
                        <td className="text-end">
                          {row.percentage !== null ? (
                            <span className={`badge ${perfBadgeClass(row.percentage)}`}>
                              {row.percentage.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="cell-muted">-</span>
                          )}
                        </td>
                        <td className="text-center">
                          {row.grade ? (
                            <span className={`badge ${perfBadgeClass(row.percentage)} fw-bold`}>
                              {row.grade.letter}
                            </span>
                          ) : (
                            <span className="cell-muted">-</span>
                          )}
                        </td>
                        {curriculumType === "CBC" ? (
                          <td className="cell-muted">
                            {row.grade?.remark || <span className="cell-muted">-</span>}
                          </td>
                        ) : (
                          <td className="text-center cell-muted">
                            {row.grade?.points !== null && row.grade?.points !== undefined
                              ? row.grade.points
                              : <span className="cell-muted">-</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {overall && (
                    <tfoot>
                      <tr className="fw-bold">
                        <td>Overall</td>
                        <td className="text-end">{overall.average.toFixed(1)}%</td>
                        <td className="text-center">{overall.grade}</td>
                        {curriculumType === "CBC"
                          ? <td>{overall.remark || "-"}</td>
                          : <td className="text-center">{overall.totalPoints ?? "-"}</td>}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <div className="table-wrap__footer no-print">
                <span className="table-wrap__footer-info">
                  Showing <strong>{subjectRows.length}</strong> subject{subjectRows.length !== 1 ? "s" : ""}
                </span>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    onClick={handleDownloadReportPdf}
                    disabled={downloadingPdf || summaryLoading || subjectRows.length === 0}
                  >
                    {downloadingPdf ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                        Preparing...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-file-earmark-pdf me-1"></i>
                        Download Report Card (PDF)
                      </>
                    )}
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => window.print()}>
                    <i className="bi bi-printer me-1"></i>
                    Print Report Card
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}