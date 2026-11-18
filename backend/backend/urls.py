from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework_simplejwt.views import TokenRefreshView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),

    # Extended modules. Each prefix below is also listed in
    # entitlements/catalog.py, which is how a plan can switch a whole module on/off.
    path("api/v1/meals/", include("meal_management.urls")),
    path("api/v1/hr/", include("hr.urls")),
    path("api/v1/procurement/", include("procurement.urls")),
    path("api/v1/library/", include("library.urls")),
    path("api/v1/lesson-planning/", include("lesson_planning.urls")),
    path("api/v1/attendance/", include("attendance.urls")),
    path("api/v1/assignments/", include("assignments.urls")),
    path("api/v1/bursaries/", include("bursaries.urls")),
    path("api/v1/boarding/", include("boarding.urls")),
    path("api/v1/student-id/", include("idcards.urls")),
    path("api/v1/", include("entitlements.urls")),
    path("api/v1/", include("student360.urls")),

    # Core engine
    path("api/v1/", include("api.urls")),
]

handler404 = "api.views.custom_404"
handler500 = "api.views.custom_500"

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)