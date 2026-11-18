from rest_framework import serializers

from api import models as api_models

from .models import AttendanceRecord, AttendanceSession


class SheetQuerySerializer(serializers.Serializer):
    classroom = serializers.PrimaryKeyRelatedField(queryset=api_models.ClassRoom.objects.select_related("grade_level", "stream", "academic_year"))
    date = serializers.DateField()
    session_type = serializers.ChoiceField(choices=AttendanceSession.SessionType.choices, default="DAILY")
    subject = serializers.PrimaryKeyRelatedField(queryset=api_models.Subject.objects.all(), required=False, allow_null=True)
    period_slot = serializers.PrimaryKeyRelatedField(queryset=api_models.PeriodSlot.objects.all(), required=False, allow_null=True)


class RecordRowSerializer(serializers.Serializer):
    enrollment_id = serializers.IntegerField()
    status = serializers.ChoiceField(choices=AttendanceRecord.Status.choices)
    absence_reason = serializers.CharField(required=False, allow_blank=True, max_length=20)
    check_in_time = serializers.TimeField(required=False, allow_null=True)
    remarks = serializers.CharField(required=False, allow_blank=True, max_length=255)

    def validate_check_in_time(self, value):
        return value


class SaveSheetSerializer(SheetQuerySerializer):
    records = RecordRowSerializer(many=True)
    notify_guardians = serializers.BooleanField(default=False)
