import { useState, useMemo } from "react";
import { hrReportsApi as reportsApi } from "../../services/api";
import Breadcrumb from "../../components/Breadcrumb";
import TableSkeleton from "../../components/TableSkeleton";

const REPORTS = [
  { key: "register", label: "Employee Register", icon: "bi-people", desc: "Every employee on record, with their current status and category.", needs: { month: false, year: false } },
  { key: "headcount", label: "Staff by Department", icon: "bi-diagram-3", desc: "Headcount per department across the school.", needs: { month: false, year: false } },
  { key: "attendance", label: "Staff Attendance (Month)", icon: "bi-calendar-check", desc: "Attendance breakdown for the selected month.", needs: { month: true, year: true } },
  { key: "leave", label: "Leave (Year)", icon: "bi-calendar2-week", desc: "Leave taken and remaining, summarised per staff member.", needs: { month: false, year: true } },
  { key: "payroll", label: "Payroll (Month)", icon: "bi-receipt", desc: "Payroll totals for the selected month.", needs: { month: true, year: true } },
  { key: "contracts", label: "Contract Expiry", icon: "bi-file-earmark-x", desc: "Contracts approaching or past their end date.", needs: { month: false, year: false } },
  { key: "turnover", label: "Staff Turnover (Year)", icon: "bi-arrow-left-right", desc: "Joiners and exits summarised for the selected year.", needs: { month: false, year: true } },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const now = new Date();

const prettyCol = (key) =>
  key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const isNumericCol = (rows, key) =>
  rows.length > 0 &&
  rows.every((r) => {
    const v = r[key];
    if (v === null || v === undefined || v === "") return true;
    return !Number.isNaN(Number(v));
  });

export default function Reports() {
  const [name, setName] = useState("register");
  const [p, setP] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("info");

  const activeReport = useMemo(() => REPORTS.find((r) => r.key === name) || REPORTS[0], [name]);

  const cols = useMemo(() => (rows && rows.length ? Object.keys(rows[0]) : []), [rows]);

  const numericCols = useMemo(() => {
    if (!rows || rows.length === 0) return new Set();
    return new Set(cols.filter((c) => isNumericCol(rows, c)));
  }, [rows, cols]);

  const run = async () => {
    setLoading(true);
    setMsg("");
    try {
      const { data } = await reportsApi.get(name, p);
      setRows(data);
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not run the report. Please try again.");
      setMsgType("danger");
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  const csv = async () => {
    setDownloading(true);
    try {
      const { data } = await reportsApi.csv(name, p);
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hr-${name}-${p.year}${activeReport.needs.month ? "-" + String(p.month).padStart(2, "0") : ""}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg("Download started.");
      setMsgType("success");
    } catch (err) {
      setMsg(err.response?.data?.detail || "Could not download the CSV. Please try again.");
      setMsgType("danger");
    } finally {
      setDownloading(false);
    }
  };

  const changeReport = (key) => {
    setName(key);
    setRows(null);
    setMsg("");
  };

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/admin" },
          { label: "HR", href: "/admin/hr" },
          { label: "Reports", href: "#" },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">HR Reports</h1>
          <p className="page-subtitle">Run, review, and export HR data as CSV</p>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} alert-dismissible fade show`} role="alert">
          {msg}
          <button type="button" className="btn-close" onClick={() => setMsg("")}></button>
        </div>
      )}

      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
            <i className="bi bi-sliders me-2"></i>
            Report
          </span>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
            {activeReport.label}
          </span>
        </div>

        <div className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-md-5 col-lg-4">
              <label className="form-label">Report Type</label>
              <select className="form-select" value={name} onChange={(e) => changeReport(e.target.value)}>
                {REPORTS.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </div>

            {activeReport.needs.month && (
              <div className="col-md-3 col-lg-3">
                <label className="form-label">Month</label>
                <select
                  className="form-select"
                  value={p.month}
                  onChange={(e) => setP({ ...p, month: Number(e.target.value) })}
                >
                  {MONTHS.map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            {activeReport.needs.year && (
              <div className="col-md-3 col-lg-3">
                <label className="form-label">Year</label>
                <input
                  type="number"
                  className="form-control"
                  min={2000}
                  max={2100}
                  value={p.year}
                  onChange={(e) => setP({ ...p, year: Number(e.target.value) })}
                />
              </div>
            )}

            <div
              className={`${
                activeReport.needs.month || activeReport.needs.year
                  ? "col-md-6 col-lg-2"
                  : "col-md-7 col-lg-5"
              } d-flex gap-2 justify-content-md-end flex-wrap`}
            >
              <button className="btn btn-primary" onClick={run} disabled={loading}>
                {loading ? (
                  "Running..."
                ) : (
                  <>
                    <i className="bi bi-play-fill me-1"></i>
                    Show Report
                  </>
                )}
              </button>
              <button
                className="btn btn-outline-primary"
                onClick={csv}
                disabled={downloading}
                title="Download the current selection as CSV"
              >
                {downloading ? (
                  "Preparing..."
                ) : (
                  <>
                    <i className="bi bi-download me-1"></i>
                    CSV
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="form-text-hint mt-3 d-flex align-items-center gap-2">
            <i className={`bi ${activeReport.icon}`}></i>
            {activeReport.desc}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-wrap__header">
          <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
            <i className={`bi ${activeReport.icon} me-2`}></i>
            {activeReport.label}
          </span>
          {rows && (
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
              {rows.length} record{rows.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={5} />
        ) : rows === null ? (
          <div className="empty-state">
            <i className={`bi ${activeReport.icon}`}></i>
            <h6>Ready to run</h6>
            <p className="text-muted-soft">Choose a report and click "Show Report" to load the data.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-inbox"></i>
            <h6>No records for this selection</h6>
            <p className="text-muted-soft">Try a different month or year, or pick another report.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th
                      key={c}
                      className={numericCols.has(c) ? "text-end" : ""}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {prettyCol(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => {
                      const value = r[c];
                      const isNumeric = numericCols.has(c);
                      return (
                        <td
                          key={c}
                          className={isNumeric ? "text-end" : ""}
                          style={{
                            fontSize: "var(--fs-xs)",
                            whiteSpace: isNumeric ? "nowrap" : "normal",
                            fontWeight:
                              c === "name" || c === "full_name" || c === "employee_name" ? 600 : 400,
                          }}
                        >
                          {value === null || value === undefined || value === "" ? (
                            <span className="cell-muted">—</span>
                          ) : (
                            String(value)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              <strong>{rows.length}</strong> record{rows.length === 1 ? "" : "s"} · {activeReport.label}
              {activeReport.needs.year ? ` · ${p.year}` : ""}
              {activeReport.needs.month ? ` · ${MONTHS[p.month - 1]}` : ""}
            </span>
            <button className="btn btn-sm btn-outline-primary" onClick={csv} disabled={downloading}>
              <i className="bi bi-download me-1"></i>
              {downloading ? "Preparing..." : "Download CSV"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}