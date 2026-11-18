from django.urls import path

from .views import MyEntitlementsView

urlpatterns = [
    path("entitlements/me/", MyEntitlementsView.as_view(), name="entitlements-me"),
]
