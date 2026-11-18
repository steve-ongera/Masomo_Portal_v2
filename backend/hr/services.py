from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from types import SimpleNamespace
import base64, hashlib, io, math

import qrcode
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.crypto import get_random_string

from . import models as m

# Employee category -> existing api role (only where api already has a matching role)
ACCOUNT_ROLE = {"TEACHER": "TEACHER", "ACCOUNTS": "FINANCE", "ADMINISTRATION": "STAFF", "ICT": "STAFF", "SUPPORT": "STAFF"}


def weekdays_between(start, end):
    d, out = start, []
    while d <= end:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def leave_balance(employee, leave_type, year=None):
    year = year or timezone.localdate().year
    used = (m.LeaveRequest.objects.filter(
        employee=employee, leave_type=leave_type, status="APPROVED", start_date__year=year,
    ).aggregate(t=Sum("days"))["t"] or 0)
    return leave_type.days_per_year - used


def create_login(employee):
    """Creates an api User for the employee. Returns the one-time password."""
    role = ACCOUNT_ROLE.get(employee.category)
    if not role:
        raise ValueError("No login role exists for this staff category yet.")
    User = get_user_model()
    password = get_random_string(10)
    user = User.objects.create(
        username=employee.employee_no, first_name=employee.first_name, last_name=employee.last_name,
        email=employee.email, phone_number=employee.phone, role=role,
    )
    user.set_password(password)
    user.save()
    employee.user = user
    employee.save(update_fields=["user"])
    return password


@transaction.atomic
def review_leave(leave, reviewer, approve, remarks=""):
    if leave.status != "PENDING":
        raise ValueError("Only pending requests can be reviewed.")
    if approve:
        if leave.days > leave_balance(leave.employee, leave.leave_type, leave.start_date.year):
            raise ValueError("Employee does not have enough leave days left.")
        for day in weekdays_between(leave.start_date, leave.end_date):
            m.StaffAttendance.objects.update_or_create(
                employee=leave.employee, date=day,
                defaults={"status": "ON_LEAVE", "recorded_by": reviewer, "remarks": leave.leave_type.name},
            )
    leave.status = "APPROVED" if approve else "REJECTED"
    leave.reviewed_by, leave.reviewed_at, leave.review_remarks = reviewer, timezone.now(), remarks
    leave.save()
    return leave


@transaction.atomic
def exit_employee(employee, reason, exit_date=None):
    employee.status = "EXITED"
    employee.exit_reason = reason
    employee.exit_date = exit_date or timezone.localdate()
    employee.save(update_fields=["status", "exit_reason", "exit_date"])
    if employee.user:  # lock login, keep every record
        employee.user.is_active = False
        employee.user.is_active_staff = False
        employee.user.save(update_fields=["is_active", "is_active_staff"])
    return employee


# ======================= PAYROLL =======================
D = lambda v: Decimal(str(v))
q = lambda v: D(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _rate(code, on):
    r = m.StatutoryRate.objects.filter(code=code, effective_from__lte=on).order_by("-effective_from").first()
    if not r:
        raise ValueError(f"No {code} rate configured for {on:%B %Y}. Add it under statutory rates.")
    return r


def compute(structure, on):
    gross = structure.basic + structure.house_allowance + structure.transport_allowance + structure.other_allowance
    n, s, h, p = (_rate(c, on) for c in ("NSSF", "SHIF", "HOUSING_LEVY", "PAYE"))
    nssf = q(min(gross, D(n.config["upper_limit"])) * D(n.config["rate"]))
    shif = q(max(gross * D(s.config["rate"]), D(s.config.get("minimum", 0))))
    levy = q(gross * D(h.config["rate"]))
    taxable = gross - nssf - shif - levy  # all three are tax-deductible
    tax, left = Decimal(0), max(taxable, Decimal(0))
    for width, rate in p.config["bands"]:
        take = left if width is None else min(left, D(width))
        tax += take * D(rate)
        left -= take
        if left <= 0:
            break
    paye = q(max(tax - D(p.config["personal_relief"]), Decimal(0)))
    return dict(gross=q(gross), nssf=nssf, shif=shif, housing_levy=levy, paye=paye, taxable=q(taxable))


def _build_payslip(run, emp, st, on):
    """Create one payslip for `emp` from their salary structure `st`."""
    c = compute(st, on)
    ded = list(emp.deductions.filter(active=True).values("name", "amount"))
    other = sum((d["amount"] for d in ded), Decimal(0))
    net = c["gross"] - c["nssf"] - c["shif"] - c["housing_levy"] - c["paye"] - other
    return m.Payslip.objects.create(
        run=run, employee=emp, gross=c["gross"], nssf=c["nssf"], shif=c["shif"], housing_levy=c["housing_levy"],
        paye=c["paye"], other_deductions=other, net=q(net),
        breakdown={"earnings": {"Basic salary": str(st.basic), "House allowance": str(st.house_allowance),
                                "Transport allowance": str(st.transport_allowance), "Other allowance": str(st.other_allowance)},
                   "deductions": [{"name": d["name"], "amount": str(d["amount"])} for d in ded],
                   "taxable_pay": str(c["taxable"])},
    )


@transaction.atomic
def generate_run(year, month, user):
    run, _ = m.PayrollRun.objects.get_or_create(year=year, month=month, defaults={"created_by": user})
    if run.status != "DRAFT":
        raise ValueError("This month is already approved and locked.")
    run.payslips.all().delete()  # drafts are rebuilt from current data (discards manual edits)
    on = date(year, month, 1)
    count = 0
    for emp in m.Employee.objects.exclude(status="EXITED").select_related("salary"):
        st = getattr(emp, "salary", None)
        if not st:
            continue
        _build_payslip(run, emp, st, on)
        count += 1
    return run, count


@transaction.atomic
def add_missing_to_run(run):
    """Adds payslips only for staff who don't have one yet. Existing (possibly edited) payslips are untouched."""
    if run.status != "DRAFT":
        raise ValueError("Only draft runs can be changed.")
    on = date(run.year, run.month, 1)
    have = set(run.payslips.values_list("employee_id", flat=True))
    added, skipped = 0, []
    for emp in m.Employee.objects.exclude(status="EXITED").select_related("salary"):
        if emp.id in have:
            continue
        st = getattr(emp, "salary", None)
        if not st:
            skipped.append(emp.full_name)  # no salary structure yet
            continue
        _build_payslip(run, emp, st, on)
        added += 1
    return added, skipped


EARN_FIELDS = {"basic": "Basic salary", "house_allowance": "House allowance",
               "transport_allowance": "Transport allowance", "other_allowance": "Other allowance"}
STAT_FIELDS = ("paye", "nssf", "shif", "housing_levy")


def _given(data, key):
    return data.get(key) not in (None, "")


@transaction.atomic
def update_payslip(slip, data):
    """Edit a DRAFT payslip. Statutory figures are recalculated unless explicitly supplied."""
    run = slip.run
    if run.status != "DRAFT":
        raise ValueError("Approved runs are locked and cannot be edited.")
    bd = dict(slip.breakdown or {})
    earn = dict(bd.get("earnings", {}))
    for key, label in EARN_FIELDS.items():
        if _given(data, key):
            v = q(data[key])
            if v < 0:
                raise ValueError("Amounts cannot be negative.")
            earn[label] = str(v)
    st = SimpleNamespace(**{k: D(earn.get(label, 0)) for k, label in EARN_FIELDS.items()})
    c = compute(st, date(run.year, run.month, 1))
    for f in STAT_FIELDS:  # manual override of statutory figures
        if _given(data, f):
            c[f] = q(data[f])
            if c[f] < 0:
                raise ValueError("Amounts cannot be negative.")
    other = q(data["other_deductions"]) if _given(data, "other_deductions") else slip.other_deductions
    if other < 0:
        raise ValueError("Amounts cannot be negative.")
    net = c["gross"] - c["nssf"] - c["shif"] - c["housing_levy"] - c["paye"] - other
    if net < 0:
        raise ValueError("Deductions exceed gross pay.")
    slip.gross, slip.nssf, slip.shif = c["gross"], c["nssf"], c["shif"]
    slip.housing_levy, slip.paye, slip.other_deductions, slip.net = c["housing_levy"], c["paye"], other, q(net)
    bd["earnings"], bd["taxable_pay"], bd["edited"] = earn, str(c["taxable"]), True
    slip.breakdown = bd
    slip.save()
    return slip


def approve_run(run, user, paid=False):
    if run.status == "PAID" or (run.status == "APPROVED" and not paid):
        raise ValueError("Already " + run.status.lower() + ".")
    if run.status == "DRAFT" and paid:
        raise ValueError("Approve the run before marking it paid.")
    if not run.payslips.exists():
        raise ValueError("Nothing to approve: generate payslips first.")
    run.status = "PAID" if paid else "APPROVED"
    if not paid:
        run.approved_by, run.approved_at = user, timezone.now()
    run.save()
    return run


# ================= SECURE QR ATTENDANCE =================
# Secure QR attendance.
# - HR opens the Gate screen on a school device; it shows a QR that changes every ~25s.
# - Employees scan it from their OWN phone while signed in to their OWN account.
#   Identity comes from the login, never from the QR, so scanning someone else's code does nothing.
# - Extra checks: QR must be <= 45s old, phone is bound to one employee, must be inside the school
#   geofence, sign-out needs a prior sign-in, and every attempt is logged.

GATE_SALT, GATE_MAX_AGE = "hr-gate-v1", 45


def gate_qr():
    token = signing.dumps({"gate": 1}, salt=GATE_SALT)
    url = f"{settings.FRONTEND_URL}/my-attendance/scan/{token}"
    buf = io.BytesIO()
    qrcode.make(url).save(buf, format="PNG")
    return {"qr": base64.b64encode(buf.getvalue()).decode(), "refresh_in": 25}


def _distance(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(a))


def _fail(emp, ip, note, dist=None):
    m.AttendanceScan.objects.create(employee=emp, kind="FAIL", ip=ip, note=note, distance_m=dist)
    return ValueError(note)


def scan(employee, token, device_id, lat, lng, accuracy, ip):
    cfg = m.AttendanceSettings.load()
    try:
        signing.loads(token, salt=GATE_SALT, max_age=GATE_MAX_AGE)
    except signing.BadSignature:
        raise _fail(employee, ip, "That code has expired. Scan the code now showing on the gate screen.")
    if employee.status != "ACTIVE":
        raise _fail(employee, ip, "Your staff record is not active. Contact HR.")
    if not device_id:
        raise _fail(employee, ip, "This device could not be identified.")

    dh = hashlib.sha256(device_id.encode()).hexdigest()
    bound = m.StaffDevice.objects.filter(employee=employee).first()
    if bound and bound.device_hash != dh:
        raise _fail(employee, ip, "This is not your registered phone. Ask HR to reset your device.")
    if not bound:
        if m.StaffDevice.objects.filter(device_hash=dh).exists():
            raise _fail(employee, ip, "This phone is registered to another employee.")
        m.StaffDevice.objects.create(employee=employee, device_hash=dh)

    dist = None
    if cfg.require_geofence:
        if lat is None or lng is None or cfg.latitude is None:
            raise _fail(employee, ip, "Location is required. Allow location access and try again.")
        if accuracy and float(accuracy) > 150:
            raise _fail(employee, ip, "Your location is too imprecise. Move to an open area and retry.")
        dist = int(_distance(float(lat), float(lng), float(cfg.latitude), float(cfg.longitude)))
        if dist > cfg.radius_m:
            raise _fail(employee, ip, f"You are {dist} m from the school. Scanning only works on site.", dist)

    now = timezone.localtime()
    with transaction.atomic():
        rec = m.StaffAttendance.objects.select_for_update().filter(employee=employee, date=now.date()).first()
        if rec and rec.status == "ON_LEAVE":
            raise _fail(employee, ip, "You are on approved leave today.")
        if not rec or not rec.check_in:
            status = "LATE" if now.time() > cfg.late_after else "PRESENT"
            m.StaffAttendance.objects.update_or_create(
                employee=employee, date=now.date(),
                defaults={"check_in": now.time(), "status": status, "source": "SCAN", "recorded_by": None})
            kind = "IN"
        else:
            if rec.check_out:
                raise _fail(employee, ip, "You have already signed out today.")
            ci = timezone.make_aware(datetime.combine(now.date(), rec.check_in))
            if (now - ci).total_seconds() < cfg.min_minutes_before_signout * 60:
                raise _fail(employee, ip, f"Too soon to sign out. Wait {cfg.min_minutes_before_signout} minutes after signing in.")
            rec.check_out = now.time()
            if now.time() < cfg.work_end and rec.status == "PRESENT":
                rec.status = "EARLY_DEPARTURE"
            rec.save()
            kind = "OUT"
        m.AttendanceScan.objects.create(employee=employee, kind=kind, ip=ip, distance_m=dist)
    return {"kind": kind, "time": now.strftime("%H:%M"), "employee": employee.full_name}