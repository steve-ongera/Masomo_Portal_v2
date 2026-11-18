# save as api/management/commands/auto_promote.py (add empty __init__.py in management/ and commands/ if missing)
from django.core.management.base import BaseCommand
from api import services


class Command(BaseCommand):
    help = "Automatically promote/graduate classes of the latest finished academic year (obeys the on/off switch)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--ignore-switch", action="store_true", help="Run even if automatic promotion is off")

    def handle(self, *args, **opts):
        result = services.run_auto_promotion(dry_run=opts["dry_run"], scheduled=not opts["ignore_switch"])
        self.stdout.write(str({k: v for k, v in result.items() if k != "classes"}))