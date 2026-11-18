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
  Select,
  Btn,
  Notice,
  Badge,
  MEALS,
  today,
  kes,
  useLoad,
  errText,
} from "./ui";

const SOURCE_BADGE = {
  ONLINE: { badge: "badge-success", dot: "status-dot--online", label: "Online" },
  OFFLINE_SYNC: { badge: "badge-gold", dot: "status-dot--pending", label: "Offline sync" },
};

export default function MealCollections({ canUndo = true }) {
  const [f, setF] = useState({
    from: today(),
    to: today(),
    meal_type: "",
    source: "",
    search: "",
  });
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState({ kind: "ok", text: "" });

  const params = {
    date__gte: f.from,
    date__lte: f.to,
    meal_type: f.meal_type || undefined,
    source: f.source || undefined,
    search: f.search || undefined,
    page,
  };

  const res = useLoad(
    () => mealApi.collections(params).then((r) => r.data),
    [JSON.stringify(params)]
  );

  const rows = res.data?.results || [];

  const set = (k) => (e) => {
    setPage(1);
    setF({ ...f, [k]: e.target.value });
  };

  const undo = async (c) => {
    if (
      !window.confirm(
        `Remove ${c.meal_label} for ${c.student_name}? Any wallet charge will be refunded.`
      )
    )
      return;
    try {
      await mealApi.undoCollection(c.id);
      setMsg({ kind: "ok", text: "Collection removed." });
      res.reload();
    } catch (e) {
      setMsg({ kind: "error", text: errText(e) });
    }
  };

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/meals" },
          { label: "Collections", href: "#" },
        ]}
      />

      <Page
        title="Meal Collections"
        subtitle="Every meal handed over. Use Undo to correct a mistaken scan."
      >
        <Card>
          <div className="p-3">
            <Row>
              <Field label="From">
                <Input
                  type="date"
                  value={f.from}
                  onChange={set("from")}
                  style={{ minWidth: "160px" }}
                />
              </Field>
              <Field label="To">
                <Input
                  type="date"
                  value={f.to}
                  onChange={set("to")}
                  style={{ minWidth: "160px" }}
                />
              </Field>
              <Field label="Meal">
                <Select
                  value={f.meal_type}
                  onChange={set("meal_type")}
                  style={{ minWidth: "160px" }}
                >
                  <option value="">All meals</option>
                  {MEALS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Source">
                <Select
                  value={f.source}
                  onChange={set("source")}
                  style={{ minWidth: "160px" }}
                >
                  <option value="">All sources</option>
                  <option value="ONLINE">Online</option>
                  <option value="OFFLINE_SYNC">Offline sync</option>
                </Select>
              </Field>
              <Field label="Student">
                <Input
                  value={f.search}
                  onChange={set("search")}
                  placeholder="Name or adm no"
                  style={{ minWidth: "200px" }}
                />
              </Field>
            </Row>
          </div>
        </Card>

        <Notice kind={msg.kind}>{msg.text || res.error}</Notice>

        <Card
          title={`${res.data?.count ?? 0} collection${
            res.data?.count === 1 ? "" : "s"
          }`}
        >
          {res.loading ? (
            <TableSkeleton rows={8} columns={8} />
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-egg-fried"></i>
              <h6>No collections match your filters</h6>
              <p className="text-muted-soft">
                Try widening the date range or clearing the search.
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "170px" }}>Time</th>
                    <th style={{ width: "130px" }}>Adm No</th>
                    <th>Student</th>
                    <th style={{ width: "140px" }}>Meal</th>
                    <th className="text-end" style={{ width: "130px" }}>
                      Charged
                    </th>
                    <th style={{ width: "150px" }}>Source</th>
                    <th style={{ width: "150px" }}>Served By</th>
                    {canUndo && (
                      <th style={{ width: "110px" }} className="text-end">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const src =
                      SOURCE_BADGE[c.source] || {
                        badge: "badge-neutral",
                        dot: "status-dot--offline",
                        label: c.source,
                      };
                    return (
                      <tr key={c.id}>
                        <td
                          style={{
                            fontSize: "var(--fs-xs)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {new Date(c.collected_at).toLocaleString()}
                        </td>

                        <td>
                          <span
                            style={{
                              fontWeight: 600,
                              color: "var(--blue-700)",
                              fontSize: "var(--fs-sm)",
                            }}
                          >
                            {c.admission_no}
                          </span>
                        </td>

                        <td>
                          <div className="table-avatar-cell">
                            <div className="avatar-sm">
                              {(c.student_name || "")
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((n) => n[0])
                                .join("")}
                            </div>
                            <span className="cell-name">{c.student_name}</span>
                          </div>
                        </td>

                        <td>
                          <span className="badge badge-blue">
                            {c.meal_label}
                          </span>
                        </td>

                        <td className="text-end">
                          {Number(c.amount_charged) > 0 ? (
                            <span
                              style={{
                                fontWeight: 700,
                                color: "var(--ink-900)",
                              }}
                            >
                              {kes(c.amount_charged)}
                            </span>
                          ) : (
                            <span className="cell-muted">—</span>
                          )}
                        </td>

                        <td>
                          <span className={`badge ${src.badge}`}>
                            <span className={`status-dot ${src.dot}`}></span>
                            {src.label}
                          </span>
                        </td>

                        <td
                          style={{
                            fontSize: "var(--fs-xs)",
                            color: "var(--ink-700)",
                          }}
                        >
                          {c.collected_by_name || (
                            <span className="cell-muted">—</span>
                          )}
                        </td>

                        {canUndo && (
                          <td className="text-end">
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => undo(c)}
                              title="Remove this collection"
                            >
                              <i className="bi bi-arrow-counterclockwise me-1"></i>
                              Undo
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!res.loading && rows.length > 0 && (
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                Page <strong>{page}</strong> · <strong>{rows.length}</strong>{" "}
                of <strong>{res.data?.count ?? 0}</strong> collections
              </span>
              <div className="d-flex gap-2">
                <Btn
                  kind="ghost"
                  disabled={!res.data?.previous}
                  onClick={() => setPage(page - 1)}
                >
                  <i className="bi bi-chevron-left me-1"></i>
                  Previous
                </Btn>
                <Btn
                  kind="ghost"
                  disabled={!res.data?.next}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                  <i className="bi bi-chevron-right ms-1"></i>
                </Btn>
              </div>
            </div>
          )}
        </Card>
      </Page>
    </div>
  );
}