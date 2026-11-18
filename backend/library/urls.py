from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("categories", views.CategoryViewSet, basename="library-category")
router.register("books", views.BookViewSet, basename="library-book")
router.register("loans", views.LoanViewSet, basename="library-loan")
router.register("fines", views.FineViewSet, basename="library-fine")

urlpatterns = [
    path("dashboard/", views.DashboardView.as_view()),
    path("students/search/", views.StudentSearchView.as_view()),
    path("issue/", views.IssueView.as_view()),
    path("return/", views.ReturnView.as_view()),
    path("return-preview/", views.ReturnPreviewView.as_view()),
    path("copies/<int:pk>/status/", views.CopyStatusView.as_view()),
    path("reports/overdue/", views.OverdueReportView.as_view()),
    path("reports/popular/", views.PopularReportView.as_view()),
    path("reports/stock/", views.StockReportView.as_view()),
    path("reports/remind/", views.RemindOverdueView.as_view()),
    path("settings/", views.SettingsView.as_view()),
    path("my/", views.MyLibraryView.as_view()),
    path("", include(router.urls)),
]
