from django.conf import settings
from django.db import models
from django.utils import timezone


class DisciplinaryRecord(models.Model):
    class Category(models.TextChoices):
        LATENESS = "LATENESS", "Lateness / truancy"
        DISRESPECT = "DISRESPECT", "Disrespect / insubordination"
        FIGHTING = "FIGHTING", "Fighting / bullying"
        THEFT = "THEFT", "Theft"
        VANDALISM = "VANDALISM", "Vandalism / property damage"
        CHEATING = "CHEATING", "Exam malpractice"
        SUBSTANCE = "SUBSTANCE", "Drugs / prohibited items"
        UNIFORM = "UNIFORM", "Uniform / grooming"
        OTHER = "OTHER", "Other"

    class Severity(models.TextChoices):
        MINOR = "MINOR", "Minor"
        MODERATE = "MODERATE", "Moderate"
        SERIOUS = "SERIOUS", "Serious"

    class Action(models.TextChoices):
        WARNING = "WARNING", "Verbal / written warning"
        DETENTION = "DETENTION", "Detention / manual work"
        COUNSELLING = "COUNSELLING", "Referred to counselling"
        PARENT_MEETING = "PARENT_MEETING", "Parent summoned"
        SUSPENSION = "SUSPENSION", "Suspension"
        OTHER = "OTHER", "Other"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="disciplinary_records")
    enrollment = models.ForeignKey(
        "api.Enrollment", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        help_text="The class the student was in when this happened.",
    )
    incident_date = models.DateField(default=timezone.localdate)
    category = models.CharField(max_length=15, choices=Category.choices, default=Category.OTHER)
    severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.MINOR)
    action_taken = models.CharField(max_length=15, choices=Action.choices, default=Action.WARNING)
    summary = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    letter_body = models.TextField(help_text="The full letter exactly as it was issued.")
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_disciplinary_records"
        ordering = ["-incident_date", "-id"]

    def __str__(self):
        return f"{self.student.admission_no} - {self.summary} ({self.incident_date})"


class StudentStatusLog(models.Model):
    """Audit trail of every deactivation / reactivation (with the reason)."""

    class Action(models.TextChoices):
        DEACTIVATED = "DEACTIVATED", "Deactivated"
        REACTIVATED = "REACTIVATED", "Reactivated"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="status_logs")
    action = models.CharField(max_length=12, choices=Action.choices)
    reason = models.CharField(max_length=255, blank=True)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_status_logs"
        ordering = ["-created_at"]