import { useCallback, useEffect, useState } from "react";
import { mealApi, academicsApi, calendarApi, studentsApi } from "../../services/api";
import Breadcrumb from "../../components/Breadcrumb";
import TableSkeleton from "../../components/TableSkeleton";
import Modal from "../../components/Modal";

// ---- Inlined from ./ui (they were only used here) ----
const MEALS = [
  ["BREAKFAST", "Breakfast"],
  ["LUNCH", "Lunch"],
  ["SUPPER", "Supper"],
];

const mealLabel = (v) => {
  const m = MEALS.find(([k]) => k === v);
  return m ? m[1] : v;
};

const kes = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

const list = (res) => res?.data?.results ?? res?.data ?? [];

const cname = (c) => {
  if (!c) return "";
  const direct = c.name || c.display_name || c.label;
  if (direct) return direct;
  const grade = c.grade_level_name ?? c.grade_name ?? "";
  const stream = c.stream_name ?? c.stream?.name ?? "";
  return `${grade} ${stream}`.trim() || `Class ${c.id}`;
};

const errText = (e) =>
  e?.response?.data?.detail ||
  (typeof e?.response?.data === "string" ? e.response.data : null) ||
  e?.message ||
  "Something went wrong.";

const useLoad = (loader, deps = []) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, loading, error, reload, setData };
};

// ---- Component ----

const blank = () => ({
  id: null,
  name: "",
  code: "",
  description: "",
  billing_mode: "INCLUDED",
  is_active: true,
  items: Object.fromEntries(
    MEALS.map(([v]) => [v, { on: false, price: "0" }])
  ),
});

const BILLING_BADGE = {
  INCLUDED: "badge-blue",
  WALLET: "badge-gold",
};

const TABS = [
  { key: "plans", label: "Plans", icon: "bi-card-list" },
  { key: "assign", label: "Assign", icon: "bi-people" },
  { key: "roster", label: "Roster", icon: "bi-list-check" },
];

const initials = (name) =>
  (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("");

const studentName = (s) =>
  s.full_name ||
  s.name ||
  s.user?.full_name ||
  `${s.user?.first_name || ""} ${s.user?.last_name || ""}`.trim();

export default function MealPlans() {
  const [tab, setTab] = useState("plans");
  const [msg, setMsg] = useState({ kind: "ok", text: "" });

  const plans = useLoad(() => mealApi.plans({ page_size: 200 }).then(list), []);
  const years = useLoad(() => calendarApi.academicYears().then(list), []);
  const rooms = useLoad(() => academicsApi.allClassrooms().then(list), []);
  const grades = useLoad(() => academicsApi.gradeLevels().then(list), []);

  const say = (text, kind = "ok") => setMsg({ kind, text });

  return (
    <div>
   

      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Meal Plans</h1>
          <p className="page-subtitle">
            Create, edit and price meal plans, then assign them to students,
            classes or grades for an academic year.
          </p>
        </div>
      </div>

      {msg.text && (
        <div
          className={`alert alert-${msg.kind === "error" ? "danger" : "success"} alert-dismissible fade show`}
          role={msg.kind === "error" ? "alert" : "status"}
        >
          {msg.text}
          <button
            type="button"
            className="btn-close"
            onClick={() => setMsg({ kind: "ok", text: "" })}
            aria-label="Dismiss"
          />
        </div>
      )}

      {/* ---------- Top tabs ---------- */}
      <ul className="nav nav-tabs mb-3" role="tablist">
        {TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`nav-link ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <i className={`bi ${t.icon} me-1`} />
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      {tab === "plans" && (
        <PlansTab plans={plans} billingBadge={BILLING_BADGE} say={say} />
      )}
      {tab === "assign" && (
        <AssignTab
          plans={plans}
          years={years}
          rooms={rooms}
          grades={grades}
          say={say}
        />
      )}
      {tab === "roster" && <RosterTab plans={plans} years={years} say={say} />}
    </div>
  );
}

/* ==========================================================================
   PLANS TAB
   ========================================================================== */

function PlansTab({ plans, billingBadge, say }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blank());
  const [priceModal, setPriceModal] = useState(null); // { plan, prices }
  const [busyId, setBusyId] = useState(null);
  const [saving, setSaving] = useState(false);

  const plansRows = plans.data || [];

  const openNew = () => {
    setForm(blank());
    setShowForm(true);
  };

  const edit = (p) => {
    setForm({
      ...p,
      items: Object.fromEntries(
        MEALS.map(([v]) => {
          const it = p.items.find((i) => i.meal_type === v);
          return [v, { on: !!it, price: it ? String(it.price) : "0" }];
        })
      ),
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(blank());
  };

  const save = async () => {
    const items = Object.entries(form.items)
      .filter(([, v]) => v.on)
      .map(([meal_type, v]) => ({
        meal_type,
        price: form.billing_mode === "WALLET" ? v.price || 0 : 0,
      }));

    if (items.length === 0) {
      say("Tick at least one meal for this plan.", "error");
      return;
    }
    if (items.some((i) => Number(i.price) < 0)) {
      say("Prices cannot be negative.", "error");
      return;
    }

    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: form.description,
      billing_mode: form.billing_mode,
      is_active: form.is_active,
      items,
    };
    setSaving(true);
    try {
      form.id
        ? await mealApi.updatePlan(form.id, payload)
        : await mealApi.createPlan(payload);
      say(form.id ? "Plan updated." : "Plan created.");
      closeForm();
      plans.reload();
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    if (
      !window.confirm(
        `Delete the plan "${p.name}"?\n\nThis cannot be undone. A plan that students are assigned to cannot be deleted — mark it inactive instead.`
      )
    )
      return;
    setBusyId(p.id);
    try {
      await mealApi.deletePlan(p.id);
      say(`Plan "${p.name}" deleted.`);
      if (form.id === p.id) closeForm();
      if (priceModal?.plan?.id === p.id) setPriceModal(null);
      plans.reload();
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (p) => {
    setBusyId(p.id);
    try {
      await mealApi.updatePlan(p.id, { is_active: !p.is_active });
      say(`Plan "${p.name}" ${p.is_active ? "deactivated" : "activated"}.`);
      plans.reload();
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const openPrices = (p) => {
    setPriceModal({
      plan: p,
      prices: Object.fromEntries(
        p.items.map((i) => [i.meal_type, String(Number(i.price))])
      ),
    });
  };

  const savePrices = async () => {
    const p = priceModal.plan;
    const items = p.items.map((i) => ({
      meal_type: i.meal_type,
      price:
        priceModal.prices[i.meal_type] === ""
          ? 0
          : priceModal.prices[i.meal_type],
    }));
    if (
      items.some(
        (i) => Number(i.price) < 0 || Number.isNaN(Number(i.price))
      )
    ) {
      say("Enter a valid price (0 or more) for every meal.", "error");
      return;
    }
    setBusyId(p.id);
    try {
      await mealApi.updatePlan(p.id, { items });
      say(`Prices updated for "${p.name}".`);
      setPriceModal(null);
      plans.reload();
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="d-flex justify-content-end mb-3">
        <button className="btn btn-primary" onClick={openNew}>
          <i className="bi bi-plus-lg me-1" />
          New Plan
        </button>
      </div>

      {plans.loading ? (
        <div className="row g-3">
          {[0, 1, 2, 3].map((i) => (
            <div className="col-12 col-md-6 col-xl-4" key={i}>
              <div className="table-wrap h-100">
                <div className="p-3">
                  <div className="skeleton skeleton-text" style={{ width: "60%" }} />
                  <div className="skeleton skeleton-text" style={{ width: "40%" }} />
                  <div className="skeleton skeleton-text" style={{ width: "80%" }} />
                  <div className="skeleton skeleton-text" style={{ width: "50%" }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : plansRows.length === 0 ? (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-card-list" />
            <h6>No meal plans yet</h6>
            <p className="text-muted-soft mb-3">
              Create your first plan to start assigning students.
            </p>
            <button className="btn btn-primary" onClick={openNew}>
              <i className="bi bi-plus-lg me-1" />
              New Plan
            </button>
          </div>
        </div>
      ) : (
        <div className="row g-3">
          {plansRows.map((p) => {
            const isWallet = p.billing_mode === "WALLET";
            const busy = busyId === p.id;
            return (
              <div className="col-12 col-md-6 col-xl-4" key={p.id}>
                <div
                  className="table-wrap h-100"
                  style={{ opacity: p.is_active ? 1 : 0.75 }}
                >
                  <div className="table-wrap__header">
                    <div style={{ minWidth: 0 }}>
                      <div className="chart-card__title">{p.name}</div>
                      <div className="chart-card__subtitle cell-mono">
                        {p.code}
                      </div>
                    </div>
                    <span
                      className={`badge ${p.is_active ? "badge-success" : "badge-neutral"}`}
                    >
                      <span
                        className={`status-dot ${p.is_active ? "status-dot--online" : "status-dot--offline"}`}
                      />
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <div className="p-3">
                    <div className="mb-3">
                      <span
                        className={`badge ${billingBadge[p.billing_mode] || "badge-neutral"}`}
                      >
                        {p.billing_display}
                      </span>
                    </div>

                    {p.description && (
                      <p className="text-muted-soft small mb-3">
                        {p.description}
                      </p>
                    )}

                    <div className="section-label mb-2">Meals</div>
                    {p.items.length === 0 ? (
                      <div className="cell-muted small">No meals configured</div>
                    ) : (
                      <div className="d-flex flex-wrap gap-1 mb-3">
                        {p.items.map((i) => (
                          <span key={i.meal_type} className="badge badge-neutral">
                            {mealLabel(i.meal_type)}
                            {isWallet && (
                              <span className="text-gold fw-bold ms-1">
                                {kes(i.price)}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="table-wrap__footer">
                    <span className="table-wrap__footer-info small">
                      <i className="bi bi-box-seam me-1" />
                      {p.items.length} meal
                      {p.items.length === 1 ? "" : "s"}
                    </span>

                    <div className="d-flex flex-wrap gap-1">
                      <button
                        className="btn btn-sm btn-outline-secondary btn-icon"
                        onClick={() => edit(p)}
                        disabled={busy}
                        title="Edit name, meals and billing"
                        aria-label="Edit plan"
                      >
                        <i className="bi bi-pencil" />
                      </button>

                      {isWallet && (
                        <button
                          className="btn btn-sm btn-outline-primary btn-icon"
                          onClick={() => openPrices(p)}
                          disabled={busy || p.items.length === 0}
                          title="Edit meal prices"
                          aria-label="Edit meal prices"
                        >
                          <i className="bi bi-cash-coin" />
                        </button>
                      )}

                      <button
                        className={`btn btn-sm btn-icon ${
                          p.is_active ? "btn-outline-secondary" : "btn-outline-success"
                        }`}
                        onClick={() => toggleActive(p)}
                        disabled={busy}
                        title={
                          p.is_active
                            ? "Stop using this plan"
                            : "Make this plan available again"
                        }
                        aria-label={
                          p.is_active ? "Deactivate plan" : "Activate plan"
                        }
                      >
                        <i
                          className={`bi ${p.is_active ? "bi-pause-circle" : "bi-play-circle"}`}
                        />
                      </button>

                      <button
                        className="btn btn-sm btn-outline-danger btn-icon"
                        onClick={() => remove(p)}
                        disabled={busy}
                        title="Delete this plan"
                        aria-label="Delete plan"
                      >
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================== CREATE / EDIT MODAL ==================== */}
      <Modal
        show={showForm}
        onClose={closeForm}
        title={form.id ? `Edit Plan: ${form.name}` : "New Meal Plan"}
        size="lg"
      >
        <div>
          <h6 className="settings-section__title mb-2">Plan details</h6>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Name</label>
              <input
                className="form-control"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Full Board"
              />
            </div>
            <div className="col-md-3">
              <label className="form-label">Code</label>
              <input
                className="form-control cell-mono"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="FB"
              />
            </div>
            <div className="col-md-5">
              <label className="form-label">Billing</label>
              <select
                className="form-select"
                value={form.billing_mode}
                onChange={(e) =>
                  setForm({ ...form, billing_mode: e.target.value })
                }
              >
                <option value="INCLUDED">Included in school fees</option>
                <option value="WALLET">Charged to meal wallet</option>
              </select>
            </div>

            <div className="col-12">
              <label className="form-label">Description (optional)</label>
              <input
                className="form-control"
                value={form.description || ""}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="e.g. Breakfast, lunch and supper for boarders"
              />
            </div>

            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="planActive"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                />
                <label className="form-check-label" htmlFor="planActive">
                  {form.is_active
                    ? "Active — can be assigned"
                    : "Inactive — hidden from new assignments"}
                </label>
              </div>
            </div>
          </div>

          <h6 className="settings-section__title mt-4 mb-2">
            Meals in this plan
            {form.billing_mode === "WALLET" ? " and price per meal" : ""}
          </h6>

          <div className="row g-2">
            {MEALS.map(([v, l]) => {
              const item = form.items[v];
              const on = item.on;
              return (
                <div className="col-6 col-md-4" key={v}>
                  <div
                    className="rounded-md p-2"
                    style={{
                      border: `1px solid ${on ? "var(--blue-400)" : "var(--border-color)"}`,
                      background: on ? "var(--blue-50)" : "var(--surface)",
                    }}
                  >
                    <div className="form-check mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`meal-${v}`}
                        checked={on}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            items: {
                              ...form.items,
                              [v]: { ...item, on: e.target.checked },
                            },
                          })
                        }
                      />
                      <label
                        className="form-check-label fw-semibold"
                        htmlFor={`meal-${v}`}
                      >
                        {l}
                      </label>
                    </div>

                    {form.billing_mode === "WALLET" && on && (
                      <div className="mt-2">
                        <label className="form-label">Price (KES)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="form-control form-control-sm"
                          value={item.price}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              items: {
                                ...form.items,
                                [v]: { ...item, price: e.target.value },
                              },
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={closeForm}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !form.name.trim() || !form.code.trim()}
            >
              {saving ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Saving...
                </>
              ) : (
                <>
                  <i className="bi bi-check2 me-1" />
                  {form.id ? "Save Changes" : "Save Plan"}
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================== PRICE EDITOR MODAL ==================== */}
      <Modal
        show={!!priceModal}
        onClose={() => setPriceModal(null)}
        title={priceModal ? `Prices for "${priceModal.plan.name}"` : "Edit prices"}
      >
        {priceModal && (
          <>
            <p className="form-text-hint mt-0">
              New prices apply to meals collected from now on.
            </p>

            <div className="row g-2">
              {priceModal.plan.items.map((i) => (
                <div className="col-12 col-sm-6" key={i.meal_type}>
                  <label className="form-label">{mealLabel(i.meal_type)}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="form-control"
                    value={priceModal.prices[i.meal_type] ?? ""}
                    onChange={(e) =>
                      setPriceModal({
                        ...priceModal,
                        prices: {
                          ...priceModal.prices,
                          [i.meal_type]: e.target.value,
                        },
                      })
                    }
                    onKeyDown={(e) => e.key === "Enter" && savePrices()}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-top d-flex gap-2 justify-content-end">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPriceModal(null)}
                disabled={busyId === priceModal.plan.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={savePrices}
                disabled={busyId === priceModal.plan.id}
              >
                {busyId === priceModal.plan.id ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <i className="bi bi-check2 me-1" />
                    Save Prices
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

/* ==========================================================================
   ASSIGN TAB
   ========================================================================== */

const ASSIGN_TABS = [
  { key: "bulk", label: "Class / Grade", icon: "bi-people" },
  { key: "single", label: "Individual Student", icon: "bi-person" },
];

function AssignTab({ plans, years, rooms, grades, say }) {
  const [subTab, setSubTab] = useState("bulk");

  const [asg, setAsg] = useState({
    plan_id: "",
    academic_year_id: "",
    target: "classroom",
    target_id: "",
  });

  const [find, setFind] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);

  const plansRows = plans.data || [];
  const activePlans = plansRows.filter((p) => p.is_active);

  const baseReady = asg.plan_id && asg.academic_year_id;
  const ready = baseReady && asg.target_id;

  const assign = async () => {
    const payload = {
      plan_id: Number(asg.plan_id),
      academic_year_id: Number(asg.academic_year_id),
    };
    payload[asg.target === "classroom" ? "classroom_id" : "grade_level_id"] =
      Number(asg.target_id);
    try {
      const r = await mealApi.bulkAssign(payload);
      say(`${r.data.assigned} students assigned.`);
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const search = async () => {
    if (!find.trim()) return;
    setSearching(true);
    try {
      setFound(list(await studentsApi.list({ search: find, page_size: 10 })));
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setSearching(false);
    }
  };

  const assignOne = async (s) => {
    try {
      const existing = list(
        await mealApi.studentPlans({
          student: s.id,
          academic_year: asg.academic_year_id,
        })
      );
      if (existing.length) {
        await mealApi.updateStudentPlan(existing[0].id, {
          plan: Number(asg.plan_id),
          is_active: true,
        });
        say(`${studentName(s)}'s plan was changed.`);
      } else {
        await mealApi.createStudentPlan({
          student: s.id,
          plan: Number(asg.plan_id),
          academic_year: Number(asg.academic_year_id),
          is_active: true,
        });
        say(`${studentName(s)} was assigned to the plan.`);
      }
      setFound([]);
      setFind("");
    } catch (e) {
      say(errText(e), "error");
    }
  };

  return (
    <>
      {/* ---------- Shared plan + year ---------- */}
      <div className="table-wrap mb-3">
        <div className="table-wrap__header">
          <span className="chart-card__title">
            <i className="bi bi-sliders me-2 text-brand" />
            Choose plan and year
          </span>
        </div>
        <div className="p-3">
          <div className="row g-3">
            <div className="col-12 col-md-6">
              <label className="form-label">Plan</label>
              <select
                className="form-select"
                value={asg.plan_id}
                onChange={(e) => setAsg({ ...asg, plan_id: e.target.value })}
              >
                <option value="">Select a plan</option>
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label">Academic Year</label>
              <select
                className="form-select"
                value={asg.academic_year_id}
                onChange={(e) =>
                  setAsg({ ...asg, academic_year_id: e.target.value })
                }
              >
                <option value="">Select a year</option>
                {(years.data || []).map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.year}
                    {y.is_current ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Sub-tabs ---------- */}
      <ul className="nav nav-tabs mb-3" role="tablist">
        {ASSIGN_TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === t.key}
              className={`nav-link ${subTab === t.key ? "active" : ""}`}
              onClick={() => setSubTab(t.key)}
            >
              <i className={`bi ${t.icon} me-1`} />
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      {subTab === "bulk" && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title">
              <i className="bi bi-people me-2 text-brand" />
              Assign to a class or grade
            </span>
          </div>
          <div className="p-3">
            <div className="row g-3 align-items-end">
              <div className="col-12 col-md-3">
                <label className="form-label">Assign to</label>
                <select
                  className="form-select"
                  value={asg.target}
                  onChange={(e) =>
                    setAsg({ ...asg, target: e.target.value, target_id: "" })
                  }
                >
                  <option value="classroom">A classroom</option>
                  <option value="grade">A whole grade</option>
                </select>
              </div>
              <div className="col-12 col-md-5">
                <label className="form-label">
                  {asg.target === "classroom" ? "Classroom" : "Grade"}
                </label>
                <select
                  className="form-select"
                  value={asg.target_id}
                  onChange={(e) =>
                    setAsg({ ...asg, target_id: e.target.value })
                  }
                >
                  <option value="">
                    {asg.target === "classroom" ? "Select classroom" : "Select grade"}
                  </option>
                  {asg.target === "classroom"
                    ? (rooms.data || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {cname(c)}
                        </option>
                      ))
                    : (grades.data || []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name || g.label || g.id}
                        </option>
                      ))}
                </select>
              </div>
              <div className="col-12 col-md-4">
                <button
                  className="btn btn-primary w-100"
                  onClick={assign}
                  disabled={!ready}
                >
                  <i className="bi bi-people me-1" />
                  Assign Plan
                </button>
              </div>
            </div>
            <div className="form-text-hint mt-2">
              Only students with an active enrollment in that year are
              assigned. Re-assigning replaces their current plan.
            </div>
          </div>
        </div>
      )}

      {subTab === "single" && (
        <div className="table-wrap">
          <div className="table-wrap__header">
            <span className="chart-card__title">
              <i className="bi bi-person me-2 text-brand" />
              Assign to one student
            </span>
          </div>
          <div className="p-3">
            <div className="toolbar mb-3">
              <div className="toolbar__search">
                <i className="bi bi-search" />
                <input
                  type="text"
                  className="form-control"
                  placeholder="Type a name or admission number..."
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                />
              </div>
              <button
                className="btn btn-outline-primary"
                onClick={search}
                disabled={searching || !find.trim()}
              >
                {searching ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" />
                    Searching...
                  </>
                ) : (
                  <>
                    <i className="bi bi-search me-1" />
                    Search
                  </>
                )}
              </button>
            </div>

            {!baseReady && (
              <div className="form-text-hint mt-0">
                Pick a plan and an academic year above first.
              </div>
            )}

            {found.length > 0 && (
              <div className="table-responsive">
                <table className="table table-hover table--stack mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Adm No</th>
                      <th>Name</th>
                      <th style={{ width: 160 }} className="text-end">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {found.map((s) => (
                      <tr key={s.id}>
                        <td data-label="Adm No" className="cell-mono text-brand fw-semibold">
                          {s.admission_no}
                        </td>
                        <td data-label="Name">
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">{initials(studentName(s))}</div>
                            <span className="cell-name">{studentName(s)}</span>
                          </div>
                        </td>
                        <td data-label="Action">
                          <div className="table-actions justify-content-end">
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={!baseReady}
                              onClick={() => assignOne(s)}
                            >
                              <i className="bi bi-check2 me-1" />
                              Assign
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {find.trim() && found.length === 0 && !searching && (
              <p className="text-muted-soft small mb-0 mt-2">
                <i className="bi bi-info-circle me-1" />
                Press Search to look for a student.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ==========================================================================
   ROSTER TAB
   ========================================================================== */

function RosterTab({ plans, years, say }) {
  const [yearFilter, setYearFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const sp = useLoad(
    () =>
      mealApi
        .studentPlans({
          academic_year: yearFilter || undefined,
          plan: planFilter || undefined,
          search: q || undefined,
          page_size: 200,
        })
        .then(list),
    [yearFilter, planFilter, q]
  );

  const spRows = sp.data || [];
  const planOptions = plans.data || [];
  const hasFilters = !!(yearFilter || planFilter || q);

  const clearFilters = () => {
    setYearFilter("");
    setPlanFilter("");
    setSearchInput("");
    setQ("");
  };

  const changePlan = async (r) => {
    if (!editing?.plan || String(editing.plan) === String(r.plan)) {
      setEditing(null);
      return;
    }
    setBusyId(r.id);
    try {
      await mealApi.updateStudentPlan(r.id, { plan: Number(editing.plan) });
      say(`${r.student_name}'s plan was changed.`);
      setEditing(null);
      sp.reload();
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (r) => {
    setBusyId(r.id);
    try {
      await mealApi.updateStudentPlan(r.id, { is_active: !r.is_active });
      say(`${r.student_name}'s meals ${r.is_active ? "paused" : "resumed"}.`);
      sp.reload();
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (r) => {
    if (
      !window.confirm(
        `Remove ${r.student_name} from "${r.plan_name}" for ${r.academic_year_label}?\n\nThey will no longer be able to collect meals.`
      )
    )
      return;
    setBusyId(r.id);
    try {
      await mealApi.removeStudentPlan(r.id);
      say(`${r.student_name} was removed from the plan.`);
      sp.reload();
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="table-wrap">
      <div className="table-wrap__header flex-column align-items-stretch gap-3">
        <div className="toolbar mb-0">
          <div className="toolbar__search">
            <i className="bi bi-search" />
            <input
              type="text"
              className="form-control"
              placeholder="Name or admission no..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <select
            className="form-select w-auto"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            aria-label="Academic year"
          >
            <option value="">All years</option>
            {(years.data || []).map((y) => (
              <option key={y.id} value={y.id}>
                {y.year}
                {y.is_current ? " (current)" : ""}
              </option>
            ))}
          </select>

          <select
            className="form-select w-auto"
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            aria-label="Plan"
          >
            <option value="">All plans</option>
            {planOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="toolbar__spacer" />

          <span className="chart-card__subtitle">
            {spRows.length} student{spRows.length !== 1 ? "s" : ""}
          </span>

          {hasFilters && (
            <button className="btn btn-sm btn-light" onClick={clearFilters}>
              <i className="bi bi-x-lg me-1" />
              Clear
            </button>
          )}
        </div>
      </div>

      {sp.loading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : spRows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-people" />
          <h6>
            {hasFilters ? "No students match your filters" : "No students assigned yet"}
          </h6>
          <p className="text-muted-soft">
            {hasFilters
              ? "Try a different search or clear the filters."
              : "Use the Assign tab to assign students to a meal plan."}
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover table--stack mb-0">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Adm No</th>
                <th>Student</th>
                <th style={{ width: 240 }}>Plan</th>
                <th style={{ width: 110 }}>Year</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 300 }} className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {spRows.map((r) => {
                const isEditing = editing?.id === r.id;
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <td data-label="Adm No" className="cell-mono text-brand fw-semibold">
                      {r.admission_no}
                    </td>
                    <td data-label="Student">
                      <div className="table-avatar-cell">
                        <div className="avatar-sm">{initials(r.student_name)}</div>
                        <span className="cell-name">{r.student_name}</span>
                      </div>
                    </td>
                    <td data-label="Plan">
                      {isEditing ? (
                        <select
                          className="form-select form-select-sm"
                          value={editing.plan}
                          onChange={(e) =>
                            setEditing({ ...editing, plan: e.target.value })
                          }
                        >
                          {planOptions
                            .filter(
                              (p) =>
                                p.is_active || String(p.id) === String(r.plan)
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span className="badge badge-blue">{r.plan_name}</span>
                      )}
                    </td>
                    <td data-label="Year" className="cell-mono small">
                      <i className="bi bi-calendar3 me-1 text-muted-soft" />
                      {r.academic_year_label}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`badge ${r.is_active ? "badge-success" : "badge-neutral"}`}
                      >
                        <span
                          className={`status-dot ${r.is_active ? "status-dot--online" : "status-dot--offline"}`}
                        />
                        {r.is_active ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="table-actions justify-content-end flex-wrap">
                        {isEditing ? (
                          <>
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => changePlan(r)}
                              disabled={busy}
                            >
                              <i className="bi bi-check2 me-1" />
                              Save
                            </button>
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() =>
                                setEditing({ id: r.id, plan: String(r.plan) })
                              }
                              disabled={busy}
                              title="Move this student to another plan"
                            >
                              <i className="bi bi-arrow-left-right me-1" />
                              Change
                            </button>
                            <button
                              className={`btn btn-sm ${r.is_active ? "btn-outline-secondary" : "btn-outline-success"}`}
                              onClick={() => toggleActive(r)}
                              disabled={busy}
                              title={
                                r.is_active
                                  ? "Stop this student collecting meals"
                                  : "Let this student collect meals again"
                              }
                            >
                              <i
                                className={`bi ${r.is_active ? "bi-pause-circle" : "bi-play-circle"} me-1`}
                              />
                              {r.is_active ? "Pause" : "Resume"}
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => remove(r)}
                              disabled={busy}
                              title="Remove this student from the plan"
                            >
                              <i className="bi bi-trash me-1" />
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!sp.loading && spRows.length > 0 && (
        <div className="table-wrap__footer">
          <span className="table-wrap__footer-info">
            <strong>{spRows.length}</strong> student
            {spRows.length === 1 ? "" : "s"} assigned
            {hasFilters ? " matching your filters" : ""}
          </span>
        </div>
      )}
    </div>
  );
}