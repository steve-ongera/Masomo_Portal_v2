"""
python manage.py seed_hr              # demo data, safe to re-run (never duplicates)
python manage.py seed_hr --payroll    # also generate a DRAFT payroll run for last month

Seeds: departments, positions, leave types + statutory rates (via seed_hr_defaults),
22 employees with salary structures, a few recurring deductions, leave requests,
10 weekdays of staff attendance, and two vacancies with applicants.
DEMO DATA ONLY: do not run on a production school's database.
"""
import random
from datetime import date, time, timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from hr import models as m
from hr import services

DEPARTMENTS = ["Administration", "Academics", "Mathematics", "Languages", "Sciences", "Humanities",
               "Finance", "ICT", "Security", "Transport", "Catering", "Maintenance", "Library", "Health"]

POSITIONS = ["Deputy Principal", "Head of Department", "Teacher", "Accountant", "Accounts Clerk", "Secretary",
             "ICT Officer", "Security Officer", "Driver", "Cook", "Cleaner", "Librarian", "School Nurse"]

# first, last, gender, category, position, department, type, basic, house, transport, contract_end_in_days
EMPLOYEES = [
    ("Grace", "Wanjiru", "F", "ADMINISTRATION", "Deputy Principal", "Administration", "PERMANENT", 95000, 15000, 5000, None),
    ("John", "Kamau", "M", "TEACHER", "Head of Department", "Mathematics", "PERMANENT", 72000, 10000, 4000, None),
    ("Mary", "Achieng", "F", "TEACHER", "Teacher", "Languages", "PERMANENT", 58000, 8000, 3000, None),
    ("Peter", "Otieno", "M", "TEACHER", "Teacher", "Sciences", "PERMANENT", 60000, 8000, 3000, None),
    ("Faith", "Njeri", "F", "TEACHER", "Teacher", "Humanities", "PERMANENT", 55000, 8000, 3000, None),
    ("Samuel", "Mwangi", "M", "TEACHER", "Teacher", "Mathematics", "CONTRACT", 50000, 6000, 3000, 20),
    ("Esther", "Chebet", "F", "TEACHER", "Teacher", "Sciences", "PERMANENT", 61000, 8000, 3000, None),
    ("David", "Omondi", "M", "TEACHER", "Teacher", "Languages", "PROBATION", 48000, 6000, 3000, None),
    ("Lucy", "Wambui", "F", "TEACHER", "Teacher", "Humanities", "PERMANENT", 57000, 8000, 3000, None),
    ("Brian", "Kiptoo", "M", "TEACHER", "Teacher", "Sciences", "CONTRACT", 52000, 6000, 3000, 200),
    ("Agnes", "Mutheu", "F", "TEACHER", "Teacher", "Languages", "PERMANENT", 59000, 8000, 3000, None),
    ("Joseph", "Njoroge", "M", "ACCOUNTS", "Accountant", "Finance", "PERMANENT", 70000, 10000, 4000, None),
    ("Rose", "Atieno", "F", "ACCOUNTS", "Accounts Clerk", "Finance", "CONTRACT", 38000, 5000, 2000, 12),
    ("Hassan", "Ali", "M", "ICT", "ICT Officer", "ICT", "PERMANENT", 62000, 8000, 3000, None),
    ("Caroline", "Muthoni", "F", "ADMINISTRATION", "Secretary", "Administration", "PERMANENT", 45000, 6000, 2500, None),
    ("Daniel", "Barasa", "M", "SUPPORT", "Security Officer", "Security", "PERMANENT", 22000, 3000, 1500, None),
    ("Moses", "Kiprono", "M", "SUPPORT", "Security Officer", "Security", "CASUAL", 18000, 0, 1000, None),
    ("Patrick", "Ouma", "M", "SUPPORT", "Driver", "Transport", "PERMANENT", 30000, 4000, 2000, None),
    ("Beatrice", "Nduta", "F", "SUPPORT", "Cook", "Catering", "PERMANENT", 20000, 3000, 1500, None),
    ("Alice", "Wairimu", "F", "SUPPORT", "Cleaner", "Maintenance", "CASUAL", 15000, 0, 1000, None),
    ("Stephen", "Maina", "M", "SUPPORT", "Librarian", "Library", "PERMANENT", 42000, 5000, 2500, None),
    ("Janet", "Akinyi", "F", "SUPPORT", "School Nurse", "Health", "PERMANENT", 48000, 6000, 2500, None),
]

DEDUCTIONS = {  # employee index -> [(name, amount)]
    1: [("SACCO contribution", 3000)],
    5: [("Salary advance repayment", 4000)],
    11: [("SACCO contribution", 2500), ("Staff loan repayment", 5000)],
    13: [("SACCO contribution", 1500)],
}


def weekdays_back(n):
    d, out = timezone.localdate(), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return out


class Command(BaseCommand):
    help = "Seed demo HR data (22 employees, salaries, leave, attendance, recruitment)."

    def add_arguments(self, parser):
        parser.add_argument("--payroll", action="store_true", help="Also generate a DRAFT payroll run for last month.")

    def handle(self, *args, **opts):
        rng = random.Random(42)  # deterministic demo data
        today = timezone.localdate()

        call_command("seed_hr_defaults")  # leave types + statutory rates

        depts = {n: m.Department.objects.get_or_create(name=n)[0] for n in DEPARTMENTS}
        poss = {n: m.Position.objects.get_or_create(title=n)[0] for n in POSITIONS}

        # ---- employees + salaries + deductions ----
        emps = []
        for i, (fn, ln, g, cat, pos, dept, typ, basic, house, transport, ends) in enumerate(EMPLOYEES):
            emp, _ = m.Employee.objects.get_or_create(
                national_id=str(30000001 + i),
                defaults=dict(
                    first_name=fn, last_name=ln, gender=g, category=cat, department=depts[dept], position=poss[pos],
                    employment_type=typ, phone=f"07120000{i:02d}", email=f"{fn.lower()}.{ln.lower()}@school.test",
                    date_of_birth=date(1975 + rng.randint(0, 22), rng.randint(1, 12), rng.randint(1, 28)),
                    date_joined=today - timedelta(days=rng.randint(60, 2500)),
                    contract_end_date=today + timedelta(days=ends) if ends else None,
                    kra_pin=f"A00{1000000 + i}Z", nssf_no=f"NSSF{200000 + i}", sha_no=f"SHA{500000 + i}",
                    bank_name="Equity Bank", bank_account=f"01000{300000 + i}",
                    emergency_contact="Next of kin, 0722000000",
                ),
            )
            m.SalaryStructure.objects.update_or_create(
                employee=emp, defaults=dict(basic=basic, house_allowance=house, transport_allowance=transport, other_allowance=0))
            for name, amount in DEDUCTIONS.get(i, []):
                m.EmployeeDeduction.objects.get_or_create(employee=emp, name=name, defaults={"amount": amount})
            emps.append(emp)

        # ---- leave requests (only seeded once) ----
        if not m.LeaveRequest.objects.exists():
            annual, sick = m.LeaveType.objects.get(name="Annual Leave"), m.LeaveType.objects.get(name="Sick Leave")
            nxt_mon = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
            pending = [(emps[2], annual, nxt_mon, nxt_mon + timedelta(days=4), "Family trip"),
                       (emps[8], sick, nxt_mon, nxt_mon + timedelta(days=1), "Medical appointment"),
                       (emps[19], annual, nxt_mon + timedelta(days=7), nxt_mon + timedelta(days=11), "Personal")]
            for e, lt, s, en, why in pending:
                m.LeaveRequest.objects.create(employee=e, leave_type=lt, start_date=s, end_date=en, reason=why,
                                              days=len(services.weekdays_between(s, en)))
            past = weekdays_back(6)  # approved leave inside the attendance window
            for e, lt, s, en, why in [(emps[4], sick, past[3], past[2], "Flu"), (emps[14], annual, past[5], past[4], "Errand")]:
                lv = m.LeaveRequest.objects.create(employee=e, leave_type=lt, start_date=min(s, en), end_date=max(s, en),
                                                   reason=why, days=len(services.weekdays_between(min(s, en), max(s, en))))
                services.review_leave(lv, None, True, "Approved (seed)")

        # ---- 10 weekdays of attendance (never overwrites existing rows) ----
        for day in weekdays_back(10):
            for e in emps:
                roll = rng.random()
                if roll < 0.06:
                    row = dict(status="ABSENT")
                elif roll < 0.16:
                    row = dict(status="LATE", check_in=time(8, rng.randint(5, 40)), check_out=time(16, rng.randint(35, 59)))
                else:
                    row = dict(status="PRESENT", check_in=time(7, rng.randint(25, 59)), check_out=time(16, rng.randint(35, 59)))
                m.StaffAttendance.objects.get_or_create(employee=e, date=day, defaults={**row, "source": "MANUAL"})

        # ---- recruitment ----
        v1, _ = m.Vacancy.objects.get_or_create(
            title="Mathematics Teacher", defaults=dict(department=depts["Mathematics"], position=poss["Teacher"], openings=1,
                                                       closing_date=today + timedelta(days=21), description="B.Ed Mathematics, TSC registered."))
        v2, _ = m.Vacancy.objects.get_or_create(
            title="School Cook", defaults=dict(department=depts["Catering"], position=poss["Cook"], openings=2,
                                               closing_date=today + timedelta(days=14), description="Experience in institutional catering."))
        applicants = [
            (v1, "Kevin", "Mutua", "M", "APPLIED"), (v1, "Naomi", "Cherono", "F", "SHORTLISTED"),
            (v1, "Victor", "Oduor", "M", "INTERVIEWED"), (v1, "Sharon", "Wekesa", "F", "SELECTED"),
            (v1, "Ian", "Gitau", "M", "REJECTED"), (v2, "Joyce", "Auma", "F", "APPLIED"),
            (v2, "Mercy", "Wangari", "F", "SHORTLISTED"), (v2, "Tabitha", "Nyambura", "F", "APPLIED"),
        ]
        for n, (v, fn, ln, g, stage) in enumerate(applicants):
            m.Application.objects.get_or_create(
                vacancy=v, first_name=fn, last_name=ln,
                defaults=dict(gender=g, stage=stage, national_id=str(40000001 + n), phone=f"07330000{n:02d}",
                              email=f"{fn.lower()}.{ln.lower()}@mail.test",
                              interview_score=rng.randint(55, 92) if stage in ("INTERVIEWED", "SELECTED") else None))

        # ---- optional draft payroll for last month ----
        if opts["payroll"]:
            first = today.replace(day=1)
            last_month = first - timedelta(days=1)
            try:
                run, n = services.generate_run(last_month.year, last_month.month, None)
                self.stdout.write(f"Draft payroll {last_month:%B %Y}: {n} payslips.")
            except ValueError as e:
                self.stdout.write(self.style.WARNING(f"Payroll skipped: {e}"))

        self.stdout.write(self.style.SUCCESS(
            f"HR seed complete: {m.Employee.objects.count()} employees, {m.LeaveRequest.objects.count()} leave requests, "
            f"{m.StaffAttendance.objects.count()} attendance rows, {m.Vacancy.objects.count()} vacancies."))