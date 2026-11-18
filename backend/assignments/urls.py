from django.urls import include, path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("teacher/materials", views.TeacherMaterialViewSet, basename="assignment-teacher-material")
router.register("student/materials", views.StudentMaterialViewSet, basename="assignment-student-material")

urlpatterns = [
    path("teacher/my-classes/", views.TeacherMyClassesView.as_view(), name="assignment-teacher-my-classes"),
    path("", include(router.urls)),
]