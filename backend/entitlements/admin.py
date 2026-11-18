from django.contrib import admin

from .models import Feature, LicenseFeatureOverride


@admin.register(Feature)
class FeatureAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "kind", "plans", "is_core", "is_active")
    list_filter = ("kind", "is_core", "is_active", "packages")
    search_fields = ("name", "code")
    filter_horizontal = ("packages",)  # tick the plans that include this feature
    list_editable = ("is_active",)

    @admin.display(description="Included in")
    def plans(self, obj):
        return ", ".join(p.get_tier_display() for p in obj.packages.all()) or "-"


@admin.register(LicenseFeatureOverride)
class LicenseFeatureOverrideAdmin(admin.ModelAdmin):
    list_display = ("license", "feature", "mode", "expires_at", "note", "created_at")
    list_filter = ("mode", "feature")

    def save_model(self, request, obj, form, change):
        if not obj.created_by_id:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
