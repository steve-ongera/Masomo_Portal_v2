"""
attendance/models.py

Student attendance for Masomo. This app only POINTS AT the `api` app's
tables (ClassRoom, Enrollment, Term, Subject, PeriodSlot) with foreign
keys. It never edits, subclasses or adds fields to any `api` model, so
`api` migrations are untouched.

Records hang off Enrollment (not StudentProfile) so a student's
attendance stays tied to the class and year they were actually in, the
same way ExamResult and Invoice work.
"""
from django.conf import settings
from django.db import models
from django.db.models import Q


class AttendanceSession(models.Model):
    """
    One roll call: a class, on a date, either for the whole day (DAILY) or
    for a single lesson (LESSON, with a subject and optionally the timetable
    period). Holds one AttendanceRecord per student.
    """

    class SessionType(models.TextChoices):
        DAILY = "DAILY", "Daily"
        LESSON = "LESSON", "Lesson / Period"

    classroom = models.ForeignKey("api.ClassRoom", on_delete=models.CASCADE, related_name="attendance_sessions")
    term = models.ForeignKey(
        "api.Term", on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance_sessions"
    )
    date = models.DateField()
    session_type = models.CharField(max_length=10, choices=SessionType.choices, default=SessionType.DAILY)
    subject = models.ForeignKey(
        "api.Subject", on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance_sessions",
        help_text="Set for LESSON sessions only.",
    )
    period_slot = models.ForeignKey(
        "api.PeriodSlot", on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance_sessions",
        help_text="The timetable period, when the lesson was picked from the timetable.",
    )
    marked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="attendance_sessions_marked"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "attendance_sessions"
        ordering = ["-date", "-created_at"]
        indexes = [models.Index(fields=["classroom", "date"])]
        constraints = [
            models.UniqueConstraint(
                fields=["classroom", "date"],
                condition=Q(session_type="DAILY"),
                name="uniq_daily_attendance_per_class_day",
            ),
            models.UniqueConstraint(
                fields=["classroom", "date", "subject", "period_slot"],
                condition=Q(session_type="LESSON"),
                name="uniq_lesson_attendance_per_period",
            ),
        ]

    def __str__(self):
        what = self.subject.name if self.subject_id else "Daily"
        return f"{self.classroom} - {what} - {self.date}"


class AttendanceRecord(models.Model):
    class Status(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        ABSENT = "ABSENT", "Absent"
        LATE = "LATE", "Late"
        EXCUSED = "EXCUSED", "Excused"

    class AbsenceReason(models.TextChoices):
        SICK = "SICK", "Sick"
        AUTHORIZED = "AUTHORIZED", "Authorized absence"
        FAMILY = "FAMILY", "Family reason"
        SCHOOL_ACTIVITY = "SCHOOL_ACTIVITY", "School activity"
        UNKNOWN = "UNKNOWN", "Unknown"
        OTHER = "OTHER", "Other"

    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name="records")
    enrollment = models.ForeignKey("api.Enrollment", on_delete=models.CASCADE, related_name="attendance_records")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PRESENT)
    absence_reason = models.CharField(max_length=20, choices=AbsenceReason.choices, blank=True)
    check_in_time = models.TimeField(null=True, blank=True, help_text="Arrival time, for LATE only.")
    remarks = models.CharField(max_length=255, blank=True)
    guardian_notified = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "attendance_records"
        unique_together = ("session", "enrollment")
        indexes = [models.Index(fields=["enrollment", "status"])]

    def __str__(self):
        return f"{self.enrollment.student.admission_no} - {self.status} ({self.session.date})"
