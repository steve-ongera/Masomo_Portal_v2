from django.db import transaction
from rest_framework import serializers

from . import models


class MealPlanItemSerializer(serializers.ModelSerializer):
    meal_label = serializers.CharField(source="get_meal_type_display", read_only=True)

    class Meta:
        model = models.MealPlanItem
        fields = ["id", "meal_type", "meal_label", "price"]


class MealPlanSerializer(serializers.ModelSerializer):
    items = MealPlanItemSerializer(many=True)
    billing_display = serializers.CharField(source="get_billing_mode_display", read_only=True)

    class Meta:
        model = models.MealPlan
        fields = ["id", "name", "code", "description", "billing_mode", "billing_display", "is_active", "items"]

    def validate_items(self, value):
        types = [i["meal_type"] for i in value]
        if len(types) != len(set(types)):
            raise serializers.ValidationError("Each meal can only appear once in a plan.")
        if not value:
            raise serializers.ValidationError("A plan needs at least one meal.")
        return value

    def _set_items(self, plan, items):
        plan.items.all().delete()
        models.MealPlanItem.objects.bulk_create([models.MealPlanItem(plan=plan, **i) for i in items])

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        plan = super().create(validated_data)
        self._set_items(plan, items)
        return plan

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        plan = super().update(instance, validated_data)
        if items is not None:
            self._set_items(plan, items)
        return plan


class StudentMealPlanSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.user.get_full_name", read_only=True)
    admission_no = serializers.CharField(source="student.admission_no", read_only=True)
    plan_name = serializers.CharField(source="plan.name", read_only=True)
    academic_year_label = serializers.IntegerField(source="academic_year.year", read_only=True)

    class Meta:
        model = models.StudentMealPlan
        fields = [
            "id", "student", "student_name", "admission_no", "plan", "plan_name",
            "academic_year", "academic_year_label", "is_active",
        ]


class BulkAssignPlanSerializer(serializers.Serializer):
    """Assign one plan to a whole classroom or grade for a year."""

    plan_id = serializers.PrimaryKeyRelatedField(queryset=models.MealPlan.objects.filter(is_active=True))
    academic_year_id = serializers.IntegerField()
    classroom_id = serializers.IntegerField(required=False)
    grade_level_id = serializers.IntegerField(required=False)

    def validate(self, attrs):
        if not attrs.get("classroom_id") and not attrs.get("grade_level_id"):
            raise serializers.ValidationError("Provide classroom_id or grade_level_id.")
        return attrs


class MealCardSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.user.get_full_name", read_only=True)
    admission_no = serializers.CharField(source="student.admission_no", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = models.MealCard
        fields = [
            "id", "student", "student_name", "admission_no", "card_number",
            "status", "status_display", "issued_at", "expires_at",
        ]  # qr_token is deliberately NOT exposed in lists


class MealCollectionSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.user.get_full_name", read_only=True)
    admission_no = serializers.CharField(source="student.admission_no", read_only=True)
    meal_label = serializers.CharField(source="get_meal_type_display", read_only=True)
    collected_by_name = serializers.CharField(source="collected_by.get_full_name", read_only=True, default=None)

    class Meta:
        model = models.MealCollection
        fields = [
            "id", "student", "student_name", "admission_no", "meal_type", "meal_label",
            "date", "collected_at", "collected_by_name", "amount_charged", "source",
        ]


class WalletTransactionSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = models.MealWalletTransaction
        fields = ["id", "kind", "kind_display", "amount", "balance_after", "meal_type", "reference", "created_at"]


class CafeteriaAttendantSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.get_full_name", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = models.CafeteriaAttendant
        fields = ["id", "user", "user_name", "username", "is_active"]


class ScanSerializer(serializers.Serializer):
    qr_token = serializers.CharField(max_length=64)
    meal_type = serializers.ChoiceField(choices=models.MealType.choices)


class SyncSerializer(serializers.Serializer):
    scans = serializers.ListField(child=serializers.DictField(), allow_empty=False, max_length=2000)


class WalletTopUpSerializer(serializers.Serializer):
    admission_no = serializers.CharField(max_length=30)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=1)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=80)
    
    
class WalletPaySerializer(serializers.Serializer):
    amount = serializers.IntegerField(min_value=1, max_value=70000)  # whole shillings, M-Pesa's STK limit
    phone = serializers.CharField(max_length=20)