from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("plans", views.MealPlanViewSet, basename="meal-plan")
router.register("student-plans", views.StudentMealPlanViewSet, basename="meal-student-plan")
router.register("cards", views.MealCardViewSet, basename="meal-card")
router.register("collections", views.MealCollectionViewSet, basename="meal-collection")
router.register("attendants", views.CafeteriaAttendantViewSet, basename="meal-attendant")

urlpatterns = [
    path("scan/", views.ScanView.as_view()),
    path("issue/", views.IssueMealView.as_view()),
    path("sync/", views.SyncView.as_view()),
    path("roster/", views.RosterView.as_view()),
    path("dashboard/", views.DashboardView.as_view()),
    path("missing/", views.MissingView.as_view()),
    path("wallet/", views.WalletView.as_view()),
    path("wallet/topup/", views.WalletTopUpView.as_view()),
    path("wallet/pay/", views.WalletPayView.as_view()),
    path("wallet/pay/status/<str:checkout_id>/", views.WalletPayStatusView.as_view()),
    path("wallet/mpesa-callback/", views.MpesaWalletCallbackView.as_view()),
    path("my/", views.MyMealsView.as_view()),
    path("", include(router.urls)),
]