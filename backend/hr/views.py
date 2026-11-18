import csv
from datetime import date, timedelta
from django.db.models import Count, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from . import models as m, serializers as s, services
from .permissions import IsHR
from .serializers import NON_STAFF_ROLES
from django.contrib.auth import get_user_model

class HRBase(viewsets.ModelViewSet):
    permission_classes = [IsHR]


class DepartmentViewSet(HRBase):
    queryset = m.Department.objects.all()
    serializer_class = s.DepartmentSerializer


class PositionViewSet(HRBase):
    queryset = m.Position.objects.all()
    serializer_class = s.PositionSerializer


class LeaveTypeViewSet(HRBase):
    queryset = m.LeaveType.objects.all()
    serializer_class = s.LeaveTypeSerializer


class EmployeeViewSet(HRBase):
    serializer_class = s.EmployeeSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]  # no DELETE: employees exit, never vanish

    def get_queryset(self):
        qs = m.Employee.objects.select_related("department", "position")
        p = self.request.query_params
        for key in ("category", "status", "department"):
            if p.get(key):
                qs = qs.filter(**{key: p[key]})
        if p.get("search"):
            q = p["search"]
            qs = qs.filter(first_name__icontains=q) | qs.filter(last_name__icontains=q) | qs.filter(employee_no__icontains=q)
        return qs

    @action(detail=True, methods=["post"])
    def create_login(self, request, pk=None):
        emp = self.get_object()
        if emp.user_id:
            return Response({"detail": "Already has a login."}, status=400)
        try:
            pw = services.create_login(emp)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        return Response({"username": emp.user.username, "initial_password": pw})
    
    
    @action(detail=False, methods=["get"])
    def available_users(self, request):
        """Active, non-student/parent accounts not yet linked to an employee."""
        User = get_user_model()
        users = (User.objects.filter(is_active=True, employee__isnull=True)
                 .exclude(role__in=NON_STAFF_ROLES).order_by("first_name", "username"))
        return Response([
            {"id": str(u.id), "username": u.username, "full_name": u.get_full_name(), "role": u.role}
            for u in users
        ])

    @action(detail=True, methods=["post"])
    def unlink_user(self, request, pk=None):
        emp = self.get_object()
        if not emp.user_id:
            return Response({"detail": "This employee is not linked to an account."}, status=400)
        emp.user = None
        emp.save(update_fields=["user"])  # the account itself is untouched
        return Response(s.EmployeeSerializer(emp).data)

    @action(detail=True, methods=["post"])
    def exit(self, request, pk=None):
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"detail": "A reason is required."}, status=400)
        emp = services.exit_employee(self.get_object(), reason, request.data.get("exit_date"))
        return Response(s.EmployeeSerializer(emp).data)


class LeaveRequestViewSet(HRBase):
    serializer_class = s.LeaveRequestSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = m.LeaveRequest.objects.select_related("employee", "leave_type")
        if self.request.query_params.get("status"):
            qs = qs.filter(status=self.request.query_params["status"])
        return qs

    def _review(self, request, approve):
        try:
            leave = services.review_leave(self.get_object(), request.user, approve, request.data.get("remarks", ""))
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(s.LeaveRequestSerializer(leave).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._review(request, True)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._review(request, False)


class AttendanceViewSet(HRBase):
    serializer_class = s.AttendanceSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = m.StaffAttendance.objects.select_related("employee")
        p = self.request.query_params
        if p.get("date"):
            qs = qs.filter(date=p["date"])
        if p.get("employee"):
            qs = qs.filter(employee=p["employee"])
        return qs

    def perform_create(self, serializer):
        serializer.save(recorded_by=self.request.user)

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """{date, rows:[{employee, status, check_in?, check_out?}]} - upserts one day's register."""
        saved = 0
        for r in request.data.get("rows", []):
            m.StaffAttendance.objects.update_or_create(
                employee_id=r["employee"], date=request.data["date"],
                defaults={"status": r["status"], "recorded_by": request.user, "source": "MANUAL",
                          **({"check_in": r["check_in"]} if r.get("check_in") else {}),
                          **({"check_out": r["check_out"]} if r.get("check_out") else {})},
            )
            saved += 1
        return Response({"saved": saved})


@api_view(["GET"])
@permission_classes([IsHR])
def dashboard(request):
    today = timezone.localdate()
    active = m.Employee.objects.exclude(status="EXITED")
    att = dict(m.StaffAttendance.objects.filter(date=today).values_list("status").annotate(n=Count("id")))
    return Response({
        "total": active.count(),
        "by_category": dict(active.values_list("category").annotate(n=Count("id"))),
        "by_type": dict(active.values_list("employment_type").annotate(n=Count("id"))),
        "attendance_today": att,
        "pending_leave": m.LeaveRequest.objects.filter(status="PENDING").count(),
        "contracts_expiring_30d": active.filter(
            contract_end_date__range=(today, today + timedelta(days=30))).count(),
    })


# ======================= PAYROLL =======================
def S(model, **kw):
    meta = type("Meta", (), {"model": model, "fields": "__all__", **kw})
    return type(f"{model.__name__}S", (serializers.ModelSerializer,), {"Meta": meta})


class SalaryViewSet(HRBase):
    queryset = m.SalaryStructure.objects.select_related("employee")
    serializer_class = S(m.SalaryStructure)

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.filter(employee=self.request.query_params["employee"]) if "employee" in self.request.query_params else qs


class DeductionViewSet(HRBase):
    queryset = m.EmployeeDeduction.objects.all()
    serializer_class = S(m.EmployeeDeduction)


class RateViewSet(HRBase):
    queryset = m.StatutoryRate.objects.order_by("code", "-effective_from")
    serializer_class = S(m.StatutoryRate)


class PayslipS(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_no = serializers.CharField(source="employee.employee_no", read_only=True)
    period = serializers.SerializerMethodField()

    class Meta:
        model = m.Payslip
        fields = "__all__"

    def get_period(self, o):
        return f"{date(o.run.year, o.run.month, 1):%B %Y}"


class RunViewSet(HRBase):
    queryset = m.PayrollRun.objects.annotate(total_net=Sum("payslips__net"), staff=Count("payslips"))
    serializer_class = S(m.PayrollRun, read_only_fields=("status", "created_by", "approved_by", "approved_at"))
    http_method_names = ["get", "post", "head", "options"]

    def get_serializer_class(self):
        base = super().get_serializer_class()
        return type("RunS", (base,), {"total_net": serializers.DecimalField(12, 2, read_only=True),
                                      "staff": serializers.IntegerField(read_only=True),
                                      "Meta": type("Meta", (base.Meta,), {"fields": "__all__"})})

    def create(self, request):
        try:
            run, n = services.generate_run(int(request.data["year"]), int(request.data["month"]), request.user)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        return Response({"id": run.id, "payslips": n})

    @action(detail=True, methods=["get"])
    def payslips(self, request, pk=None):
        qs = self.get_object().payslips.select_related("employee", "run")
        return Response(PayslipS(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="sync")
    def sync_missing(self, request, pk=None):
        """Add payslips only for staff missing from this draft; existing payslips are untouched."""
        try:
            added, skipped = services.add_missing_to_run(self.get_object())
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        return Response({"added": added, "skipped": skipped})

    @action(detail=True, methods=["post"], url_path=r"payslips/(?P<slip_id>\d+)/edit")
    def edit_payslip(self, request, pk=None, slip_id=None):
        """Edit one payslip of a DRAFT run."""
        slip = get_object_or_404(self.get_object().payslips.select_related("employee", "run"), pk=slip_id)
        try:
            slip = services.update_payslip(slip, request.data)
        except (ValueError, ArithmeticError) as e:  # ArithmeticError = bad decimal input
            return Response({"detail": str(e) if isinstance(e, ValueError) else "Enter valid numbers."}, status=400)
        return Response(PayslipS(slip).data)

    def _go(self, request, paid):
        try:
            services.approve_run(self.get_object(), request.user, paid)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._go(request, False)

    @action(detail=True, methods=["post"])
    def mark_paid(self, request, pk=None):
        return self._go(request, True)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_payslips(request):
    emp = getattr(request.user, "employee", None)
    if not emp:
        return Response([])
    qs = emp.payslips.filter(run__status__in=["APPROVED", "PAID"]).select_related("run", "employee")  # own, released only
    return Response(PayslipS(qs, many=True).data)


# ----- recruitment -----
class VacancyViewSet(HRBase):
    queryset = m.Vacancy.objects.annotate(applicants=Count("applications"))
    serializer_class = S(m.Vacancy)


class ApplicationViewSet(HRBase):
    serializer_class = S(m.Application, read_only_fields=("hired_employee",))

    def get_queryset(self):
        qs = m.Application.objects.select_related("vacancy")
        v = self.request.query_params.get("vacancy")
        return qs.filter(vacancy=v) if v else qs

    @action(detail=True, methods=["post"])
    def hire(self, request, pk=None):
        a, d = self.get_object(), request.data
        if a.stage != "SELECTED":
            return Response({"detail": "Only selected candidates can be hired."}, status=400)
        nid = a.national_id or d.get("national_id")
        if not nid or not d.get("category"):
            return Response({"detail": "National ID and staff category are required."}, status=400)
        if m.Employee.objects.filter(national_id=nid).exists():
            return Response({"detail": "An employee with this ID already exists."}, status=400)
        e = m.Employee.objects.create(
            first_name=a.first_name, last_name=a.last_name, gender=a.gender or d.get("gender", "M"), national_id=nid,
            phone=a.phone, email=a.email, category=d["category"], department=a.vacancy.department,
            position=a.vacancy.position, employment_type=d.get("employment_type", "PROBATION"),
            date_joined=d.get("date_joined") or timezone.localdate())
        a.hired_employee, a.stage = e, "HIRED"
        a.save()
        return Response(s.EmployeeSerializer(e).data)


# ----- attendance security endpoints -----
@api_view(["GET"])
@permission_classes([IsHR])
def gate_code(request):
    return Response(services.gate_qr())


@api_view(["GET", "PATCH"])
@permission_classes([IsHR])
def attendance_settings(request):
    cfg = m.AttendanceSettings.load()
    ser = S(m.AttendanceSettings)(cfg, data=request.data, partial=True) if request.method == "PATCH" else S(m.AttendanceSettings)(cfg)
    if request.method == "PATCH":
        ser.is_valid(raise_exception=True)
        ser.save()
    return Response(ser.data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def scan(request):
    emp = getattr(request.user, "employee", None)
    if not emp:
        return Response({"detail": "Your account is not linked to a staff record."}, status=403)
    d = request.data
    ip = request.META.get("REMOTE_ADDR")
    try:
        return Response(services.scan(emp, d.get("token", ""), d.get("device_id", ""), d.get("lat"), d.get("lng"), d.get("accuracy"), ip))
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)


@api_view(["POST"])
@permission_classes([IsHR])
def reset_device(request, employee_id):
    m.StaffDevice.objects.filter(employee_id=employee_id).delete()
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsHR])
def scan_log(request):
    rows = m.AttendanceScan.objects.select_related("employee")[:200]
    return Response([{"employee": r.employee.full_name, "kind": r.kind, "at": r.at, "distance_m": r.distance_m, "note": r.note} for r in rows])


# ----- reports -----
def _reports(name, p):
    y, mo = int(p.get("year", timezone.localdate().year)), int(p.get("month", timezone.localdate().month))
    act = m.Employee.objects.exclude(status="EXITED")
    if name == "register":
        return [{"No": e.employee_no, "Name": e.full_name, "Category": e.category, "Department": e.department.name if e.department else "",
                 "Position": e.position.title if e.position else "", "Type": e.employment_type, "Joined": e.date_joined, "Status": e.status}
                for e in m.Employee.objects.select_related("department", "position")]
    if name == "headcount":
        return [{"Department": r["department__name"] or "None", "Staff": r["n"]} for r in act.values("department__name").annotate(n=Count("id"))]
    if name == "attendance":
        out = []
        for e in act:
            a = m.StaffAttendance.objects.filter(employee=e, date__year=y, date__month=mo)
            c = dict(a.values_list("status").annotate(n=Count("id")))
            out.append({"No": e.employee_no, "Name": e.full_name, **{k.title(): c.get(k, 0) for k in ("PRESENT", "LATE", "ABSENT", "ON_LEAVE", "EARLY_DEPARTURE")}})
        return out
    if name == "leave":
        return [{"Employee": r.employee.full_name, "Type": r.leave_type.name, "From": r.start_date, "To": r.end_date, "Days": r.days, "Status": r.status}
                for r in m.LeaveRequest.objects.filter(start_date__year=y).select_related("employee", "leave_type")]
    if name == "payroll":
        return [{"No": s.employee.employee_no, "Name": s.employee.full_name, "Gross": s.gross, "PAYE": s.paye, "NSSF": s.nssf, "SHIF": s.shif,
                 "Housing levy": s.housing_levy, "Other": s.other_deductions, "Net": s.net}
                for s in m.Payslip.objects.filter(run__year=y, run__month=mo).select_related("employee")]
    if name == "contracts":
        return [{"No": e.employee_no, "Name": e.full_name, "Ends": e.contract_end_date}
                for e in act.filter(contract_end_date__isnull=False).order_by("contract_end_date")]
    if name == "turnover":
        return [{"Year": y, "Joined": m.Employee.objects.filter(date_joined__year=y).count(), "Exited": m.Employee.objects.filter(exit_date__year=y).count(),
                 "Headcount now": act.count()}]
    raise KeyError(name)


@api_view(["GET"])
@permission_classes([IsHR])
def report(request, name):
    try:
        rows = _reports(name, request.query_params)
    except KeyError:
        return Response({"detail": "Unknown report."}, status=404)
    if request.query_params.get("format") == "csv":
        r = HttpResponse(content_type="text/csv")
        r["Content-Disposition"] = f'attachment; filename="hr-{name}.csv"'
        if rows:
            w = csv.DictWriter(r, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        return r
    return Response(rows)