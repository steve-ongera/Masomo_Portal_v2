// components/MobileBottomNav.jsx
//
// Thumb-friendly tab bar for PHONES only (< 768px). Tablets keep the drawer.
// It hides itself while the on-screen keyboard is open.
//
// Which pages appear? Up to 4 items from NAV_BY_ROLE[user.role]:
//   1. items you flag with `mobile: true` in config/navigation.js, in order
//   2. otherwise, the first items of the first groups
// The 5th slot is always "Menu", which opens the full sidebar drawer.
//
// Example flag in navigation.js:
//   { to: "/finance", icon: "bi-speedometer2", label: "Dashboard", mobile: true }
import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useDevice } from "../hooks/useDevice";
import { NAV_BY_ROLE } from "../config/navigation";

const MAX_TABS = 4;

export default function MobileBottomNav({ onOpenMenu }) {
  const { user } = useAuth();
  const { isPhone, keyboardOpen } = useDevice();

  const tabs = useMemo(() => {
    const groups = user ? NAV_BY_ROLE[user.role] || [] : [];
    const all = groups.flatMap((g) => g.items);
    const flagged = all.filter((i) => i.mobile);
    return (flagged.length ? flagged : all).slice(0, MAX_TABS);
  }, [user]);

  if (!isPhone || keyboardOpen || tabs.length === 0) return null;

  return (
    <nav className="bottom-nav" aria-label="Quick navigation">
      {tabs.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to.split("/").length === 2}
          className={({ isActive }) =>
            `bottom-nav__item${isActive ? " is-active" : ""}`
          }
        >
          <i className={`bi ${item.icon}`} aria-hidden="true"></i>
          <span>{item.label}</span>
        </NavLink>
      ))}
      <button type="button" className="bottom-nav__item" onClick={onOpenMenu}>
        <i className="bi bi-grid" aria-hidden="true"></i>
        <span>Menu</span>
      </button>
    </nav>
  );
}