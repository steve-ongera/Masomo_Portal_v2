"""
entitlements/enforcement.py - the four ways the plan is enforced on the backend.

  1. FeatureGateMiddleware      whole modules by URL prefix (zero edits to those apps)
  2. EntitledJWTAuthentication  portals by role, on every authenticated request
  3. require_feature("code")    DRF permission for one view / @action
  4. check_feature("code")      one-liner inside a view for actions in a shared endpoint

Behaviour rules:
  * Fail-open on infrastructure errors (cache / db hiccup never takes the site down).
  * Fail-closed on plan rules once ENTITLEMENTS_ENFORCE is True.
  * Shadow mode (ENTITLEMENTS_ENFORCE = False) only logs; shadow logs are throttled so the
    same "would block" line is printed at most once per minute instead of on every request.

Optional settings:
  ENTITLEMENTS_API_PREFIX   default "/api/v1/"
  ENTITLEMENTS_ALWAYS_OPEN  extra path prefixes (relative to the API prefix) that the
                            middleware never gates, e.g. staff self-service that lives
                            inside a gated app:
                                ENTITLEMENTS_ALWAYS_OPEN = ["hr/my-payslips/"]
"""
import logging
import time

from django.conf import settings
from django.http import JsonResponse
from rest_framework.exceptions import APIException
from rest_framework.permissions import BasePermission
from rest_framework_simplejwt.authentication import JWTAuthentication

from . import services

logger = logging.getLogger(__name__)

# Paths the middleware must never gate: login/token flow, the entitlement and licence
# endpoints themselves (a locked school has to be able to redeem a token to unlock itself).
_ALWAYS_OPEN = ("auth/", "entitlements/", "license/")

# Shadow-mode log throttle: {message: last_logged_epoch}. Per process, which is fine for logs.
_SHADOW_SEEN = {}
_SHADOW_EVERY = 60  # seconds


class FeatureNotInPlan(APIException):
    status_code = 403
    default_code = "feature_not_in_plan"

    def __init__(self, payload):
        super().__init__(detail=payload)


def _shadow_log(message, *args):
    key = message % args
    now = time.monotonic()
    last = _SHADOW_SEEN.get(key)
    if last is not None and now - last < _SHADOW_EVERY:
        return
    if len(_SHADOW_SEEN) > 500:
        _SHADOW_SEEN.clear()
    _SHADOW_SEEN[key] = now
    logger.warning(key)


def _deny(feature, snap, where):
    if services.enforcing():
        raise FeatureNotInPlan(services.denial_payload(feature, snap))
    _shadow_log("[ENTITLEMENTS shadow] would block %s (%s) on tier %s", where, feature["code"], snap["tier"])


def check_feature(code):
    """Raise FeatureNotInPlan (403) if the plan lacks `code`. Unknown codes are open."""
    try:
        snap = services.get_snapshot()
        if not snap:
            return
        f = services.feature_entry(snap, code)
    except Exception:  # noqa: BLE001 - fail-open on infrastructure errors
        logger.exception("[ENTITLEMENTS] feature check failed - allowing")
        return
    if f is None or f["enabled"]:
        return
    _deny(f, snap, where=f"feature:{code}")


def check_portal(user):
    """Refuse a user whose role's portal is not in the plan. ADMIN/core handling lives in services."""
    try:
        snap = services.get_snapshot()
        if not snap:
            return
        f = services.blocked_portal(snap, user)
    except Exception:  # noqa: BLE001 - fail-open on infrastructure errors
        logger.exception("[ENTITLEMENTS] portal check failed - allowing")
        return
    if f:
        _deny(f, snap, where=f"portal:{user.role}")


def require_feature(code):
    """permission_classes = [utils.IsAdminOrFinance, require_feature("expenses")]"""

    class _RequiresFeature(BasePermission):
        def has_permission(self, request, view):
            check_feature(code)
            return True

    _RequiresFeature.__name__ = f"RequiresFeature_{code.replace('.', '_')}"
    return _RequiresFeature


def _always_open(rel_path):
    extra = tuple(getattr(settings, "ENTITLEMENTS_ALWAYS_OPEN", ()) or ())
    return rel_path.startswith(_ALWAYS_OPEN + extra)


class FeatureGateMiddleware:
    """Blocks /api/v1/<owned prefix>/... when the plan lacks the feature. Never takes the site down:
    any internal error is logged and the request is allowed through."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method != "OPTIONS":
            prefix = getattr(settings, "ENTITLEMENTS_API_PREFIX", "/api/v1/")
            if request.path.startswith(prefix):
                rel = request.path[len(prefix):]
                try:
                    if not _always_open(rel):
                        snap = services.get_snapshot()
                        feature = services.match_feature(snap, rel, "api") if snap else None
                        if feature and not feature["enabled"]:
                            if services.enforcing():
                                return JsonResponse(services.denial_payload(feature, snap), status=403)
                            _shadow_log("[ENTITLEMENTS shadow] would block %s (%s) on tier %s",
                                        request.path, feature["code"], snap["tier"])
                except Exception:  # noqa: BLE001
                    logger.exception("[ENTITLEMENTS] gate check failed - allowing request")
        return self.get_response(request)


class EntitledJWTAuthentication(JWTAuthentication):
    """Drop-in for JWTAuthentication: also refuses roles whose portal isn't in the current plan,
    so a downgrade locks them out immediately even if they still hold a valid token."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, _token = result
        check_portal(user)
        return result