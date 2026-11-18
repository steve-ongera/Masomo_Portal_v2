// hooks/useSidebar.js
import { useState, useEffect, useCallback } from "react";
import { useDevice } from "./useDevice";

/**
 * Manages sidebar behavior across breakpoints:
 * - Desktop (>=992px): sidebar is ALWAYS visible by default.
 *   Toggling only switches it between full width and icon-rail ("collapsed").
 * - Mobile/tablet (<992px): sidebar is an off-canvas drawer, hidden by default.
 *   Toggling slides it in/out ("mobileOpen"), and it auto-closes on route change
 *   (handled in Sidebar.jsx) or when the viewport crosses back up to desktop.
 *
 * The 992px breakpoint now comes from useDevice (`isWide`), the same source
 * main.css / mobile.css use, so JS and CSS can never disagree.
 */
export function useSidebar() {
  const { isWide: isDesktop } = useDevice();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // React to breakpoint changes (window resize, device rotation)
  useEffect(() => {
    if (isDesktop) {
      // Crossing up into desktop: drawer concept no longer applies
      setMobileOpen(false);
    } else {
      // Crossing down into mobile: icon-rail concept no longer applies,
      // sidebar should start fully hidden (off-canvas)
      setCollapsed(false);
    }
  }, [isDesktop]);

  const toggleSidebar = useCallback(() => {
    if (isDesktop) {
      setCollapsed((prev) => !prev);
    } else {
      setMobileOpen((prev) => !prev);
    }
  }, [isDesktop]);

  // Used by the phone bottom bar's "Menu" button
  const openMobileSidebar = useCallback(() => {
    setMobileOpen(true);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setMobileOpen(false);
  }, []);

  return {
    isDesktop,
    collapsed, // desktop: full vs icon-rail
    mobileOpen, // mobile: drawer closed vs open
    toggleSidebar,
    openMobileSidebar,
    closeMobileSidebar,
  };
}

export default useSidebar;