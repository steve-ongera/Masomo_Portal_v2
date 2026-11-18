"""
Role-based access for the procurement module.

Uses the existing api.User.role values (ADMIN, PROCUREMENT, PRINCIPAL, ...).
ADMIN always passes. Every view declares:
    read_roles    - roles allowed on GET/HEAD/OPTIONS
    write_roles   - roles allowed on POST/PUT/PATCH/DELETE
    action_roles  - optional {action_name: roles} overrides for @action methods
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

MANAGE = {"ADMIN", "PROCUREMENT"}
VIEW_ALL = MANAGE | {"PRINCIPAL", "FINANCE", "SECRETARY"}
REQUESTERS = VIEW_ALL | {"TEACHER", "STAFF", "HR", "LIBRARIAN", "CAFETERIA"}
STORE = MANAGE | {"STAFF"}


class ProcPermission(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser or user.role == "ADMIN":
            return True
        overrides = getattr(view, "action_roles", {})
        action = getattr(view, "action", None)
        if action in overrides:
            return user.role in overrides[action]
        roles = view.read_roles if request.method in SAFE_METHODS else view.write_roles
        return user.role in roles
