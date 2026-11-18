import { useState } from "react";
import { mealApi } from "../../services/api";
import Breadcrumb from "../../components/Breadcrumb";
import TableSkeleton from "../../components/TableSkeleton";
import {
  Page,
  Card,
  Row,
  Field,
  Input,
  Btn,
  Notice,
  MEALS,
  mealLabel,
  kes,
  useLoad,
  errText,
} from "./ui";

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("en-CA");
};

const todayStr = () => new Date().toLocaleDateString("en-CA");

async function loadAll(from, to) {
  let all = [];
  let page = 1;
  for (;;) {
    const { data } = await mealApi.collections({
      date__gte: from,
      date__lte: to,
      page_size: 1000,
      page,
    });
    all = all.concat(data.results || []);
    if (!data.next || page >= 30) return all;
    page += 1;
  }
}

const TXN_BADGE = {
  TOPUP: { badge: "badge-success", dot: "status-dot--online" },
  CHARGE: { badge: "badge-danger", dot: "status-dot--offline" },
  REFUND: { badge: "badge-blue", dot: "status-dot--online" },
  ADJUSTMENT: { badge: "badge-neutral", dot: "status-dot--pending" },
};

const TABS = [
  { key: "overview", label: "Overview", icon: "bi-graph-up-arrow" },
  { key: "wallet", label: "Student Wallet", icon: "bi-wallet2" },
];

// Sub-tabs shown inside the Overview tab
const OVERVIEW_TABS = [
  { key: "byMeal", label: "By Meal", icon: "bi-egg-fried" },
  { key: "byStudent", label: "By Student", icon: "bi-people" },
];

export default function MealBilling() {
  const [tab, setTab] = useState("overview");
  const [range, setRange] = useState({
    from: monthStart(),
    to: todayStr(),
  });

  const rows = useLoad(
    () => loadAll(range.from, range.to),
    [range.from, range.to]
  );

  const all = rows.data || [];
  const charged = all.filter((c) => Number(c.amount_charged) > 0);
  const total = charged.reduce((s, c) => s + Number(c.amount_charged), 0);

  const byMeal = MEALS.map(([v, l]) => {
    const m = all.filter((c) => c.meal_type === v);
    return [
      l,
      m.length,
      m.filter((c) => Number(c.amount_charged) > 0).length,
      kes(m.reduce((s, c) => s + Number(c.amount_charged), 0)),
    ];
  }).filter((r) => r[1] > 0);

  const perStudent = Object.values(
    charged.reduce((a, c) => {
      const k = c.admission_no;
      a[k] = a[k] || {
        adm: k,
        name: c.student_name,
        n: 0,
        amt: 0,
      };
      a[k].n += 1;
      a[k].amt += Number(c.amount_charged);
      return a;
    }, {})
  ).sort((a, b) => b.amt - a.amt);

  // wallet desk
  const [adm, setAdm] = useState("");
  const [wallet, setWallet] = useState(null);
  const [top, setTop] = useState({ amount: "", reference: "" });
  const [msg, setMsg] = useState({ kind: "ok", text: "" });
  const [looking, setLooking] = useState(false);
  const [topping, setTopping] = useState(false);

  const lookup = async (a = adm) => {
    if (!a.trim()) return;
    setLooking(true);
    try {
      setWallet((await mealApi.wallet(a)).data);
      setMsg({ kind: "ok", text: "" });
    } catch (e) {
      setWallet(null);
      setMsg({ kind: "error", text: errText(e) });
    } finally {
      setLooking(false);
    }
  };

  const topUp = async () => {
    setTopping(true);
    try {
      await mealApi.topUp({
        admission_no: adm,
        amount: top.amount,
        reference: top.reference,
      });
      setTop({ amount: "", reference: "" });
      setMsg({ kind: "ok", text: "Wallet topped up." });
      lookup();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    } finally {
      setTopping(false);
    }
  };

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/meals" },
          { label: "Cafeteria Billing", href: "#" },
        ]}
      />

      <Page
        title="Cafeteria Billing"
        subtitle="What the cafeteria has charged, and the prepaid meal wallets that pay for it."
      >
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
                <i className={`bi ${t.icon} me-1`}></i>
                {t.label}
              </button>
            </li>
          ))}
        </ul>

        {tab === "overview" && (
          <OverviewTab
            range={range}
            setRange={setRange}
            rows={rows}
            all={all}
            charged={charged}
            total={total}
            byMeal={byMeal}
            perStudent={perStudent}
          />
        )}

        {tab === "wallet" && (
          <WalletTab
            adm={adm}
            setAdm={setAdm}
            wallet={wallet}
            top={top}
            setTop={setTop}
            msg={msg}
            looking={looking}
            topping={topping}
            lookup={lookup}
            topUp={topUp}
          />
        )}
      </Page>
    </div>
  );
}

/* ==========================================================================
   OVERVIEW TAB — rules, range filter, stats, then sub-tabs for the two
   tables
   ========================================================================== */

function OverviewTab({
  range,
  setRange,
  rows,
  all,
  charged,
  total,
  byMeal,
  perStudent,
}) {
  const [subTab, setSubTab] = useState("byMeal");

  return (
    <>
      <Card title="How Students Are Charged">
        <div className="p-3">
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.2rem",
              lineHeight: 1.7,
              fontSize: "var(--fs-xs)",
              color: "var(--ink-700)",
            }}
          >
            <li>
              <strong>Included in school fees</strong> (e.g. boarders): the
              meal is recorded for headcount and costs nothing at the counter.
            </li>
            <li>
              <strong>Charged to meal wallet</strong> (e.g. day scholars): the
              plan's price per meal is deducted when the card is scanned. Low
              balance blocks the meal.
            </li>
            <li>
              Meals served while the tablet was offline can take a wallet
              below zero. Follow these up with the parent.
            </li>
            <li>Undoing a collection refunds the wallet automatically.</li>
          </ul>
        </div>
      </Card>

      <Card>
        <div className="p-3">
          <Row>
            <Field label="From">
              <Input
                type="date"
                value={range.from}
                onChange={(e) =>
                  setRange({ ...range, from: e.target.value })
                }
                style={{ minWidth: "160px" }}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
                style={{ minWidth: "160px" }}
              />
            </Field>
          </Row>
        </div>
      </Card>

      <Notice>{rows.error}</Notice>

      <div className="row g-3 mb-3">
        <div className="col-12 col-md-4">
          <div className="stat-card stat-card--gold">
            <i className="bi bi-wallet2"></i>
            <div>
              <div className="stat-card__value">{kes(total)}</div>
              <div className="stat-card__label">Wallet charges</div>
            </div>
          </div>
        </div>

        <div className="col-12 col-md-4">
          <div className="stat-card stat-card--success">
            <i className="bi bi-egg-fried"></i>
            <div>
              <div className="stat-card__value">{all.length}</div>
              <div className="stat-card__label">Meals served</div>
            </div>
          </div>
        </div>

        <div className="col-12 col-md-4">
          <div className="stat-card">
            <i className="bi bi-receipt"></i>
            <div>
              <div className="stat-card__value">
                {charged.length}
                <span
                  style={{
                    fontSize: "var(--fs-xs)",
                    color: "var(--ink-400)",
                    fontWeight: 500,
                    marginLeft: "4px",
                  }}
                >
                  / {all.length - charged.length} free
                </span>
              </div>
              <div className="stat-card__label">Billed vs free</div>
            </div>
          </div>
        </div>
      </div>

      <ul className="nav nav-tabs mb-3" role="tablist">
        {OVERVIEW_TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === t.key}
              className={`nav-link ${subTab === t.key ? "active" : ""}`}
              onClick={() => setSubTab(t.key)}
            >
              <i className={`bi ${t.icon} me-1`}></i>
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      {subTab === "byMeal" && (
        <ByMealTable
          rows={rows}
          byMeal={byMeal}
          total={total}
        />
      )}

      {subTab === "byStudent" && (
        <ByStudentTable
          rows={rows}
          perStudent={perStudent}
          total={total}
        />
      )}
    </>
  );
}

/* ==========================================================================
   BY MEAL sub-tab
   ========================================================================== */

function ByMealTable({ rows, byMeal, total }) {
  return (
    <Card title="By Meal">
      <div className="table-wrap__header">
        <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
          <i className="bi bi-egg-fried me-2"></i>
          By Meal
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
          {byMeal.length} meal{byMeal.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.loading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : byMeal.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-egg-fried"></i>
          <h6>No meals served in this period</h6>
          <p className="text-muted-soft">Try widening the date range.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Meal</th>
                <th className="text-end" style={{ width: "120px" }}>
                  Served
                </th>
                <th className="text-end" style={{ width: "160px" }}>
                  Charged Meals
                </th>
                <th className="text-end" style={{ width: "160px" }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {byMeal.map((r, i) => (
                <tr key={i}>
                  <td>
                    <span className="cell-name">{r[0]}</span>
                  </td>
                  <td className="text-end">
                    <span
                      style={{ fontWeight: 600, color: "var(--ink-900)" }}
                    >
                      {r[1]}
                    </span>
                  </td>
                  <td className="text-end">
                    <span
                      style={{ fontWeight: 600, color: "var(--gold-600)" }}
                    >
                      {r[2]}
                    </span>
                  </td>
                  <td className="text-end">
                    <span
                      style={{ fontWeight: 700, color: "var(--ink-900)" }}
                    >
                      {r[3]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!rows.loading && byMeal.length > 0 && (
        <div className="table-wrap__footer">
          <span className="table-wrap__footer-info">
            <strong>{byMeal.length}</strong> meal
            {byMeal.length === 1 ? "" : "s"} in this period
          </span>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
            Total charged: <strong>{kes(total)}</strong>
          </span>
        </div>
      )}
    </Card>
  );
}

/* ==========================================================================
   BY STUDENT sub-tab
   ========================================================================== */

function ByStudentTable({ rows, perStudent, total }) {
  return (
    <Card title="By Student (Wallet-Billed)">
      <div className="table-wrap__header">
        <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
          <i className="bi bi-people me-2"></i>
          By Student (Wallet-Billed)
        </span>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-400)" }}>
          {perStudent.length} student{perStudent.length === 1 ? "" : "s"}
        </span>
      </div>

      {rows.loading ? (
        <TableSkeleton rows={5} columns={4} />
      ) : perStudent.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-people"></i>
          <h6>No wallet charges in this period</h6>
          <p className="text-muted-soft">
            Only students on a wallet-billed plan appear here.
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th style={{ width: "130px" }}>Adm No</th>
                <th>Student</th>
                <th className="text-end" style={{ width: "110px" }}>
                  Meals
                </th>
                <th className="text-end" style={{ width: "160px" }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {perStudent.map((s) => (
                <tr key={s.adm}>
                  <td>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--blue-700)",
                        fontSize: "var(--fs-sm)",
                      }}
                    >
                      {s.adm}
                    </span>
                  </td>
                  <td>
                    <div className="table-avatar-cell">
                      <div className="avatar-sm">
                        {(s.name || "")
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((n) => n[0])
                          .join("")}
                      </div>
                      <span className="cell-name">{s.name}</span>
                    </div>
                  </td>
                  <td className="text-end">
                    <span
                      style={{ fontWeight: 600, color: "var(--ink-700)" }}
                    >
                      {s.n}
                    </span>
                  </td>
                  <td className="text-end">
                    <span
                      style={{ fontWeight: 700, color: "var(--ink-900)" }}
                    >
                      {kes(s.amt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!rows.loading && perStudent.length > 0 && (
        <div className="table-wrap__footer">
          <span className="table-wrap__footer-info">
            <strong>{perStudent.length}</strong> student
            {perStudent.length === 1 ? "" : "s"} charged ·{" "}
            <strong>{kes(total)}</strong> total
          </span>
        </div>
      )}
    </Card>
  );
}

/* ==========================================================================
   WALLET TAB — lookup, top up, transaction history
   ========================================================================== */

function WalletTab({
  adm,
  setAdm,
  wallet,
  top,
  setTop,
  msg,
  looking,
  topping,
  lookup,
  topUp,
}) {
  return (
    <Card title="Student Wallet">
      <div className="p-3">
        <Row style={{ marginBottom: "0.75rem" }}>
          <Field label="Admission No">
            <Input
              value={adm}
              onChange={(e) => setAdm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup()}
              placeholder="e.g. ADM-000123"
              style={{ minWidth: "220px" }}
            />
          </Field>
          <Btn
            kind="ghost"
            onClick={() => lookup()}
            disabled={!adm.trim() || looking}
          >
            {looking ? (
              "Looking up..."
            ) : (
              <>
                <i className="bi bi-search me-1"></i>
                Look Up
              </>
            )}
          </Btn>
        </Row>

        <Notice kind={msg.kind}>{msg.text}</Notice>

        {wallet && (
          <>
            <div
              className="d-flex flex-wrap align-items-center gap-3 pb-3 mb-3"
              style={{ borderBottom: "1px solid var(--border-color)" }}
            >
              <div className="table-avatar-cell">
                <div className="avatar-sm">
                  {(wallet.student_name || "")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div>
                  <div className="cell-name">{wallet.student_name}</div>
                  <div
                    style={{
                      fontSize: "var(--fs-xs)",
                      color: "var(--ink-400)",
                      marginTop: "2px",
                    }}
                  >
                    {adm}
                  </div>
                </div>
              </div>

              <div className="ms-auto">
                <div className="section-label mb-1">Balance</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "var(--fs-lg)",
                    color:
                      Number(wallet.balance) < 0
                        ? "var(--danger-600)"
                        : "var(--ink-900)",
                  }}
                >
                  {kes(wallet.balance)}
                </div>
              </div>
            </div>

            <div className="section-label mb-2">Top Up Wallet</div>
            <Row style={{ marginBottom: "1rem" }}>
              <Field label="Top-up amount (KES)">
                <Input
                  type="number"
                  min="1"
                  value={top.amount}
                  onChange={(e) =>
                    setTop({ ...top, amount: e.target.value })
                  }
                  style={{ minWidth: "160px" }}
                />
              </Field>
              <Field label="Reference (M-Pesa code / receipt)">
                <Input
                  value={top.reference}
                  onChange={(e) =>
                    setTop({ ...top, reference: e.target.value })
                  }
                  placeholder="e.g. QK41XYZ90"
                  style={{ minWidth: "240px" }}
                />
              </Field>
              <Btn onClick={topUp} disabled={!top.amount || topping}>
                {topping ? (
                  "Adding..."
                ) : (
                  <>
                    <i className="bi bi-plus-lg me-1"></i>
                    Add to Wallet
                  </>
                )}
              </Btn>
            </Row>

            <div className="section-label mb-2">Transaction History</div>
            {wallet.transactions.length === 0 ? (
              <div className="empty-state">
                <i className="bi bi-receipt"></i>
                <h6>No transactions yet</h6>
                <p className="text-muted-soft">
                  Top-ups, charges, and refunds will appear here.
                </p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: "180px" }}>Date</th>
                      <th style={{ width: "140px" }}>Type</th>
                      <th className="text-end" style={{ width: "130px" }}>
                        Amount
                      </th>
                      <th className="text-end" style={{ width: "150px" }}>
                        Balance After
                      </th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallet.transactions.map((t) => {
                      const meta =
                        TXN_BADGE[t.kind] || {
                          badge: "badge-neutral",
                          dot: "status-dot--offline",
                        };
                      return (
                        <tr key={t.id}>
                          <td
                            style={{
                              fontSize: "var(--fs-xs)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {new Date(t.created_at).toLocaleString()}
                          </td>
                          <td>
                            <span className={`badge ${meta.badge}`}>
                              <span className={`status-dot ${meta.dot}`}></span>
                              {t.kind_display}
                            </span>
                          </td>
                          <td className="text-end">
                            <span
                              style={{
                                fontWeight: 700,
                                color:
                                  Number(t.amount) < 0
                                    ? "var(--danger-600)"
                                    : "var(--success-600)",
                              }}
                            >
                              {kes(t.amount)}
                            </span>
                          </td>
                          <td className="text-end">
                            <span
                              style={{
                                fontWeight: 600,
                                color:
                                  Number(t.balance_after) < 0
                                    ? "var(--danger-600)"
                                    : "var(--ink-900)",
                              }}
                            >
                              {kes(t.balance_after)}
                            </span>
                          </td>
                          <td
                            style={{
                              fontSize: "var(--fs-xs)",
                              color: "var(--ink-600)",
                            }}
                          >
                            {t.reference ||
                              mealLabel(t.meal_type) || (
                                <span className="cell-muted">—</span>
                              )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {wallet.transactions.length > 0 && (
              <div className="table-wrap__footer">
                <span className="table-wrap__footer-info">
                  <strong>{wallet.transactions.length}</strong> transaction
                  {wallet.transactions.length === 1 ? "" : "s"} on record
                </span>
              </div>
            )}
          </>
        )}

        {!wallet && !looking && !msg.text && (
          <div className="empty-state">
            <i className="bi bi-wallet2"></i>
            <h6>Look up a student to manage their wallet</h6>
            <p className="text-muted-soft">
              Enter an admission number above to view the balance, top up, and
              see the transaction history.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}