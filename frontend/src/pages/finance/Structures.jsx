import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { financeApi, calendarApi, academicsApi, schoolApi } from "../../services/api";
import logoImage from "../../assets/nyali_school_logo.png";

const currency = (value) => Number(value || 0).toLocaleString();

const emptyItem = () => ({ name: "", amount: "" });

// Load an image URL as a base64 data URL (for embedding the logo in PDFs)
const getImageBase64 = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
  });

export default function FinanceStructures() {
  const [structures, setStructures] = useState([]);
  const [gradeLevels, setGradeLevels] = useState([]);
  const [academicYears, setAcademicYears] = useState([]);
  const [terms, setTerms] = useState([]);
  const [school, setSchool] = useState(null);

  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // ---- create form state ----
  const [form, setForm] = useState({ academic_year: "", grade_level: "", term: "" });
  const [items, setItems] = useState([emptyItem()]);

  // ---- list filters ----
  const [filters, setFilters] = useState({ term__academic_year: "", grade_level: "" });

  // ---- inline edit state (per fee structure) ----
  const [editingId, setEditingId] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadStructures = async (params = {}) => {
    setLoading(true);
    try {
      const { data } = await financeApi.feeStructures(params);
      setStructures(data.results ?? data);
    } catch (error) {
      console.error("Failed to load structures:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    academicsApi.gradeLevels().then(({ data }) => setGradeLevels(data.results ?? data));
    calendarApi.academicYears().then(({ data }) => setAcademicYears(data.results ?? data));
    calendarApi.terms().then(({ data }) => setTerms(data.results ?? data));
    schoolApi.list().then(({ data }) => setSchool((data.results ?? data)[0] || null));
    loadStructures();
  }, []);

  useEffect(() => {
    const params = {};
    if (filters.term__academic_year) params.term__academic_year = filters.term__academic_year;
    if (filters.grade_level) params.grade_level = filters.grade_level;
    loadStructures(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const formTerms = useMemo(
    () => terms.filter((t) => !form.academic_year || String(t.academic_year) === String(form.academic_year)),
    [terms, form.academic_year]
  );

  const existingCombos = useMemo(
    () => new Set(structures.map((s) => `${s.grade_level}-${s.term}`)),
    [structures]
  );
  const isDuplicate = form.grade_level && form.term && existingCombos.has(`${form.grade_level}-${form.term}`);

  const total = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  const updateItem = (idx, field, value) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const resetForm = () => {
    setForm({ academic_year: "", grade_level: "", term: "" });
    setItems([emptyItem()]);
  };

  const refreshList = () =>
    loadStructures({
      ...(filters.term__academic_year ? { term__academic_year: filters.term__academic_year } : {}),
      ...(filters.grade_level ? { grade_level: filters.grade_level } : {}),
    });

  const submit = async (e) => {
    e.preventDefault();
    setMessage(null);

    const cleanItems = items
      .filter((i) => i.name.trim() && i.amount !== "")
      .map((i) => ({ name: i.name.trim(), amount: Number(i.amount) }));

    if (!form.grade_level || !form.term) {
      setMessage({ type: "danger", text: "Select a grade and term." });
      return;
    }
    if (cleanItems.length === 0) {
      setMessage({ type: "danger", text: "Add at least one fee item." });
      return;
    }
    if (isDuplicate) {
      setMessage({ type: "danger", text: "A fee structure already exists for this grade and term." });
      return;
    }

    setSaving(true);
    try {
      await financeApi.createFeeStructure({
        grade_level: form.grade_level,
        term: form.term,
        total_amount: total,
        items: cleanItems,
      });
      setMessage({ type: "success", text: " Fee structure created successfully." });
      resetForm();
      refreshList();
    } catch (err) {
      const data = err.response?.data;
      const text =
        data?.non_field_errors?.[0] ||
        (typeof data === "object" ? JSON.stringify(data) : null) ||
        "Could not create fee structure — it may already exist for this grade and term.";
      setMessage({ type: "danger", text });
    } finally {
      setSaving(false);
    }
  };

  // ---- Inline edit (items + total) for an existing fee structure ----
  const startEdit = (structure) => {
    setMessage(null);
    setEditingId(structure.id);
    setEditItems(
      (structure.items || []).length > 0
        ? structure.items.map((i) => ({ name: i.name, amount: i.amount }))
        : [emptyItem()]
    );
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditItems([]);
  };

  const updateEditItem = (idx, field, value) => {
    setEditItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };
  const addEditItem = () => setEditItems((prev) => [...prev, emptyItem()]);
  const removeEditItem = (idx) => setEditItems((prev) => prev.filter((_, i) => i !== idx));

  const editTotal = editItems.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  const saveEdit = async (id) => {
    setMessage(null);
    const cleanItems = editItems
      .filter((i) => i.name.trim() && i.amount !== "")
      .map((i) => ({ name: i.name.trim(), amount: Number(i.amount) }));

    if (cleanItems.length === 0) {
      setMessage({ type: "danger", text: "Add at least one fee item." });
      return;
    }

    setEditSaving(true);
    try {
      await financeApi.updateFeeStructure(id, {
        total_amount: editTotal,
        items: cleanItems,
      });
      setMessage({ type: "success", text: " Fee structure updated successfully." });
      cancelEdit();
      refreshList();
    } catch (err) {
      const data = err.response?.data;
      const text =
        data?.non_field_errors?.[0] ||
        (typeof data === "object" ? JSON.stringify(data) : null) ||
        "Could not update fee structure.";
      setMessage({ type: "danger", text });
    } finally {
      setEditSaving(false);
    }
  };

  const deleteStructure = async (structure) => {
    const confirmed = window.confirm(
      `Delete the fee structure for ${structure.grade_level_name} — ${structure.term_label}? This cannot be undone.`
    );
    if (!confirmed) return;

    setMessage(null);
    setDeletingId(structure.id);
    try {
      await financeApi.deleteFeeStructure(structure.id);
      setMessage({ type: "success", text: " Fee structure deleted." });
      if (editingId === structure.id) cancelEdit();
      refreshList();
    } catch (err) {
      setMessage({ type: "danger", text: "Could not delete fee structure." });
    } finally {
      setDeletingId(null);
    }
  };

  // ---- Professional fee-structure PDF with logo + signature/stamp blocks ----
  const downloadPdf = async (structure) => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const base64Logo = await getImageBase64(logoImage);

    const schoolName = school?.name || "The Nyali School";
    const generatedOn = new Date().toLocaleDateString("en-KE", {
      year: "numeric", month: "long", day: "numeric",
    });

    // --- Header: logo + school name + report title + generated date ---
    if (base64Logo) {
      doc.addImage(base64Logo, "PNG", 12, 10, 14, 14);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text(schoolName, base64Logo ? 30 : 12, 17);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text("Fee Structure", base64Logo ? 30 : 12, 23);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated ${generatedOn}`, pageWidth - 12, 16, { align: "right" });

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(12, 28, pageWidth - 12, 28);

    // --- Meta block (Grade · Term · Academic Year · Curriculum) ---
    autoTable(doc, {
      startY: 32,
      theme: "grid",
      body: [
        ["Grade", structure.grade_level_name || "-", "Term", structure.term_label || "-"],
        [
          "Academic Year",
          structure.academic_year_label || "-",
          "Curriculum",
          structure.curriculum_display || structure.curriculum_type || "-",
        ],
      ],
      styles: {
        fontSize: 9,
        cellPadding: 2.5,
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        textColor: [51, 65, 85],
      },
      columnStyles: {
        0: { cellWidth: 34, fontStyle: "bold", fillColor: [241, 245, 249], textColor: [71, 85, 105] },
        1: { cellWidth: 60 },
        2: { cellWidth: 34, fontStyle: "bold", fillColor: [241, 245, 249], textColor: [71, 85, 105] },
        3: { cellWidth: "auto" },
      },
      margin: { left: 12, right: 12 },
    });

    const cursorY = doc.lastAutoTable.finalY + 6;

    // --- Fee items table ---
    const items = structure.items || [];
    const tableRows = items.map((it, i) => [
      String(i + 1),
      it.name || "-",
      currency(it.amount),
    ]);

    // Total row appended as the last body row, styled via didParseCell below
    const totalRow = ["", "TOTAL DUE", currency(structure.total_amount)];
    const allRows = [...tableRows, totalRow];

    autoTable(doc, {
      startY: cursorY,
      head: [["#", "Fee Item", "Amount (KES)"]],
      body: allRows,
      theme: "grid",
      styles: {
        fontSize: 9.5,
        cellPadding: 2.5,
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        textColor: [51, 65, 85],
        overflow: "ellipsize",
        valign: "middle",
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 9,
        cellPadding: 2.5,
        halign: "left",
      },
      bodyStyles: {
        fontSize: 9.5,
        textColor: [51, 65, 85],
        cellPadding: 2.5,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: "auto", halign: "left" },
        2: { cellWidth: 42, halign: "right" },
      },
      margin: { left: 12, right: 12 },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        // The last row is the Total row
        if (data.row.index === allRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.textColor = [15, 23, 42];
          data.cell.styles.fontSize = 10.5;
          if (data.column.index === 2) {
            data.cell.styles.textColor = [15, 23, 42];
          }
        }
      },
      didDrawPage: () => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${doc.internal.getNumberOfPages()}`,
          pageWidth - 12,
          pageHeight - 6,
          { align: "right" }
        );
        doc.text(`${schoolName} — Finance Department`, 12, pageHeight - 6);
      },
    });

    // --- Signature / stamp blocks: Finance Officer + Principal ---
    let finalY = doc.lastAutoTable.finalY + 16;
    if (finalY > pageHeight - 30) {
      doc.addPage();
      finalY = 26;
    }

    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.2);

    // Finance Officer (left)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("Finance Officer's Signature:", 12, finalY);
    doc.line(12, finalY + 10, 90, finalY + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("Sign & Official Stamp", 12, finalY + 14);

    // Principal (right)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("Headteacher's Sign:", pageWidth - 90, finalY);
    doc.line(pageWidth - 90, finalY + 10, pageWidth - 12, finalY + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text("Sign & Official Stamp", pageWidth - 90, finalY + 14);

    // --- Small footer note ---
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      "This fee structure is valid for the grade and term shown above. Please retain a copy for your records.",
      12,
      pageHeight - 12
    );

    doc.save(
      `FeeStructure_${(structure.grade_level_name || "grade").replace(/\s+/g, "_")}_${(structure.term_label || "term").replace(/\s+/g, "_")}.pdf`
    );
  };

  const clearFilters = () => {
    setFilters({ term__academic_year: "", grade_level: "" });
  };

  const hasActiveFilters = filters.term__academic_year || filters.grade_level;

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Fee Structures</h1>
          <p className="page-subtitle">
            Create a fee structure once per grade and term. Each is downloadable as a PDF to hand out to students.
          </p>
        </div>
        <div className="page-header__actions">
          <span className="badge badge-blue">
            <i className="bi bi-cash-stack me-1"></i>
            {structures.length} structure{structures.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Messages */}
      {message && (
        <div className={`alert alert-${message.type} alert-dismissible fade show`} role="alert">
          {message.text}
          <button type="button" className="btn-close" onClick={() => setMessage(null)}></button>
        </div>
      )}

      {/* Create Form */}
      <div className="card mb-3">
        <div className="card-header">
          <i className="bi bi-plus-circle me-2 text-brand"></i>
          New Fee Structure
        </div>
        <div className="card-body">
          <form onSubmit={submit}>
            <div className="row g-3 mb-3">
              <div className="col-md-4">
                <label className="form-label">Academic Year</label>
                <select
                  className="form-select"
                  value={form.academic_year}
                  onChange={(e) => setForm({ ...form, academic_year: e.target.value, term: "" })}
                >
                  <option value="">Select...</option>
                  {academicYears.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.year}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">Grade</label>
                <select
                  className="form-select"
                  required
                  value={form.grade_level}
                  onChange={(e) => setForm({ ...form, grade_level: e.target.value })}
                >
                  <option value="">Select...</option>
                  {gradeLevels.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label">Term</label>
                <select
                  className="form-select"
                  required
                  value={form.term}
                  onChange={(e) => setForm({ ...form, term: e.target.value })}
                  disabled={!form.academic_year}
                >
                  <option value="">{form.academic_year ? "Select..." : "Choose academic year first"}</option>
                  {formTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      Term {t.term_number}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isDuplicate && (
              <div className="alert alert-warning">
                <i className="bi bi-exclamation-triangle me-2"></i>
                A fee structure already exists for this grade and term. Edit or delete the existing one instead of
                creating a duplicate.
              </div>
            )}

            <div className="settings-section__title">Fee Items</div>
            <div className="settings-section__desc mb-2">
              Add each charge for this grade and term, e.g. Tuition, Boarding or Activity fee.
            </div>
            {items.map((item, idx) => (
              <div className="item-row" key={idx}>
                <input
                  className="form-control"
                  placeholder="e.g. Tuition, Boarding, Activity fee"
                  value={item.name}
                  onChange={(e) => updateItem(idx, "name", e.target.value)}
                />
                <input
                  type="number"
                  className="form-control cell-mono"
                  placeholder="Amount (KES)"
                  value={item.amount}
                  onChange={(e) => updateItem(idx, "amount", e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-outline-danger btn-icon"
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  aria-label="Remove item"
                  title="Remove item"
                >
                  <i className="bi bi-trash"></i>
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addItem}>
              <i className="bi bi-plus-lg"></i> Add Item
            </button>

            <div className="total-bar">
              <div>
                <div className="total-bar__label">Total</div>
                <div className="total-bar__value">KES {currency(total)}</div>
              </div>
              <button className="btn btn-primary" disabled={saving || isDuplicate}>
                {saving ? "Saving..." : "Create Fee Structure"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Filters */}
      <div className="toolbar">
        <span className="section-label me-1">
          <i className="bi bi-funnel me-1"></i>Filter
        </span>
        <select
          className="form-select w-auto"
          aria-label="Academic year"
          value={filters.term__academic_year}
          onChange={(e) => setFilters({ ...filters, term__academic_year: e.target.value })}
        >
          <option value="">All years</option>
          {academicYears.map((y) => (
            <option key={y.id} value={y.id}>
              {y.year}
            </option>
          ))}
        </select>
        <select
          className="form-select w-auto"
          aria-label="Grade"
          value={filters.grade_level}
          onChange={(e) => setFilters({ ...filters, grade_level: e.target.value })}
        >
          <option value="">All grades</option>
          {gradeLevels.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        {hasActiveFilters && (
          <button className="btn btn-sm btn-light" type="button" onClick={clearFilters}>
            <i className="bi bi-x-lg"></i> Clear
          </button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="d-flex flex-wrap gap-1 mb-3">
          {filters.term__academic_year && (
            <span className="filter-chip">
              Year: {academicYears.find((y) => String(y.id) === String(filters.term__academic_year))?.year}
              <button onClick={() => setFilters({ ...filters, term__academic_year: "" })}>
                <i className="bi bi-x"></i>
              </button>
            </span>
          )}
          {filters.grade_level && (
            <span className="filter-chip">
              Grade: {gradeLevels.find((g) => String(g.id) === String(filters.grade_level))?.name}
              <button onClick={() => setFilters({ ...filters, grade_level: "" })}>
                <i className="bi bi-x"></i>
              </button>
            </span>
          )}
        </div>
      )}

      {/* Fee Structures Cards Grid */}
      {loading ? (
        <div className="row g-3">
          {[1, 2, 3].map((i) => (
            <div className="col-12 col-md-6 col-lg-4" key={i}>
              <div className="card">
                <div className="card-body">
                  <div className="skeleton" style={{ width: "60%", height: 20, marginBottom: 10 }}></div>
                  <div className="skeleton" style={{ width: "40%", height: 14, marginBottom: 16 }}></div>
                  <div className="skeleton" style={{ width: "100%", height: 70, marginBottom: 10 }}></div>
                  <div className="skeleton" style={{ width: "50%", height: 18 }}></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : structures.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <i className="bi bi-cash-stack"></i>
            <h6>No fee structures found</h6>
            <p className="text-muted-soft">
              {hasActiveFilters
                ? "No fee structures match your filters. Try adjusting your search criteria."
                : "Create your first fee structure using the form above."}
            </p>
          </div>
        </div>
      ) : (
        <div className="row g-3">
          {structures.map((f) => {
            const isEditing = editingId === f.id;
            return (
              <div className="col-12 col-md-6 col-lg-4" key={f.id}>
                <div className="card h-100">
                  <div className="card-body">
                    <div className="fee-card__head">
                      <h6 className="fee-card__title">{f.grade_level_name}</h6>
                      <span className="badge badge-blue">
                        <i className="bi bi-clock me-1"></i>
                        {f.term_label}
                      </span>
                    </div>

                    <div className="fee-card__tags">
                      <span className="badge badge-neutral">
                        <i className="bi bi-calendar3 me-1"></i>
                        {f.academic_year_label || "Academic Year"}
                      </span>
                      {f.curriculum_display && (
                        <span className="badge badge-neutral">
                          <i className="bi bi-mortarboard me-1"></i>
                          {f.curriculum_display}
                        </span>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="fee-box fee-box--editing">
                        <div className="section-label fee-box__label">
                          <i className="bi bi-pencil-square"></i> Editing Fee Items
                        </div>
                        {editItems.map((item, idx) => (
                          <div className="item-row item-row--sm" key={idx}>
                            <input
                              className="form-control form-control-sm"
                              placeholder="Item name"
                              value={item.name}
                              onChange={(e) => updateEditItem(idx, "name", e.target.value)}
                            />
                            <input
                              type="number"
                              className="form-control form-control-sm cell-mono"
                              placeholder="Amount"
                              value={item.amount}
                              onChange={(e) => updateEditItem(idx, "amount", e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm btn-icon"
                              onClick={() => removeEditItem(idx)}
                              disabled={editItems.length === 1}
                              aria-label="Remove item"
                              title="Remove item"
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                        ))}
                        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addEditItem}>
                          <i className="bi bi-plus-lg"></i> Add Item
                        </button>
                        <div className="fee-total mt-3">
                          <span className="fee-total__label">Total</span>
                          <span className="fee-total__value">KES {currency(editTotal)}</span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="fee-box">
                          <div className="section-label fee-box__label">
                            <i className="bi bi-list-ul"></i> Breakdown
                          </div>
                          {(f.items || []).length > 0 ? (
                            f.items.map((item, idx) => (
                              <div key={idx} className="fee-line">
                                <span className="fee-line__name">{item.name}</span>
                                <span className="fee-line__amt">KES {currency(item.amount)}</span>
                              </div>
                            ))
                          ) : (
                            <span className="text-muted-soft" style={{ fontSize: "var(--fs-sm)" }}>
                              No items
                            </span>
                          )}
                        </div>

                        <div className="fee-total">
                          <span className="fee-total__label">Total Due</span>
                          <span className="fee-total__value">KES {currency(f.total_amount)}</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="fee-card__actions">
                    {isEditing ? (
                      <>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => saveEdit(f.id)}
                          disabled={editSaving}
                        >
                          <i className="bi bi-check-lg"></i>
                          {editSaving ? "Saving..." : "Save"}
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={cancelEdit}
                          disabled={editSaving}
                        >
                          <i className="bi bi-x-lg"></i> Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => downloadPdf(f)}>
                          <i className="bi bi-download"></i> PDF
                        </button>
                        <button className="btn btn-sm btn-secondary" onClick={() => startEdit(f)}>
                          <i className="bi bi-pencil"></i> Edit
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => deleteStructure(f)}
                          disabled={deletingId === f.id}
                        >
                          <i className="bi bi-trash"></i>
                          {deletingId === f.id ? "Deleting..." : "Delete"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}