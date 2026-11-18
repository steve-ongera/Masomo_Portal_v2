import { useState } from "react";
import api, { mealApi } from "../../services/api";
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
  Badge,
  useLoad,
  list,
  errText,
} from "./ui";

export default function CafeteriaAttendants() {
  const att = useLoad(() => mealApi.attendants().then(list), []);

  const [q, setQ] = useState("");
  const [users, setUsers] = useState([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState({ kind: "ok", text: "" });

  const say = (text, kind = "ok") => setMsg({ kind, text });

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      setUsers(
        list(
          await api.get("/users/", {
            params: { search: q, page_size: 10 },
          })
        )
      );
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setSearching(false);
    }
  };

  const add = async (u) => {
    try {
      await mealApi.addAttendant(u.id);
      say("Attendant added.");
      setUsers([]);
      setQ("");
      att.reload();
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const toggle = async (a) => {
    try {
      await mealApi.updateAttendant(a.id, { is_active: !a.is_active });
      att.reload();
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const attRows = att.data || [];

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/meals" },
          { label: "Cafeteria Attendants", href: "#" },
        ]}
      />

      <Page
        title="Cafeteria Attendants"
        subtitle="Staff allowed to scan cards and serve meals. Users with the CAFETERIA role can already scan; add others here."
      >
        <Notice kind={msg.kind}>{msg.text}</Notice>

        <Card title="Add Attendant">
          <div className="p-3">
            <Row style={{ marginBottom: "0.75rem" }}>
              <Field label="Find user">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                  placeholder="Name or username"
                  style={{ minWidth: "260px" }}
                />
              </Field>
              <Btn
                kind="ghost"
                onClick={search}
                disabled={searching || !q.trim()}
              >
                {searching ? (
                  "Searching..."
                ) : (
                  <>
                    <i className="bi bi-search me-1"></i>
                    Search
                  </>
                )}
              </Btn>
            </Row>

            {users.length > 0 && (
              <div
                style={{
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                }}
              >
                <div className="table-responsive">
                  <table className="table table-hover mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: "180px" }}>Username</th>
                        <th>Name</th>
                        <th style={{ width: "200px" }} className="text-end">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => {
                        const fullName =
                          u.full_name ||
                          `${u.first_name || ""} ${u.last_name || ""}`.trim();
                        return (
                          <tr key={u.id}>
                            <td>
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: "var(--blue-700)",
                                  fontSize: "var(--fs-sm)",
                                  fontFamily:
                                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                                }}
                              >
                                {u.username}
                              </span>
                            </td>
                            <td>
                              <div className="table-avatar-cell">
                                <div className="avatar-sm">
                                  {(fullName || "")
                                    .split(" ")
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((n) => n[0])
                                    .join("")}
                                </div>
                                <span className="cell-name">{fullName}</span>
                              </div>
                            </td>
                            <td className="text-end">
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => add(u)}
                              >
                                <i className="bi bi-plus-lg me-1"></i>
                                Add as Attendant
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {q.trim() && users.length === 0 && !searching && (
              <p
                className="text-muted-soft mb-0"
                style={{ fontSize: "var(--fs-xs)" }}
              >
                <i className="bi bi-info-circle me-1"></i>
                No users matched — try a different name or username.
              </p>
            )}
          </div>
        </Card>

        <Card title="Attendants">
          <div
            className="table-wrap__header"
            style={{
              flexDirection: "column",
              alignItems: "stretch",
              gap: "0.75rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                <i className="bi bi-person-badge me-2"></i>
                Cafeteria Attendants
              </span>
              {attRows.length > 0 && (
                <Badge tone="info">
                  {attRows.length} attendant
                  {attRows.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          </div>

          {att.loading ? (
            <TableSkeleton rows={5} columns={4} />
          ) : att.error ? (
            <div className="p-3">
              <div className="alert alert-danger mb-0" role="alert">
                <i className="bi bi-exclamation-triangle me-1"></i>
                {errText({ message: att.error })}
              </div>
            </div>
          ) : attRows.length === 0 ? (
            <div className="empty-state">
              <i className="bi bi-person-badge"></i>
              <h6>No attendants added yet</h6>
              <p className="text-muted-soft">
                Use the search above to add staff who can scan cards and serve
                meals.
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "180px" }}>Username</th>
                    <th>Name</th>
                    <th style={{ width: "140px" }}>Status</th>
                    <th style={{ width: "160px" }} className="text-end">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {attRows.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <span
                          style={{
                            fontWeight: 600,
                            color: "var(--blue-700)",
                            fontSize: "var(--fs-sm)",
                            fontFamily:
                              "ui-monospace, SFMono-Regular, Menlo, monospace",
                          }}
                        >
                          {a.username}
                        </span>
                      </td>

                      <td>
                        <div className="table-avatar-cell">
                          <div className="avatar-sm">
                            {(a.user_name || "")
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <span className="cell-name">{a.user_name}</span>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`badge ${
                            a.is_active ? "badge-success" : "badge-neutral"
                          }`}
                        >
                          <span
                            className={`status-dot ${
                              a.is_active
                                ? "status-dot--online"
                                : "status-dot--offline"
                            }`}
                          ></span>
                          {a.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td className="text-end">
                        <button
                          className={`btn btn-sm ${
                            a.is_active
                              ? "btn-outline-danger"
                              : "btn-outline-primary"
                          }`}
                          onClick={() => toggle(a)}
                          title={
                            a.is_active
                              ? "Deactivate this attendant"
                              : "Reactivate this attendant"
                          }
                        >
                          <i
                            className={`bi ${
                              a.is_active
                                ? "bi-slash-circle"
                                : "bi-check2-circle"
                            } me-1`}
                          ></i>
                          {a.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!att.loading && attRows.length > 0 && (
            <div className="table-wrap__footer">
              <span className="table-wrap__footer-info">
                <strong>{attRows.length}</strong> attendant
                {attRows.length === 1 ? "" : "s"} ·{" "}
                {attRows.filter((a) => a.is_active).length} active
              </span>
            </div>
          )}
        </Card>
      </Page>
    </div>
  );
}