import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import logoImage from "../../assets/nyali_school_logo.png";

// CR80 card 85.6 x 54 mm, in a 90 x 56 mm cut cell. 2 columns x 5 rows = 10 cards per A4 page.
export const COLS = 2;
export const ROWS = 5;
const PER_PAGE = COLS * ROWS;

export const fmtDate = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/*
 * Palette (taken from the reference design)
 *   blue   #0b3d9c  side band, QR frame
 *   navy   #0f2557  name + values
 *   orange #f26a1b  accents
 *   grey   #64748b  labels
 */
export const ID_CARD_CSS = `
.sid-page { display:grid; grid-template-columns:repeat(2,90mm); grid-auto-rows:56mm; justify-content:center; align-content:start;
  width:fit-content; margin:0 auto; border-top:0.2mm dashed #64748b; border-left:0.2mm dashed #64748b; }
.sid-cell { box-sizing:border-box; display:flex; align-items:center; justify-content:center;
  border-right:0.2mm dashed #64748b; border-bottom:0.2mm dashed #64748b; }

.sid-card { position:relative; width:85.6mm; height:54mm; box-sizing:border-box; border:0.25mm solid #cbd5e1; border-radius:3mm; overflow:hidden;
  background:#fff; color:#0f2557; font-family:Arial,Helvetica,sans-serif; padding-left:9mm;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; break-inside:avoid; }

/* left band with vertical title + orange slash */
.sid-band { position:absolute; left:0; top:0; bottom:0; width:9mm; background:#0b3d9c; display:flex; align-items:center; justify-content:center; }
.sid-band span { writing-mode:vertical-rl; transform:rotate(180deg); color:#fff; font-size:7.5pt; font-weight:800; letter-spacing:0.9mm; white-space:nowrap; }
.sid-slash { position:absolute; left:0; bottom:7mm; width:9mm; height:5.5mm; background:#f26a1b; clip-path:polygon(0 35%, 100% 0, 100% 65%, 0 100%); }

/* header */
.sid-head { display:flex; align-items:center; gap:2mm; height:10mm; padding:0 3mm 0 2.5mm; box-sizing:border-box; }
.sid-head img { height:7.5mm; width:auto; }
.sid-school { font-size:8pt; font-weight:800; letter-spacing:0.35mm; line-height:1.05; color:#0f2557; }
.sid-sub { font-size:4.4pt; letter-spacing:0.5mm; color:#f26a1b; margin-top:0.5mm; font-weight:700; }

/* body */
.sid-photo { position:absolute; left:11.5mm; top:11.5mm; width:24mm; height:30mm; border-radius:2mm; overflow:hidden;
  background:#e2e8f0; border-right:0.7mm solid #f26a1b; box-sizing:border-box;
  display:flex; align-items:center; justify-content:center; font-size:5pt; color:#94a3b8; }
.sid-photo img { width:100%; height:100%; object-fit:cover; }

.sid-main { position:absolute; left:38.5mm; right:3mm; top:11mm; }
.sid-name { font-size:8pt; font-weight:800; line-height:1.1; text-transform:uppercase; max-height:6.6mm; overflow:hidden; }
.sid-rows { margin-right:18mm; }
.sid-role { font-size:5pt; font-weight:700; letter-spacing:0.9mm; color:#f26a1b; margin:0.7mm 0 1mm; }
.sid-row { display:grid; grid-template-columns:12mm 1fr; align-items:baseline; font-size:5.2pt; line-height:1; padding:0.55mm 0; border-bottom:0.15mm solid #cbd5e1; }
.sid-row:last-child { border-bottom:0; }
.sid-row .l { color:#64748b; font-size:4.4pt; text-transform:uppercase; }
.sid-row .v { font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* lower left: expiry + address, under the photo */
.sid-lower { position:absolute; left:11.5mm; top:43mm; width:50mm; font-size:4.6pt; line-height:1.3; color:#64748b; }
.sid-lower b { color:#0f2557; font-weight:800; }

/* orange swoosh + QR */
.sid-swoosh { position:absolute; right:0; bottom:4.6mm; width:40mm; height:11mm; }
.sid-qr { position:absolute; right:3.5mm; bottom:6mm; width:16mm; height:16mm; }
.sid-qr img { width:100%; height:100%; display:block; }
.sid-brand { position:absolute; right:3.5mm; bottom:1.3mm; text-align:right; line-height:1.25; color:#64748b; font-size:3.6pt; }
.sid-brand b { display:block; color:#0f2557; font-size:4pt; font-weight:800; }

.sid-preview .sid-page { background:#fff; margin-bottom:10px; box-shadow:0 1px 4px rgba(0,0,0,.15); }
.sid-print-root { display:none; }
@media print {
  #root { display:none !important; }
  .sid-print-root { display:block !important; }
  .sid-print-root .sid-page { break-after:page; page-break-after:always; }
  .sid-print-root .sid-page:last-child { break-after:auto; page-break-after:auto; }
  @page { size:A4 portrait; margin:6mm; }
}
`;

export function IdCard({ card }) {
  const fullName = [card.given_names, card.surname].filter(Boolean).join(" ");
  const Row = ({ l, v }) => (
    <div className="sid-row">
      <div className="l">{l}</div>
      <div className="v">{v || "-"}</div>
    </div>
  );
  return (
    <div className="sid-card">
      <div className="sid-band">
        <span>STUDENT ID</span>
        <div className="sid-slash" />
      </div>

      <div className="sid-head">
        <img src={logoImage} alt="" />
        <div>
          <div className="sid-school">THE NYALI SCHOOL</div>
          <div className="sid-sub">MOMBASA · KENYA</div>
        </div>
      </div>

      <div className="sid-photo">{card.photo_url ? <img src={card.photo_url} alt="" /> : "PHOTO"}</div>

      <div className="sid-main">
        <div className="sid-name">{fullName || "-"}</div>
        <div className="sid-role">STUDENT</div>
        <div className="sid-rows">
          <Row l="Adm No" v={card.admission_no} />
          <Row l="D.O.B" v={fmtDate(card.date_of_birth)} />
          <Row l="Sex" v={card.sex} />
          <Row l="Nationality" v={card.nationality} />
          <Row l="ID No" v={card.card_number} />
        </div>
      </div>

      <div className="sid-lower">
        <div>Expires <b>{fmtDate(card.expiry_date)}</b></div>
        <div>Address <b>{card.address || "-"}</b></div>
      </div>

      <svg className="sid-swoosh" viewBox="0 0 120 30" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 30 C 30 28, 55 6, 120 2" fill="none" stroke="#f26a1b" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="sid-qr">
        <img src={`data:image/png;base64,${card.qr_code_base64}`} alt="QR" />
      </div>
      <div className="sid-brand">
        <b>Powered by Masomo Portal</b>
        www.masomoportal.com
      </div>
    </div>
  );
}

export function IdCardSheet({ cards, selectable = false, selected, onToggle }) {
  return chunk(cards, PER_PAGE).map((pageCards, i) => (
    <div className="sid-page" key={i}>
      {pageCards.map((c) => (
        <div className="sid-cell" key={c.id}>
          <IdCard card={c} />
        </div>
      ))}
    </div>
  ));
}

/** const [printPortal, printCards] = usePrintCards();  ...  printCards([payload]); render {printPortal} once. */
export function usePrintCards() {
  const [cards, setCards] = useState(null);

  useEffect(() => {
    if (!cards) return undefined;
    const done = () => setCards(null);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 700); // give photos + QR images time to render
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [cards]);

  const portal = cards
    ? createPortal(
        <div className="sid-print-root">
          <style>{ID_CARD_CSS}</style>
          <IdCardSheet cards={cards} />
        </div>,
        document.body
      )
    : null;

  return [portal, setCards];
}