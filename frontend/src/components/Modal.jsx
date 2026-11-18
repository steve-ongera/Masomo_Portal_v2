// src/components/Modal.jsx
import { useEffect, useRef, useState } from "react";

// true  = must double-press (press, release, press again and hold) on the title bar
// false = also works with a normal press-and-drag (like a Windows title bar)
const REQUIRE_DOUBLE_PRESS = false;
const DOUBLE_PRESS_MS = 600; // max gap between the two presses
const DOUBLE_PRESS_PX = 20;  // max pointer movement between the two presses
const DRAG_THRESHOLD_PX = 4; // movement before a single press turns into a drag
const KEEP_VISIBLE_X = 80;   // px of the window that must stay on screen horizontally
const KEEP_VISIBLE_Y = 40;   // px of the title bar that must stay above the bottom edge

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export default function Modal({
  show,
  onClose,
  title,
  children,
  size,
  footer,
  closeOnBackdrop = true,
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const contentRef = useRef(null);
  const lastPress = useRef({ t: 0, x: 0, y: 0 });
  const drag = useRef(null);
  const justDragged = useRef(false);

  // every time the modal closes, the next one opens centred again
  useEffect(() => {
    if (!show) {
      setPos({ x: 0, y: 0 });
      setDragging(false);
      drag.current = null;
    }
  }, [show]);

  if (!show) return null;

  const isFullscreen = size === "fullscreen";

  const handleBackdropClick = (e) => {
    if (justDragged.current) return; // a drag that ended over the backdrop must not close the modal
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };

  // ---- drag the window by its title bar ----
  const onHeaderPointerDown = (e) => {
    if (isFullscreen) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(".btn-close")) return;

    const now = Date.now();
    const last = lastPress.current;
    const isSecondPress =
      now - last.t < DOUBLE_PRESS_MS &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_PRESS_PX;

    if (REQUIRE_DOUBLE_PRESS && !isSecondPress) {
      lastPress.current = { t: now, x: e.clientX, y: e.clientY };
      return;
    }
    lastPress.current = isSecondPress ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };

    const rect = contentRef.current.getBoundingClientRect();
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      rect,
      active: isSecondPress, // double-press starts at once; a single press waits for movement
    };
    if (isSecondPress) {
      e.preventDefault(); // no text selection while dragging
      setDragging(true);
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
  };

  const onHeaderPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const rawX = e.clientX - d.startX;
    const rawY = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(rawX, rawY) < DRAG_THRESHOLD_PX) return;
      d.active = true;
      setDragging(true);
    }
    const dx = clamp(rawX, KEEP_VISIBLE_X - d.rect.right, window.innerWidth - KEEP_VISIBLE_X - d.rect.left);
    const dy = clamp(rawY, -d.rect.top, window.innerHeight - KEEP_VISIBLE_Y - d.rect.top);
    setPos({ x: d.origX + dx, y: d.origY + dy });
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (!d.active) return;
    setDragging(false);
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 100);
  };

  return (
    <>
      <div
        className="modal-backdrop fade show"
        onClick={handleBackdropClick}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(11, 37, 69, 0.55)",
          zIndex: 1040,
          backdropFilter: "blur(2px)",
        }}
      ></div>
      <div
        className="modal fade show"
        style={{
          display: "block",
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          overflow: "hidden",
          zIndex: 1050,
        }}
        tabIndex="-1"
        role="dialog"
        aria-modal="true"
        onClick={handleBackdropClick}
      >
        <div
          className={`modal-dialog modal-dialog-scrollable ${
            isFullscreen ? "modal-fullscreen" : "modal-dialog-centered"
          } ${size && !isFullscreen ? `modal-${size}` : ""}`}
          role="document"
          style={{
            display: "flex",
            alignItems: isFullscreen ? "stretch" : "center",
            minHeight: isFullscreen ? "100vh" : "calc(100% - 1rem)",
            margin: isFullscreen ? 0 : "0.5rem auto",
            maxWidth: isFullscreen
              ? "100vw"
              : size === "sm"
              ? "400px"
              : size === "lg"
              ? "800px"
              : size === "xl"
              ? "1000px"
              : "560px",
            width: "100%",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={contentRef}
            className="modal-content"
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              width: "100%",
              height: isFullscreen ? "100vh" : undefined,
              pointerEvents: "auto",
              backgroundColor: "#ffffff",
              backgroundClip: "padding-box",
              border: isFullscreen ? "none" : "1px solid var(--border-color)",
              borderRadius: isFullscreen ? 0 : "var(--radius-lg)",
              boxShadow: isFullscreen ? "none" : "0 20px 60px rgba(11, 37, 69, 0.15)",
              outline: 0,
              maxHeight: isFullscreen ? "100vh" : "calc(100vh - 1rem)",
              transform: pos.x || pos.y ? `translate(${pos.x}px, ${pos.y}px)` : undefined,
              willChange: dragging ? "transform" : undefined,
            }}
          >
            {/* Modal Header — double-click and hold here, then drag to move */}
            <div
              className="modal-header"
              title={isFullscreen ? undefined : "Drag to move"}
              onPointerDown={onHeaderPointerDown}
              onPointerMove={onHeaderPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                display: "flex",
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1rem 1.5rem",
                borderBottom: "1px solid var(--border-color)",
                borderTopLeftRadius: isFullscreen ? 0 : "var(--radius-lg)",
                borderTopRightRadius: isFullscreen ? 0 : "var(--radius-lg)",
                backgroundColor: "var(--bg-app)",
                userSelect: "none",
                WebkitUserSelect: "none",
                touchAction: isFullscreen ? undefined : "none",
                cursor: dragging ? "grabbing" : "default",
              }}
            >
              <h5
                className="modal-title"
                style={{
                  margin: 0,
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: "var(--fs-md)",
                  color: "var(--ink-900)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                {title}
              </h5>
              <button
                type="button"
                className="btn-close"
                onClick={onClose}
                aria-label="Close"
                style={{
                  padding: "0.5rem",
                  margin: "-0.5rem -0.5rem -0.5rem auto",
                  backgroundColor: "transparent",
                  border: 0,
                  borderRadius: "var(--radius-sm)",
                  opacity: 0.5,
                  cursor: "pointer",
                  fontSize: "1.2rem",
                  lineHeight: 1,
                  color: "var(--ink-600)",
                  transition: "opacity 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = 0.5)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Modal Body */}
            <div
              className="modal-body"
              style={{
                position: "relative",
                flex: "1 1 auto",
                padding: "1.5rem",
                overflowY: "auto",
                color: "var(--ink-700)",
                fontSize: "var(--fs-base)",
                lineHeight: 1.6,
              }}
            >
              {children}
            </div>

            {/* Modal Footer (optional) */}
            {footer && (
              <div
                className="modal-footer"
                style={{
                  display: "flex",
                  flexShrink: 0,
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  padding: "0.75rem 1.5rem",
                  borderTop: "1px solid var(--border-color)",
                  borderBottomLeftRadius: isFullscreen ? 0 : "var(--radius-lg)",
                  borderBottomRightRadius: isFullscreen ? 0 : "var(--radius-lg)",
                  backgroundColor: "var(--bg-app)",
                  gap: "0.5rem",
                }}
              >
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}