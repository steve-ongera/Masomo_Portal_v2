import { useEffect, useRef, useState, useMemo } from "react";
import api, { teacherApi, examsApi, studentsApi, calendarApi, academicsApi } from "../../services/api";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoImage from "../../assets/nyali_school_logo.png";

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

export default function TeacherMarkEntry() {
  const [allocations, setAllocations] = useState([]);
  const [classroomsById, setClassroomsById] = useState({});
  const [subjectsById, setSubjectsById] = useState({});
  const [exams, setExams] = useState([]);
  const [examsLoading, setExamsLoading] = useState(false);
  const [selectedAllocation, setSelectedAllocation] = useState("");
  const [selectedExam, setSelectedExam] = useState("");
  const [enrollments, setEnrollments] = useState([]);
  const [marks, setMarks] = useState({});
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [marksLoading, setMarksLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Per-exam paper setup (PP1 / PP2 ... and what each is out of)
  const [serverColumns, setServerColumns] = useState([]); // saved setup for this exam + subject
  const [setupVersion, setSetupVersion] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const [draftPapers, setDraftPapers] = useState([]);
  const [savingSetup, setSavingSetup] = useState(false);

  useEffect(() => {
    const loadStatic = async () => {
      setLoading(true);
      try {
        const [allocRes, classroomsRes, subjectsRes] = await Promise.all([
          teacherApi.myAllocations(),
          academicsApi.classrooms({ page_size: 200 }),
          academicsApi.subjects(),
        ]);
        setAllocations(allocRes.data.results ?? allocRes.data);

        const cMap = {};
        (classroomsRes.data.results ?? classroomsRes.data).forEach((c) => { cMap[c.id] = c; });
        setClassroomsById(cMap);

        const sMap = {};
        (subjectsRes.data.results ?? subjectsRes.data).forEach((s) => { sMap[s.id] = s; });
        setSubjectsById(sMap);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadStatic();
  }, []);

  const allocation = allocations.find((a) => String(a.id) === String(selectedAllocation));

  useEffect(() => {
    setSelectedExam("");
    if (!allocation) { setExams([]); return; }

    const classroom = classroomsById[allocation.classroom];
    if (!classroom) { setExams([]); return; }

    const load = async () => {
      setExamsLoading(true);
      try {
        const [termsRes, examsRes] = await Promise.all([
          calendarApi.terms({ academic_year: allocation.academic_year }),
          examsApi.exams({ grade_level: classroom.grade_level }),
        ]);
        const termIds = new Set((termsRes.data.results ?? termsRes.data).map((t) => t.id));
        const allExams = examsRes.data.results ?? examsRes.data;
        setExams(allExams.filter((ex) => termIds.has(ex.term)));
      } catch (error) {
        console.error("Failed to load exams:", error);
        setExams([]);
      } finally {
        setExamsLoading(false);
      }
    };
    load();
  }, [selectedAllocation, allocation, classroomsById]);

  // Load the saved paper setup for this exam + subject
  useEffect(() => {
    setSetupOpen(false);
    if (!allocation || !selectedExam) { setServerColumns([]); return; }
    let cancelled = false;
    examsApi
      .paperSetup({ exam: selectedExam, subject: allocation.subject })
      .then(({ data }) => { if (!cancelled) setServerColumns(data.papers || []); })
      .catch(() => { if (!cancelled) setServerColumns([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExam, selectedAllocation]);

  const subject = allocation ? subjectsById[allocation.subject] : null;
  const fallbackPapers = (subject?.papers ?? [])
    .slice()
    .sort((a, b) => a.paper_number - b.paper_number);

  // The saved per-exam setup wins; otherwise the old behaviour.
  const paperColumns = serverColumns.length > 0
    ? serverColumns.map((p) => ({
        key: p.paper_id ? String(p.paper_id) : "single",
        id: p.paper_id,
        paper_number: p.paper_number,
        label: p.name,
        max_marks: p.max_marks,
      }))
    : fallbackPapers.length > 0
    ? fallbackPapers.map((p) => ({
        key: String(p.id),
        id: p.id,
        paper_number: p.paper_number,
        label: p.name || `Paper ${p.paper_number}`,
        max_marks: p.max_marks,
      }))
    : [{ key: "single", id: null, paper_number: 0, label: "Marks", max_marks: 100 }];

  const paperColumnsRef = useRef([]);
  paperColumnsRef.current = paperColumns;

  const fetchAllEnrollments = async (classroomId) => {
    let results = [];
    let nextUrl = null;
    let params = { classroom: classroomId, status: "ACTIVE", page_size: 500 };

    do {
      const { data } = nextUrl ? await api.get(nextUrl) : await studentsApi.enrollments(params);
      results = results.concat(data.results ?? data);
      nextUrl = data.next || null;
      params = null;
    } while (nextUrl);

    return results;
  };

  useEffect(() => {
    if (!allocation) { setEnrollments([]); setMarks({}); return; }
    setLoading(true);
    fetchAllEnrollments(allocation.classroom).then((list) => {
      setEnrollments(list);

      const cols = paperColumnsRef.current.map((c) => c.key);

      const initial = {};
      list.forEach((e) => {
        initial[e.id] = {};
        cols.forEach((key) => { initial[e.id][key] = { marks_obtained: "", is_absent: false }; });
      });
      setMarks(initial);
      setLoading(false);
    }).catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAllocation]);

  useEffect(() => {
    if (!allocation || !selectedExam || enrollments.length === 0) return;

    const cols = paperColumnsRef.current.map((c) => c.key);

    let cancelled = false;
    setMarksLoading(true);
    examsApi.results({
      exam: selectedExam,
      subject: allocation.subject,
      enrollment__classroom: allocation.classroom,
      page_size: 1000,
    }).then(({ data }) => {
      if (cancelled) return;
      const list = data.results ?? data;

      setMarks((prev) => {
        const next = { ...prev };
        enrollments.forEach((en) => {
          next[en.id] = { ...next[en.id] };
          cols.forEach((key) => {
            next[en.id][key] = next[en.id][key] || { marks_obtained: "", is_absent: false };
          });
        });
        list.forEach((r) => {
          const key = r.paper ? String(r.paper) : "single";
          if (!next[r.enrollment]) return;
          next[r.enrollment] = {
            ...next[r.enrollment],
            [key]: {
              marks_obtained: r.is_absent ? "" : (r.marks_obtained ?? ""),
              is_absent: r.is_absent,
            },
          };
        });
        return next;
      });
    }).catch((err) => {
      console.error("Failed to load existing marks:", err);
    }).finally(() => {
      if (!cancelled) setMarksLoading(false);
    });

    return () => { cancelled = true; };
  }, [selectedExam, selectedAllocation, enrollments, allocation, setupVersion]);

  const updateMark = (enrollmentId, columnKey, field, value) => {
    setMarks((prev) => ({
      ...prev,
      [enrollmentId]: {
        ...prev[enrollmentId],
        [columnKey]: { ...prev[enrollmentId]?.[columnKey], [field]: value },
      },
    }));
  };

  // ---------- paper setup panel ----------
  const openSetup = () => {
    setDraftPapers(
      paperColumns.map((c) => ({
        paper_number: c.paper_number,
        name: c.paper_number === 0 ? "Marks" : c.label,
        max_marks: c.max_marks,
      }))
    );
    setSetupOpen(true);
  };

  const useSingleMark = () =>
    setDraftPapers([{ paper_number: 0, name: "Marks", max_marks: draftPapers[0]?.max_marks || 100 }]);

  const usePapers = () =>
    setDraftPapers([
      { paper_number: 1, name: "Paper 1", max_marks: draftPapers[0]?.max_marks || 100 },
      { paper_number: 2, name: "Paper 2", max_marks: 100 },
    ]);

  const addDraftPaper = () => {
    const next = Math.max(0, ...draftPapers.map((p) => p.paper_number)) + 1;
    setDraftPapers((d) => [...d, { paper_number: next, name: `Paper ${next}`, max_marks: 100 }]);
  };

  const updateDraft = (idx, field, value) =>
    setDraftPapers((d) => d.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));

  const removeDraft = (idx) => setDraftPapers((d) => d.filter((_, i) => i !== idx));

  const saveSetup = async () => {
    setSavingSetup(true);
    setMessage("");
    try {
      const { data } = await examsApi.savePaperSetup({
        exam_id: Number(selectedExam),
        subject_id: allocation.subject,
        papers: draftPapers.map((p) => ({
          paper_number: p.paper_number,
          name: p.name,
          max_marks: Number(p.max_marks),
        })),
      });
      setServerColumns(data.papers || []);
      setSetupVersion((v) => v + 1); // reload saved marks against the new columns
      setSetupOpen(false);
      setMessage("Paper setup saved for this exam.");
      setMessageType("success");
    } catch (err) {
      setMessage(err.response?.data?.detail || "Could not save paper setup.");
      setMessageType("danger");
    } finally {
      setSavingSetup(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setMessage("");
    if (!allocation || !selectedExam) return;
    setSaving(true);
    try {
      let totalSaved = 0;
      let totalErrors = 0;
      for (const col of paperColumns) {
        const rows = enrollments.map((en) => {
          const cell = marks[en.id]?.[col.key] || {};
          return {
            enrollment_id: en.id,
            marks_obtained: cell.is_absent
              ? null
              : (cell.marks_obtained === "" || cell.marks_obtained == null ? null : Number(cell.marks_obtained)),
            is_absent: !!cell.is_absent,
          };
        });
        const { data } = await examsApi.bulkEntry({
          exam_id: Number(selectedExam),
          subject_id: allocation.subject,
          paper_id: col.id,
          max_marks: Number(col.max_marks),
          rows,
        });
        totalSaved += data.saved.length;
        totalErrors += data.errors.length;
      }
      setMessage(` Saved ${totalSaved} mark(s).${totalErrors ? ` ${totalErrors} error(s).` : ""}`);
      setMessageType(totalErrors ? "warning" : "success");
    } catch (err) {
      setMessage(err.response?.data?.detail || "Could not save marks.");
      setMessageType("danger");
    } finally {
      setSaving(false);
    }
  };

  const getMarksCount = () => {
    let count = 0;
    enrollments.forEach((en) => {
      paperColumns.forEach((col) => {
        const cell = marks[en.id]?.[col.key];
        if (cell && (cell.is_absent || (cell.marks_obtained !== "" && cell.marks_obtained != null))) count++;
      });
    });
    return count;
  };

  const totalStudents = enrollments.length;
  const totalCells = totalStudents * paperColumns.length;

  const sortedStudents = useMemo(() => {
    const list = enrollments.map((en) => {
      let marksTotal = 0;
      let maxTotal = 0;
      let hasAny = false;

      const perPaper = paperColumns.map((col) => {
        const cell = marks[en.id]?.[col.key] || {};
        const maxM = Number(col.max_marks) || 0;
        if (cell.is_absent) {
          maxTotal += maxM;
          return { key: col.key, value: "Abs", absent: true };
        }
        if (cell.marks_obtained !== "" && cell.marks_obtained != null) {
          const v = Number(cell.marks_obtained);
          marksTotal += v;
          maxTotal += maxM;
          hasAny = true;
          return { key: col.key, value: String(v), absent: false };
        }
        return { key: col.key, value: "-", absent: false };
      });

      const percentage = maxTotal > 0 && hasAny ? (marksTotal / maxTotal) * 100 : null;

      return {
        enrollment: en,
        perPaper,
        marksTotal,
        maxTotal,
        percentage,
      };
    });

    return list.sort((a, b) => {
      if (a.percentage === null && b.percentage === null) return 0;
      if (a.percentage === null) return 1;
      if (b.percentage === null) return -1;
      return b.percentage - a.percentage;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollments, marks, serverColumns, subject]);

  const handleDownloadClassPdf = async () => {
    if (!enrollments.length) return;
    try {
      setDownloadingPdf(true);

      const hasMultiplePapers = paperColumns.length > 1;
      const orientation = hasMultiplePapers ? "landscape" : "portrait";
      const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const base64Logo = await getImageBase64(logoImage);

      const generatedOn = new Date().toLocaleDateString("en-KE", {
        year: "numeric", month: "long", day: "numeric",
      });

      const examObj = exams.find((e) => String(e.id) === String(selectedExam));

      // --- Header ---
      if (base64Logo) {
        doc.addImage(base64Logo, "PNG", 12, 10, 14, 14);
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42);
      doc.text("The Nyali School", base64Logo ? 30 : 12, 17);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      doc.text("Class Performance Report", base64Logo ? 30 : 12, 23);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated ${generatedOn}`, pageWidth - 12, 16, { align: "right" });

      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(12, 28, pageWidth - 12, 28);

      // --- Meta block ---
      autoTable(doc, {
        startY: 32,
        theme: "grid",
        body: [
          ["Subject", allocation?.subject_name || "-", "Class", allocation?.classroom_label || "-"],
          ["Exam", examObj?.name || "-", "Exam Type", examObj?.exam_type_name || "-"],
          ["Papers", String(paperColumns.length), "Students", String(sortedStudents.length)],
        ],
        styles: {
          fontSize: 9,
          cellPadding: 2.5,
          lineColor: [226, 232, 240],
          lineWidth: 0.1,
          textColor: [51, 65, 85],
        },
        columnStyles: {
          0: { cellWidth: 30, fontStyle: "bold", fillColor: [241, 245, 249], textColor: [71, 85, 105] },
          1: { cellWidth: hasMultiplePapers ? 80 : 60 },
          2: { cellWidth: 30, fontStyle: "bold", fillColor: [241, 245, 249], textColor: [71, 85, 105] },
          3: { cellWidth: "auto" },
        },
        margin: { left: 12, right: 12 },
      });

      const cursorY = doc.lastAutoTable.finalY + 6;

      const tableColumn = ["#", "Adm No", "Student", ...paperColumns.map((c) => c.label), "Overall %"];

      const tableRows = sortedStudents.map((s, i) => {
        const pct = s.percentage !== null ? `${s.percentage.toFixed(1)}%` : "-";
        const paperCells = paperColumns.map((col) => {
          const cell = s.perPaper.find((p) => p.key === col.key);
          return cell ? cell.value : "-";
        });
        return [i + 1, s.enrollment.admission_no, s.enrollment.student_name, ...paperCells, pct];
      });

      const colStyles = {
        0: { cellWidth: 10, halign: "center" },
        1: { cellWidth: hasMultiplePapers ? 40 : 42, halign: "left" },
        2: { cellWidth: hasMultiplePapers ? 72 : 76, halign: "left", overflow: "ellipsize" },
      };
      const perPaperWidth = hasMultiplePapers ? 22 : 26;
      paperColumns.forEach((_, idx) => {
        colStyles[3 + idx] = { cellWidth: perPaperWidth, halign: "center" };
      });
      colStyles[3 + paperColumns.length] = { cellWidth: 26, halign: "right" };

      autoTable(doc, {
        startY: cursorY,
        head: [tableColumn],
        body: tableRows,
        theme: "grid",
        styles: {
          fontSize: 9,
          cellPadding: 2.5,
          lineColor: [226, 232, 240],
          lineWidth: 0.1,
          textColor: [51, 65, 85],
          overflow: "ellipsize",
        },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 9,
          cellPadding: 2.5,
          halign: "left",
        },
        bodyStyles: {
          fontSize: 9,
          textColor: [51, 65, 85],
          cellPadding: 2.5,
          valign: "middle",
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: colStyles,
        margin: { left: 12, right: 12 },
        didParseCell: (data) => {
          if (data.section !== "body") return;
          const row = sortedStudents[data.row.index];
          if (!row) return;

          const overallColIdx = 3 + paperColumns.length;
          if (data.column.index === overallColIdx) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = [15, 23, 42];
          }
          const isPaperCol = data.column.index >= 3 && data.column.index < overallColIdx;
          if (isPaperCol && String(data.cell.raw).toLowerCase() === "abs") {
            data.cell.styles.textColor = [220, 38, 38];
            data.cell.styles.fontStyle = "bold";
          }
        },
        didDrawPage: () => {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(148, 163, 184);
          doc.text(
            `Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${doc.internal.getNumberOfPages()}`,
            pageWidth - 12,
            pageHeight - 6,
            { align: "right" }
          );
          doc.text("The Nyali School — Academics Office", 12, pageHeight - 6);
        },
      });

      let finalY = doc.lastAutoTable.finalY + 16;
      if (finalY > pageHeight - 30) {
        doc.addPage();
        finalY = 24;
      }

      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(0.2);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text("Class Teacher's Signature:", 12, finalY);
      doc.line(12, finalY + 10, 90, finalY + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text("Sign & Official Stamp", 12, finalY + 14);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text("Headteacher's Sign:", pageWidth - 90, finalY);
      doc.line(pageWidth - 90, finalY + 10, pageWidth - 12, finalY + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text("Sign & Official Stamp", pageWidth - 90, finalY + 14);

      const safeSubject = (allocation?.subject_name || "subject").replace(/\s+/g, "_");
      const safeClass = (allocation?.classroom_label || "class").replace(/\s+/g, "_");
      const safeExam = (examObj?.name || "exam").replace(/\s+/g, "_");
      doc.save(`Class_Report_${safeSubject}_${safeClass}_${safeExam}.pdf`);
    } catch (err) {
      console.error("Failed to generate class PDF:", err);
      setMessage("Could not generate the class PDF.");
      setMessageType("danger");
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="d-flex align-items-center gap-3">
         
          <div>
            <h1 className="page-title">Enter Marks</h1>
            <p className="page-subtitle mb-0">
              Pick one of your allocated classes, then choose from the exams already set up for that
              grade this academic year — key in the whole class at once.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div className={`alert alert-${messageType} alert-dismissible fade show`} role="alert">
          {message}
          <button type="button" className="btn-close" onClick={() => setMessage("")}></button>
        </div>
      )}

      {/* Selection Form */}
      <div className="table-wrap mb-4">
        <div className="table-wrap__header">
          <span className="chart-card__title mb-0">
            <i className="bi bi-pencil-square me-2 text-brand"></i>
            Select Class & Exam
          </span>
        </div>
        <div className="p-3">
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label">
                <i className="bi bi-door-open me-1 text-brand"></i>
                Class & Subject
              </label>
              <select
                className="form-select"
                value={selectedAllocation}
                onChange={(e) => setSelectedAllocation(e.target.value)}
              >
                <option value="">Select...</option>
                {allocations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.subject_name} — {a.classroom_label}
                  </option>
                ))}
              </select>
              {allocations.length === 0 && !loading && (
                <div className="form-text-hint">
                  <i className="bi bi-info-circle me-1"></i>
                  You have no allocated classes yet.
                </div>
              )}
            </div>
            <div className="col-md-4">
              <label className="form-label">
                <i className="bi bi-clipboard me-1 text-brand"></i>
                Exam
              </label>
              <select
                className="form-select"
                value={selectedExam}
                onChange={(e) => setSelectedExam(e.target.value)}
                disabled={!allocation || examsLoading}
              >
                <option value="">
                  {!allocation ? "Pick a class first..." : examsLoading ? "Loading exams..." : "Select..."}
                </option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} ({ex.exam_type_name}){!ex.is_published ? " — unpublished" : ""}
                  </option>
                ))}
              </select>
              {allocation && !examsLoading && exams.length === 0 && (
                <div className="form-text-hint">
                  <i className="bi bi-info-circle me-1"></i>
                  No exams set up yet for this grade this academic year.
                </div>
              )}
            </div>
            <div className="col-md-3">
              <label className="form-label">
                <i className="bi bi-123 me-1 text-brand"></i>
                Papers & Out Of
              </label>
              <button
                type="button"
                className="btn btn-outline-primary w-100"
                disabled={!allocation || !selectedExam}
                onClick={openSetup}
                title="Choose whether this exam had papers (PP1, PP2...) and what each is out of"
              >
                <i className="bi bi-sliders me-1"></i>
                {paperColumns.length === 1 && paperColumns[0].paper_number === 0
                  ? `Single mark (out of ${paperColumns[0].max_marks})`
                  : `${paperColumns.length} papers`}{" "}
                · Edit
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Paper setup panel */}
      {setupOpen && (
        <div className="table-wrap mb-4">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-sliders me-2 text-brand"></i>
              Paper setup — {allocation?.subject_name} ·{" "}
              {exams.find((e) => String(e.id) === String(selectedExam))?.name}
            </span>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={useSingleMark}>
                Single mark
              </button>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={usePapers}>
                Papers (PP1, PP2…)
              </button>
            </div>
          </div>
          <div className="p-3">
            {draftPapers.map((p, i) => (
              <div className="row g-2 align-items-end mb-2" key={i}>
                <div className="col-6 col-md-4">
                  <label className="form-label small">Name</label>
                  <input
                    className="form-control form-control-sm"
                    value={p.name}
                    onChange={(e) => updateDraft(i, "name", e.target.value)}
                  />
                </div>
                <div className="col-4 col-md-2">
                  <label className="form-label small">Out of</label>
                  <input
                    type="number"
                    min="1"
                    className="form-control form-control-sm"
                    value={p.max_marks}
                    onChange={(e) => updateDraft(i, "max_marks", e.target.value)}
                  />
                </div>
                {p.paper_number !== 0 && draftPapers.length > 1 && (
                  <div className="col-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => removeDraft(i)}
                    >
                      <i className="bi bi-trash"></i>
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div className="d-flex gap-2 mt-3">
              {draftPapers[0]?.paper_number !== 0 && (
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={addDraftPaper}>
                  <i className="bi bi-plus-lg me-1"></i>Add Paper
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-success"
                onClick={saveSetup}
                disabled={savingSetup}
              >
                {savingSetup ? "Saving..." : "Save setup"}
              </button>
              <button type="button" className="btn btn-sm btn-light" onClick={() => setSetupOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark Entry Table */}
      {selectedAllocation && selectedExam && (
        <>
          {loading ? (
            <div className="table-wrap">
              <div className="table-wrap__header">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-person-lines-fill me-2 text-brand"></i>
                  Students
                </span>
                <span className="skeleton skeleton-text" style={{ width: 100 }}></span>
              </div>
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead>
                    <tr>
                      <th><div className="skeleton skeleton-text" style={{ width: 80 }}></div></th>
                      <th><div className="skeleton skeleton-text" style={{ width: 120 }}></div></th>
                      <th><div className="skeleton skeleton-text" style={{ width: 100 }}></div></th>
                      <th><div className="skeleton skeleton-text" style={{ width: 80 }}></div></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <tr key={i}>
                        <td><div className="skeleton skeleton-text" style={{ width: 60 }}></div></td>
                        <td><div className="skeleton skeleton-text" style={{ width: 100 }}></div></td>
                        <td><div className="skeleton skeleton-text" style={{ width: 80 }}></div></td>
                        <td><div className="skeleton skeleton-text" style={{ width: 40 }}></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : enrollments.length === 0 ? (
            <div className="table-wrap">
              <div className="empty-state">
                <i className="bi bi-person-x"></i>
                <h6>No students found</h6>
                <p className="text-muted-soft">
                  This class has no active students enrolled.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="table-wrap">
                <div className="table-wrap__header">
                  <span className="chart-card__title mb-0">
                    <i className="bi bi-person-lines-fill me-2 text-brand"></i>
                    Students
                    <span className="badge badge-neutral ms-2">{totalStudents}</span>
                  </span>
                  <div className="d-flex align-items-center gap-3 flex-wrap">
                    <span className="chart-card__subtitle mb-0">
                      {marksLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                          Loading saved marks...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-check-circle me-1 text-ok"></i>
                          {getMarksCount()} of {totalCells} entered
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-success"
                      onClick={handleDownloadClassPdf}
                      disabled={downloadingPdf || sortedStudents.length === 0}
                      title="Download a ranked class performance PDF"
                    >
                      {downloadingPdf ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                          Preparing...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-file-earmark-pdf me-1"></i>
                          Download Report (PDF)
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: "120px" }}>Admission No</th>
                        <th>Student</th>
                        {paperColumns.map((col) => (
                          <th key={col.key} style={{ minWidth: "170px" }}>
                            {col.label} (out of {col.max_marks})
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enrollments.map((en) => (
                        <tr key={en.id}>
                          <td>
                            <span className="cell-mono text-brand fw-semibold">
                              {en.admission_no}
                            </span>
                          </td>
                          <td>
                            <div className="table-avatar-cell">
                              <div className="avatar-sm">
                                {en.student_name?.split(' ').map(n => n[0]).join('') || 'S'}
                              </div>
                              <span className="cell-name">{en.student_name}</span>
                            </div>
                          </td>
                          {paperColumns.map((col) => {
                            const cell = marks[en.id]?.[col.key] || { marks_obtained: "", is_absent: false };
                            return (
                              <td key={col.key}>
                                <div className="d-flex align-items-center gap-2">
                                  <input
                                    type="number"
                                    className="form-control form-control-sm"
                                    min="0"
                                    max={col.max_marks}
                                    disabled={cell.is_absent}
                                    value={cell.marks_obtained}
                                    onChange={(e) => updateMark(en.id, col.key, "marks_obtained", e.target.value)}
                                    style={{ maxWidth: "90px" }}
                                    placeholder={`0-${col.max_marks}`}
                                  />
                                  <div className="form-check d-flex align-items-center gap-1" style={{ paddingLeft: 0 }}>
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      id={`absent-${en.id}-${col.key}`}
                                      checked={cell.is_absent}
                                      onChange={(e) => updateMark(en.id, col.key, "is_absent", e.target.checked)}
                                      style={{ marginLeft: 0 }}
                                    />
                                    <label className="form-check-label small" htmlFor={`absent-${en.id}-${col.key}`}>
                                      Abs
                                    </label>
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-3 d-flex gap-2 align-items-center">
                <button
                  className="btn btn-success"
                  type="submit"
                  disabled={!selectedExam || saving || loading}
                >
                  {saving ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Saving...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-check2 me-2"></i>
                      Save Marks
                    </>
                  )}
                </button>
                {getMarksCount() > 0 && (
                  <span className="badge badge-success d-flex align-items-center">
                    <i className="bi bi-check-circle me-1"></i>
                    {getMarksCount()} marks ready to save
                  </span>
                )}
              </div>
            </form>
          )}
        </>
      )}

      {/* Helpful Info */}
      {selectedAllocation && selectedExam && enrollments.length > 0 && (
        <div className="note-card mt-3 mb-0">
          <i className="bi bi-info-circle"></i>
          <div className="d-flex flex-wrap gap-3 small">
            <span>
              <strong>{allocation?.subject_name}</strong> — {allocation?.classroom_label}
            </span>
            <span>
              <strong>{exams.find(e => String(e.id) === selectedExam)?.name}</strong>
            </span>
            <span>
              Papers: <strong>{paperColumns.length}</strong>
            </span>
            <span>
              Students: <strong>{totalStudents}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}