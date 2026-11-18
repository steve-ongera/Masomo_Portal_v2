import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../components/procurement/useProcAuth";
import { errMsg, procApi } from "../../services/api";
import { Alert, Empty, Loading, PageHeader, PromptModal, StatusBadge, fdt, kes } from "../../components/procurement/ProcUI";
import { BarCard, DonutCard, countBy } from "../../components/procurement/charts";

export default function Approvals() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [dlg, setDlg] = useState(null);

  const load = useCallback(async () => {
    try { setData((await procApi.inbox()).data); } catch (e) { setErr(errMsg(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Loading />;
  const api = (t) => (t === "PR" ? procApi.requisitions : procApi.purchaseOrders);
  const mine = data.pending.filter((p) => p.can_act);

  return (
    <div>
      <PageHeader icon="bi-check2-square" title="Approvals" subtitle="Requisitions and purchase orders waiting for a decision">
        <button className="btn btn-outline-secondary" onClick={load}><i className="bi bi-arrow-clockwise" /></button>
      </PageHeader>
      <Alert onClose={() => setErr("")}>{err}</Alert>
      <Alert kind="success" onClose={() => setMsg("")}>{msg}</Alert>

      <div className="row g-3 mb-3">
        <div className="col-lg-4"><DonutCard title="Decisions so far" data={countBy(data.history.filter((h) => ["APPROVED", "REJECTED"].includes(h.decision)), "decision")} /></div>
        <div className="col-lg-8"><BarCard title="Waiting, by approver role" data={countBy(data.pending.map((p) => ({ r: p.pending_role })), "r")} /></div>
      </div>

      <div className="card border-0 shadow-sm mb-3">
        <div className="card-header bg-transparent fw-semibold">Waiting for you ({mine.length}) <span className="text-muted fw-normal">- {data.pending.length} in the school queue</span></div>
        <div className="card-body">
          {!data.pending.length ? <Empty icon="bi-check-all" text="Nothing is waiting for approval." /> : (
            <div className="table-responsive">
              <table className="table align-middle mb-0">
                <thead className="table-light"><tr><th>Document</th><th>Details</th><th>From</th><th className="text-end">Amount</th><th>Step</th><th /></tr></thead>
                <tbody>
                  {data.pending.map((p) => (
                    <tr key={`${p.doc_type}${p.id}`}>
                      <td><span className="badge text-bg-light border me-2">{p.doc_type}</span>{p.number}</td>
                      <td>{p.title}<div className="small text-muted">{p.department}</div></td>
                      <td>{p.owner_name}<div className="small text-muted">{fdt(p.created_at)}</div></td>
                      <td className="text-end">{kes(p.amount)}</td>
                      <td>Level {p.level}/{p.total_levels}<div className="small text-muted">needs {p.pending_role}</div></td>
                      <td className="text-end text-nowrap">
                        {p.can_act ? (<>
                          <button className="btn btn-sm btn-success me-1" onClick={() => setDlg({ p, decision: "approve" })}>Approve</button>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => setDlg({ p, decision: "reject" })}>Reject</button>
                        </>) : <span className="text-muted small">{p.owner_name === (user?.full_name || "") ? "Your document" : "Not your step"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card border-0 shadow-sm">
        <div className="card-header bg-transparent fw-semibold">Recent decisions</div>
        <ul className="list-group list-group-flush">
          {data.history.slice(0, 15).map((h) => (
            <li key={h.id} className="list-group-item d-flex justify-content-between">
              <span><StatusBadge value={h.decision} /> <strong className="ms-1">{h.document_number}</strong> by {h.user_name}{h.comment && <span className="text-muted"> - {h.comment}</span>}</span>
              <span className="text-muted small">{fdt(h.created_at)}</span>
            </li>
          ))}
          {!data.history.length && <li className="list-group-item text-muted">No decisions recorded yet.</li>}
        </ul>
      </div>

      {dlg && (
        <PromptModal
          title={`${dlg.decision === "approve" ? "Approve" : "Reject"} ${dlg.p.number}`}
          tone={dlg.decision === "approve" ? "success" : "danger"} confirmLabel={dlg.decision === "approve" ? "Approve" : "Reject"}
          fields={[
            { name: "comment", label: dlg.decision === "approve" ? "Comment (optional)" : "Reason for rejecting", type: "textarea", required: dlg.decision === "reject" },
            ...(dlg.decision === "approve" && dlg.p.doc_type === "PO" && user?.role === "ADMIN"
              ? [{ name: "override_budget", label: "If the budget is exceeded", type: "select", default: "", options: [{ value: "", label: "Block approval" }, { value: "yes", label: "Override budget (admin)" }] }] : []),
          ]}
          onClose={() => setDlg(null)}
          onSubmit={async (v) => {
            try {
              await api(dlg.p.doc_type).act(dlg.p.id, dlg.decision, { comment: v.comment, override_budget: v.override_budget === "yes" });
              setMsg(`${dlg.p.number} ${dlg.decision === "approve" ? "approved" : "rejected"}.`); await load();
            } catch (e) { throw new Error(errMsg(e)); }
          }}
        />
      )}
    </div>
  );
}
