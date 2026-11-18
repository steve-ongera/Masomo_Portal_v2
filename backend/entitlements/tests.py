import datetime

from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from api.models import License, School, SubscriptionPackage, User
from entitlements import services
from entitlements.enforcement import FeatureNotInPlan, check_portal
from entitlements.models import Feature, LicenseFeatureOverride


def blocked(resp):
    return resp.status_code == 403 and b"feature_not_in_plan" in resp.content


@override_settings(ENTITLEMENTS_ENFORCE=True)
class EntitlementTests(TestCase):
    def setUp(self):
        cache.clear()
        self.school = School.objects.create(name="Test School")
        self.go = SubscriptionPackage.objects.create(tier="GO", monthly_price=2000)
        self.premium = SubscriptionPackage.objects.create(tier="PREMIUM", monthly_price=7500)
        self.lic = License.objects.create(school=self.school, tier="GO")

        self.library = Feature.objects.create(code="library", name="Library", kind="MODULE", api_prefixes=["library/"])
        self.library.packages.add(self.premium)
        self.portal = Feature.objects.create(code="portal.librarian", name="Librarian portal", kind="PORTAL", roles=["LIBRARIAN"])
        self.portal.packages.add(self.premium)
        self.client = Client()

    def test_module_blocked_on_lower_plan(self):
        self.assertTrue(blocked(self.client.get("/api/v1/library/books/")))

    def test_upgrade_opens_the_module_immediately(self):
        self.assertTrue(blocked(self.client.get("/api/v1/library/books/")))
        self.lic.tier = "PREMIUM"
        self.lic.save()  # what redeeming a token does; the signal clears the cache
        self.assertFalse(blocked(self.client.get("/api/v1/library/books/")))

    def test_downgrade_closes_it_again(self):
        self.lic.tier = "PREMIUM"; self.lic.save()
        self.assertFalse(blocked(self.client.get("/api/v1/library/books/")))
        self.lic.tier = "GO"; self.lic.save()
        self.assertTrue(blocked(self.client.get("/api/v1/library/books/")))

    def test_grant_override_and_expiry(self):
        o = LicenseFeatureOverride.objects.create(license=self.lic, feature=self.library, mode="GRANT")
        self.assertFalse(blocked(self.client.get("/api/v1/library/books/")))
        o.expires_at = timezone.now() - datetime.timedelta(days=1)
        o.save()
        self.assertTrue(blocked(self.client.get("/api/v1/library/books/")))

    def test_unregistered_paths_stay_open(self):
        self.assertFalse(blocked(self.client.get("/api/v1/some-new-thing/")))

    @override_settings(ENTITLEMENTS_ENFORCE=False)
    def test_shadow_mode_blocks_nothing(self):
        self.assertFalse(blocked(self.client.get("/api/v1/library/books/")))

    def test_portal_gated_by_role_but_admin_always_allowed(self):
        librarian = User.objects.create_user(username="lib", password="x", role="LIBRARIAN")
        admin = User.objects.create_user(username="adm", password="x", role="ADMIN")
        with self.assertRaises(FeatureNotInPlan):
            check_portal(librarian)
        check_portal(admin)  # must not raise
        self.lic.tier = "PREMIUM"; self.lic.save()
        check_portal(librarian)

    def test_suspended_licence_locks_everything_but_core(self):
        self.lic.tier = "PREMIUM"; self.lic.is_suspended = True; self.lic.save()
        self.assertTrue(blocked(self.client.get("/api/v1/library/books/")))
