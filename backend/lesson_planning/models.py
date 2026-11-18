"""
lesson_planning/models.py

Academic planning module: Curriculum topics -> Schemes of Work -> Lesson
Plans -> Lesson Coverage (delivery tracking).

HARD RULE: this app only ever POINTS AT the `api` app (string references
like "api.Subject"). It never edits api models, and every reverse accessor
is prefixed `lp_` so nothing can ever collide with a name in `api`.
"""
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class ApprovalStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    SUBMITTED = "SUBMITTED", "Submitted"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"
    NEEDS_REVISION = "NEEDS_REVISION", "Needs Revision"


# Statuses in which the teacher may still edit the document.
EDITABLE_STATUSES = (
    ApprovalStatus.DRAFT,
    ApprovalStatus.REJECTED,
    ApprovalStatus.NEEDS_REVISION,
)


# ---------------------------------------------------------------------------
# 1. CURRICULUM SETUP - topics / subtopics per subject + grade
# ---------------------------------------------------------------------------
class CurriculumTopic(models.Model):
    """
    A topic (parent=None) or subtopic (parent=<topic>) for a subject at a
    grade level, e.g. Biology / Form 2 / Nutrition -> Balanced Diet.
    Works for CBC strands/sub-strands and 8-4-4 topics alike, because
    Subject and GradeLevel in `api` already carry the curriculum type.
    """

    subject = models.ForeignKey("api.Subject", on_delete=models.CASCADE, related_name="lp_topics")
    grade_level = models.ForeignKey("api.GradeLevel", on_delete=models.CASCADE, related_name="lp_topics")
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="subtopics")
    name = models.CharField(max_length=200)
    order = models.PositiveSmallIntegerField(default=1)
    suggested_lessons = models.PositiveSmallIntegerField(default=1)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="lp_topics_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "lp_curriculum_topics"
        ordering = ["subject", "grade_level", "order", "name"]
        unique_together = ("subject", "grade_level", "parent", "name")

    def __str__(self):
        return f"{self.subject.code} / {self.grade_level.name}: {self.name}"


# ---------------------------------------------------------------------------
# 2. SCHEME OF WORK - the broad, term-long plan (what is taught, which week)
# ---------------------------------------------------------------------------
class SchemeOfWork(models.Model):
    """
    ONE scheme per (teacher allocation, term). Re-using
    api.TeacherSubjectAllocation means a scheme can only exist for a
    teacher/subject/classroom the school has already assigned.
    """

    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lp_schemes")
    allocation = models.ForeignKey(
        "api.TeacherSubjectAllocation", on_delete=models.CASCADE, related_name="lp_schemes"
    )
    term = models.ForeignKey("api.Term", on_delete=models.CASCADE, related_name="lp_schemes")
    title = models.CharField(max_length=200, blank=True)

    status = models.CharField(max_length=20, choices=ApprovalStatus.choices, default=ApprovalStatus.DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="lp_schemes_reviewed"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_remarks = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "lp_schemes_of_work"
        unique_together = ("allocation", "term")
        ordering = ["-term__academic_year__year", "-term__term_number", "allocation__subject__name"]

    def __str__(self):
        return self.title or f"{self.allocation.subject.name} - {self.allocation.classroom} - {self.term}"


class SchemeEntry(models.Model):
    """One row of the scheme: Week 5, Lesson 1 -> Quadratic Equations."""

    scheme = models.ForeignKey(SchemeOfWork, on_delete=models.CASCADE, related_name="entries")
    week_number = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(20)])
    lesson_number = models.PositiveSmallIntegerField(default=1)

    topic = models.ForeignKey(
        CurriculumTopic, on_delete=models.SET_NULL, null=True, blank=True, related_name="scheme_entries"
    )
    topic_text = models.CharField(max_length=200, blank=True, help_text="Free-text topic if not from the curriculum list.")
    subtopic_text = models.CharField(max_length=200, blank=True)
    objectives = models.TextField(blank=True)
    activities = models.TextField(blank=True)
    resources = models.TextField(blank=True)
    assessment = models.TextField(blank=True)
    remarks = models.TextField(blank=True)

    class Meta:
        db_table = "lp_scheme_entries"
        unique_together = ("scheme", "week_number", "lesson_number")
        ordering = ["week_number", "lesson_number"]

    def __str__(self):
        return f"Wk {self.week_number}.{self.lesson_number} - {self.topic_text or self.topic}"


# ---------------------------------------------------------------------------
# 3. LESSON PLAN - the detailed plan for ONE lesson
# ---------------------------------------------------------------------------
class LessonPlan(models.Model):
    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lp_lesson_plans")
    allocation = models.ForeignKey("api.TeacherSubjectAllocation", on_delete=models.CASCADE, related_name="lp_lesson_plans")
    term = models.ForeignKey("api.Term", on_delete=models.CASCADE, related_name="lp_lesson_plans")
    week_number = models.PositiveSmallIntegerField(null=True, blank=True)
    date = models.DateField(default=timezone.localdate)

    # Optional links: the scheme row it came from, and the timetable slot it is for.
    scheme_entry = models.ForeignKey(SchemeEntry, on_delete=models.SET_NULL, null=True, blank=True, related_name="lesson_plans")
    timetable_entry = models.ForeignKey(
        "api.TimetableEntry", on_delete=models.SET_NULL, null=True, blank=True, related_name="lp_lesson_plans"
    )

    topic = models.CharField(max_length=200)
    subtopic = models.CharField(max_length=200, blank=True)
    objectives = models.TextField(blank=True)
    introduction = models.TextField(blank=True)
    activities = models.TextField(blank=True, help_text="Lesson development / teaching activities")
    resources = models.TextField(blank=True)
    assessment = models.TextField(blank=True)
    conclusion = models.TextField(blank=True)
    homework = models.TextField(blank=True)

    status = models.CharField(max_length=20, choices=ApprovalStatus.choices, default=ApprovalStatus.DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="lp_plans_reviewed"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_remarks = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "lp_lesson_plans"
        ordering = ["-date", "-id"]
        indexes = [models.Index(fields=["teacher", "date"]), models.Index(fields=["allocation", "term"])]

    def __str__(self):
        return f"{self.date} - {self.allocation.subject.code} - {self.topic}"


# ---------------------------------------------------------------------------
# 4. DELIVERY TRACKING
# ---------------------------------------------------------------------------
class LessonCoverage(models.Model):
    """What actually happened in class. Powers syllabus-coverage reports."""

    lesson_plan = models.OneToOneField(LessonPlan, on_delete=models.CASCADE, related_name="coverage")
    completed = models.BooleanField(default=False)
    coverage_percentage = models.PositiveSmallIntegerField(
        default=0, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    attendance = models.PositiveSmallIntegerField(null=True, blank=True, help_text="Learners present")
    challenges = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    recorded_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "lp_lesson_coverage"

    def __str__(self):
        return f"{self.lesson_plan} - {self.coverage_percentage}%"