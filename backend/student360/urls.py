from django.urls import path

from . import views

urlpatterns = [
    path("students/<int:pk>/360/overview/", views.OverviewView.as_view()),
    path("students/<int:pk>/360/fees/", views.FeesView.as_view()),
    path("students/<int:pk>/360/academics/", views.AcademicsView.as_view()),
    path("students/<int:pk>/360/meals/", views.MealsView.as_view()),
    path("students/<int:pk>/360/library/", views.LibraryView.as_view()),
    path("students/<int:pk>/360/discipline/", views.DisciplineView.as_view()),
    path("students/<int:pk>/360/account/", views.AccountView.as_view()),
]