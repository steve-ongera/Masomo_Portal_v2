"""Thin views: parse the request, call attendance.services, return a Response."""
from django.utils.dateparse import parse_date
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView

from api import models as api_models

from . import serializers, services
from .models import AttendanceSession
from .permissions import IsTeacher


class _Base(APIView):
    permission_classes = [IsTeacher]

    def handle_exception(self, exc):
        if isinstance(exc, services.AttendanceError):
            return Response({"detail": str(exc)}, status=400)
        return super().handle_exception(exc)

    @staticmethod
    def _date(request, name):
        raw = request.query_params.get(name)
        return parse_date(raw) if raw else None

    @staticmethod
    def _classroom(request):
        cid = request.query_params.get("classroom")
        if not cid:
            raise services.AttendanceError("classroom is required.")
        return generics.get_object_or_404(
            api_models.ClassRoom.objects.select_related("grade_level", "stream", "academic_year"), pk=cid
        )


class MyClassesView(_Base):
    """GET /attendance/my-classes/ - every class the teacher can mark/see, with today's status."""

    def get(self, request):
        return Response(services.my_classes(request.user))


class LessonsView(_Base):
    """GET /attendance/lessons/?classroom=&date= - the teacher's timetable lessons for that day."""

    def get(self, request):
        classroom = self._classroom(request)
        on_date = self._date(request, "date")
        if not on_date:
            raise services.AttendanceError("date is required (YYYY-MM-DD).")
        services.require_access(request.user, classroom)
        return Response(services.lessons_for_day(request.user, classroom, on_date))


class SheetView(_Base):
    """GET /attendance/sheet/?classroom=&date=&session_type=&subject=&period_slot="""

    def get(self, request):
        s = serializers.SheetQuerySerializer(data=request.query_params)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if d["session_type"] == "LESSON" and not d.get("subject"):
            raise services.AttendanceError("Choose a subject for lesson attendance.")
        subject = d.get("subject") if d["session_type"] == "LESSON" else None
        slot = d.get("period_slot") if d["session_type"] == "LESSON" else None
        return Response(services.build_sheet(request.user, d["classroom"], d["date"], d["session_type"], subject, slot))


class SaveSheetView(_Base):
    """POST /attendance/sheet/save/ - creates the session or updates it in place."""

    def post(self, request):
        s = serializers.SaveSheetSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = dict(s.validated_data)
        data["records"] = [dict(r) for r in data["records"]]
        return Response(services.save_sheet(request.user, data))


class SessionListView(_Base):
    """GET /attendance/sessions/?classroom=&date_from=&date_to=&session_type=&subject="""

    def get(self, request):
        classroom = self._classroom(request)
        return Response(services.list_sessions(
            request.user, classroom,
            date_from=self._date(request, "date_from"), date_to=self._date(request, "date_to"),
            session_type=request.query_params.get("session_type") or None,
            subject_id=request.query_params.get("subject") or None,
        ))


class SessionDetailView(_Base):
    """GET /attendance/sessions/{id}/ - every student's mark in one session."""

    def get(self, request, pk):
        session = generics.get_object_or_404(
            AttendanceSession.objects.select_related("classroom__academic_year"), pk=pk
        )
        return Response(services.session_detail(request.user, session))


class SummaryView(_Base):
    """GET /attendance/summary/?classroom=&date_from=&date_to=&session_type=&subject="""

    def get(self, request):
        classroom = self._classroom(request)
        return Response(services.class_summary(
            request.user, classroom,
            date_from=self._date(request, "date_from"), date_to=self._date(request, "date_to"),
            session_type=request.query_params.get("session_type") or None,
            subject_id=request.query_params.get("subject") or None,
        ))


class StudentHistoryView(_Base):
    """GET /attendance/students/{enrollment_id}/?date_from=&date_to="""

    def get(self, request, enrollment_id):
        enrollment = generics.get_object_or_404(
            api_models.Enrollment.objects.select_related("student__user", "classroom__grade_level", "classroom__stream", "classroom__academic_year"),
            pk=enrollment_id,
        )
        return Response(services.student_history(
            request.user, enrollment,
            date_from=self._date(request, "date_from"), date_to=self._date(request, "date_to"),
        ))
