import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { mealApi } from "../../services/api";

const money = (v) =>
  `KES ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const firstError = (e, fallback) => {
  const d = e?.response?.data;
  if (!d) return fallback;
  if (typeof d === "string") return fallback;
  if (d.detail) return d.detail;
  const v = Object.values(d)[0];
  return (Array.isArray(v) ? v[0] : v) || fallback;
};

const KIND_LABEL = { TOPUP: "Top-up", MEAL: "Meal", REFUND: "Refund" };

export default function MyMeals() {
  const [searchParams] = useSearchParams();
  const studentId = searchParams.get("student_id");
  const params = studentId ? { student_id: studentId } : undefined;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await mealApi.my(params);
      setData(res.data);
      setError("");
    } catch (e) {
      setError(firstError(e, "Could not load meal details."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!pending) return undefined;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const { data: st } = await mealApi.payStatus(pending, params);
        if (st.status === "SUCCESS") {
          setPending(null);
          setAmount("");
          setMsg({
            type: "success",
            text: `Payment received${st.receipt ? ` (${st.receipt})` : ""}. Your wallet has been topped up.`,
          });
          load();
        } else if (st.status === "FAILED") {
          setPending(null);
          setMsg({
            type: "danger",
            text: st.reason || "The payment was cancelled or failed. You were not charged.",
          });
        } else if (tries >= 30) {
          setPending(null);
          setMsg({
            type: "warning",
            text: "Still waiting for M-Pesa. If money was deducted, your wallet will update on its own within a few minutes.",
          });
        }
      } catch {
        /* keep polling */
      }
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const pay = async (e) => {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await mealApi.payWallet({ amount: Number(amount), phone }, params);
      setPending(res.data.checkout_request_id);
      setMsg({
        type: "info",
        text: "Check your phone and enter your M-Pesa PIN to complete the payment.",
      });
    } catch (err) {
      setMsg({ type: "danger", text: firstError(err, "Could not start the payment.") });
    }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Meals</h1>
            <p className="page-subtitle">Meal plan, card and wallet</p>
          </div>
        </div>
        <div className="text-center py-5">
          <span className="spinner-border spinner-border-sm me-2" />
          Loading your meals...
        </div>
      </div>
    );
  }

  const plan = data?.plan;
  const walletPlan = plan?.billing_mode === "WALLET";
  const balance = Number(data?.wallet_balance || 0);
  const owing = balance < 0 ? Math.abs(balance) : 0;
  const daily = Math.ceil(Number(data?.daily_cost || 0));

  const presets = [];
  if (owing > 0)
    presets.push({
      label: `Clear what is owed (${money(Math.ceil(owing))})`,
      value: Math.ceil(owing),
    });
  if (daily > 0) {
    presets.push({ label: `1 week (${money(daily * 5)})`, value: daily * 5 });
    presets.push({ label: `4 weeks (${money(daily * 20)})`, value: daily * 20 });
  }

  return (
    <div>
      {/* ---------- Page header ---------- */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Meals</h1>
          <p className="page-subtitle">
            {data?.student
              ? `${data.student.name} · ADM ${data.student.admission_no}`
              : "Meal plan, card and wallet"}
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {data && !plan && (
        <div className="alert alert-primary" role="status">
          <i className="bi bi-info-circle me-2" />
          No meal plan has been assigned yet. Please contact the school office.
        </div>
      )}

      {/* ---------- Plan panel ---------- */}
      {plan && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <div>
              <div className="chart-card__title">
                <i className="bi bi-egg-fried me-2 text-brand" />
                {plan.name}
              </div>
              {!walletPlan && (
                <div className="chart-card__subtitle">
                  Your meals are covered by your school fees — nothing to pay here.
                </div>
              )}
            </div>
            <span className={`badge ${walletPlan ? "badge-gold" : "badge-blue"}`}>
              {walletPlan ? "Paid from meal wallet" : "Included in school fees"}
            </span>
          </div>
          <div className="p-3">
            <div className="row g-2">
              {plan.meals.map((m) => {
                const t = data.today.find((x) => x.meal_type === m.meal_type);
                const collected = !!t?.collected_at;
                return (
                  <div key={m.meal_type} className="col-12 col-md-6 col-xl-4">
                    <div
                      className={`dm-card ${
                        collected ? "dm-card--success" : "dm-card--secondary"
                      }`}
                    >
                      <div className="dm-card__top">
                        <span className="dm-card__label">{m.label}</span>
                        <span className="dm-card__icon">
                          <i
                            className={`bi ${
                              collected ? "bi-check2-circle" : "bi-circle"
                            }`}
                          />
                        </span>
                      </div>
                      {walletPlan && (
                        <div className="cell-mono text-muted-soft small">
                          {money(m.price)}
                        </div>
                      )}
                      <div className="dm-card__sub">
                        {collected
                          ? `Taken today at ${new Date(t.collected_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`
                          : "Not taken today"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Wallet panel ---------- */}
      {walletPlan && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title">
              <i className="bi bi-wallet2 me-2 text-brand" />
              Meal wallet
            </span>
            {balance < 0 ? (
              <span className="badge badge-danger">
                <i className="bi bi-exclamation-circle me-1" />
                Owing
              </span>
            ) : (
              <span className="badge badge-success">
                <i className="bi bi-check2-circle me-1" />
                In credit
              </span>
            )}
          </div>
          <div className="p-3">
            <div className="section-label mb-1">Balance</div>
            <div
              className={`${balance < 0 ? "text-owe" : "text-brand"} fw-bold`}
              style={{ fontSize: "var(--fs-2xl)", lineHeight: 1.1 }}
            >
              {money(balance)}
            </div>

            {owing > 0 && (
              <div className="alert alert-warning mt-2 mb-0">
                Meals were served on credit. <strong>{money(owing)}</strong> is
                owed. It will be cleared from your next top-up. Credit is allowed
                up to {money(data.overdraft_limit)}; after that the office must
                top up before more meals are served.
              </div>
            )}

            {/* ---------- M-Pesa top-up ---------- */}
            <form onSubmit={pay} className="mt-3">
              <h6 className="settings-section__title mb-2">Pay with M-Pesa</h6>

              {presets.length > 0 && (
                <>
                  <label className="form-label">Quick amounts</label>
                  <div className="d-flex flex-wrap gap-1 mb-3">
                    {presets.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        disabled={!!pending}
                        onClick={() => setAmount(String(p.value))}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="row g-2 align-items-end">
                <div className="col-12 col-md-5">
                  <label className="form-label">M-Pesa number</label>
                  <input
                    className="form-control"
                    inputMode="numeric"
                    placeholder="e.g. 0712345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    disabled={!!pending}
                  />
                </div>
                <div className="col-12 col-md-3">
                  <label className="form-label">Amount (KES)</label>
                  <input
                    className="form-control"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    disabled={!!pending}
                  />
                </div>
                <div className="col-12 col-md-4">
                  <button
                    className="btn btn-primary w-100"
                    type="submit"
                    disabled={!!pending || !amount || !phone}
                  >
                    {pending ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" />
                        Waiting for PIN...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-phone me-1" />
                        Pay now
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="form-text-hint">
                The money goes straight into this student's meal wallet.
              </div>
            </form>

            {msg && (
              <div
                className={`alert alert-${msg.type === "info" ? "primary" : msg.type} mt-3 mb-0`}
                role="status"
              >
                {msg.text}
              </div>
            )}

            <div className="alert alert-primary mt-3 mb-0">
              <strong>Prefer to pay another way?</strong> Pay to Till Number{" "}
              <strong>{data.till_number}</strong>, then call the school with the
              M-Pesa message and the student's admission number (
              <strong>{data.student.admission_no}</strong>) so the wallet can be
              credited.
            </div>
          </div>
        </div>
      )}

      {/* ---------- Meal card ---------- */}
      {data?.card && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title">
              <i className="bi bi-qr-code me-2 text-brand" />
              Meal card
            </span>
            <span className="badge badge-neutral cell-mono">
              {data.card.card_number}
            </span>
          </div>
          <div className="p-3 text-center">
            <div className="receipt-qr mx-auto mb-2">
              <img
                alt="Meal card QR code"
                src={`data:image/png;base64,${data.card.qr_code_base64}`}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>
            <div className="form-text-hint mt-0">
              Show this to the cafeteria attendant when collecting a meal.
            </div>
          </div>
        </div>
      )}

      {/* ---------- Transactions ---------- */}
      {walletPlan && data?.transactions?.length > 0 && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title">
              <i className="bi bi-list-ul me-2 text-brand" />
              Recent wallet activity
            </span>
            <span className="chart-card__subtitle">
              {data.transactions.length} entr
              {data.transactions.length === 1 ? "y" : "ies"}
            </span>
          </div>
          <div className="table-responsive">
            <table className="table table-hover table--stack mb-0">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Details</th>
                  <th className="text-end">Amount</th>
                  <th className="text-end">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t, i) => (
                  <tr key={i}>
                    <td data-label="Date" className="cell-mono">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                    <td data-label="Type">
                      <span className="badge badge-neutral">
                        {KIND_LABEL[t.kind] || t.kind}
                      </span>
                    </td>
                    <td data-label="Details" className="cell-mono">
                      {t.reference || t.meal_type}
                    </td>
                    <td
                      data-label="Amount"
                      className={`cell-num ${Number(t.amount) < 0 ? "text-owe" : "text-ok"}`}
                    >
                      {Number(t.amount) > 0 ? "+" : ""}
                      {Number(t.amount).toLocaleString("en-KE", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td data-label="Balance" className="cell-num">
                      {Number(t.balance_after).toLocaleString("en-KE", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}