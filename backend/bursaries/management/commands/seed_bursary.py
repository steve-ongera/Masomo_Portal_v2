"""
python manage.py seed_bursary [--activate]

Creates the usual starting set of funders and schemes for a Kenyan school.
Safe to run more than once: anything that already exists (matched by scheme
code / funder name) is left exactly as it is, so your edits are never
overwritten.

Seeded schemes are switched OFF unless you pass --activate, because the
percentages and amounts below are only sensible defaults. Review them on the
Funders & Schemes page (or in Django admin) before turning them on.
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from bursaries import models

S = models.FundingSource.SourceType
K = models.AidScheme.Kind
R = models.AidScheme.Rule
ST = models.AidScheme.Settlement
V = models.ValueType

FUNDERS = [
    {"name": "NG-CDF Bursary Fund", "source_type": S.CDF,
     "notes": "Constituency Development Fund bursary. Add your constituency under Location."},
    {"name": "County Government Bursary", "source_type": S.COUNTY,
     "notes": "County education bursary. Add your county under Location."},
    {"name": "Sponsors & Well-wishers", "source_type": S.SPONSOR,
     "notes": "Individual, corporate, church or foundation sponsors. Add one funder per sponsor if you need separate receivables."},
]

# funder = name from FUNDERS above, or None for school-funded
SCHEMES = [
    {"code": "SIBLING", "name": "Sibling discount", "kind": K.DISCOUNT, "rule": R.SIBLING,
     "funder": None, "settlement": ST.WAIVER, "value_type": V.PERCENT, "value": Decimal("0"),
     "sibling_tiers": [{"rank": 2, "percent": 5}, {"rank": 3, "percent": 10}],
     "priority": 20, "stackable": True,
     "description": "Eldest child pays in full. Second child 5%, third and later 10%. Adjust the tiers to your policy."},
    {"code": "STAFFCHILD", "name": "Staff-child discount", "kind": K.DISCOUNT, "rule": R.STAFF_CHILD,
     "funder": None, "settlement": ST.WAIVER, "value_type": V.PERCENT, "value": Decimal("25"),
     "priority": 10, "stackable": False,
     "description": "Children of school employees. Not combined with other aid: only the largest award applies."},
    {"code": "SCHOOLSCHOL", "name": "School scholarship", "kind": K.SCHOLARSHIP, "rule": R.MANUAL,
     "funder": None, "settlement": ST.WAIVER, "value_type": V.PERCENT, "value": Decimal("100"),
     "priority": 5, "stackable": False,
     "description": "Scholarship funded by the school (e.g. academic or sports). Set a different percent on each award if needed."},
    {"code": "CDF", "name": "NG-CDF bursary", "kind": K.BURSARY, "rule": R.MANUAL,
     "funder": "NG-CDF Bursary Fund", "settlement": ST.FUNDER_REMITS, "value_type": V.FIXED, "value": Decimal("0"),
     "priority": 50, "stackable": True,
     "description": "Amount differs per student, so enter the awarded amount on each award (from the award letter)."},
    {"code": "COUNTY", "name": "County bursary", "kind": K.BURSARY, "rule": R.MANUAL,
     "funder": "County Government Bursary", "settlement": ST.FUNDER_REMITS, "value_type": V.FIXED, "value": Decimal("0"),
     "priority": 50, "stackable": True,
     "description": "Amount differs per student, so enter the awarded amount on each award (from the award letter)."},
    {"code": "SPONSOR", "name": "Sponsor-funded scholarship", "kind": K.SCHOLARSHIP, "rule": R.MANUAL,
     "funder": "Sponsors & Well-wishers", "settlement": ST.FUNDER_REMITS, "value_type": V.PERCENT, "value": Decimal("100"),
     "priority": 40, "stackable": False,
     "description": "A sponsor pays the school for the student. Change the percent per award for partial sponsorship."},
]


class Command(BaseCommand):
    help = "Create the default funders and bursary / discount schemes (existing ones are left untouched)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--activate", action="store_true",
            help="Switch the newly created schemes ON (default: they are created switched off).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        activate = options["activate"]
        models.AidSettings.load()  # makes sure the single settings row exists

        funders = {}
        for f in FUNDERS:
            obj, created = models.FundingSource.objects.get_or_create(
                name=f["name"], defaults={"source_type": f["source_type"], "notes": f["notes"]},
            )
            funders[f["name"]] = obj
            self.stdout.write(f"  funder  {'created' if created else 'exists '}  {obj.name}")

        made = 0
        for s in SCHEMES:
            data = {k: v for k, v in s.items() if k not in ("code", "funder")}
            data["source"] = funders[s["funder"]] if s["funder"] else None
            data["is_active"] = activate
            obj, created = models.AidScheme.objects.get_or_create(code=s["code"], defaults=data)
            made += created
            state = "ON " if obj.is_active else "off"
            self.stdout.write(f"  scheme  {'created' if created else 'exists '}  [{state}] {obj.code:<11} {obj.name}")

        if made and not activate:
            self.stdout.write(self.style.WARNING(
                "\nNew schemes are switched OFF. Review the values, then switch them on under "
                "Funders & Schemes (or re-run with --activate on a fresh database)."
            ))
        self.stdout.write(self.style.SUCCESS(f"\nDone: {made} scheme(s) created."))