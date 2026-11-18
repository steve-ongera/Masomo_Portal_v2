"""
entitlements/catalog.py - the technical wiring of every sellable feature.

This file is a SEED, not the runtime truth. `python manage.py sync_features` upserts it:
  * name / kind / prefixes / roles come from HERE   (developers own the wiring)
  * which plans include a feature live in the DATABASE after first creation
    (the business owns pricing: edit in Django Admin, no deploy)

New feature recipe:  add one dict below -> run sync_features -> done. Until you do, a new page or
endpoint is simply open (nothing breaks); registering it is what starts gating it.
"""
TIERS = ["TRIAL", "GO", "STANDARD", "PREMIUM", "PRO"]
ALL = TIERS
GO_UP = ["GO", "STANDARD", "PREMIUM", "PRO"]
STD_UP = ["STANDARD", "PREMIUM", "PRO"]
PREM_UP = ["PREMIUM", "PRO"]
PRO_ONLY = ["PRO"]

CATALOG = [
    # ------------------------------------------------------------------ portals (gate a role's login)
    dict(code="portal.admin", name="Admin portal", kind="PORTAL", roles=["ADMIN"], is_core=True, tiers=ALL),
    dict(code="portal.student_parent", name="Student & Parent portal", kind="PORTAL", roles=["STUDENT", "PARENT"], tiers=STD_UP),
    dict(code="portal.teacher", name="Teacher portal", kind="PORTAL", roles=["TEACHER"], tiers=STD_UP),
    dict(code="portal.secretary", name="Secretary portal", kind="PORTAL", roles=["SECRETARY"], tiers=STD_UP),
    dict(code="portal.finance", name="Finance portal", kind="PORTAL", roles=["FINANCE"], tiers=STD_UP),
    dict(code="portal.exam_officer", name="Exam Officer portal", kind="PORTAL", roles=["EXAM_OFFICER"], tiers=PREM_UP),
    dict(code="portal.principal", name="Principal portal", kind="PORTAL", roles=["PRINCIPAL"], tiers=PREM_UP),
    dict(code="portal.cafeteria", name="Cafeteria portal", kind="PORTAL", roles=["CAFETERIA"], tiers=PREM_UP),
    dict(code="portal.librarian", name="Librarian portal", kind="PORTAL", roles=["LIBRARIAN"], tiers=PREM_UP),
    dict(code="portal.hr", name="HR portal", kind="PORTAL", roles=["HR"], tiers=PRO_ONLY),
    dict(code="portal.procurement", name="Procurement portal", kind="PORTAL", roles=["PROCUREMENT"], tiers=PRO_ONLY),

    # ------------------------------------------------------------------ modules (gate pages + API)
    dict(code="attendance", name="Attendance", kind="MODULE", tiers=GO_UP,
         api=["attendance/"], ui=["/teacher/attendance"]),
    dict(code="timetable_generator", name="Timetable generator", kind="MODULE", tiers=STD_UP,
         api=["timetable-entries/", "period-slots/", "timetable/"],
         ui=["/admin/timetable", "/secretary/timetable", "/exam-officer/timetable", "/teacher/timetable", "/student/timetable"]),
    dict(code="assignments", name="Assignments", kind="MODULE", tiers=STD_UP,
         api=["assignments/"], ui=["/teacher/assignments", "/student/assignments"]),
    dict(code="lesson_planning", name="Lesson planning", kind="MODULE", tiers=STD_UP,
         api=["lesson-planning/"], ui=["/teacher/lesson-planning"]),
    # NOTE: the Safaricom callback is deliberately NOT listed - webhooks must always be reachable.
    dict(code="mpesa_stk", name="M-Pesa STK push fee collection", kind="MODULE", tiers=STD_UP,
         api=["payments/initiate/", "payments/status/"], ui=[]),
    dict(code="library", name="Library", kind="MODULE", tiers=PREM_UP,
         api=["library/"], ui=["/librarian", "/student/library", "/parent/library"]),
    dict(code="meals", name="Meals & cafeteria wallet", kind="MODULE", tiers=PREM_UP,
         api=["meals/"], ui=["/meals", "/cafeteria", "/student/meals", "/parent/meals"]),
    dict(code="expenses", name="Expense tracking", kind="MODULE", tiers=PREM_UP,
         api=["expenses/", "expense-categories/"],
         ui=["/admin/expenses", "/finance/expenses", "/secretary/expenses"]),
    dict(code="clearance", name="Student clearance workflow", kind="MODULE", tiers=PREM_UP,
         api=["clearance/", "my-clearance/"],
         ui=["/admin/clearance", "/secretary/clearance", "/principal/clearance", "/exam-officer/clearance", "/student/clearance"]),
    dict(code="gatepass", name="Fee gatepass cards", kind="MODULE", tiers=PREM_UP,
         api=["gatepass/"],
         ui=["/admin/fee-cards", "/finance/fee-cards", "/secretary/fee-cards", "/verify-gatepass"]),
    dict(code="hr_payroll", name="HR & payroll", kind="MODULE", tiers=PRO_ONLY,
         api=["hr/"], ui=["/hr", "/my-attendance", "/my-payslips"]),
    dict(code="procurement", name="Procurement & stores", kind="MODULE", tiers=PRO_ONLY,
         api=["procurement/"], ui=["/procurement"]),

    # ------------------------------------------------------------------ actions (checked in code via check_feature)
    dict(code="bulk_messaging", name="Bulk SMS & email", kind="ACTION", tiers=STD_UP),

    # ------------------------------------------------------------------ services (no code path; shown on the plan card)
    dict(code="account_manager", name="Dedicated account manager", kind="SERVICE", tiers=PRO_ONLY),
]
