from rest_framework.permissions import SAFE_METHODS, BasePermission

TEACHER = "TEACHER"
# Who can approve schemes / lesson plans. There is no HOD role in api.User.Role,
# so Principal and Admin act as reviewers. Add a role here if you introduce one.
REVIEWER_ROLES = ("ADMIN", "PRINCIPAL")


def _role(request):
    user = request.user
    return getattr(user, "role", None) if user and user.is_authenticated else None


class IsTeacher(BasePermission):
    def has_permission(self, request, view):
        return _role(request) == TEACHER


class IsReviewer(BasePermission):
    def has_permission(self, request, view):
        return _role(request) in REVIEWER_ROLES


class IsTeacherOrReviewer(BasePermission):
    def has_permission(self, request, view):
        return _role(request) in (TEACHER, *REVIEWER_ROLES)


class TopicPermission(BasePermission):
    """
    Teachers and reviewers can read and add curriculum topics; only
    reviewers can edit or delete them.
    """

    def has_permission(self, request, view):
        role = _role(request)
        if role not in (TEACHER, *REVIEWER_ROLES):
            return False
        if request.method in SAFE_METHODS or request.method == "POST":
            return True
        return role in REVIEWER_ROLES