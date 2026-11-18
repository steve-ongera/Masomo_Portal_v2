"""
Mount in the project urls as:

    path("api/v1/boarding/", include("boarding.urls")),

so the frontend reaches e.g. GET /api/v1/boarding/dormitories/.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("dormitories", views.DormitoryViewSet, basename="boarding-dormitory")
router.register("rooms", views.RoomViewSet, basename="boarding-room")
router.register("beds", views.BedViewSet, basename="boarding-bed")
router.register("registrations", views.RegistrationViewSet, basename="boarding-registration")
router.register("allocations", views.AllocationViewSet, basename="boarding-allocation")
router.register("exeats", views.ExeatViewSet, basename="boarding-exeat")
router.register("roll-calls", views.RollCallViewSet, basename="boarding-rollcall")
router.register("fee-rates", views.BoardingFeeRateViewSet, basename="boarding-feerate")

urlpatterns = [
    path("access/", views.AccessView.as_view()),
    path("settings/", views.SettingsView.as_view()),
    path("dashboard/", views.DashboardView.as_view()),
    path("wardens/", views.WardenUsersView.as_view()),
    path("my/", views.MyBoardingView.as_view()),
    path("my/exeat-requests/", views.MyExeatRequestView.as_view()),
    path("", include(router.urls)),
]