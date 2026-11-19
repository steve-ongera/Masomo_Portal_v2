// components/Sidebar.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import logo from "../assets/nyali_school_logo.png";
import { NAV_BY_ROLE } from "../config/navigation";

/**
 * Nav config per role is an array of GROUPS:
 *   { label?: string, items: [{ to, icon, label }] }
 *
 * NAV_BY_ROLE lives in config/navigation.js - the single source of truth
 * shared with Navbar.jsx (role-scoped page search). Do not redeclare it
 * here; import it so the two can never drift out of sync.
 *
 * Sidebar driven entirely by props from useSidebar():
 * - Desktop (>= 992px): visible; `collapsed` hides it (.app-sidebar--collapsed).
 * - Tablet/phone (< 992px): off-canvas drawer; `mobileOpen` slides it in via
 *   `.app-sidebar--open`. It closes via the X button, the backdrop, a left
 *   swipe, the Escape key, tapping a link, or any route change.
 * - While the drawer is open the page behind it can't scroll
 *   (body.drawer-open in main.css).
 *
 * Groups with more than COLLAPSE_THRESHOLD links render as dropdowns
 * (open by default; click the header to close). Open groups draw a thin
 * tree line beside their links. The group that contains the current page
 * is always re-opened on navigation. Smaller groups render as a plain
 * section title.
 */

const COLLAPSE_THRESHOLD = 2;
const SWIPE_CLOSE_DISTANCE = 56; // px dragged left before the drawer closes
const SWIPE_MAX_VERTICAL = 40;   // ignore mostly-vertical scrolling

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const isLinkActive = (pathname, to) =>
  pathname === to || pathname.startsWith(`${to}/`);

export default function Sidebar({ isDesktop, collapsed, mobileOpen, onClose }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const asideRef = useRef(null);
  const navRef = useRef(null);
  const touchStart = useRef(null);
  const firstRender = useRef(true);

  const groups = user ? NAV_BY_ROLE[user.role] || [] : [];

  const isIconRail = isDesktop && collapsed;
  const showLabels = !isIconRail;
  const drawerOpen = !isDesktop && mobileOpen;

  const sidebarClass = [
    "app-sidebar",
    isIconRail ? "app-sidebar--collapsed" : "",
    drawerOpen ? "app-sidebar--open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  // ---- Groups the user has explicitly closed (everything else is open) ----
  const [closedGroups, setClosedGroups] = useState(() => new Set());

  const toggleGroup = useCallback((label) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  // Re-open whichever group holds the current page.
  const activeLabels = useMemo(
    () =>
      groups
        .filter(
          (g) =>
            g.label &&
            g.items.length > COLLAPSE_THRESHOLD &&
            g.items.some((item) => isLinkActive(pathname, item.to))
        )
        .map((g) => g.label),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, user]
  );

  useEffect(() => {
    if (activeLabels.length === 0) return;
    setClosedGroups((prev) => {
      if (!activeLabels.some((l) => prev.has(l))) return prev;
      const next = new Set(prev);
      activeLabels.forEach((l) => next.delete(l));
      return next;
    });
  }, [activeLabels]);

  // Keep the active link in view inside the scrolling nav.
  useEffect(() => {
    const el = navRef.current?.querySelector(".app-sidebar__link--active");
    if (el) {
      el.scrollIntoView({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [pathname]);

  // Any route change (back button, search box, notification link...) closes
  // the drawer on phones/tablets. Skipped on first mount.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!isDesktop && mobileOpen) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock page scroll behind the open drawer.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    document.body.classList.add("drawer-open");
    return () => document.body.classList.remove("drawer-open");
  }, [drawerOpen]);

  // Escape closes the open drawer (phone/tablet only).
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, onClose]);

  // Swipe left on the drawer to close it. Passive listeners never block
  // the nav's own vertical scrolling.
  useEffect(() => {
    const el = asideRef.current;
    if (!el || !drawerOpen) return undefined;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) {
        touchStart.current = null;
        return;
      }
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY, done: false };
    };
    const onTouchMove = (e) => {
      const start = touchStart.current;
      if (!start || start.done) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dx <= -SWIPE_CLOSE_DISTANCE && dy < SWIPE_MAX_VERTICAL) {
        start.done = true;
        onClose?.();
      }
    };
    const reset = () => {
      touchStart.current = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", reset, { passive: true });
    el.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", reset);
      el.removeEventListener("touchcancel", reset);
    };
  }, [drawerOpen, onClose]);

  const renderLinks = (items) => (
    <div className="app-sidebar__links">
      {items.map((item) => (
        <NavLink
          key={item.to + item.label}
          to={item.to}
          end={item.to.split("/").length === 2}
          className={({ isActive }) =>
            `app-sidebar__link ${isActive ? "app-sidebar__link--active" : ""}`
          }
          onClick={!isDesktop ? onClose : undefined}
          title={!showLabels ? item.label : undefined}
        >
          <i className={`bi ${item.icon}`} aria-hidden="true"></i>
          {showLabels && <span>{item.label}</span>}
        </NavLink>
      ))}
    </div>
  );

  return (
    <>
      <aside
        className={sidebarClass}
        ref={asideRef}
        aria-label="Main navigation"
        // A closed drawer is off-screen: hide it from screen readers too
        aria-hidden={!isDesktop && !mobileOpen ? "true" : undefined}
      >
        <div className="app-sidebar__brand">
          <div className="app-sidebar__brand-inner">
            <div className="app-sidebar__logo">
              <img src={logo} alt="Masomo System Logo" />
            </div>
            {showLabels && (
              <span className="app-sidebar__brand-text">Masomo Portal</span>
            )}
          </div>

          {/* Close (X) button - phone/tablet drawer only (hidden by CSS on desktop) */}
          {!isDesktop && (
            <button
              type="button"
              className="app-sidebar__close"
              onClick={onClose}
              aria-label="Close menu"
            >
              <i className="bi bi-x-lg" aria-hidden="true"></i>
            </button>
          )}
        </div>

        {/* Navigation: scrolls internally, grouped with section labels */}
        <nav className="app-sidebar__nav" ref={navRef}>
          {totalItems === 0 ? (
            <div className="app-sidebar__empty">No items available</div>
          ) : (
            groups.map((group, gi) => {
              const key = group.label || `group-${gi}`;

              // Unlabelled group: just the links
              if (!group.label) {
                return (
                  <div className="app-sidebar__group" key={key}>
                    {renderLinks(group.items)}
                  </div>
                );
              }

              // Small group: static section title
              if (group.items.length <= COLLAPSE_THRESHOLD) {
                return (
                  <div className="app-sidebar__group" key={key}>
                    {showLabels && (
                      <div className="app-sidebar__section-title">{group.label}</div>
                    )}
                    {renderLinks(group.items)}
                  </div>
                );
              }

              // Larger group: collapsible dropdown (open by default)
              const isOpen = !closedGroups.has(group.label);
              return (
                <div className="app-sidebar__group" key={key}>
                  {showLabels && (
                    <button
                      type="button"
                      className={`app-sidebar__group-header${isOpen ? " is-open" : ""}`}
                      onClick={() => toggleGroup(group.label)}
                      aria-expanded={isOpen}
                    >
                      <span>{group.label}</span>
                      <i
                        className="bi bi-chevron-right app-sidebar__group-chevron"
                        aria-hidden="true"
                      ></i>
                    </button>
                  )}
                  <div
                    className={`app-sidebar__group-collapse${
                      isOpen || !showLabels ? " is-open" : ""
                    }`}
                  >
                    {renderLinks(group.items)}
                  </div>
                </div>
              );
            })
          )}
        </nav>

        {/* Footer - product name + version */}
        {showLabels && (
          <div className="app-sidebar__footer">
            <span className="app-sidebar__footer-icon" aria-hidden="true">
              <i className="bi bi-mortarboard-fill"></i>
            </span>
            <div className="app-sidebar__footer-text">
              <span className="app-sidebar__copy">Masomo Portal</span>
              <span className="app-sidebar__version">
                v2.1.0 · © {new Date().getFullYear()}
              </span>
            </div>
          </div>
        )}
      </aside>

      {!isDesktop && mobileOpen && (
        <div className="app-sidebar__backdrop" onClick={onClose} aria-hidden="true" />
      )}
    </>
  );
}