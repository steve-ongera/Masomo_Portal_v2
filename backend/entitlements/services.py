"""
entitlements/services.py

The ONE place that answers "what may this school use right now?".

    snapshot = plan features  +  active GRANT overrides  -  active REVOKE overrides
               (core features are always on; an inactive licence leaves only core)

The snapshot is cached briefly and wiped by signals whenever a licence, package,
feature or override changes, so an upgrade (token redeemed) opens new features on
the very next request.

Safe-by-default rules (so adding things never breaks anything):
  * no Feature rows registered            -> nothing is gated
  * a path/feature that is not registered -> open
  * ENTITLEMENTS_ENFORCE = False (default) -> "shadow mode": log what WOULD be blocked, block nothing
"""
import logging

from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

CACHE_TTL = 60  # seconds; signals invalidate sooner. With several workers use a shared cache (Redis).
VERSION_KEY = "entitlements:version"


def enforcing():
    return bool(getattr(settings, "ENTITLEMENTS_ENFORCE", False))


# --------------------------------------------------------------------------- cache
def _cache_key():
    return f"entitlements:snapshot:v{cache.get(VERSION_KEY, 1)}"


def invalidate():
    try:
        cache.incr(VERSION_KEY)
    except ValueError:
        cache.set(VERSION_KEY, 2, None)


# --------------------------------------------------------------------------- build
def _cheapest_package(feature):
    packages = [p for p in feature.packages.all() if p.is_active]
    return min(packages, key=lambda p: p.monthly_price) if packages else None


def _build(school):
    from api import models as core
    from api import services as core_services

    from .models import Feature, LicenseFeatureOverride

    features = list(Feature.objects.filter(is_active=True).prefetch_related("packages"))
    if not features:
        return {}  # nothing registered -> nothing gated

    lic = core_services.get_school_license(school)
    package = core.SubscriptionPackage.objects.filter(tier=lic.tier).first()
    core_codes = {f.code for f in features if f.is_core}

    if package is None:
        # Configuration error, not the customer's fault: fail open and shout.
        logger.error("[ENTITLEMENTS] no SubscriptionPackage row for tier %s - allowing everything.", lic.tier)
        entitled = {f.code for f in features}
    else:
        plan_codes = set(package.plan_features.filter(is_active=True).values_list("code", flat=True))
        now = timezone.now()
        grants, revokes = set(), set()
        overrides = (
            LicenseFeatureOverride.objects.filter(license=lic)
            .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
            .select_related("feature")
        )
        for o in overrides:
            (grants if o.mode == LicenseFeatureOverride.Mode.GRANT else revokes).add(o.feature.code)
        entitled = (plan_codes | grants) - revokes
        if not lic.is_active:  # suspended or expired: the lock overlay handles the UX
            entitled = set()
        entitled |= core_codes

    catalog = []
    for f in features:
        cheapest = _cheapest_package(f)
        entry = {
            "code": f.code, "name": f.name, "description": f.description, "kind": f.kind,
            "api": list(f.api_prefixes or []), "ui": list(f.ui_prefixes or []), "roles": list(f.roles or []),
            "enabled": f.code in entitled,
        }
        if cheapest:
            entry["upgrade_to"] = cheapest.get_tier_display()
            entry["upgrade_price"] = float(cheapest.monthly_price)
        catalog.append(entry)

    return {
        "tier": lic.tier,
        "tier_display": lic.get_tier_display(),
        "valid_until": lic.valid_until.isoformat() if lic.valid_until else None,
        "active": lic.is_active,
        "features": sorted(entitled),
        "catalog": catalog,
    }


def get_snapshot():
    """Current entitlements for the school, or None when nothing is gated."""
    from api import models as core

    key = _cache_key()
    snap = cache.get(key)
    if snap is None:
        school = core.School.objects.first()  # single-tenant, same convention as the rest of the code base
        snap = _build(school) if school else {}
        cache.set(key, snap, CACHE_TTL)
    return snap or None


# --------------------------------------------------------------------------- queries
def _matches(path, prefix):
    path, prefix = path.strip("/"), prefix.strip("/")
    return bool(prefix) and (path == prefix or path.startswith(prefix + "/"))


def match_feature(snap, path, key):
    """Longest-prefix match. key is 'api' or 'ui'. Returns the catalog entry or None."""
    best, best_len = None, -1
    for f in snap["catalog"]:
        for prefix in f[key]:
            if _matches(path, prefix) and len(prefix.strip("/")) > best_len:
                best, best_len = f, len(prefix.strip("/"))
    return best


def feature_entry(snap, code):
    return next((f for f in snap["catalog"] if f["code"] == code), None)


def is_enabled(code):
    snap = get_snapshot()
    if not snap:
        return True
    f = feature_entry(snap, code)
    return True if f is None else f["enabled"]


def blocked_portal(snap, user):
    """The portal feature that blocks this user's role, or None if they may log in."""
    if getattr(user, "role", None) == "ADMIN" or getattr(user, "is_superuser", False):
        return None  # admins must always get in, otherwise nobody could upgrade
    portals = [f for f in snap["catalog"] if f["kind"] == "PORTAL" and user.role in f["roles"]]
    if not portals or any(f["enabled"] for f in portals):
        return None
    return portals[0]


def denial_payload(feature, snap):
    if not snap.get("active", True):
        detail = "Your licence is suspended or has expired. Please contact your software provider."
    else:
        detail = f"Your {snap['tier_display']} plan doesn't include {feature['name']}."
        if feature.get("upgrade_to"):
            detail += f" Upgrade to {feature['upgrade_to']} to unlock it."
    payload = {
        "detail": detail,
        "code": "feature_not_in_plan",
        "feature": feature["code"],
        "feature_name": feature["name"],
        "tier": snap["tier"],
    }
    if feature.get("upgrade_to"):
        payload["upgrade_to"] = feature["upgrade_to"]
    return payload
