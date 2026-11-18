// src/pages/teacher/assignments/Assignments.jsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { assignmentsApi, errMsg } from "../../../services/api";
import TableSkeleton from "../../../components/TableSkeleton";
import Modal from "../../../components/Modal";

const KINDS = [
  ["ASSIGNMENT", "Assignment"],
  ["CAT", "CAT"],
  ["TAKEAWAY", "Take-away"],
  ["HOMEWORK", "Homework"],
  ["HOLIDAY", "Holiday Homework"],
  ["REVISION", "Revision Material"],
];

const KIND_BADGE = {
  ASSIGNMENT: "badge-blue",
  CAT: "badge-danger",
  TAKEAWAY: "badge-blue",
  HOMEWORK: "badge-success",
  HOLIDAY: "badge-gold",
  REVISION: "badge-neutral",
};

const fmtSize = (b) =>
  b > 1048576
    ? `${(b / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(b / 1024))} KB`;

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

function MaterialForm({ classesData, initial, onClose, onSaved }) {
  const editing = !!initial;

  const [kind, setKind] = useState(initial?.kind || "ASSIGNMENT");
  const [title, setTitle] = useState(initial?.title || "");
  const [subject, setSubject] = useState(
    initial?.subject ? String(initial.subject) : ""
  );
  const [classrooms, setClassrooms] = useState(initial?.classroom_ids || []);
  const [term, setTerm] = useState(
    initial?.term
      ? String(initial.term)
      : String(classesData.current_term_id || "")
  );
  const [dueDate, setDueDate] = useState(initial?.due_date || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [body, setBody] = useState(initial?.body || "");
  const [publish, setPublish] = useState(initial ? initial.is_published : true);
  const [file, setFile] = useState(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const subjectEntry = classesData.subjects.find(
    (s) => String(s.subject_id) === subject
  );

  const toggleClass = (id) =>
    setClassrooms((cur) =>
      cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]
    );

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("title", title.trim());
      fd.append("subject", subject);
      classrooms.forEach((c) => fd.append("classrooms", c));
      fd.append("term", term || "");
      fd.append("due_date", dueDate || "");
      fd.append("description", description);
      fd.append("body", body);
      fd.append("is_published", publish ? "true" : "false");
      if (file) fd.append("file", file);
      if (removeFile && !file) fd.append("remove_file", "true");
      if (editing) await assignmentsApi.teacher.update(initial.id, fd);
      else await assignmentsApi.teacher.create(fd);
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      show={true}
      onClose={onClose}
      title={`${editing ? "Edit" : "New"} Assignment / Revision Material`}
      size="lg"
    >
      <form onSubmit={submit}>
        {error && (
          <div className="alert alert-danger mb-3" role="alert">
            <i className="bi bi-exclamation-triangle me-1"></i>
            {error}
          </div>
        )}

        <h6 className="settings-section__title mb-3">Details</h6>
        <div className="row g-3">
          <div className="col-md-5">
            <label className="form-label">Type</label>
            <select
              className="form-select"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {KINDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-7">
            <label className="form-label">Title</label>
            <input
              className="form-control"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Mathematics CAT 1 - Quadratics"
            />
          </div>

          <div className="col-md-6">
            <label className="form-label">Subject</label>
            <select
              className="form-select"
              required
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setClassrooms([]);
              }}
            >
              <option value="">Select subject...</option>
              {classesData.subjects.map((s) => (
                <option key={s.subject_id} value={s.subject_id}>
                  {s.subject_name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label">Term</label>
            <select
              className="form-select"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            >
              <option value="">Current term</option>
              {classesData.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label">Due / Reopening Date</label>
            <input
              type="date"
              className="form-control"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="col-12">
            <label className="form-label">Send to Classes</label>
            {!subjectEntry ? (
              <div className="form-text-hint">
                <i className="bi bi-info-circle me-1"></i>
                Pick a subject first — only classes you are allocated will show.
              </div>
            ) : subjectEntry.classrooms.length === 0 ? (
              <div className="form-text-hint">
                <i className="bi bi-info-circle me-1"></i>
                You aren't allocated to any classroom for this subject.
              </div>
            ) : (
              <div className="bulk-list d-flex flex-wrap gap-3">
                {subjectEntry.classrooms.map((c) => (
                  <div className="form-check" key={c.id}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`cls-${c.id}`}
                      checked={classrooms.includes(c.id)}
                      onChange={() => toggleClass(c.id)}
                    />
                    <label
                      className="form-check-label small"
                      htmlFor={`cls-${c.id}`}
                    >
                      {c.label}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <h6 className="settings-section__title mt-4 mb-3">Content</h6>
        <div className="row g-3">
          <div className="col-12">
            <label className="form-label">
              Instructions{" "}
              <span className="text-muted-soft fw-normal">
                (optional, short)
              </span>
            </label>
            <input
              className="form-control"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Do all questions in your assignment book. Bring it on Monday."
            />
          </div>

          <div className="col-12">
            <label className="form-label">
              Text Content{" "}
              <span className="text-muted-soft fw-normal">
                (type the questions / notes here)
              </span>
            </label>
            <textarea
              className="form-control"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ resize: "vertical" }}
            />
          </div>

          <div className="col-12">
            <label className="form-label">
              Attach a File{" "}
              <span className="text-muted-soft fw-normal">
                (PDF, Word, PowerPoint, image or text — max 15 MB)
              </span>
            </label>

            {editing && initial.has_file && !file && (
              <div className="note-card mt-0 mb-2">
                <span>
                  <i className="bi bi-paperclip me-1"></i>
                  {initial.original_filename} ({fmtSize(initial.file_size)})
                </span>
                <div className="form-check mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="rmfile"
                    checked={removeFile}
                    onChange={(e) => setRemoveFile(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="rmfile">
                    Remove it
                  </label>
                </div>
              </div>
            )}

            <input
              type="file"
              className="form-control"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {editing && initial.has_file && (
              <div className="form-text-hint">
                Choosing a new file replaces the current one.
              </div>
            )}
          </div>

          <div className="col-12">
            <div className={`status-panel ${publish ? "status-panel--active" : ""}`}>
              <div className="form-check form-switch mb-0">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="pub"
                  checked={publish}
                  onChange={(e) => setPublish(e.target.checked)}
                />
                <label
                  className="form-check-label small fw-semibold"
                  htmlFor="pub"
                >
                  {publish
                    ? "Publish now — students can see it"
                    : "Save as draft — students won't see it yet"}
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 d-flex gap-2 justify-content-end">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || !title.trim() || !subject}
          >
            {saving ? (
              "Saving..."
            ) : (
              <>
                <i className="bi bi-check2 me-1"></i>
                {editing
                  ? "Save Changes"
                  : publish
                  ? "Publish"
                  : "Save Draft"}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function TeacherAssignments() {
  const [classesData, setClassesData] = useState({
    subjects: [],
    terms: [],
    current_term_id: null,
  });
  const [data, setData] = useState({ results: [], count: 0 });
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    kind: "",
    subject: "",
    is_published: "",
    search: "",
  });
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);

  useEffect(() => {
    let alive = true;
    assignmentsApi.teacher
      .myClasses()
      .then((r) => {
        if (alive) setClassesData(r.data);
      })
      .catch((e) => {
        if (alive) setError(errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Debounce search input → filters.search
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setFilters((f) => ({ ...f, search: searchInput }));
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page,
        ...Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v !== "")
        ),
      };
      const r = await assignmentsApi.teacher.list(params);
      setData(r.data);
      setError("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (k, v) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: v }));
  };

  const hasFilters = !!(
    filters.search ||
    filters.kind ||
    filters.subject ||
    filters.is_published
  );

  const clearFilters = () => {
    setSearchInput("");
    setFilters({ kind: "", subject: "", is_published: "", search: "" });
    setPage(1);
  };

  const openEdit = async (item) => {
    try {
      const r = await assignmentsApi.teacher.get(item.id);
      setForm(r.data);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const act = async (fn) => {
    try {
      await fn();
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const remove = (item) => {
    if (
      !window.confirm(
        `Delete "${item.title}"? Students will no longer see it and its tracking history is lost.`
      )
    )
      return;
    act(() => assignmentsApi.teacher.remove(item.id));
  };

  const pages = Math.max(1, Math.ceil(data.count / 20));
  const hasClasses = classesData.subjects.length > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Assignments &amp; Revision Material
          </h1>
          <p className="page-subtitle">
            Send CATs, take-aways, homework, holiday homework and revision
            notes to your classes.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setForm({})}
            disabled={!hasClasses}
          >
            <i className="bi bi-plus-lg"></i>
            New
          </button>
        </div>
      </div>

      {!hasClasses && !error && (
        <div className="alert alert-warning d-flex align-items-start gap-2">
          <i className="bi bi-exclamation-triangle mt-1"></i>
          <span>
            You have no subject allocations for the current year yet. Ask the
            admin to allocate your subjects.
          </span>
        </div>
      )}

      {error && (
        <div
          className="alert alert-danger alert-dismissible fade show"
          role="alert"
        >
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button
            type="button"
            className="btn-close"
            onClick={() => setError("")}
          ></button>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0" style={{ width: "100%" }}>
            <div className="toolbar__search" style={{ maxWidth: "none" }}>
              <i className="bi bi-search"></i>
              <input
                type="text"
                className="form-control"
                placeholder="Search title or subject..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            <select
              className="form-select w-auto"
              value={filters.kind}
              onChange={(e) => setFilter("kind", e.target.value)}
            >
              <option value="">All types</option>
              {KINDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>

            <select
              className="form-select w-auto"
              value={filters.subject}
              onChange={(e) => setFilter("subject", e.target.value)}
            >
              <option value="">All subjects</option>
              {classesData.subjects.map((s) => (
                <option key={s.subject_id} value={s.subject_id}>
                  {s.subject_name}
                </option>
              ))}
            </select>

            <select
              className="form-select w-auto"
              value={filters.is_published}
              onChange={(e) => setFilter("is_published", e.target.value)}
            >
              <option value="">Published &amp; drafts</option>
              <option value="true">Published</option>
              <option value="false">Drafts</option>
            </select>

            {hasFilters && (
              <button
                className="btn btn-sm btn-light"
                onClick={clearFilters}
              >
                <i className="bi bi-x-lg me-1"></i>
                Clear
              </button>
            )}
          </div>

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title mb-0">
              <i className="bi bi-journal-text me-2 text-brand"></i>
              Materials
            </span>
            <span className="chart-card__subtitle mb-0">
              {data.count} item{data.count === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={8} />
        ) : data.results.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-journal-text"></i>
            <h6>
              {hasFilters
                ? "No materials match your filters"
                : "Nothing here yet"}
            </h6>
            <p className="text-muted-soft mb-3">
              {hasFilters
                ? "Try a different search or clear the filters."
                : 'Click "New" to send your first assignment or revision material.'}
            </p>
            {hasFilters ? (
              <button className="btn btn-light" onClick={clearFilters}>
                <i className="bi bi-x-lg me-1"></i>
                Clear Filters
              </button>
            ) : (
              hasClasses && (
                <button
                  className="btn btn-primary"
                  onClick={() => setForm({})}
                >
                  <i className="bi bi-plus-lg me-1"></i>
                  New Material
                </button>
              )
            )}
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: "140px" }}>Subject</th>
                  <th style={{ width: "180px" }}>Classes</th>
                  <th style={{ width: "120px" }}>Due</th>
                  <th style={{ width: "120px" }}>Status</th>
                  <th className="text-center" style={{ width: "110px" }}>
                    Opened
                  </th>
                  <th className="text-center" style={{ width: "120px" }}>
                    Downloaded
                  </th>
                  <th style={{ width: "220px" }} className="text-end">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="cell-name">{m.title}</div>
                      <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
                        <span
                          className={`badge ${
                            KIND_BADGE[m.kind] || "badge-neutral"
                          }`}
                        >
                          {m.kind_display}
                        </span>
                        {m.has_file && (
                          <span className="cell-muted small">
                            <i className="bi bi-paperclip me-1"></i>
                            {m.original_filename}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="cell-muted small">
                      {m.subject_name}
                    </td>

                    <td className="cell-muted small">
                      {m.classrooms_info.length === 0 ? (
                        <span className="cell-muted">—</span>
                      ) : (
                        m.classrooms_info.map((c) => c.label).join(", ")
                      )}
                    </td>

                    <td className="cell-mono text-nowrap">
                      {fmtDate(m.due_date)}
                    </td>

                    <td>
                      {m.is_published ? (
                        <span className="badge badge-success">
                          <span className="status-dot status-dot--online"></span>
                          Published
                        </span>
                      ) : (
                        <span className="badge badge-neutral">
                          <span className="status-dot status-dot--offline"></span>
                          Draft
                        </span>
                      )}
                    </td>

                    <td className="text-center">
                      <span
                        className="cell-mono fw-semibold"
                        style={{
                          color:
                            m.viewed_count === m.recipients_count &&
                            m.recipients_count > 0
                              ? "var(--success-600)"
                              : "var(--ink-900)",
                        }}
                      >
                        {m.viewed_count}
                      </span>
                      <span className="cell-muted">
                        {" "}
                        / {m.recipients_count}
                      </span>
                    </td>

                    <td className="text-center">
                      {m.has_file ? (
                        <>
                          <span
                            className="cell-mono fw-semibold"
                            style={{
                              color:
                                m.downloaded_count === m.recipients_count &&
                                m.recipients_count > 0
                                  ? "var(--success-600)"
                                  : "var(--ink-900)",
                            }}
                          >
                            {m.downloaded_count}
                          </span>
                          <span className="cell-muted">
                            {" "}
                            / {m.recipients_count}
                          </span>
                        </>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>

                    <td className="text-end">
                      <div className="table-actions justify-content-end">
                        <Link
                          className="btn btn-sm btn-outline-primary btn-icon"
                          to={`/teacher/assignments/${m.id}/tracking`}
                          title="Who opened / downloaded"
                          aria-label="Who opened / downloaded"
                        >
                          <i className="bi bi-bar-chart"></i>
                        </Link>

                        <button
                          className="btn btn-sm btn-outline-secondary btn-icon"
                          onClick={() => openEdit(m)}
                          title="Edit"
                          aria-label="Edit"
                        >
                          <i className="bi bi-pencil"></i>
                        </button>

                        {m.is_published ? (
                          <button
                            className="btn btn-sm btn-outline-warning btn-icon"
                            title="Unpublish"
                            aria-label="Unpublish"
                            onClick={() =>
                              act(() =>
                                assignmentsApi.teacher.unpublish(m.id)
                              )
                            }
                          >
                            <i className="bi bi-eye-slash"></i>
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm btn-outline-success btn-icon"
                            title="Publish"
                            aria-label="Publish"
                            onClick={() =>
                              act(() => assignmentsApi.teacher.publish(m.id))
                            }
                          >
                            <i className="bi bi-send"></i>
                          </button>
                        )}

                        <button
                          className="btn btn-sm btn-outline-danger btn-icon"
                          onClick={() => remove(m)}
                          title="Delete"
                          aria-label="Delete"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && pages > 1 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              Page <strong>{page}</strong> of <strong>{pages}</strong> ·{" "}
              <strong>{data.count}</strong> item
              {data.count === 1 ? "" : "s"}
            </span>
            <div className="d-flex gap-2">
              <button
                className="btn btn-sm btn-outline-primary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <i className="bi bi-chevron-left me-1"></i>
                Previous
              </button>
              <button
                className="btn btn-sm btn-outline-primary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next
                <i className="bi bi-chevron-right ms-1"></i>
              </button>
            </div>
          </div>
        )}
      </div>

      {form && (
        <MaterialForm
          classesData={classesData}
          initial={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}
    </div>
  );
}