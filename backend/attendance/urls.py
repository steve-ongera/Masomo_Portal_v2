from django.urls import path

from . import views

urlpatterns = [
    path("my-classes/", views.MyClassesView.as_view()),
    path("lessons/", views.LessonsView.as_view()),
    path("sheet/", views.SheetView.as_view()),
    path("sheet/save/", views.SaveSheetView.as_view()),
    path("sessions/", views.SessionListView.as_view()),
    path("sessions/<int:pk>/", views.SessionDetailView.as_view()),
    path("summary/", views.SummaryView.as_view()),
    path("students/<int:enrollment_id>/", views.StudentHistoryView.as_view()),
]
