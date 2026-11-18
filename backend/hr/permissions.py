from rest_framework.permissions import BasePermission

HR_ROLES = ("HR", "ADMIN")  # role strings; no import from api needed


class IsHR(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.role in HR_ROLES)
