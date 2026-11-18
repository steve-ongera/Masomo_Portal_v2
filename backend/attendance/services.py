"""
attendance/services.py

All attendance business rules. Views stay thin.

WHO CAN DO WHAT (per classroom, current academic year):
  Class teacher (ClassRoom.class_teacher)
      - mark DAILY attendance
      - see every session and every student's record in that class
  Subject teacher (TeacherSubjectAllocation for that classroom)
      - mark LESSON attendance, only for the subjects they are allocated
      - see only the LESSON sessions of their own subjects
  A teacher can be both. Everyone else gets a 403.

ATTENDANCE RATE = (present + late) / (total - excused)
  Excused absences (e.g. a medical appointment) don't count against the
  student. None when there is nothing to measure yet.
"""
from collections import defaultdict

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from api import models as api_models
from api import services as api_services

from .models import AttendanceRecord, AttendanceSession

Status = AttendanceRecord.Status
SessionType = AttendanceSession.SessionType

DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


class AttendanceError(ValueError):
    """A rule was broken. The view turns this into a 400 with the message."""


# ---------------------------------------------------------------------------
# ACCESS
# ---------------------------------------------------------------------------
def current_year():
    return api_models.AcademicYear.objects.filter(is_current=True).first()


def get_access(user, classroom):
    subject_ids = set(
        api_models.TeacherSubjectAllocation.objects.filter(
            teacher=user, classroom=classroom, academic_year=classroom.academic_year
        ).values_list("subject_id", flat=True)
    )
    is_ct = classroom.class_teacher_id == user.id
    return {
        "is_class_teacher": is_ct,
        "subject_ids": subject_ids,
        "has_access": is_ct or bool(subject_ids),
    }


def require_access(user, classroom):
    access = get_access(user, classroom)
    if not access["has_access"]:
        raise PermissionDenied("You are not the class teacher or a subject teacher for this class.")
    return access


def can_mark(access, session_type, subject_id):
    if session_type == SessionType.DAILY:
        return access["is_class_teacher"]
    return bool(subject_id) and subject_id in access["subject_ids"]


def visible_sessions(user, classroom):
    access = require_access(user, classroom)
    qs = AttendanceSession.objects.filter(classroom=classroom)
    if access["is_class_teacher"]:
        return qs, access
    return qs.filter(session_type=SessionType.LESSON, subject_id__in=access["subject_ids"]), access


def term_for_date(classroom, on_date):
    return api_models.Term.objects.filter(
        academic_year=classroom.academic_year, start_date__lte=on_date, end_date__gte=on_date
    ).first()


# ---------------------------------------------------------------------------
# MY CLASSES (dashboard)
# ---------------------------------------------------------------------------
def my_classes(user):
    year = current_year()
    if not year:
        return {"academic_year": None, "classes": []}

    classrooms = (
        api_models.ClassRoom.objects.filter(academic_year=year)
        .filter(
            Q(class_teacher=user)
            | Q(allocations__teacher=user, allocations__academic_year=year)
        )
        .select_related("grade_level", "stream", "academic_year")
        .distinct()
        .order_by("grade_level__level_order", "stream__name")
    )

    today = timezone.localdate()
    out = []
    for room in classrooms:
        access = get_access(user, room)
        subjects = api_models.Subject.objects.filter(id__in=access["subject_ids"]).order_by("name")
        student_count = room.enrollments.filter(status=api_models.Enrollment.Status.ACTIVE).count()

        daily_today = None
        if access["is_class_teacher"]:
            session = AttendanceSession.objects.filter(
                classroom=room, date=today, session_type=SessionType.DAILY
            ).first()
            daily_today = {"marked": session is not None, "session_id": session.id if session else None}
            if session:
                daily_today.update(counts_for_session(session))

        lessons_today = lessons_for_day(user, room, today, access=access)

        out.append({
            "classroom_id": room.id,
            "label": str(room),
            "grade_level": room.grade_level.name,
            "stream": room.stream.name,
            "student_count": student_count,
            "is_class_teacher": access["is_class_teacher"],
            "subjects": [{"id": s.id, "name": s.name} for s in subjects],
            "daily_today": daily_today,
            "lessons_today": lessons_today,
        })
    return {"academic_year": year.year, "today": today, "classes": out}


def counts_for_session(session):
    rows = session.records.values("status").annotate(c=Count("id"))
    counts = {s.value.lower(): 0 for s in Status}
    for r in rows:
        counts[r["status"].lower()] = r["c"]
    counts["total"] = sum(counts.values())
    return counts


def lessons_for_day(user, classroom, on_date, access=None):
    """The teacher's own timetable lessons for this class on this date."""
    access = access or get_access(user, classroom)
    if not access["subject_ids"]:
        return []
    day_code = DAY_CODES[on_date.weekday()]
    term = term_for_date(classroom, on_date)
    if not term or day_code == "SUN":
        return []

    entries = (
        api_models.TimetableEntry.objects.filter(
            classroom=classroom, term=term, period_slot__day=day_code, allocation__teacher=user
        )
        .select_related("period_slot", "allocation__subject")
        .order_by("period_slot__order")
    )
    marked = set(
        AttendanceSession.objects.filter(
            classroom=classroom, date=on_date, session_type=SessionType.LESSON,
            period_slot_id__in=[e.period_slot_id for e in entries],
        ).values_list("period_slot_id", flat=True)
    )
    return [
        {
            "period_slot_id": e.period_slot_id,
            "label": e.period_slot.label or f"Period {e.period_slot.order}",
            "start_time": e.period_slot.start_time.strftime("%H:%M"),
            "end_time": e.period_slot.end_time.strftime("%H:%M"),
            "subject_id": e.allocation.subject_id,
            "subject_name": e.allocation.subject.name,
            "marked": e.period_slot_id in marked,
        }
        for e in entries
    ]


# ---------------------------------------------------------------------------
# ROSTER + SHEET
# ---------------------------------------------------------------------------
def roster_enrollments(classroom, subject=None):
    """
    Active learners in the class. For an OPTIONAL subject (one learners
    choose), only the learners who actually registered for it.
    """
    qs = (
        classroom.enrollments.filter(status=api_models.Enrollment.Status.ACTIVE)
        .select_related("student__user")
        .order_by("student__user__first_name", "student__user__last_name")
    )
    if subject:
        gs = api_models.GradeSubject.objects.filter(grade_level=classroom.grade_level, subject=subject).first()
        if gs and not gs.is_compulsory:
            qs = qs.filter(subject_selections__subject=subject)
    return qs


def find_session(classroom, on_date, session_type, subject=None, period_slot=None):
    qs = AttendanceSession.objects.filter(classroom=classroom, date=on_date, session_type=session_type)
    if session_type == SessionType.LESSON:
        qs = qs.filter(subject=subject, period_slot=period_slot)
    return qs.select_related("marked_by").first()


def _validate_target(user, classroom, on_date, session_type, subject_id):
    access = require_access(user, classroom)
    if session_type == SessionType.LESSON and not subject_id:
        raise AttendanceError("Choose the subject for a lesson attendance.")
    if not can_mark(access, session_type, subject_id):
        if session_type == SessionType.DAILY:
            raise PermissionDenied("Only the class teacher can mark daily attendance.")
        raise PermissionDenied("You are not allocated to teach this subject in this class.")
    return access


def build_sheet(user, classroom, on_date, session_type, subject=None, period_slot=None):
    access = require_access(user, classroom)
    writable = can_mark(access, session_type, subject.id if subject else None)

    session = find_session(classroom, on_date, session_type, subject, period_slot)
    existing = {}
    if session:
        existing = {r.enrollment_id: r for r in session.records.all()}

    students = []
    for e in roster_enrollments(classroom, subject):
        rec = existing.get(e.id)
        students.append({
            "enrollment_id": e.id,
            "admission_no": e.student.admission_no,
            "full_name": e.student.user.get_full_name(),
            "gender": e.student.gender,
            "status": rec.status if rec else Status.PRESENT,
            "absence_reason": rec.absence_reason if rec else "",
            "check_in_time": rec.check_in_time.strftime("%H:%M") if rec and rec.check_in_time else "",
            "remarks": rec.remarks if rec else "",
            "recorded": rec is not None,
        })

    return {
        "classroom_id": classroom.id,
        "classroom": str(classroom),
        "date": on_date,
        "session_type": session_type,
        "subject_id": subject.id if subject else None,
        "subject_name": subject.name if subject else None,
        "period_slot_id": period_slot.id if period_slot else None,
        "can_mark": writable,
        "session": {
            "id": session.id,
            "marked_by": session.marked_by.get_full_name() if session.marked_by else "",
            "updated_at": session.updated_at,
        } if session else None,
        "students": students,
    }


def save_sheet(user, data):
    """
    data: classroom (obj), date, session_type, subject (obj|None),
    period_slot (obj|None), records [..], notify_guardians (bool)
    """
    classroom = data["classroom"]
    on_date = data["date"]
    session_type = data["session_type"]
    subject = data.get("subject")
    period_slot = data.get("period_slot")

    _validate_target(user, classroom, on_date, session_type, subject.id if subject else None)

    if on_date > timezone.localdate():
        raise AttendanceError("You can't mark attendance for a future date.")
    year = classroom.academic_year
    if not (year.start_date <= on_date <= year.end_date):
        raise AttendanceError(f"{on_date:%d %b %Y} is outside the {year.year} academic year.")
    if session_type == SessionType.DAILY:
        subject, period_slot = None, None
    if period_slot and subject:
        # the period has to be one this teacher actually teaches this subject in
        term = term_for_date(classroom, on_date)
        ok = api_models.TimetableEntry.objects.filter(
            classroom=classroom, term=term, period_slot=period_slot,
            allocation__teacher=user, allocation__subject=subject,
        ).exists()
        if not ok:
            raise AttendanceError("That period isn't one of your lessons for this class.")

    roster = {e.id: e for e in roster_enrollments(classroom, subject)}
    valid_status = {s.value for s in Status}
    valid_reasons = {r.value for r in AttendanceRecord.AbsenceReason}

    cleaned = {}
    for row in data["records"]:
        eid = row["enrollment_id"]
        if eid not in roster:
            raise AttendanceError("One of the students is not in this class.")
        status = row["status"]
        if status not in valid_status:
            raise AttendanceError(f"Unknown status '{status}'.")
        reason = row.get("absence_reason") or ""
        if status not in (Status.ABSENT, Status.EXCUSED):
            reason = ""
        elif reason and reason not in valid_reasons:
            raise AttendanceError(f"Unknown absence reason '{reason}'.")
        cleaned[eid] = {
            "status": status,
            "absence_reason": reason,
            "check_in_time": row.get("check_in_time") if status == Status.LATE else None,
            "remarks": (row.get("remarks") or "").strip()[:255],
        }
    if not cleaned:
        raise AttendanceError("There are no students to save.")

    newly_absent = []
    with transaction.atomic():
        session = (
            AttendanceSession.objects.select_for_update()
            .filter(classroom=classroom, date=on_date, session_type=session_type,
                    subject=subject, period_slot=period_slot)
            .first()
        )
        if not session:
            try:
                with transaction.atomic():
                    session = AttendanceSession.objects.create(
                        classroom=classroom, date=on_date, session_type=session_type,
                        subject=subject, period_slot=period_slot,
                        term=term_for_date(classroom, on_date), marked_by=user,
                    )
            except IntegrityError:
                session = AttendanceSession.objects.get(
                    classroom=classroom, date=on_date, session_type=session_type,
                    subject=subject, period_slot=period_slot,
                )
        session.marked_by = user
        session.save(update_fields=["marked_by", "updated_at"])

        existing = {r.enrollment_id: r for r in session.records.all()}
        to_create, to_update = [], []
        for eid, vals in cleaned.items():
            rec = existing.get(eid)
            if rec is None:
                rec = AttendanceRecord(session=session, enrollment_id=eid, **vals)
                to_create.append(rec)
                if vals["status"] == Status.ABSENT:
                    newly_absent.append(rec)
            else:
                was_absent = rec.status == Status.ABSENT
                for k, v in vals.items():
                    setattr(rec, k, v)
                to_update.append(rec)
                if vals["status"] == Status.ABSENT and not was_absent and not rec.guardian_notified:
                    newly_absent.append(rec)
        AttendanceRecord.objects.bulk_create(to_create)
        if to_update:
            AttendanceRecord.objects.bulk_update(
                to_update, ["status", "absence_reason", "check_in_time", "remarks", "updated_at"]
            )

    notified = 0
    if data.get("notify_guardians") and session_type == SessionType.DAILY and newly_absent:
        notified = notify_guardians_of_absence(session, newly_absent, user)

    return {"session_id": session.id, "saved": len(cleaned), "guardians_notified": notified,
            **counts_for_session(session)}


def notify_guardians_of_absence(session, records, sender):
    """
    One in-app message per absent learner, through the existing
    Communication system (api.services.send_communication). Failure never
    blocks the attendance save: the record just stays guardian_notified=False.
    """
    sent = 0
    for rec in AttendanceRecord.objects.filter(id__in=[r.id for r in records]).select_related(
        "enrollment__student__user"
    ):
        student = rec.enrollment.student
        if not api_models.ParentStudentLink.objects.filter(student=student).exists():
            continue
        try:
            name = student.user.get_full_name()
            comm = api_models.Communication.objects.create(
                sender=sender,
                subject=f"Absence: {name}",
                body=f"{name} ({student.admission_no}) was marked absent from school on "
                     f"{session.date:%d %b %Y}. Please contact the school if this absence was not authorised.",
                category=api_models.Communication.Category.GENERAL,
                audience_type=api_models.Communication.AudienceType.INDIVIDUAL,
                include_students=False, include_guardians=True,
                send_in_app=True, send_sms=False, send_email=False,
            )
            comm.target_students.set([student])
            api_services.send_communication(comm)
            rec.guardian_notified = True
            rec.save(update_fields=["guardian_notified"])
            sent += 1
        except Exception:  # noqa: BLE001 - never break the attendance save
            continue
    return sent


# ---------------------------------------------------------------------------
# HISTORY, SUMMARY, STUDENT
# ---------------------------------------------------------------------------
def _rate(present, late, excused, total):
    denom = total - excused
    return round((present + late) / denom * 100, 1) if denom > 0 else None


def list_sessions(user, classroom, date_from=None, date_to=None, session_type=None, subject_id=None):
    qs, _ = visible_sessions(user, classroom)
    if date_from:
        qs = qs.filter(date__gte=date_from)
    if date_to:
        qs = qs.filter(date__lte=date_to)
    if session_type:
        qs = qs.filter(session_type=session_type)
    if subject_id:
        qs = qs.filter(subject_id=subject_id)
    qs = (
        qs.select_related("subject", "period_slot", "marked_by")
        .annotate(
            total=Count("records"),
            present=Count("records", filter=Q(records__status=Status.PRESENT)),
            absent=Count("records", filter=Q(records__status=Status.ABSENT)),
            late=Count("records", filter=Q(records__status=Status.LATE)),
            excused=Count("records", filter=Q(records__status=Status.EXCUSED)),
        )
        .order_by("-date", "period_slot__order", "-created_at")
    )
    return [
        {
            "id": s.id,
            "date": s.date,
            "session_type": s.session_type,
            "subject_id": s.subject_id,
            "subject_name": s.subject.name if s.subject else None,
            "period_slot_id": s.period_slot_id,
            "period_label": (s.period_slot.label or f"Period {s.period_slot.order}") if s.period_slot else None,
            "marked_by": s.marked_by.get_full_name() if s.marked_by else "",
            "total": s.total, "present": s.present, "absent": s.absent, "late": s.late, "excused": s.excused,
            "rate": _rate(s.present, s.late, s.excused, s.total),
        }
        for s in qs
    ]


def session_detail(user, session):
    qs, _ = visible_sessions(user, session.classroom)
    if not qs.filter(pk=session.pk).exists():
        raise PermissionDenied("You can't view this session.")
    recs = session.records.select_related("enrollment__student__user").order_by(
        "enrollment__student__user__first_name", "enrollment__student__user__last_name"
    )
    return [
        {
            "enrollment_id": r.enrollment_id,
            "admission_no": r.enrollment.student.admission_no,
            "full_name": r.enrollment.student.user.get_full_name(),
            "status": r.status,
            "absence_reason": r.absence_reason,
            "check_in_time": r.check_in_time.strftime("%H:%M") if r.check_in_time else "",
            "remarks": r.remarks,
        }
        for r in recs
    ]


def class_summary(user, classroom, date_from=None, date_to=None, session_type=None, subject_id=None):
    sessions, access = visible_sessions(user, classroom)
    if date_from:
        sessions = sessions.filter(date__gte=date_from)
    if date_to:
        sessions = sessions.filter(date__lte=date_to)
    if session_type:
        sessions = sessions.filter(session_type=session_type)
    if subject_id:
        sessions = sessions.filter(subject_id=subject_id)

    session_ids = list(sessions.values_list("id", flat=True))
    records = AttendanceRecord.objects.filter(session_id__in=session_ids)

    per_student = {
        r["enrollment_id"]: r
        for r in records.values("enrollment_id").annotate(
            total=Count("id"),
            present=Count("id", filter=Q(status=Status.PRESENT)),
            absent=Count("id", filter=Q(status=Status.ABSENT)),
            late=Count("id", filter=Q(status=Status.LATE)),
            excused=Count("id", filter=Q(status=Status.EXCUSED)),
        )
    }

    enrollments = (
        classroom.enrollments.filter(Q(status=api_models.Enrollment.Status.ACTIVE) | Q(id__in=per_student.keys()))
        .select_related("student__user")
        .order_by("student__user__first_name", "student__user__last_name")
    )
    students = []
    for e in enrollments:
        s = per_student.get(e.id, {})
        total, present, late, excused = s.get("total", 0), s.get("present", 0), s.get("late", 0), s.get("excused", 0)
        students.append({
            "enrollment_id": e.id,
            "admission_no": e.student.admission_no,
            "full_name": e.student.user.get_full_name(),
            "total": total, "present": present, "absent": s.get("absent", 0),
            "late": late, "excused": excused,
            "rate": _rate(present, late, excused, total),
        })

    totals = defaultdict(int)
    for s in students:
        for k in ("total", "present", "absent", "late", "excused"):
            totals[k] += s[k]
    totals["rate"] = _rate(totals["present"], totals["late"], totals["excused"], totals["total"])

    by_day = defaultdict(lambda: {"present": 0, "absent": 0, "late": 0, "excused": 0})
    for r in records.values("session__date", "status").annotate(c=Count("id")):
        by_day[r["session__date"]][r["status"].lower()] += r["c"]
    trend = []
    for d in sorted(by_day):
        v = by_day[d]
        total = sum(v.values())
        trend.append({"date": d, **v, "total": total, "rate": _rate(v["present"], v["late"], v["excused"], total)})

    return {
        "classroom": str(classroom),
        "sessions_count": len(session_ids),
        "totals": dict(totals),
        "students": students,
        "trend": trend,
        "scope": "ALL" if access["is_class_teacher"] else "MY_SUBJECTS",
    }


def student_history(user, enrollment, date_from=None, date_to=None):
    sessions, _ = visible_sessions(user, enrollment.classroom)
    if date_from:
        sessions = sessions.filter(date__gte=date_from)
    if date_to:
        sessions = sessions.filter(date__lte=date_to)
    recs = (
        AttendanceRecord.objects.filter(enrollment=enrollment, session__in=sessions)
        .select_related("session__subject", "session__period_slot")
        .order_by("-session__date", "session__period_slot__order")
    )
    items, counts = [], {s.value.lower(): 0 for s in Status}
    for r in recs:
        counts[r.status.lower()] += 1
        sess = r.session
        items.append({
            "date": sess.date,
            "session_type": sess.session_type,
            "subject_name": sess.subject.name if sess.subject else None,
            "period_label": (sess.period_slot.label or f"Period {sess.period_slot.order}") if sess.period_slot else None,
            "status": r.status,
            "absence_reason": r.absence_reason,
            "check_in_time": r.check_in_time.strftime("%H:%M") if r.check_in_time else "",
            "remarks": r.remarks,
        })
    total = len(items)
    return {
        "student": {
            "enrollment_id": enrollment.id,
            "admission_no": enrollment.student.admission_no,
            "full_name": enrollment.student.user.get_full_name(),
            "classroom": str(enrollment.classroom),
        },
        "counts": {**counts, "total": total},
        "rate": _rate(counts["present"], counts["late"], counts["excused"], total),
        "items": items,
    }
