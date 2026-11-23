from rest_framework import serializers
from . import models, services
from datetime import datetime, timedelta
from django.db.models import Sum
from django.utils import timezone

class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Department
        fields = "__all__"


class PositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.Position
        fields = "__all__"


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.LeaveType
        fields = "__all__"


from django.contrib.auth import get_user_model
from rest_framework import serializers
from . import models, services

User = get_user_model()

# Accounts that belong to the student/parent portals can never be linked to staff
NON_STAFF_ROLES = ("STUDENT", "PARENT")


class EmployeeSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    position_title = serializers.CharField(source="position.title", read_only=True)
    has_login = serializers.SerializerMethodField()
    linked_username = serializers.SerializerMethodField()
    linked_role = serializers.SerializerMethodField()

    # write-only: link (or relink) this employee to an existing user account
    user_id = serializers.PrimaryKeyRelatedField(
        source="user", queryset=User.objects.all(),
        write_only=True, required=False, allow_null=True,
    )

    class Meta:
        model = models.Employee
        fields = "__all__"
        read_only_fields = ("employee_no", "user", "status", "exit_date", "exit_reason")

    def get_has_login(self, obj):
        return obj.user_id is not None

    def get_linked_username(self, obj):
        return obj.user.username if obj.user_id else None

    def get_linked_role(self, obj):
        return obj.user.role if obj.user_id else None

    def validate_user_id(self, user):
        if user is None:
            return user
        if not user.is_active:
            raise serializers.ValidationError("That user account is inactive.")
        if user.role in NON_STAFF_ROLES:
            raise serializers.ValidationError("Student and parent accounts cannot be linked to staff.")
        clash = models.Employee.objects.filter(user=user)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("That account is already linked to another employee.")
        return user

    def validate(self, data):
        inst = self.instance
        new_user = data.get("user")
        if inst and new_user is not None:
            if inst.status == "EXITED":
                raise serializers.ValidationError("An exited employee cannot be linked to an account.")
            if inst.user_id and inst.user_id != new_user.pk:
                raise serializers.ValidationError("This employee is already linked. Unlink the current account first.")
        return data


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)

    class Meta:
        model = models.LeaveRequest
        fields = "__all__"
        read_only_fields = ("days", "status", "reviewed_by", "reviewed_at", "review_remarks")

    def validate(self, data):
        if data["end_date"] < data["start_date"]:
            raise serializers.ValidationError("End date is before start date.")
        data["days"] = len(services.weekdays_between(data["start_date"], data["end_date"]))
        if data["days"] == 0:
            raise serializers.ValidationError("That range has no working days.")
        return data

    def create(self, validated):
        return models.LeaveRequest.objects.create(**validated)


class AttendanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)

    class Meta:
        model = models.StaffAttendance
        fields = "__all__"
        read_only_fields = ("recorded_by",)




class MyLeaveRequestSerializer(serializers.ModelSerializer):
    """Employee-facing: the employee always comes from the logged-in user, never the payload."""
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)

    class Meta:
        model = models.LeaveRequest
        fields = ("id", "leave_type", "leave_type_name", "start_date", "end_date", "days",
                  "reason", "status", "review_remarks", "reviewed_at", "created_at")
        read_only_fields = ("days", "status", "review_remarks", "reviewed_at", "created_at")

    def validate_reason(self, v):
        if not v.strip():
            raise serializers.ValidationError("Please give a reason.")
        return v.strip()

    def validate(self, data):
        emp = self.context["employee"]
        start, end, lt = data["start_date"], data["end_date"], data["leave_type"]
        if end < start:
            raise serializers.ValidationError("End date is before start date.")
        if start < timezone.localdate() - timedelta(days=30):
            raise serializers.ValidationError("You can't request leave starting more than 30 days ago. Contact HR.")
        days = len(services.weekdays_between(start, end))
        if days == 0:
            raise serializers.ValidationError("That range has no working days.")
        overlap = models.LeaveRequest.objects.filter(
            employee=emp, status__in=["PENDING", "APPROVED"],
            start_date__lte=end, end_date__gte=start).exists()
        if overlap:
            raise serializers.ValidationError("You already have a pending or approved request overlapping these dates.")
        if lt.is_paid:
            pending = (models.LeaveRequest.objects.filter(
                employee=emp, leave_type=lt, status="PENDING", start_date__year=start.year
            ).aggregate(t=Sum("days"))["t"] or 0)
            available = services.leave_balance(emp, lt, start.year) - pending
            if days > available:
                raise serializers.ValidationError(
                    f"Not enough {lt.name} days left ({max(available, 0)} available, {days} requested).")
        data["days"] = days
        return data


# ======================= EMPLOYEE 360 =======================
class EmployeeProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    gender_display = serializers.CharField(source="get_gender_display", read_only=True)
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    employment_type_display = serializers.CharField(source="get_employment_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)
    position_title = serializers.CharField(source="position.title", read_only=True, default=None)
    manager_name = serializers.SerializerMethodField()
    years_of_service = serializers.SerializerMethodField()
    contract_days_left = serializers.SerializerMethodField()
    age = serializers.SerializerMethodField()

    class Meta:
        model = models.Employee
        fields = (
            "id", "employee_no", "full_name", "first_name", "last_name",
            "gender", "gender_display", "date_of_birth", "age", "national_id",
            "phone", "email", "address", "emergency_contact",
            "category", "category_display", "employment_type", "employment_type_display",
            "department", "department_name", "position", "position_title",
            "manager", "manager_name", "date_joined", "years_of_service",
            "contract_end_date", "contract_days_left",
            "kra_pin", "nssf_no", "sha_no", "bank_name", "bank_account",
            "status", "status_display", "exit_date", "exit_reason",
        )

    def get_manager_name(self, o):
        return o.manager.full_name if o.manager_id else None

    def get_years_of_service(self, o):
        end = o.exit_date or timezone.localdate()
        return round((end - o.date_joined).days / 365.25, 1) if o.date_joined else None

    def get_contract_days_left(self, o):
        return (o.contract_end_date - timezone.localdate()).days if o.contract_end_date else None

    def get_age(self, o):
        if not o.date_of_birth:
            return None
        t = timezone.localdate()
        return t.year - o.date_of_birth.year - ((t.month, t.day) < (o.date_of_birth.month, o.date_of_birth.day))


class AttendanceRowSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    hours = serializers.SerializerMethodField()

    class Meta:
        model = models.StaffAttendance
        fields = ("id", "date", "status", "status_display", "check_in", "check_out",
                  "hours", "source", "flagged", "remarks")

    def get_hours(self, o):
        if not (o.check_in and o.check_out):
            return None
        a = datetime.combine(o.date, o.check_in)
        b = datetime.combine(o.date, o.check_out)
        return round((b - a).total_seconds() / 3600, 2)


class ScanRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.AttendanceScan
        fields = ("id", "kind", "at", "distance_m", "ip", "note")


class SalarySerializer(serializers.ModelSerializer):
    gross = serializers.SerializerMethodField()

    class Meta:
        model = models.SalaryStructure
        fields = ("id", "basic", "house_allowance", "transport_allowance", "other_allowance", "gross")

    def get_gross(self, o):
        return o.basic + o.house_allowance + o.transport_allowance + o.other_allowance


class DeductionRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.EmployeeDeduction
        fields = ("id", "name", "amount", "active")


class PayslipRowSerializer(serializers.ModelSerializer):
    period = serializers.SerializerMethodField()
    year = serializers.IntegerField(source="run.year", read_only=True)
    month = serializers.IntegerField(source="run.month", read_only=True)
    run_status = serializers.CharField(source="run.status", read_only=True)

    class Meta:
        model = models.Payslip
        fields = ("id", "period", "year", "month", "run_status", "gross", "nssf", "shif",
                  "housing_levy", "paye", "other_deductions", "net", "breakdown")

    def get_period(self, o):
        return f"{o.run.year}-{o.run.month:02d}"


class LeaveRowSerializer(serializers.ModelSerializer):
    leave_type_name = serializers.CharField(source="leave_type.name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    reviewed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = models.LeaveRequest
        fields = ("id", "leave_type", "leave_type_name", "start_date", "end_date", "days", "reason",
                  "status", "status_display", "review_remarks", "reviewed_by_name", "reviewed_at", "created_at")

    def get_reviewed_by_name(self, o):
        return (o.reviewed_by.get_full_name() or o.reviewed_by.username) if o.reviewed_by_id else None