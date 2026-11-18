from django.urls import path

from . import views

urlpatterns = [
    path("students/search/", views.student_search),
    path("profiles/<int:student_id>/", views.id_profile),
    path("cards/", views.cards_list),
    path("cards/issue/", views.issue_card),
    path("cards/issue_bulk/", views.issue_bulk),
    path("cards/class_sheet/", views.class_sheet),
    path("cards/<int:pk>/payload/", views.card_payload),
    path("cards/<int:pk>/set_status/", views.card_set_status),
    path("scan/attendance/", views.scan_attendance),
    path("scan/lookup/", views.scan_lookup),
    path("attendance/today/", views.attendance_today),
    path("attendance/notify_absentees/", views.notify_absentees),
]