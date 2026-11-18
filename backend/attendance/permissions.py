from rest_framework.permissions import BasePermission

from api import models as api_models


class IsTeacher(BasePermission):
    """Attendance is a teacher feature: class teachers and subject teachers."""

    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.role == api_models.User.Role.TEACHER)
