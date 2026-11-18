import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

/**
 * Camera QR scanner. Calls onScan(text) once per code; the same code is ignored
 * for `repeatMs` so a card held in front of the camera isn't submitted repeatedly.
 * NOTE: browsers only allow the camera on HTTPS or http://localhost.
 */
export default function QrScanner({ onScan, repeatMs = 3000, autoStart = false }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const scannerRef = useRef(null);
  const handlerRef = useRef(onScan);
  const lastRef = useRef({ text: "", at: 0 });
  const idRef = useRef(`qr-reader-${Math.random().toString(36).slice(2)}`);
  handlerRef.current = onScan;

  const stop = async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {
        /* already stopped */
      }
    }
    setRunning(false);
  };

  const start = async () => {
    setError("");
    try {
      const s = new Html5Qrcode(idRef.current);
      scannerRef.current = s;
      await s.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          const now = Date.now();
          const last = lastRef.current;
          if (text === last.text && now - last.at < repeatMs) return;
          lastRef.current = { text, at: now };
          handlerRef.current?.(text);
        },
        () => {}
      );
      setRunning(true);
    } catch (e) {
      scannerRef.current = null;
      setError(
        window.isSecureContext
          ? "Could not open the camera. Allow camera access in the browser and try again."
          : "The camera needs HTTPS (or localhost). Open this page over https://."
      );
    }
  };

  useEffect(() => {
    if (autoStart) start();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div
        id={idRef.current}
        style={{ width: "100%", minHeight: running ? 280 : 0, borderRadius: 8, overflow: "hidden", background: "#0f172a" }}
      />
      {error && <div className="alert alert-danger py-2 mt-2 mb-0 small">{error}</div>}
      <div className="mt-2">
        {running ? (
          <button type="button" className="btn btn-outline-secondary w-100" onClick={stop}>
            <i className="bi bi-camera-video-off me-2"></i>Stop camera
          </button>
        ) : (
          <button type="button" className="btn btn-primary w-100" onClick={start}>
            <i className="bi bi-camera-video me-2"></i>Start camera
          </button>
        )}
      </div>
    </div>
  );
}