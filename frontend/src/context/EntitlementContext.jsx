import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api";

/**
 * Frontend mirror of the backend entitlements. The API is always the authority; this only decides
 * what to SHOW (hide / lock / upsell). Mount it once, around the authenticated shell:
 *   <Route element={<EntitlementProvider><AppLayout /></EntitlementProvider>}>
 *
 * Refreshes: on mount, every 5 min, when the tab regains focus, and whenever the API answers
 * 403 "feature_not_in_plan" (see the interceptor snippet in INTEGRATION.md). After an admin redeems an
 * upgrade token, call refresh() and the menus open without anyone logging out.
 */
const EntitlementContext = createContext(null);
const REFRESH_MS = 5 * 60 * 1000;

const norm = (p) => (p || "").replace(/^\/+|\/+$/g, "");
const matches = (path, prefix) => {
  const a = norm(path), b = norm(prefix);
  return !!b && (a === b || a.startsWith(b + "/"));
};

export function EntitlementProvider({ children }) {
  const [state, setState] = useState({
    loading: true, allOpen: true, tier: null, tierDisplay: "", validUntil: null, gates: [],
  });

  const refresh = useCallback(async () => {
    if (!localStorage.getItem("access_token")) return;
    try {
      const { data } = await api.get("/entitlements/me/");
      setState({
        loading: false,
        allOpen: !!data.all_open,
        tier: data.tier,
        tierDisplay: data.tier_display || "",
        validUntil: data.valid_until || null,
        gates: data.gates || [],
      });
    } catch {
      // If this call fails we show everything; the backend still blocks what the plan excludes.
      setState((s) => ({ ...s, loading: false, allOpen: true }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener("entitlements:blocked", refresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("entitlements:blocked", refresh);
    };
  }, [refresh]);

  const value = useMemo(() => {
    const gateFor = (path) => {
      let best = null, bestLen = -1;
      for (const g of state.gates)
        for (const prefix of g.ui || [])
          if (matches(path, prefix) && norm(prefix).length > bestLen) { best = g; bestLen = norm(prefix).length; }
      return best;
    };
    return {
      ...state,
      refresh,
      gateFor,
      // false only when the plan excludes the page that owns this path
      canAccessPath: (path) => state.allOpen || !(gateFor(path) && !gateFor(path).enabled),
      isEnabled: (code) => {
        if (state.allOpen) return true;
        const g = state.gates.find((x) => x.code === code);
        return g ? g.enabled : true;
      },
    };
  }, [state, refresh]);

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlements() {
  const ctx = useContext(EntitlementContext);
  if (!ctx) throw new Error("useEntitlements must be used inside <EntitlementProvider>");
  return ctx;
}

/** const canUseLibrary = useFeature("library"); */
export function useFeature(code) {
  return useEntitlements().isEnabled(code);
}
