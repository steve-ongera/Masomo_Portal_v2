import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q


class StudentIDProfile(models.Model):
    """ID-only details that aren't on StudentProfile. Kept separate so replacing a card never loses them."""

    student = models.OneToOneField("api.StudentProfile", on_delete=models.CASCADE, related_name="id_profile")
    photo = models.ImageField(upload_to="student_photos/", blank=True, null=True)
    nationality = models.CharField(max_length=60, default="Kenyan")
    address = models.CharField(max_length=200, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "student_id_profiles"

    def __str__(self):
        return f"ID profile - {self.student.admission_no}"


class StudentIDCard(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        LOST = "LOST", "Lost"
        BLOCKED = "BLOCKED", "Blocked"
        REPLACED = "REPLACED", "Replaced"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="id_cards")
    card_number = models.CharField(max_length=20, unique=True)
    qr_token = models.CharField(max_length=64, unique=True, db_index=True, editable=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    expiry_date = models.DateField()
    note = models.CharField(max_length=200, blank=True)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_id_cards"
        ordering = ["-issued_at"]
        constraints = [
            # One ACTIVE card per student, enforced by the database.
            models.UniqueConstraint(
                fields=["student"], condition=Q(status="ACTIVE"), name="one_active_id_card_per_student"
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.qr_token:
            self.qr_token = secrets.token_urlsafe(24)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.card_number} [{self.status}]"


class ArrivalRecord(models.Model):
    """One row per student per school day - the morning scan."""

    class Status(models.TextChoices):
        PRESENT = "PRESENT", "Present"
        LATE = "LATE", "Late"

    class Method(models.TextChoices):
        SCAN = "SCAN", "Card scan"
        MANUAL = "MANUAL", "Manual entry"

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="arrivals")
    date = models.DateField(db_index=True)
    check_in_at = models.DateTimeField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PRESENT)
    method = models.CharField(max_length=10, choices=Method.choices, default=Method.SCAN)
    fee_status = models.CharField(max_length=10, blank=True)  # snapshot: CLEARED / GRACE / OWING
    card = models.ForeignKey(StudentIDCard, null=True, blank=True, on_delete=models.SET_NULL, related_name="arrivals")
    scanned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    guardian_notified = models.BooleanField(default=False)

    class Meta:
        db_table = "student_arrivals"
        unique_together = ("student", "date")
        ordering = ["-check_in_at"]


class AbsenceAlert(models.Model):
    """Prevents emailing the same parent twice about the same absent day."""

    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="absence_alerts")
    date = models.DateField(db_index=True)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_absence_alerts"
        unique_together = ("student", "date")