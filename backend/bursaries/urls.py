from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("sources", views.FundingSourceViewSet, basename="bursary-source")
router.register("schemes", views.AidSchemeViewSet, basename="bursary-scheme")
router.register("awards", views.AwardViewSet, basename="bursary-award")
router.register("remittances", views.RemittanceViewSet, basename="bursary-remittance")

urlpatterns = [
    path("dashboard/", views.DashboardView.as_view()),
    path("my/", views.MyAidView.as_view()),
] + router.urls