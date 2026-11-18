// components/AppLayout.jsx
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import MobileBottomNav from "./MobileBottomNav";
import { useSidebar } from "../hooks/useSidebar";
import { LicenseProvider } from "../context/LicenseContext";
import LicenseLockOverlay from "./LicenseLockOverlay";
import { LicenseUsageProvider } from "../context/LicenseUsageContext";
import LicenseUsageToasts from "./LicenseUsageToasts";

export default function AppLayout() {
  const {
    isDesktop,
    collapsed,
    mobileOpen,
    toggleSidebar,
    openMobileSidebar,
    closeMobileSidebar,
  } = useSidebar();

  return (
    <LicenseProvider>
      <LicenseUsageProvider>
        <div className="app-shell">
          <Sidebar
            isDesktop={isDesktop}
            collapsed={collapsed}
            mobileOpen={mobileOpen}
            onClose={closeMobileSidebar}
          />
          <div className="app-shell__main">
            <Navbar onToggleSidebar={toggleSidebar} />
            <main className="app-shell__content">
              <LicenseLockOverlay>
                <Outlet />
              </LicenseLockOverlay>
            </main>
          </div>
        </div>

        {/* Phones only; renders nothing on tablets/laptops */}
        <MobileBottomNav onOpenMenu={openMobileSidebar} />

        <LicenseUsageToasts />
      </LicenseUsageProvider>
    </LicenseProvider>
  );
}