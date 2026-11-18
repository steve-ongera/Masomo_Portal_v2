import { useEffect, useRef, useState } from "react";
import { academicsApi } from "../../services/api";
import { studentIdApi } from "../../services/studentIdApi";
import QrScanner from "../../components/QrScanner";

const FEE_STYLE = {
  CLEARED: { bg: "#15803d", label: "FEES CLEARED" },
  GRACE: { bg: "#d97706", label: "FEES PARTLY COVERED" },
  OWING: { bg: "#b91c1c", label: "SEND TO FINANCE" },
};

function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.frequency.value = ok ? 880 : 220;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
  } catch {
    /* sound is optional */
  }
  if (navigator.vibrate) navigator.vibrate(ok ? 80 : [120, 60, 120]);
}

export default function StudentIdScan() {
  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [room, setRoom] = useState("");
  const [manual, setManual] = useState("");
  const busyRef = useRef(false);

  const refresh = async (classroom = room) => {
    try {
      const { data } = await studentIdApi.today({ classroom: classroom || undefined });
      setSummary(data);
    } catch {
      /* the list is secondary to scanning */
    }
  };

  useEffect(() => {
    academicsApi.allClassrooms().then(({ data }) => {
      const rows = data.results ?? data;
      const current = rows.filter((r) => r.academic_year_is_current);
      setRooms(current.length ? current : rows);
    });
  }, []);

  useEffect(() => {
    refresh(room);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const submit = async (body) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { data } = await studentIdApi.scanAttendance(body);
      setResult({ ok: true, ...data });
      beep(true);
      refresh();
    } catch (e) {
      const d = e.response?.data;
      setResult({ ok: false, message: d?.detail || "Scan failed. Try again.", name: d?.student_name });
      beep(false);
    } finally {
      setTimeout(() => {
        busyRef.current = false;
      }, 1200);
    }
  };

  const submitManual = () => {
    if (!manual.trim()) return;
    submit({ admission_no: manual.trim() });
    setManual("");
  };

  const fee = result?.ok ? FEE_STYLE[result.fee.status] : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Morning Attendance Scan</h1>
          <p className="page-subtitle">
            Students scan their ID card at the gate. Parents are emailed when their child arrives.
          </p>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-5">
          <div className="table-wrap p-3">
            <QrScanner onScan={(text) => submit({ qr_token: text })} />
            <div className="input-group mt-3">
              <input
                className="form-control"
                placeholder="No card? Type admission number"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitManual()}
              />
              <button className="btn btn-outline-primary" onClick={submitManual}>
                Mark present
              </button>
            </div>
          </div>
        </div>

        <div className="col-lg-7">
          {!result && (
            <div className="empty-state">
              <i className="bi bi-qr-code-scan"></i>
              <h6>Waiting for a card</h6>
              <p className="text-muted-soft">Hold the student's ID card in front of the camera.</p>
            </div>
          )}

          {result && !result.ok && (
            <div className="rounded p-4 text-white" style={{ background: "#b91c1c" }}>
              <div className="fs-4 fw-bold"><i className="bi bi-x-octagon me-2"></i>Card rejected</div>
              {result.name && <div className="fs-5 mt-1">{result.name}</div>}
              <div className="mt-2">{result.message}</div>
            </div>
          )}

          {result?.ok && (
            <div className="table-wrap">
              <div className="p-3 d-flex gap-3">
                <div
                  style={{
                    width: 110, height: 140, flex: "0 0 110px", borderRadius: 8, overflow: "hidden",
                    background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {result.student.photo_url ? (
                    <img src={result.student.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <i className="bi bi-person fs-1 text-muted"></i>
                  )}
                </div>
                <div className="flex-grow-1">
                  <div className="fs-4 fw-bold text-uppercase">
                    {result.student.surname} {result.student.given_names}
                  </div>
                  <div className="cell-muted">
                    Adm {result.student.admission_no} · {result.class.classroom || "No class"}
                  </div>
                  <div className="mt-2">
                    {result.already_checked_in ? (
                      <span className="badge badge-warning fs-6">Already checked in at {result.today.time}</span>
                    ) : (
                      <span className={`badge fs-6 ${result.arrival_status === "LATE" ? "badge-warning" : "badge-success"}`}>
                        {result.arrival_status === "LATE" ? "Marked LATE" : "Marked PRESENT"} · {result.today.time}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="px-3 py-2 text-white" style={{ background: fee.bg }}>
                <div className="fw-bold">{fee.label}</div>
                <div className="small">{result.fee.message}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Today's register */}
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <select className="form-select w-auto" value={room} onChange={(e) => setRoom(e.target.value)}>
          <option value="">Whole school</option>
          {rooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.grade_level_name} {c.stream_name}
            </option>
          ))}
        </select>
        {summary && (
          <>
            <span className="badge badge-success">Present: {summary.present}</span>
            <span className="badge badge-warning">Late: {summary.late}</span>
            <span className="badge badge-neutral">Not yet in: {summary.absent_count}</span>
            <span className="cell-muted">of {summary.expected} expected</span>
          </>
        )}
        <button className="btn btn-sm btn-light ms-auto" onClick={() => refresh()}>
          <i className="bi bi-arrow-clockwise me-1"></i>Refresh
        </button>
      </div>

      {summary && (
        <div className="table-wrap">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr><th>Time</th><th>Adm No</th><th>Student</th><th>Class</th><th>Status</th><th>Fees</th><th>Parent emailed</th></tr>
              </thead>
              <tbody>
                {summary.arrivals.length === 0 && (
                  <tr><td colSpan="7" className="text-center cell-muted py-4">Nobody scanned in yet.</td></tr>
                )}
                {summary.arrivals.map((a) => (
                  <tr key={a.id}>
                    <td className="cell-mono">{a.time}</td>
                    <td className="cell-mono">{a.admission_no}</td>
                    <td>{a.name}</td>
                    <td className="cell-muted">{a.classroom}</td>
                    <td>
                      <span className={`badge ${a.status === "LATE" ? "badge-warning" : "badge-success"}`}>{a.status}</span>
                    </td>
                    <td>
                      <span className="badge" style={{ background: FEE_STYLE[a.fee_status]?.bg || "#64748b" }}>
                        {a.fee_status || "-"}
                      </span>
                    </td>
                    <td>{a.guardian_notified ? <i className="bi bi-check2-circle text-success"></i> : <span className="cell-muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary?.absent?.length > 0 && (
        <div className="mt-3">
          <h6>Not yet scanned in ({summary.absent.length})</h6>
          <div className="d-flex flex-wrap gap-2">
            {summary.absent.map((s) => (
              <span key={s.student_id} className="badge badge-neutral">{s.name} · {s.admission_no}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}