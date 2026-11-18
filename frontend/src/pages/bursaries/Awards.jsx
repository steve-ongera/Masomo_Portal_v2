import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  bursaryApi,
  calendarApi,
  errMsg,
  studentsApi,
  unwrap,
} from "../../services/api";
import Modal from "../../components/Modal";
import Pagination from "../../components/Pagination";

const KIND_LABEL = {
  SCHOLARSHIP: "Scholarship",
  BURSARY: "Bursary",
  SPONSORSHIP: "Sponsorship",
  STAFF_DISCOUNT: "Staff discount",
  SIBLING_DISCOUNT: "Sibling discount",
  OTHER: "Other",
};

const STATUS_BADGE = {
  PENDING: "badge-warning",
  APPROVED: "badge-success",
  SUSPENDED: "badge-neutral",
  ENDED: "badge-neutral",
  REJECTED: "badge-danger",
};

const STATUS_TABS = [
  ["", "All"],
  ["PENDING", "Pending"],
  ["APPROVED", "Approved"],
  ["SUSPENDED", "Suspended"],
  ["ENDED", "Ended"],
  ["REJECTED", "Rejected"],
];

const fmt = (n) =>
  new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(Number(n) || 0);

const valueLabel = (type, value) =>
  type === "PERCENT" ? `${Number(value)}%` : `KES ${fmt(value)}`;

const PAGE_SIZE = 25;

export default function Awards() {
  const [params, setParams] = useSearchParams();

  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const status = params.get("status") || "";
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    bursaryApi.awards
      .list({
        page,
        status: status || undefined,
        scheme__kind: kind || undefined,
        search: search || undefined,
      })
      .then((r) => {
        setRows(r.data.results ?? r.data);
        setCount(r.data.count ?? 0);
      })
      .catch((e) => setMsg({ kind: "error", text: errMsg(e) }))
      .finally(() => setLoading(false));
  }, [page, status, kind, search]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, okText) => {
    setMsg({ kind: "", text: "" });
    try {
      await fn();
      setMsg({ kind: "ok", text: okText });
      load();
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e) });
    }
  };

  const reject = (a) => {
    const reason = window.prompt(`Why is ${a.student_name}'s award being rejected?`);
    if (reason) act(() => bursaryApi.awards.reject(a.id, reason), "Award rejected.");
  };

  const setStatus = (s) => {
    setParams(s ? { status: s } : {});
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = startIndex + rows.length;
  const hasFilters = !!(search || kind || status);

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Awards</h1>
          <p className="page-subtitle">
            Each award gives one student one bursary, scholarship, or discount
          </p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <i className="bi bi-plus-lg" />
            Add an award
          </button>
        </div>
      </div>

      {/* ---------- Page-level message ---------- */}
      {msg.text && (
        <div
          className={`alert alert-${msg.kind === "error" ? "danger" : "success"} alert-dismissible fade show`}
          role={msg.kind === "error" ? "alert" : "status"}
        >
          {msg.text}
          <button
            type="button"
            className="btn-close"
            onClick={() => setMsg({ kind: "", text: "" })}
            aria-label="Dismiss"
          />
        </div>
      )}

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          {/* Search + kind + clear */}
          <div className="toolbar mb-0">
            <div className="toolbar__search">
              <i className="bi bi-search" />
              <input
                type="text"
                className="form-control"
                placeholder="Search name, admission no. or reference..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <select
              className="form-select w-auto"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
              aria-label="Award type"
            >
              <option value="">Any type</option>
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <div className="toolbar__spacer" />

            <span className="chart-card__subtitle">
              {count} award{count !== 1 ? "s" : ""}
            </span>

            {hasFilters && (
              <button
                className="btn btn-sm btn-light"
                onClick={() => {
                  setSearch("");
                  setKind("");
                  setParams({});
                  setPage(1);
                }}
              >
                <i className="bi bi-x-lg" /> Clear
              </button>
            )}
          </div>

          {/* Status tabs */}
          <ul className="nav nav-tabs" role="tablist">
            {STATUS_TABS.map(([k, label]) => (
              <li className="nav-item" role="presentation" key={k || "all"}>
                <button
                  type="button"
                  role="tab"
                  className={`nav-link ${status === k ? "active" : ""}`}
                  onClick={() => setStatus(k)}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {loading ? (
          <div className="text-center py-4">
            <span className="spinner-border spinner-border-sm me-2" />
            Loading awards...
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-award" />
            <h6>{hasFilters ? "No awards match your filters" : "No awards yet"}</h6>
            <p className="text-muted-soft">
              {hasFilters
                ? "Try a different search or clear your filters."
                : "Click 'Add an award' to record the first one."}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table--stack mb-0">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Scheme</th>
                  <th>Value</th>
                  <th>From</th>
                  <th className="text-end">Applied</th>
                  <th>Status</th>
                  <th style={{ width: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Student">
                      <div className="table-avatar-cell">
                        <div className="avatar-sm">
                          {(a.student_name || "")
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((n) => n[0])
                            .join("")}
                        </div>
                        <div>
                          <button
                            type="button"
                            className="btn btn-link p-0 text-start cell-name"
                            onClick={() => setDetail(a)}
                          >
                            {a.student_name}
                          </button>
                          <div className="text-muted-soft small">
                            <span className="cell-mono">{a.admission_no}</span>
                            {a.classroom ? ` · ${a.classroom}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Scheme">
                      <div className="cell-name">{a.scheme_name}</div>
                      <div className="text-muted-soft small">
                        {a.source_name || "School-funded"}
                      </div>
                    </td>
                    <td data-label="Value" className="cell-num">
                      {valueLabel(a.value_type, a.value)}
                    </td>
                    <td data-label="From">{a.start_term_label}</td>
                    <td data-label="Applied" className="cell-num fw-semibold">
                      {fmt(a.total_waived + a.total_pledged)}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`badge ${STATUS_BADGE[a.status] || "badge-neutral"}`}
                      >
                        {a.status_display}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="table-actions">
                        {a.status === "PENDING" && (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-success btn-icon"
                              title="Approve award"
                              aria-label="Approve award"
                              onClick={() =>
                                act(
                                  () => bursaryApi.awards.approve(a.id),
                                  "Award approved and applied."
                                )
                              }
                            >
                              <i className="bi bi-check2" />
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger btn-icon"
                              title="Reject award"
                              aria-label="Reject award"
                              onClick={() => reject(a)}
                            >
                              <i className="bi bi-x" />
                            </button>
                          </>
                        )}
                        {a.status === "APPROVED" && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary btn-icon"
                            title="Suspend award"
                            aria-label="Suspend award"
                            onClick={() =>
                              act(
                                () => bursaryApi.awards.suspend(a.id),
                                "Award suspended."
                              )
                            }
                          >
                            <i className="bi bi-pause-circle" />
                          </button>
                        )}
                        {a.status === "SUSPENDED" && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary btn-icon"
                            title="Resume award"
                            aria-label="Resume award"
                            onClick={() =>
                              act(
                                () => bursaryApi.awards.resume(a.id),
                                "Award resumed."
                              )
                            }
                          >
                            <i className="bi bi-play-circle" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary btn-icon"
                          title="View details"
                          aria-label="View details"
                          onClick={() => setDetail(a)}
                        >
                          <i className="bi bi-eye" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && rows.length > 0 && count > PAGE_SIZE && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={(p) => {
            if (p < 1 || p > totalPages) return;
            setPage(p);
          }}
          itemsPerPage={PAGE_SIZE}
          setItemsPerPage={() => {}}
          startIndex={startIndex}
          endIndex={endIndex}
          totalItems={count}
        />
      )}

      {/* ---------- Add award modal ---------- */}
      <Modal
        show={creating}
        onClose={() => setCreating(false)}
        title="Add an award"
        size="lg"
      >
        <NewAward
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setMsg({
              kind: "ok",
              text: "Award added. It will apply once it is approved.",
            });
            load();
          }}
        />
      </Modal>

      {/* ---------- Award detail modal ---------- */}
      <Modal
        show={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.student_name} · ${detail.scheme_name}` : "Award"}
        size="lg"
      >
        {detail && (
          <AwardDetail
            award={detail}
            onClose={() => setDetail(null)}
            onChanged={load}
          />
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add award
// ---------------------------------------------------------------------------
function NewAward({ onClose, onSaved }) {
  const [schemes, setSchemes] = useState([]);
  const [terms, setTerms] = useState([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [student, setStudent] = useState(null);
  const [f, setF] = useState({
    scheme: "",
    start_term: "",
    value: "",
    reference_no: "",
    notes: "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bursaryApi.schemes.list({ is_active: true }).then((r) => setSchemes(unwrap(r)));
    calendarApi.terms().then((r) => setTerms(unwrap(r)));
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(
      () =>
        studentsApi
          .list({ search: q, page_size: 6 })
          .then((r) => setFound(unwrap(r)))
          .catch(() => {})
          .finally(() => setSearching(false)),
      250
    );
    return () => clearTimeout(t);
  }, [q]);

  const scheme = schemes.find((s) => String(s.id) === String(f.scheme));

  const save = async () => {
    setErr("");
    if (!student) return setErr("Choose a student.");
    if (!f.scheme || !f.start_term)
      return setErr("Choose a scheme and the term it starts.");
    setBusy(true);
    try {
      await bursaryApi.awards.create({
        student: student.id,
        scheme: Number(f.scheme),
        start_term: Number(f.start_term),
        value: f.value || undefined,
        reference_no: f.reference_no,
        notes: f.notes,
      });
      onSaved();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {err && (
        <div className="alert alert-danger" role="alert">
          {err}
        </div>
      )}

      {/* ---------- Student ---------- */}
      <h6 className="settings-section__title mb-2">Student</h6>
      {student ? (
        <div className="alert alert-primary d-flex align-items-center flex-wrap gap-2">
          <i className="bi bi-person-check" />
          <span>
            <span className="cell-mono text-brand fw-semibold me-2">
              {student.admission_no}
            </span>
            <span className="cell-name">{student.full_name}</span>
            {student.current_classroom && (
              <span className="text-muted-soft small ms-2">
                ({student.current_classroom})
              </span>
            )}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-light ms-auto"
            onClick={() => {
              setStudent(null);
              setQ("");
              setFound([]);
            }}
          >
            <i className="bi bi-x-lg me-1" />
            Change
          </button>
        </div>
      ) : (
        <>
          <div className="input-icon-group mb-2">
            <i className="bi bi-search input-icon-leading" />
            <input
              className="form-control"
              placeholder="Type a name or admission number (min 2 letters)..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {q.trim().length > 0 && q.trim().length < 2 && (
            <div className="form-text-hint mt-0">
              Type at least 2 characters to search.
            </div>
          )}
          {searching && (
            <div className="text-center py-2">
              <span className="spinner-border spinner-border-sm me-2" />
              Searching...
            </div>
          )}
          {!searching && q.trim().length >= 2 && found.length === 0 && (
            <p className="form-text-hint mt-0">No matching students.</p>
          )}
          {!searching && found.length > 0 && (
            <div className="pick-list">
              {found.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="pick-item"
                  onClick={() => {
                    setStudent(s);
                    setFound([]);
                  }}
                >
                  <span>
                    <span className="pick-item__adm">{s.admission_no}</span>
                    <span className="cell-name">{s.full_name}</span>
                    {s.current_classroom && (
                      <span className="text-muted-soft small ms-2">
                        ({s.current_classroom})
                      </span>
                    )}
                  </span>
                  <i className="bi bi-arrow-right-circle" />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---------- Scheme ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Scheme</h6>
      <label className="form-label">Award scheme</label>
      <select
        className="form-select"
        value={f.scheme}
        onChange={(e) => setF({ ...f, scheme: e.target.value })}
      >
        <option value="">Choose a scheme</option>
        {schemes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.source_name || "School"})
          </option>
        ))}
      </select>

      {/* ---------- Term & value ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Term &amp; value</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Starts in term</label>
          <select
            className="form-select"
            value={f.start_term}
            onChange={(e) => setF({ ...f, start_term: e.target.value })}
          >
            <option value="">Choose a term</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.term_label || `Term ${t.term_number}`} {t.academic_year_label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label">
            {scheme?.value_type === "PERCENT"
              ? "Percent (optional)"
              : "Amount per term (optional)"}
          </label>
          <input
            className="form-control"
            type="number"
            min="0"
            step="0.01"
            value={f.value}
            onChange={(e) => setF({ ...f, value: e.target.value })}
          />
          {scheme && (
            <div className="form-text-hint">
              Scheme default: {valueLabel(scheme.value_type, scheme.value)}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Reference & notes ---------- */}
      <h6 className="settings-section__title mt-4 mb-2">Reference &amp; notes</h6>
      <div className="row g-3">
        <div className="col-12">
          <label className="form-label">Award letter or file number (optional)</label>
          <input
            className="form-control"
            value={f.reference_no}
            onChange={(e) => setF({ ...f, reference_no: e.target.value })}
          />
        </div>
        <div className="col-12">
          <label className="form-label">Notes (optional)</label>
          <textarea
            className="form-control"
            rows={2}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy || !student}
        >
          {busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" />
              Saving...
            </>
          ) : (
            "Save award"
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Award detail
// ---------------------------------------------------------------------------
function AwardDetail({ award, onChanged }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState({ kind: "", text: "" });

  const load = useCallback(() => {
    bursaryApi.awards
      .terms(award.id)
      .then((r) => setData(r.data))
      .catch((e) => setMsg({ kind: "error", text: errMsg(e) }));
  }, [award.id]);
  useEffect(() => {
    load();
  }, [load]);

  const reverse = async (t) => {
    const reason = window.prompt(
      `Why reverse ${t.term_label}? The fee charged will go back up.`
    );
    if (!reason) return;
    try {
      await bursaryApi.awards.reverseTerm(award.id, t.id, reason);
      setMsg({ kind: "ok", text: "Reversed." });
      load();
      onChanged();
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e) });
    }
  };

  const reapply = async () => {
    try {
      await bursaryApi.awards.reapply(award.id);
      setMsg({ kind: "ok", text: "Tried again." });
      load();
      onChanged();
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e) });
    }
  };

  const hasSkipped = data?.terms.some((t) => t.status === "SKIPPED");

  return (
    <div>
      {/* ---------- Summary ---------- */}
      <div className="row g-3">
        <div className="col-6 col-md-3">
          <div className="form-label mb-1">Status</div>
          <span className={`badge ${STATUS_BADGE[award.status] || "badge-neutral"}`}>
            {award.status_display}
          </span>
        </div>
        <div className="col-6 col-md-3">
          <div className="form-label mb-1">Value</div>
          <div className="cell-name">
            {valueLabel(award.value_type, award.value)}
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="form-label mb-1">From</div>
          <div className="cell-name">{award.start_term_label}</div>
        </div>
        <div className="col-6 col-md-3">
          <div className="form-label mb-1">Until</div>
          <div className="cell-name">{award.end_term_label || "Until ended"}</div>
        </div>
        {award.reference_no && (
          <div className="col-6 col-md-3">
            <div className="form-label mb-1">Reference</div>
            <div className="cell-mono">{award.reference_no}</div>
          </div>
        )}
        {award.sibling_rank && (
          <div className="col-6 col-md-3">
            <div className="form-label mb-1">Sibling rank</div>
            <div className="cell-name">{award.sibling_rank}</div>
          </div>
        )}
        {award.staff_parent_name && (
          <div className="col-6 col-md-3">
            <div className="form-label mb-1">Staff parent</div>
            <div className="cell-name">{award.staff_parent_name}</div>
          </div>
        )}
        <div className="col-6 col-md-3">
          <div className="form-label mb-1">Requested by</div>
          <div className="cell-name">{award.requested_by_name || "-"}</div>
        </div>
        {award.decision_note && (
          <div className="col-12">
            <div className="form-label mb-1">Decision note</div>
            <div className="text-muted-soft small">{award.decision_note}</div>
          </div>
        )}
      </div>

      {msg.text && (
        <div
          className={`alert alert-${msg.kind === "error" ? "danger" : "success"} mt-3`}
          role={msg.kind === "error" ? "alert" : "status"}
        >
          {msg.text}
        </div>
      )}

      {/* ---------- Term-by-term ---------- */}
      <h6 className="settings-section__title mt-4 mb-2 d-flex justify-content-between align-items-center">
        <span>Term by term</span>
        {hasSkipped && award.status === "APPROVED" && (
          <button
            type="button"
            className="btn btn-sm btn-link p-0"
            onClick={reapply}
          >
            <i className="bi bi-arrow-clockwise me-1" />
            Try skipped terms again
          </button>
        )}
      </h6>

      {!data ? (
        <div className="text-center py-3">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading terms...
        </div>
      ) : data.terms.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-calendar-x" />
          <h6>Nothing applied yet</h6>
          <p className="text-muted-soft">
            It applies once the award is approved and the term's invoice exists.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover table--stack table-sm mb-0">
            <thead>
              <tr>
                <th>Term</th>
                <th>How</th>
                <th className="text-end">Fee</th>
                <th className="text-end">Amount</th>
                <th className="text-end">Received</th>
                <th>Status</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {data.terms.map((t) => (
                <tr key={t.id}>
                  <td data-label="Term" className="cell-name">
                    {t.term_label}
                  </td>
                  <td data-label="How">
                    <span className="badge badge-neutral">
                      {t.settlement === "WAIVER" ? "Fee reduced" : "Funder pays"}
                    </span>
                  </td>
                  <td data-label="Fee" className="cell-num">
                    {fmt(t.gross_fee)}
                  </td>
                  <td data-label="Amount" className="cell-num">
                    {fmt(t.amount)}
                  </td>
                  <td data-label="Received" className="cell-num">
                    {t.settlement === "WAIVER" ? "-" : fmt(t.received)}
                  </td>
                  <td data-label="Status">
                    <span
                      className={`badge ${STATUS_BADGE[t.status] || "badge-neutral"}`}
                    >
                      {t.status_display}
                    </span>
                    {t.note && (
                      <div className="text-muted-soft small mt-1">{t.note}</div>
                    )}
                  </td>
                  <td data-label="Actions">
                    <div className="table-actions">
                      {t.status === "ACTIVE" && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger btn-icon"
                          title="Reverse term"
                          aria-label="Reverse term"
                          onClick={() => reverse(t)}
                        >
                          <i className="bi bi-arrow-counterclockwise" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------- History ---------- */}
      {data?.history?.length > 0 && (
        <>
          <h6 className="settings-section__title mt-4 mb-2">History</h6>
          <ul className="list-unstyled mb-0">
            {data.history.map((h, i) => (
              <li key={i} className="border-bottom py-2 text-muted-soft small">
                <span className="cell-mono text-brand me-2">
                  {new Date(h.at).toLocaleDateString()}
                </span>
                <span className="cell-name text-ink-900 me-1">{h.by}</span>
                {" · "}
                {h.action.toLowerCase().replaceAll("_", " ")}
                {h.detail ? `: ${h.detail}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}