// Mirrors procurement/permissions.py so the UI hides what the API would refuse.
export const MANAGE = ["ADMIN", "PROCUREMENT"];
export const VIEW_ALL = [...MANAGE, "PRINCIPAL", "FINANCE", "SECRETARY"];
export const REQUESTERS = [...VIEW_ALL, "TEACHER", "STAFF", "HR", "LIBRARIAN", "CAFETERIA"];
export const STORE = [...MANAGE, "STAFF"];
export const INSPECTORS = [...MANAGE, "PRINCIPAL", "STAFF"];
export const FINANCE_ROLES = ["ADMIN", "FINANCE"];
export const can = (role, list) => list.includes(role);
