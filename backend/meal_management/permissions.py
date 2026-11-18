#meal_management/permissions.py
from rest_framework.permissions import BasePermission

from api.models import User

from .models import CafeteriaAttendant

R = User.Role


def _has_role(request, roles):
    u = request.user
    return bool(u and u.is_authenticated and (u.is_superuser or u.role in roles))


def _is_attendant(request):
    """Optional override: a non-CAFETERIA user explicitly added as an attendant."""
    u = request.user
    return bool(
        u and u.is_authenticated
        and CafeteriaAttendant.objects.filter(user=u, is_active=True).exists()
    )


def _is_cafeteria(request):
    u = request.user
    return bool(
        u and u.is_authenticated and u.role == R.CAFETERIA and u.is_active_staff
    )


class IsMealAdmin(BasePermission):
    """Plans, assigning plans, issuing/blocking cards, attendants."""

    def has_permission(self, request, view):
        return _has_role(request, (R.ADMIN, R.SECRETARY , R.CAFETERIA))


class IsMealOperator(BasePermission):
    """Scan desk: Admin, Secretary, a CAFETERIA user, or an explicitly added attendant."""

    def has_permission(self, request, view):
        return (
            _has_role(request, (R.ADMIN, R.SECRETARY))
            or _is_cafeteria(request)
            or _is_attendant(request)
        )


class IsMealViewer(BasePermission):
    """Dashboards and reports."""

    def has_permission(self, request, view):
        return (
            _has_role(request, (R.ADMIN, R.PRINCIPAL, R.SECRETARY, R.FINANCE))
            or _is_cafeteria(request)
            or _is_attendant(request)
        )


class IsMealFinance(BasePermission):
    """Wallet top-ups. Cafeteria attendants cannot add money."""

    def has_permission(self, request, view):
        return _has_role(request, (R.ADMIN, R.FINANCE, R.SECRETARY, R.CAFETERIA))
    
    
    
