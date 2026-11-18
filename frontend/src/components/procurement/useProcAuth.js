// Thin wrapper over your AuthContext (which exports the context itself, not a hook).
// Gives the procurement pages `const { user } = useAuth()` without touching AuthContext.jsx.
import { useContext } from "react";
import { AuthContext } from "../../context/AuthContext";

export const useAuth = () => useContext(AuthContext) || {};