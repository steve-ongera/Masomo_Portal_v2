"""
lesson_planning/services.py - business rules. Views stay thin.

Reads from `api` models (Term, TimetableEntry, TeacherSubjectAllocation);
never writes to them.
"""
from django.conf import settings
from django.db.models import Max
from django.utils import timezone

from api import models as api_models

from . import models

DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def approval_required() -> bool:
    """Set LESSON_PLANNING_REQUIRE_APPROVAL = False in settings to auto-approve on submit."""
    return getattr(settings, "LESSON_PLANNING_REQUIRE_APPROVAL", True)


# ---------------------------------------------------------------------------
# WORKFLOW (shared by schemes and lesson plans)
# ---------------------------------------------------------------------------
def submit_for_approval(obj):
    S = models.ApprovalStatus
    if obj.status not in models.EDITABLE_STATUSES:
        raise ValueError("Only drafts or returned documents can be submitted.")
    now = timezone.now()
    obj.submitted_at = now
    obj.review_remarks = ""
    obj.reviewed_by = None
    if approval_required():
        obj.status = S.SUBMITTED
        obj.reviewed_at = None
    else:
        obj.status = S.APPROVED
        obj.reviewed_at = now
    obj.save()
    return obj


def withdraw(obj):
    if obj.status != models.ApprovalStatus.SUBMITTED:
        raise ValueError("Only a submitted document can be withdrawn.")
    obj.status = models.ApprovalStatus.DRAFT
    obj.save(update_fields=["status"])
    return obj


def review(obj, reviewer, decision: str, remarks: str = ""):
    S = models.ApprovalStatus
    if obj.status != S.SUBMITTED:
        raise ValueError("Only submitted documents can be reviewed.")
    remarks = (remarks or "").strip()
    mapping = {"APPROVE": S.APPROVED, "REJECT": S.REJECTED, "REVISION": S.NEEDS_REVISION}
    if decision not in mapping:
        raise ValueError("Decision must be APPROVE, REJECT or REVISION.")
    if decision != "APPROVE" and not remarks:
        raise ValueError("Please add remarks so the teacher knows what to change.")
    obj.status = mapping[decision]
    obj.reviewed_by = reviewer
    obj.reviewed_at = timezone.now()
    obj.review_remarks = remarks
    obj.save()
    return obj


# ---------------------------------------------------------------------------
# TERM / WEEK HELPERS
# ---------------------------------------------------------------------------
def week_for(term, on_date):
    """1-based teaching week of `term` that `on_date` falls in (None if before the term starts)."""
    if not term or on_date < term.start_date:
        return None
    return (on_date - term.start_date).days // 7 + 1


def term_for_date(academic_year, on_date):
    return api_models.Term.objects.filter(
        academic_year=academic_year, start_date__lte=on_date, end_date__gte=on_date
    ).first()


# ---------------------------------------------------------------------------
# TODAY'S LESSONS (timetable + linked plans + suggested scheme row)
# ---------------------------------------------------------------------------
def todays_lessons(teacher, on_date=None):
    on_date = on_date or timezone.localdate()
    term = api_models.Term.objects.filter(is_current=True).first()
    if not term:
        return {"date": on_date, "term": None, "week_number": None, "lessons": []}

    week = week_for(term, on_date)
    day_code = DAY_CODES[on_date.weekday()]

    slots = (
        api_models.TimetableEntry.objects.filter(
            term=term,
            allocation__teacher=teacher,
            period_slot__day=day_code,
            period_slot__slot_type=api_models.PeriodSlot.SlotType.LESSON,
        )
        .select_related("allocation__subject", "classroom__grade_level", "classroom__stream", "period_slot")
        .order_by("period_slot__order")
    )

    plans = list(
        models.LessonPlan.objects.filter(teacher=teacher, date=on_date).select_related("coverage")
    )
    by_slot = {p.timetable_entry_id: p for p in plans if p.timetable_entry_id}
    by_allocation = {}
    for p in plans:
        by_allocation.setdefault(p.allocation_id, p)

    entries_by_allocation = {}
    if week:
        for e in models.SchemeEntry.objects.filter(
            scheme__teacher=teacher, scheme__term=term, week_number=week
        ).select_related("scheme", "topic").order_by("lesson_number"):
            entries_by_allocation.setdefault(e.scheme.allocation_id, e)

    lessons = []
    for t in slots:
        plan = by_slot.get(t.id) or by_allocation.get(t.allocation_id)
        entry = entries_by_allocation.get(t.allocation_id)
        coverage = getattr(plan, "coverage", None) if plan else None
        lessons.append({
            "timetable_entry_id": t.id,
            "allocation_id": t.allocation_id,
            "subject_name": t.allocation.subject.name,
            "classroom_label": str(t.classroom),
            "period_label": t.period_slot.label or f"Period {t.period_slot.order}",
            "start_time": t.period_slot.start_time,
            "end_time": t.period_slot.end_time,
            "plan": {
                "id": plan.id,
                "topic": plan.topic,
                "status": plan.status,
                "completed": bool(coverage and coverage.completed),
            } if plan else None,
            "suggested_entry": {
                "id": entry.id,
                "topic": entry.topic_text or (entry.topic.name if entry.topic else ""),
                "week_number": entry.week_number,
            } if entry else None,
        })

    return {
        "date": on_date,
        "term": {"id": term.id, "label": str(term)},
        "week_number": week,
        "lessons": lessons,
    }


# ---------------------------------------------------------------------------
# SYLLABUS COVERAGE
# ---------------------------------------------------------------------------
def coverage_rows(allocations, term):
    """
    One row per allocation for `term`.

    A scheme row's coverage = the best coverage_percentage recorded on any
    lesson plan linked to it (0 if none). An allocation's coverage = the
    average across all of its scheme rows, so it reads as "% of the scheme
    delivered".
    """
    allocations = list(allocations)
    schemes = {
        s.allocation_id: s
        for s in models.SchemeOfWork.objects.filter(allocation__in=allocations, term=term)
    }
    entry_totals, entry_best = {}, {}
    if schemes:
        for e in models.SchemeEntry.objects.filter(scheme__in=schemes.values()).values("id", "scheme_id"):
            entry_totals.setdefault(e["scheme_id"], []).append(e["id"])
        best = (
            models.LessonCoverage.objects.filter(lesson_plan__scheme_entry__scheme__in=schemes.values())
            .values("lesson_plan__scheme_entry_id")
            .annotate(best=Max("coverage_percentage"))
        )
        entry_best = {r["lesson_plan__scheme_entry_id"]: r["best"] for r in best}

    plan_rows = {}
    for p in models.LessonPlan.objects.filter(allocation__in=allocations, term=term).values("allocation_id", "status"):
        d = plan_rows.setdefault(p["allocation_id"], {"total": 0, "pending": 0})
        d["total"] += 1
        if p["status"] == models.ApprovalStatus.SUBMITTED:
            d["pending"] += 1

    rows = []
    for a in allocations:
        scheme = schemes.get(a.id)
        ids = entry_totals.get(scheme.id, []) if scheme else []
        values = [entry_best.get(i, 0) for i in ids]
        percent = round(sum(values) / len(values), 1) if values else 0
        plans = plan_rows.get(a.id, {"total": 0, "pending": 0})
        rows.append({
            "allocation_id": a.id,
            "teacher_id": a.teacher_id,
            "teacher_name": a.teacher.get_full_name(),
            "subject_name": a.subject.name,
            "classroom_label": str(a.classroom),
            "scheme_id": scheme.id if scheme else None,
            "scheme_status": scheme.status if scheme else None,
            "entries_total": len(ids),
            "entries_covered": sum(1 for v in values if v >= 100),
            "coverage_percent": percent,
            "plans_total": plans["total"],
            "plans_pending": plans["pending"],
        })
    return rows