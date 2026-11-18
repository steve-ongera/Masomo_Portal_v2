import os

from django.utils import timezone
from rest_framework import serializers

from api import models as api_models
from api import utils

from . import models, services

ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".txt", ".jpg", ".jpeg", ".png"}
MAX_FILE_BYTES = 15 * 1024 * 1024  # 15 MB


# ---------------------------------------------------------------------------
# TEACHER
# ---------------------------------------------------------------------------
class MaterialListSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    term_label = serializers.SerializerMethodField()
    classroom_ids = serializers.SerializerMethodField()
    classrooms_info = serializers.SerializerMethodField()
    has_file = serializers.SerializerMethodField()
    recipients_count = serializers.SerializerMethodField()
    viewed_count = serializers.SerializerMethodField()
    downloaded_count = serializers.SerializerMethodField()

    class Meta:
        model = models.Material
        fields = [
            "id", "kind", "kind_display", "title", "subject", "subject_name", "term", "term_label",
            "classroom_ids", "classrooms_info", "due_date", "is_published", "published_at",
            "has_file", "original_filename", "file_size", "created_at", "updated_at",
            "recipients_count", "viewed_count", "downloaded_count",
        ]

    def get_term_label(self, obj):
        return str(obj.term) if obj.term else None

    def get_classroom_ids(self, obj):
        return [c.id for c in obj.classrooms.all()]

    def get_classrooms_info(self, obj):
        return [{"id": c.id, "label": str(c)} for c in obj.classrooms.all()]

    def get_has_file(self, obj):
        return bool(obj.file)

    def get_recipients_count(self, obj):
        return len(services.recipient_enrollments(obj))

    def get_viewed_count(self, obj):
        value = getattr(obj, "viewed_count", None)
        return value if value is not None else obj.accesses.filter(first_viewed_at__isnull=False).count()

    def get_downloaded_count(self, obj):
        value = getattr(obj, "downloaded_count", None)
        return value if value is not None else obj.accesses.filter(download_count__gt=0).count()


class MaterialDetailSerializer(MaterialListSerializer):
    class Meta(MaterialListSerializer.Meta):
        fields = MaterialListSerializer.Meta.fields + ["description", "body"]


class MaterialWriteSerializer(serializers.ModelSerializer):
    classrooms = serializers.PrimaryKeyRelatedField(many=True, queryset=api_models.ClassRoom.objects.all())
    remove_file = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = models.Material
        fields = [
            "kind", "title", "description", "body", "file", "subject", "classrooms",
            "term", "due_date", "is_published", "remove_file",
        ]
        extra_kwargs = {"file": {"required": False, "allow_null": True}}

    def validate_file(self, f):
        if not f:
            return f
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise serializers.ValidationError(
                f"File type not allowed. Use one of: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
            )
        if f.size > MAX_FILE_BYTES:
            raise serializers.ValidationError("File is too large (maximum 15 MB).")
        return f

    def validate(self, attrs):
        user = self.context["request"].user
        instance = self.instance

        subject = attrs.get("subject", instance.subject if instance else None)
        classrooms = attrs.get("classrooms", list(instance.classrooms.all()) if instance else [])
        if not classrooms:
            raise serializers.ValidationError({"classrooms": "Pick at least one class."})

        # a teacher can only send to (subject, class) pairs they are allocated
        if user.role == api_models.User.Role.TEACHER:
            allowed = set(
                utils.teacher_allocated_classrooms(user).filter(subject=subject)
                .values_list("classroom_id", flat=True)
            )
            bad = [str(c) for c in classrooms if c.id not in allowed]
            if bad:
                raise serializers.ValidationError(
                    {"classrooms": f"You are not allocated {subject.name} in: {', '.join(bad)}."}
                )

        body = attrs.get("body", instance.body if instance else "")
        new_file = attrs.get("file")
        remove = attrs.get("remove_file", False)
        has_file = bool(new_file) or bool(instance and instance.file and not remove)
        if not (body or "").strip() and not has_file:
            raise serializers.ValidationError("Add some text, upload a file, or both.")
        return attrs

    @staticmethod
    def _file_meta(data):
        f = data.get("file")
        if f:
            data["original_filename"] = os.path.basename(f.name)[:255]
            data["file_size"] = f.size

    def create(self, validated_data):
        validated_data.pop("remove_file", None)
        self._file_meta(validated_data)
        validated_data["academic_year"] = validated_data["classrooms"][0].academic_year
        if not validated_data.get("term"):
            validated_data["term"] = utils.get_current_term()
        if validated_data.get("is_published"):
            validated_data["published_at"] = timezone.now()
        return super().create(validated_data)

    def update(self, instance, validated_data):
        remove = validated_data.pop("remove_file", False)
        old_name = instance.file.name if instance.file else None
        replaced = bool(validated_data.get("file"))
        if remove and not replaced:
            validated_data["file"] = ""
            validated_data["original_filename"] = ""
            validated_data["file_size"] = 0
        self._file_meta(validated_data)
        if validated_data.get("is_published") and not instance.published_at:
            validated_data["published_at"] = timezone.now()
        instance = super().update(instance, validated_data)
        if old_name and (remove or replaced):
            instance.file.storage.delete(old_name)
        return instance


# ---------------------------------------------------------------------------
# STUDENT
# ---------------------------------------------------------------------------
class StudentMaterialListSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    has_file = serializers.SerializerMethodField()
    has_text = serializers.SerializerMethodField()
    is_new = serializers.SerializerMethodField()
    downloaded = serializers.SerializerMethodField()

    class Meta:
        model = models.Material
        fields = [
            "id", "kind", "kind_display", "title", "description", "subject", "subject_name",
            "teacher_name", "due_date", "published_at", "has_file", "has_text",
            "original_filename", "file_size", "is_new", "downloaded",
        ]

    def _access(self, obj):
        return self.context.get("access_map", {}).get(obj.id)

    def get_teacher_name(self, obj):
        return obj.teacher.get_full_name() or obj.teacher.username

    def get_has_file(self, obj):
        return bool(obj.file)

    def get_has_text(self, obj):
        return bool((obj.body or "").strip())

    def get_is_new(self, obj):
        a = self._access(obj)
        return not (a and a.first_viewed_at)

    def get_downloaded(self, obj):
        a = self._access(obj)
        return bool(a and a.download_count)


class StudentMaterialDetailSerializer(StudentMaterialListSerializer):
    class Meta(StudentMaterialListSerializer.Meta):
        fields = StudentMaterialListSerializer.Meta.fields + ["body"]