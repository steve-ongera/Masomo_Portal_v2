import { useEffect, useState } from "react";
import { mealApi, studentsApi, academicsApi } from "../../services/api";
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
  useLoad,
  list,
  cname,
  errText,
  printMealCards,
  downloadMealCardsPdf,
} from "./ui";

const CARD_STATUS = {
  ACTIVE: { badge: "badge-success", dot: "status-dot--online", label: "Active" },
  LOST: { badge: "badge-danger", dot: "status-dot--offline", label: "Lost" },
  BLOCKED: { badge: "badge-danger", dot: "status-dot--offline", label: "Blocked" },
  EXPIRED: { badge: "badge-warning", dot: "status-dot--pending", label: "Expired" },
  REPLACED: { badge: "badge-neutral", dot: "status-dot--offline", label: "Replaced" },
};

export default function MealCards() {
  const [tab, setTab] = useState("issue");
  const [msg, setMsg] = useState({ kind: "ok", text: "" });
  const say = (text, kind = "ok") => setMsg({ kind, text });

  return (
    <div>
      <Page
        title="Meal Cards"
        subtitle="One permanent card per student. The QR holds only a random token, so it never changes unless the card is replaced."
      >
        <Notice kind={msg.kind}>{msg.text}</Notice>

        <ul className="nav nav-tabs mb-3" role="tablist">
          <li className="nav-item">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "issue"}
              className={`nav-link ${tab === "issue" ? "active" : ""}`}
              onClick={() => setTab("issue")}
            >
              <i className="bi bi-credit-card-2-front me-1"></i>
              Issue a Card
            </button>
          </li>
          <li className="nav-item">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "all"}
              className={`nav-link ${tab === "all" ? "active" : ""}`}
              onClick={() => setTab("all")}
            >
              <i className="bi bi-list-check me-1"></i>
              All Cards
            </button>
          </li>
        </ul>

        {tab === "issue" && <IssueTab say={say} />}
        {tab === "all" && <AllCardsTab say={say} />}
      </Page>
    </div>
  );
}

/* ==========================================================================
   ISSUE TAB
   ========================================================================== */

function IssueTab({ say }) {
  const rooms = useLoad(() => academicsApi.allClassrooms().then(list), []);

  const [find, setFind] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [room, setRoom] = useState("");

  const search = async () => {
    if (!find.trim()) return;
    setSearching(true);
    try {
      setFound(
        list(await studentsApi.list({ search: find, page_size: 10 }))
      );
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setSearching(false);
    }
  };

  const issue = async (s, mode = "print") => {
    try {
      const { data } = await mealApi.issueCard(s.id);
      say(`Card ${data.card_number} issued to ${data.student_name}.`);
      const out = mode === "pdf" ? downloadMealCardsPdf : printMealCards;
      out([
        {
          ...data,
          name: data.student_name,
          // Show the class on the card when the search result carries it.
          classroom: data.classroom || s.classroom_name || "",
        },
      ]);
      setFound([]);
      setFind("");
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const issueClass = async () => {
    try {
      const { data } = await mealApi.issueCardsForClass(Number(room));
      say(`${data.created} new cards created.`);
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const printClass = async (mode = "print") => {
    try {
      const { data } = await mealApi.classSheet(room);
      if (!data.cards.length) {
        say("No active cards in this class yet.", "error");
        return;
      }
      if (mode === "pdf") {
        const label = cname((rooms.data || []).find((r) => String(r.id) === String(room)))
          .replace(/[^\w-]+/g, "-");
        await downloadMealCardsPdf(
          data.cards,
          undefined,
          `meal-cards-${label || "class"}.pdf`
        );
      } else {
        printMealCards(data.cards);
      }
    } catch (e) {
      say(errText(e), "error");
    }
  };

  return (
    <Card title="Issue a Card">
      <div className="p-3">
        <Row style={{ marginBottom: "0.75rem" }}>
          <Field label="Find student (name or admission no)">
            <Input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Type a name or admission number..."
              style={{ minWidth: "260px" }}
            />
          </Field>
          <Btn
            kind="ghost"
            onClick={search}
            disabled={searching || !find.trim()}
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

        {found.length > 0 && (
          <div className="table-wrap mb-3">
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "130px" }}>Adm No</th>
                    <th>Name</th>
                    <th style={{ width: "320px" }} className="text-end">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {found.map((s) => {
                    const fullName =
                      s.full_name ||
                      s.name ||
                      s.user?.full_name ||
                      `${s.user?.first_name || ""} ${
                        s.user?.last_name || ""
                      }`.trim();
                    return (
                      <tr key={s.id}>
                        <td>
                          <span className="cell-mono text-brand fw-semibold">
                            {s.admission_no}
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
                          <div className="table-actions justify-content-end">
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => issue(s, "print")}
                            >
                              <i className="bi bi-printer me-1"></i>
                              Issue &amp; Print
                            </button>
                            <button
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => issue(s, "pdf")}
                            >
                              <i className="bi bi-file-earmark-pdf me-1"></i>
                              Issue &amp; PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {find.trim() && found.length === 0 && !searching && (
          <p className="form-text-hint mb-0">
            <i className="bi bi-info-circle me-1"></i>
            No learners matched — try a different name or admission number.
          </p>
        )}

        <div className="divider mt-4" />
        <div>
          <div className="section-label mb-2">Whole class</div>
          <Row>
            <Field label="Classroom">
              <Select
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                style={{ minWidth: "220px" }}
              >
                <option value="">Select classroom</option>
                {(rooms.data || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {cname(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Btn onClick={issueClass} disabled={!room}>
              <i className="bi bi-plus-lg me-1"></i>
              Issue Missing Cards
            </Btn>
            <Btn kind="ghost" onClick={() => printClass("print")} disabled={!room}>
              <i className="bi bi-printer me-1"></i>
              Print Class Sheet
            </Btn>
            <Btn kind="ghost" onClick={() => printClass("pdf")} disabled={!room}>
              <i className="bi bi-file-earmark-pdf me-1"></i>
              Download PDF
            </Btn>
          </Row>
        </div>
      </div>
    </Card>
  );
}

/* ==========================================================================
   ALL CARDS TAB
   ========================================================================== */

function AllCardsTab({ say }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Debounce the search box so we're not firing a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const cards = useLoad(
    () =>
      mealApi
        .cards({
          search: q || undefined,
          status: status || undefined,
          page_size: 100,
        })
        .then(list),
    [q, status]
  );

  const setSt = async (c, st) => {
    try {
      await mealApi.setCardStatus(c.id, st);
      cards.reload();
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const reissue = async (c) => {
    if (
      !window.confirm(
        `Replace the card for ${c.student_name}? The old card stops working immediately.`
      )
    )
      return;
    try {
      const { data } = await mealApi.issueCard(c.student);
      printMealCards([
        {
          ...data,
          name: data.student_name,
          classroom: data.classroom || c.classroom || "",
        },
      ]);
      cards.reload();
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const cardsRows = cards.data || [];
  const hasFilters = !!(q || status);

  const clearFilters = () => {
    setSearchInput("");
    setQ("");
    setStatus("");
  };

  return (
    <Card title="All Cards">
      <div className="table-wrap__header flex-column align-items-stretch gap-3">
        <div className="toolbar mb-0" style={{ width: "100%" }}>
          <div className="toolbar__search" style={{ maxWidth: "none" }}>
            <i className="bi bi-search"></i>
            <input
              type="text"
              className="form-control"
              placeholder="Card no, name, admission no..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <select
            className="form-select w-auto"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {["ACTIVE", "LOST", "BLOCKED", "EXPIRED", "REPLACED"].map(
              (s) => (
                <option key={s} value={s}>
                  {CARD_STATUS[s]?.label || s}
                </option>
              )
            )}
          </select>

          {hasFilters && (
            <button className="btn btn-sm btn-light" onClick={clearFilters}>
              <i className="bi bi-x-lg"></i> Clear
            </button>
          )}

          {cardsRows.length > 0 && (
            <Badge tone="info">
              {cardsRows.length} card
              {cardsRows.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </div>

      {cards.loading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : cards.error ? (
        <div className="p-3">
          <div className="alert alert-danger mb-0" role="alert">
            <i className="bi bi-exclamation-triangle me-1"></i>
            {errText({ message: cards.error })}
          </div>
        </div>
      ) : cardsRows.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-credit-card-2-front"></i>
          <h6>
            {hasFilters
              ? "No cards match your filters"
              : "No meal cards yet"}
          </h6>
          <p className="text-muted-soft">
            {hasFilters
              ? "Try a different search or clear the filters."
              : "Issue a card for a student or a whole class from the Issue tab."}
          </p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th style={{ width: "140px" }}>Card No</th>
                <th>Student</th>
                <th style={{ width: "130px" }}>Adm No</th>
                <th style={{ width: "140px" }}>Status</th>
                <th style={{ width: "120px" }}>Issued</th>
                <th style={{ width: "240px" }} className="text-end">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {cardsRows.map((c) => {
                const meta =
                  CARD_STATUS[c.status] || {
                    badge: "badge-neutral",
                    dot: "status-dot--offline",
                    label: c.status_display || c.status,
                  };
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="cell-mono text-brand fw-semibold">
                        {c.card_number}
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

                    <td className="cell-muted">
                      {c.admission_no}
                    </td>

                    <td>
                      <span className={`badge ${meta.badge}`}>
                        <span className={`status-dot ${meta.dot}`}></span>
                        {c.status_display || meta.label}
                      </span>
                    </td>

                    <td className="cell-mono" style={{ whiteSpace: "nowrap" }}>
                      {new Date(c.issued_at).toLocaleDateString()}
                    </td>

                    <td className="text-end">
                      {c.status === "REPLACED" ? (
                        <span className="cell-muted small">
                          Replaced
                        </span>
                      ) : (
                        <div className="table-actions justify-content-end">
                          {c.status === "ACTIVE" && (
                            <>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => setSt(c, "BLOCKED")}
                                title="Block this card"
                              >
                                <i className="bi bi-slash-circle me-1"></i>
                                Block
                              </button>
                              <button
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => reissue(c)}
                                title="Issue a replacement card"
                              >
                                <i className="bi bi-arrow-repeat me-1"></i>
                                Replace
                              </button>
                            </>
                          )}
                          {c.status !== "ACTIVE" && (
                            <button
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => setSt(c, "ACTIVE")}
                              title="Reactivate this card"
                            >
                              <i className="bi bi-check2-circle me-1"></i>
                              Reactivate
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!cards.loading && cardsRows.length > 0 && (
        <div className="table-wrap__footer">
          <span className="table-wrap__footer-info">
            <strong>{cardsRows.length}</strong> card
            {cardsRows.length === 1 ? "" : "s"}
            {hasFilters ? " matching your filters" : ""}
          </span>
          <span className="form-text-hint m-0">
            Each student has one permanent card
          </span>
        </div>
      )}
    </Card>
  );
}