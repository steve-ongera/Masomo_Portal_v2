import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pager,
  COPY_LABEL,
  COPY_BADGE,
  COPY_DOT,
  asList,
  errMsg,
  fmtDate,
  libraryApi,
  spineColor,
  useDebounced,
} from "./shared";
import { academicsApi } from "../../services/api";
import TableSkeleton from "../../components/TableSkeleton";

const EMPTY = {
  title: "",
  author: "",
  isbn: "",
  publisher: "",
  publication_year: "",
  edition: "",
  category: "",
  subject: "",
  grade_level: "",
  shelf_location: "",
  price: "",
  description: "",
  is_active: true,
  copies: 1,
};

function BookForm({ book, categories, subjects, grades, onSaved, onClose, onCategoryAdded }) {
  const [f, setF] = useState(
    book
      ? { ...EMPTY, ...Object.fromEntries(Object.entries(book).map(([k, v]) => [k, v ?? ""])) }
      : EMPTY
  );
  const [newCat, setNewCat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) =>
    setF({
      ...f,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    });

  const addCategory = async () => {
    if (!newCat.trim()) return;
    try {
      const { data } = await libraryApi.createCategory({ name: newCat.trim() });
      onCategoryAdded(data);
      setF({ ...f, category: data.id });
      setNewCat("");
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    const payload = {
      title: f.title,
      author: f.author,
      isbn: f.isbn,
      publisher: f.publisher,
      edition: f.edition,
      publication_year: f.publication_year || null,
      category: f.category || null,
      subject: f.subject || null,
      grade_level: f.grade_level || null,
      shelf_location: f.shelf_location,
      price: f.price || null,
      description: f.description,
      is_active: f.is_active,
    };
    if (!book) payload.copies = Number(f.copies) || 0;
    try {
      book
        ? await libraryApi.updateBook(book.id, payload)
        : await libraryApi.createBook(payload);
      onSaved();
    } catch (e) {
      setError(errMsg(e, "Couldn't save the book."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={book ? "Edit Book" : "Add a Book"} onClose={onClose} size="lg">
      {error && (
        <div className="alert alert-danger mb-3" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
        </div>
      )}

      <h6 className="settings-section__title mb-3">Book Details</h6>
      <div className="row g-3">
        <div className="col-12">
          <label className="form-label">Title</label>
          <input className="form-control" value={f.title} onChange={set("title")} autoFocus />
        </div>

        <div className="col-md-6">
          <label className="form-label">Author</label>
          <input className="form-control" value={f.author} onChange={set("author")} />
        </div>

        <div className="col-md-6">
          <label className="form-label">ISBN</label>
          <input className="form-control" value={f.isbn} onChange={set("isbn")} />
        </div>

        <div className="col-md-6">
          <label className="form-label">Publisher</label>
          <input className="form-control" value={f.publisher} onChange={set("publisher")} />
        </div>

        <div className="col-md-3">
          <label className="form-label">Edition</label>
          <input className="form-control" value={f.edition} onChange={set("edition")} />
        </div>

        <div className="col-md-3">
          <label className="form-label">Year</label>
          <input
            type="number"
            className="form-control"
            value={f.publication_year}
            onChange={set("publication_year")}
          />
        </div>

        <div className="col-md-6">
          <label className="form-label">Shelf Location</label>
          <input
            className="form-control"
            value={f.shelf_location}
            onChange={set("shelf_location")}
            placeholder="e.g. B-12"
          />
        </div>

        <div className="col-md-6">
          <label className="form-label">Category</label>
          <select className="form-select" value={f.category} onChange={set("category")}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="col-md-6">
          <label className="form-label">Add New Category</label>
          <div className="d-flex gap-2">
            <input
              className="form-control"
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder="e.g. Reference"
            />
            <button
              type="button"
              className="btn btn-secondary text-nowrap"
              onClick={addCategory}
            >
              <i className="bi bi-plus-lg me-1"></i>
              Add
            </button>
          </div>
        </div>

        <div className="col-md-6">
          <label className="form-label">Subject (for textbooks)</label>
          <select className="form-select" value={f.subject} onChange={set("subject")}>
            <option value="">None</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="col-md-6">
          <label className="form-label">Grade (for textbooks)</label>
          <select className="form-select" value={f.grade_level} onChange={set("grade_level")}>
            <option value="">None</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        <div className="col-md-6">
          <label className="form-label">Replacement Price (KES)</label>
          <input
            type="number"
            min="0"
            className="form-control"
            value={f.price}
            onChange={set("price")}
          />
        </div>

        {!book && (
          <div className="col-md-6">
            <label className="form-label">Copies to Register</label>
            <input
              type="number"
              min="0"
              max="500"
              className="form-control"
              value={f.copies}
              onChange={set("copies")}
            />
            <div className="form-text-hint">
              You can add more copies later from the Copies dialog.
            </div>
          </div>
        )}

        <div className="col-12">
          <label className="form-label">Description</label>
          <textarea
            className="form-control"
            rows={3}
            value={f.description}
            onChange={set("description")}
            style={{ resize: "vertical" }}
          />
        </div>
      </div>

      {book && (
        <div className="form-check mt-3">
          <input
            id="book-active"
            type="checkbox"
            className="form-check-input"
            checked={f.is_active}
            onChange={set("is_active")}
          />
          <label htmlFor="book-active" className="form-check-label small">
            Active — shown in the catalogue
          </label>
        </div>
      )}

      <div className="mt-4 d-flex gap-2 justify-content-end">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-success"
          onClick={save}
          disabled={saving || !f.title.trim()}
        >
          {saving ? (
            "Saving..."
          ) : (
            <>
              <i className="bi bi-check2 me-1"></i>
              Save Book
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}

function CopiesModal({ book, onClose, onChanged }) {
  const [copies, setCopies] = useState([]);
  const [n, setN] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await libraryApi.copies(book.id);
      setCopies(r.data);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [book.id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setError("");
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <Modal title={`Copies of ${book.title}`} onClose={onClose} size="lg">
      {error && (
        <div className="alert alert-danger mb-3" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
        </div>
      )}

      <div className="row g-3 align-items-end mb-3">
        <div className="col-sm-4 col-md-3">
          <label className="form-label">Add Copies</label>
          <input
            type="number"
            min="1"
            max="200"
            className="form-control"
            value={n}
            onChange={(e) => setN(e.target.value)}
          />
        </div>
        <div className="col-sm-4 col-md-3">
          <button
            className="btn btn-primary w-100"
            onClick={() => act(() => libraryApi.addCopies(book.id, Number(n)))}
          >
            <i className="bi bi-plus-lg me-1"></i>
            Add Copies
          </button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : copies.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-collection"></i>
          <h6>No copies registered</h6>
          <p className="text-muted-soft">Add copies above to start tracking them.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th style={{ width: "140px" }}>Accession No.</th>
                <th style={{ width: "130px" }}>Status</th>
                <th>Details</th>
                <th style={{ width: "180px" }}>Change Status</th>
              </tr>
            </thead>
            <tbody>
              {copies.map((c) => {
                const badge = COPY_BADGE[c.status] || "badge-neutral";
                const dot = COPY_DOT[c.status] || "status-dot--offline";
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="cell-mono text-brand fw-semibold">
                        {c.accession_no}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${badge}`}>
                        <span className={`status-dot ${dot}`}></span>
                        {COPY_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td className="cell-muted small">
                      {c.borrower ? (
                        <>
                          <i className="bi bi-person me-1"></i>
                          {c.borrower.name} · due {fmtDate(c.borrower.due_on)}
                        </>
                      ) : (
                        <>
                          <i className="bi bi-calendar-plus me-1"></i>
                          Added {fmtDate(c.acquired_on)}
                        </>
                      )}
                    </td>
                    <td>
                      {c.status !== "ON_LOAN" ? (
                        <select
                          className="form-select"
                          aria-label="Change status"
                          value={c.status}
                          onChange={(e) =>
                            act(() => libraryApi.setCopyStatus(c.id, e.target.value))
                          }
                        >
                          {["AVAILABLE", "DAMAGED", "LOST", "WITHDRAWN"].map((s) => (
                            <option key={s} value={s}>{COPY_LABEL[s]}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="cell-muted small">
                          On loan
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function Catalogue() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [category, setCategory] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ count: 0, results: [] });
  const [categories, setCategories] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [copiesFor, setCopiesFor] = useState(null);

  useEffect(() => {
    libraryApi.categories().then((r) => setCategories(asList(r))).catch(() => {});
    academicsApi.subjects().then((r) => setSubjects(asList(r))).catch(() => {});
    academicsApi.gradeLevels().then((r) => setGrades(asList(r))).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await libraryApi.books({
        q: dq || undefined,
        category: category || undefined,
        available: availableOnly ? 1 : undefined,
        page,
      });
      setData(r.data);
    } catch (e) {
      setError(errMsg(e, "Couldn't load the catalogue."));
      setData({ count: 0, results: [] });
    } finally {
      setLoading(false);
    }
  }, [dq, category, availableOnly, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [dq, category, availableOnly]);

  const remove = async (b) => {
    if (!window.confirm(`Delete "${b.title}" and all its copies?`)) return;
    try {
      await libraryApi.deleteBook(b.id);
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const hasFilters = !!(dq || category || availableOnly);

  const clearFilters = () => {
    setQ("");
    setCategory("");
    setAvailableOnly(false);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Catalogue</h1>
          <p className="page-subtitle">Every title, with its copies and shelf location</p>
        </div>
        <div className="page-header__actions">
          <button className="btn btn-primary btn-sm" onClick={() => setForm({})}>
            <i className="bi bi-plus-lg"></i>
            Add a Book
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button type="button" className="btn-close" onClick={() => setError("")}></button>
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
                placeholder="Search title, author, ISBN or accession no..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <select
              className="form-select w-auto"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <div className="toolbar__filter">
              <div className="form-check mb-0 d-flex align-items-center gap-2">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                />
                <span className="form-check-label small text-nowrap">
                  Available only
                </span>
              </div>
            </div>

            {hasFilters && (
              <button className="btn btn-sm btn-light" onClick={clearFilters}>
                <i className="bi bi-x-lg me-1"></i>
                Clear
              </button>
            )}
          </div>

          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="chart-card__title mb-0">
              <i className="bi bi-book me-2 text-brand"></i>
              Books
            </span>
            <span className="chart-card__subtitle mb-0">
              {data.count} title{data.count === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={6} />
        ) : data.results.length === 0 ? (
          <div className="empty-state">
            <i className="bi bi-book"></i>
            <h6>{hasFilters ? "No books match your search" : "No books in the catalogue yet"}</h6>
            <p className="text-muted-soft mb-3">
              {hasFilters
                ? "Try a different search or clear the filters."
                : "Add the first title to begin building the library."}
            </p>
            {hasFilters ? (
              <button className="btn btn-light" onClick={clearFilters}>
                <i className="bi bi-x-lg me-1"></i>
                Clear Filters
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setForm({})}>
                <i className="bi bi-plus-lg me-1"></i>
                Add the First Book
              </button>
            )}
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: "160px" }}>Category</th>
                  <th style={{ width: "200px" }}>Textbook For</th>
                  <th style={{ width: "110px" }}>Shelf</th>
                  <th className="text-end" style={{ width: "120px" }}>Available</th>
                  <th style={{ width: "220px" }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((b) => (
                  <tr key={b.id} style={b.is_active ? undefined : { opacity: 0.55 }}>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <span
                          style={{
                            width: 4,
                            height: 32,
                            borderRadius: "var(--radius-sm)",
                            background: spineColor(b.category_name || ""),
                            flexShrink: 0,
                          }}
                          title={b.category_name || ""}
                        ></span>
                        <div className="min-w-0">
                          <div className="cell-name">{b.title}</div>
                          <div className="cell-muted small mt-1">
                            {b.author || "Unknown author"}
                            {!b.is_active && " (hidden)"}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td>
                      {b.category_name ? (
                        <span className="badge badge-blue">{b.category_name}</span>
                      ) : (
                        <span className="cell-muted">—</span>
                      )}
                    </td>

                    <td className="cell-muted small">
                      {[b.subject_name, b.grade_level_name].filter(Boolean).join(", ") || (
                        <span className="cell-muted">—</span>
                      )}
                    </td>

                    <td className="cell-muted small">
                      {b.shelf_location || <span className="cell-muted">—</span>}
                    </td>

                    <td className="text-end">
                      <span
                        className="cell-mono fw-bold"
                        style={{
                          color:
                            b.available_copies > 0
                              ? "var(--success-600)"
                              : "var(--danger-600)",
                        }}
                      >
                        {b.available_copies}
                      </span>
                      <span className="cell-muted fw-semibold">
                        {" "}
                        / {b.total_copies}
                      </span>
                    </td>

                    <td className="text-end">
                      <div className="table-actions justify-content-end">
                        <button
                          className="btn btn-sm btn-outline-primary btn-icon"
                          title="Manage copies"
                          aria-label="Manage copies"
                          onClick={() => setCopiesFor(b)}
                        >
                          <i className="bi bi-collection"></i>
                        </button>
                        <button
                          className="btn btn-sm btn-outline-secondary btn-icon"
                          title="Edit book"
                          aria-label="Edit book"
                          onClick={() => setForm(b)}
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger btn-icon"
                          title="Delete book"
                          aria-label="Delete book"
                          onClick={() => remove(b)}
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

        {!loading && data.results.length > 0 && (
          <Pager page={page} count={data.count} onPage={setPage} />
        )}
      </div>

      {form && (
        <BookForm
          book={form.id ? form : null}
          categories={categories}
          subjects={subjects}
          grades={grades}
          onCategoryAdded={(c) => setCategories((cs) => [...cs, c])}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}

      {copiesFor && (
        <CopiesModal
          book={copiesFor}
          onClose={() => setCopiesFor(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}