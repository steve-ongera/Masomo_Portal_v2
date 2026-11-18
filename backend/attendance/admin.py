from django.contrib import admin

from .models import AttendanceRecord, AttendanceSession


class AttendanceRecordInline(admin.TabularInline):
    model = AttendanceRecord
    extra = 0
    raw_id_fields = ("enrollment",)


@admin.register(AttendanceSession)
class AttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ("classroom", "date", "session_type", "subject", "marked_by", "updated_at")
    list_filter = ("session_type", "date", "classroom__academic_year")
    search_fields = ("classroom__grade_level__name", "classroom__stream__name")
    raw_id_fields = ("classroom", "term", "subject", "period_slot", "marked_by")
    inlines = [AttendanceRecordInline]


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ("enrollment", "session", "status", "absence_reason", "guardian_notified")
    list_filter = ("status", "absence_reason")
    raw_id_fields = ("session", "enrollment")
