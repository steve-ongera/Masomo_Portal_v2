import { useCallback, useEffect, useState } from "react";
import { errMsg, procApi } from "../../services/api";
import { Alert, Empty, Loading, PageHeader, kes } from "../../components/procurement/ProcUI";
import { AreaCard, BarCard } from "../../components/procurement/charts";

// Each report: how to chart it and how to tabulate it.
const REPORTS = {
  "spend-by-supplier": { label: "Spend by supplier", dates: true, chart: (r) => <BarCard title="Spend by supplier" data={r.slice(0, 10)} xKey="supplier" bars={[{ key: "total", name: "Spend" }]} horizontal money height={320} />,
    cols: [["supplier", "Supplier"], ["orders", "Orders"], ["total", "Spend", "money"]] },
  "spend-by-department": { label: "Spend by department", dates: true, chart: (r) => <BarCard title="Spend by department" data={r} xKey="department" bars={[{ key: "total", name: "Spend" }]} money height={320} />,
    cols: [["department", "Department"], ["orders", "Orders"], ["total", "Spend", "money"]] },
  "monthly-spend": { label: "Monthly spend (12 months)", chart: (r) => <AreaCard title="Ordered vs paid" data={r} lines={[{ key: "ordered", name: "Ordered (POs)" }, { key: "paid", name: "Paid (invoices)", color: "#0d9488" }]} money height={320} />,
    cols: [["month", "Month"], ["ordered", "Ordered", "money"], ["paid", "Paid", "money"]] },
  "supplier-performance": { label: "Supplier performance", chart: (r) => <BarCard title="On-time delivery vs rejection rate (%)" data={r} xKey="supplier" bars={[{ key: "on_time_pct", name: "On time %", color: "#0d9488" }, { key: "rejection_pct", name: "Rejected %", color: "#e11d48" }]} height={320} />,
    cols: [["supplier", "Supplier"], ["orders_measured", "Orders measured"], ["on_time_pct", "On time %"], ["rejection_pct", "Rejected %"]] },
  "budget-utilization": { label: "Budget utilisation", chart: (r) => <BarCard title="Budget vs committed" data={r} xKey="department" bars={[{ key: "budget", name: "Budget" }, { key: "committed", name: "Committed", color: "#f59e0b" }]} money height={320} />,
    cols: [["department", "Department"], ["budget", "Budget", "money"], ["committed", "Committed", "money"], ["remaining", "Remaining", "money"], ["used_pct", "Used %"]] },
  "payables-aging": { label: "Payables ageing", chart: (r) => <BarCard title="Unpaid supplier invoices" data={r} xKey="bucket" bars={[{ key: "amount", name: "Amount", color: "#e11d48" }]} money height={320} />,
    cols: [["bucket", "Bucket"], ["invoices", "Invoices"], ["amount", "Amount", "money"]] },
  "cycle-times": { label: "Procurement cycle times", chart: (r) => <BarCard title="Average days per stage" data={r} xKey="stage" bars={[{ key: "avg_days", name: "Days", color: "#7c3aed" }]} height={320} />,
    cols: [["stage", "Stage"], ["avg_days", "Average days"], ["samples", "Documents measured"]] },
};

export default function Reports() {
  const [name, setName] = useState("spend-by-supplier");
  const [range, setRange] = useState({ date_from: "", date_to: "" });
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const rep = REPORTS[name];

  const load = useCallback(async () => {
    setRows(null); setErr("");
    try { setRows((await procApi.report(name, Object.fromEntries(Object.entries(range).filter(([, v]) => v)))).data.rows); } catch (e) { setErr(errMsg(e)); setRows([]); }
  }, [name, range]);
  useEffect(() => { load(); }, [load]);

  const download = async () => {
    try {
      const res = await procApi.reportCsv(name, range);
      const url = URL.createObjectURL(res.data);
      Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <PageHeader icon="bi-graph-up" title="Procurement Reports" subtitle="Where the money goes and how well suppliers deliver">
        <button className="btn btn-outline-secondary" onClick={download} disabled={!rows?.length}><i className="bi bi-download me-1" />CSV</button>
      </PageHeader>
      <div className="card border-0 shadow-sm mb-3"><div className="card-body">
        <div className="row g-2 align-items-end">
          <div className="col-md-4"><label className="form-label small">Report</label>
            <select className="form-select" value={name} onChange={(e) => setName(e.target.value)}>{Object.entries(REPORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
          {rep.dates && <>
            <div className="col-md-3"><label className="form-label small">From</label><input type="date" className="form-control" value={range.date_from} onChange={(e) => setRange({ ...range, date_from: e.target.value })} /></div>
            <div className="col-md-3"><label className="form-label small">To</label><input type="date" className="form-control" value={range.date_to} onChange={(e) => setRange({ ...range, date_to: e.target.value })} /></div></>}
        </div>
      </div></div>
      <Alert onClose={() => setErr("")}>{err}</Alert>
      {rows === null ? <Loading /> : !rows.length ? <Empty text="No data for this report yet." /> : (
        <>
          <div className="mb-3">{rep.chart(rows)}</div>
          <div className="card border-0 shadow-sm"><div className="table-responsive"><table className="table table-hover mb-0">
            <thead className="table-light"><tr>{rep.cols.map(([, l, t]) => <th key={l} className={t === "money" ? "text-end" : ""}>{l}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{rep.cols.map(([k, l, t]) => <td key={l} className={t === "money" ? "text-end" : ""}>{t === "money" ? kes(r[k]) : (r[k] ?? "—")}</td>)}</tr>)}</tbody>
          </table></div></div>
        </>
      )}
    </div>
  );
}
