import { useEffect, useState } from "react";
import { academicsApi } from "../../services/api";
import { studentIdApi } from "../../services/studentIdApi";
import { ID_CARD_CSS, IdCard, usePrintCards } from "./StudentIdCardView";

const STATUS = {
  ACTIVE: "badge-success",
  LOST: "badge-danger",
  BLOCKED: "badge-danger",
  REPLACED: "badge-neutral",
};

const errText = (e) => {
  const d = e?.response?.data?.detail;
  return typeof d === "string" ? d : e?.message || "Something went wrong.";
};

export default function StudentIdCards() {
  const [tab, setTab] = useState("issue");
  const [msg, setMsg] = useState({ kind: "success", text: "" });
  const [printPortal, printCards] = usePrintCards();
  const say = (text, kind = "success") => setMsg({ kind, text });

  return (
    <div>
      <style>{ID_CARD_CSS}</style>
      {printPortal}

      <div className="page-header">
        <div>
          <h1 className="page-title">Student ID Cards</h1>
          <p className="page-subtitle">
            One permanent ID card per student. The QR holds only a secret token - fees, class, wallet and attendance
            are looked up live when it is scanned.
          </p>
        </div>
      </div>

      {msg.text && (
        <div className={`alert alert-${msg.kind === "error" ? "danger" : "success"} py-2 small`}>{msg.text}</div>
      )}

      <ul className="nav nav-tabs mb-3" role="tablist">
        {[
          ["issue", "bi-person-vcard", "Issue a Card"],
          ["class", "bi-people", "Whole Class"],
          ["all", "bi-list-check", "All Cards"],
        ].map(([key, icon, label]) => (
          <li className="nav-item" key={key}>
            <button type="button" className={`nav-link ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
              <i className={`bi ${icon} me-1`}></i>
              {label}
            </button>
          </li>
        ))}
      </ul>

      {tab === "issue" && <IssueTab say={say} print={printCards} />}
      {tab === "class" && <ClassTab say={say} print={printCards} />}
      {tab === "all" && <AllCardsTab say={say} print={printCards} />}
    </div>
  );
}

/* ------------------------------ ISSUE ------------------------------ */
function IssueTab({ say, print }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState(null);

  const search = async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const { data } = await studentIdApi.searchStudents(q.trim());
      setRows(data);
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setSearching(false);
    }
  };

  const issue = async (s, replace) => {
    let reason = "";
    if (replace) {
      reason = window.prompt(`Why is ${s.full_name}'s card being replaced? (lost / damaged / stolen)`, "Lost");
      if (reason === null) return;
    }
    try {
      const { data } = await studentIdApi.issue({ student_id: s.id, replace, reason });
      say(
        `Card ${data.card.card_number} issued to ${data.card.given_names} ${data.card.surname}.` +
          (data.warnings?.length ? ` ${data.warnings.join(" ")}` : "")
      );
      print([data.card]);
      search();
    } catch (e) {
      say(errText(e), "error");
    }
  };

  return (
    <div className="table-wrap">
      <div className="table-wrap__header">
        <span className="chart-card__title mb-0">Find a student</span>
      </div>
      <div className="p-3">
        <div className="d-flex gap-2 mb-3">
          <input
            className="form-control"
            style={{ maxWidth: 360 }}
            placeholder="Name or admission number..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button className="btn btn-primary" onClick={search} disabled={searching || !q.trim()}>
            <i className="bi bi-search me-1"></i>
            {searching ? "Searching..." : "Search"}
          </button>
        </div>

        {rows.length > 0 && (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Adm No</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Photo</th>
                  <th>Card</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="cell-mono fw-semibold">{s.admission_no}</td>
                    <td>{s.full_name}</td>
                    <td className="cell-muted">{s.classroom || "-"}</td>
                    <td>
                      {s.has_photo ? (
                        <span className="badge badge-success">Yes</span>
                      ) : (
                        <span className="badge badge-warning">Missing</span>
                      )}
                    </td>
                    <td className="cell-mono">{s.active_card || <span className="cell-muted">None</span>}</td>
                    <td className="text-end">
                      <div className="table-actions justify-content-end">
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(s)}>
                          <i className="bi bi-pencil me-1"></i>Details &amp; photo
                        </button>
                        {s.active_card ? (
                          <button className="btn btn-sm btn-outline-danger" onClick={() => issue(s, true)}>
                            <i className="bi bi-arrow-repeat me-1"></i>Replace
                          </button>
                        ) : (
                          <button className="btn btn-sm btn-primary" onClick={() => issue(s, false)}>
                            <i className="bi bi-printer me-1"></i>Issue &amp; Print
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

        {editing && (
          <ProfileEditor
            student={editing}
            say={say}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              search();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ProfileEditor({ student, say, onClose, onSaved }) {
  const [nationality, setNationality] = useState("Kenyan");
  const [address, setAddress] = useState("");
  const [photoUrl, setPhotoUrl] = useState(null);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    studentIdApi
      .profile(student.id)
      .then(({ data }) => {
        setNationality(data.nationality || "Kenyan");
        setAddress(data.address || "");
        setPhotoUrl(data.photo_url);
      })
      .catch((e) => say(errText(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.id]);

  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPhotoUrl(URL.createObjectURL(f));
  };

  const save = async () => {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("nationality", nationality);
      fd.append("address", address);
      if (file) fd.append("photo", file);
      await studentIdApi.saveProfile(student.id, fd);
      say(`Details saved for ${student.full_name}.`);
      onSaved();
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border rounded p-3 mt-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <strong>
          {student.full_name} <span className="cell-muted">({student.admission_no})</span>
        </strong>
        <button className="btn btn-sm btn-light" onClick={onClose}>
          <i className="bi bi-x-lg"></i>
        </button>
      </div>
      <div className="row g-3">
        <div className="col-md-3 text-center">
          <div
            style={{
              width: 132, height: 168, margin: "0 auto", border: "1px solid #cbd5e1", borderRadius: 6,
              overflow: "hidden", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {photoUrl ? <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "No photo"}
          </div>
          <input type="file" accept="image/*" capture="user" className="form-control form-control-sm mt-2" onChange={pick} />
          <div className="form-text-hint">Passport style, plain background, under 3 MB.</div>
        </div>
        <div className="col-md-5">
          <label className="form-label">Nationality</label>
          <input className="form-control mb-3" value={nationality} onChange={(e) => setNationality(e.target.value)} />
          <label className="form-label">Address</label>
          <input
            className="form-control"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. P.O. Box 123 - 80100, Mombasa"
          />
        </div>
        <div className="col-md-4 d-flex align-items-end justify-content-end">
          <button className="btn btn-success" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save details"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ CLASS ------------------------------ */
function ClassTab({ say, print }) {
  const [rooms, setRooms] = useState([]);
  const [room, setRoom] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    academicsApi.allClassrooms().then(({ data }) => {
      const rows = data.results ?? data;
      const current = rows.filter((r) => r.academic_year_is_current);
      setRooms(current.length ? current : rows);
    });
  }, []);

  const issueMissing = async () => {
    setBusy(true);
    try {
      const { data } = await studentIdApi.issueBulk(Number(room));
      say(`${data.created} new card(s) created. ${data.already_had_card} student(s) already had one.`);
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const loadSheet = async (thenPrint) => {
    setBusy(true);
    try {
      const { data } = await studentIdApi.classSheet(room);
      if (!data.cards.length) {
        say("No active cards in this class yet. Issue the missing cards first.", "error");
        return;
      }
      setPreview(data.cards);
      if (data.missing_photo) say(`${data.missing_photo} card(s) have no photo.`, "error");
      if (thenPrint) print(data.cards);
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="table-wrap">
      <div className="table-wrap__header">
        <span className="chart-card__title mb-0">Whole class</span>
      </div>
      <div className="p-3">
        <div className="row g-3 align-items-end">
          <div className="col-md-4">
            <label className="form-label">Classroom</label>
            <select className="form-select" value={room} onChange={(e) => { setRoom(e.target.value); setPreview(null); }}>
              <option value="">Select classroom...</option>
              {rooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.grade_level_name} {c.stream_name} ({c.academic_year_year})
                </option>
              ))}
            </select>
          </div>
          <div className="col-auto d-flex gap-2 flex-wrap">
            <button className="btn btn-primary" onClick={issueMissing} disabled={!room || busy}>
              <i className="bi bi-plus-lg me-1"></i>Issue missing cards
            </button>
            <button className="btn btn-outline-primary" onClick={() => loadSheet(false)} disabled={!room || busy}>
              <i className="bi bi-eye me-1"></i>Preview
            </button>
            <button className="btn btn-success" onClick={() => loadSheet(true)} disabled={!room || busy}>
              <i className="bi bi-printer me-1"></i>Print class sheet
            </button>
          </div>
        </div>

        {preview && (
          <div className="mt-4 d-flex flex-wrap gap-3">
            {preview.slice(0, 6).map((c) => (
              <IdCard key={c.id} card={c} />
            ))}
            {preview.length > 6 && <div className="cell-muted align-self-center">+ {preview.length - 6} more</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ ALL CARDS ------------------------------ */
function AllCardsTab({ say, print }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await studentIdApi.cards({ search: q || undefined, status: status || undefined });
      setRows(data.results ?? data);
    } catch (e) {
      say(errText(e), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);

  const setSt = async (c, st) => {
    try {
      await studentIdApi.setStatus(c.id, st);
      load();
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const reprint = async (c) => {
    try {
      const { data } = await studentIdApi.payload(c.id);
      print([data]);
    } catch (e) {
      say(errText(e), "error");
    }
  };

  const replace = async (c) => {
    const reason = window.prompt(`Why is ${c.student_name}'s card being replaced?`, "Lost");
    if (reason === null) return;
    try {
      const { data } = await studentIdApi.issue({ student_id: c.student, replace: true, reason });
      say(`New card ${data.card.card_number} issued. The old card stops working immediately.`);
      print([data.card]);
      load();
    } catch (e) {
      say(errText(e), "error");
    }
  };

  return (
    <div className="table-wrap">
      <div className="table-wrap__header">
        <div className="d-flex gap-2 flex-wrap w-100">
          <input
            className="form-control"
            style={{ maxWidth: 320 }}
            placeholder="Card no, name, admission no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="form-select w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(STATUS).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead>
            <tr>
              <th>Card No</th>
              <th>Student</th>
              <th>Adm No</th>
              <th>Class</th>
              <th>Status</th>
              <th>Expires</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan="7" className="text-center cell-muted py-4">Loading...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan="7" className="text-center cell-muted py-4">No cards found.</td></tr>
            )}
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="cell-mono text-brand fw-semibold">{c.card_number}</td>
                <td>
                  {c.student_name}
                  {!c.has_photo && <span className="badge badge-warning ms-2">No photo</span>}
                </td>
                <td className="cell-muted">{c.admission_no}</td>
                <td className="cell-muted">{c.classroom || "-"}</td>
                <td><span className={`badge ${STATUS[c.status]}`}>{c.status_display}</span></td>
                <td className="cell-mono">{c.expiry_date}</td>
                <td className="text-end">
                  {c.status !== "REPLACED" && (
                    <div className="table-actions justify-content-end">
                      {c.status === "ACTIVE" ? (
                        <>
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => reprint(c)} title="Print this card again">
                            <i className="bi bi-printer"></i>
                          </button>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => setSt(c, "LOST")}>
                            Mark lost
                          </button>
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => setSt(c, "BLOCKED")}>
                            Block
                          </button>
                          <button className="btn btn-sm btn-outline-primary" onClick={() => replace(c)}>
                            Replace
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-sm btn-outline-primary" onClick={() => setSt(c, "ACTIVE")}>
                            Reactivate
                          </button>
                          <button className="btn btn-sm btn-primary" onClick={() => replace(c)}>
                            Issue new card
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}