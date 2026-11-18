// src/components/TimetableGrid.jsx
// Read-only weekly timetable shared by the teacher and student pages.
// Layout matches the admin Timetable page: DAY rows x TIME columns.
//   mode="teacher": cell = time, class (e.g. "Grade 5 Red"), subject
//   mode="student": cell = time, subject, teacher (e.g. "A. Omondi")
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoImage from "../assets/nyali_school_logo.png";

export const TYPE_STYLE = {
  LESSON:   { bg: "#eaf2ff", border: "#b6d4fe", text: "#0b5ed7" },
  BREAK:    { bg: "#fff8e1", border: "#ffe08a", text: "#8a6d00" },
  LUNCH:    { bg: "#e8f8ee", border: "#a3e4bb", text: "#1a7d3f" },
  ASSEMBLY: { bg: "#f1f1f4", border: "#d8d8de", text: "#55555f" },
  GAMES:    { bg: "#f3ecff", border: "#d9c4fb", text: "#6f36c9" },
  PREP:     { bg: "#eef1ff", border: "#c8d0ff", text: "#39449e" },
};

const JS_DAY_TO_KEY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// Same school details as the report card / roster / payslip PDFs
const SCHOOL_NAME = "The Nyali School";
const SCHOOL_ADDRESS = "P.O BOX 87073-80100, MOMBASA   |   Email: info@nyalischool.com";
const SCHOOL_MOTTO = "STRIVE TO EXCELL";

// "Alex Juma Omondi" -> "A. J. Omondi"
export const shortTeacherName = (fullName) => {
  if (!fullName) return "—";
  const trimmed = String(fullName).trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return "—";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const surname = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map((p) => `${p[0].toUpperCase()}.`).join(" ");
  return `${initials} ${surname}`;
};

const getImageBase64 = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
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

// ---- shared helpers -------------------------------------------------------
// Teacher view: a combined class (same teacher + subject + grade, several
// streams in one slot) is shown as ONE lesson, e.g. "Grade 5 Blue/Red",
// and the "(2026)" year suffix is dropped from the class label.
function mergeLessons(lessons) {
  if (!lessons?.length || lessons[0].classroom === undefined) return lessons || [];
  const stripYear = (s) => String(s).replace(/\s*\(\d{4}\)\s*$/, "").trim();
  const groups = new Map();
  lessons.forEach((l) => {
    const grade = l.grade_level || stripYear(l.classroom);
    const key = `${l.subject}|${grade}`;
    const stream = stripYear(l.classroom).replace(grade, "").trim();
    if (!groups.has(key)) groups.set(key, { ...l, _grade: grade, _streams: [] });
    if (stream) groups.get(key)._streams.push(stream);
  });
  return Array.from(groups.values()).map((g) => ({
    ...g,
    classroom: g._streams.length ? `${g._grade} ${[...new Set(g._streams)].sort().join("/")}` : g._grade,
  }));
}

function buildColumns(days) {
  const lookup = {};
  const timeByOrder = {};
  days.forEach((d) =>
    d.periods.forEach((raw) => {
      const p = { ...raw, lessons: mergeLessons(raw.lessons) };
      lookup[`${d.day}:${p.order}`] = p;
      if (!timeByOrder[p.order]) {
        timeByOrder[p.order] = { start_time: p.start_time, end_time: p.end_time };
      }
    })
  );
  const orders = Object.keys(timeByOrder).map(Number).sort((a, b) => a - b);
  return { lookup, timeByOrder, orders };
}

// Long subject names (e.g. "Christian Religious Education") only show their
// first N characters so they fit the cell. Change N here.
const SUBJECT_MAX_CHARS = 5;
export const shortSubject = (name) => {
  const s = String(name || "").trim();
  return s.length > SUBJECT_MAX_CHARS ? s.slice(0, SUBJECT_MAX_CHARS) : s;
};

const lessonLines = (lesson, mode) =>
  mode === "teacher"
    ? [lesson.classroom, shortSubject(lesson.subject)]
    : [shortSubject(lesson.subject), shortTeacherName(lesson.teacher_name)];

// ---- on-screen grid (unchanged) -------------------------------------------
export default function TimetableGrid({ days, mode }) {
  if (!days?.length) {
    return (
      <div className="empty-state">
        <i className="bi bi-grid-3x3"></i>
        <h6>The timetable structure has not been set up yet</h6>
      </div>
    );
  }

  const todayKey = JS_DAY_TO_KEY[new Date().getDay()];
  const { lookup, timeByOrder, orders } = buildColumns(days);

  return (
    <div className="table-wrap">
      <div className="table-responsive">
        <table className="table table-bordered mb-0" style={{ tableLayout: "fixed", minWidth: orders.length * 96 + 90 }}>
          <thead>
            <tr>
              <th style={{ width: "90px" }}>Day</th>
              {orders.map((o) => (
                <th key={o} className="text-center" style={{ minWidth: "96px", fontSize: "10px" }}>
                  {timeByOrder[o].start_time}
                  <br />
                  <span className="text-muted-soft">{timeByOrder[o].end_time}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const isToday = d.day === todayKey;
              return (
                <tr key={d.day}>
                  <td
                    className="fw-semibold align-middle"
                    style={isToday ? { background: "#e7f1ff", color: "#0b5ed7" } : undefined}
                  >
                    {d.day_label}
                    {isToday && <div style={{ fontSize: "10px", fontWeight: 600 }}>TODAY</div>}
                  </td>

                  {orders.map((o) => {
                    const cell = lookup[`${d.day}:${o}`];
                    const time = cell ? `${cell.start_time} - ${cell.end_time}` : "";

                    if (!cell) {
                      return <td key={o} className="text-center align-middle bg-brand-50"></td>;
                    }

                    // breaks, lunch, games, prep, assembly
                    if (cell.slot_type !== "LESSON") {
                      const s = TYPE_STYLE[cell.slot_type] || TYPE_STYLE.BREAK;
                      return (
                        <td key={o} className="text-center align-middle" style={{ background: s.bg, borderColor: s.border }}>
                          <div style={{ fontWeight: 600, fontSize: "var(--fs-xs)", color: s.text }}>{cell.label}</div>
                          <div style={{ fontSize: "10px", color: s.text, opacity: 0.75 }}>{time}</div>
                        </td>
                      );
                    }

                    // lesson slot, nothing placed
                    if (!cell.lessons.length) {
                      return (
                        <td key={o} className="text-center align-middle text-muted-soft" style={{ fontSize: "var(--fs-xs)" }}>
                          {mode === "teacher" ? "Free" : "—"}
                        </td>
                      );
                    }

                    // lesson(s) placed (several only for a combined class)
                    const s = TYPE_STYLE.LESSON;
                    return (
                      <td key={o} className="align-middle" style={{ background: isToday ? "#f5faff" : undefined }}>
                        {cell.lessons.map((l, i) => {
                          const [line1, line2] = lessonLines(l, mode);
                          return (
                            <div
                              key={i}
                              title={`${l.subject}${mode === "teacher" ? ` - ${l.classroom}` : ` - ${l.teacher_name || ""}`}`}
                              style={{
                                background: s.bg,
                                borderRadius: "4px",
                                padding: "2px 4px",
                                marginTop: i ? "2px" : 0,
                                lineHeight: 1.2,
                              }}
                            >
                              <div style={{ fontSize: "8px", fontWeight: 700, color: s.text }}>
                                {time}
                                {l.is_double ? " · dbl" : ""}
                              </div>
                              <div style={{ fontWeight: 600, fontSize: "9px" }}>{line1}</div>
                              <div className="text-muted-soft" style={{ fontSize: "8px" }}>{line2}</div>
                            </div>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- landscape A4 PDF -----------------------------------------------------
// Same header/footer as the report card, roster, payslip and ranking PDFs.
// The grid is compact and spreadsheet-like, and free periods are blank cells.
// meta: array of strings shown in the strip under the title
export async function downloadTimetablePdf({ days, mode, title, meta = [], filename, signatures = true }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const M = 12;
  const cw = pageWidth - M * 2;
  const navy = [31, 56, 100];
  const black = [0, 0, 0];
  const footerLineY = pageHeight - 14;

  const base64Logo = await getImageBase64(logoImage);
  const generatedOn = new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" });

  // ---- Header: logo (left), school details (centre), date (right) ----
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
  doc.text(`Generated ${generatedOn}`, pageWidth - M, 12, { align: "right" });

  doc.setDrawColor(...navy);
  doc.setLineWidth(0.6);
  doc.line(M, 34, pageWidth - M, 34);

  // ---- Title + meta strip ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...navy);
  doc.text(String(title).toUpperCase(), pageWidth / 2, 41, { align: "center" });

  let tableStartY = 46;
  if (meta.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...black);
    doc.text(meta.join("   |   "), pageWidth / 2, 47, { align: "center" });
    tableStartY = 51;
  }

  // ---- Compact, spreadsheet-like grid ----
  const { lookup, timeByOrder, orders } = buildColumns(days);
  const head = ["Day", ...orders.map((o) => `${timeByOrder[o].start_time}\n${timeByOrder[o].end_time}`)];

  const body = days.map((d) => [
    d.day_label,
    ...orders.map((o) => {
      const cell = lookup[`${d.day}:${o}`];
      if (!cell) return "";
      if (cell.slot_type !== "LESSON") return cell.label;
      if (!cell.lessons.length) return ""; // free period: blank cell
      return cell.lessons.map((l) => lessonLines(l, mode).join("\n")).join("\n");
    }),
  ]);

  const dayColW = 20;
  const colW = (cw - dayColW) / Math.max(orders.length, 1);
  const fontSize = orders.length > 12 ? 6 : orders.length > 9 ? 6.5 : 7;

  const columnStyles = { 0: { cellWidth: dayColW, halign: "left", fontStyle: "bold" } };
  orders.forEach((_, i) => {
    columnStyles[i + 1] = { cellWidth: colW };
  });

  autoTable(doc, {
    startY: tableStartY,
    head: [head],
    body,
    theme: "grid",
    tableWidth: cw,
    styles: {
      font: "helvetica",
      fontSize,
      cellPadding: 0.8,
      lineColor: [166, 166, 166],
      lineWidth: 0.15,
      textColor: black,
      valign: "middle",
      halign: "center",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: navy,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: fontSize,
      cellPadding: 1,
      halign: "center",
      lineColor: navy,
    },
    bodyStyles: { minCellHeight: 9 },
    columnStyles,
    margin: { left: M, right: M, bottom: 22 },
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index === 0) return;
      const day = days[data.row.index];
      const cell = day && lookup[`${day.day}:${orders[data.column.index - 1]}`];
      if (!cell) return;
      if (cell.slot_type !== "LESSON") {
        // break / lunch / games / prep / assembly
        data.cell.styles.fillColor = [242, 242, 242];
        data.cell.styles.textColor = [100, 100, 100];
        data.cell.styles.fontStyle = "italic";
      } else if (cell.lessons.length) {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // ---- Signature block (optional) ----
  if (signatures) {
    let y = doc.lastAutoTable.finalY + 14;
    if (y > pageHeight - 36) { doc.addPage(); y = 24; }
    doc.setDrawColor(...black);
    doc.setLineWidth(0.25);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...black);
    doc.text("Headteacher's Sign:", pageWidth - 90, y);
    doc.line(pageWidth - 90, y + 10, pageWidth - M, y + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text("Sign & Official Stamp", pageWidth - 90, y + 14);
  }

  // ---- Footer on every page (same as the report card) ----
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
    doc.text(" Powered by Masomo Portal (www.masomoportal.com).", pageWidth - M, footerLineY + 4, {
      align: "right",
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    doc.text(
      "This document is the property of The Nyali School. Duplication or unauthorized printing is prohibited.",
      M,
      footerLineY + 7.5
    );
  }

  doc.save(filename);
}