// src/components/Modal.jsx
//
// Same props and behaviour as before (drag by the title bar, Esc-less backdrop
// close, fullscreen, sizes, footer). Two OPTIONAL props were added for the new
// design and are ignored by existing callers:
//   icon     - a Bootstrap icon class, e.g. "bi-mortarboard"
//   subtitle - small grey line under the title
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
  subtitle,
  icon,
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
    if (e.target.closest("button")) return;

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

  const maxWidth = isFullscreen
    ? "100vw"
    : size === "sm"
    ? "400px"
    : size === "lg"
    ? "800px"
    : size === "xl"
    ? "1000px"
    : "560px";

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
          backgroundColor: "rgba(17, 22, 51, 0.5)",
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
            maxWidth,
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
              borderRadius: isFullscreen ? 0 : undefined,
              boxShadow: isFullscreen ? "none" : undefined,
              outline: 0,
              maxHeight: isFullscreen ? "100vh" : "calc(100vh - 1rem)",
              transform: pos.x || pos.y ? `translate(${pos.x}px, ${pos.y}px)` : undefined,
              willChange: dragging ? "transform" : undefined,
            }}
          >
            {/* Header: optional icon + title + subtitle + close. Drag here to move. */}
            <div
              className="modal-header"
              title={isFullscreen ? undefined : "Drag to move"}
              onPointerDown={onHeaderPointerDown}
              onPointerMove={onHeaderPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{
                flexShrink: 0,
                backgroundColor: "#ffffff",
                userSelect: "none",
                WebkitUserSelect: "none",
                touchAction: isFullscreen ? undefined : "none",
                cursor: dragging ? "grabbing" : "default",
              }}
            >
              {icon && (
                <span className="modal-header__icon" aria-hidden="true">
                  <i className={`bi ${icon.startsWith("bi-") ? icon : `bi-${icon}`}`}></i>
                </span>
              )}
              <div className="modal-header__text">
                <h5 className="modal-title">{title}</h5>
                {subtitle && <p className="modal-subtitle">{subtitle}</p>}
              </div>
              <button
                type="button"
                className="btn btn-icon btn-light"
                onClick={onClose}
                aria-label="Close"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Body: the only part that scrolls */}
            <div
              className="modal-body"
              style={{
                position: "relative",
                flex: "1 1 auto",
                overflowY: "auto",
                color: "var(--ink-700)",
                fontSize: "var(--fs-base)",
                lineHeight: 1.6,
              }}
            >
              {children}
            </div>

            {/* Footer (optional) */}
            {footer && (
              <div
                className="modal-footer"
                style={{ flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}
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