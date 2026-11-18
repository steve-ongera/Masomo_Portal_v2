from datetime import date
from django.core.management.base import BaseCommand
from hr import models as m


class Command(BaseCommand):
    help = "Seed leave types and STARTING statutory rates. VERIFY the rates against current KRA/NSSF/SHA notices."

    def handle(self, *a, **o):
        for n, d, paid in [("Annual Leave", 21, True), ("Sick Leave", 14, True), ("Maternity Leave", 90, True),
                           ("Paternity Leave", 14, True), ("Compassionate Leave", 5, True), ("Study Leave", 10, True), ("Unpaid Leave", 30, False)]:
            m.LeaveType.objects.get_or_create(name=n, defaults={"days_per_year": d, "is_paid": paid})
        rates = {
            "PAYE": {"bands": [[24000, 0.10], [8333, 0.25], [467667, 0.30], [300000, 0.325], [None, 0.35]], "personal_relief": 2400},
            "NSSF": {"rate": 0.06, "upper_limit": 108000},
            "SHIF": {"rate": 0.0275, "minimum": 300},
            "HOUSING_LEVY": {"rate": 0.015},
        }
        for code, cfg in rates.items():
            m.StatutoryRate.objects.get_or_create(code=code, effective_from=date(2026, 2, 1), defaults={"config": cfg})
        self.stdout.write(self.style.WARNING("Seeded. Check statutory rates before running real payroll."))
