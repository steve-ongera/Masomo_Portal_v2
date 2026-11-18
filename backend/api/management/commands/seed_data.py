"""
Seed a Kenyan all-through school (Baby Class / PP1 -> Grade 12, CBC) with:

  - school, admin, streams, license, packages, expense categories
  - the full CBC grade ladder, linked with next_grade
  - subjects per stage, senior-school pathways + selection rule (Grade 10-12)
  - exam types and the 8-level CBC grading scale
  - the CURRENT 2026 academic year / terms (Term 3 is current)
  - 2026 classrooms:  Baby Class / PP1 / PP2  -> ONE stream ("Main")
                      Grade 1 ... Grade 12    -> TWO streams (Red, Blue)
  - the Term 3 2026 FEE STRUCTURE for every class
  - SAMPLE STUDENTS for every classroom, each with ONE Term 3 2026 invoice
    (brought-forward balance + Term 3 fee) and 0-2 sample payments.

FLUSH FIRST
  By default this command WIPES THE WHOLE DATABASE (django `flush`) and then
  seeds afresh. Migrations/tables are kept; all rows are deleted.
      python manage.py seed_data              # asks you to type 'yes', then flush + seed
      python manage.py seed_data --yes        # flush + seed, no prompt
      python manage.py seed_data --no-flush   # seed only (idempotent re-run)

MONEY MODEL (identical to the Junda seeder, used everywhere in the system):
  - Each student has exactly ONE invoice (2026 Term 3).
  - invoice.brought_forward = previous-term balance (negative = credit).
  - invoice.amount_due      = brought_forward + Term 3 fee.
  - Each sample payment is a real Payment row (reference SEED-<adm>-<n>,
    its own receipt no). invoice.amount_paid is ALWAYS re-derived as the SUM
    of that invoice's Payment rows, so receipts, revenue reports and balances
    can never disagree - and re-running never wipes payments Finance recorded
    after seeding.

SAMPLE DATA
  Student names, balances and payments are GENERATED with a fixed random seed
  (SAMPLE_SEED), so every run produces exactly the same learners. They are
  SAMPLE data - real learners should be admitted through the admission screen.
  Tune STUDENTS_PER_CLASS below (set to 0 to seed no students).

*** BEFORE YOU RUN: EDIT THESE ***
  1. SCHOOL        - real name (get_or_create is by name).
  2. TERM3_2026_FEE - amounts are PLACEHOLDERS, not real fees.
  3. CALENDAR_2026  - confirm the real term dates.

Save as  <app>/management/commands/seed_data.py
"""
import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.apps import apps
from django.contrib.auth.hashers import make_password
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from api import services
from api.models import (
    AcademicYear,
    ClassRoom,
    CurriculumType,
    Enrollment,
    ExamType,
    ExpenseCategory,
    FeeStructure,
    FeeStructureItem,
    GradeLevel,
    GradeSubject,
    GradingScale,
    Invoice,
    License,
    LicenseAuditLog,
    PLAN_DEFAULTS,
    Pathway,
    Payment,
    PlanTier,
    School,
    Stream,
    StudentProfile,
    Subject,
    SubjectSelectionRule,
    SubscriptionPackage,
    Term,
    User,
)

DEFAULT_PASSWORD = "password123"
CBC = CurriculumType.CBC

# ---------------------------------------------------------------------------
# Sample-student settings
# ---------------------------------------------------------------------------
STUDENTS_PER_CLASS = 8     # per classroom (27 classrooms -> 216 students). 0 = none.
SAMPLE_SEED = 2026         # fixed so re-runs generate the same learners
REPORT_DATE = date(2026, 9, 22)   # sample payments are dated up to this day

# ---------------------------------------------------------------------------
# 1. School identity
# ---------------------------------------------------------------------------
SCHOOL = {
    "name": "Nyali School",          # TODO: your real school name (set BEFORE first run)
    "school_type": School.SchoolType.MIXED,
    "knec_code": "",                 # TODO: real KNEC centre code
    "county": "Mombasa",
    "address": "",                   # TODO: real postal address
}

ADMINS = [
    ("admin1", "Admin", "One", True),
]

# ---------------------------------------------------------------------------
# 2. Grade ladder + streams
# ---------------------------------------------------------------------------
STREAM_RED, STREAM_BLUE, STREAM_SINGLE = "Red", "Blue", "Main"
TWO = [STREAM_RED, STREAM_BLUE]
ONE = [STREAM_SINGLE]

# (name, education_level, level_order, streams)
LADDER = (
    [("Baby Class", "PRE", 1, ONE), ("PP1", "PRE", 2, ONE), ("PP2", "PRE", 3, ONE)]
    + [(f"Grade {n}", "LOWER_PRI", 10 + n, TWO) for n in (1, 2, 3)]
    + [(f"Grade {n}", "UPPER_PRI", 10 + n, TWO) for n in (4, 5, 6)]
    + [(f"Grade {n}", "JSS", 10 + n, TWO) for n in (7, 8, 9)]
    + [(f"Grade {n}", "SSS", 10 + n, TWO) for n in (10, 11, 12)]
)

PRE = ["Baby Class", "PP1", "PP2"]
LOWER = ["Grade 1", "Grade 2", "Grade 3"]
UPPER = ["Grade 4", "Grade 5", "Grade 6"]
JUNIOR = ["Grade 7", "Grade 8", "Grade 9"]
SENIOR = ["Grade 10", "Grade 11", "Grade 12"]

# ---------------------------------------------------------------------------
# 3. CBC senior-school pathways
# ---------------------------------------------------------------------------
PATHWAYS = [
    ("STEM", "STEM", "Science, Technology, Engineering and Mathematics"),
    ("SOCIAL", "Social Sciences", "Languages, humanities and business"),
    ("ARTS_SPORTS", "Arts & Sports Science", "Performing and visual arts, sports and recreation"),
]

# ---------------------------------------------------------------------------
# 4. Subjects: (code, name, grades offered at, compulsory?, pathway code)
#    VERIFY against the current KICD curriculum designs before go-live.
# ---------------------------------------------------------------------------
SUBJECTS = [
    ("LANGACT", "Language Activities", PRE, True, None),
    ("MATACT", "Mathematical Activities", PRE + LOWER, True, None),
    ("ENVACT", "Environmental Activities", PRE + LOWER, True, None),
    ("CREACT", "Creative Activities", PRE + LOWER, True, None),
    ("RELACT", "Religious Education Activities", PRE + LOWER, True, None),
    ("ENGACT", "English Language Activities", LOWER, True, None),
    ("KISACT", "Kiswahili Language Activities", LOWER, True, None),
    ("SCITECH", "Science and Technology", UPPER, True, None),
    ("AGRNUT", "Agriculture and Nutrition", UPPER, True, None),
    ("CREART", "Creative Arts", UPPER, True, None),
    ("PHE", "Physical and Health Education", UPPER, True, None),
    ("ENG", "English", UPPER + JUNIOR + SENIOR, True, None),
    ("KIS", "Kiswahili", UPPER + JUNIOR + SENIOR, True, None),
    ("MAT", "Mathematics", UPPER + JUNIOR, True, None),
    ("SST", "Social Studies", UPPER + JUNIOR, True, None),
    ("RE", "Religious Education", UPPER + JUNIOR, True, None),
    ("INTSCI", "Integrated Science", JUNIOR, True, None),
    ("PRETECH", "Pre-Technical Studies", JUNIOR, True, None),
    ("AGRJS", "Agriculture", JUNIOR, True, None),
    ("CASPORT", "Creative Arts and Sports", JUNIOR, True, None),
    ("CSL", "Community Service Learning", SENIOR, True, None),
    ("PE", "Physical Education", SENIOR, True, None),
    ("ESSMATH", "Essential Mathematics", SENIOR, False, None),
    ("ADVMATH", "Advanced Mathematics", SENIOR, False, "STEM"),
    ("PHY", "Physics", SENIOR, False, "STEM"),
    ("CHE", "Chemistry", SENIOR, False, "STEM"),
    ("BIO", "Biology", SENIOR, False, "STEM"),
    ("GENSCI", "General Science", SENIOR, False, "STEM"),
    ("COMSCI", "Computer Science", SENIOR, False, "STEM"),
    ("AGRSS", "Agriculture (Senior)", SENIOR, False, "STEM"),
    ("HSCI", "Home Science", SENIOR, False, "STEM"),
    ("GEO", "Geography", SENIOR, False, "SOCIAL"),
    ("HISCIT", "History and Citizenship", SENIOR, False, "SOCIAL"),
    ("CRE", "Christian Religious Education", SENIOR, False, "SOCIAL"),
    ("IRE", "Islamic Religious Education", SENIOR, False, "SOCIAL"),
    ("BST", "Business Studies", SENIOR, False, "SOCIAL"),
    ("LITENG", "Literature in English", SENIOR, False, "SOCIAL"),
    ("FASIHI", "Fasihi ya Kiswahili", SENIOR, False, "SOCIAL"),
    ("FRE", "French", SENIOR, False, "SOCIAL"),
    ("ARA", "Arabic", SENIOR, False, "SOCIAL"),
    ("MUSDAN", "Music and Dance", SENIOR, False, "ARTS_SPORTS"),
    ("FINEART", "Fine Arts", SENIOR, False, "ARTS_SPORTS"),
    ("THEFILM", "Theatre and Film", SENIOR, False, "ARTS_SPORTS"),
    ("SPOREC", "Sports and Recreation", SENIOR, False, "ARTS_SPORTS"),
]

# Grade 10-12: 4 core + exactly 3 pathway electives = 7 subjects.
SENIOR_SELECTION_RULE = {
    "requires_pathway": True,
    "min_optional_subjects": 3,
    "max_optional_subjects": 3,
    "min_total_subjects": 7,
    "max_total_subjects": 7,
}

# ---------------------------------------------------------------------------
# 5. Exams + grading
# ---------------------------------------------------------------------------
EXAM_TYPES = [
    ("Midterm Exam", Decimal("0.30"), 1, True, True),
    ("End-term Exam", Decimal("0.70"), 2, False, True),
]

# 8-level CBC scale: (letter, min %, max %, points, remark). Used for Grade 4-12.
CBC_GRADING = [
    ("EE1", "90", "100", "8", "Exceeding Expectations"),
    ("EE2", "75", "89.99", "7", "Exceeding Expectations"),
    ("ME1", "58", "74.99", "6", "Meeting Expectations"),
    ("ME2", "41", "57.99", "5", "Meeting Expectations"),
    ("AE1", "31", "40.99", "4", "Approaching Expectations"),
    ("AE2", "21", "30.99", "3", "Approaching Expectations"),
    ("BE1", "11", "20.99", "2", "Below Expectations"),
    ("BE2", "0", "10.99", "1", "Below Expectations"),
]

# ---------------------------------------------------------------------------
# 6. Licence, packages, expense categories
# ---------------------------------------------------------------------------
LICENSE_TIER = PlanTier.STANDARD

PACKAGES = {
    PlanTier.TRIAL: (Decimal("0"), 1, ["Full feature access during the trial", "Email support"]),
    PlanTier.GO: (Decimal("2000"), 2, [
        "Student, teacher & class management", "Exams, results & report forms",
        "Fees & invoicing", "Email support",
    ]),
    PlanTier.STANDARD: (Decimal("6000"), 3, [
        "Everything in Go", "SMS & email notifications",
        "Timetable generator", "M-Pesa STK push fee collection",
    ]),
    PlanTier.PREMIUM: (Decimal("15000"), 4, [
        "Everything in Standard", "Expense tracking & finance reports",
        "Student clearance workflow", "Priority support",
    ]),
    PlanTier.PRO: (Decimal("50000"), 5, [
        "Everything in Premium", "Unlimited students, classes & teachers",
        "Dedicated account manager", "24/7 priority support",
    ]),
}

EXPENSE_CATEGORIES = [
    ("Stationery & Office Supplies", "STATIONERY"),
    ("Electricity", "ELECTRICITY"),
    ("Water", "WATER"),
    ("Internet & Airtime", "INTERNET"),
    ("Repairs & Maintenance", "REPAIRS"),
    ("Fuel & Transport", "TRANSPORT"),
    ("Food & Catering", "FOOD"),
    ("Cleaning & Sanitation", "CLEANING"),
    ("Laboratory Supplies", "LAB"),
    ("Sports & Games Equipment", "SPORTS"),
    ("Medical & First Aid", "MEDICAL"),
    ("Security", "SECURITY"),
    ("Printing & Exams", "PRINTING"),
    ("Miscellaneous", "MISC"),
]

# ---------------------------------------------------------------------------
# 7. Calendar - ONLY the current year. (year, term, start, end, is_current)
# ---------------------------------------------------------------------------
CALENDAR_2026 = [
    (2026, 1, date(2026, 1, 5), date(2026, 4, 3), False),
    (2026, 2, date(2026, 4, 27), date(2026, 7, 31), False),
    (2026, 3, date(2026, 8, 24), date(2026, 11, 27), True),
]
TERM3_START = date(2026, 8, 24)


# ---------------------------------------------------------------------------
# 8. Term 3 2026 fee structure - !!! PLACEHOLDER AMOUNTS !!!
# ---------------------------------------------------------------------------
def _fee(amount):
    return [("Tuition", Decimal(str(amount)))]


TERM3_2026_FEE = {
    "Baby Class": _fee(8000),
    "PP1": _fee(8500),
    "PP2": _fee(8500),
    "Grade 1": _fee(9500),
    "Grade 2": _fee(9500),
    "Grade 3": _fee(9500),
    "Grade 4": _fee(10500),
    "Grade 5": _fee(10500),
    "Grade 6": _fee(10500),
    "Grade 7": _fee(11500),
    "Grade 8": _fee(11500),
    "Grade 9": _fee(11500),
    "Grade 10": _fee(12500),
    "Grade 11": _fee(12500),
    "Grade 12": _fee(12500),
}

# ---------------------------------------------------------------------------
# 9. Sample-name pools
# ---------------------------------------------------------------------------
MALE_NAMES = [
    "Brian", "Kevin", "Dennis", "Collins", "Victor", "Ian", "Allan", "Eric", "Felix", "Hassan",
    "Juma", "Omar", "Ali", "Salim", "Mohammed", "Abdalla", "Said", "Hamisi", "Kazungu", "Karisa",
    "Baraka", "Mwanzia", "Peter", "Samuel", "Joseph", "David", "Daniel", "Joshua", "Elvis", "Ryan",
    "Ezekiel", "Gideon", "Newton", "Tobias", "Wycliffe", "Austin", "Cyrus", "Dickson", "Ephraim", "Faraj",
]
FEMALE_NAMES = [
    "Faith", "Grace", "Mercy", "Joy", "Esther", "Naomi", "Lucy", "Zawadi", "Amina", "Fatuma",
    "Mariam", "Halima", "Zainab", "Khadija", "Asha", "Rehema", "Neema", "Purity", "Sharon", "Cynthia",
    "Brenda", "Winnie", "Diana", "Stella", "Linet", "Joyce", "Ruth", "Mwanaisha", "Salma", "Wanjiru",
    "Njeri", "Achieng", "Atieno", "Chao", "Mwanasha", "Nasra", "Hawa", "Maryam", "Tabitha", "Valerie",
]
MIDDLE_NAMES = [
    "Mwanzia", "Kahindi", "Katana", "Mwaro", "Kazungu", "Tsuma", "Baya", "Chome", "Mwakio", "Ndegwa",
    "Wafula", "Otieno", "Kamau", "Mutua", "Karanja", "Juma", "Hamisi", "Ngala", "Mramba", "Jefwa",
]
SURNAMES = [
    "Omondi", "Mwangi", "Njoroge", "Kimani", "Wekesa", "Ochieng", "Kiptoo", "Mutiso", "Barasa", "Karisa",
    "Mwadzaya", "Chengo", "Gona", "Ngumbao", "Nyale", "Kithi", "Mbogo", "Said", "Bakari", "Abdalla",
    "Mohamed", "Ali", "Hassan", "Chivatsi", "Mweni", "Safari", "Zuma", "Kenga", "Mumba", "Wanjala",
]


# ---------------------------------------------------------------------------
# 10. Field-name candidates. The seeder looks these up on your models, so it
#     works whatever you called them. If one isn't found it warns at startup
#     (BEFORE the flush); add your real field name to the list.
# ---------------------------------------------------------------------------
USER_FIELD_CANDIDATES = {
    "email": ["email"],
    "phone": ["phone_number", "phone", "mobile", "mobile_number", "phone_no"],
    "national_id": ["national_id", "national_id_no", "national_id_number", "id_number",
                    "id_no", "birth_cert_no", "birth_certificate_no", "national_id_or_birth_no"],
}
PROFILE_FIELD_CANDIDATES = {
    "date_of_birth": ["date_of_birth", "dob", "birth_date"],
    "upi": ["upi_no", "upi", "upi_number", "nemis_no", "nemis_number", "nemis_upi", "upi_nemis_no"],
}
GUARDIAN_FK_CANDIDATES = ["parent", "guardian", "parent_user", "guardian_user", "parent_guardian"]
RELATIONSHIPS = ["Mother", "Father", "Guardian"]


def _round500(value):
    return (int(value) // 500) * 500


def _build_students():
    """
    Deterministic sample roster. Each row carries everything the seeder needs:
    identity, classroom, brought-forward balance and the planned payments.
    """
    if STUDENTS_PER_CLASS <= 0:
        return []

    rng = random.Random(SAMPLE_SEED)
    # Separate stream for identity data so money figures never change.
    idrng = random.Random(SAMPLE_SEED + 1)
    used = {"phone": set(), "nid": set(), "upi": set()}
    guardian_seq = [0]

    def unique(kind, make):
        while True:
            value = make()
            if value not in used[kind]:
                used[kind].add(value)
                return value

    def make_phone():
        return f"07{idrng.randint(0, 99999999):08d}"

    methods = [Payment.Method.MPESA] * 7
    for name in ("CASH", "BANK"):
        m = getattr(Payment.Method, name, None)
        if m is not None:
            methods.append(m)

    seq_by_prefix = {}
    used_names = set()
    rows = []
    term_days = (REPORT_DATE - TERM3_START).days

    for idx, (grade, _edu, _order, streams) in enumerate(LADDER):
        fee = int(sum(a for _, a in TERM3_2026_FEE[grade]))
        entry_year = 2026 - idx                    # placeholder admission year per grade
        prefix = f"{entry_year % 100:02d}"
        admitted = date(entry_year, 1, 15)
        half_fee = max(fee // 2 // 500, 1)

        for stream in streams:
            for _ in range(STUDENTS_PER_CLASS):
                gender = rng.choice("MF")
                while True:
                    first = rng.choice(MALE_NAMES if gender == "M" else FEMALE_NAMES)
                    last = f"{rng.choice(MIDDLE_NAMES)} {rng.choice(SURNAMES)}"
                    if (first, last) not in used_names:
                        used_names.add((first, last))
                        break

                seq_by_prefix[prefix] = seq_by_prefix.get(prefix, 0) + 1
                admission_no = f"{prefix}{seq_by_prefix[prefix]:03d}"

                # --- brought-forward balance from Term 2 ---
                roll = rng.random()
                if roll < 0.30:
                    bf = 0
                elif roll < 0.60:
                    bf = 500 * rng.randint(1, half_fee)
                elif roll < 0.85:
                    bf = 500 * rng.randint(half_fee, half_fee * 3)
                elif roll < 0.95:
                    bf = -500 * rng.randint(1, 6)          # small credit
                else:
                    bf = 500 * rng.randint(half_fee * 3, half_fee * 6)
                due = bf + fee

                # --- total paid so far this term ---
                pr = rng.random()
                if due <= 0:
                    total = 0
                elif pr < 0.25:
                    total = due                              # cleared
                elif pr < 0.75:
                    total = min(_round500(due * rng.uniform(0.2, 0.9)), due)
                else:
                    total = 0                                # nothing paid yet

                # --- split into 1-2 installments ---
                amounts = [total] if total > 0 else []
                if total >= 2000 and rng.random() < 0.4:
                    first_part = _round500(total / 2)
                    if 0 < first_part < total:
                        amounts = [first_part, total - first_part]

                dates = sorted(
                    TERM3_START + timedelta(days=rng.randint(0, term_days)) for _ in amounts
                )
                payments = [(a, d, rng.choice(methods)) for a, d in zip(amounts, dates)]

                # --- identity: account + profile + guardian (all populated) ---
                age = 3 + idx                                # Baby Class = 3 ... Grade 12 = 17
                dob = date(2026 - age, idrng.randint(1, 12), idrng.randint(1, 28))
                nid = unique("nid", lambda: str(idrng.randint(10_000_000, 99_999_999)))
                upi = unique("upi", lambda: "%s%06d" % (idrng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ"),
                                                         idrng.randint(0, 999999)))
                relationship = idrng.choices(RELATIONSHIPS, weights=[5, 3, 2])[0]
                g_pool = FEMALE_NAMES if relationship == "Mother" else (
                    MALE_NAMES if relationship == "Father" else MALE_NAMES + FEMALE_NAMES)
                g_first = idrng.choice(g_pool)
                g_last = last.split()[-1]                    # shares the child's surname
                guardian_seq[0] += 1
                g_phone = unique("phone", make_phone)

                rows.append({
                    "first_name": first, "last_name": last, "gender": gender,
                    "grade": grade, "stream": stream, "admission_no": admission_no,
                    "date_admitted": admitted,
                    "email": f"{admission_no}@nyalischool.ac.ke",
                    "phone": unique("phone", make_phone),
                    "national_id": nid,
                    "date_of_birth": dob,
                    "upi": upi,
                    "guardian": {
                        "first_name": g_first, "last_name": g_last, "phone": g_phone,
                        "email": f"{g_first}.{g_last}{guardian_seq[0]}@example.com".lower(),
                        "relationship": relationship,
                    },
                    "bal_term2": Decimal(bf), "payments": payments,
                })
    return rows


class Command(BaseCommand):
    help = "Flush the DB, then seed a Baby Class -> Grade 12 CBC school with 2026 Term 3 fees, sample students, invoices and payments."

    def add_arguments(self, parser):
        parser.add_argument("--no-flush", action="store_true",
                            help="Skip the flush and only seed (idempotent re-run).")
        parser.add_argument("--yes", action="store_true",
                            help="Do not ask for confirmation before flushing.")

    def handle(self, *args, **options):
        self._validate_config()
        self._resolve_schema()      # runs BEFORE the flush so you see any warnings first

        if not options["no_flush"]:
            if not options["yes"]:
                answer = input(
                    "This will DELETE ALL DATA in the database, then seed afresh.\n"
                    "Type 'yes' to continue: "
                )
                if answer.strip().lower() != "yes":
                    raise CommandError("Aborted - nothing was changed.")
            self.stdout.write(self.style.WARNING("Flushing database..."))
            call_command("flush", interactive=False, verbosity=0)
            self.stdout.write(self.style.SUCCESS("Database flushed."))

        self._seed_all()

    # ------------------------------------------------------------------
    # SCHEMA RESOLUTION (field names + guardian link)
    # ------------------------------------------------------------------
    @staticmethod
    def _is_rel(f):
        return getattr(f, "is_relation", False) and getattr(f, "concrete", False) \
            and getattr(f, "related_model", None) is not None

    @staticmethod
    def _user_link_field(model):
        for f in model._meta.get_fields():
            if (Command._is_rel(f) and (f.many_to_one or f.one_to_one)
                    and f.related_model is User):
                return f
        return None

    def _resolve_schema(self):
        user_fields = {f.name for f in User._meta.concrete_fields}
        profile_fields = {f.name for f in StudentProfile._meta.concrete_fields}
        self.f_user = {k: next((c for c in cands if c in user_fields), None)
                       for k, cands in USER_FIELD_CANDIDATES.items()}
        self.f_profile = {k: next((c for c in cands if c in profile_fields), None)
                          for k, cands in PROFILE_FIELD_CANDIDATES.items()}
        self.guardian_link = self._detect_guardian_link()
        self.unmapped = []

        self.stdout.write(self.style.MIGRATE_HEADING("Field mapping"))
        for label, mapping, model in (("User", self.f_user, "User"),
                                      ("StudentProfile", self.f_profile, "StudentProfile")):
            for key, found in mapping.items():
                if found:
                    self.stdout.write(f"  {label}.{found:<22} <- {key}")
                else:
                    self.unmapped.append(f"{label}.{key}")
                    self.stdout.write(self.style.WARNING(
                        f"  {label}: no field found for '{key}' (add your field name to the candidates list)"))
        link = self.guardian_link
        if link:
            self.stdout.write(f"  Guardian link         <- {link['kind']} "
                              f"({link.get('model').__name__ if link.get('model') else ''})")
        else:
            self.unmapped.append("guardian link")
            self.stdout.write(self.style.WARNING(
                "  Guardian: no parent/guardian link model found. Parent USER accounts will still be "
                "created, but not linked - paste your parent/guardian model and I'll wire it."))

    def _detect_guardian_link(self):
        rel = self._is_rel
        # A) link lives on StudentProfile itself
        for f in StudentProfile._meta.get_fields():
            if rel(f) and f.name in GUARDIAN_FK_CANDIDATES:
                if f.many_to_one or f.one_to_one:
                    return {"kind": "profile_fk", "name": f.name, "model": f.related_model}
                if f.many_to_many:
                    return {"kind": "profile_m2m", "name": f.name, "model": f.related_model}
        for f in StudentProfile._meta.get_fields():
            if rel(f) and f.many_to_many and f.related_model is User:
                return {"kind": "profile_m2m", "name": f.name, "model": User}

        # B) a separate parent/guardian model (name must say parent/guardian)
        for model in apps.get_app_config(StudentProfile._meta.app_label).get_models():
            if model in (StudentProfile, User):
                continue
            if not any(k in model.__name__.lower() for k in ("parent", "guardian")):
                continue
            fields = [f for f in model._meta.get_fields() if rel(f)]
            student_fields = [f for f in fields if f.related_model is StudentProfile]
            if not student_fields:
                continue
            sf = student_fields[0]
            if sf.many_to_many:                      # e.g. ParentProfile.children
                if self._user_link_field(model):
                    return {"kind": "owner_m2m", "model": model, "name": sf.name}
                continue
            names = {x.name for x in model._meta.get_fields()}
            rel_field = next((n for n in ("relationship", "relation", "relation_type") if n in names), None)
            for pf in fields:                        # e.g. StudentParent.parent
                if pf is sf or not (pf.many_to_one or pf.one_to_one):
                    continue
                if pf.related_model is User or self._user_link_field(pf.related_model):
                    return {"kind": "link_model", "model": model, "student_field": sf.name,
                            "parent_field": pf.name, "parent_model": pf.related_model,
                            "rel_field": rel_field}
        return None

    @staticmethod
    def _choice_value(model, field_name, label):
        field = model._meta.get_field(field_name)
        for value, lab in (field.choices or []):
            if str(lab).lower() == label.lower() or str(value).lower() == label.lower():
                return value
        return label.upper() if field.choices else label

    def _parent_target(self, model, parent_user):
        if model is User:
            return parent_user
        f = self._user_link_field(model)
        obj, _ = model.objects.get_or_create(**{f.name: parent_user})
        return obj

    def _seed_guardian(self, profile, g):
        extras = {}
        if self.f_user.get("email"):
            extras[self.f_user["email"]] = g["email"]
        if self.f_user.get("phone"):
            extras[self.f_user["phone"]] = g["phone"]
        parent, created = User.objects.get_or_create(
            username=g["phone"],
            defaults=dict(role=User.Role.PARENT, first_name=g["first_name"],
                          last_name=g["last_name"], password=self.pw_hash, **extras),
        )
        if not created:
            User.objects.filter(pk=parent.pk).update(
                first_name=g["first_name"], last_name=g["last_name"], **extras)
        self._bump("users:PARENT", created)

        link = self.guardian_link
        if not link:
            return
        kind = link["kind"]
        if kind == "profile_fk":
            target = self._parent_target(link["model"], parent)
            StudentProfile.objects.filter(pk=profile.pk).update(**{link["name"]: target})
        elif kind == "profile_m2m":
            getattr(profile, link["name"]).add(self._parent_target(link["model"], parent))
        elif kind == "owner_m2m":
            getattr(self._parent_target(link["model"], parent), link["name"]).add(profile)
        elif kind == "link_model":
            target = self._parent_target(link["parent_model"], parent)
            defaults = {}
            if link["rel_field"]:
                defaults[link["rel_field"]] = self._choice_value(
                    link["model"], link["rel_field"], g["relationship"])
            link["model"].objects.update_or_create(
                **{link["student_field"]: profile, link["parent_field"]: target}, defaults=defaults)
        self._bump("guardian links", True)

    @transaction.atomic
    def _seed_all(self):
        self.pw_hash = make_password(DEFAULT_PASSWORD)
        self.counts = {}
        self.students = _build_students()

        self.stdout.write(self.style.MIGRATE_HEADING("Base setup"))
        school = self._seed_school()
        admins = self._seed_admins()
        self.admin = admins[0]
        self.streams = self._seed_streams()
        self.grades = self._seed_grade_levels()
        self.pathways = self._seed_pathways()
        self._seed_subjects()
        self._seed_exam_types()
        self._seed_grading()
        self._seed_packages()
        self._seed_license(school, admins[0])
        self._seed_expense_categories()

        self.stdout.write(self.style.MIGRATE_HEADING("2026 calendar only"))
        self.terms = self._seed_calendar()

        self.stdout.write(self.style.MIGRATE_HEADING("2026 classrooms (Baby Class - Grade 12)"))
        self.classrooms = self._seed_classrooms()

        self.stdout.write(self.style.MIGRATE_HEADING("Term 3 2026 fee structures"))
        self.fee_structures = self._seed_fee_structures()

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"Admitting {len(self.students)} sample student(s) + Term 3 2026 invoice + payments"
        ))
        self.seeded_admission_nos = []
        for row in self.students:
            self._process_student(row)

        if self.seeded_admission_nos:
            self._verify_money()
        self._print_summary()

    # ------------------------------------------------------------------
    def _bump(self, key, created):
        if created:
            self.counts[key] = self.counts.get(key, 0) + 1

    def _validate_config(self):
        names = [g[0] for g in LADDER]
        if len(set(names)) != len(names):
            raise CommandError("Duplicate grade name in LADDER.")
        orders = [g[2] for g in LADDER]
        if len(set(orders)) != len(orders):
            raise CommandError("Duplicate level_order in LADDER.")
        for code, _name, grades, _compulsory, pathway in SUBJECTS:
            unknown = [g for g in grades if g not in names]
            if unknown:
                raise CommandError(f"Subject {code} references unknown grade(s): {unknown}")
            if pathway and pathway not in {p[0] for p in PATHWAYS}:
                raise CommandError(f"Subject {code} references unknown pathway {pathway!r}")
        codes = [s[0] for s in SUBJECTS]
        if len(set(codes)) != len(codes):
            raise CommandError("Duplicate subject code in SUBJECTS.")
        missing_fees = [n for n in names if n not in TERM3_2026_FEE]
        if missing_fees:
            raise CommandError(f"No Term 3 fee defined for: {missing_fees}")
        extra_fees = [n for n in TERM3_2026_FEE if n not in names]
        if extra_fees:
            raise CommandError(f"Fee defined for unknown grade(s): {extra_fees}")

    # ------------------------------------------------------------------
    def _seed_school(self):
        school, created = School.objects.get_or_create(
            name=SCHOOL["name"], defaults={k: v for k, v in SCHOOL.items() if k != "name"},
        )
        self._bump("school", created)
        return school

    def _seed_admins(self):
        admins = []
        for username, first, last, is_super in ADMINS:
            user, created = User.objects.get_or_create(
                username=username,
                defaults=dict(
                    role=User.Role.ADMIN, first_name=first, last_name=last,
                    password=self.pw_hash, is_super_admin=is_super,
                ),
            )
            self._bump("users:ADMIN", created)
            admins.append(user)
        return admins

    def _seed_streams(self):
        streams = {}
        for name in (STREAM_RED, STREAM_BLUE, STREAM_SINGLE):
            stream, created = Stream.objects.get_or_create(name=name)
            streams[name] = stream
            self._bump("streams", created)
        return streams

    def _seed_grade_levels(self):
        """Create missing grades, then link next_grade where it isn't set."""
        grades = {}
        for name, education_level, order, _streams in LADDER:
            grade, created = GradeLevel.objects.get_or_create(
                name=name, curriculum_type=CBC,
                defaults={"education_level": education_level, "level_order": order},
            )
            grades[name] = grade
            self._bump("grade levels", created)

        names = [g[0] for g in LADDER]
        for current, following in zip(names, names[1:]):
            grade = grades[current]
            if grade.next_grade_id is None:
                grade.next_grade = grades[following]
                grade.save(update_fields=["next_grade"])
        return grades

    def _seed_pathways(self):
        pathways = {}
        for code, name, description in PATHWAYS:
            pathway, created = Pathway.objects.update_or_create(
                code=code, defaults={"name": name, "description": description, "is_active": True},
            )
            pathways[code] = pathway
            self._bump("pathways", created)
        return pathways

    def _seed_subjects(self):
        for code, name, grade_names, compulsory, pathway_code in SUBJECTS:
            subject, created = Subject.objects.update_or_create(
                code=code, curriculum_type=CBC,
                defaults={
                    "name": name,
                    "has_papers": False,
                    "pathway": self.pathways[pathway_code] if pathway_code else None,
                },
            )
            self._bump("subjects", created)

            for grade_name in grade_names:
                _, g_created = GradeSubject.objects.update_or_create(
                    grade_level=self.grades[grade_name], subject=subject,
                    defaults={"is_compulsory": compulsory},
                )
                self._bump("grade subjects", g_created)

        for grade_name in SENIOR:
            _, created = SubjectSelectionRule.objects.update_or_create(
                grade_level=self.grades[grade_name], defaults=SENIOR_SELECTION_RULE,
            )
            self._bump("selection rules", created)

    def _seed_exam_types(self):
        for name, weight, order, mid, end in EXAM_TYPES:
            _, created = ExamType.objects.update_or_create(
                name=name,
                defaults={
                    "weight": weight, "order": order,
                    "counts_towards_midterm_rank": mid, "counts_towards_endterm_rank": end,
                },
            )
            self._bump("exam types", created)

    def _seed_grading(self):
        for letter, lo, hi, points, remark in CBC_GRADING:
            _, created = GradingScale.objects.update_or_create(
                curriculum_type=CBC, subject=None, grade_letter=letter,
                defaults={
                    "min_percentage": Decimal(lo), "max_percentage": Decimal(hi),
                    "points": Decimal(points), "remark": remark,
                },
            )
            self._bump("grading scales", created)

    def _seed_calendar(self):
        terms = {}
        for year_no, term_no, start, end, is_current in CALENDAR_2026:
            year, y_created = AcademicYear.objects.update_or_create(
                year=year_no,
                defaults={"start_date": date(year_no, 1, 1), "end_date": date(year_no, 12, 31), "is_current": False},
            )
            self._bump("academic years", y_created)
            term, t_created = Term.objects.update_or_create(
                academic_year=year, term_number=term_no,
                defaults={"start_date": start, "end_date": end, "is_current": is_current},
            )
            terms[(year_no, term_no)] = term
            self._bump("terms", t_created)
            if is_current:
                AcademicYear.objects.filter(pk=year.pk).update(is_current=True)
                AcademicYear.objects.exclude(pk=year.pk).update(is_current=False)

        for year_no in {c[0] for c in CALENDAR_2026}:
            year_terms = [t for (y, _), t in terms.items() if y == year_no]
            AcademicYear.objects.filter(year=year_no).update(
                start_date=min(t.start_date for t in year_terms),
                end_date=max(t.end_date for t in year_terms),
            )
        return terms

    def _seed_classrooms(self):
        classrooms = {}
        year = AcademicYear.objects.get(year=2026)
        for name, _education_level, _order, stream_names in LADDER:
            for stream_name in stream_names:
                classroom, created = ClassRoom.objects.get_or_create(
                    grade_level=self.grades[name], stream=self.streams[stream_name], academic_year=year,
                )
                classrooms[(name, stream_name)] = classroom
                self._bump("classrooms", created)
        return classrooms

    def _seed_fee_structures(self):
        structures = {}
        term3 = self.terms[(2026, 3)]
        for grade_name, items in TERM3_2026_FEE.items():
            total = sum((amount for _, amount in items), Decimal("0"))
            structure, created = FeeStructure.objects.update_or_create(
                grade_level=self.grades[grade_name], term=term3, defaults={"total_amount": total},
            )
            structure.items.all().delete()
            FeeStructureItem.objects.bulk_create(
                FeeStructureItem(fee_structure=structure, name=name, amount=amount)
                for name, amount in items
            )
            structures[grade_name] = structure
            self._bump("fee structures", created)
        return structures

    def _seed_packages(self):
        for tier, (price, order, features) in PACKAGES.items():
            limits = PLAN_DEFAULTS[tier]
            _, created = SubscriptionPackage.objects.update_or_create(
                tier=tier,
                defaults={
                    "monthly_price": price,
                    "max_students": limits["max_students"],
                    "max_classrooms_per_year": limits["max_classrooms_per_year"],
                    "max_teachers": limits["max_teachers"],
                    "features": features,
                    "is_active": True,
                    "display_order": order,
                },
            )
            self._bump("subscription packages", created)

    def _seed_license(self, school, admin):
        if License.objects.filter(school=school).exists():
            return
        lic = License(school=school, tier=LICENSE_TIER, valid_until=timezone.now() + timedelta(days=365))
        lic.apply_tier_defaults()
        lic.save()
        LicenseAuditLog.objects.create(
            school=school, action=LicenseAuditLog.Action.ISSUED,
            detail=f"Seeded initial {LICENSE_TIER} license (12 months).", performed_by=admin,
        )
        self._bump("licenses", True)

    def _seed_expense_categories(self):
        for name, code in EXPENSE_CATEGORIES:
            _, created = ExpenseCategory.objects.update_or_create(
                code=code, defaults={"name": name, "is_active": True},
            )
            self._bump("expense categories", created)

    # ------------------------------------------------------------------
    # STUDENTS, INVOICES, PAYMENTS
    # ------------------------------------------------------------------
    def _process_student(self, row):
        admission_no = row["admission_no"]
        self.seeded_admission_nos.append(admission_no)

        user_extras = {self.f_user[k]: row[k] for k in ("email", "phone", "national_id")
                       if self.f_user.get(k)}
        user, u_created = User.objects.get_or_create(
            username=admission_no,
            defaults=dict(
                role=User.Role.STUDENT, first_name=row["first_name"],
                last_name=row["last_name"], password=self.pw_hash, **user_extras,
            ),
        )
        if not u_created and user_extras:
            User.objects.filter(pk=user.pk).update(**user_extras)
        self._bump("users:STUDENT", u_created)

        profile_extras = {self.f_profile[k]: row[k] for k in ("date_of_birth", "upi")
                          if self.f_profile.get(k)}
        profile, p_created = StudentProfile.objects.update_or_create(
            user=user,
            defaults={
                "admission_no": admission_no,
                "gender": row["gender"],
                "curriculum_type": CBC,
                "date_admitted": row["date_admitted"],
                "is_active": True,
                **profile_extras,
            },
        )
        self._bump("student profiles", p_created)

        self._seed_guardian(profile, row["guardian"])

        classroom = self.classrooms[(row["grade"], row["stream"])]
        enrollment, e_created = Enrollment.objects.update_or_create(
            student=profile, academic_year=classroom.academic_year,
            defaults={"classroom": classroom, "status": Enrollment.Status.ACTIVE},
        )
        self._bump("enrollments", e_created)

        structure = self.fee_structures[row["grade"]]
        brought_forward = row["bal_term2"]
        amount_due = brought_forward + structure.total_amount

        # amount_paid is deliberately NOT in defaults: it is always synced
        # from the Payment rows below.
        invoice, i_created = Invoice.objects.update_or_create(
            enrollment=enrollment, fee_structure=structure,
            defaults={"brought_forward": brought_forward, "amount_due": amount_due},
        )
        self._bump("invoices", i_created)

        self._seed_payments(invoice, admission_no, row["payments"])

    def _seed_payments(self, invoice, admission_no, plan):
        """
        One Payment row per planned installment, then invoice.amount_paid is
        re-derived as the sum of ALL the invoice's payments (seeded + anything
        Finance recorded later).
        """
        keep = set()
        for n, (amount, paid_on, method) in enumerate(plan, start=1):
            reference = f"SEED-{admission_no}-{n}"
            keep.add(reference)
            paid_at = timezone.make_aware(datetime.combine(paid_on, time(12, 0)))
            amount = Decimal(amount)
            existing = Payment.objects.filter(invoice=invoice, reference=reference).first()
            if existing:
                existing.amount = amount
                existing.method = method
                existing.paid_at = paid_at
                existing.save(update_fields=["amount", "method", "paid_at"])
            else:
                Payment.objects.create(
                    invoice=invoice, amount=amount, method=method,
                    reference=reference, recorded_by=self.admin,
                    receipt_no=services.generate_receipt_no(), paid_at=paid_at,
                )
                self._bump("payments", True)

        # Drop stale seeded payments only (never Finance's own).
        invoice.payments.filter(reference__startswith=f"SEED-{admission_no}-").exclude(
            reference__in=keep
        ).delete()

        total_paid = invoice.payments.aggregate(t=Sum("amount"))["t"] or Decimal("0")
        if invoice.amount_paid != total_paid:
            invoice.amount_paid = total_paid
            invoice.save(update_fields=["amount_paid"])

    # ------------------------------------------------------------------
    # VERIFICATION + SUMMARY
    # ------------------------------------------------------------------
    def _verify_money(self):
        invoices = Invoice.objects.filter(enrollment__student__admission_no__in=self.seeded_admission_nos)
        mismatches = 0
        for inv in invoices.prefetch_related("payments"):
            paid = sum((p.amount for p in inv.payments.all()), Decimal("0"))
            if paid != inv.amount_paid:
                mismatches += 1
        if mismatches:
            raise CommandError(f"{mismatches} invoice(s) have amount_paid != sum of their payments.")

        ids = list(StudentProfile.objects.filter(
            admission_no__in=self.seeded_admission_nos
        ).values_list("id", flat=True))
        ledger = services.get_ledger_totals_bulk(ids)
        self.total_billed = sum((t["opening"] + t["charged"] for t in ledger.values()), Decimal("0"))
        self.total_paid = sum((t["paid"] for t in ledger.values()), Decimal("0"))
        self.total_balance = sum((t["balance"] for t in ledger.values()), Decimal("0"))

    def _print_summary(self):
        self.stdout.write(self.style.SUCCESS("\nDone. Newly created rows:"))
        if not self.counts:
            self.stdout.write("  (nothing - everything already existed)")
        for key, n in sorted(self.counts.items()):
            self.stdout.write(f"  {key:<24} {n}")

        self.stdout.write(self.style.MIGRATE_HEADING("\nClassrooms for 2026"))
        for name, _e, _o, stream_names in LADDER:
            fee = sum(a for _, a in TERM3_2026_FEE[name])
            n = STUDENTS_PER_CLASS * len(stream_names)
            self.stdout.write(
                f"  {name:<11} {' + '.join(stream_names):<10} "
                f"Term 3 fee KES {fee:>8,.0f}   students {n}"
            )

        if self.seeded_admission_nos:
            self.stdout.write(self.style.MIGRATE_HEADING("\nMoney check (must match every finance page)"))
            self.stdout.write(f"  Students seeded      {len(self.seeded_admission_nos)}")
            self.stdout.write(f"  Total billed         KES {self.total_billed:,.2f}")
            self.stdout.write(f"  Total paid           KES {self.total_paid:,.2f}")
            self.stdout.write(f"  Total outstanding    KES {self.total_balance:,.2f}")

        if self.unmapped:
            self.stdout.write(self.style.ERROR(
                "\nNOT POPULATED (no matching field/model found): " + ", ".join(self.unmapped)))

        self.stdout.write(self.style.WARNING(
            "\nREMINDERS\n"
            "  * Term 3 fees are PLACEHOLDERS - edit TERM3_2026_FEE (or Fee Structures in the app).\n"
            "  * Students, balances and payments are generated SAMPLE data, not real learners.\n"
            "  * PP2 is a single stream ('Main') but Grade 1 has Red/Blue. Promote PP2 learners\n"
            "    into Grade 1 Red/Blue yourself instead of bulk-promoting."
        ))
        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\nLogin (admin1 / {DEFAULT_PASSWORD}; students log in with their admission no. and the same password)"
            f" - change these after first login."
        ))