from django.core.management.base import BaseCommand

from api.models import SubscriptionPackage
from entitlements import services
from entitlements.catalog import CATALOG, TIERS
from entitlements.models import Feature


class Command(BaseCommand):
    help = (
        "Upsert the feature catalog. Wiring (name, prefixes, roles) is refreshed from catalog.py; "
        "plan membership is only set when a feature is first created, so edits made in Django Admin survive."
    )

    def add_arguments(self, parser):
        parser.add_argument("--reset-plans", action="store_true",
                            help="Also re-apply the default plan membership from catalog.py to existing features.")

    def handle(self, *args, **opts):
        packages = {p.tier: p for p in SubscriptionPackage.objects.all()}
        missing = [t for t in TIERS if t not in packages]
        if missing:
            self.stdout.write(self.style.WARNING(
                f"No SubscriptionPackage row for: {', '.join(missing)} - run seed_data first or add them in Admin."))

        created_n = updated_n = 0
        for order, entry in enumerate(CATALOG, start=1):
            wiring = dict(
                name=entry["name"], description=entry.get("description", ""), kind=entry["kind"],
                api_prefixes=entry.get("api", []), ui_prefixes=entry.get("ui", []),
                roles=entry.get("roles", []), is_core=entry.get("is_core", False), display_order=order * 10,
            )
            feature, created = Feature.objects.get_or_create(code=entry["code"], defaults=wiring)
            if created:
                created_n += 1
            else:
                for field, value in wiring.items():
                    setattr(feature, field, value)
                feature.save()
                updated_n += 1
            if created or opts["reset_plans"]:
                feature.packages.set([packages[t] for t in entry["tiers"] if t in packages])

        services.invalidate()
        self.stdout.write(self.style.SUCCESS(f"Features: {created_n} created, {updated_n} refreshed."))
