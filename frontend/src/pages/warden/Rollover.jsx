import { useState } from "react";
import { boardingApi } from "../../services/boardingApi";
import { Msg, useAction, useYears, YearSelect } from "./common";

const REASONS = {
  GRADUATED: "Completed school",
  NOT_RETURNING: "Not enrolled next year",
  NOT_BOARDING_GRADE: "Grade does not board",
};

export default function Rollover() {
  const act = useAction();
  const { years, current } = useYears();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [keep, setKeep] = useState(true);
  const [report, setReport] = useState(null);

  const fromId =
    from ||
    (years.find((y) => y.year === (current?.year ?? 0) - 1)?.id ?? "");
  const toId = to || current?.id || "";

  const canRun = !!(fromId && toId && !act.busy);
  const canRunForReal = canRun && report?.dry_run;

  const run = async (dry) => {
    if (
      !dry &&
      !window.confirm(
        "Close last year's bed allocations and carry returning students into the new year? Run the preview first if you haven't."
      )
    )
      return;
    const r = await act.run(
      () =>
        boardingApi.rollover({
          from_year: fromId,
          to_year: toId,
          keep_beds: keep,
          dry_run: dry,
        }),
      dry ? "Preview only — nothing was changed." : "Rollover complete."
    );
    if (r) setReport(r.data);
  };

  const carried = report?.carried || [];
  const released = report?.released || [];

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Year Rollover</h1>
          <p className="page-subtitle">
            Close last year's bed allocations and carry returning students into the new year
          </p>
        </div>
        <div className="page-header__actions">
          <button
            className="btn btn-outline-primary"
            disabled={!canRun}
            onClick={() => run(true)}
          >
            {act.busy && report?.dry_run ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Previewing...
              </>
            ) : (
              <>
                <i className="bi bi-eye" />
                Preview
              </>
            )}
          </button>
          <button
            className="btn btn-primary"
            disabled={!canRunForReal}
            onClick={() => run(false)}
            title={
              !report?.dry_run
                ? "Run the preview first to enable this"
                : undefined
            }
          >
            {act.busy && !report?.dry_run ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Running...
              </>
            ) : (
              <>
                <i className="bi bi-arrow-repeat" />
                Run rollover
              </>
            )}
          </button>
        </div>
      </div>

      <Msg error={act.error} ok={act.ok} />

      {/* ---------- Safety notice ---------- */}
      <div className="alert alert-warning d-flex align-items-start gap-2" role="alert">
        <i className="bi bi-exclamation-triangle mt-1" />
        <div>
          Run this <strong>after</strong> promotion has created next year's
          enrollments. Students who finished school or are not returning lose
          their bed (the history stays); returning students keep their bed; the
          freed beds become available for new learners.
        </div>
      </div>

      {/* ---------- Configuration panel ---------- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title">
            <i className="bi bi-sliders me-2 text-brand" />
            Configuration
          </span>
        </div>
        <div className="p-3">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md-4">
              <label className="form-label">From year</label>
              <YearSelect
                years={years}
                value={fromId}
                onChange={setFrom}
                className="form-select"
              />
            </div>
            <div className="col-12 col-md-4">
              <label className="form-label">To year</label>
              <YearSelect
                years={years}
                value={toId}
                onChange={setTo}
                className="form-select"
              />
            </div>
            <div className="col-12 col-md-4">
              <div className="form-check mt-4">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="keepBeds"
                  checked={keep}
                  onChange={(e) => setKeep(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="keepBeds">
                  Returning students keep their bed
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Report ---------- */}
      {!report ? (
        <div className="empty-state">
          <i className="bi bi-arrow-repeat" />
          <h6>No rollover has been run yet</h6>
          <p className="text-muted-soft">
            Preview first — it shows exactly what will happen without changing
            anything. Then run the rollover for real.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="stat-grid">
            <div className="dm-card dm-card--success">
              <div className="dm-card__top">
                <span className="dm-card__label">Continuing</span>
                <span className="dm-card__icon">
                  <i className="bi bi-arrow-right-circle" />
                </span>
              </div>
              <div className="dm-card__num">{report.carried_count}</div>
              <div className="dm-card__sub">
                {keep ? "Will keep their bed" : "Beds will be reassigned"}
              </div>
            </div>

            <div className="dm-card dm-card--warning">
              <div className="dm-card__top">
                <span className="dm-card__label">Leaving</span>
                <span className="dm-card__icon">
                  <i className="bi bi-box-arrow-up" />
                </span>
              </div>
              <div className="dm-card__num">{report.released_count}</div>
              <div className="dm-card__sub">Bed freed, history kept</div>
            </div>

            <div className="dm-card dm-card--info">
              <div className="dm-card__top">
                <span className="dm-card__label">Eligible but not yet boarders</span>
                <span className="dm-card__icon">
                  <i className="bi bi-person-plus" />
                </span>
              </div>
              <div className="dm-card__num">{report.candidates_not_registered}</div>
              <div className="dm-card__sub">
                Enrolled for next year — not registered to board
              </div>
            </div>
          </div>

          {/* Continuing table */}
          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-arrow-right-circle me-2 text-brand" />
                Continuing students
              </span>
              <span className="chart-card__subtitle">
                {carried.length} student{carried.length !== 1 ? "s" : ""}
              </span>
            </div>

            {carried.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-people" />
                <h6>No continuing students</h6>
                <p className="text-muted-soft">
                  Nobody from last year is coming back into the same hostel.
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th>Admission No</th>
                      <th>Name</th>
                      <th>Grade</th>
                      <th>Bed</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carried.map((r) => (
                      <tr key={r.admission_no}>
                        <td
                          data-label="Admission No"
                          className="cell-mono text-brand fw-semibold"
                        >
                          {r.admission_no}
                        </td>
                        <td data-label="Name">
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">
                              {(r.name || "")
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <span className="cell-name">{r.name}</span>
                          </div>
                        </td>
                        <td data-label="Grade">{r.grade || "-"}</td>
                        <td data-label="Bed">
                          {r.bed ? (
                            <span className="badge badge-neutral">{r.bed}</span>
                          ) : (
                            <span className="text-muted-soft">No bed</span>
                          )}
                        </td>
                        <td data-label="Status">
                          {r.kept_bed === true && (
                            <span className="badge badge-success">Keeps bed</span>
                          )}
                          {r.kept_bed === false && (
                            <>
                              <span className="badge badge-warning">
                                Bed not kept
                              </span>
                              {r.note && (
                                <div className="text-muted-soft small mt-1">
                                  {r.note}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Leaving table */}
          <div className="table-wrap">
            <div className="table-wrap__header">
              <span className="chart-card__title">
                <i className="bi bi-box-arrow-up me-2 text-brand" />
                Leaving students
              </span>
              <span className="chart-card__subtitle">
                {released.length} student{released.length !== 1 ? "s" : ""}
              </span>
            </div>

            {released.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-person-dash" />
                <h6>No leaving students</h6>
                <p className="text-muted-soft">
                  Everyone from last year is staying on.
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th>Admission No</th>
                      <th>Name</th>
                      <th>Bed</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {released.map((r) => (
                      <tr key={r.admission_no}>
                        <td
                          data-label="Admission No"
                          className="cell-mono text-brand fw-semibold"
                        >
                          {r.admission_no}
                        </td>
                        <td data-label="Name">
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">
                              {(r.name || "")
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <span className="cell-name">{r.name}</span>
                          </div>
                        </td>
                        <td data-label="Bed">
                          {r.bed ? (
                            <span className="badge badge-neutral">{r.bed}</span>
                          ) : (
                            <span className="text-muted-soft">No bed</span>
                          )}
                        </td>
                        <td data-label="Reason">
                          <span className="badge badge-neutral">
                            {REASONS[r.reason] || r.reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}