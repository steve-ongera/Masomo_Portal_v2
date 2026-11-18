from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("topics", views.CurriculumTopicViewSet, basename="lp-topic")
router.register("schemes", views.SchemeOfWorkViewSet, basename="lp-scheme")
router.register("scheme-entries", views.SchemeEntryViewSet, basename="lp-scheme-entry")
router.register("lesson-plans", views.LessonPlanViewSet, basename="lp-lesson-plan")

urlpatterns = [
    path("coverage/", views.CoverageOverviewView.as_view(), name="lp-coverage"),
    path("", include(router.urls)),
]