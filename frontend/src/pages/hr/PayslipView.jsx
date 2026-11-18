import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import Modal from "../../components/Modal";
import logoImage from "../../assets/nyali_school_logo.png";

// ---------------------------------------------------------------------------
// Shared helpers (same wording/look as the report card + roster PDFs)
// ---------------------------------------------------------------------------
const SCHOOL_NAME = "The Nyali School";
const SCHOOL_ADDRESS = "P.O BOX 87073-80100, MOMBASA   |   Email: info@nyalischool.com";
const SCHOOL_MOTTO = "STRIVE TO EXCELL";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Accepts "March 2026" (what the API sends), "2026-03" or "2026-03-01".
export const parsePeriod = (period) => {
  if (!period) return null;
  const s = String(period).trim();
  let m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { year: Number(m[1]), month };
  }
  m = /^([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (m) {
    const idx = MONTHS.findIndex((n) => n.toLowerCase() === m[1].toLowerCase());
    if (idx >= 0) return { year: Number(m[2]), month: idx + 1 };
  }
  return null;
};

export const prettyPeriod = (period) => {
  if (!period) return "—";
  const p = parsePeriod(period);
  return p ? `${MONTHS[p.month - 1]} ${p.year}` : String(period);
};

// "2026-03" - sortable, empty string when unparseable
export const periodSortKey = (period) => {
  const p = parsePeriod(period);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : "";
};

const fmtMoney = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const KES = (amount) =>
  `KES ${Number(amount || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const prettyLabel = (key) =>
  String(key)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Splits a slip into the lines shown on screen and in the PDF.
const slipLines = (slip) => {
  const b = slip.breakdown || {};
  const earnings = Object.entries(b.earnings || {}).map(([k, v]) => ({
    name: prettyLabel(k),
    amount: Number(v) || 0,
  }));
  const deductions = [
    { name: "PAYE", amount: Number(slip.paye) || 0 },
    { name: "NSSF", amount: Number(slip.nssf) || 0 },
    { name: "SHIF", amount: Number(slip.shif) || 0 },
    { name: "Housing Levy", amount: Number(slip.housing_levy) || 0 },
    ...(b.deductions || []).map((d) => ({ name: d.name || "Other", amount: Number(d.amount) || 0 })),
  ];
  const totalDeductions =
    slip.total_deductions !== undefined
      ? Number(slip.total_deductions)
      : deductions.reduce((sum, d) => sum + d.amount, 0);
  return { earnings, deductions, totalDeductions, taxable: b.taxable_pay };
};

// Logo as base64 so it can be embedded in the PDF
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

// ---------------------------------------------------------------------------
// PAYSLIP PDF - one A4 page, same look as the report card
// ---------------------------------------------------------------------------
const buildPayslipDoc = async (slip) => {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const M = 12;
  const cw = pageWidth - M * 2;
  const navy = [31, 56, 100];
  const grey = [242, 242, 242];
  const border = [166, 166, 166];
  const black = [0, 0, 0];

  const logo = await getImageBase64(logoImage);
  const { earnings, deductions, totalDeductions, taxable } = slipLines(slip);
  const period = prettyPeriod(slip.period);
  const gross = Number(slip.gross) || 0;

  // ---- Header ----
  placeLogo(doc, logo, M, 9, 21, 34);

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

  doc.setDrawColor(...navy);
  doc.setLineWidth(0.6);
  doc.line(M, 34, pageWidth - M, 34);

  // ---- Title ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...navy);
  doc.text(`EMPLOYEE PAYSLIP - ${period.toUpperCase()}`, pageWidth / 2, 41, { align: "center" });

  // bordered cell with auto-shrinking text
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

  // ---- Employee / period info ----
  let y = 46;
  const rowH = 7.5;
  const labelW = 36;
  const valW = (cw - labelW * 2) / 2;
  drawCell(M, y, labelW, rowH, "Employee Name", { bold: true, fill: true });
  drawCell(M + labelW, y, valW, rowH, slip.employee_name || "-");
  drawCell(M + labelW + valW, y, labelW, rowH, "Employee No.", { bold: true, fill: true });
  drawCell(M + labelW * 2 + valW, y, valW, rowH, slip.employee_no || "-");
  y += rowH;
  drawCell(M, y, labelW, rowH, "Pay Period", { bold: true, fill: true });
  drawCell(M + labelW, y, valW, rowH, period);
  drawCell(M + labelW + valW, y, labelW, rowH, "Taxable Pay", { bold: true, fill: true });
  drawCell(M + labelW * 2 + valW, y, valW, rowH, taxable != null ? KES(taxable) : "-");
  y += rowH + 8;

  // ---- Earnings + deductions tables ----
  const tableBase = {
    theme: "grid",
    margin: { left: M, right: M },
    styles: {
      font: "helvetica",
      fontSize: 9,
      textColor: black,
      lineColor: [191, 191, 191],
      lineWidth: 0.2,
      cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
      valign: "middle",
    },
    headStyles: {
      fillColor: navy,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
      lineColor: navy,
    },
    alternateRowStyles: { fillColor: grey },
    columnStyles: { 0: { cellWidth: cw - 50 }, 1: { cellWidth: 50, halign: "right" } },
  };

  const totalRowStyle = (lastIndex, color) => (d) => {
    if (d.section === "body" && d.row.index === lastIndex) {
      d.cell.styles.fontStyle = "bold";
      d.cell.styles.fillColor = [225, 232, 245];
      if (d.column.index === 1) d.cell.styles.textColor = color;
    }
    if (d.section === "head" && d.column.index === 1) d.cell.styles.halign = "right";
  };

  const earningsBody = earnings.length
    ? earnings.map((e) => [e.name, KES(e.amount)])
    : [["No itemised earnings", "-"]];
  earningsBody.push(["Gross Pay", KES(gross)]);

  autoTable(doc, {
    ...tableBase,
    startY: y,
    head: [["Earnings", "Amount"]],
    body: earningsBody,
    didParseCell: totalRowStyle(earningsBody.length - 1, [20, 110, 60]),
  });

  y = doc.lastAutoTable.finalY + 8;

  const deductionsBody = deductions.map((d) => [d.name, KES(d.amount)]);
  deductionsBody.push(["Total Deductions", KES(totalDeductions)]);

  autoTable(doc, {
    ...tableBase,
    startY: y,
    head: [["Deductions", "Amount"]],
    body: deductionsBody,
    didParseCell: totalRowStyle(deductionsBody.length - 1, [170, 30, 30]),
  });

  y = doc.lastAutoTable.finalY + 8;

  // ---- Net pay banner ----
  const netH = 16;
  doc.setFillColor(...navy);
  doc.rect(M, y, cw, netH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("NET PAY", M + 5, y + 6.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(`Gross ${KES(gross)}  -  Deductions ${KES(totalDeductions)}`, M + 5, y + 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(KES(slip.net), pageWidth - M - 5, y + netH / 2, { align: "right", baseline: "middle" });

  // ================================================================
  // BOTTOM BLOCK: [HR / Accounts] [Official Stamp] [Employee]
  // ================================================================
  const footerLineY = pageHeight - 14;
  const blockH = 26;
  const blockTop = footerLineY - 4 - blockH;

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

  const drawSignature = (x1, x2, label) => {
    doc.setDrawColor(...black);
    doc.setLineWidth(0.25);
    doc.line(x1, blockTop + 15, x2, blockTop + 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...black);
    doc.text(label, x1, blockTop + 19.5);
    doc.setFont("helvetica", "normal");
    doc.text("Date: ____________________", x1, blockTop + 25);
  };
  drawSignature(M, leftEnd, "HR / Accounts Officer");
  drawSignature(rightStart, pageWidth - M, "Employee's Signature");

  // ---- Footer (same as report card) ----
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
  doc.text(" Powered by Masomo Portal (www.masomoportal.com).", pageWidth - M, footerLineY + 4, {
    align: "right",
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  doc.text(
    "This payslip is computer-generated and confidential. It is the property of The Nyali School. Duplication or unauthorized printing is prohibited.",
    M,
    footerLineY + 7.5
  );

  return doc;
};

const pdfFilename = (slip) =>
  `${slip.employee_no || "employee"}_payslip_${prettyPeriod(slip.period)}.pdf`.replace(/\s+/g, "_");

export const downloadPayslipPdf = async (slip) => {
  const doc = await buildPayslipDoc(slip);
  doc.save(pdfFilename(slip));
};

// Opens the print dialog for the very same PDF (falls back to a download)
export const printPayslipPdf = async (slip) => {
  const doc = await buildPayslipDoc(slip);
  try {
    const url = doc.output("bloburl");
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    frame.src = url;
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        doc.save(pdfFilename(slip));
      }
      setTimeout(() => {
        document.body.removeChild(frame);
        URL.revokeObjectURL(url);
      }, 60000);
    };
    document.body.appendChild(frame);
  } catch {
    doc.save(pdfFilename(slip));
  }
};

// ---------------------------------------------------------------------------
// On-screen payslip modal
// ---------------------------------------------------------------------------
export default function PayslipView({ slip, onClose }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  if (!slip) return null;

  const { earnings, deductions, totalDeductions } = slipLines(slip);

  const run = async (kind, fn) => {
    setBusy(kind);
    setErr("");
    try {
      await fn(slip);
    } catch (e) {
      console.error("Payslip PDF failed:", e);
      setErr("Could not generate the payslip PDF. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const spinner = <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>;

  return (
    <Modal
      show={!!slip}
      onClose={onClose || (() => {})}
      title={`Payslip — ${prettyPeriod(slip.period)}`}
      size="lg"
    >
      <div className="payslip" id="payslip-printable">
        <div
          className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3 pb-3"
          style={{ borderBottom: "2px solid var(--blue-700)" }}
        >
          <div className="d-flex align-items-center gap-3">
            <img
              src={logoImage}
              alt="The Nyali School"
              style={{ width: 76, height: 52, objectFit: "contain", flexShrink: 0 }}
            />
            <div>
              <div className="section-label">Employee</div>
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--fs-md)",
                  fontWeight: 700,
                  color: "var(--ink-900)",
                }}
              >
                {slip.employee_name || "—"}
              </div>
              {slip.employee_no && (
                <div style={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)", marginTop: "2px" }}>
                  <i className="bi bi-person-vcard me-1"></i>
                  {slip.employee_no}
                </div>
              )}
            </div>
          </div>

          <div className="text-end">
            <div className="section-label">Pay Period</div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--fs-md)",
                fontWeight: 700,
                color: "var(--blue-800)",
              }}
            >
              {prettyPeriod(slip.period)}
            </div>
            {slip.date_paid && (
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)", marginTop: "2px" }}>
                Paid on {slip.date_paid}
              </div>
            )}
          </div>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-md-6">
            <div
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                height: "100%",
              }}
            >
              <div
                style={{
                  background: "var(--success-100)",
                  color: "var(--success-600)",
                  padding: "0.5rem 0.75rem",
                  fontWeight: 700,
                  fontSize: "var(--fs-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <i className="bi bi-plus-circle"></i>
                Earnings
              </div>
              <table className="table mb-0" style={{ fontSize: "var(--fs-xs)" }}>
                <tbody>
                  {earnings.map((e) => (
                    <tr key={e.name}>
                      <td style={{ padding: "0.45rem 0.75rem" }}>{e.name}</td>
                      <td className="text-end" style={{ padding: "0.45rem 0.75rem" }}>
                        {fmtMoney(e.amount)}
                      </td>
                    </tr>
                  ))}
                  {earnings.length === 0 && (
                    <tr>
                      <td colSpan={2} className="text-muted-soft" style={{ padding: "0.6rem 0.75rem" }}>
                        No itemised earnings
                      </td>
                    </tr>
                  )}
                  <tr style={{ background: "var(--bg-app)", borderTop: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "0.55rem 0.75rem", fontWeight: 700, color: "var(--ink-900)" }}>
                      Gross Pay
                    </td>
                    <td
                      className="text-end"
                      style={{ padding: "0.55rem 0.75rem", fontWeight: 700, color: "var(--success-600)" }}
                    >
                      {fmtMoney(slip.gross)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="col-md-6">
            <div
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                height: "100%",
              }}
            >
              <div
                style={{
                  background: "var(--danger-100)",
                  color: "var(--danger-600)",
                  padding: "0.5rem 0.75rem",
                  fontWeight: 700,
                  fontSize: "var(--fs-xs)",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <i className="bi bi-dash-circle"></i>
                Deductions
              </div>
              <table className="table mb-0" style={{ fontSize: "var(--fs-xs)" }}>
                <tbody>
                  {deductions.map((d, i) => (
                    <tr key={`${d.name}-${i}`}>
                      <td style={{ padding: "0.45rem 0.75rem" }}>{d.name}</td>
                      <td className="text-end" style={{ padding: "0.45rem 0.75rem" }}>
                        {fmtMoney(d.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--bg-app)", borderTop: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "0.55rem 0.75rem", fontWeight: 700, color: "var(--ink-900)" }}>
                      Total Deductions
                    </td>
                    <td
                      className="text-end"
                      style={{ padding: "0.55rem 0.75rem", fontWeight: 700, color: "var(--danger-600)" }}
                    >
                      {fmtMoney(totalDeductions)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div
          style={{
            background: "var(--blue-50)",
            border: "1px solid var(--blue-200)",
            borderRadius: "var(--radius-md)",
            padding: "0.85rem 1rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--blue-800)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 600,
              }}
            >
              Net Pay
            </div>
            <div style={{ fontSize: "var(--fs-xs)", color: "var(--ink-600)", marginTop: "2px" }}>
              Gross {fmtMoney(slip.gross)} − Deductions {fmtMoney(totalDeductions)}
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--fs-2xl)",
              fontWeight: 700,
              color: "var(--blue-800)",
              lineHeight: 1.1,
            }}
          >
            {fmtMoney(slip.net)}
          </div>
        </div>

        {err && (
          <div className="alert alert-danger py-2 px-3 mb-3" style={{ fontSize: "var(--fs-xs)" }}>
            {err}
          </div>
        )}

        <p
          className="text-muted-soft"
          style={{ fontSize: "var(--fs-xs)", textAlign: "center", marginBottom: "1rem" }}
        >
          This payslip is generated by the school&apos;s payroll system and is for informational
          purposes only.
        </p>

        <div className="d-flex flex-wrap justify-content-end gap-2">
          <button
            className="btn btn-outline-success"
            onClick={() => run("download", downloadPayslipPdf)}
            disabled={!!busy}
          >
            {busy === "download" ? spinner : <i className="bi bi-file-earmark-pdf me-1"></i>}
            {busy === "download" ? "Preparing..." : "Download PDF"}
          </button>
          <button
            className="btn btn-outline-primary"
            onClick={() => run("print", printPayslipPdf)}
            disabled={!!busy}
          >
            {busy === "print" ? spinner : <i className="bi bi-printer me-1"></i>}
            {busy === "print" ? "Preparing..." : "Print"}
          </button>
          {onClose && (
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}