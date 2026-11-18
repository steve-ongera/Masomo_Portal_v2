"""Business logic for the assignments module - views stay thin."""
from collections import defaultdict

from django.db.models import F, Q
from django.utils import timezone

from api import models as api_models

from . import models


def student_for_user(user):
    return getattr(user, "student_profile", None)


def recipient_enrollments(material):
    """
    Every ACTIVE enrollment in the material's classrooms who should see it.
    A student who picked their own subjects only gets a subject they chose
    (or one that is compulsory for their grade); a student with no
    selections (e.g. primary learners) gets everything for the class.
    """
    enrollments = list(
        api_models.Enrollment.objects.filter(
            classroom__in=material.classrooms.all(), status=api_models.Enrollment.Status.ACTIVE
        ).select_related("student__user", "classroom__grade_level", "classroom__stream", "classroom__academic_year")
    )
    if not enrollments:
        return []

    selected = defaultdict(set)
    for enr_id, subj_id in api_models.StudentSubjectSelection.objects.filter(
        enrollment_id__in=[e.id for e in enrollments]
    ).values_list("enrollment_id", "subject_id"):
        selected[enr_id].add(subj_id)

    compulsory_grades = set(
        api_models.GradeSubject.objects.filter(subject_id=material.subject_id, is_compulsory=True)
        .values_list("grade_level_id", flat=True)
    )
    return [
        e for e in enrollments
        if not selected.get(e.id)
        or material.subject_id in selected[e.id]
        or e.classroom.grade_level_id in compulsory_grades
    ]


def materials_for_student(student):
    """Published materials aimed at this student's current class (same visibility rule as above)."""
    enrollment = student.current_enrollment
    if not enrollment or enrollment.status != api_models.Enrollment.Status.ACTIVE:
        return models.Material.objects.none()

    qs = models.Material.objects.filter(is_published=True, classrooms=enrollment.classroom).select_related(
        "subject", "teacher"
    )
    selected = set(
        api_models.StudentSubjectSelection.objects.filter(enrollment=enrollment).values_list("subject_id", flat=True)
    )
    if selected:
        compulsory = api_models.GradeSubject.objects.filter(
            grade_level=enrollment.classroom.grade_level, is_compulsory=True
        ).values_list("subject_id", flat=True)
        qs = qs.filter(Q(subject_id__in=selected) | Q(subject_id__in=list(compulsory)))
    return qs


def record_access(material, student, *, viewed=False, downloaded=False):
    """Stamp first/last time and bump the counters. A download also counts as 'seen'."""
    now = timezone.now()
    access, _ = models.MaterialAccess.objects.get_or_create(material=material, student=student)
    qs = models.MaterialAccess.objects.filter(pk=access.pk)
    if viewed:
        qs.filter(first_viewed_at__isnull=True).update(first_viewed_at=now)
        qs.update(view_count=F("view_count") + 1, last_viewed_at=now)
    if downloaded:
        qs.filter(first_viewed_at__isnull=True).update(first_viewed_at=now, last_viewed_at=now, view_count=1)
        qs.filter(first_downloaded_at__isnull=True).update(first_downloaded_at=now)
        qs.update(download_count=F("download_count") + 1, last_downloaded_at=now)