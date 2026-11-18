"""
Role rules for the boarding module. Mirrors the frontend constants in App.jsx.

  VIEW      ADMIN, PRINCIPAL, SECRETARY, HOSTEL_WARDEN   (read)
  OPERATE   ADMIN, HOSTEL_WARDEN                         (allocate, roll call, exeat desk)
  APPROVE   ADMIN, PRINCIPAL, HOSTEL_WARDEN              (approve / reject exeats)
  ADMIN     ADMIN                                        (create hostels, assign wardens, rollover, settings)
  FINANCE   ADMIN, FINANCE                               (boarding fee rates + billing)

A HOSTEL_WARDEN is scoped to the dormitories assigned to them
(WardenAssignment). A warden with no assignment sees nothing.
"""
from rest_framework.permissions import BasePermission

WARDEN = "HOSTEL_WARDEN"
VIEW_ROLES = {"ADMIN", "PRINCIPAL", "SECRETARY", WARDEN}
OPERATE_ROLES = {"ADMIN", WARDEN}
APPROVE_ROLES = {"ADMIN", "PRINCIPAL", WARDEN}
ADMIN_ROLES = {"ADMIN"}
FINANCE_ROLES = {"ADMIN", "FINANCE"}
FAMILY_ROLES = {"STUDENT", "PARENT"}


def _has_role(request, roles):
    u = request.user
    return bool(
        u and u.is_authenticated and u.is_active
        and getattr(u, "is_active_staff", True)
        and getattr(u, "role", None) in roles
    )


class IsBoardingViewer(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request, VIEW_ROLES)


class IsBoardingOperator(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request, OPERATE_ROLES)


class IsExeatApprover(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request, APPROVE_ROLES)


class IsBoardingAdmin(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request, ADMIN_ROLES)


class IsBoardingFinance(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request, FINANCE_ROLES)


class IsStudentOrParent(BasePermission):
    def has_permission(self, request, view):
        return _has_role(request, FAMILY_ROLES)


def warden_dormitory_ids(user):
    """None = unrestricted. Otherwise the list of dormitory ids the user may work in."""
    if getattr(user, "role", None) != WARDEN:
        return None
    from .models import WardenAssignment

    return list(WardenAssignment.objects.filter(user=user).values_list("dormitory_id", flat=True))


def warden_genders(user):
    """None = unrestricted. Otherwise the set of student genders the user's dormitories house."""
    ids = warden_dormitory_ids(user)
    if ids is None:
        return None
    from .models import Dormitory

    return set(Dormitory.objects.filter(pk__in=ids).values_list("gender", flat=True))