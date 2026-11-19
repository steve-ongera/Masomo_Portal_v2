"""hr/models.py - standalone HR app. Only touches `api` via settings.AUTH_USER_MODEL."""
from django.conf import settings
from django.db import models
from django.utils import timezone


class Department(models.Model):
    name = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "hr_departments"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Position(models.Model):
    title = models.CharField(max_length=100, unique=True)
    job_description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "hr_positions"
        ordering = ["title"]

    def __str__(self):
        return self.title


class Employee(models.Model):
    class Category(models.TextChoices):
        TEACHER = "TEACHER", "Teacher"
        ADMINISTRATION = "ADMINISTRATION", "Administration"
        ACCOUNTS = "ACCOUNTS", "Accounts"
        ICT = "ICT", "ICT"
        SUPPORT = "SUPPORT", "Support Staff"

    class EmploymentType(models.TextChoices):
        PERMANENT = "PERMANENT", "Permanent"
        CONTRACT = "CONTRACT", "Contract"
        PROBATION = "PROBATION", "Probation"
        CASUAL = "CASUAL", "Casual"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        ON_LEAVE = "ON_LEAVE", "On Leave"
        SUSPENDED = "SUSPENDED", "Suspended"
        EXITED = "EXITED", "Exited"

    employee_no = models.CharField(max_length=20, unique=True, editable=False)
    # Optional login. Teachers get one so api's timetable/allocations see them.
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="employee",
    )
    first_name = models.CharField(max_length=60)
    last_name = models.CharField(max_length=60)
    gender = models.CharField(max_length=1, choices=[("M", "Male"), ("F", "Female")])
    date_of_birth = models.DateField(null=True, blank=True)
    national_id = models.CharField(max_length=20, unique=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    emergency_contact = models.CharField(max_length=150, blank=True)

    category = models.CharField(max_length=20, choices=Category.choices)
    department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees")
    position = models.ForeignKey(Position, null=True, blank=True, on_delete=models.SET_NULL, related_name="employees")
    manager = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="reports")
    employment_type = models.CharField(max_length=12, choices=EmploymentType.choices, default=EmploymentType.PERMANENT)
    date_joined = models.DateField(default=timezone.localdate)
    contract_end_date = models.DateField(null=True, blank=True)

    kra_pin = models.CharField(max_length=20, blank=True)
    nssf_no = models.CharField(max_length=20, blank=True)
    sha_no = models.CharField(max_length=20, blank=True)
    bank_name = models.CharField(max_length=80, blank=True)
    bank_account = models.CharField(max_length=40, blank=True)

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    exit_date = models.DateField(null=True, blank=True)
    exit_reason = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hr_employees"
        ordering = ["employee_no"]

    def save(self, *args, **kwargs):
        if not self.employee_no:
            last = Employee.objects.order_by("-id").first()
            self.employee_no = f"EMP-{(last.id + 1 if last else 1):04d}"
        super().save(*args, **kwargs)

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"

    def __str__(self):
        return f"{self.employee_no} - {self.full_name}"


class LeaveType(models.Model):
    name = models.CharField(max_length=60, unique=True)
    days_per_year = models.PositiveSmallIntegerField(default=21)
    is_paid = models.BooleanField(default=True)

    class Meta:
        db_table = "hr_leave_types"

    def __str__(self):
        return self.name


class LeaveRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CANCELLED = "CANCELLED", "Cancelled"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="leave_requests")
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="requests")
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.PositiveSmallIntegerField(editable=False, default=0)  # weekdays, computed
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_remarks = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hr_leave_requests"
        ordering = ["-created_at"]


class StaffAttendance(models.Model):
    class Status(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        ABSENT = "ABSENT", "Absent"
        LATE = "LATE", "Late"
        EARLY_DEPARTURE = "EARLY_DEPARTURE", "Early Departure"
        ON_LEAVE = "ON_LEAVE", "On Leave"
        OFF_DUTY = "OFF_DUTY", "Off Duty"

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="attendance")
    date = models.DateField()
    check_in = models.TimeField(null=True, blank=True)
    check_out = models.TimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices)
    remarks = models.CharField(max_length=150, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    source = models.CharField(max_length=6, default="MANUAL")  # MANUAL | SCAN
    flagged = models.BooleanField(default=False)

    class Meta:
        db_table = "hr_staff_attendance"
        unique_together = ("employee", "date")
        ordering = ["-date"]


# ---------------- Attendance security ----------------
class AttendanceSettings(models.Model):
    """Single row. Edited from the Gate screen."""
    late_after = models.TimeField(default="08:00")
    work_end = models.TimeField(default="16:30")
    min_minutes_before_signout = models.PositiveSmallIntegerField(default=30)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    radius_m = models.PositiveIntegerField(default=150)
    require_geofence = models.BooleanField(default=True)

    class Meta:
        db_table = "hr_attendance_settings"

    @classmethod
    def load(cls):
        return cls.objects.first() or cls.objects.create()


class StaffDevice(models.Model):
    """One phone per employee. A phone can't be shared by two employees."""
    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name="device")
    device_hash = models.CharField(max_length=64, unique=True)
    bound_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hr_staff_devices"


class AttendanceScan(models.Model):
    """Audit log of every scan attempt, accepted or refused."""
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="scans")
    kind = models.CharField(max_length=4)  # IN / OUT / FAIL
    at = models.DateTimeField(auto_now_add=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    distance_m = models.IntegerField(null=True, blank=True)
    note = models.CharField(max_length=160, blank=True)

    class Meta:
        db_table = "hr_attendance_scans"
        ordering = ["-at"]


# ---------------- Payroll ----------------
class SalaryStructure(models.Model):
    employee = models.OneToOneField(Employee, on_delete=models.CASCADE, related_name="salary")
    basic = models.DecimalField(max_digits=12, decimal_places=2)
    house_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    transport_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    other_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        db_table = "hr_salary_structures"


class EmployeeDeduction(models.Model):
    """Recurring non-statutory deduction: loan repayment, advance, SACCO..."""
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="deductions")
    name = models.CharField(max_length=80)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "hr_employee_deductions"


class StatutoryRate(models.Model):
    """Effective-dated config so rate changes never need a code change."""
    code = models.CharField(max_length=20)  # PAYE, NSSF, SHIF, HOUSING_LEVY
    effective_from = models.DateField()
    config = models.JSONField()

    class Meta:
        db_table = "hr_statutory_rates"
        unique_together = ("code", "effective_from")


class PayrollRun(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        APPROVED = "APPROVED", "Approved"
        PAID = "PAID", "Paid"

    year = models.PositiveSmallIntegerField()
    month = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "hr_payroll_runs"
        unique_together = ("year", "month")
        ordering = ["-year", "-month"]


class Payslip(models.Model):
    run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="payslips")
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="payslips")
    gross = models.DecimalField(max_digits=12, decimal_places=2)
    nssf = models.DecimalField(max_digits=12, decimal_places=2)
    shif = models.DecimalField(max_digits=12, decimal_places=2)
    housing_levy = models.DecimalField(max_digits=12, decimal_places=2)
    paye = models.DecimalField(max_digits=12, decimal_places=2)
    other_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net = models.DecimalField(max_digits=12, decimal_places=2)
    breakdown = models.JSONField(default=dict)  # earnings lines, deduction lines, rates used

    class Meta:
        db_table = "hr_payslips"
        unique_together = ("run", "employee")


# ---------------- Recruitment ----------------
class Vacancy(models.Model):
    title = models.CharField(max_length=120)
    department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.SET_NULL)
    position = models.ForeignKey(Position, null=True, blank=True, on_delete=models.SET_NULL)
    description = models.TextField(blank=True)
    openings = models.PositiveSmallIntegerField(default=1)
    closing_date = models.DateField(null=True, blank=True)
    is_open = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hr_vacancies"
        ordering = ["-created_at"]


class Application(models.Model):
    class Stage(models.TextChoices):
        APPLIED = "APPLIED", "Applied"
        SHORTLISTED = "SHORTLISTED", "Shortlisted"
        INTERVIEWED = "INTERVIEWED", "Interviewed"
        SELECTED = "SELECTED", "Selected"
        REJECTED = "REJECTED", "Rejected"
        HIRED = "HIRED", "Hired"

    vacancy = models.ForeignKey(Vacancy, on_delete=models.CASCADE, related_name="applications")
    first_name = models.CharField(max_length=60)
    last_name = models.CharField(max_length=60)
    gender = models.CharField(max_length=1, blank=True)
    national_id = models.CharField(max_length=20, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    stage = models.CharField(max_length=12, choices=Stage.choices, default=Stage.APPLIED)
    interview_date = models.DateField(null=True, blank=True)
    interview_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)
    hired_employee = models.OneToOneField(Employee, null=True, blank=True, on_delete=models.SET_NULL, related_name="application")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "hr_applications"
        ordering = ["-created_at"]
