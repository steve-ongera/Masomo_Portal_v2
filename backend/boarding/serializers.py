from rest_framework import serializers

from . import services
from .models import (
    Bed, BedAllocation, BoardingFeeBilling, BoardingFeeRate, BoardingRegistration, BoardingSettings,
    Dormitory, ExeatRequest, Room, RollCallEntry, RollCallSession, WardenAssignment,
)


def _user_name(user):
    if not user:
        return None
    return user.get_full_name() or user.username


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------
class BoardingSettingsSerializer(serializers.ModelSerializer):
    boarding_grade_names = serializers.SerializerMethodField()

    class Meta:
        model = BoardingSettings
        fields = ["id", "boarding_grades", "boarding_grade_names", "principal_approval_types", "exeat_max_days"]

    def get_boarding_grade_names(self, obj):
        return [g.name for g in obj.boarding_grades.all()]

    def validate_principal_approval_types(self, value):
        bad = [v for v in value if v not in ExeatRequest.Type.values]
        if bad:
            raise serializers.ValidationError(f"Unknown exeat type(s): {', '.join(map(str, bad))}")
        return value

    def validate_exeat_max_days(self, value):
        if not 1 <= value <= 90:
            raise serializers.ValidationError("Choose between 1 and 90 days.")
        return value


# ---------------------------------------------------------------------------
# structure
# ---------------------------------------------------------------------------
class DormitorySerializer(serializers.ModelSerializer):
    gender_display = serializers.CharField(source="get_gender_display", read_only=True)
    wardens = serializers.SerializerMethodField()
    room_count = serializers.SerializerMethodField()
    bed_count = serializers.SerializerMethodField()
    occupied_count = serializers.SerializerMethodField()
    vacant_count = serializers.SerializerMethodField()

    class Meta:
        model = Dormitory
        fields = [
            "id", "name", "gender", "gender_display", "description", "is_active", "wardens",
            "room_count", "bed_count", "occupied_count", "vacant_count",
        ]

    def _counts(self, obj):
        cache = self.context.setdefault("_counts", {})
        if obj.pk not in cache:
            cache[obj.pk] = services.dormitory_counts(obj)
        return cache[obj.pk]

    def get_wardens(self, obj):
        return [
            {"id": str(a.user_id), "name": _user_name(a.user)}
            for a in obj.warden_assignments.all()
        ]

    def get_room_count(self, obj):
        return self._counts(obj)["room_count"]

    def get_bed_count(self, obj):
        return self._counts(obj)["bed_count"]

    def get_occupied_count(self, obj):
        return self._counts(obj)["occupied_count"]

    def get_vacant_count(self, obj):
        return self._counts(obj)["vacant_count"]

    def validate_gender(self, value):
        # a hostel's gender cannot change once students have slept in it
        if self.instance and self.instance.gender != value:
            if BedAllocation.objects.filter(bed__room__dormitory=self.instance).exists():
                raise serializers.ValidationError("This hostel already has bed history; its gender cannot change.")
        return value


class RoomSerializer(serializers.ModelSerializer):
    dormitory_name = serializers.CharField(source="dormitory.name", read_only=True)
    bed_count = serializers.SerializerMethodField()
    occupied_count = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = ["id", "dormitory", "dormitory_name", "number", "floor", "is_active", "bed_count", "occupied_count"]

    def get_bed_count(self, obj):
        return obj.beds.count()

    def get_occupied_count(self, obj):
        return BedAllocation.objects.filter(bed__room=obj, released_at__isnull=True).count()


class BedSerializer(serializers.ModelSerializer):
    label = serializers.CharField(read_only=True)
    room_number = serializers.CharField(source="room.number", read_only=True)
    dormitory = serializers.IntegerField(source="room.dormitory_id", read_only=True)
    dormitory_name = serializers.CharField(source="room.dormitory.name", read_only=True)
    dormitory_gender = serializers.CharField(source="room.dormitory.gender", read_only=True)
    occupant = serializers.SerializerMethodField()

    class Meta:
        model = Bed
        fields = [
            "id", "room", "room_number", "dormitory", "dormitory_name", "dormitory_gender",
            "number", "label", "is_active", "notes", "occupant",
        ]

    def get_occupant(self, obj):
        allocs = getattr(obj, "current_allocs", None)
        if allocs is None:
            allocs = list(
                BedAllocation.objects.filter(bed=obj, released_at__isnull=True)
                .select_related("registration__student__user")
            )
        if not allocs:
            return None
        a = allocs[0]
        s = a.registration.student
        return {
            "allocation": a.pk, "registration": a.registration_id, "student": s.pk,
            "admission_no": s.admission_no, "student_name": services.student_name(s),
            "grade_name": a.registration.grade_name, "since": a.allocated_from,
        }


class WardenAssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = WardenAssignment
        fields = ["id", "user", "user_name", "dormitory"]

    def get_user_name(self, obj):
        return _user_name(obj.user)


# ---------------------------------------------------------------------------
# registration & allocation
# ---------------------------------------------------------------------------
class RegistrationSerializer(serializers.ModelSerializer):
    admission_no = serializers.CharField(source="student.admission_no", read_only=True)
    student_name = serializers.SerializerMethodField()
    gender = serializers.CharField(source="student.gender", read_only=True)
    year = serializers.IntegerField(source="academic_year.year", read_only=True)
    current_bed = serializers.SerializerMethodField()

    class Meta:
        model = BoardingRegistration
        fields = [
            "id", "student", "admission_no", "student_name", "gender", "academic_year", "year",
            "grade_name", "class_name", "status", "registered_at", "withdrawn_at", "withdrawn_reason",
            "current_bed",
        ]
        read_only_fields = fields

    def get_student_name(self, obj):
        return services.student_name(obj.student)

    def get_current_bed(self, obj):
        allocs = getattr(obj, "current_allocs", None)
        if allocs is None:
            a = services.current_allocation(obj)
            allocs = [a] if a else []
        if not allocs:
            return None
        a = allocs[0]
        return {"allocation": a.pk, "bed": a.bed_id, "label": a.bed_label, "since": a.allocated_from}


class AllocationSerializer(serializers.ModelSerializer):
    student = serializers.IntegerField(source="registration.student_id", read_only=True)
    admission_no = serializers.CharField(source="registration.student.admission_no", read_only=True)
    student_name = serializers.SerializerMethodField()
    gender = serializers.CharField(source="registration.student.gender", read_only=True)
    academic_year = serializers.IntegerField(source="registration.academic_year_id", read_only=True)
    year = serializers.IntegerField(source="registration.academic_year.year", read_only=True)
    grade_name = serializers.CharField(source="registration.grade_name", read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    release_reason_display = serializers.CharField(source="get_release_reason_display", read_only=True)
    allocated_by_name = serializers.SerializerMethodField()
    released_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BedAllocation
        fields = [
            "id", "registration", "student", "admission_no", "student_name", "gender", "academic_year", "year",
            "grade_name", "bed", "bed_label", "allocated_from", "released_at", "release_reason",
            "release_reason_display", "is_current", "carried_over", "notes", "allocated_by_name", "released_by_name",
        ]
        read_only_fields = fields

    def get_student_name(self, obj):
        return services.student_name(obj.registration.student)

    def get_allocated_by_name(self, obj):
        return _user_name(obj.allocated_by)

    def get_released_by_name(self, obj):
        return _user_name(obj.released_by)


# ---------------------------------------------------------------------------
# exeat
# ---------------------------------------------------------------------------
class ExeatSerializer(serializers.ModelSerializer):
    registration_id = serializers.IntegerField(source="registration.pk", read_only=True)
    student = serializers.IntegerField(source="registration.student_id", read_only=True)
    admission_no = serializers.CharField(source="registration.student.admission_no", read_only=True)
    student_name = serializers.SerializerMethodField()
    grade_name = serializers.CharField(source="registration.grade_name", read_only=True)
    exeat_type_display = serializers.CharField(source="get_exeat_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    returned_late = serializers.BooleanField(read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    decided_by_name = serializers.SerializerMethodField()
    checked_out_by_name = serializers.SerializerMethodField()
    checked_in_by_name = serializers.SerializerMethodField()
    bed_label = serializers.SerializerMethodField()
    needs_principal = serializers.SerializerMethodField()

    class Meta:
        model = ExeatRequest
        fields = [
            "id", "slip_no", "registration_id", "student", "admission_no", "student_name", "grade_name", "bed_label",
            "exeat_type", "exeat_type_display", "reason", "destination", "contact_name", "contact_phone",
            "expected_departure", "expected_return", "status", "status_display", "source", "needs_principal",
            "requested_by_name", "created_at", "decided_by_name", "decided_at", "decision_note",
            "checked_out_at", "checked_out_by_name", "collected_by_name", "collected_by_id_no",
            "collected_by_relationship", "checked_in_at", "checked_in_by_name", "return_note",
            "is_overdue", "returned_late",
        ]
        read_only_fields = fields

    def get_student_name(self, obj):
        return services.student_name(obj.registration.student)

    def get_requested_by_name(self, obj):
        return _user_name(obj.requested_by)

    def get_decided_by_name(self, obj):
        return _user_name(obj.decided_by)

    def get_checked_out_by_name(self, obj):
        return _user_name(obj.checked_out_by)

    def get_checked_in_by_name(self, obj):
        return _user_name(obj.checked_in_by)

    def get_bed_label(self, obj):
        a = services.current_allocation(obj.registration)
        return a.bed_label if a else None

    def get_needs_principal(self, obj):
        cfg = self.context.get("_cfg")
        if cfg is None:
            cfg = self.context["_cfg"] = services.get_settings()
        return obj.exeat_type in (cfg.principal_approval_types or [])


class ExeatCreateSerializer(serializers.Serializer):
    registration = serializers.PrimaryKeyRelatedField(
        queryset=BoardingRegistration.objects.all(), required=False
    )
    student = serializers.IntegerField(required=False)
    exeat_type = serializers.ChoiceField(choices=ExeatRequest.Type.choices, default=ExeatRequest.Type.EXEAT)
    reason = serializers.CharField(max_length=1000)
    destination = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    contact_name = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    contact_phone = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    expected_departure = serializers.DateTimeField()
    expected_return = serializers.DateTimeField()
    approve_now = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if not attrs.get("registration") and not attrs.get("student"):
            raise serializers.ValidationError("Choose the student (registration or student).")
        return attrs


class ExeatCheckOutSerializer(serializers.Serializer):
    collected_by_name = serializers.CharField(max_length=120)
    collected_by_id_no = serializers.CharField(max_length=30, required=False, allow_blank=True, default="")
    collected_by_relationship = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")


# ---------------------------------------------------------------------------
# roll call
# ---------------------------------------------------------------------------
class RollCallEntrySerializer(serializers.ModelSerializer):
    admission_no = serializers.CharField(source="registration.student.admission_no", read_only=True)
    student_name = serializers.SerializerMethodField()

    class Meta:
        model = RollCallEntry
        fields = ["id", "registration", "admission_no", "student_name", "bed_label", "status", "remarks"]
        read_only_fields = fields

    def get_student_name(self, obj):
        return services.student_name(obj.registration.student)


class RollCallSessionSerializer(serializers.ModelSerializer):
    dormitory_name = serializers.CharField(source="dormitory.name", read_only=True)
    session_type_display = serializers.CharField(source="get_session_type_display", read_only=True)
    taken_by_name = serializers.SerializerMethodField()
    counts = serializers.SerializerMethodField()

    class Meta:
        model = RollCallSession
        fields = [
            "id", "dormitory", "dormitory_name", "date", "session_type", "session_type_display", "status",
            "taken_by_name", "submitted_at", "notes", "counts",
        ]
        read_only_fields = fields

    def get_taken_by_name(self, obj):
        return _user_name(obj.taken_by)

    def get_counts(self, obj):
        out = {s: 0 for s in RollCallEntry.Status.values}
        for e in obj.entries.all():
            out[e.status] = out.get(e.status, 0) + 1
        out["total"] = sum(out.values())
        return out


class RollCallDetailSerializer(RollCallSessionSerializer):
    entries = RollCallEntrySerializer(many=True, read_only=True)

    class Meta(RollCallSessionSerializer.Meta):
        fields = RollCallSessionSerializer.Meta.fields + ["entries"]
        read_only_fields = fields


# ---------------------------------------------------------------------------
# fees
# ---------------------------------------------------------------------------
class BoardingFeeRateSerializer(serializers.ModelSerializer):
    term_label = serializers.CharField(source="term.__str__", read_only=True)
    grade_name = serializers.SerializerMethodField()

    class Meta:
        model = BoardingFeeRate
        fields = ["id", "term", "term_label", "grade_level", "grade_name", "amount"]
        validators = []  # uniqueness is enforced by the DB constraints; checked below

    def get_grade_name(self, obj):
        return obj.grade_level.name if obj.grade_level_id else "All grades"

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value

    def validate(self, attrs):
        term = attrs.get("term", getattr(self.instance, "term", None))
        grade = attrs.get("grade_level", getattr(self.instance, "grade_level", None))
        dupes = BoardingFeeRate.objects.filter(term=term, grade_level=grade)
        if self.instance:
            dupes = dupes.exclude(pk=self.instance.pk)
        if dupes.exists():
            raise serializers.ValidationError("A rate for this term and grade already exists.")
        return attrs


class BoardingFeeBillingSerializer(serializers.ModelSerializer):
    admission_no = serializers.CharField(source="registration.student.admission_no", read_only=True)
    student_name = serializers.SerializerMethodField()
    term_label = serializers.CharField(source="term.__str__", read_only=True)
    charge_status = serializers.SerializerMethodField()

    class Meta:
        model = BoardingFeeBilling
        fields = ["id", "registration", "admission_no", "student_name", "term", "term_label", "amount",
                  "charge", "charge_status", "billed_at"]
        read_only_fields = fields

    def get_student_name(self, obj):
        return services.student_name(obj.registration.student)

    def get_charge_status(self, obj):
        return obj.charge.status if obj.charge_id else None