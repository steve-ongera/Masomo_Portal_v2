from django.core.management.base import BaseCommand
from django.utils import timezone

from idcards import services


class Command(BaseCommand):
    help = "Emails guardians of students who were not scanned in today. Schedule it for ~09:30 on school days."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Run even on a weekend.")

    def handle(self, *args, **opts):
        today = timezone.localdate()
        if today.weekday() >= 5 and not opts["force"]:
            self.stdout.write("Weekend - skipped.")
            return
        self.stdout.write(str(services.notify_absentees(today)))