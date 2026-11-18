from decimal import Decimal

from rest_framework import serializers

from api import models as core

from . import models


class FundingSourceSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_source_type_display", read_only=True)

    class Meta:
        model = models.FundingSource
        fields = "__all__"


class AidSchemeSerializer(serializers.ModelSerializer):
    source_name = serializers.CharField(source="source.name", read_only=True, default=None)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    rule_display = serializers.CharField(source="get_rule_display", read_only=True)
    settlement_display = serializers.CharField(source="get_settlement_display", read_only=True)
    grade_levels = serializers.PrimaryKeyRelatedField(
        queryset=core.GradeLevel.objects.all(), many=True, required=False
    )

    class Meta:
        model = models.AidScheme
        fields = "__all__"

    def validate_code(self, value):
        return value.strip().upper()

    def validate_sibling_tiers(self, value):
        for t in value or []:
            try:
                rank, pct = int(t["rank"]), Decimal(str(t["percent"]))
            except Exception:
                raise serializers.ValidationError("Each tier needs a rank and a percent.")
            if rank < 2 or not (0 < pct <= 100):
                raise serializers.ValidationError("Tiers start at rank 2 and need a percent between 0 and 100.")
        return value

    def validate(self, attrs):
        def get(k, default=None):
            return attrs.get(k, getattr(self.instance, k, default))

        source, settlement, rule = get("source"), get("settlement"), get("rule")
        vt, value = get("value_type"), get("value") or Decimal("0")
        if settlement == models.AidScheme.Settlement.FUNDER_REMITS and not source:
            raise serializers.ValidationError("A scheme paid by a funder needs a funding source.")
        if rule != models.AidScheme.Rule.MANUAL and settlement == models.AidScheme.Settlement.FUNDER_REMITS:
            raise serializers.ValidationError("Sibling and staff-child discounts are paid by the school, not a funder.")
        if rule == models.AidScheme.Rule.SIBLING and not get("sibling_tiers"):
            raise serializers.ValidationError("Add at least one sibling tier, for example rank 2 gets 5%.")
        if rule != models.AidScheme.Rule.SIBLING and value <= 0:
            raise serializers.ValidationError("Enter the value of this scheme.")
        if vt == models.ValueType.PERCENT and value > 100:
            raise serializers.ValidationError("A percentage cannot be more than 100.")
        return attrs


class AwardTermSerializer(serializers.ModelSerializer):
    term_label = serializers.CharField(source="term.__str__", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    settlement_display = serializers.CharField(source="get_settlement_display", read_only=True)
    outstanding = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    student_name = serializers.CharField(source="award.student.user.get_full_name", read_only=True)
    admission_no = serializers.CharField(source="award.student.admission_no", read_only=True)
    scheme_name = serializers.CharField(source="award.scheme.name", read_only=True)

    class Meta:
        model = models.AwardTerm
        fields = [
            "id", "award", "term", "term_label", "gross_fee", "amount", "received", "outstanding",
            "settlement", "settlement_display", "status", "status_display", "note",
            "student_name", "admission_no", "scheme_name",
        ]


class AwardSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.user.get_full_name", read_only=True)
    admission_no = serializers.CharField(source="student.admission_no", read_only=True)
    classroom = serializers.SerializerMethodField()
    scheme_name = serializers.CharField(source="scheme.name", read_only=True)
    scheme_kind = serializers.CharField(source="scheme.kind", read_only=True)
    scheme_rule = serializers.CharField(source="scheme.rule", read_only=True)
    settlement = serializers.CharField(source="scheme.settlement", read_only=True)
    source_name = serializers.CharField(source="scheme.source.name", read_only=True, default=None)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    start_term_label = serializers.CharField(source="start_term.__str__", read_only=True)
    end_term_label = serializers.CharField(source="end_term.__str__", read_only=True, default=None)
    requested_by_name = serializers.CharField(source="requested_by.get_full_name", read_only=True, default=None)
    decided_by_name = serializers.CharField(source="decided_by.get_full_name", read_only=True, default=None)
    staff_parent_name = serializers.CharField(source="staff_parent.get_full_name", read_only=True, default=None)
    total_waived = serializers.SerializerMethodField()
    total_pledged = serializers.SerializerMethodField()
    total_received = serializers.SerializerMethodField()

    class Meta:
        model = models.Award
        fields = [
            "id", "student", "student_name", "admission_no", "classroom",
            "scheme", "scheme_name", "scheme_kind", "scheme_rule", "settlement", "source_name",
            "value_type", "value", "start_term", "start_term_label", "end_term", "end_term_label",
            "status", "status_display", "reference_no", "sibling_rank", "staff_parent_name", "notes",
            "decision_note", "requested_by_name", "requested_at", "decided_by_name", "decided_at",
            "total_waived", "total_pledged", "total_received",
        ]

    def get_classroom(self, obj):
        e = obj.student.current_enrollment
        return str(e.classroom) if e else "-"

    def _active(self, obj):
        return [t for t in obj.terms.all() if t.status == models.AwardTerm.Status.ACTIVE]

    def get_total_waived(self, obj):
        return float(sum(t.amount for t in self._active(obj) if t.settlement == models.AidScheme.Settlement.WAIVER))

    def get_total_pledged(self, obj):
        return float(sum(t.amount for t in self._active(obj) if t.settlement == models.AidScheme.Settlement.FUNDER_REMITS))

    def get_total_received(self, obj):
        return float(sum(t.received for t in self._active(obj)))


class AwardCreateSerializer(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=core.StudentProfile.objects.all())
    scheme = serializers.PrimaryKeyRelatedField(queryset=models.AidScheme.objects.all())
    start_term = serializers.PrimaryKeyRelatedField(queryset=core.Term.objects.all())
    end_term = serializers.PrimaryKeyRelatedField(queryset=core.Term.objects.all(), required=False, allow_null=True)
    value_type = serializers.ChoiceField(choices=models.ValueType.choices, required=False)
    value = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    reference_no = serializers.CharField(required=False, allow_blank=True, max_length=60)
    notes = serializers.CharField(required=False, allow_blank=True)
    staff_parent = serializers.PrimaryKeyRelatedField(queryset=core.User.objects.all(), required=False, allow_null=True)


class RemittanceAllocationSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="award_term.award.student.user.get_full_name", read_only=True)
    admission_no = serializers.CharField(source="award_term.award.student.admission_no", read_only=True)
    term_label = serializers.CharField(source="award_term.term.__str__", read_only=True)

    class Meta:
        model = models.RemittanceAllocation
        fields = [
            "id", "award_term", "student_name", "admission_no", "term_label", "amount", "receipt_no",
            "created_at", "reversed", "reversed_at", "reverse_reason",
        ]


class RemittanceSerializer(serializers.ModelSerializer):
    source_name = serializers.CharField(source="source.name", read_only=True)
    method_display = serializers.CharField(source="get_method_display", read_only=True)
    allocated = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    unallocated = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = models.FundingRemittance
        fields = [
            "id", "source", "source_name", "amount", "method", "method_display", "reference", "received_on",
            "notes", "allocated", "unallocated", "recorded_by_name", "created_at",
        ]
        read_only_fields = ["recorded_by_name", "created_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("The amount must be greater than zero.")
        return value

    def validate_reference(self, value):
        return value.strip()


class AllocateRowSerializer(serializers.Serializer):
    award_term = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))


class AllocateSerializer(serializers.Serializer):
    rows = AllocateRowSerializer(many=True, allow_empty=False)