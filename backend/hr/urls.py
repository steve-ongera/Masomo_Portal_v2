from django.urls import path
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("departments", views.DepartmentViewSet, basename="hr-department")
router.register("positions", views.PositionViewSet, basename="hr-position")
router.register("leave-types", views.LeaveTypeViewSet, basename="hr-leave-type")
router.register("employees", views.EmployeeViewSet, basename="hr-employee")
router.register("leave", views.LeaveRequestViewSet, basename="hr-leave")
router.register("attendance", views.AttendanceViewSet, basename="hr-attendance")
router.register("salaries", views.SalaryViewSet, basename="hr-salary")
router.register("deductions", views.DeductionViewSet, basename="hr-deduction")
router.register("statutory-rates", views.RateViewSet, basename="hr-rate")
router.register("payroll-runs", views.RunViewSet, basename="hr-run")
router.register("vacancies", views.VacancyViewSet, basename="hr-vacancy")
router.register("applications", views.ApplicationViewSet, basename="hr-application")

urlpatterns = [
    path("dashboard/", views.dashboard),
    path("my-payslips/", views.my_payslips),
    path("attendance-gate/code/", views.gate_code),
    path("attendance-gate/settings/", views.attendance_settings),
    path("attendance-gate/scan-log/", views.scan_log),
    path("attendance-gate/reset-device/<int:employee_id>/", views.reset_device),
    path("scan/", views.scan),
    path("reports/<str:name>/", views.report),
] + router.urls
