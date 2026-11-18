from rest_framework.permissions import BasePermission

from api import models as api_models

LIBRARY_STAFF_ROLES = (api_models.User.Role.LIBRARIAN, api_models.User.Role.ADMIN)


class IsLibrarian(BasePermission):
    """Librarian runs the library; Admin can also step in."""

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.role in LIBRARY_STAFF_ROLES)
