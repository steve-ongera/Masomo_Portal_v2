import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./useProcAuth";
import { errMsg, unwrap } from "../../services/api";
import { Alert, Empty, Loading, Modal, PageHeader, PromptModal, StatusBadge, fdate, fdt, kes } from "./ProcUI";

/**
 * Config-driven CRUD page used by most procurement screens.
 *
 * resource     procApi.xxx (list/get/create/update/remove/act/read)
 * columns      [{key,label,type?:"money"|"status"|"date"|"datetime"|"pct", render?(row)}]
 * fields       [{name,label,type?:text|number|date|textarea|select|fk|multi|checkbox, options?, optionsApi?, optionLabel?,
 *                col?, required?, hideOnEdit?, onChange?(value)->Promise<patch>}]
 * itemsConfig  {label, columns:[{name,label,type?,readOnly?,options?,optionsApi?,width?}], blank:{}, fixed?, total?(item)->number}
 * rowActions   [{label,icon,tone,when(row,role),prompt?:{title,fields,intro,confirmLabel},confirm?,run(row,vals)}]
 */

const optionsOf = (f, lookups) =>
  f.options ||
  (lookups[f.name] || []).map((o) => ({
    value: o[f.optionValue || "id"],
    label: f.optionLabel ? f.optionLabel(o) : o.name || o.number || o.title || o.label || o.id,
  }));

function Input({ f, value, onChange, lookups, disabled, compact }) {
  const cls = compact ? "form-control form-control-sm" : "form-control";
  const v = value ?? "";
  if (f.type === "textarea") return <textarea className={cls} rows={3} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === "select" || f.type === "fk")
    return (
      <select className={compact ? "form-select form-select-sm" : "form-select"} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{f.placeholder || "Select…"}</option>
        {optionsOf(f, lookups).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  if (f.type === "multi") {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <div className="border rounded p-2" style={{ maxHeight: 140, overflowY: "auto" }}>
        {optionsOf(f, lookups).map((o) => (
          <div className="form-check" key={o.value}>
            <input className="form-check-input" type="checkbox" id={`${f.name}-${o.value}`} checked={chosen.includes(o.value)} disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...chosen, o.value] : chosen.filter((x) => x !== o.value))} />
            <label className="form-check-label" htmlFor={`${f.name}-${o.value}`}>{o.label}</label>
          </div>
        ))}
        {!optionsOf(f, lookups).length && <span className="text-muted-soft small">Nothing to choose from yet.</span>}
      </div>
    );
  }
  if (f.type === "checkbox")
    return <div className="form-check form-switch"><input className="form-check-input" type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /></div>;
  return (
    <input className={cls} type={f.type || "text"} step={f.type === "number" ? "any" : undefined} value={v} disabled={disabled}
      onChange={(e) => onChange(e.target.value)} />
  );
}

const cell = (c, row) => {
  if (c.render) return c.render(row);
  const v = row[c.key];
  if (c.type === "money") return kes(v);
  if (c.type === "status") return <StatusBadge value={v} />;
  if (c.type === "date") return fdate(v);
  if (c.type === "datetime") return fdt(v);
  if (c.type === "pct") return v == null ? "—" : `${v}%`;
  return v === null || v === undefined || v === "" ? "—" : String(v);
};

const PAGE = 12;

export default function ResourcePage({
  title, subtitle, icon, resource, columns, fields = [], itemsConfig, rowActions = [], filters = [],
  topContent, canCreate = true, canEdit = () => true, canDelete = () => true, createLabel = "New",
  blank = {}, historyView = false, detailExtra, searchKeys, modalSize = "xl", noun = "record",
}) {
  const { user } = useAuth();
  const role = user?.role;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [fv, setFv] = useState({});
  const [page, setPage] = useState(1);
  const [lookups, setLookups] = useState({});
  const [form, setForm] = useState(null); // null = closed
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState(null);
  const [prompt, setPrompt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(unwrap(await resource.list())); } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, [resource]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const all = [...fields, ...(itemsConfig?.columns || [])].filter((f) => f.optionsApi);
    all.forEach(async (f) => {
      try { const res = unwrap(await f.optionsApi()); setLookups((l) => ({ ...l, [f.name]: res })); } catch { /* optional */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keys = searchKeys || columns.map((c) => c.key).filter(Boolean);
    return rows.filter((r) =>
      (!q || keys.some((k) => String(r[k] ?? "").toLowerCase().includes(q))) &&
      filters.every((f) => !fv[f.name] || String(r[f.name]) === fv[f.name]));
  }, [rows, search, fv, columns, filters, searchKeys]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);
  useEffect(() => { setPage(1); }, [search, fv]);

  // ------------------------------------------------------------- form ----
  const openCreate = () => { setFormErr(""); setForm({ ...blank, items: itemsConfig && !itemsConfig.fixed ? [{ ...itemsConfig.blank }] : [] }); };
  const openEdit = async (row) => {
    setFormErr("");
    try { const d = (await resource.get(row.id)).data; setForm({ ...d, items: d.items || [] }); } catch (e) { setError(errMsg(e)); }
  };
  const setField = async (f, value) => {
    setForm((p) => ({ ...p, [f.name]: value }));
    if (f.onChange) {
      try { const patch = await f.onChange(value, lookups); if (patch) setForm((p) => ({ ...p, ...patch })); } catch (e) { setFormErr(errMsg(e)); }
    }
  };
  const setItem = (i, name, value) => setForm((p) => ({ ...p, items: p.items.map((it, k) => (k === i ? { ...it, [name]: value } : it)) }));

  const save = async () => {
    setSaving(true); setFormErr("");
    const payload = { ...form };
    fields.forEach((f) => { if (payload[f.name] === "" && ["date", "number", "fk"].includes(f.type)) payload[f.name] = null; });
    if (itemsConfig) payload.items = (form.items || []).map((it) => {
      const o = { ...it };
      itemsConfig.columns.forEach((c) => { if (o[c.name] === "" && c.type === "date") o[c.name] = null; });
      return o;
    });
    try {
      if (form.id) await resource.update(form.id, payload); else await resource.create(payload);
      setForm(null); setNotice(form.id ? "Changes saved." : `${noun[0].toUpperCase() + noun.slice(1)} created.`); await load();
    } catch (e) { setFormErr(errMsg(e)); } finally { setSaving(false); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete this ${noun}? It is archived, not erased, and stays in the audit trail.`)) return;
    try { await resource.remove(row.id); setNotice("Deleted."); await load(); } catch (e) { setError(errMsg(e)); }
  };

  const openView = async (row) => {
    try {
      const d = (await resource.get(row.id)).data;
      let hist = [];
      if (historyView) { try { hist = unwrap(await resource.read(row.id, "history")); } catch { /* none */ } }
      setView({ d, hist });
    } catch (e) { setError(errMsg(e)); }
  };

  const runAction = async (a, row) => {
    setNotice(""); setError("");
    if (a.prompt) { setPrompt({ a, row }); return; }
    if (a.confirm && !window.confirm(a.confirm)) return;
    try { await a.run(row, {}); if (!a.silent) setNotice(`${a.label} done.`); await load(); } catch (e) { setError(errMsg(e)); }
  };

  const itemsTotal = itemsConfig?.total ? (form?.items || []).reduce((s, it) => s + itemsConfig.total(it), 0) : null;

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle}>
        <button className="btn btn-outline-secondary btn-sm" onClick={load} title="Refresh" aria-label="Refresh">
          <i className="bi bi-arrow-clockwise" />
        </button>
        {canCreate && (
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <i className="bi bi-plus-lg" />{createLabel}
          </button>
        )}
      </PageHeader>

      <Alert onClose={() => setError("")}>{error}</Alert>
      <Alert kind="success" onClose={() => setNotice("")}>{notice}</Alert>

      {topContent && <div className="mb-3">{topContent(rows)}</div>}

      <div className="table-wrap">
        <div className="table-wrap__header flex-column align-items-stretch gap-3">
          <div className="toolbar mb-0" style={{ width: "100%" }}>
            <div className="toolbar__search" style={{ maxWidth: "none" }}>
              <i className="bi bi-search"></i>
              <input
                className="form-control"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {filters.map((f) => (
              <select
                key={f.name}
                className="form-select w-auto"
                value={fv[f.name] || ""}
                onChange={(e) => setFv({ ...fv, [f.name]: e.target.value })}
              >
                <option value="">{f.label}: all</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ))}
            <span className="toolbar__spacer" />
            <span className="chart-card__subtitle mb-0">
              {shown.length} {shown.length === 1 ? "record" : "records"}
            </span>
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : !pageRows.length ? (
          <Empty text={rows.length ? "No records match your filters." : `No ${noun}s yet.`} />
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.label} className={c.type === "money" ? "text-end" : ""}>{c.label}</th>
                  ))}
                  <th className="text-end" style={{ width: 1 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id}>
                    {columns.map((c) => (
                      <td key={c.label} className={c.type === "money" ? "cell-mono text-end" : ""}>
                        {cell(c, r)}
                      </td>
                    ))}
                    <td className="text-nowrap">
                      <div className="table-actions justify-content-end">
                        <button className="btn btn-sm btn-light btn-icon" title="View" aria-label="View" onClick={() => openView(r)}>
                          <i className="bi bi-eye" />
                        </button>
                        {resource.update && canEdit(r, role) && (
                          <button className="btn btn-sm btn-light btn-icon" title="Edit" aria-label="Edit" onClick={() => openEdit(r)}>
                            <i className="bi bi-pencil" />
                          </button>
                        )}
                        {rowActions.filter((a) => !a.when || a.when(r, role)).map((a) => (
                          <button
                            key={a.label}
                            className={`btn btn-sm btn-outline-${a.tone || "primary"}`}
                            title={a.label}
                            onClick={() => runAction(a, r)}
                          >
                            {a.icon && <i className={`bi ${a.icon} me-1`} />}{a.label}
                          </button>
                        ))}
                        {resource.remove && canDelete(r, role) && (
                          <button className="btn btn-sm btn-outline-danger btn-icon" title="Delete" aria-label="Delete" onClick={() => remove(r)}>
                            <i className="bi bi-trash" />
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

        {pages > 1 && (
          <div className="table-wrap__footer">
            <span className="table-wrap__footer-info">
              Page <strong>{page}</strong> of <strong>{pages}</strong>
            </span>
            <div className="d-flex gap-2">
              <button
                className="btn btn-sm btn-outline-secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <i className="bi bi-chevron-left"></i> Previous
              </button>
              <button
                className="btn btn-sm btn-outline-secondary"
                disabled={page === pages}
                onClick={() => setPage(page + 1)}
              >
                Next <i className="bi bi-chevron-right"></i>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- create / edit ---------------- */}
      {form && (
        <Modal
          title={`${form.id ? "Edit" : createLabel} ${noun}`}
          size={modalSize}
          onClose={() => !saving && setForm(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving && <span className="spinner-border spinner-border-sm me-2" />}Save
              </button>
            </>
          }
        >
          <Alert>{formErr}</Alert>
          <div className="row g-3">
            {fields.filter((f) => !(form.id && f.hideOnEdit) && !(!form.id && f.hideOnCreate)).map((f) => (
              <div className={f.col || "col-md-6"} key={f.name}>
                <label className="form-label">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </label>
                <Input f={f} value={form[f.name]} lookups={lookups} disabled={f.lockOnEdit && !!form.id} onChange={(v) => setField(f, v)} />
                {f.help && <div className="form-text-hint">{f.help}</div>}
              </div>
            ))}
          </div>

          {itemsConfig && (
            <div className="mt-4">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="settings-section__title mb-0">{itemsConfig.label || "Line items"}</h6>
                {!itemsConfig.fixed && (
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => setForm((p) => ({ ...p, items: [...p.items, { ...itemsConfig.blank }] }))}
                  >
                    <i className="bi bi-plus" /> Add line
                  </button>
                )}
              </div>
              {!form.items?.length ? (
                <div className="text-muted-soft small">{itemsConfig.emptyText || "No lines yet."}</div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        {itemsConfig.columns.map((c) => <th key={c.name} style={{ width: c.width }}>{c.label}</th>)}
                        {!itemsConfig.fixed && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((it, i) => (
                        <tr key={i}>
                          {itemsConfig.columns.map((c) => (
                            <td key={c.name}>
                              {c.readOnly ? (
                                <span>{c.render ? c.render(it) : it[c.name]}</span>
                              ) : (
                                <Input compact f={c} lookups={lookups} value={it[c.name]} onChange={(v) => setItem(i, c.name, v)} />
                              )}
                            </td>
                          ))}
                          {!itemsConfig.fixed && (
                            <td>
                              <button
                                className="btn btn-sm btn-link text-danger"
                                onClick={() => setForm((p) => ({ ...p, items: p.items.filter((_, k) => k !== i) }))}
                                title="Remove line"
                                aria-label="Remove line"
                              >
                                <i className="bi bi-x-lg" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    {itemsTotal !== null && (
                      <tfoot>
                        <tr>
                          <td colSpan={itemsConfig.columns.length} className="text-end fw-semibold">Total</td>
                          <td className="fw-semibold text-nowrap cell-mono">{kes(itemsTotal)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ---------------- view ---------------- */}
      {view && (
        <Modal title={view.d.number || view.d.title || view.d.name || `Details`} size="lg" onClose={() => setView(null)}>
          <dl className="row mb-3">
            {columns.map((c) => (
              <div className="col-md-6 mb-2" key={c.label}>
                <dt className="section-label fw-normal mb-1">{c.label}</dt>
                <dd className="mb-0">{cell(c, view.d)}</dd>
              </div>
            ))}
          </dl>
          {detailExtra && detailExtra(view.d)}
          {itemsConfig && view.d.items?.length > 0 && (
            <>
              <h6 className="settings-section__title mb-2">{itemsConfig.label || "Line items"}</h6>
              <div className="table-responsive mb-3">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      {(itemsConfig.viewColumns || itemsConfig.columns).map((c) => <th key={c.name}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {view.d.items.map((it, i) => (
                      <tr key={i}>
                        {(itemsConfig.viewColumns || itemsConfig.columns).map((c) => (
                          <td key={c.name}>{c.render ? c.render(it) : (it[c.name] ?? "—")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {view.hist.length > 0 && (
            <>
              <h6 className="settings-section__title mb-2">Approval trail</h6>
              <ul className="bulk-list list-unstyled mb-0">
                {view.hist.map((h) => (
                  <li className="py-2 d-flex justify-content-between align-items-center border-bottom" key={h.id}>
                    <span>
                      <StatusBadge value={h.decision} />{" "}
                      <strong className="ms-1">{h.user_name}</strong>
                      {h.comment && <span className="text-muted-soft"> — {h.comment}</span>}
                    </span>
                    <span className="text-muted-soft small">{fdt(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}

      {/* ---------------- row action prompt ---------------- */}
      {prompt && (
        <PromptModal
          title={prompt.a.prompt.title || prompt.a.label}
          intro={prompt.a.prompt.intro}
          fields={prompt.a.prompt.fields}
          confirmLabel={prompt.a.prompt.confirmLabel || prompt.a.label}
          tone={prompt.a.tone || "primary"}
          onClose={() => setPrompt(null)}
          onSubmit={async (vals) => {
            try {
              await prompt.a.run(prompt.row, vals);
              setNotice(`${prompt.a.label} done.`);
              await load();
            } catch (e) {
              throw new Error(errMsg(e));
            }
          }}
        />
      )}
    </div>
  );
}