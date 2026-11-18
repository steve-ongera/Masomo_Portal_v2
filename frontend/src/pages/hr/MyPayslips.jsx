import { useEffect, useState, useCallback, useMemo } from "react";
import { payrollApi } from "../../services/api";
import PayslipView, {
  prettyPeriod,
  periodSortKey,
  downloadPayslipPdf,
} from "./PayslipView";

const fmtMoney = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function MyPayslips() {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(null);
  const [query, setQuery] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await payrollApi.mine();
      const data = Array.isArray(r.data) ? r.data : r.data?.results ?? [];
      setRows(data);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not load your payslips. Please try again.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = async (slip) => {
    setDownloadingId(slip.id);
    try {
      await downloadPayslipPdf(slip);
    } catch (err) {
      console.error("Payslip PDF failed:", err);
      setError("Could not generate the payslip PDF. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) =>
      periodSortKey(b.period).localeCompare(periodSortKey(a.period))
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => prettyPeriod(s.period).toLowerCase().includes(q));
  }, [sorted, query]);

  const latest = sorted[0] || null;
  const currentYear = new Date().getFullYear();

  const yearToDateNet = useMemo(() => {
    if (!sorted.length) return 0;
    return sorted
      .filter((s) => periodSortKey(s.period).startsWith(String(currentYear)))
      .reduce((sum, s) => sum + (Number(s.net) || 0), 0);
  }, [sorted, currentYear]);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">My Payslips</h1>
            <p className="page-subtitle">Your monthly payslips</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Payslips</h1>
          <p className="page-subtitle">
            {sorted.length > 0
              ? `${sorted.length} payslip${sorted.length === 1 ? "" : "s"} available`
              : "Your monthly payslips, released by the school"}
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          {error}
          <button type="button" className="btn-close" onClick={() => setError("")}></button>
        </div>
      )}

      {/* ---- Stat cards ---- */}
      {sorted.length > 0 && (
        <div className="stat-grid">
          <div className="dm-card dm-card--primary">
            <div className="dm-card__top">
              <span className="dm-card__label">
                Latest payslip · {prettyPeriod(latest?.period)}
              </span>
              <span className="dm-card__icon">
                <i className="bi bi-receipt"></i>
              </span>
            </div>
            <div className="dm-card__num">{fmtMoney(latest?.net)}</div>
          </div>

          <div className="dm-card dm-card--success">
            <div className="dm-card__top">
              <span className="dm-card__label">{currentYear} total net pay</span>
              <span className="dm-card__icon">
                <i className="bi bi-graph-up-arrow"></i>
              </span>
            </div>
            <div className="dm-card__num">{fmtMoney(yearToDateNet)}</div>
          </div>
        </div>
      )}

      {/* ---- Payslip history ---- */}
      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0" style={{ width: "100%" }}>
            <div className="toolbar__search" style={{ maxWidth: "none" }}>
              <i className="bi bi-search"></i>
              <input
                type="text"
                className="form-control"
                placeholder="Search period..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {query && (
              <button className="btn btn-sm btn-light" onClick={() => setQuery("")}>
                <i className="bi bi-x-lg"></i> Clear
              </button>
            )}
          </div>

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title mb-0">
              <i className="bi bi-journal-text me-2 text-brand"></i>
              Payslip History
            </span>
            <span className="chart-card__subtitle mb-0">
              {filtered.length} of {sorted.length} shown
            </span>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-receipt"></i>
            <h6>No payslips released yet</h6>
            <p className="text-muted-soft">
              Once the school approves a payroll run, your payslips will appear here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-search"></i>
            <h6>No payslips match "{query}"</h6>
            <p className="text-muted-soft">Try a different month or clear the search.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="text-end">Gross</th>
                  <th className="text-end">Deductions</th>
                  <th className="text-end">Net Pay</th>
                  <th style={{ width: "170px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const deductions =
                    s.total_deductions !== undefined
                      ? s.total_deductions
                      : (Number(s.paye) || 0) +
                        (Number(s.nssf) || 0) +
                        (Number(s.shif) || 0) +
                        (Number(s.housing_levy) || 0) +
                        (Number(s.other_deductions) || 0);

                  return (
                    <tr key={s.id}>
                      <td>
                        <span className="cell-name">{prettyPeriod(s.period)}</span>
                      </td>
                      <td className="cell-mono text-end">{fmtMoney(s.gross)}</td>
                      <td className="cell-mono text-end cell-muted">
                        {fmtMoney(deductions)}
                      </td>
                      <td className="cell-mono text-end fw-bold">
                        {fmtMoney(s.net)}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => setSel(s)}
                            title="Open payslip"
                          >
                            <i className="bi bi-file-earmark-text me-1"></i>
                            View
                          </button>
                          <button
                            className="btn btn-sm btn-outline-success btn-icon"
                            onClick={() => handleDownload(s)}
                            disabled={downloadingId === s.id}
                            title="Download PDF"
                          >
                            {downloadingId === s.id ? (
                              <span className="spinner-border spinner-border-sm"></span>
                            ) : (
                              <i className="bi bi-file-earmark-pdf"></i>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {sel && <PayslipView slip={sel} onClose={() => setSel(null)} />}
    </div>
  );
}