from django.contrib import admin

from . import models


@admin.register(models.CurriculumTopic)
class CurriculumTopicAdmin(admin.ModelAdmin):
    list_display = ("name", "subject", "grade_level", "parent", "order", "suggested_lessons")
    list_filter = ("subject", "grade_level")
    search_fields = ("name",)


class SchemeEntryInline(admin.TabularInline):
    model = models.SchemeEntry
    extra = 0
    fields = ("week_number", "lesson_number", "topic", "topic_text", "subtopic_text")


@admin.register(models.SchemeOfWork)
class SchemeOfWorkAdmin(admin.ModelAdmin):
    list_display = ("__str__", "teacher", "term", "status", "submitted_at")
    list_filter = ("status", "term")
    inlines = [SchemeEntryInline]


@admin.register(models.LessonPlan)
class LessonPlanAdmin(admin.ModelAdmin):
    list_display = ("date", "topic", "teacher", "allocation", "status")
    list_filter = ("status", "term")
    search_fields = ("topic", "teacher__first_name", "teacher__last_name")


admin.site.register(models.LessonCoverage)