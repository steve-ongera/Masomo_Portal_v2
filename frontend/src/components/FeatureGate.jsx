import { Link, useLocation } from "react-router-dom";
import { useEntitlements, useFeature } from "../context/EntitlementContext";

/** Wraps a route: shows the upgrade page instead of the page when the plan excludes it. */
export function FeatureRoute({ children }) {
  const { pathname } = useLocation();
  const { loading, canAccessPath, gateFor } = useEntitlements();
  if (!loading && !canAccessPath(pathname)) return <UpgradeRequired gate={gateFor(pathname)} />;
  return children;
}

/** Wraps a widget / button / dashboard card inside a page that IS available. */
export function FeatureGate({ code, fallback = null, children }) {
  return useFeature(code) ? children : fallback;
}

export function UpgradeRequired({ gate }) {
  const { tierDisplay } = useEntitlements();
  return (
    <div style={{ maxWidth: 520, margin: "10vh auto", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 40 }} aria-hidden>🔒</div>
      <h2 style={{ margin: "12px 0 8px" }}>{gate?.name || "This feature"} isn't part of your plan</h2>
      <p style={{ opacity: 0.75, lineHeight: 1.5 }}>
        Your school is on the <strong>{tierDisplay || "current"}</strong> plan.
        {gate?.upgrade_to ? <> It is included from <strong>{gate.upgrade_to}</strong>
          {gate.upgrade_price ? ` (KES ${Number(gate.upgrade_price).toLocaleString()} / month)` : ""}.</> : null}
        {" "}Ask your school administrator to upgrade; it unlocks immediately, with no reinstall.
      </p>
      <Link to="/admin/license">Administrators: open the License page</Link>
    </div>
  );
}
