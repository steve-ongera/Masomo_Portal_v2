import { useCallback, useEffect, useState } from "react";
import { errMsg, procApi, unwrap } from "../../services/api";
import { Alert, Loading, Modal, PromptModal, StatusBadge, fdate, kes } from "./ProcUI";
import { BarCard } from "./charts";

/** Record supplier quotations against an RFQ, compare them side by side, document the decision, then raise the PO. */
export default function QuotationManager({ rfqId, canManage, onClose, onChanged }) {
  const [rfq, setRfq] = useState(null);
  const [quotes, setQuotes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(null);
  const [selecting, setSelecting] = useState(null);
  const [poFor, setPoFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, q, s] = await Promise.all([procApi.rfqs.get(rfqId), procApi.quotations.list({ rfq: rfqId }), procApi.suppliers.list()]);
      setRfq(r.data); setQuotes(unwrap(q)); setSuppliers(unwrap(s));
    } catch (e) { setErr(errMsg(e)); }
  }, [rfqId]);
  useEffect(() => { load(); }, [load]);

  if (!rfq) return <Modal title="Quotations" onClose={onClose}><Loading /><Alert>{err}</Alert></Modal>;

  const lowest = Math.min(...quotes.map((q) => Number(q.total_amount)));
  const fastest = Math.min(...quotes.map((q) => q.delivery_days));
  const warranty = Math.max(...quotes.map((q) => q.warranty_months));
  const quoted = new Set(quotes.map((q) => q.supplier));
  const invited = suppliers.filter((s) => rfq.suppliers.includes(s.id) && !quoted.has(s.id));
  const awarded = rfq.status === "AWARDED";
  const open = ["SENT", "CLOSED"].includes(rfq.status);

  const startAdd = () => setAdding({ supplier: invited[0]?.id || "", delivery_days: 7, warranty_months: 0, valid_until: "", notes: "",
    items: rfq.items.map((i) => ({ rfq_item: i.id, description: i.description, quantity: i.quantity, unit_price: "" })) });

  const saveQuote = async () => {
    setErr("");
    try {
      await procApi.quotations.create({ ...adding, rfq: rfq.id, valid_until: adding.valid_until || null,
        items: adding.items.map((i) => ({ rfq_item: i.rfq_item, unit_price: i.unit_price })) });
      setAdding(null); setMsg("Quotation recorded."); await load(); onChanged?.();
    } catch (e) { setErr(errMsg(e)); }
  };

  const chartData = quotes.map((q) => ({ name: q.supplier_name, total: Number(q.total_amount), days: q.delivery_days }));

  return (
    <Modal title={`${rfq.number} - ${rfq.title}`} size="xl" onClose={onClose}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div><StatusBadge value={rfq.status} /> <span className="text-muted ms-2">Closes {fdate(rfq.closing_date)} - {rfq.items.length} item(s) - {rfq.suppliers.length} supplier(s) invited</span></div>
        {canManage && open && !awarded && invited.length > 0 && <button className="btn btn-primary btn-sm" onClick={startAdd}><i className="bi bi-plus-lg me-1" />Record quotation</button>}
      </div>
      <Alert onClose={() => setErr("")}>{err}</Alert>
      <Alert kind="success" onClose={() => setMsg("")}>{msg}</Alert>

      {!quotes.length ? <div className="text-center text-muted py-4">No quotations recorded yet. Record each supplier's response as it arrives.</div> : (
        <>
          <div className="row g-3 mb-3">
            <div className="col-md-6"><BarCard title="Total quoted" data={chartData} xKey="name" bars={[{ key: "total", name: "Total" }]} money height={200} /></div>
            <div className="col-md-6"><BarCard title="Delivery time (days)" data={chartData} xKey="name" bars={[{ key: "days", name: "Days", color: "#0d9488" }]} height={200} /></div>
          </div>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead className="table-light">
                <tr>
                  <th>Supplier</th>
                  {rfq.items.map((i) => <th key={i.id} className="text-end">{i.description}<div className="small text-muted fw-normal">unit price (qty {Number(i.quantity)})</div></th>)}
                  <th className="text-end">Total</th><th>Delivery</th><th>Warranty</th><th /></tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className={q.is_selected ? "table-success" : ""}>
                    <td className="fw-semibold">{q.supplier_name}{q.is_selected && <span className="badge text-bg-success ms-2">Selected</span>}</td>
                    {rfq.items.map((i) => { const li = q.items.find((x) => x.rfq_item === i.id); return <td key={i.id} className="text-end">{li ? Number(li.unit_price).toLocaleString() : "—"}</td>; })}
                    <td className="text-end fw-semibold">{kes(q.total_amount)} {Number(q.total_amount) === lowest && quotes.length > 1 && <span className="badge text-bg-info">Lowest</span>}</td>
                    <td>{q.delivery_days} days {q.delivery_days === fastest && quotes.length > 1 && <span className="badge text-bg-info">Fastest</span>}</td>
                    <td>{q.warranty_months} mo {q.warranty_months === warranty && warranty > 0 && quotes.length > 1 && <span className="badge text-bg-info">Longest</span>}</td>
                    <td className="text-end text-nowrap">
                      {canManage && !awarded && <button className="btn btn-sm btn-outline-success me-1" onClick={() => setSelecting(q)}>Select</button>}
                      {canManage && q.is_selected && <button className="btn btn-sm btn-success" onClick={() => setPoFor(q)}>Create PO</button>}
                      {canManage && !q.is_selected && !awarded && <button className="btn btn-sm btn-link text-danger" onClick={async () => { if (window.confirm("Remove this quotation?")) { try { await procApi.quotations.remove(q.id); await load(); } catch (e) { setErr(errMsg(e)); } } }}><i className="bi bi-trash" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small text-muted">The cheapest quotation is never chosen automatically. Select the supplier you want and record why, so the decision can be audited.</div>
          {quotes.filter((q) => q.is_selected).map((q) => <div key={q.id} className="alert alert-success mt-3 mb-0"><strong>Decision:</strong> {q.evaluation_notes}</div>)}
        </>
      )}

      {adding && (
        <Modal title="Record quotation" size="lg" onClose={() => setAdding(null)}
          footer={<><button className="btn btn-light" onClick={() => setAdding(null)}>Cancel</button><button className="btn btn-primary" onClick={saveQuote}>Save quotation</button></>}>
          <Alert>{err}</Alert>
          <div className="row g-3">
            <div className="col-md-6"><label className="form-label">Supplier</label>
              <select className="form-select" value={adding.supplier} onChange={(e) => setAdding({ ...adding, supplier: e.target.value })}>
                {invited.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="col-md-3"><label className="form-label">Delivery (days)</label><input type="number" className="form-control" value={adding.delivery_days} onChange={(e) => setAdding({ ...adding, delivery_days: e.target.value })} /></div>
            <div className="col-md-3"><label className="form-label">Warranty (months)</label><input type="number" className="form-control" value={adding.warranty_months} onChange={(e) => setAdding({ ...adding, warranty_months: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Valid until</label><input type="date" className="form-control" value={adding.valid_until} onChange={(e) => setAdding({ ...adding, valid_until: e.target.value })} /></div>
            <div className="col-md-6"><label className="form-label">Notes</label><input className="form-control" value={adding.notes} onChange={(e) => setAdding({ ...adding, notes: e.target.value })} /></div>
          </div>
          <table className="table table-sm mt-3">
            <thead className="table-light"><tr><th>Item</th><th>Qty</th><th style={{ width: 160 }}>Unit price (KES)</th></tr></thead>
            <tbody>{adding.items.map((it, k) => (
              <tr key={it.rfq_item}><td>{it.description}</td><td>{Number(it.quantity)}</td>
                <td><input type="number" className="form-control form-control-sm" value={it.unit_price}
                  onChange={(e) => setAdding({ ...adding, items: adding.items.map((x, j) => (j === k ? { ...x, unit_price: e.target.value } : x)) })} /></td></tr>
            ))}</tbody>
          </table>
        </Modal>
      )}

      {selecting && (
        <PromptModal title={`Select ${selecting.supplier_name}`} tone="success" confirmLabel="Award RFQ"
          intro="Record why this quotation wins - price, delivery, warranty, specification, supplier eligibility."
          fields={[{ name: "evaluation_notes", label: "Evaluation notes", type: "textarea", required: true }]}
          onClose={() => setSelecting(null)}
          onSubmit={async (v) => { try { await procApi.quotations.act(selecting.id, "select", v); setMsg("Quotation selected."); await load(); onChanged?.(); } catch (e) { throw new Error(errMsg(e)); } }} />
      )}

      {poFor && (
        <PromptModal title="Create purchase order" confirmLabel="Create draft PO"
          intro={`A draft PO for ${poFor.supplier_name} is created from the selected prices. You can edit it before submitting for approval.`}
          fields={[{ name: "delivery_location", label: "Delivery location", default: "School Store" }, { name: "expected_delivery", label: "Expected delivery (optional)", type: "date" }]}
          onClose={() => setPoFor(null)}
          onSubmit={async (v) => { try { await procApi.purchaseOrders.fromQuotation({ quotation: poFor.id, delivery_location: v.delivery_location, expected_delivery: v.expected_delivery || undefined }); setMsg("Draft purchase order created - find it under Purchase Orders."); onChanged?.(); } catch (e) { throw new Error(errMsg(e)); } }} />
      )}
    </Modal>
  );
}
