from rest_framework.permissions import BasePermission

ROLES_VIEW = ("ADMIN", "PRINCIPAL", "SECRETARY", "FINANCE")   # see aid, request awards
ROLES_SETUP = ("ADMIN", "FINANCE")                             # funders and schemes
ROLES_DECIDE = ("ADMIN", "PRINCIPAL")                          # approve, reject, suspend, reverse
ROLES_MONEY = ("ADMIN", "FINANCE")                             # remittances and allocations


def roles(*allowed):
    class _RolePermission(BasePermission):
        def has_permission(self, request, view):
            u = request.user
            return bool(u and u.is_authenticated and (u.is_superuser or u.role in allowed))

    return _RolePermission


CanView = roles(*ROLES_VIEW)
CanSetup = roles(*ROLES_SETUP)
CanDecide = roles(*ROLES_DECIDE)
CanHandleMoney = roles(*ROLES_MONEY)