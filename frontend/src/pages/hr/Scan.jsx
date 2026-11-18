import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { gateApi, authApi } from "../../services/api";

/* ==========================================================================
   Gate attendance - two ways in:
   1. /my-attendance/scan          -> in-app camera opens straight away, reads
                                      the HR gate QR and submits instantly.
   2. /my-attendance/scan/:token   -> deep link (phone camera app scanned the
                                      QR): submits instantly, no camera needed.

   Speed notes (so morning queues stay short):
   - Camera starts and GPS is warmed up in parallel, before the QR is seen.
   - The moment a valid gate code is decoded it is submitted - no confirm tap.
   - QR decoding uses the native BarcodeDetector when the browser has it
     (Chrome / Android) and falls back to the small `jsqr` library otherwise
     (iPhone Safari). Install it once:  npm i jsqr
   - The gate code is only valid ~45s, so scan the code currently on screen.
   - Browsers only allow camera access on HTTPS (or localhost).
   ========================================================================== */

const deviceId = () => {
  let id = localStorage.getItem("hr_device_id");
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("hr_device_id", id);
  }
  return id;
};

// Where "Back to Dashboard" goes for each role.
const ROLE_HOME = {
  ADMIN: "/admin",
  PRINCIPAL: "/principal",
  SECRETARY: "/secretary",
  EXAM_OFFICER: "/exam-officer",
  TEACHER: "/teacher",
  FINANCE: "/finance",
  HR: "/hr",
  LIBRARIAN: "/librarian",
  CAFETERIA: "/cafeteria",
  PROCUREMENT: "/procurement",
  STAFF: "/my-payslips",
};

// The gate QR holds  <site>/my-attendance/scan/<signed-token>.
// Accept that URL, or a bare signed token.
const extractToken = (text) => {
  if (!text) return null;
  const t = String(text).trim();
  const m = t.match(/\/my-attendance\/scan\/([^/?#\s]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(t) ? t : null;
};

const SCAN_META = {
  IN: {
    title: "Signed In",
    icon: "bi-box-arrow-in-right",
    accent: "success",
    blurb: "Have a great day at school.",
  },
  OUT: {
    title: "Signed Out",
    icon: "bi-box-arrow-out-right",
    accent: "blue",
    blurb: "See you tomorrow.",
  },
};

const ACCENT = {
  success: {
    bg: "var(--success-100)",
    fg: "var(--success-600)",
    ring: "var(--success-600)",
  },
  blue: {
    bg: "var(--blue-100)",
    fg: "var(--blue-700)",
    ring: "var(--blue-600)",
  },
};

export default function Scan() {
  const { token } = useParams();
  const [state, setState] = useState({
    phase: token ? "locating" : "scanning",
  });
  const [hint, setHint] = useState("");
  const [home, setHome] = useState("/profile");

  const videoRef = useRef(null);
  const geo = useRef({ fix: null, failed: false, watchId: null });
  const submittedFor = useRef(null); // guards against double-submits

  /* ---- where "Back to Dashboard" should go --------------------------- */
  useEffect(() => {
    let alive = true;
    authApi
      .me()
      .then((r) => {
        const role = r?.data?.role ?? r?.data?.user?.role;
        if (alive && ROLE_HOME[role]) setHome(ROLE_HOME[role]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* ---- location: warmed up in the background, kept fresh ------------- */
  useEffect(() => {
    const g = geo.current;
    if (!navigator.geolocation) {
      g.failed = true;
      return;
    }
    g.failed = false;
    g.watchId = navigator.geolocation.watchPosition(
      (p) => {
        g.fix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        };
      },
      () => {
        if (!g.fix) g.failed = true;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
    return () => {
      if (g.watchId != null) navigator.geolocation.clearWatch(g.watchId);
    };
  }, []);

  // Resolves with the latest fix as soon as there is one (or {} if location
  // is denied / takes too long) - the server decides if that is acceptable.
  const getFix = useCallback(async (maxMs = 10000) => {
    const g = geo.current;
    const start = Date.now();
    while (!g.fix && !g.failed && Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return g.fix || {};
  }, []);

  /* ---- submit a gate token ------------------------------------------- */
  const submit = useCallback(
    async (gateToken) => {
      setState({ phase: "submitting" });
      const fix = await getFix();
      try {
        const { data } = await gateApi.scan({
          token: gateToken,
          device_id: deviceId(),
          ...fix,
        });
        if (navigator.vibrate) navigator.vibrate(120);
        setState({ phase: "done", result: data });
      } catch (e) {
        if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
        setState({
          phase: "error",
          message:
            e.response?.data?.detail ||
            "Could not record your scan. Please try again.",
        });
      }
    },
    [getFix]
  );

  /* ---- deep link (token in URL) vs in-app camera --------------------- */
  useEffect(() => {
    if (token) {
      if (submittedFor.current === token) return; // StrictMode / re-render guard
      submittedFor.current = token;
      submit(token);
    } else {
      submittedFor.current = null;
      setState({ phase: "scanning" });
    }
  }, [token, submit]);

  /* ---- camera + QR detection ----------------------------------------- */
  useEffect(() => {
    if (token || state.phase !== "scanning") return undefined;

    let stream = null;
    let timer = null;
    let stopped = false;
    let handled = false;

    const stopCamera = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("unsupported"), { name: "Unsupported" });
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (stopped) {
          stopCamera();
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        const detector =
          "BarcodeDetector" in window
            ? new window.BarcodeDetector({ formats: ["qr_code"] })
            : null;
        const jsQR = detector ? null : (await import("jsqr")).default;

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const tick = async () => {
          if (stopped) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth) {
            let text = null;
            try {
              if (detector) {
                const codes = await detector.detect(v);
                text = codes[0]?.rawValue || null;
              } else {
                const scale = Math.min(1, 640 / v.videoWidth);
                canvas.width = Math.round(v.videoWidth * scale);
                canvas.height = Math.round(v.videoHeight * scale);
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                text =
                  jsQR(img.data, canvas.width, canvas.height, {
                    inversionAttempts: "dontInvert",
                  })?.data || null;
              }
            } catch {
              /* a bad frame - just try the next one */
            }

            if (text && !handled) {
              const gateToken = extractToken(text);
              if (gateToken) {
                handled = true;
                stopCamera();
                submit(gateToken);
                return;
              }
              setHint("That is not the school gate code. Scan the gate screen.");
            }
          }
          timer = setTimeout(tick, 90);
        };
        tick();
      } catch (e) {
        stopCamera();
        const denied = e.name === "NotAllowedError" || e.name === "SecurityError";
        setState({
          phase: "cameraError",
          message: denied
            ? "Camera access was blocked. Allow the camera for this site in your browser settings, then try again."
            : e.name === "Unsupported"
            ? "This browser cannot open the camera here. Make sure the site is opened over HTTPS, or use your phone's camera app to scan the gate QR."
            : "The camera could not be started. Close other apps using it and try again.",
        });
      }
    })();

    return stopCamera;
  }, [token, state.phase, submit]);

  const rescan = () => {
    setHint("");
    setState({ phase: "scanning" });
  };

  const retrySameCode = () => {
    if (token) {
      submittedFor.current = token;
      submit(token);
    } else {
      rescan();
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Sign In / Sign Out</h1>
          <p className="page-subtitle">
            Scan the gate QR code to record your attendance
          </p>
        </div>
      </div>

      {/* Body — standalone verify card, still inside the standard page frame */}
      <div className="verify-page" style={{ minHeight: "auto", padding: 0 }}>
        <div className="verify-card">
          {/* ---- Header ---- */}
          <div className="verify-header">
            <div
              className="dm-card__icon"
              style={{
                width: 44,
                height: 44,
                fontSize: "1.3rem",
              }}
            >
              <i className="bi bi-shield-check"></i>
            </div>
            <div>
              <div className="verify-school">Gate Attendance</div>
              <div className="verify-subtitle">School sign-in / sign-out</div>
            </div>
          </div>

          {/* ---- Camera scanner ---- */}
          {state.phase === "scanning" && (
            <div className="text-center">
              <div
                className="rounded-md mb-3"
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1 / 1",
                  maxHeight: 360,
                  overflow: "hidden",
                  background: "#000",
                }}
              >
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                {/* aiming frame */}
                <div
                  style={{
                    position: "absolute",
                    inset: "14%",
                    border: "3px solid rgba(255,255,255,0.9)",
                    borderRadius: 16,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
                    pointerEvents: "none",
                  }}
                />
              </div>

              <div className="verify-title">Scan the Gate QR Code</div>
              <p className="verify-message mb-0">
                Point your camera at the code on the gate screen. It signs you
                in or out automatically.
              </p>

              {hint && (
                <div className="alert alert-warning mt-3 mb-0" role="alert">
                  <i className="bi bi-exclamation-triangle me-1"></i>
                  {hint}
                </div>
              )}

              <div className="note-card mt-3 mb-0">
                <i className="bi bi-geo-alt"></i>
                <span>
                  Allow camera and location when your browser asks — location
                  confirms you are on school premises.
                </span>
              </div>
            </div>
          )}

          {/* ---- Locating (deep link only) ---- */}
          {state.phase === "locating" && (
            <Spinner
              title="Checking Your Location"
              text="Please allow location access — this confirms you are on school premises."
            />
          )}

          {/* ---- Submitting ---- */}
          {state.phase === "submitting" && (
            <Spinner
              title="Recording Your Scan"
              text="This will only take a moment."
            />
          )}

          {/* ---- Done ---- */}
          {state.phase === "done" && state.result && (
            <ScanResult result={state.result} home={home} />
          )}

          {/* ---- Camera problem ---- */}
          {state.phase === "cameraError" && (
            <ErrorBlock
              title="Camera Not Available"
              message={state.message}
              icon="bi-camera-video-off"
              home={home}
              primaryLabel="Try Camera Again"
              onPrimary={rescan}
            />
          )}

          {/* ---- Scan refused / failed ---- */}
          {state.phase === "error" && (
            <ErrorBlock
              title="Scan Not Recorded"
              message={state.message}
              icon="bi-exclamation-octagon"
              home={home}
              primaryLabel={token ? "Try Again" : "Scan Again"}
              onPrimary={retrySameCode}
              extra={
                token && (
                  <Link
                    to="/my-attendance/scan"
                    className="btn btn-outline-primary"
                  >
                    <i className="bi bi-qr-code-scan me-1"></i>
                    Scan With Camera
                  </Link>
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Small building blocks
   ========================================================================== */

function Spinner({ title, text }) {
  return (
    <div className="text-center py-4">
      <div className="page-loader__ring" style={{ margin: "0 auto 1rem" }} />
      <div className="verify-title">{title}</div>
      <p className="verify-message mb-0">{text}</p>
    </div>
  );
}

function ErrorBlock({ title, message, icon, home, primaryLabel, onPrimary, extra }) {
  return (
    <div>
      <div className="text-center mb-3">
        <div
          className="modal-icon-circle modal-icon-circle--danger"
          style={{
            width: 64,
            height: 64,
            fontSize: "1.8rem",
            margin: "0 auto 0.9rem",
          }}
        >
          <i className={`bi ${icon}`}></i>
        </div>
        <div className="verify-title">{title}</div>
        <p className="verify-message">{message}</p>
      </div>

      <div className="d-flex gap-2 justify-content-center flex-wrap">
        <button className="btn btn-primary" onClick={onPrimary}>
          <i className="bi bi-arrow-clockwise me-1"></i>
          {primaryLabel}
        </button>
        {extra}
        <Link to={home} className="btn btn-secondary">
          <i className="bi bi-house-door me-1"></i>
          Back to Dashboard
        </Link>
      </div>

      <div
        className="note-card mt-3"
        style={{
          background: "var(--gold-100)",
          borderColor: "var(--gold-500)",
          color: "var(--gold-600)",
          textAlign: "left",
        }}
      >
        <i className="bi bi-lightbulb"></i>
        <span>
          <strong>Still not working?</strong> The gate code changes every few
          seconds — scan the one showing right now. Use your own phone and
          account, and make sure location is allowed.
        </span>
      </div>
    </div>
  );
}

/* ==========================================================================
   SCAN RESULT — success state, adapts to IN vs OUT
   ========================================================================== */

function ScanResult({ result, home }) {
  const meta =
    SCAN_META[result.kind] || {
      title: result.kind || "Recorded",
      icon: "bi-check2-circle",
      accent: "blue",
      blurb: "Your scan has been recorded.",
    };

  const accent = ACCENT[meta.accent] || ACCENT.blue;
  const circleVariant = meta.accent === "success" ? "modal-icon-circle--success" : "modal-icon-circle--info";

  const displayTime =
    result.time ||
    new Date().toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="text-center">
      {/* ---- Big success circle ---- */}
      <div
        className={`modal-icon-circle ${circleVariant}`}
        style={{
          width: 88,
          height: 88,
          fontSize: "2.4rem",
          margin: "0 auto 1rem",
          boxShadow: `0 0 0 6px ${accent.bg}`,
        }}
      >
        <i className={`bi ${meta.icon}`}></i>
      </div>

      {/* ---- Headline ---- */}
      <div
        className="verify-title"
        style={{
          fontSize: "var(--fs-lg)",
          marginBottom: "0.35rem",
          color: accent.fg,
        }}
      >
        {meta.title}
      </div>

      {/* ---- Employee + time block ---- */}
      <div className="fee-box mb-3">
        <div className="section-label mb-1">Recorded For</div>
        <div className="cell-name mb-2" style={{ fontSize: "var(--fs-md)" }}>
          {result.employee}
        </div>

        <div className="d-flex justify-content-center gap-3 pt-2 border-top border-dashed">
          <div>
            <div className="section-label mb-1">Time</div>
            <div className="cell-mono fw-bold">
              <i className="bi bi-clock me-1 text-muted-soft"></i>
              {displayTime}
            </div>
          </div>

          <div>
            <div className="section-label mb-1">Date</div>
            <div className="cell-mono fw-bold">
              <i className="bi bi-calendar3 me-1 text-muted-soft"></i>
              {new Date().toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Friendly blurb ---- */}
      <div
        className="mb-3 p-2 rounded-md small fw-semibold"
        style={{
          background: accent.bg,
          border: `1px solid ${accent.ring}`,
          color: accent.fg,
          lineHeight: 1.55,
        }}
      >
        <i className="bi bi-check2-circle me-1"></i>
        {meta.blurb}
      </div>

      {/* ---- Action ---- */}
      <Link to={home} className="btn btn-primary w-100">
        <i className="bi bi-house-door me-1"></i>
        Back to Dashboard
      </Link>

      <p
        className="text-muted-soft mt-3 mb-0"
        style={{ fontSize: "0.6rem", lineHeight: 1.5 }}
      >
        This scan has been logged. If anything looks wrong, tell the school
        office.
      </p>
    </div>
  );
}