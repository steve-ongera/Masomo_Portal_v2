from rest_framework.permissions import SAFE_METHODS, BasePermission

from api import models as api_models


class IsTeacherOrOversight(BasePermission):
    """Teachers: full access to their OWN materials. Admin/Principal: read-only oversight."""

    def has_permission(self, request, view):
        u = request.user
        if not (u and u.is_authenticated):
            return False
        if u.role == api_models.User.Role.TEACHER:
            return True
        if u.role in (api_models.User.Role.ADMIN, api_models.User.Role.PRINCIPAL):
            return request.method in SAFE_METHODS
        return False