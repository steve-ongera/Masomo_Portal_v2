// Shared helpers for the meal pages.
// Styled to match the ERP design system in main.css — badge palette,
// progress-track/fill, form-label/form-control, and the page loader ring.

import { useCallback, useEffect, useState } from "react";
import logoImage from "../../assets/nyali_school_logo.png";

/* ==========================================================================
   CONSTANTS
   ========================================================================== */

export const MEALS = [
  ["BREAKFAST", "Breakfast"],
  ["MORNING_SNACK", "Morning Snack"],
  ["LUNCH", "Lunch"],
  ["AFTERNOON_SNACK", "Afternoon Snack"],
  ["SUPPER", "Supper"],
];

export const mealLabel = (v) =>
  (MEALS.find((m) => m[0] === v) || [])[1] || v;

export const today = () => new Date().toLocaleDateString("en-CA");

export const kes = (n) =>
  `KES ${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Classroom display name, e.g. "Grade 9 Blue".
// Tries, in order: a ready-made label from the API, then grade + stream built
// from whichever shape the serializer returns (flat *_name fields, nested
// objects, or plain strings), then a plain name. Only falls back to
// "Classroom #id" when none of those exist.
export const cname = (c) => {
  if (!c) return "";

  const pick = (v) =>
    typeof v === "string" ? v : v && typeof v === "object" ? v.name || "" : "";

  const ready = c.label || c.display_name || c.full_name;
  if (ready) return ready;

  const grade =
    c.grade_level_name ||
    c.grade_name ||
    pick(c.grade_level) ||
    pick(c.grade);
  const stream = c.stream_name || pick(c.stream);
  const built = `${grade || ""} ${stream || ""}`.trim();

  return built || c.name || `Classroom #${c.id}`;
};

export const list = (r) => r?.data?.results ?? r?.data ?? [];

export const errText = (e) => {
  const d = e?.response?.data;
  if (!d) return e?.message || "Something went wrong.";
  if (typeof d === "string") return d.slice(0, 300);
  if (d.detail) return d.detail;
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
    .join(" | ");
};

// Colour tokens pulled from the ERP palette so meal pages read the same as
// the rest of the app. Exported as `colors` for backwards compatibility.
export const colors = {
  ink: "var(--ink-900)",
  mute: "var(--ink-400)",
  line: "var(--border-color)",
  brand: "var(--blue-700)",
  bad: "var(--danger-600)",
  bg: "var(--bg-app)",
};

/* ==========================================================================
   printMealCards — prints meal cards in the same layout as the Fee Update
   Cards: 60 x 36 mm card inside a 64 x 40 mm cut cell, 3 columns x 7 rows
   (21 cards) per A4 page, with dashed cut lines between cells.
   ========================================================================== */

const CARDS_PER_PAGE = 3 * 7;
const MEAL_ACCENT = "#0f766e";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );

const fmtDate = (d) =>
  new Date(d || Date.now()).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const MEAL_CARD_CSS = `
*{box-sizing:border-box}
body{margin:0}
.fuc-page{display:grid;grid-template-columns:repeat(3,64mm);grid-auto-rows:40mm;justify-content:center;align-content:start;
  width:fit-content;margin:0 auto;border-top:0.2mm dashed #64748b;border-left:0.2mm dashed #64748b;
  break-after:page;page-break-after:always}
.fuc-page:last-child{break-after:auto;page-break-after:auto}
.fuc-cell{display:flex;align-items:center;justify-content:center;border-right:0.2mm dashed #64748b;border-bottom:0.2mm dashed #64748b}
.fuc-card{width:60mm;height:36mm;border:0.3mm solid #475569;border-radius:2mm;overflow:hidden;background:#fff;color:#0f172a;
  display:flex;flex-direction:column;font-family:Arial,Helvetica,sans-serif;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;break-inside:avoid}
.fuc-head{display:flex;align-items:center;gap:1mm;padding:0.8mm 1.6mm;border-bottom:0.2mm solid #e2e8f0}
.fuc-head img{height:5.6mm;width:auto}
.fuc-headtxt{min-width:0;flex:1}
.fuc-school{font-size:5.2pt;font-weight:800;line-height:1.1;white-space:nowrap}
.fuc-addr{font-size:3.8pt;color:#475569;line-height:1.1}
.fuc-status{flex:0 0 auto;color:#fff;font-size:4.2pt;font-weight:800;letter-spacing:0.1mm;padding:0.5mm 1.3mm;border-radius:0.6mm;white-space:nowrap;background:${MEAL_ACCENT}}
.fuc-title{background:#0f2947;color:#fff;text-align:center;font-size:4.2pt;font-weight:700;letter-spacing:0.15mm;padding:0.5mm 0}
.fuc-body{flex:1;display:flex;gap:1.5mm;padding:1mm 1.6mm;min-height:0}
.fuc-info{flex:1;min-width:0}
.fuc-name{font-size:6.2pt;font-weight:800;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fuc-meta{font-size:4.8pt;color:#334155;margin-bottom:0.9mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fuc-lbl{font-size:3.8pt;color:#64748b;text-transform:uppercase;letter-spacing:0.1mm}
.fuc-num{font-size:6.6pt;font-weight:800;line-height:1.2;margin-bottom:0.9mm;white-space:nowrap;color:${MEAL_ACCENT};
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.fuc-note{font-size:4.6pt;font-weight:700;color:#334155;line-height:1.25}
.fuc-qr{width:17mm;text-align:center;flex:0 0 17mm}
.fuc-qr img{width:17mm;height:17mm;display:block}
.fuc-qr div{font-size:3.6pt;color:#64748b;margin-top:0.3mm}
.fuc-foot{display:flex;justify-content:space-between;font-size:3.6pt;color:#64748b;padding:0.4mm 1.6mm;border-top:0.2mm solid #e2e8f0}
@page{size:A4 portrait;margin:6mm}
`;

export function printMealCards(cards, schoolName = "The Nyali School") {
  if (!cards?.length) return;

  // Absolute URL so the logo still resolves inside the new window.
  const logo = new URL(logoImage, window.location.href).href;

  const cardHtml = (c) => `
    <div class="fuc-cell">
      <div class="fuc-card">
        <div class="fuc-head">
          <img src="${esc(logo)}" alt="" />
          <div class="fuc-headtxt">
            <div class="fuc-school">${esc(schoolName)}</div>
            <div class="fuc-addr">P.O. Box 87073 Mombasa</div>
          </div>
          <div class="fuc-status">ACTIVE</div>
        </div>
        <div class="fuc-title">SCHOOL MEAL CARD</div>
        <div class="fuc-body">
          <div class="fuc-info">
            <div class="fuc-name">${esc(c.name)}</div>
            <div class="fuc-meta">Adm: <b>${esc(c.admission_no)}</b>${
    c.classroom ? ` &middot; ${esc(c.classroom)}` : ""
  }</div>
            <div class="fuc-lbl">Card no</div>
            <div class="fuc-num">${esc(c.card_number)}</div>
            <div class="fuc-lbl">Usage</div>
            <div class="fuc-note">Permanent card &mdash; present at every meal</div>
          </div>
          <div class="fuc-qr">
            <img src="data:image/png;base64,${c.qr_code_base64}" alt="QR" />
            <div>Scan to serve</div>
          </div>
        </div>
        <div class="fuc-foot">
          <span>Powered by Masomo Portal (www.masomoportal.com)</span>
          <span>Issued ${fmtDate(c.issued_at)}</span>
        </div>
      </div>
    </div>`;

  const pages = chunk(cards, CARDS_PER_PAGE)
    .map((p) => `<div class="fuc-page">${p.map(cardHtml).join("")}</div>`)
    .join("");

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(
    `<html><head><title>Meal cards</title><style>${MEAL_CARD_CSS}</style></head><body>${pages}</body></html>`
  );
  w.document.close();
  w.focus();
  // Give the logo a moment to load before printing.
  setTimeout(() => w.print(), 600);
}

/* ==========================================================================
   downloadMealCardsPdf — same layout as printMealCards, but saved straight
   to a PDF file (A4, 21 cards per page). Needs:  npm install jspdf
   ========================================================================== */

const hexRgb = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const loadLogo = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      cv.getContext("2d").drawImage(img, 0, 0);
      resolve({ data: cv.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });

export async function downloadMealCardsPdf(
  cards,
  schoolName = "The Nyali School",
  fileName = `meal-cards-${new Date().toLocaleDateString("en-CA")}.pdf`
) {
  if (!cards?.length) return;

  const { jsPDF } = await import("jspdf");
  const logo = await loadLogo(new URL(logoImage, window.location.href).href);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  const CW = 64;
  const CH = 40;
  const X0 = (210 - 3 * CW) / 2;
  const Y0 = 6;

  const fill = (h) => doc.setFillColor(...hexRgb(h));
  const stroke = (h) => doc.setDrawColor(...hexRgb(h));
  const ink = (h) => doc.setTextColor(...hexRgb(h));
  const font = (face, style, size) => {
    doc.setFont(face, style);
    doc.setFontSize(size);
  };
  const fit = (str, maxW) => {
    let s = String(str ?? "");
    if (doc.getTextWidth(s) <= maxW) return s;
    while (s.length > 1 && doc.getTextWidth(`${s}...`) > maxW) s = s.slice(0, -1);
    return `${s}...`;
  };

  chunk(cards, CARDS_PER_PAGE).forEach((pageCards, p) => {
    if (p > 0) doc.addPage();

    pageCards.forEach((c, i) => {
      const cellX = X0 + (i % 3) * CW;
      const cellY = Y0 + Math.floor(i / 3) * CH;

      // Dashed cut lines around the cell
      doc.setLineWidth(0.2);
      stroke("#64748b");
      doc.setLineDashPattern([0.8, 0.8], 0);
      doc.rect(cellX, cellY, CW, CH, "S");
      doc.setLineDashPattern([], 0);

      // Card body + border (60 x 36 mm)
      const x = cellX + 2;
      const y = cellY + 2;
      fill("#ffffff");
      stroke("#475569");
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, 60, 36, 2, 2, "FD");

      // Header: logo, school, status chip
      let textX = x + 1.6;
      if (logo) {
        const lh = 5.6;
        const lw = (lh * logo.w) / logo.h;
        doc.addImage(logo.data, "PNG", x + 1.6, y + 0.8, lw, lh);
        textX = x + 1.6 + lw + 1;
      }
      font("helvetica", "bold", 5.2);
      ink("#0f172a");
      doc.text(schoolName, textX, y + 3.3);
      font("helvetica", "normal", 3.8);
      ink("#475569");
      doc.text("P.O. Box 87073 Mombasa", textX, y + 5.2);

      font("helvetica", "bold", 4.2);
      const chipW = doc.getTextWidth("ACTIVE") + 2.6;
      const chipX = x + 60 - 1.6 - chipW;
      fill(MEAL_ACCENT);
      doc.roundedRect(chipX, y + 1.9, chipW, 2.8, 0.6, 0.6, "F");
      ink("#ffffff");
      doc.text("ACTIVE", chipX + 1.3, y + 3.85);

      // Header divider + navy title bar
      doc.setLineWidth(0.2);
      stroke("#e2e8f0");
      doc.line(x + 0.15, y + 7.2, x + 59.85, y + 7.2);
      fill("#0f2947");
      doc.rect(x + 0.15, y + 7.2, 59.7, 2.2, "F");
      font("helvetica", "bold", 4.2);
      ink("#ffffff");
      doc.text("SCHOOL MEAL CARD", x + 30, y + 8.8, { align: "center" });

      // Student details
      font("helvetica", "bold", 6.2);
      ink("#0f172a");
      doc.text(fit(String(c.name || "").toUpperCase(), 38), x + 1.6, y + 12.6);

      font("helvetica", "normal", 4.8);
      ink("#334155");
      const meta = `Adm: ${c.admission_no ?? ""}${c.classroom ? `  \u00B7  ${c.classroom}` : ""}`;
      doc.text(fit(meta, 38), x + 1.6, y + 14.8);

      font("helvetica", "normal", 3.8);
      ink("#64748b");
      doc.text("CARD NO", x + 1.6, y + 17.4);
      font("courier", "bold", 6.6);
      ink(MEAL_ACCENT);
      doc.text(fit(c.card_number, 38), x + 1.6, y + 20.3);

      font("helvetica", "normal", 3.8);
      ink("#64748b");
      doc.text("USAGE", x + 1.6, y + 23.2);
      font("helvetica", "bold", 4.6);
      ink("#334155");
      doc.text("Permanent card - present at every meal", x + 1.6, y + 25.4);

      // QR code
      if (c.qr_code_base64) {
        doc.addImage(
          `data:image/png;base64,${c.qr_code_base64}`,
          "PNG",
          x + 60 - 1.6 - 17,
          y + 10.4,
          17,
          17
        );
      }
      font("helvetica", "normal", 3.6);
      ink("#64748b");
      doc.text("Scan to serve", x + 60 - 1.6 - 8.5, y + 29, { align: "center" });

      // Footer
      doc.setLineWidth(0.2);
      stroke("#e2e8f0");
      doc.line(x + 0.15, y + 33.6, x + 59.85, y + 33.6);
      font("helvetica", "normal", 3.6);
      ink("#64748b");
      doc.text("Powered by Masomo Portal (www.masomoportal.com)", x + 1.6, y + 35.1);
      doc.text(`Issued ${fmtDate(c.issued_at)}`, x + 60 - 1.6, y + 35.1, {
        align: "right",
      });
    });
  });

  doc.save(fileName);
}

/* ==========================================================================
   useLoad — one fetch per invocation, keyed on deps
   ========================================================================== */

export function useLoad(fn, deps = []) {
  const [state, set] = useState({ data: null, loading: true, error: "" });

  const run = useCallback(async () => {
    set((s) => ({ ...s, loading: true, error: "" }));
    try {
      const data = await fn();
      set({ data, loading: false, error: "" });
    } catch (e) {
      set({
        data: null,
        loading: false,
        error: e?.response?.data?.detail || e.message || "Failed to load.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}

/* ==========================================================================
   Page — wrapper with title + subtitle + optional action buttons
   Renders the same .page-header / .page-title / .page-subtitle block used
   across every other page in the ERP.
   ========================================================================== */

export function Page({ title, subtitle, actions, children }) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && (
          <div className="d-flex gap-2 flex-wrap">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/* ==========================================================================
   Card — .table-wrap shell with optional header
   ========================================================================== */

export function Card({ title, children, style }) {
  return (
    <div className="table-wrap" style={style}>
      {title && (
        <div className="table-wrap__header">
          <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
            {title}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

/* ==========================================================================
   Btn — .btn with the ERP colour variants
   ========================================================================== */

export function Btn({ kind = "primary", ...p }) {
  const cls =
    kind === "danger"
      ? "btn btn-outline-danger"
      : kind === "ghost"
      ? "btn btn-outline-primary"
      : kind === "secondary"
      ? "btn btn-secondary"
      : kind === "success"
      ? "btn btn-success"
      : "btn btn-primary";
  return <button type="button" {...p} className={cls} />;
}

/* ==========================================================================
   Field / Input / Select / Row — thin wrappers around the ERP form classes
   ========================================================================== */

export function Field({ label, children }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

export function Input({ style, ...p }) {
  return <input {...p} className="form-control" style={style} />;
}

export function Select({ children, style, ...p }) {
  return (
    <select {...p} className="form-select" style={style}>
      {children}
    </select>
  );
}

export function Row({ children, style }) {
  return (
    <div
      className="d-flex flex-wrap align-items-end"
      style={{ gap: "0.75rem", ...style }}
    >
      {children}
    </div>
  );
}

/* ==========================================================================
   Notice — alert-success or alert-danger
   ========================================================================== */

export function Notice({ kind = "error", children }) {
  if (!children) return null;
  const ok = kind === "ok";
  return (
    <div
      className={`alert ${ok ? "alert-success" : "alert-danger"} mt-2 mb-2`}
      role="alert"
    >
      <i
        className={`bi ${
          ok ? "bi-check2-circle" : "bi-exclamation-triangle"
        } me-1`}
      ></i>
      {children}
    </div>
  );
}

/* ==========================================================================
   Table — .table-wrap + .table with the ERP header/row treatment
   `head` is an array of column labels, `rows` is an array of arrays of cells.
   ========================================================================== */

export function Table({ head, rows, empty = "Nothing to show." }) {
  return (
    <div className="table-responsive">
      <table className="table table-hover mb-0">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={head.length}
                style={{
                  padding: "2rem 1rem",
                  textAlign: "center",
                  color: "var(--ink-400)",
                  fontSize: "var(--fs-xs)",
                }}
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} style={{ fontSize: "var(--fs-xs)" }}>
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ==========================================================================
   Badge — ERP badge palette
   ========================================================================== */

const BADGE_TONE = {
  mute: "badge-neutral",
  neutral: "badge-neutral",
  ok: "badge-success",
  success: "badge-success",
  bad: "badge-danger",
  danger: "badge-danger",
  warn: "badge-gold",
  warning: "badge-gold",
  info: "badge-blue",
  blue: "badge-blue",
};

export function Badge({ children, tone = "mute" }) {
  const cls = BADGE_TONE[tone] || "badge-neutral";
  return <span className={`badge ${cls}`}>{children}</span>;
}

/* ==========================================================================
   MealPageSkeleton — a card-shaped loading placeholder
   ========================================================================== */

export function MealPageSkeleton({ rows = 5 }) {
  return (
    <div className="table-wrap">
      <div className="p-3">
        {[...Array(rows)].map((_, i) => (
          <div
            key={i}
            className="skeleton skeleton-text"
            style={{ width: `${60 + (i % 3) * 10}%`, marginBottom: "0.6rem" }}
          ></div>
        ))}
      </div>
    </div>
  );
}