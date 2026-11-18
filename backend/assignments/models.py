"""
assignments/models.py
Assignments, CATs, take-aways, homework, holiday homework and revision
material that teachers publish to their allocated classes.

Students only READ / DOWNLOAD - there is no submission. MaterialAccess
records who opened or downloaded each item so the teacher can follow up.
Fully additive: references the `api` app but changes nothing in it.
"""
import os
import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models
from django.utils import timezone


def private_storage():
    """
    Files live OUTSIDE MEDIA_ROOT, so there is no public URL for them.
    They can only be fetched through the authenticated download endpoint.
    Override with PRIVATE_MEDIA_ROOT in settings.py if you want another folder.
    """
    root = getattr(settings, "PRIVATE_MEDIA_ROOT", os.path.join(str(settings.BASE_DIR), "private_media"))
    return FileSystemStorage(location=root)


def material_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    return f"assignments/{timezone.now():%Y/%m}/{uuid.uuid4().hex}{ext}"


class Material(models.Model):
    class Kind(models.TextChoices):
        ASSIGNMENT = "ASSIGNMENT", "Assignment"
        CAT = "CAT", "CAT"
        TAKEAWAY = "TAKEAWAY", "Take-away"
        HOMEWORK = "HOMEWORK", "Homework"
        HOLIDAY = "HOLIDAY", "Holiday Homework"
        REVISION = "REVISION", "Revision Material"

    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assignment_materials"
    )
    subject = models.ForeignKey("api.Subject", on_delete=models.CASCADE, related_name="assignment_materials")
    classrooms = models.ManyToManyField("api.ClassRoom", related_name="assignment_materials")
    academic_year = models.ForeignKey(
        "api.AcademicYear", on_delete=models.SET_NULL, null=True, blank=True, related_name="assignment_materials"
    )
    term = models.ForeignKey(
        "api.Term", on_delete=models.SET_NULL, null=True, blank=True, related_name="assignment_materials"
    )

    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.ASSIGNMENT)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, help_text="Short instructions shown above the content.")
    body = models.TextField(blank=True, help_text="Text content, when the teacher types it instead of (or as well as) uploading a file.")

    file = models.FileField(
        upload_to=material_upload_path, storage=private_storage, blank=True, max_length=255
    )
    original_filename = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveIntegerField(default=0)

    due_date = models.DateField(null=True, blank=True, help_text="Information only - nothing is submitted online.")
    is_published = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "assignment_materials"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["teacher", "-created_at"]), models.Index(fields=["is_published", "kind"])]

    def __str__(self):
        return f"{self.get_kind_display()}: {self.title}"

    @property
    def is_revision(self):
        return self.kind == self.Kind.REVISION


class MaterialAccess(models.Model):
    """One row per (material, student): when they first/last opened and downloaded it."""

    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name="accesses")
    student = models.ForeignKey("api.StudentProfile", on_delete=models.CASCADE, related_name="material_accesses")

    first_viewed_at = models.DateTimeField(null=True, blank=True)
    last_viewed_at = models.DateTimeField(null=True, blank=True)
    view_count = models.PositiveIntegerField(default=0)

    first_downloaded_at = models.DateTimeField(null=True, blank=True)
    last_downloaded_at = models.DateTimeField(null=True, blank=True)
    download_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "assignment_material_accesses"
        unique_together = ("material", "student")

    def __str__(self):
        return f"{self.student.admission_no} -> {self.material_id} (views {self.view_count}, downloads {self.download_count})"