import { useState } from "react";
import { mealApi } from "../../services/api";
import {
  Page,
  Card,
  Row,
  Field,
  Input,
  Select,
  Table,
  Notice,
  Badge,
  MEALS,
  mealLabel,
  today,
  kes,
  useLoad,
  errText,
} from "./ui";

const MEAL_BAR = {
  BREAKFAST: "var(--blue-600)",
  MORNING_SNACK: "var(--gold-500)",
  LUNCH: "var(--success-600)",
  AFTERNOON_SNACK: "var(--gold-500)",
  SUPPER: "var(--blue-700)",
};

export default function MealDashboard() {
  const [date, setDate] = useState(today());
  const [meal, setMeal] = useState("LUNCH");

  const dash = useLoad(
    () => mealApi.dashboard({ date }).then((r) => r.data),
    [date]
  );
  const missing = useLoad(
    () => mealApi.missing({ date, meal_type: meal }).then((r) => r.data),
    [date, meal]
  );

  const mealCards = dash.data?.meals || [];
  const missingStudents = missing.data?.students || [];

  return (
    <div>
      <Page
        title="Meal Dashboard"
        subtitle="How many students are expected to eat, how many have collected, and who is still missing."
      >
        {/* ---- Date filter ---- */}
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-calendar-day me-2 text-brand"></i>
              Date
            </span>
            <span className="chart-card__subtitle mb-0">
              {mealCards.length} meal{mealCards.length === 1 ? "" : "s"} expected
            </span>
          </div>
          <div className="p-3">
            <Row>
              <Field label="Meal date">
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{ maxWidth: "220px" }}
                />
              </Field>
            </Row>
          </div>
        </div>

        <Notice>{dash.error}</Notice>

        {/* ---- Meal cards (loading / empty / populated) ---- */}
        {dash.loading ? (
          <div className="stat-grid">
            {[0, 1, 2, 3].map((i) => (
              <div className="dm-card" aria-hidden="true" key={i}>
                <div className="dm-card__top">
                  <div className="skeleton" style={{ width: 70, height: 12 }}></div>
                  <div className="skeleton" style={{ width: 30, height: 30 }}></div>
                </div>
                <div className="skeleton" style={{ width: 90, height: 24 }}></div>
                <div className="skeleton" style={{ width: "100%", height: 7, borderRadius: 999 }}></div>
              </div>
            ))}
          </div>
        ) : mealCards.length === 0 ? (
          <div className="table-wrap mb-3">
            <div className="empty-state">
              <i className="bi bi-egg-fried"></i>
              <h6>No meals expected on this date</h6>
              <p className="text-muted-soft">
                Assign students to a meal plan first.
              </p>
            </div>
          </div>
        ) : (
          <div className="stat-grid">
            {mealCards.map((m) => {
              const pct = m.expected
                ? Math.min(100, Math.round((m.collected / m.expected) * 100))
                : 0;
              const barColor = MEAL_BAR[m.meal_type] || "var(--blue-600)";
              return (
                <div className="dm-card dm-card--primary" key={m.meal_type}>
                  <div className="dm-card__top">
                    <span className="dm-card__label">{m.label}</span>
                    <span className="dm-card__icon">
                      <i className="bi bi-egg-fried"></i>
                    </span>
                  </div>
                  <div className="dm-card__num">
                    {m.collected}
                    <span className="text-muted-soft" style={{ fontSize: "var(--fs-sm)", fontWeight: 500, marginLeft: 4 }}>
                      / {m.expected}
                    </span>
                  </div>
                  <div className="progress-track" style={{ marginTop: 4, marginBottom: 4 }}>
                    <div
                      className="progress-fill"
                      style={{ width: `${pct}%`, background: barColor }}
                    ></div>
                  </div>
                  <div className="dm-card__sub">
                    {m.remaining} still to collect
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ---- Wallet revenue footer ---- */}
        {dash.data?.wallet_revenue != null && (
          <div className="table-wrap mb-3">
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <i className="bi bi-wallet2 me-1"></i>
                Wallet charges for the day:{" "}
                <strong>{kes(dash.data.wallet_revenue)}</strong>
              </span>
            </div>
          </div>
        )}

        {/* ---- Missing students card ---- */}
        <Card title="Entitled but not yet collected">
          <div className="table-wrap__header flex-column align-items-stretch gap-3">
            <Row>
              <Field label="Meal">
                <Select
                  value={meal}
                  onChange={(e) => setMeal(e.target.value)}
                  style={{ minWidth: "200px" }}
                >
                  {MEALS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              {missingStudents.length > 0 && (
                <Badge tone="danger">
                  {missingStudents.length} outstanding
                </Badge>
              )}
            </Row>
          </div>

          <div className="p-3">
            <Notice>{missing.error && errText({ message: missing.error })}</Notice>

            {missing.loading ? (
              <div className="p-3">
                <div className="skeleton skeleton-text" style={{ width: "60%" }}></div>
                <div className="skeleton skeleton-text" style={{ width: "45%" }}></div>
                <div className="skeleton skeleton-text" style={{ width: "70%" }}></div>
              </div>
            ) : (
              <Table
                head={["Adm no", "Name", "Class", "Plan"]}
                empty={`Everyone has collected ${mealLabel(
                  meal
                ).toLowerCase()}.`}
                rows={missingStudents.map((s) => [
                  <span key="adm" className="cell-mono text-brand fw-semibold">
                    {s.admission_no}
                  </span>,
                  <div key="name" className="table-avatar-cell">
                    <div className="avatar-sm">
                      {(s.name || "")
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((n) => n[0])
                        .join("")}
                    </div>
                    <span className="cell-name">{s.name}</span>
                  </div>,
                  s.classroom || <span className="cell-muted">—</span>,
                  <span key="plan" className="badge badge-blue">
                    {s.plan}
                  </span>,
                ])}
              />
            )}
          </div>

          {!missing.loading && missingStudents.length > 0 && (
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <strong>{missingStudents.length}</strong> student
                {missingStudents.length === 1 ? "" : "s"} yet to collect{" "}
                {mealLabel(meal).toLowerCase()}
              </span>
            </div>
          )}
        </Card>
      </Page>
    </div>
  );
}