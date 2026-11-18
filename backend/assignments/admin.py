from django.contrib import admin

from . import models


@admin.register(models.Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = ("title", "kind", "subject", "teacher", "is_published", "published_at", "created_at")
    list_filter = ("kind", "is_published", "subject")
    search_fields = ("title", "subject__name", "teacher__first_name", "teacher__last_name")
    filter_horizontal = ("classrooms",)


@admin.register(models.MaterialAccess)
class MaterialAccessAdmin(admin.ModelAdmin):
    list_display = ("material", "student", "view_count", "download_count", "last_viewed_at", "last_downloaded_at")
    search_fields = ("student__admission_no", "material__title")