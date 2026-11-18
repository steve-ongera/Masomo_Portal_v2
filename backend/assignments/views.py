"""
Views for the assignments module. Thin: parse request, call services, return Response.

TEACHER  /assignments/teacher/...   create / edit / publish / track their own materials
STUDENT  /assignments/student/...   list, open and download what was sent to their class
"""
import mimetypes
import os

from django.db.models import Count, Q
from django.http import FileResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, generics, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from api import models as api_models
from api import utils

from . import models, permissions, serializers, services


class AssignmentPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


# ---------------------------------------------------------------------------
# TEACHER
# ---------------------------------------------------------------------------
class TeacherMyClassesView(APIView):
    """
    GET /assignments/teacher/my-classes/
    What this teacher may send to: subjects they're allocated, with the
    classes for each - powers the form's Subject -> Classes pickers.
    """

    permission_classes = [utils.IsTeacher]

    def get(self, request):
        allocations = utils.teacher_allocated_classrooms(request.user).order_by(
            "subject__name", "classroom__grade_level__level_order", "classroom__stream__name"
        )
        grouped = {}
        for a in allocations:
            entry = grouped.setdefault(
                a.subject_id, {"subject_id": a.subject_id, "subject_name": a.subject.name, "classrooms": []}
            )
            entry["classrooms"].append({"id": a.classroom_id, "label": str(a.classroom)})

        year = utils.get_current_academic_year()
        terms = api_models.Term.objects.filter(academic_year=year).order_by("term_number") if year else []
        current_term = utils.get_current_term()
        return Response({
            "subjects": list(grouped.values()),
            "terms": [{"id": t.id, "label": str(t), "is_current": t.is_current} for t in terms],
            "current_term_id": current_term.id if current_term else None,
        })


class TeacherMaterialViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsTeacherOrOversight]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    pagination_class = AssignmentPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["kind", "subject", "term", "is_published", "classrooms"]
    search_fields = ["title", "subject__name"]

    def get_queryset(self):
        qs = (
            models.Material.objects.select_related("subject", "teacher", "term__academic_year")
            .prefetch_related("classrooms__grade_level", "classrooms__stream", "classrooms__academic_year")
            .annotate(
                viewed_count=Count("accesses", filter=Q(accesses__first_viewed_at__isnull=False), distinct=True),
                downloaded_count=Count("accesses", filter=Q(accesses__download_count__gt=0), distinct=True),
            )
        )
        if self.request.user.role == api_models.User.Role.TEACHER:
            qs = qs.filter(teacher=self.request.user)  # a teacher never sees another teacher's items
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return serializers.MaterialListSerializer
        if self.action in ("create", "update", "partial_update"):
            return serializers.MaterialWriteSerializer
        return serializers.MaterialDetailSerializer

    def _detail(self, pk):
        return serializers.MaterialDetailSerializer(self.get_queryset().get(pk=pk)).data

    def create(self, request, *args, **kwargs):
        serializer = serializers.MaterialWriteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        material = serializer.save(teacher=request.user)
        return Response(self._detail(material.pk), status=201)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = serializers.MaterialWriteSerializer(
            instance, data=request.data, partial=partial, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(self._detail(instance.pk))

    def perform_destroy(self, instance):
        if instance.file:
            instance.file.delete(save=False)
        instance.delete()

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        material = self.get_object()
        material.is_published = True
        material.published_at = material.published_at or timezone.now()
        material.save(update_fields=["is_published", "published_at", "updated_at"])
        return Response(self._detail(material.pk))

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        material = self.get_object()
        material.is_published = False
        material.save(update_fields=["is_published", "updated_at"])
        return Response(self._detail(material.pk))

    @action(detail=True, methods=["get"])
    def tracking(self, request, pk=None):
        """
        GET /assignments/teacher/materials/{id}/tracking/?classroom=<id>
        One row per student who should have received it, with whether they
        opened / downloaded it and when - the "who is doing the work at home" view.
        """
        material = self.get_object()
        classroom_id = request.query_params.get("classroom")
        accesses = {a.student_id: a for a in material.accesses.all()}

        rows = []
        for e in services.recipient_enrollments(material):
            if classroom_id and str(e.classroom_id) != str(classroom_id):
                continue
            a = accesses.get(e.student_id)
            rows.append({
                "enrollment_id": e.id,
                "student_id": e.student_id,
                "admission_no": e.student.admission_no,
                "name": e.student.user.get_full_name(),
                "classroom_id": e.classroom_id,
                "classroom": str(e.classroom),
                "viewed": bool(a and a.first_viewed_at),
                "first_viewed_at": a.first_viewed_at if a else None,
                "last_viewed_at": a.last_viewed_at if a else None,
                "view_count": a.view_count if a else 0,
                "downloaded": bool(a and a.download_count),
                "first_downloaded_at": a.first_downloaded_at if a else None,
                "last_downloaded_at": a.last_downloaded_at if a else None,
                "download_count": a.download_count if a else 0,
            })
        rows.sort(key=lambda r: (r["classroom"], r["name"]))

        viewed = sum(1 for r in rows if r["viewed"])
        downloaded = sum(1 for r in rows if r["downloaded"])
        return Response({
            "material": {
                "id": material.id,
                "title": material.title,
                "kind_display": material.get_kind_display(),
                "subject_name": material.subject.name,
                "is_published": material.is_published,
                "has_file": bool(material.file),
            },
            "classrooms": [{"id": c.id, "label": str(c)} for c in material.classrooms.all()],
            "summary": {
                "recipients": len(rows),
                "viewed": viewed,
                "not_viewed": len(rows) - viewed,
                "downloaded": downloaded,
            },
            "students": rows,
        })


# ---------------------------------------------------------------------------
# STUDENT
# ---------------------------------------------------------------------------
class StudentMaterialViewSet(viewsets.GenericViewSet):
    """
    list      GET /assignments/student/materials/?group=work|revision&kind=&subject=&search=&unread=1
    summary   GET /assignments/student/materials/summary/
    retrieve  GET /assignments/student/materials/{id}/            (records a VIEW)
    download  GET /assignments/student/materials/{id}/download/   (records a DOWNLOAD)
    """

    permission_classes = [utils.IsStudent]
    pagination_class = AssignmentPagination

    def _student(self):
        return services.student_for_user(self.request.user)

    def get_queryset(self):
        student = self._student()
        if not student:
            return models.Material.objects.none()
        qs = services.materials_for_student(student)
        p = self.request.query_params

        group = p.get("group")
        if group == "revision":
            qs = qs.filter(kind=models.Material.Kind.REVISION)
        elif group == "work":
            qs = qs.exclude(kind=models.Material.Kind.REVISION)
        if p.get("kind"):
            qs = qs.filter(kind=p["kind"])
        if (p.get("subject") or "").isdigit():
            qs = qs.filter(subject_id=int(p["subject"]))
        if p.get("search"):
            qs = qs.filter(Q(title__icontains=p["search"]) | Q(subject__name__icontains=p["search"]))
        if p.get("unread") in ("1", "true", "True"):
            seen = models.MaterialAccess.objects.filter(student=student, first_viewed_at__isnull=False).values("material_id")
            qs = qs.exclude(id__in=seen)
        return qs.order_by("-published_at", "-id")

    def _access_map(self, material_ids):
        return {
            a.material_id: a
            for a in models.MaterialAccess.objects.filter(student=self._student(), material_id__in=material_ids)
        }

    def list(self, request):
        page = self.paginate_queryset(self.get_queryset())
        ctx = {"access_map": self._access_map([m.id for m in page])}
        return self.get_paginated_response(serializers.StudentMaterialListSerializer(page, many=True, context=ctx).data)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        student = self._student()
        if not student:
            return Response({"total": 0, "unread_work": 0, "unread_revision": 0, "subjects": []})
        base = services.materials_for_student(student)
        seen = models.MaterialAccess.objects.filter(student=student, first_viewed_at__isnull=False).values("material_id")
        unread = base.exclude(id__in=seen)
        revision = models.Material.Kind.REVISION
        return Response({
            "total": base.count(),
            "unread_work": unread.exclude(kind=revision).count(),
            "unread_revision": unread.filter(kind=revision).count(),
            "subjects": [
                {"id": r["subject_id"], "name": r["subject__name"]}
                for r in base.order_by().values("subject_id", "subject__name").distinct().order_by("subject__name")
            ],
        })

    def retrieve(self, request, pk=None):
        material = generics.get_object_or_404(self.get_queryset(), pk=pk)
        ctx = {"access_map": self._access_map([material.id])}
        data = serializers.StudentMaterialDetailSerializer(material, context=ctx).data
        services.record_access(material, self._student(), viewed=True)
        return Response(data)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        material = generics.get_object_or_404(self.get_queryset(), pk=pk)
        if not material.file:
            return Response({"detail": "This item has no file attached."}, status=404)
        try:
            handle = material.file.open("rb")
        except FileNotFoundError:
            return Response({"detail": "The file is missing on the server. Please tell your teacher."}, status=404)

        services.record_access(material, self._student(), downloaded=True)
        filename = material.original_filename or os.path.basename(material.file.name)
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return FileResponse(handle, as_attachment=True, filename=filename, content_type=content_type)