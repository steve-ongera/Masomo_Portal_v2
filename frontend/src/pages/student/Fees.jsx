import { useEffect, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { financeApi, paymentsApi } from "../../services/api";
import ReceiptCard from "../../components/Receiptcard";
import TableSkeleton from "../../components/TableSkeleton";
import logoImage from "../../assets/nyali_school_logo.png";

// Printed on receipts and the fee statement
const SCHOOL_NAME = "The Nyali School";
const SCHOOL_ADDRESS = "P.O BOX 87073-80100, MOMBASA   |   Email: info@nyalischool.com";
const SCHOOL_MOTTO = "STRIVE TO EXCELL";
const DOC_COPY_NOTE = "This is a computer-generated document copy.";

const SCHOOL_PAYBILL_NUMBER = "XXXXXX"; // TODO: school's Paybill number
const SCHOOL_TILL_NUMBER = "XXXXXX"; // TODO: school's Till number, if used
const FEES_FORWARD_PHONE = "0757790687";

const currency = (v) => Number(v || 0).toLocaleString();

const METHOD_LABEL = {
  MPESA: "M-Pesa",
  BANK: "Bank",
  CASH: "Cash",
  CHEQUE: "Cheque",
};

// "Term 1 - 2026" -> sortable number (20261). null if the label isn't in that shape.
const termOrder = (inv) => {
  const m = /Term\s+(\d+)\s*-\s*(\d{4})/i.exec(inv.term_label || "");
  return m ? Number(m[2]) * 10 + Number(m[1]) : null;
};

// Brought-forward wording: positive = arrears, negative = credit from earlier terms
const bfText = (v) => (Number(v) < 0 ? `KES ${currency(Math.abs(Number(v)))} credit` : `KES ${currency(v)}`);

// Load an image URL as base64 (used for embedding the logo into print docs)
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

export default function StudentFees() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feeStatus, setFeeStatus] = useState(null);

  // receipt viewer state
  const [receipt, setReceipt] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);

  // fee statement download state
  const [downloadingStatement, setDownloadingStatement] = useState(false);

  // Returns the fresh list so callers can use it straight away
  const loadInvoices = async () => {
    setLoading(true);
    try {
      const { data } = await financeApi.invoices({ page_size: 200 });
      const list = (data.results ?? data).sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at));
      setInvoices(list);
      return list;
    } catch (error) {
      console.error("Failed to load invoices:", error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
    financeApi.status().then(({ data }) => setFeeStatus(data)).catch(() => {});
  }, []);

  // ---- Balance calculation --------------------------------------------
  // Same ledger as the backend (services.get_ledger_totals_bulk):
  //   balance = opening + sum(term charges) - sum(paid)
  // opening = brought_forward of the EARLIEST invoice (arrears/credit from
  // before the system had any invoice for this student). Later invoices'
  // brought_forward is just the previous balance rolled forward, so it must
  // NOT be added again. term_charge (amount_due - brought_forward) is each
  // invoice's own fee, so summing it never double-counts.

  // Oldest -> newest
  const chronological = [...invoices].sort((a, b) => {
    const ka = termOrder(a);
    const kb = termOrder(b);
    if (ka !== null && kb !== null && ka !== kb) return ka - kb;
    return new Date(a.issued_at) - new Date(b.issued_at);
  });
  const firstInvoice = chronological[0] || null;
  const latestInvoice = chronological[chronological.length - 1] || null;

  const openingBalance = firstInvoice ? Number(firstInvoice.brought_forward) : 0;
  const termChargesTotal = invoices.reduce((s, i) => s + Number(i.term_charge), 0);
  const totalDue = openingBalance + termChargesTotal; // "Total Fees Charged"
  const totalPaid = invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
  const netBalance = totalDue - totalPaid;
  const prepaidAmount = netBalance < 0 ? Math.abs(netBalance) : 0;

  const viewReceipt = async (paymentId) => {
    setReceiptLoading(true);
    setShowReceiptModal(true);
    try {
      const { data } = await paymentsApi.receipt(paymentId);
      setReceipt(data);
    } catch (error) {
      console.error("Failed to load receipt:", error);
    } finally {
      setReceiptLoading(false);
    }
  };

  const closeReceiptModal = () => {
    setShowReceiptModal(false);
    setReceipt(null);
    setReceiptLoading(false);
  };

  // Get all payments from invoices
  const allPayments = invoices.flatMap((inv) =>
    (inv.payments || []).map((p) => ({ ...p, term_label: inv.term_label }))
  );

  // ---- Download the full fee statement (PDF) ----
  const handleDownloadStatement = async () => {
    if (!invoices.length) return;
    try {
      setDownloadingStatement(true);

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const M = 12;
      const cw = pageWidth - M * 2;
      const navy = [31, 56, 100];
      const grey = [242, 242, 242];
      const border = [166, 166, 166];
      const black = [0, 0, 0];
      const RED = [185, 28, 28];
      const GREEN = [21, 128, 61];
      const footerLineY = pageHeight - 14;

      const base64Logo = await getImageBase64(logoImage);
      const today = new Date();
      const generatedOn = today.toLocaleDateString("en-KE", {
        year: "numeric", month: "long", day: "numeric",
      });

      const studentName = invoices[0]?.student_name || "-";
      const admissionNo = invoices[0]?.admission_no || "-";
      const firstTerm = chronological[0]?.term_label || "-";
      const lastTerm = latestInvoice?.term_label || "-";

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

      // ---- Title ----
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...navy);
      doc.text("STUDENT FEE STATEMENT", pageWidth / 2, 41, { align: "center" });

      // Shared table look
      const gridStyles = {
        font: "helvetica",
        lineColor: [191, 191, 191],
        lineWidth: 0.2,
        textColor: black,
      };
      const labelCell = { fontStyle: "bold", fillColor: grey, textColor: black };
      const headStyles = {
        fillColor: navy,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        lineColor: navy,
      };
      const footStyles = { fillColor: [225, 232, 245], textColor: black, fontStyle: "bold" };
      const tableMargin = { left: M, right: M, bottom: 22 };

      // ---- Student info (bordered cells) ----
      autoTable(doc, {
        startY: 46,
        theme: "grid",
        body: [
          ["Student Name", studentName, "Admission No.", admissionNo],
          [
            "Statement Date",
            generatedOn,
            "Terms Covered",
            firstTerm === lastTerm ? firstTerm : `${firstTerm} to ${lastTerm}`,
          ],
        ],
        styles: { ...gridStyles, fontSize: 8.5, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, lineColor: border },
        columnStyles: {
          0: { cellWidth: 34, ...labelCell },
          1: { cellWidth: (cw - 68) / 2 },
          2: { cellWidth: 34, ...labelCell },
          3: { cellWidth: (cw - 68) / 2 },
        },
        margin: tableMargin,
      });

      // ---- Summary strip ----
      const balanceLabel = netBalance > 0 ? "Balance Owing" : netBalance < 0 ? "Prepaid (Credit)" : "Balance";
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 5,
        theme: "grid",
        head: [["Total Fees Charged", "Total Paid", "Brought Forward (opening)", balanceLabel]],
        body: [[
          `KES ${currency(totalDue)}`,
          `KES ${currency(totalPaid)}`,
          bfText(openingBalance),
          `KES ${currency(Math.abs(netBalance))}`,
        ]],
        styles: {
          ...gridStyles,
          fontSize: 9.5,
          cellPadding: 2.4,
          halign: "center",
          valign: "middle",
          fontStyle: "bold",
          lineColor: border,
        },
        headStyles: {
          fillColor: grey,
          textColor: black,
          fontSize: 7.5,
          fontStyle: "bold",
          cellPadding: 1.6,
          lineColor: border,
        },
        didParseCell: (data) => {
          if (data.section !== "body") return;
          if (data.column.index === 2 && openingBalance !== 0) {
            data.cell.styles.textColor = openingBalance > 0 ? RED : GREEN;
          }
          if (data.column.index === 3) {
            data.cell.styles.textColor = netBalance > 0 ? RED : GREEN;
          }
        },
        margin: tableMargin,
      });

      let y = doc.lastAutoTable.finalY + 6;
      const statusNote =
        netBalance > 0
          ? `Outstanding balance: KES ${currency(netBalance)}.`
          : netBalance < 0
            ? `Prepaid: KES ${currency(prepaidAmount)} paid in advance. It will be applied to your next term's fees.`
            : "Your account is fully settled.";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...(netBalance > 0 ? RED : GREEN));
      doc.text(statusNote, M, y);
      y += 5;

      // ---- Statement by term ----
      const rowStatus = (bal) => (bal > 0 ? "Owing" : bal < 0 ? "Prepaid" : "Cleared");
      autoTable(doc, {
        startY: y,
        theme: "grid",
        head: [["Term", "Grade", "Term Fee", "Brought Fwd", "Total Due", "Paid", "Balance", "Status"]],
        body: chronological.map((inv) => [
          inv.term_label,
          inv.grade_level_name,
          currency(inv.term_charge),
          currency(inv.brought_forward),
          currency(inv.amount_due),
          currency(inv.amount_paid),
          currency(inv.balance),
          rowStatus(Number(inv.balance)),
        ]),
        foot: [[
          "Total", "", currency(termChargesTotal), "-", "-", currency(totalPaid), currency(netBalance),
          rowStatus(netBalance),
        ]],
        showFoot: "lastPage",
        styles: { ...gridStyles, fontSize: 8, cellPadding: 2, overflow: "ellipsize" },
        headStyles,
        footStyles,
        alternateRowStyles: { fillColor: grey },
        columnStyles: {
          0: { cellWidth: 26 },
          1: { cellWidth: 20 },
          2: { cellWidth: 24, halign: "right" },
          3: { cellWidth: 24, halign: "right" },
          4: { cellWidth: 24, halign: "right" },
          5: { cellWidth: 24, halign: "right" },
          6: { cellWidth: 24, halign: "right" },
          7: { cellWidth: "auto", halign: "center" },
        },
        margin: tableMargin,
        didParseCell: (data) => {
          if (data.section === "head" && data.column.index >= 2 && data.column.index <= 6) {
            data.cell.styles.halign = "right";
          }
          if (data.section === "head" && data.column.index === 7) data.cell.styles.halign = "center";
          if (data.section !== "body") return;
          const inv = chronological[data.row.index];
          if (!inv) return;
          const bf = Number(inv.brought_forward);
          const bal = Number(inv.balance);
          if (data.column.index === 3 && bf !== 0) {
            data.cell.styles.textColor = bf > 0 ? RED : GREEN;
          }
          if (data.column.index === 5) data.cell.styles.textColor = GREEN;
          if (data.column.index === 6 || data.column.index === 7) {
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = bal > 0 ? RED : GREEN;
          }
        },
      });
      y = doc.lastAutoTable.finalY + 4;

      const legend = doc.splitTextToSize(
        "Term Fee is that term's own fee. Brought Fwd is the balance carried in from earlier terms " +
        "(positive = unpaid, negative = credit). Total Due = Term Fee + Brought Fwd. " +
        "Balance = Total Due - Paid and is carried into the next term; a negative balance means you have prepaid.",
        cw
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(legend, M, y);
      y += legend.length * 3 + 6;

      // ---- Payments received ----
      const paymentsSorted = [...allPayments].sort((a, b) => new Date(a.paid_at) - new Date(b.paid_at));
      if (paymentsSorted.length > 0) {
        if (y > pageHeight - 56) {
          doc.addPage();
          y = 20;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(...navy);
        doc.text("PAYMENTS RECEIVED", M, y);

        autoTable(doc, {
          startY: y + 2,
          theme: "grid",
          head: [["Receipt No", "Date", "Term", "Method", "Reference", "Amount (KES)"]],
          body: paymentsSorted.map((p) => [
            p.receipt_no || "-",
            new Date(p.paid_at).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }),
            p.term_label,
            METHOD_LABEL[p.method] || p.method,
            p.reference || "-",
            currency(p.amount),
          ]),
          foot: [["Total", "", "", "", "", currency(totalPaid)]],
          showFoot: "lastPage",
          styles: { ...gridStyles, fontSize: 8, cellPadding: 2, overflow: "ellipsize" },
          headStyles,
          footStyles,
          alternateRowStyles: { fillColor: grey },
          columnStyles: {
            0: { cellWidth: 32 },
            1: { cellWidth: 26 },
            2: { cellWidth: 26 },
            3: { cellWidth: 22 },
            4: { cellWidth: "auto" },
            5: { cellWidth: 30, halign: "right" },
          },
          margin: tableMargin,
          didParseCell: (data) => {
            if (data.section === "head" && data.column.index === 5) data.cell.styles.halign = "right";
          },
        });
        y = doc.lastAutoTable.finalY;
      }

      // ---- Signature + stamp block ----
      const blockH = 26;
      y += 12;
      if (y > footerLineY - 4 - blockH) {
        doc.addPage();
        y = 30;
      }
      const stampW = 46;
      const stampX = pageWidth / 2 - stampW / 2;
      const sigGap = 6;

      doc.setDrawColor(...black);
      doc.setLineWidth(0.25);
      doc.rect(stampX, y, stampW, blockH);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...black);
      doc.text("Official School Stamp", pageWidth / 2, y + 5, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(120, 120, 120);
      doc.text("(Stamp here)", pageWidth / 2, y + blockH / 2 + 3, { align: "center" });

      const drawSignature = (x1, x2, label) => {
        doc.setDrawColor(...black);
        doc.setLineWidth(0.25);
        doc.line(x1, y + 15, x2, y + 15);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...black);
        doc.text(label, x1, y + 19.5);
        doc.setFont("helvetica", "normal");
        doc.text("Date: ____________________", x1, y + 25);
      };
      drawSignature(M, stampX - sigGap, "Finance Officer's Signature");
      drawSignature(stampX + stampW + sigGap, pageWidth - M, "Headteacher's Sign");

      // ---- Footer on every page ----
      const totalPages = doc.getNumberOfPages();
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
          `${DOC_COPY_NOTE} This document is the property of The Nyali School and contains confidential student information. Duplication or unauthorized printing is prohibited.`,
          M,
          footerLineY + 7.5
        );
      }

      const safeName = String(studentName).replace(/\s+/g, "_");
      doc.save(`Fee_Statement_${safeName}_${today.toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("Failed to generate fee statement PDF:", err);
    } finally {
      setDownloadingStatement(false);
    }
  };

  // ---- Print a receipt with logo + signature/stamp blocks ----
  const handlePrintReceipt = async () => {
    if (!receipt) return;
    try {
      setPrintingReceipt(true);

      const base64Logo = await getImageBase64(logoImage);
      const logoTag = base64Logo
        ? `<img src="${base64Logo}" alt="${SCHOOL_NAME}" class="logo" />`
        : "";

      const methodLabel = METHOD_LABEL[receipt.method] || receipt.method;
      const generatedOn = new Date().toLocaleDateString("en-KE", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Receipt - ${receipt.receipt_no}</title>
            <style>
              * { box-sizing: border-box; font-family: Helvetica, Arial, sans-serif; }
              @page { size: A5 portrait; margin: 10mm; }
              html, body { margin: 0; padding: 0; color: #0f172a; background: #fff; }
              body { padding: 20px 24px; }

              .header {
                display: flex; justify-content: space-between; align-items: flex-start;
                padding-bottom: 8px; border-bottom: 2px solid #cbd5e1;
              }
              .header-left { display: flex; align-items: center; gap: 10px; }
              .logo { width: 38px; height: 38px; object-fit: contain; }
              .school-name { font-size: 15px; font-weight: bold; margin: 0; color: #0f172a; }
              .subtitle { font-size: 11px; color: #475569; margin: 2px 0 0; }
              .meta { font-size: 9px; color: #64748b; text-align: right; line-height: 1.5; }

              .title-block { margin: 14px 0 10px; }
              .title-block h2 {
                font-size: 12.5px; font-weight: bold; color: #0f172a; margin: 0;
                text-transform: uppercase; letter-spacing: 0.4px;
              }
              .title-block p { margin: 2px 0 0; font-size: 10px; color: #64748b; }

              table.info { width: 100%; border-collapse: collapse; margin-top: 4px; }
              table.info th, table.info td {
                padding: 7px 10px; border: 1px solid #e2e8f0; font-size: 11px;
                text-align: left; vertical-align: middle;
              }
              table.info th {
                background: #f1f5f9; color: #334155; width: 38%; font-weight: 600;
              }
              .amount-row td { font-size: 13px; font-weight: bold; color: #16a34a; background: #f8fafc; }

              .excess {
                margin-top: 10px; padding: 8px 10px; border: 1px solid #bbf7d0;
                background: #f0fdf4; color: #15803d; font-size: 10px; border-radius: 4px;
              }

              .qr-block { text-align: center; margin-top: 12px; }
              .qr-block img { width: 90px; height: 90px; }
              .qr-block .qr-caption { font-size: 9px; color: #64748b; margin-top: 3px; }

              .sign-block { display: flex; justify-content: space-between; gap: 14px; margin-top: 34px; }
              .sign-line {
                flex: 1; border-top: 1px solid #94a3b8; padding-top: 5px;
                font-size: 9.5px; color: #64748b; text-align: center;
              }
              .sign-role { font-weight: 700; color: #334155; font-size: 10px; }

              .footer {
                margin-top: 20px; padding-top: 6px; border-top: 1px solid #e2e8f0;
                font-size: 8.5px; color: #94a3b8;
                display: flex; justify-content: space-between;
              }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="header-left">
                ${logoTag}
                <div>
                  <p class="school-name">${SCHOOL_NAME}</p>
                  <p class="subtitle">Official Payment Receipt</p>
                </div>
              </div>
              <div class="meta">
                Receipt No: <strong>${receipt.receipt_no}</strong><br />
                Generated ${generatedOn}
              </div>
            </div>

            <div class="title-block">
              <h2>Official Payment Receipt</h2>
              <p>Fee payment acknowledgement issued by the Finance Department.</p>
            </div>

            <table class="info">
              <tr><th>Student</th><td>${receipt.student_name}</td></tr>
              <tr><th>Admission No</th><td>${receipt.admission_no}</td></tr>
              ${receipt.classroom ? `<tr><th>Class</th><td>${receipt.classroom}</td></tr>` : ""}
              <tr><th>Term</th><td>${receipt.term || "-"}</td></tr>
              <tr class="amount-row"><th>Amount Paid</th><td>KES ${currency(receipt.amount)}</td></tr>
              <tr><th>Method</th><td>${methodLabel}</td></tr>
              <tr><th>Reference</th><td>${receipt.reference || "-"}</td></tr>
              ${receipt.recorded_by_name ? `<tr><th>Recorded By</th><td>${receipt.recorded_by_name}</td></tr>` : ""}
              <tr><th>Date Paid</th><td>${new Date(receipt.paid_at).toLocaleString("en-KE")}</td></tr>
            </table>

            ${
              Number(receipt.excess) > 0
                ? `<div class="excess">
                     <strong>Credit note:</strong> KES ${currency(receipt.excess)} was paid above the
                     amount due and has been carried forward toward your next invoice.
                   </div>`
                : ""
            }

            ${
              receipt.qr_code_base64
                ? `<div class="qr-block">
                     <img src="data:image/png;base64,${receipt.qr_code_base64}" alt="Receipt verification QR code" />
                     <div class="qr-caption">Scan to verify this receipt</div>
                   </div>`
                : ""
            }

            <div class="sign-block">
              <div class="sign-line">
                <div class="sign-role">Finance Officer</div>
                <div>Signature &amp; Official Stamp</div>
              </div>
              <div class="sign-line">
                <div class="sign-role">Principal</div>
                <div>Signature &amp; Official Stamp</div>
              </div>
            </div>

            <div class="footer">
              <span>${SCHOOL_NAME} — Finance Department</span>
              <span>Official payment receipt</span>
            </div>
          </body>
        </html>
      `;

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);

      const cleanup = () => {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 500);
      };

      const frameDoc = iframe.contentWindow.document;
      frameDoc.open();
      frameDoc.write(html);
      frameDoc.close();

      const triggerPrint = () => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e) {
          // ignore
        } finally {
          cleanup();
        }
      };

      if (iframe.contentWindow.document.readyState === "complete") {
        setTimeout(triggerPrint, 120);
      } else {
        iframe.onload = () => setTimeout(triggerPrint, 120);
      }
    } finally {
      setPrintingReceipt(false);
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Fee Payment</h1>
          <p className="page-subtitle">
            View your fee statements and make payments
          </p>
        </div>
        <div className="page-header__actions">
          {!loading && (
            <span className={`badge ${netBalance > 0 ? "badge-danger" : "badge-success"}`}>
              <i className={`bi ${netBalance > 0 ? "bi-exclamation-circle" : "bi-check-circle"} me-1`}></i>
              {netBalance < 0
                ? `Prepaid: KES ${currency(prepaidAmount)}`
                : `Balance: KES ${currency(netBalance)}`}
            </span>
          )}
          <a href="/student/fee-structure" className="btn btn-sm btn-outline-secondary">
            <i className="bi bi-card-list me-1"></i>
            Fee Structure
          </a>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={handleDownloadStatement}
            disabled={loading || downloadingStatement || invoices.length === 0}
          >
            {downloadingStatement ? (
              <>
                <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                Preparing...
              </>
            ) : (
              <>
                <i className="bi bi-file-earmark-pdf me-1"></i>
                Download Statement
              </>
            )}
          </button>
        </div>
      </div>

      {/* Fee Structure Missing Banner */}
      {feeStatus && feeStatus.has_fee_structure === false && (
        <div className="alert alert-warning mb-4 d-flex align-items-center gap-2 flex-wrap">
          <i className="bi bi-exclamation-triangle"></i>
          <span>{feeStatus.message}</span>
        </div>
      )}

      {/* Balance Banners */}
      {!loading && netBalance > 0 && (
        <div className="alert alert-warning mb-4 d-flex align-items-start gap-2">
          <i className="bi bi-exclamation-circle"></i>
          <span>
            You have an outstanding balance of <strong>KES {netBalance.toLocaleString()}</strong> across
            your fee statements. You don't need to pay it all at once — partial payments are accepted and
            are applied to your oldest unpaid term first.
          </span>
        </div>
      )}
      {!loading && netBalance < 0 && (
        <div className="alert alert-success mb-4 d-flex align-items-start gap-2">
          <i className="bi bi-piggy-bank"></i>
          <span>
            You have prepaid <strong>KES {Math.abs(netBalance).toLocaleString()}</strong>. This credit will be
            applied automatically to your next term's fees.
          </span>
        </div>
      )}

      {/* How to pay */}
      {!loading && invoices.length > 0 && (
        <div className="alert alert-info mb-4">
          <div className="d-flex align-items-start gap-2 mb-2">
            <i className="bi bi-info-circle"></i>
            <strong>How to pay your school fees</strong>
          </div>
          <div className="small text-muted-soft mb-2">
            Online payment on this page isn't available yet. Please pay via M-Pesa:
          </div>
          <ol className="small mb-2" style={{ paddingLeft: "1.1rem" }}>
            <li>
              Pay via <strong>Paybill {SCHOOL_PAYBILL_NUMBER}</strong>, Account Number ={" "}
              <strong>your Admission Number</strong> (or Till {SCHOOL_TILL_NUMBER}, if the school uses a
              Buy Goods till).
            </li>
            <li>
              Once you get the M-Pesa confirmation SMS, <strong>forward that exact message</strong> to the
              school on <strong>{FEES_FORWARD_PHONE}</strong>.
            </li>
            <li>Include your <strong>full name</strong> and <strong>admission number</strong> in the same message.</li>
          </ol>
          <div className="form-text-hint mb-0">
            Finance will confirm and update your balance here once the payment is recorded.
          </div>
        </div>
      )}

      {/* Summary cards */}
      {!loading && invoices.length > 0 && (
        <div className="stat-grid">
          <div className="dm-card dm-card--primary">
            <div className="dm-card__top">
              <span className="dm-card__label">Total Fees Charged</span>
            </div>
            <div className="dm-card__num">KES {currency(totalDue)}</div>
          </div>

          <div className="dm-card dm-card--warning">
            <div className="dm-card__top">
              <span className="dm-card__label">
                Brought Forward{firstInvoice ? ` (${firstInvoice.term_label})` : ""}
              </span>
            </div>
            <div
              className="dm-card__num"
              style={{
                color:
                  openingBalance > 0
                    ? "var(--danger-600)"
                    : openingBalance < 0
                    ? "var(--success-600)"
                    : undefined,
              }}
            >
              {bfText(openingBalance)}
            </div>
            <div className="dm-card__sub">
              {openingBalance > 0
                ? "Unpaid from earlier terms"
                : openingBalance < 0
                ? "Credit from earlier terms"
                : "Nothing carried in"}
            </div>
          </div>

          <div className="dm-card dm-card--success">
            <div className="dm-card__top">
              <span className="dm-card__label">Total Paid</span>
            </div>
            <div className="dm-card__num">KES {currency(totalPaid)}</div>
          </div>

          <div className={`dm-card ${netBalance > 0 ? "dm-card--danger" : "dm-card--success"}`}>
            <div className="dm-card__top">
              <span className="dm-card__label">
                {netBalance > 0 ? "Balance Owing" : netBalance < 0 ? "Prepaid (Credit)" : "Balance"}
              </span>
            </div>
            <div className="dm-card__num">
              KES {currency(Math.abs(netBalance))}
            </div>
            {netBalance < 0 && <div className="dm-card__sub">Applied to next term</div>}
          </div>
        </div>
      )}

      {/* Fee Statements table */}
      {loading ? (
        <TableSkeleton rows={5} columns={7} />
      ) : invoices.length === 0 ? (
        <div className="table-wrap mb-4">
          <div className="empty-state">
            <i className="bi bi-cash-stack"></i>
            <h6>No Fee Statements</h6>
            <p className="text-muted-soft">
              You don't have any fee statements at the moment.
              Please contact the finance office for assistance.
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap mb-4">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-receipt me-2 text-brand"></i>
              Fee Statements
              <span className="badge badge-neutral ms-2">{invoices.length}</span>
            </span>
            <span className="chart-card__subtitle mb-0">
              <i className="bi bi-calendar3 me-1"></i>
              {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Grade</th>
                  <th className="text-end">Brought Fwd</th>
                  <th className="text-end">Term Fee</th>
                  <th className="text-end">Total Due</th>
                  <th className="text-end">Paid</th>
                  <th className="text-end">Balance c/f</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <span className="cell-name">{inv.term_label}</span>
                    </td>
                    <td>
                      <span className="badge badge-blue">{inv.grade_level_name}</span>
                    </td>
                    <td className={`cell-mono text-end ${Number(inv.brought_forward) < 0 ? "text-success" : Number(inv.brought_forward) > 0 ? "text-danger" : ""}`}>
                      {Number(inv.brought_forward).toLocaleString()}
                    </td>
                    <td className="cell-mono text-end">{Number(inv.term_charge).toLocaleString()}</td>
                    <td className="cell-mono text-end">{Number(inv.amount_due).toLocaleString()}</td>
                    <td className="cell-mono text-end text-success">{Number(inv.amount_paid).toLocaleString()}</td>
                    <td className={`cell-mono text-end fw-bold ${Number(inv.balance) > 0 ? "text-danger" : "text-success"}`}>
                      {Number(inv.balance).toLocaleString()}
                      {Number(inv.balance) < 0 && (
                        <span className="badge badge-success ms-1">Prepaid</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              Showing <strong>{invoices.length}</strong> invoice{invoices.length !== 1 ? "s" : ""}
            </span>
            <span className="form-text-hint m-0">
              Each term's balance is carried into the next term.
            </span>
          </div>
        </div>
      )}

      {/* Payment History */}
      {!loading && allPayments.length > 0 && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-list-ul me-2 text-brand"></i>
              Payment History
              <span className="badge badge-neutral ms-2">{allPayments.length}</span>
            </span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Receipt No</th>
                  <th>Term</th>
                  <th className="text-end">Amount (KES)</th>
                  <th>Method</th>
                  <th>Date</th>
                  <th style={{ width: "100px" }}></th>
                </tr>
              </thead>
              <tbody>
                {allPayments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="cell-mono text-brand fw-semibold">
                        {p.receipt_no}
                      </span>
                    </td>
                    <td>{p.term_label}</td>
                    <td className="cell-mono text-end fw-bold text-success">
                      KES {Number(p.amount).toLocaleString()}
                    </td>
                    <td>
                      <span className="badge badge-neutral">
                        <i className="bi bi-phone me-1"></i>
                        {p.method}
                      </span>
                    </td>
                    <td className="cell-muted">
                      {new Date(p.paid_at).toLocaleDateString('en-KE', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </td>
                    <td>
                      <button
                        className="btn btn-sm btn-outline-primary w-100"
                        onClick={() => viewReceipt(p.id)}
                      >
                        <i className="bi bi-receipt me-1"></i>Receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {showReceiptModal && (
        <div
          className="modal show d-block modal-scrim"
          tabIndex="-1"
          role="dialog"
          onClick={closeReceiptModal}
        >
          <div
            className="modal-dialog modal-dialog-centered"
            style={{ maxWidth: "560px" }}
            role="document"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-receipt me-2 text-brand"></i>
                  Payment Receipt
                </h5>
                <button type="button" className="btn-close" onClick={closeReceiptModal}></button>
              </div>
              <div className="modal-body">
                {receiptLoading ? (
                  <div className="text-center py-4">
                    <div className="spinner-border text-primary" role="status" style={{ width: "3rem", height: "3rem" }}></div>
                    <p className="form-text-hint mt-2 mb-0">Loading receipt...</p>
                  </div>
                ) : (
                  <ReceiptCard receipt={receipt} />
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={closeReceiptModal}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handlePrintReceipt}
                  disabled={receiptLoading || !receipt || printingReceipt}
                >
                  {printingReceipt ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Preparing...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-printer me-2"></i>
                      Print / Save PDF
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}