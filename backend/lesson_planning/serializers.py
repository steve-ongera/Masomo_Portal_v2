from django.db.models import Count, Max
from django.utils import timezone
from rest_framework import serializers

from api import models as api_models

from . import models, services
from .permissions import REVIEWER_ROLES, TEACHER


def _is_teacher(request):
    return bool(request and request.user.is_authenticated and request.user.role == TEACHER)


def _check_allocation_owner(request, allocation):
    """A teacher may only plan for allocations that belong to them."""
    if _is_teacher(request) and allocation.teacher_id != request.user.id:
        raise serializers.ValidationError({"allocation": "This allocation is not yours."})


# ---------------------------------------------------------------------------
# CURRICULUM
# ---------------------------------------------------------------------------
class CurriculumTopicSerializer(serializers.ModelSerializer):
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    grade_level_name = serializers.CharField(source="grade_level.name", read_only=True)
    parent_name = serializers.CharField(source="parent.name", read_only=True, default=None)

    class Meta:
        model = models.CurriculumTopic
        fields = "__all__"
        read_only_fields = ["created_by"]


# ---------------------------------------------------------------------------
# SCHEMES OF WORK
# ---------------------------------------------------------------------------
class SchemeEntrySerializer(serializers.ModelSerializer):
    """Read shape (also used by GET /scheme-entries/{id}/ for lesson-plan prefill)."""

    topic_name = serializers.CharField(source="topic.name", read_only=True, default=None)
    scheme_id = serializers.IntegerField(source="scheme.id", read_only=True)
    allocation_id = serializers.IntegerField(source="scheme.allocation_id", read_only=True)
    term_id = serializers.IntegerField(source="scheme.term_id", read_only=True)
    subject_name = serializers.CharField(source="scheme.allocation.subject.name", read_only=True)
    classroom_label = serializers.CharField(source="scheme.allocation.classroom.__str__", read_only=True)
    lesson_plan_count = serializers.IntegerField(read_only=True, default=0)
    coverage_percent = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = models.SchemeEntry
        fields = "__all__"


class SchemeEntryInputSerializer(serializers.ModelSerializer):
    """Write shape for the spreadsheet-style editor (id present = update, absent = create)."""

    id = serializers.IntegerField(required=False)

    class Meta:
        model = models.SchemeEntry
        exclude = ["scheme"]

    def validate(self, attrs):
        topic = attrs.get("topic")
        if not (topic or attrs.get("topic_text", "").strip()):
            raise serializers.ValidationError("Each row needs a topic (pick one or type it).")
        return attrs


class SchemeSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.get_full_name", read_only=True)
    subject_id = serializers.IntegerField(source="allocation.subject_id", read_only=True)
    subject_name = serializers.CharField(source="allocation.subject.name", read_only=True)
    classroom_id = serializers.IntegerField(source="allocation.classroom_id", read_only=True)
    classroom_label = serializers.CharField(source="allocation.classroom.__str__", read_only=True)
    grade_level_id = serializers.IntegerField(source="allocation.classroom.grade_level_id", read_only=True)
    term_label = serializers.CharField(source="term.__str__", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.get_full_name", read_only=True, default=None)
    entry_count = serializers.SerializerMethodField()
    entries = serializers.SerializerMethodField()

    class Meta:
        model = models.SchemeOfWork
        fields = "__all__"
        read_only_fields = ["teacher", "status", "submitted_at", "reviewed_by", "reviewed_at", "review_remarks"]

    def get_entry_count(self, obj):
        return obj.entries.count()

    def get_entries(self, obj):
        if not self.context.get("with_entries"):
            return None
        qs = (
            obj.entries.select_related("topic", "scheme__allocation__subject", "scheme__allocation__classroom")
            .annotate(
                lesson_plan_count=Count("lesson_plans", distinct=True),
                coverage_percent=Max("lesson_plans__coverage__coverage_percentage"),
            )
            .order_by("week_number", "lesson_number")
        )
        return SchemeEntrySerializer(qs, many=True).data

    def validate(self, attrs):
        if self.instance:  # allocation/term are fixed once the scheme exists
            attrs.pop("allocation", None)
            attrs.pop("term", None)
            return attrs

        allocation, term = attrs["allocation"], attrs["term"]
        _check_allocation_owner(self.context.get("request"), allocation)
        if term.academic_year_id != allocation.academic_year_id:
            raise serializers.ValidationError({"term": "This term is not in the allocation's academic year."})
        if models.SchemeOfWork.objects.filter(allocation=allocation, term=term).exists():
            raise serializers.ValidationError("A scheme of work already exists for this class and subject this term.")
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        validated_data["teacher"] = validated_data["allocation"].teacher if request.user.role in REVIEWER_ROLES else request.user
        if not validated_data.get("title"):
            a = validated_data["allocation"]
            validated_data["title"] = f"{a.subject.name} - {a.classroom} - {validated_data['term']}"
        return super().create(validated_data)


# ---------------------------------------------------------------------------
# LESSON PLANS
# ---------------------------------------------------------------------------
class LessonCoverageSerializer(serializers.ModelSerializer):
    class Meta:
        model = models.LessonCoverage
        exclude = ["lesson_plan"]
        read_only_fields = ["recorded_at"]

    def validate(self, attrs):
        if attrs.get("completed") and attrs.get("coverage_percentage", 100) < 100:
            attrs["coverage_percentage"] = 100  # "completed" always means fully covered
        return attrs


class LessonPlanSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(source="teacher.get_full_name", read_only=True)
    subject_id = serializers.IntegerField(source="allocation.subject_id", read_only=True)
    subject_name = serializers.CharField(source="allocation.subject.name", read_only=True)
    classroom_label = serializers.CharField(source="allocation.classroom.__str__", read_only=True)
    term_label = serializers.CharField(source="term.__str__", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.get_full_name", read_only=True, default=None)
    coverage = LessonCoverageSerializer(read_only=True, allow_null=True)
    term = serializers.PrimaryKeyRelatedField(queryset=api_models.Term.objects.all(), required=False)

    class Meta:
        model = models.LessonPlan
        fields = "__all__"
        read_only_fields = [
            "teacher", "status", "submitted_at", "reviewed_by", "reviewed_at", "review_remarks", "week_number",
        ]

    def validate(self, attrs):
        request = self.context.get("request")

        if self.instance:  # allocation/term don't change after creation
            attrs.pop("allocation", None)
            attrs.pop("term", None)
            return attrs

        allocation = attrs["allocation"]
        _check_allocation_owner(request, allocation)

        on_date = attrs.get("date") or timezone.localdate()
        term = attrs.get("term")
        entry = attrs.get("scheme_entry")
        if entry:
            if entry.scheme.allocation_id != allocation.id:
                raise serializers.ValidationError({"scheme_entry": "This scheme row belongs to a different class/subject."})
            term = term or entry.scheme.term
        term = term or services.term_for_date(allocation.academic_year, on_date)
        if not term:
            raise serializers.ValidationError({"date": "No term covers this date for the allocation's academic year."})
        if term.academic_year_id != allocation.academic_year_id:
            raise serializers.ValidationError({"term": "This term is not in the allocation's academic year."})

        slot = attrs.get("timetable_entry")
        if slot and slot.allocation_id != allocation.id:
            raise serializers.ValidationError({"timetable_entry": "This timetable slot belongs to a different allocation."})

        attrs["term"] = term
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        allocation = validated_data["allocation"]
        validated_data["teacher"] = allocation.teacher if request.user.role in REVIEWER_ROLES else request.user
        validated_data["week_number"] = services.week_for(
            validated_data["term"], validated_data.get("date") or timezone.localdate()
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        plan = super().update(instance, validated_data)
        if "date" in validated_data:
            plan.week_number = services.week_for(plan.term, plan.date)
            plan.save(update_fields=["week_number"])
        return plan


class ReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["APPROVE", "REJECT", "REVISION"])
    remarks = serializers.CharField(required=False, allow_blank=True)