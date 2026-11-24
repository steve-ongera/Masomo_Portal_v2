import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { financeApi, calendarApi, academicsApi, otherPaymentsApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";
import Pagination from "../../components/Pagination";
import logoImage from "../../assets/nyali_school_logo.png";
import { SplitPaymentPanel, CorrectReceiptPanel, AlumniBalancePanel } from "./paymentTools";
import { OtherPaymentsPanel } from "./otherPayments";

// Exact money display: keeps cents when present, never rounds a figure like 30,000 down.
const currency = (value) =>
  Number(value || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

const METHOD_LABEL = {
  MPESA: "M-Pesa",
  BANK: "Bank",
  CASH: "Cash",
  CHEQUE: "Cheque",
};

const METHOD_BADGE = {
  MPESA: "badge-success",
  BANK: "badge-blue",
  CASH: "badge-gold",
  CHEQUE: "badge-neutral",
};

const METHOD_ICON = {
  MPESA: "bi-phone",
  BANK: "bi-building",
  CASH: "bi-cash",
  CHEQUE: "bi-file-text",
};

// ---- Receipt PDF theme (matches the report card) ----
const RECEIPT_SCHOOL_NAME = "The Nyali School";
const RECEIPT_ADDRESS_LINE_1 = "P.O BOX 87073-80100, MOMBASA";
const RECEIPT_ADDRESS_LINE_2 = "Email: info@nyalischool.com";
const RECEIPT_MOTTO = "STRIVE TO EXCELL";
const RC_NAVY = [31, 56, 100];
const RC_GREY = [242, 242, 242];
const RC_BORDER = [166, 166, 166];
const RC_BLACK = [0, 0, 0];

// Positive = still owes, negative = prepaid credit, 0 = fully paid.
// Used on the on-screen receipt and the PDF (which is also what gets printed).
const describeBalance = (balance) => {
  const b = Number(balance || 0);
  if (b > 0) return { label: "Balance Remaining", value: `KES ${currency(b)}`, tone: "owing" };
  if (b < 0) return { label: "Prepaid Credit", value: `KES ${currency(Math.abs(b))}`, tone: "credit" };
  return { label: "Balance", value: "KES 0 (Fully paid)", tone: "clear" };
};

// Groups a flat list of Invoice objects (from InvoiceSerializer) into
// one entry per student, keyed by admission_no.
const groupInvoicesByStudent = (invoiceList) => {
  const byAdmission = new Map();
  invoiceList.forEach((inv) => {
    if (!byAdmission.has(inv.admission_no)) {
      byAdmission.set(inv.admission_no, {
        admission_no: inv.admission_no,
        student_name: inv.student_name,
        invoices: [],
      });
    }
    byAdmission.get(inv.admission_no).invoices.push(inv);
  });
  return Array.from(byAdmission.values());
};

// Shared helper: load the logo as a base64 data URL
const getImageBase64 = (url) => {
  return new Promise((resolve) => {
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
};

const initialsOf = (name = "") =>
  name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();

// Inner padding for content that sits inside a .page-card but outside a table
const PAD = { padding: "0 1.1rem 1.1rem" };

export default function FinancePayments() {
  // ---------------------------------------------------------------------
  // TABS - "payment" (record a payment + receipt) vs "payments" (history)
  // plus the finance tools: "split", "correct", "alumni"
  // ---------------------------------------------------------------------
  const [activeTab, setActiveTab] = useState("payment"); // "payment" | "payments" | "split" | "correct" | "alumni" | "other"

  // ---------------------------------------------------------------------
  // STEP 1 - find a student by admission number / name, then SELECT them
  // ---------------------------------------------------------------------
  const [studentQuery, setStudentQuery] = useState("");
  const [debouncedStudentQuery, setDebouncedStudentQuery] = useState("");
  const [studentSearchLoading, setStudentSearchLoading] = useState(false);
  const [studentResults, setStudentResults] = useState([]); // [{admission_no, student_name, invoices:[]}]
  const [selectedAdmission, setSelectedAdmission] = useState(null);
  const [studentSearchError, setStudentSearchError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedStudentQuery(studentQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [studentQuery]);

  const runStudentSearch = async (term) => {
    if (!term) {
      setStudentResults([]);
      setSelectedAdmission(null);
      return;
    }
    setStudentSearchLoading(true);
    setStudentSearchError("");
    try {
      const { data } = await financeApi.invoices({ search: term, page_size: 200 });
      const rows = data.results ?? data;
      // Every student with an invoice is listed - including those who are fully paid (balance 0)
      // or already in credit - so the cashier can still take an advance payment for them.
      const grouped = groupInvoicesByStudent(rows);
      setStudentResults(grouped);
      // exactly one match -> auto-select; otherwise keep the current pick if it is still listed
      if (grouped.length === 1) {
        setSelectedAdmission(grouped[0].admission_no);
      } else if (!grouped.some((g) => g.admission_no === selectedAdmission)) {
        setSelectedAdmission(null);
      }
      if (grouped.length === 0) {
        setStudentSearchError("No matching student was found.");
      }
    } catch (err) {
      setStudentSearchError("Could not search invoices. Please try again.");
    } finally {
      setStudentSearchLoading(false);
    }
  };

  useEffect(() => {
    runStudentSearch(debouncedStudentQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedStudentQuery]);

  const clearStudentSearch = () => {
    setStudentQuery("");
    setDebouncedStudentQuery("");
    setStudentResults([]);
    setSelectedAdmission(null);
    setStudentSearchError("");
  };

  // The Search button just skips the typing delay.
  const searchStudentNow = (e) => {
    e.preventDefault();
    setDebouncedStudentQuery(studentQuery.trim());
  };

  // Derived: the selected student + their total owed (latest invoice already
  // folds in earlier arrears via brought_forward).
  const selectedStudent = studentResults.find((s) => s.admission_no === selectedAdmission);
  const selectedLatestInvoice = selectedStudent
    ? [...selectedStudent.invoices]
        .sort((a, b) => new Date(a.issued_at) - new Date(b.issued_at) || a.id - b.id)
        .at(-1)
    : null;
  const selectedTotalOwed = selectedLatestInvoice ? Number(selectedLatestInvoice.balance) : 0;

  // ---------------------------------------------------------------------
  // STEP 2 - Payment details. The backend (services.record_bulk_payment)
  // splits the amount across the student's unpaid invoices oldest-first;
  // any excess is kept as prepaid credit.
  // The form is now shown inline as soon as a student is selected.
  // ---------------------------------------------------------------------
  const [payingBalance, setPayingBalance] = useState(null); // { admission_no, student_name, totalOwed }
  const [paymentDraft, setPaymentDraft] = useState({ amount: "", method: "MPESA", reference: "" });
  const [recording, setRecording] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  // Bank-style verification step shown BEFORE the payment is actually recorded.
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const openBalancePaymentPanel = (student, totalOwed) => {
    setPayingBalance({
      admission_no: student.admission_no,
      student_name: student.student_name,
      totalOwed,
    });
    setPaymentDraft({ amount: totalOwed > 0 ? String(totalOwed) : "", method: "MPESA", reference: "" });
    setPaymentError("");
    setShowConfirm(false);
    setConfirmChecked(false);
  };

  // (Re)start the payment form whenever the selected student or their balance changes.
  useEffect(() => {
    if (selectedStudent) {
      openBalancePaymentPanel(selectedStudent, selectedTotalOwed);
    } else {
      setPayingBalance(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdmission, selectedTotalOwed]);

  const resetPaymentForm = () => {
    if (recording || !selectedStudent) return;
    openBalancePaymentPanel(selectedStudent, selectedTotalOwed);
  };

  const amountNumber = Number(paymentDraft.amount || 0);
  const activeBalanceDue = payingBalance ? payingBalance.totalOwed : 0;
  const excessOverBalance = amountNumber > Math.max(activeBalanceDue, 0) ? amountNumber - Math.max(activeBalanceDue, 0) : 0;
  // What the student will still owe (or hold as credit, if negative) after this payment.
  const balanceAfterPayment = activeBalanceDue - amountNumber;

  // ---------------------------------------------------------------------
  // STEP 3 - receipt (fetched from the backend, includes QR + allocations + balance)
  // ---------------------------------------------------------------------
  const [receipt, setReceipt] = useState(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");

  // Shared by the three finance-tool panels (split / correct / alumni)
  const handlePanelMessage = (text, type = "success") => {
    setMessage(text);
    setMessageType(type);
  };

  // Form submit only validates, then opens the verification popup.
  const requestConfirmation = (e) => {
    e.preventDefault();
    if (!payingBalance || recording) return;
    if (!(amountNumber > 0)) {
      setPaymentError("Enter an amount greater than zero.");
      return;
    }
    setPaymentError("");
    setConfirmChecked(false);
    setShowConfirm(true);
  };

  const cancelConfirmation = () => {
    if (recording) return;
    setShowConfirm(false);
    setConfirmChecked(false);
  };

  // Runs only after the cashier verifies and confirms in the popup.
  const submitPayment = async () => {
    if (!payingBalance || recording) return;
    if (!(amountNumber > 0)) {
      setShowConfirm(false);
      setPaymentError("Enter an amount greater than zero.");
      return;
    }
    setRecording(true);
    setPaymentError("");
    try {
      const { data } = await financeApi.recordBulkPayment({
        admission_no: payingBalance.admission_no,
        amount: paymentDraft.amount,
        method: paymentDraft.method,
        reference: paymentDraft.reference,
      });

      // Accuracy check: what the server recorded must equal what was typed
      const recordedTotal = (data.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      const mismatch = Math.abs(recordedTotal - amountNumber) > 0.005;

      setReceiptLoading(true);
      const { data: receiptData } = await financeApi.paymentReceipt(data.last_payment_id);
      setReceipt({ ...receiptData, excess: excessOverBalance, payment_id: data.last_payment_id });

      const studentName = payingBalance.student_name;
      setPayingBalance(null);

      if (mismatch) {
        setMessage(
          `WARNING: you entered KES ${currency(amountNumber)} but KES ${currency(recordedTotal)} was recorded. Please verify before giving out the receipt.`
        );
        setMessageType("danger");
      } else {
        setMessage(
          `Payment of KES ${currency(recordedTotal)} recorded for ${studentName}. The receipt is ready below.`
        );
        setMessageType("success");
      }

      // refresh this student's outstanding invoices and the history table
      runStudentSearch(debouncedStudentQuery);
      loadPayments(1);
    } catch (err) {
      setPaymentError(
        err.response?.data?.detail ||
          (err.response?.data ? JSON.stringify(err.response.data) : "Could not record this payment.")
      );
    } finally {
      setRecording(false);
      setReceiptLoading(false);
      setShowConfirm(false);
      setConfirmChecked(false);
    }
  };

  // ---- Build the professional A5 receipt PDF. ALWAYS exactly ONE page. ----
  // Compact fonts, fixed-position bottom block (QR + stamp + signatures +
  // copyright footer), and no addPage() anywhere - so it can never spill
  // onto a second page. Long "Applied to" lists switch to a two-column grid.
  //
  // This is the SINGLE source of truth for the receipt layout: the download
  // button saves it, and the print button prints the very same document, so
  // the two are always identical.
  const buildReceiptPdf = async (r) => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
    const pageWidth = doc.internal.pageSize.getWidth(); // 148
    const pageHeight = doc.internal.pageSize.getHeight(); // 210
    const marginX = 10;
    const year = new Date().getFullYear();

    const base64Logo = await getImageBase64(logoImage);

    // --- Header (same look as the report card): logo left, school details centred ---
    if (base64Logo) {
      const props = doc.getImageProperties(base64Logo);
      const ratio = props.width / props.height || 1;
      const maxH = 13;
      const maxW = 28;
      let drawW = maxH * ratio;
      let drawH = maxH;
      if (drawW > maxW) {
        drawW = maxW;
        drawH = drawW / ratio;
      }
      doc.addImage(base64Logo, "PNG", marginX, 6 + (maxH - drawH) / 2, drawW, drawH);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...RC_NAVY);
    doc.text(RECEIPT_SCHOOL_NAME, pageWidth / 2, 12, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...RC_BLACK);
    doc.text(RECEIPT_ADDRESS_LINE_1, pageWidth / 2, 16.5, { align: "center" });
    doc.text(RECEIPT_ADDRESS_LINE_2, pageWidth / 2, 19.5, { align: "center" });

    doc.setFont("helvetica", "italic");
    doc.setFontSize(6.5);
    doc.setTextColor(110, 110, 110);
    doc.text(RECEIPT_MOTTO, pageWidth / 2, 22.8, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(110, 110, 110);
    doc.text(
      `Generated ${new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}`,
      pageWidth - marginX,
      8.5,
      { align: "right" }
    );

    doc.setDrawColor(...RC_NAVY);
    doc.setLineWidth(0.6);
    doc.line(marginX, 25.5, pageWidth - marginX, 25.5);

    // --- Title ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...RC_NAVY);
    doc.text("OFFICIAL PAYMENT RECEIPT", pageWidth / 2, 31, { align: "center" });

    // --- Receipt number + date strip ---
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...RC_BLACK);
    doc.text(`Receipt No: ${r.receipt_no}`, marginX, 36.5);
    doc.text(`Date: ${new Date(r.paid_at).toLocaleString("en-KE")}`, pageWidth - marginX, 36.5, {
      align: "right",
    });

    // --- Info table ---
    // Balance row (index 5): red when the student still owes, green when prepaid.
    const bal = describeBalance(r.balance);
    const BALANCE_ROW_INDEX = 5;

    const rows = [
      ["Student", r.student_name],
      ["Admission No", r.admission_no],
      ["Current Class", r.classroom || "-"],
      r.payment_for ? ["Payment For", r.payment_for] : ["Term", r.term || "-"],
      ["Amount Paid", `KES ${currency(r.amount)}`],
      [bal.label, bal.value],
      ["Method", METHOD_LABEL[r.method] || r.method],
      ["Reference", r.reference || "-"],
      ["Recorded By", r.recorded_by_name || "-"],
    ];

    autoTable(doc, {
      startY: 39.5,
      margin: { left: marginX, right: marginX },
      pageBreak: "avoid",
      body: rows,
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 7.5,
        cellPadding: 1.3,
        lineColor: RC_BORDER,
        lineWidth: 0.2,
        textColor: RC_BLACK,
        overflow: "ellipsize",
      },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 30, fillColor: RC_GREY },
        1: { cellWidth: "auto" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === BALANCE_ROW_INDEX) {
          data.cell.styles.fontStyle = "bold";
          if (data.column.index === 1) {
            data.cell.styles.textColor =
              bal.tone === "owing"
                ? [185, 28, 28]
                : bal.tone === "credit"
                ? [22, 101, 52]
                : RC_BLACK;
          }
        }
      },
    });

    // --- Breakdown: which terms this payment was applied to ---
    if (r.allocations && r.allocations.length > 1) {
      const allocs = r.allocations;
      let head;
      let body;
      if (allocs.length > 5) {
        // two side-by-side columns keep long lists short
        const half = Math.ceil(allocs.length / 2);
        head = [["Applied To", "Amount (KES)", "Applied To", "Amount (KES)"]];
        body = Array.from({ length: half }, (_, i) => {
          const left = allocs[i];
          const right = allocs[i + half];
          return [
            left.term,
            currency(left.amount),
            right ? right.term : "",
            right ? currency(right.amount) : "",
          ];
        });
      } else {
        head = [["Applied To", "Amount (KES)"]];
        body = allocs.map((a) => [a.term, currency(a.amount)]);
      }

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 3,
        margin: { left: marginX, right: marginX },
        pageBreak: "avoid",
        head,
        body,
        theme: "grid",
        styles: {
          font: "helvetica",
          fontSize: 6.8,
          cellPadding: 1,
          overflow: "ellipsize",
          textColor: RC_BLACK,
          lineColor: [191, 191, 191],
          lineWidth: 0.2,
        },
        headStyles: { fillColor: RC_NAVY, textColor: [255, 255, 255], fontStyle: "bold", lineColor: RC_NAVY },
        alternateRowStyles: { fillColor: RC_GREY },
        columnStyles:
          allocs.length > 5 ? { 1: { halign: "right" }, 3: { halign: "right" } } : { 1: { halign: "right" } },
      });
    }

    let cursorY = doc.lastAutoTable.finalY + 4;

    // --- Excess / overpayment note ---
    if (r.excess > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(25, 135, 84);
      const note = doc.splitTextToSize(
        `This payment exceeds the amount due by KES ${currency(r.excess)}. The excess has been ` +
          `recorded as a credit and will automatically reduce the student's next invoice.`,
        pageWidth - marginX * 2
      );
      doc.text(note, marginX, cursorY);
      cursorY += note.length * 3.2;
    }

    // ================================================================
    // BOTTOM BLOCK - pinned to fixed positions from the page bottom:
    //   QR + stamp row  ->  signatures  ->  copyright footer
    // ================================================================
    const footerLineY = pageHeight - 15;
    const sigY = footerLineY - 12;
    const qrSize = 28;
    const qrX = marginX;
    const qrY = sigY - qrSize - 10;

    if (r.qr_code_base64) {
      doc.addImage(`data:image/png;base64,${r.qr_code_base64}`, "PNG", qrX, qrY, qrSize, qrSize);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(110, 110, 110);
      doc.text("Scan to verify this receipt", qrX + qrSize / 2, qrY + qrSize + 3, { align: "center" });
    } else {
      doc.setDrawColor(...RC_BORDER);
      doc.setLineWidth(0.2);
      doc.rect(qrX, qrY, qrSize, qrSize);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(110, 110, 110);
      doc.text("Verification QR", qrX + qrSize / 2, qrY + qrSize / 2 - 1, { align: "center" });
      doc.text("unavailable", qrX + qrSize / 2, qrY + qrSize / 2 + 3, { align: "center" });
    }

    // Official stamp box, same row as the QR
    const stampX = qrX + qrSize + 5;
    const stampWidth = pageWidth - stampX - marginX;

    doc.setDrawColor(...RC_BLACK);
    doc.setLineWidth(0.25);
    doc.rect(stampX, qrY, stampWidth, qrSize);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...RC_BLACK);
    doc.text("Official School Stamp", stampX + stampWidth / 2, qrY + 5, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(120, 120, 120);
    doc.text("(Stamp here)", stampX + stampWidth / 2, qrY + qrSize / 2 + 2, { align: "center" });

    // Signature lines
    doc.setDrawColor(...RC_BLACK);
    doc.setLineWidth(0.25);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...RC_BLACK);
    doc.text("Finance Officer's Signature:", marginX, sigY);
    doc.line(marginX, sigY + 6, pageWidth / 2 - 3, sigY + 6);
    doc.text("Headteacher's Sign:", pageWidth / 2 + 3, sigY);
    doc.line(pageWidth / 2 + 3, sigY + 6, pageWidth - marginX, sigY + 6);

    // Copyright / anti-duplication footer (always on the page)
    doc.setDrawColor(...RC_BLACK);
    doc.setLineWidth(0.15);
    doc.line(marginX, footerLineY, pageWidth - marginX, footerLineY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(...RC_BLACK);
    doc.text(`© ${year} The Nyali School. All rights reserved.`, marginX, footerLineY + 4);

    doc.setFont("helvetica", "italic");
    doc.setFontSize(5.5);
    doc.setTextColor(90, 90, 90);
    doc.text("Powered by Masomo Portal (www.masomoportal.com)", pageWidth - marginX, footerLineY + 4, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    doc.text(
      "This is an official payment receipt. Duplication  is prohibited.",
      marginX,
      footerLineY + 7.5
    );

    return doc;
  };

  // ---- Download the receipt PDF ----
  const downloadReceiptPdf = async (r) => {
    const doc = await buildReceiptPdf(r);
    doc.save(`receipt_${r.receipt_no}.pdf`);
  };

  // ---- Print a receipt (from the receipt panel or the payment history list) ----
  // Prints the exact same PDF that the download button produces.
  const [printingReceiptId, setPrintingReceiptId] = useState(null);

  const handlePrintPaymentReceipt = async (payment) => {
    try {
      setPrintingReceiptId(payment.id);
      const { data: r } = await financeApi.paymentReceipt(payment.id);

      // Same PDF as the download, so print and download always match
      const doc = await buildReceiptPdf(r);
      const blobUrl = URL.createObjectURL(doc.output("blob"));

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "1px";
      iframe.style.height = "1px";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      iframe.src = blobUrl;

      const cleanup = () => {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          URL.revokeObjectURL(blobUrl);
        }, 60000); // keep alive long enough for the print dialog
      };

      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            // Fallback: open the PDF in a tab so the user can print from there
            window.open(blobUrl, "_blank");
          } finally {
            cleanup();
          }
        }, 300);
      };

      document.body.appendChild(iframe);
    } catch (err) {
      setMessage("Could not prepare the receipt for printing.");
      setMessageType("danger");
    } finally {
      setPrintingReceiptId(null);
    }
  };

  // ---------------------------------------------------------------------
  // OTHER PAYMENTS receipts (uniform, trip, ID, graduation, damages, ...)
  // Uses the very same A5 receipt PDF as school fees (buildReceiptPdf), so
  // both kinds of receipt always look identical.
  // ---------------------------------------------------------------------
  const [printingOtherId, setPrintingOtherId] = useState(null);

  const loadOtherReceiptData = async (paymentId) => {
    const { data: d } = await otherPaymentsApi.receipt(paymentId);
    return {
      receipt_no: d.receipt_no,
      paid_at: d.paid_at,
      student_name: d.student_name,
      admission_no: d.admission_no,
      classroom: d.class_label,
      payment_for: d.charge_description ? `${d.charge_type_name} - ${d.charge_description}` : d.charge_type_name,
      amount: d.amount,
      balance: d.charge_balance ?? 0, // what is still unpaid on THIS charge (0 for walk-in payments)
      method: d.method,
      reference: d.reference,
      recorded_by_name: d.recorded_by_name,
      qr_code_base64: d.qr_base64,
    };
  };

  const downloadOtherReceipt = async (paymentId) => {
    try {
      const r = await loadOtherReceiptData(paymentId);
      const doc = await buildReceiptPdf(r);
      doc.save(`receipt_${r.receipt_no}.pdf`);
    } catch (err) {
      setMessage("Could not prepare the receipt.");
      setMessageType("danger");
    }
  };

  const printOtherReceipt = async (paymentId) => {
    try {
      setPrintingOtherId(paymentId);
      const r = await loadOtherReceiptData(paymentId);
      const doc = await buildReceiptPdf(r);
      const blobUrl = URL.createObjectURL(doc.output("blob"));

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "1px";
      iframe.style.height = "1px";
      iframe.style.border = "0";
      iframe.style.opacity = "0";
      iframe.style.pointerEvents = "none";
      iframe.src = blobUrl;

      const cleanup = () => {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          URL.revokeObjectURL(blobUrl);
        }, 60000); // keep alive long enough for the print dialog
      };

      iframe.onload = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            window.open(blobUrl, "_blank");
          } finally {
            cleanup();
          }
        }, 300);
      };

      document.body.appendChild(iframe);
    } catch (err) {
      setMessage("Could not prepare the receipt for printing.");
      setMessageType("danger");
    } finally {
      setPrintingOtherId(null);
    }
  };

  // ---------------------------------------------------------------------
  // filter dropdown options (for the payment history table below)
  // ---------------------------------------------------------------------
  const [academicYears, setAcademicYears] = useState([]);
  const [gradeLevels, setGradeLevels] = useState([]);
  const [streams, setStreams] = useState([]);
  const [terms, setTerms] = useState([]);

  useEffect(() => {
    calendarApi.academicYears().then(({ data }) => setAcademicYears(data.results ?? data));
    academicsApi.gradeLevels().then(({ data }) => setGradeLevels(data.results ?? data));
    academicsApi.streams().then(({ data }) => setStreams(data.results ?? data));
    calendarApi.terms().then(({ data }) => setTerms(data.results ?? data));
  }, []);

  // ---- payments list: filters, search, pagination ----
  const [filters, setFilters] = useState({
    invoice__enrollment__academic_year: "",
    invoice__enrollment__classroom__grade_level: "",
    invoice__enrollment__classroom__stream: "",
    invoice__fee_structure__term: "",
    method: "",
    date_from: "", // exact "paid from" date (YYYY-MM-DD), filtered in the DB
    date_to: "", // exact "paid to" date (YYYY-MM-DD), filtered in the DB
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [payments, setPayments] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [listLoading, setListLoading] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const activeParams = useMemo(() => {
    const params = { page_size: pageSize };
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params[key] = value;
    });
    if (debouncedSearch) params.search = debouncedSearch;
    return params;
  }, [filters, debouncedSearch]);

  const loadPayments = async (targetPage = page) => {
    setListLoading(true);
    try {
      const { data } = await financeApi.payments({ ...activeParams, page: targetPage });
      setPayments(data.results ?? data);
      setCount(data.count ?? (data.results ?? data).length);
      setPage(targetPage);
    } catch (error) {
      console.error("Failed to load payments:", error);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    loadPayments(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeParams]);

  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  const updateFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const clearFilters = () => {
    setFilters({
      invoice__enrollment__academic_year: "",
      invoice__enrollment__classroom__grade_level: "",
      invoice__enrollment__classroom__stream: "",
      invoice__fee_structure__term: "",
      method: "",
      date_from: "",
      date_to: "",
    });
    setSearch("");
    setDebouncedSearch("");
  };

  const hasActiveFilters =
    filters.invoice__enrollment__academic_year ||
    filters.invoice__enrollment__classroom__grade_level ||
    filters.invoice__enrollment__classroom__stream ||
    filters.invoice__fee_structure__term ||
    filters.method ||
    filters.date_from ||
    filters.date_to ||
    search;

  // ---- Excel export ----
  const downloadExcel = async () => {
    setExportingExcel(true);
    try {
      const { data } = await financeApi.payments({ ...activeParams, page_size: 5000, page: 1 });
      const rows = data.results ?? data;

      const sheetData = rows.map((p) => ({
        "Receipt No": p.receipt_no || "",
        "Date Paid": p.paid_at ? new Date(p.paid_at).toLocaleString() : "",
        "Admission No": p.admission_no,
        "Student Name": p.student_name,
        Classroom: p.classroom,
        "Academic Year": p.academic_year,
        Term: p.term,
        "Amount (KES)": Number(p.amount),
        Method: METHOD_LABEL[p.method] || p.method,
        Reference: p.reference || "",
        "Recorded By": p.recorded_by_name,
      }));

      const worksheet = XLSX.utils.json_to_sheet(sheetData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Payments");

      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(workbook, `payments_${stamp}.xlsx`);
    } catch (error) {
      console.error("Failed to export Excel:", error);
    } finally {
      setExportingExcel(false);
    }
  };

  // ---- PDF export (payment history, not the receipt) ----
  const downloadPdf = async () => {
    setExportingPdf(true);
    try {
      const { data } = await financeApi.payments({ ...activeParams, page_size: 5000, page: 1 });
      const rows = data.results ?? data;

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const marginX = 12;
      const year = new Date().getFullYear();
      const generatedOn = new Date().toLocaleString("en-KE");

      const base64Logo = await getImageBase64(logoImage);
      const totalAmount = rows.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      // Finance theme palette
      const NAVY = [15, 41, 71];
      const SLATE = [71, 85, 105];
      const LIGHT = [241, 245, 249];
      const GOLD = [180, 141, 40];
      const GREEN = [22, 101, 52];

      const drawHeader = () => {
        if (base64Logo) {
          doc.addImage(base64Logo, "PNG", marginX, 8, 12, 12);
        }
        const textX = base64Logo ? marginX + 15 : marginX;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(...NAVY);
        doc.text("The Nyali School", textX, 14);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...SLATE);
        doc.text("Finance Department — Payment History Report", textX, 19);

        doc.setFontSize(8);
        doc.setTextColor(...SLATE);
        doc.text(`Generated: ${generatedOn}`, pageWidth - marginX, 11, { align: "right" });
        doc.text(`Total Records: ${rows.length}`, pageWidth - marginX, 16, { align: "right" });
        if (filters.date_from || filters.date_to) {
          doc.text(
            `Date range: ${filters.date_from || "..."} to ${filters.date_to || "..."}`,
            pageWidth - marginX,
            21,
            { align: "right" }
          );
        }

        doc.setDrawColor(...GOLD);
        doc.setLineWidth(0.6);
        doc.line(marginX, 24, pageWidth - marginX, 24);
      };

      const drawFooter = (pageNumber, pageCount) => {
        const footerY = pageHeight - 10;
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.2);
        doc.line(marginX, footerY - 4, pageWidth - marginX, footerY - 4);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...SLATE);
        doc.text(`© ${year} The Nyali School. All rights reserved.`, marginX, footerY);

        doc.setFont("helvetica", "normal");
        doc.text("Finance Department — Confidential", pageWidth / 2, footerY, { align: "center" });
        doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - marginX, footerY, { align: "right" });
      };

      // --- Page 1 header + totals strip ---
      drawHeader();
      doc.setFillColor(...LIGHT);
      doc.roundedRect(marginX, 28, pageWidth - marginX * 2, 10, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...NAVY);
      doc.text(`Total Collected: KES ${currency(totalAmount)}`, marginX + 4, 34.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...SLATE);
      doc.text(
        `Across ${rows.length} payment${rows.length !== 1 ? "s" : ""}`,
        pageWidth - marginX - 4,
        34.5,
        { align: "right" }
      );

      if (filters.date_from || filters.date_to) {
        doc.text(
          `Date range: ${filters.date_from || "..."} to ${filters.date_to || "..."}`,
          14,
          32
        );
      }

      const tableColumn = [
        "Date",
        "Admission",
        "Student Name",
        "Class",
        "Term",
        "Amount (KES)",
        "Method",
        "Reference",
        "Recorded By",
      ];

      const tableRows = rows.map((p) => [
        p.paid_at ? new Date(p.paid_at).toLocaleDateString("en-KE") : "-",
        p.admission_no,
        p.student_name,
        p.classroom || "-",
        p.term || "-",
        currency(p.amount),
        METHOD_LABEL[p.method] || p.method,
        p.reference || "-",
        p.recorded_by_name || "-",
      ]);

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 42,
        margin: { left: marginX, right: marginX, top: 28, bottom: 16 },
        styles: {
          fontSize: 8,
          cellPadding: 3,
          textColor: SLATE,
          lineColor: [226, 232, 240],
          lineWidth: 0.1,
        },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 5: { halign: "right", fontStyle: "bold", textColor: GREEN } },
        didDrawPage: (data) => {
          // Repeat the branded header on every page after the first
          if (data.pageNumber > 1) drawHeader();
        },
      });

      // Copyright footer + page numbers on every page, drawn last so the
      // final page count is known.
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        drawFooter(i, pageCount);
      }

      const stamp = new Date().toISOString().slice(0, 10);
      doc.save(`payments_report_${stamp}.pdf`);
    } catch (error) {
      console.error("Failed to export PDF:", error);
    } finally {
      setExportingPdf(false);
    }
  };

  const receiptBalance = receipt ? describeBalance(receipt.balance) : null;
  const receiptBalanceClass =
    receiptBalance?.tone === "owing" ? "text-owe" : receiptBalance?.tone === "credit" ? "text-ok" : "";

  // The six tabs, in the same order as before
  const TABS = [
    { key: "payment", label: "Payment", icon: "bi-cash-coin" },
    { key: "payments", label: "Payments", icon: "bi-clock-history", count: count },
    { key: "split", label: "Split Payment", icon: "bi-diagram-2" },
    { key: "correct", label: "Correct Receipt", icon: "bi-pencil-square" },
    { key: "alumni", label: "Alumni Balance", icon: "bi-mortarboard" },
    { key: "other", label: "Other Payments", icon: "bi-bag-check" },
  ];

  // Latest few payments shown under the payment form
  const recentPayments = payments.slice(0, 5);

  return (
    <div>
      {/* ================= PAGE HEADER ================= */}
      <div className="page-header">
        <div className="page-header__lead">
          <span className="page-header__icon" aria-hidden="true">
            <i className="bi bi-credit-card"></i>
          </span>
          <div className="page-header__text">
            <h1 className="page-title">Payments</h1>
            <p className="page-subtitle">Record and manage all fee payments made by students</p>
          </div>
        </div>
        <div className="page-header__actions">
          <span className="chip">
            <i className="bi bi-cash-stack"></i>
            {count} payment{count !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {message && (
        <div className={`alert alert-${messageType} alert-dismissible fade show`} role="alert">
          {message}
          <button type="button" className="btn-close" onClick={() => setMessage("")}></button>
        </div>
      )}

      {/* ================= TABS ================= */}
      <div className="page-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={`page-tab${activeTab === t.key ? " is-active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            <i className={`bi ${t.icon}`} aria-hidden="true"></i>
            <span>{t.label}</span>
            {t.count !== undefined && <span>({t.count})</span>}
          </button>
        ))}
      </div>

      {activeTab === "payment" && (
        <>
          <section className="page-card">
            {/* ================= STEP 1: FIND + SELECT STUDENT ================= */}
            <form className="search-bar" onSubmit={searchStudentNow}>
              <div className="search-bar__field">
                <i className="bi bi-search" aria-hidden="true"></i>
                <input
                  className="form-control"
                  placeholder="Search student by admission number or name..."
                  aria-label="Search student by admission number or name"
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                  autoFocus
                />
                {studentQuery && (
                  <button type="button" className="search-bar__clear" onClick={clearStudentSearch} aria-label="Clear search">
                    <i className="bi bi-x-lg"></i>
                  </button>
                )}
              </div>
              <button type="submit" className="btn btn-primary" disabled={studentSearchLoading}>
                {studentSearchLoading ? (
                  <span className="spinner-border spinner-border-sm"></span>
                ) : (
                  <i className="bi bi-search"></i>
                )}
                Search
              </button>
              <button type="button" className="btn btn-secondary" onClick={clearStudentSearch}>
                Clear
              </button>
            </form>

            {/* search state */}
            <div style={PAD}>
              {studentSearchLoading && (
                <div className="d-flex align-items-center text-muted-soft" style={{ fontSize: "var(--fs-sm)" }}>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Searching...
                </div>
              )}

              {!studentSearchLoading && !debouncedStudentQuery && (
                <div className="empty-state py-3">
                  <i className="bi bi-person-lines-fill"></i>
                  <h6>Find a student</h6>
                  <p className="text-muted-soft mb-0">
                    Start typing an admission number or student name to bring up their fee balance. The payment is
                    applied to their oldest unpaid term first, and anything above the total balance is saved as
                    credit for the next term.
                  </p>
                </div>
              )}

              {!studentSearchLoading && debouncedStudentQuery && studentSearchError && (
                <div className="alert alert-warning mb-0">
                  <i className="bi bi-info-circle me-1"></i>
                  {studentSearchError}
                </div>
              )}

              {!studentSearchLoading && studentResults.length > 1 && (
                <>
                  <div className="section-label mb-2">Select the student to pay for</div>
                  <div className="pick-list">
                    {studentResults.map((s) => {
                      const isSelected = selectedAdmission === s.admission_no;
                      return (
                        <button
                          key={s.admission_no}
                          type="button"
                          onClick={() => setSelectedAdmission(isSelected ? null : s.admission_no)}
                          className={`pick-item ${isSelected ? "is-selected" : ""}`}
                        >
                          <span>
                            <span className="pick-item__adm">{s.admission_no}</span>
                            <span className="cell-name">{s.student_name}</span>
                          </span>
                          {isSelected && <i className="bi bi-check-circle-fill"></i>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ================= SELECTED STUDENT: person + fee summary ================= */}
            {!studentSearchLoading && selectedStudent && (
              <>
                <div className="person-card">
                  <span className="avatar avatar-xl" aria-hidden="true">
                    {initialsOf(selectedStudent.student_name)}
                  </span>
                  <div>
                    <div className="person-card__name">
                      {selectedStudent.student_name}
                      {selectedTotalOwed > 0 ? (
                        <span className="status-pill status-pill--warning">Balance due</span>
                      ) : selectedTotalOwed < 0 ? (
                        <span className="status-pill status-pill--success">In credit</span>
                      ) : (
                        <span className="status-pill status-pill--success">Fully paid</span>
                      )}
                    </div>
                    <div className="person-card__meta">
                      <span>
                        {selectedStudent.admission_no}
                        {selectedLatestInvoice?.grade_level_name ? ` • ${selectedLatestInvoice.grade_level_name}` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="person-card__summary">
                    <h6 className="panel__title mb-2">Fee Summary</h6>
                    <div className="kv-row">
                      <span>Total Due:</span>
                      <span>KES {currency(selectedLatestInvoice?.amount_due)}</span>
                    </div>
                    <div className="kv-row">
                      <span>Paid:</span>
                      <span>KES {currency(selectedLatestInvoice?.amount_paid)}</span>
                    </div>
                    <div className="kv-row kv-row--accent">
                      <span>{selectedTotalOwed < 0 ? "Credit (prepaid):" : "Balance:"}</span>
                      <span>KES {currency(Math.abs(selectedTotalOwed))}</span>
                    </div>
                  </div>
                </div>

                {/* term-by-term breakdown (kept from the old design) */}
                {selectedStudent.invoices.length > 1 && (
                  <div style={PAD}>
                    <div className="table-wrap">
                      <div className="table-responsive">
                        <table className="table table-sm mb-0">
                          <thead>
                            <tr>
                              <th>Term</th>
                              <th>Class</th>
                              <th className="text-end">Term Fee</th>
                              <th className="text-end">Brought Fwd</th>
                              <th className="text-end">Paid</th>
                              <th className="text-end">Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedStudent.invoices.map((inv) => {
                              // Each invoice's balance already CONTAINS what was brought forward
                              // from earlier terms, so only the latest invoice's balance is the
                              // real amount owed. Older rows are shown as "carried forward" so the
                              // same arrears are never counted twice.
                              const isLatest = selectedLatestInvoice && inv.id === selectedLatestInvoice.id;
                              const ownFee = inv.term_charge ?? Number(inv.amount_due) - Number(inv.brought_forward || 0);
                              return (
                                <tr key={inv.id} className={isLatest ? "" : "text-muted"}>
                                  <td>{inv.term_label}</td>
                                  <td>{inv.grade_level_name}</td>
                                  <td className="cell-num">KES {currency(ownFee)}</td>
                                  <td className="cell-num">KES {currency(inv.brought_forward)}</td>
                                  <td className="cell-num text-ok">KES {currency(inv.amount_paid)}</td>
                                  <td className={`cell-num ${isLatest ? "fw-bold" : ""}`}>
                                    {isLatest ? (
                                      `KES ${currency(inv.balance)}`
                                    ) : Number(inv.balance) > 0 ? (
                                      <span title="This balance has been carried into a later term's invoice">
                                        carried forward
                                      </span>
                                    ) : (
                                      `KES ${currency(inv.balance)}`
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <th colSpan={5} className="text-end">Total outstanding</th>
                              <th className="cell-num text-owe">KES {currency(selectedTotalOwed)}</th>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* ================= STEP 2: PAYMENT DETAILS (inline) ================= */}
                {payingBalance && (
                  <form className="split-grid" onSubmit={requestConfirmation}>
                    {/* left: payment details */}
                    <div className="panel">
                      <div className="panel__head">
                        <i className="bi bi-credit-card-2-front" aria-hidden="true"></i>
                        <h6 className="panel__title">Payment Details</h6>
                      </div>

                      {paymentError && <div className="alert alert-danger">{paymentError}</div>}

                      <label className="form-label">
                        Payment Method <span className="req">*</span>
                      </label>
                      <div className="option-grid">
                        {Object.keys(METHOD_LABEL).map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`option-card${paymentDraft.method === m ? " is-selected" : ""}`}
                            aria-pressed={paymentDraft.method === m}
                            onClick={() => setPaymentDraft({ ...paymentDraft, method: m })}
                          >
                            <i className={`bi ${METHOD_ICON[m]}`} aria-hidden="true"></i>
                            {METHOD_LABEL[m]}
                          </button>
                        ))}
                      </div>

                      <label className="form-label">
                        Amount Received <span className="req">*</span>
                      </label>
                      <div className="input-icon-group">
                        <input
                          type="number"
                          className="form-control cell-mono"
                          style={{ paddingLeft: "0.8rem", paddingRight: "4.5rem" }}
                          required
                          min="0.01"
                          step="0.01"
                          value={paymentDraft.amount}
                          onChange={(e) => setPaymentDraft({ ...paymentDraft, amount: e.target.value })}
                        />
                        <span className="input-suffix">KES</span>
                      </div>
                      {excessOverBalance > 0 ? (
                        <div className="form-text-hint text-ok">
                          <i className="bi bi-info-circle me-1"></i>
                          KES {currency(excessOverBalance)} above the balance will be saved as credit and
                          automatically applied to this student's next term invoice.
                        </div>
                      ) : activeBalanceDue <= 0 ? (
                        <div className="form-text-hint text-ok">
                          <i className="bi bi-info-circle me-1"></i>
                          This student has no balance{activeBalanceDue < 0 ? ` (already KES ${currency(-activeBalanceDue)} in credit)` : ""}.
                          Enter an advance amount - it will be saved as credit and deducted from their next term's invoice.
                        </div>
                      ) : (
                        <div className="form-text-hint">
                          Balance due: KES {currency(activeBalanceDue)}. Leave as-is to clear everything owed, or edit
                          for a partial payment.
                        </div>
                      )}

                      <label className="form-label mt-3">Reference</label>
                      <input
                        className="form-control"
                        placeholder="M-Pesa code / receipt no. (optional)"
                        value={paymentDraft.reference}
                        onChange={(e) => setPaymentDraft({ ...paymentDraft, reference: e.target.value })}
                      />
                    </div>

                    {/* right: tinted action panel */}
                    <div className="panel panel--tint d-flex flex-column">
                      <div className="panel__head">
                        <i className={`bi ${METHOD_ICON[paymentDraft.method]}`} aria-hidden="true"></i>
                        <div>
                          <h6 className="panel__title">{METHOD_LABEL[paymentDraft.method]} Payment</h6>
                          <p className="panel__text">
                            Click the button below to record the payment of{" "}
                            <strong>KES {currency(amountNumber)}</strong> received from{" "}
                            <strong>{payingBalance.student_name}</strong> via{" "}
                            <strong>{METHOD_LABEL[paymentDraft.method]}</strong>. It is applied to the oldest unpaid
                            term first.
                          </p>
                        </div>
                      </div>

                      {amountNumber > 0 && amountNumber < activeBalanceDue && (
                        <div className="form-text-hint text-gold mt-0 mb-2">
                          <i className="bi bi-info-circle me-1"></i>
                          Partial payment: KES {currency(activeBalanceDue - amountNumber)} will remain unpaid.
                        </div>
                      )}

                      <div className="mt-auto">
                        <button type="submit" className="btn btn-primary btn-lg w-100" disabled={recording}>
                          <i className={`bi ${METHOD_ICON[paymentDraft.method]}`} aria-hidden="true"></i>
                          Record Payment via {METHOD_LABEL[paymentDraft.method]}
                        </button>
                        <button
                          type="button"
                          className="btn btn-link w-100 mt-1"
                          onClick={resetPaymentForm}
                          disabled={recording}
                        >
                          Reset form
                        </button>
                        <div className="panel__note">
                          <i className="bi bi-info-circle" aria-hidden="true"></i>
                          You will review the amount once more before it is saved.
                        </div>
                      </div>
                    </div>
                  </form>
                )}
              </>
            )}

            {/* ================= STEP 3: RECEIPT ================= */}
            {(receipt || receiptLoading) && (
              <div className="page-card__section">
                <div className="receipt-hero">
                  <div className="modal-icon-circle modal-icon-circle--success">
                    <i className="bi bi-receipt-cutoff"></i>
                  </div>
                  <div>
                    <h6 className="panel-title">Receipt</h6>
                    <div className="chart-card__subtitle">Payment recorded successfully</div>
                  </div>
                </div>

                {receiptLoading && (
                  <div className="d-flex align-items-center text-muted-soft">
                    <span className="spinner-border spinner-border-sm me-2"></span>
                    Preparing receipt...
                  </div>
                )}

                {receipt && !receiptLoading && (
                  <div className="row g-4 align-items-start">
                    <div className="col-md-8">
                      <div className="profile-info-row">
                        <span>Receipt No.</span>
                        <span className="cell-mono">{receipt.receipt_no}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Student</span>
                        <span>
                          {receipt.student_name} ({receipt.admission_no})
                        </span>
                      </div>
                      <div className="profile-info-row">
                        <span>Current Class</span>
                        <span>{receipt.classroom || "-"}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Term</span>
                        <span>{receipt.term}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Amount Paid</span>
                        <span className="cell-mono text-ok">KES {currency(receipt.amount)}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>{receiptBalance.label}</span>
                        <span className={`cell-mono ${receiptBalanceClass}`}>{receiptBalance.value}</span>
                      </div>

                      {receipt.allocations?.length > 1 && (
                        <div className="profile-info-row d-block">
                          <div className="section-label mb-2">Applied to</div>
                          <table className="table table-sm mb-0">
                            <tbody>
                              {receipt.allocations.map((a, i) => (
                                <tr key={i}>
                                  <td>{a.term}</td>
                                  <td className="cell-num">KES {currency(a.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="profile-info-row">
                        <span>Method</span>
                        <span>
                          <span className={`badge ${METHOD_BADGE[receipt.method] || "badge-neutral"}`}>
                            <i className={`bi ${METHOD_ICON[receipt.method] || "bi-credit-card"} me-1`}></i>
                            {METHOD_LABEL[receipt.method] || receipt.method}
                          </span>
                        </span>
                      </div>
                      <div className="profile-info-row">
                        <span>Reference</span>
                        <span className="cell-mono">{receipt.reference || "-"}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Recorded By</span>
                        <span>{receipt.recorded_by_name || "-"}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Date</span>
                        <span>{new Date(receipt.paid_at).toLocaleString("en-KE")}</span>
                      </div>

                      {receipt.excess > 0 && (
                        <div className="alert alert-success mt-3 mb-0">
                          <i className="bi bi-piggy-bank me-1"></i>
                          KES {currency(receipt.excess)} was paid above the balance and has been carried forward
                          as credit toward the student's next invoice.
                        </div>
                      )}

                      <div className="d-flex flex-wrap gap-2 mt-3">
                        <button type="button" className="btn btn-success" onClick={() => downloadReceiptPdf(receipt)}>
                          <i className="bi bi-file-earmark-pdf"></i>
                          Download Receipt (PDF)
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handlePrintPaymentReceipt({ id: receipt.payment_id })}
                          disabled={printingReceiptId === receipt.payment_id}
                        >
                          {printingReceiptId === receipt.payment_id ? (
                            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                          ) : (
                            <i className="bi bi-printer"></i>
                          )}
                          Print Receipt
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setReceipt(null)}>
                          Dismiss
                        </button>
                      </div>
                    </div>

                    {receipt.qr_code_base64 && (
                      <div className="col-md-4 text-center">
                        <img
                          className="receipt-qr"
                          src={`data:image/png;base64,${receipt.qr_code_base64}`}
                          alt="Receipt verification QR code"
                        />
                        <div className="form-text-hint">Scan to verify this receipt</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ================= RECENT TRANSACTIONS ================= */}
          <section className="page-card">
            <div className="page-card__body" style={{ paddingBottom: 0 }}>
              <h6 className="page-card__title">
                <span>
                  <i className="bi bi-clock-history" aria-hidden="true"></i>
                  Recent Transactions
                </span>
                <button type="button" className="page-card__link" onClick={() => setActiveTab("payments")}>
                  View All <i className="bi bi-arrow-right" aria-hidden="true"></i>
                </button>
              </h6>
            </div>

            {listLoading ? (
              <TableSkeleton rows={3} columns={7} />
            ) : recentPayments.length === 0 ? (
              <div className="empty-state py-3">
                <i className="bi bi-cash-stack"></i>
                <p className="text-muted-soft mb-0">No payments have been recorded yet.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th>Date &amp; Time</th>
                        <th>Student</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Reference</th>
                        <th className="text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPayments.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.paid_at
                              ? new Date(p.paid_at).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })
                              : "-"}
                          </td>
                          <td>
                            <div className="table-avatar-cell">
                              <div className="avatar-sm">{initialsOf(p.student_name)}</div>
                              <span className="cell-name">{p.student_name}</span>
                            </div>
                          </td>
                          <td className="fw-semibold">KES {currency(p.amount)}</td>
                          <td>
                            <span className={`badge ${METHOD_BADGE[p.method] || "badge-neutral"}`}>
                              <i className={`bi ${METHOD_ICON[p.method] || "bi-credit-card"} me-1`}></i>
                              {METHOD_LABEL[p.method] || p.method}
                            </span>
                          </td>
                          <td>
                            <span className="status-pill status-pill--success">Completed</span>
                          </td>
                          <td className="cell-mono">{p.reference || <span className="cell-muted">-</span>}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                title="Print this receipt"
                                onClick={() => handlePrintPaymentReceipt(p)}
                                disabled={printingReceiptId === p.id}
                              >
                                {printingReceiptId === p.id ? (
                                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                                ) : (
                                  <i className="bi bi-printer"></i>
                                )}
                                Print
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ================= STEP 2b: VERIFY TRANSACTION (BANK-STYLE POPUP) ================= */}
          {payingBalance && showConfirm && (
            <div
              className="modal fade show d-block modal-scrim modal-scrim--top verify-modal"
              tabIndex="-1"
              role="dialog"
              aria-modal="true"
            >
              <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                  <div className="modal-header">
                    <span className="modal-header__icon" aria-hidden="true">
                      <i className="bi bi-shield-check" style={{ color: "var(--warning-600)" }}></i>
                    </span>
                    <div className="modal-header__text">
                      <h6 className="modal-title">Review Transaction</h6>
                      <p className="modal-subtitle">Please verify the amount received before proceeding</p>
                    </div>
                  </div>

                  <div className="modal-body">
                    <div className="amount-hero">
                      <div className="amount-hero__label">Amount Received</div>
                      <div className="amount-hero__value">KES {currency(amountNumber)}</div>
                    </div>

                    <div className="tx-box">
                      <div className="profile-info-row">
                        <span>Student</span>
                        <span>{payingBalance.student_name}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Admission No</span>
                        <span className="cell-mono">{payingBalance.admission_no}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Payment Method</span>
                        <span>{METHOD_LABEL[paymentDraft.method]}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Reference</span>
                        <span className="cell-mono">{paymentDraft.reference || "-"}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>Balance Before</span>
                        <span className="cell-mono">KES {currency(activeBalanceDue)}</span>
                      </div>
                      <div className="profile-info-row">
                        <span>{balanceAfterPayment < 0 ? "Credit After Payment" : "Balance After"}</span>
                        <span
                          className={`cell-mono ${
                            balanceAfterPayment > 0 ? "text-owe" : balanceAfterPayment < 0 ? "text-ok" : ""
                          }`}
                        >
                          {balanceAfterPayment === 0
                            ? "KES 0 (Fully paid)"
                            : `KES ${currency(Math.abs(balanceAfterPayment))}`}
                        </span>
                      </div>
                    </div>

                    {excessOverBalance > 0 && (
                      <div className="mt-2 text-ok" style={{ fontSize: "var(--fs-sm)" }}>
                        <i className="bi bi-info-circle me-1"></i>
                        KES {currency(excessOverBalance)} above the balance will be saved as credit.
                      </div>
                    )}
                    {amountNumber < activeBalanceDue && (
                      <div className="mt-2 text-gold" style={{ fontSize: "var(--fs-sm)" }}>
                        <i className="bi bi-info-circle me-1"></i>
                        Partial payment: KES {currency(activeBalanceDue - amountNumber)} will remain unpaid.
                      </div>
                    )}

                    <div className="form-check confirm-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="confirmAmountVerified"
                        checked={confirmChecked}
                        disabled={recording}
                        onChange={(e) => setConfirmChecked(e.target.checked)}
                      />
                      <label className="form-check-label" htmlFor="confirmAmountVerified">
                        I have verified that KES {currency(amountNumber)} was received (cash count, M-Pesa
                        message or bank slip).
                      </label>
                    </div>
                  </div>

                  <div className="modal-footer">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={cancelConfirmation}
                      disabled={recording}
                    >
                      <i className="bi bi-arrow-left"></i>
                      Back
                    </button>
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={submitPayment}
                      disabled={!confirmChecked || recording}
                    >
                      {recording ? (
                        <>
                          <span className="spinner-border spinner-border-sm"></span>
                          Processing...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-check2-circle"></i>
                          Confirm &amp; Record
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "payments" && (
        <section className="page-card">
          {/* ---- Search + exports ---- */}
          <div className="search-bar">
            <div className="search-bar__field">
              <i className="bi bi-search" aria-hidden="true"></i>
              <input
                className="form-control"
                placeholder="Search student, adm no, receipt no..."
                aria-label="Search payments"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button type="button" className="search-bar__clear" onClick={() => setSearch("")} aria-label="Clear search">
                  <i className="bi bi-x-lg"></i>
                </button>
              )}
            </div>
            <button
              className="btn btn-secondary"
              onClick={downloadExcel}
              disabled={exportingExcel}
              type="button"
              title="Download Excel"
            >
              {exportingExcel ? (
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
              ) : (
                <>
                  <i className="bi bi-file-earmark-excel"></i>Excel
                </>
              )}
            </button>
            <button
              className="btn btn-secondary"
              onClick={downloadPdf}
              disabled={exportingPdf}
              type="button"
              title="Download PDF"
            >
              {exportingPdf ? (
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
              ) : (
                <>
                  <i className="bi bi-file-earmark-pdf"></i>PDF
                </>
              )}
            </button>
            {hasActiveFilters && (
              <button className="btn btn-secondary" onClick={clearFilters} type="button" title="Clear filters">
                <i className="bi bi-x-lg"></i> Clear
              </button>
            )}
          </div>

          {/* ---- Filters ---- */}
          <div className="search-bar" style={{ paddingTop: 0 }}>
            <select
              className="form-select"
              title="Academic Year"
              aria-label="Academic Year"
              value={filters.invoice__enrollment__academic_year}
              onChange={(e) => updateFilter("invoice__enrollment__academic_year", e.target.value)}
            >
              <option value="">Year</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.year}
                </option>
              ))}
            </select>

            <select
              className="form-select"
              title="Grade"
              aria-label="Grade"
              value={filters.invoice__enrollment__classroom__grade_level}
              onChange={(e) => updateFilter("invoice__enrollment__classroom__grade_level", e.target.value)}
            >
              <option value="">Grade</option>
              {gradeLevels.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <select
              className="form-select"
              title="Stream"
              aria-label="Stream"
              value={filters.invoice__enrollment__classroom__stream}
              onChange={(e) => updateFilter("invoice__enrollment__classroom__stream", e.target.value)}
            >
              <option value="">Stream</option>
              {streams.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              className="form-select"
              title="Term"
              aria-label="Term"
              value={filters.invoice__fee_structure__term}
              onChange={(e) => updateFilter("invoice__fee_structure__term", e.target.value)}
            >
              <option value="">Term</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.term_number ? `Term ${t.term_number}` : `Term #${t.id}`}
                </option>
              ))}
            </select>

            <select
              className="form-select"
              title="Method"
              aria-label="Method"
              value={filters.method}
              onChange={(e) => updateFilter("method", e.target.value)}
            >
              <option value="">Method</option>
              <option value="MPESA">M-Pesa</option>
              <option value="BANK">Bank</option>
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
            </select>

            <input
              type="date"
              className="form-control"
              style={{ width: "auto" }}
              title="From date"
              aria-label="From date"
              value={filters.date_from}
              max={filters.date_to || undefined}
              onChange={(e) => updateFilter("date_from", e.target.value)}
            />
            <span className="range-sep">&rarr;</span>
            <input
              type="date"
              className="form-control"
              style={{ width: "auto" }}
              title="To date"
              aria-label="To date"
              value={filters.date_to}
              min={filters.date_from || undefined}
              onChange={(e) => updateFilter("date_to", e.target.value)}
            />
          </div>

          {/* ---- Active filter chips ---- */}
          {hasActiveFilters && (
            <div className="chip-row">
              {search && (
                <span className="filter-chip">
                  Search: "{search}"
                  <button onClick={() => setSearch("")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
              {filters.invoice__enrollment__academic_year && (
                <span className="filter-chip">
                  Year:{" "}
                  {
                    academicYears.find(
                      (y) => String(y.id) === String(filters.invoice__enrollment__academic_year)
                    )?.year
                  }
                  <button onClick={() => updateFilter("invoice__enrollment__academic_year", "")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
              {filters.invoice__enrollment__classroom__grade_level && (
                <span className="filter-chip">
                  Grade:{" "}
                  {
                    gradeLevels.find(
                      (g) => String(g.id) === String(filters.invoice__enrollment__classroom__grade_level)
                    )?.name
                  }
                  <button onClick={() => updateFilter("invoice__enrollment__classroom__grade_level", "")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
              {filters.invoice__enrollment__classroom__stream && (
                <span className="filter-chip">
                  Stream:{" "}
                  {
                    streams.find(
                      (s) => String(s.id) === String(filters.invoice__enrollment__classroom__stream)
                    )?.name
                  }
                  <button onClick={() => updateFilter("invoice__enrollment__classroom__stream", "")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
              {filters.invoice__fee_structure__term && (
                <span className="filter-chip">
                  Term:{" "}
                  {
                    terms.find((t) => String(t.id) === String(filters.invoice__fee_structure__term))
                      ?.term_number
                  }
                  <button onClick={() => updateFilter("invoice__fee_structure__term", "")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
              {filters.method && (
                <span className="filter-chip">
                  Method: {METHOD_LABEL[filters.method] || filters.method}
                  <button onClick={() => updateFilter("method", "")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
              {filters.date_from && (
                <span className="filter-chip">
                  From: {filters.date_from}
                  <button onClick={() => updateFilter("date_from", "")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
              {filters.date_to && (
                <span className="filter-chip">
                  To: {filters.date_to}
                  <button onClick={() => updateFilter("date_to", "")}>
                    <i className="bi bi-x"></i>
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="table-wrap__header" style={{ borderTop: "1px solid var(--border-color)" }}>
            <span className="panel-title">
              <i className="bi bi-clock-history text-brand"></i>
              Payment History
            </span>
            <span className="chart-card__subtitle">
              {count} payment{count !== 1 ? "s" : ""} found
            </span>
          </div>

          {listLoading ? (
            <TableSkeleton rows={5} columns={11} />
          ) : payments.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-cash-stack"></i>
              <h6>No payments found</h6>
              <p className="text-muted-soft">
                {hasActiveFilters
                  ? "No payments match your filters. Try adjusting your search criteria."
                  : "No payments have been recorded yet."}
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Receipt No</th>
                      <th>Admission No</th>
                      <th>Student</th>
                      <th>Class</th>
                      <th>Term</th>
                      <th className="text-end">Amount</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th>Recorded By</th>
                      <th className="text-center">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="cell-muted">
                          {p.paid_at ? new Date(p.paid_at).toLocaleDateString("en-KE") : "-"}
                        </td>
                        <td className="cell-mono fw-semibold">{p.receipt_no || <span className="cell-muted">-</span>}</td>
                        <td className="cell-mono text-brand fw-semibold">{p.admission_no}</td>
                        <td>
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">{initialsOf(p.student_name)}</div>
                            <span className="cell-name">{p.student_name}</span>
                          </div>
                        </td>
                        <td>{p.classroom ? <span className="chip">{p.classroom}</span> : "-"}</td>
                        <td>{p.term}</td>
                        <td className="cell-num fw-bold text-ok">KES {currency(p.amount)}</td>
                        <td>
                          <span className={`badge ${METHOD_BADGE[p.method] || "badge-neutral"}`}>
                            <i className={`bi ${METHOD_ICON[p.method] || "bi-credit-card"} me-1`}></i>
                            {METHOD_LABEL[p.method] || p.method}
                          </span>
                        </td>
                        <td className="cell-mono">{p.reference || <span className="cell-muted">-</span>}</td>
                        <td className="cell-muted">{p.recorded_by_name}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-icon"
                              title="Print this receipt"
                              aria-label="Print this receipt"
                              onClick={() => handlePrintPaymentReceipt(p)}
                              disabled={printingReceiptId === p.id}
                            >
                              {printingReceiptId === p.id ? (
                                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                              ) : (
                                <i className="bi bi-printer"></i>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!listLoading && payments.length > 0 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={(newPage) => loadPayments(newPage)}
              itemsPerPage={pageSize}
              setItemsPerPage={() => {}}
              startIndex={(page - 1) * pageSize}
              endIndex={Math.min(page * pageSize, count)}
              totalItems={count}
            />
          )}
        </section>
      )}

      {/* ================= FINANCE TOOLS ================= */}
      {activeTab === "split" && (
        <section className="page-card">
          <div className="page-card__body">
            <SplitPaymentPanel
              onMessage={handlePanelMessage}
              onPrint={handlePrintPaymentReceipt}
              onChanged={() => loadPayments(1)}
            />
          </div>
        </section>
      )}

      {activeTab === "correct" && (
        <section className="page-card">
          <div className="page-card__body">
            <CorrectReceiptPanel
              onMessage={handlePanelMessage}
              onPrint={handlePrintPaymentReceipt}
              onChanged={() => loadPayments(1)}
            />
          </div>
        </section>
      )}

      {activeTab === "alumni" && (
        <section className="page-card">
          <div className="page-card__body">
            <AlumniBalancePanel onMessage={handlePanelMessage} />
          </div>
        </section>
      )}

      {activeTab === "other" && (
        <section className="page-card">
          <div className="page-card__body">
            <OtherPaymentsPanel
              onMessage={handlePanelMessage}
              onPrintReceipt={printOtherReceipt}
              onDownloadReceipt={downloadOtherReceipt}
              printingId={printingOtherId}
            />
          </div>
        </section>
      )}
    </div>
  );
}