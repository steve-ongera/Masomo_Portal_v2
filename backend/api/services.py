"""
Service layer - business rules live here, NOT in views/serializers.
Views should stay thin: parse request -> call a service -> return response.

BALANCE RULES (single source of truth)
--------------------------------------
* get_ledger_totals_bulk()  - the ONE place that computes a student's money:
      balance = opening + charged - paid   (positive = owes, negative = credit)
* sync_invoice_chains()     - repairs every invoice's brought_forward /
  amount_due / amount_paid so the invoice-level figures always agree with the
  ledger. Called before any page/report that shows balances.
* carry_forward_balance()   - called whenever a student is promoted / moved to
  a new academic year: makes sure the previous year's unpaid balance is
  carried into the new year's invoice(s).
* invoice_money_rows()      - report helper that avoids DOUBLE-COUNTING the
  brought_forward amount when invoices of several terms are summed.
"""
import base64
import io
import random
from collections import defaultdict, namedtuple
from datetime import date, timedelta
from decimal import Decimal
from itertools import cycle
import time

import qrcode
import requests
from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.db import transaction
from django.db.models import Avg, Count, F, Q, Sum
from django.utils import timezone
from django.utils.crypto import get_random_string
from rest_framework_simplejwt.tokens import RefreshToken

from . import models, serializers, stages, utils
from django.db.models.functions import Length

_signer = TimestampSigner(salt="2fa-login-challenge")


# ---------------------------------------------------------------------------
# ADMISSION NUMBERS
# ---------------------------------------------------------------------------
def generate_admission_no(year: int) -> str:
    """
    Generates a sequential admission number, e.g. 2673, 2674, 2675.

    Admission numbers are independent of User.id (UUID) and are
    sequential across all years.

    The `year` argument is retained for backwards compatibility
    but does not affect the sequence.

    Format:
        Plain sequential number (no "ADM" prefix, no zero-padding)
    """

    last = (
        models.StudentProfile.objects
        .filter(admission_no__regex=r"^\d+$")
        .order_by("-admission_no")
        .first()
    )

    next_seq = 1

    if last:
        try:
            next_seq = int(last.admission_no) + 1
        except (ValueError, TypeError):
            pass

    return str(next_seq)


# ---------------------------------------------------------------------------
# SELF-SERVICE PROFILE UPDATES
# ---------------------------------------------------------------------------
def update_profile(user: models.User, data: dict) -> models.User:
    """
    Applies a self-service profile edit. Only ever touches:
      - User: email, phone_number, national_id
      - StudentProfile (if the user is a student): gender, date_of_birth
    Never touches username, role, admission_no, or names - those stay
    admin-controlled so identity/records can't be self-edited.
    """
    user_fields = [f for f in ("email", "phone_number", "national_id") if f in data]
    if user_fields:
        for field in user_fields:
            setattr(user, field, data[field])
        user.save(update_fields=user_fields)

    student_profile = getattr(user, "student_profile", None)
    if student_profile:
        student_fields = [f for f in ("gender", "date_of_birth") if f in data]
        if student_fields:
            for field in student_fields:
                setattr(student_profile, field, data[field])
            student_profile.save(update_fields=student_fields)

    return user


# ---------------------------------------------------------------------------
# AUTH / LOGIN - tokens, lockout, OTP (2FA), password reset
# ---------------------------------------------------------------------------

def issue_tokens_for_user(user):
    # Plan gate: refuse login if this role's portal isn't in the school's plan.
    # Raises 403 {"code": "feature_not_in_plan", ...}. ADMIN is always allowed,
    # so a locked school can still log in to redeem a token and unlock itself.
    from entitlements.enforcement import check_portal
    check_portal(user)

    refresh = RefreshToken.for_user(user)
    refresh["role"] = user.role
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "user": serializers.UserSerializer(user).data,
    }

def make_challenge_token(user):
    return _signer.sign(str(user.id))


def read_challenge_token(token):
    """Returns the user id (a UUID string), or None if the token is missing/expired/tampered."""
    try:
        return _signer.unsign(token, max_age=settings.OTP_EXPIRY_MINUTES * 60)
    except (BadSignature, SignatureExpired):
        return None


def validate_login_username(username):
    """Blocks the "giant garbage string" case before it ever touches the database."""
    if not username or len(username) > utils.USERNAME_MAX_LENGTH or not utils.USERNAME_PATTERN.match(username):
        raise ValueError("Invalid username format.")
    return username


def register_failed_login(user, ip_address, result):
    models.LoginAttemptLog.objects.create(
        username_attempted=user.username, user=user, ip_address=ip_address, result=result
    )

    # In DEBUG, track it in the log for visibility but never actually lock
    # the account - matches the STK-push DEBUG-bypass convention already
    # used elsewhere in this codebase.
    if settings.DEBUG or not user.requires_2fa:
        return False

    user.failed_login_attempts += 1
    user.last_failed_login_at = timezone.now()
    locked_now = False
    if user.failed_login_attempts >= settings.ACCOUNT_LOCKOUT_MAX_ATTEMPTS:
        user.locked_until = timezone.now() + timedelta(minutes=settings.ACCOUNT_LOCKOUT_DURATION_MINUTES)
        locked_now = True

    user.save(update_fields=["failed_login_attempts", "last_failed_login_at", "locked_until"])

    if locked_now:
        models.LoginAttemptLog.objects.create(
            username_attempted=user.username, user=user, ip_address=ip_address,
            result=models.LoginAttemptLog.Result.ACCOUNT_LOCKED,
        )
        notify_admins_account_locked(user)
    elif user.failed_login_attempts == settings.ACCOUNT_LOCKOUT_MAX_ATTEMPTS - 1:
        # Warn admins one attempt before lockout, not on every single failure.
        notify_admins_suspicious_activity(user)

    return locked_now


def reset_failed_logins(user):
    if user.failed_login_attempts or user.locked_until:
        user.failed_login_attempts = 0
        user.locked_until = None
        user.save(update_fields=["failed_login_attempts", "locked_until"])


def unlock_user(user):
    user.failed_login_attempts = 0
    user.locked_until = None
    user.save(update_fields=["failed_login_attempts", "locked_until"])


def generate_and_send_otp(user):
    code = f"{random.randint(0, 999999):06d}"
    user.otp_code = code
    user.otp_expires_at = timezone.now() + timedelta(minutes=settings.OTP_EXPIRY_MINUTES)
    user.save(update_fields=["otp_code", "otp_expires_at"])

    if settings.DEBUG:
        # Dev convenience only - never do this in production.
        print(f"[DEV OTP] {user.username} -> {code}")
    else:
        _dispatch_otp(user, code)

    models.LoginAttemptLog.objects.create(
        username_attempted=user.username, user=user, result=models.LoginAttemptLog.Result.OTP_SENT
    )
    return code


def _dispatch_otp(user, code):
    """Wire this to your real SMS/email provider. Placeholder uses Django's send_mail."""
    if user.email:
        send_mail(
            subject="Your login verification code",
            message=f"Your one-time code is {code}. It expires in {settings.OTP_EXPIRY_MINUTES} minutes. "
                    f"If you did not request this, contact IT immediately.",
            from_email=None,
            recipient_list=[user.email],
        )
    # else: plug in your SMS gateway (Africa's Talking / Twilio) using user.phone_number


def verify_otp(user, submitted_code, ip_address):
    submitted_code = (submitted_code or "").strip()

    if not user.otp_code or not user.otp_expires_at or timezone.now() > user.otp_expires_at:
        register_failed_login(user, ip_address, models.LoginAttemptLog.Result.OTP_FAILED)
        return False
    if submitted_code != user.otp_code.strip():
        register_failed_login(user, ip_address, models.LoginAttemptLog.Result.OTP_FAILED)
        return False

    user.otp_code = None
    user.otp_expires_at = None
    user.save(update_fields=["otp_code", "otp_expires_at"])
    models.LoginAttemptLog.objects.create(
        username_attempted=user.username, user=user, ip_address=ip_address,
        result=models.LoginAttemptLog.Result.OTP_SUCCESS,
    )
    return True


def _notify_admins(subject, body):
    """Reuses the existing Communication/notification system to alert every active Admin."""
    admin_ids = models.User.objects.filter(role=models.User.Role.ADMIN, is_active_staff=True)
    if not admin_ids.exists():
        return
    comm = models.Communication.objects.create(
        sender=None,
        subject=subject,
        body=body,
        category=models.Communication.Category.GENERAL,
        audience_type=models.Communication.AudienceType.ROLE,
        target_roles=[models.User.Role.ADMIN],
        include_students=False,
        include_guardians=False,
        send_in_app=True,
        send_sms=False,
        send_email=False,
    )
    send_communication(comm)  # existing function - resolves audience + dispatches


def notify_admins_suspicious_activity(user):
    _notify_admins(
        subject=f"Repeated failed login: {user.get_full_name() or user.username}",
        body=(
            f"{user.username} ({user.get_role_display()}) has {user.failed_login_attempts} failed login "
            f"attempt(s) at {timezone.now():%Y-%m-%d %H:%M}. One more failure will lock this account."
        ),
    )


def notify_admins_account_locked(user):
    _notify_admins(
        subject=f"Account locked: {user.get_full_name() or user.username}",
        body=(
            f"{user.username} ({user.get_role_display()}) was locked after "
            f"{user.failed_login_attempts} failed login attempts. Unlock it from User Accounts "
            f"if this was the legitimate user."
        ),
    )


# ---------------------------------------------------------------------------
# PASSWORD MANAGEMENT (students)
# ---------------------------------------------------------------------------
def reset_student_password(student: models.StudentProfile, new_password: str = None) -> str:
    """
    Resets a student's login password.

    If new_password is omitted/blank, resets back to the same simple
    default used on admission - "password123" (see
    StudentEnrollSerializer.create()). This makes the same function double
    as a plain "forgot password" reset with no extra endpoint needed.

    Returns the password that was actually set, so the caller (the admin
    UI) can display it once for the admin to share with the student.
    """
    password = new_password or "password123"
    student.user.set_password(password)
    student.user.save(update_fields=["password"])
    return password


def generate_password_reset_token(student_user):
    token = get_random_string(48)
    student_user.password_reset_token = token
    student_user.password_reset_expires_at = timezone.now() + timedelta(
        minutes=settings.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES
    )
    student_user.save(update_fields=["password_reset_token", "password_reset_expires_at"])
    return token


def send_password_reset_link(student_user, token):
    link = f"{settings.FRONTEND_URL}/reset-password/{token}"
    if settings.DEBUG:
        print(f"[DEV RESET LINK] {student_user.username} -> {link}")
        return
    guardian_link = models.ParentStudentLink.objects.filter(
        student__user=student_user
    ).select_related("parent__user").first()
    recipient_email = student_user.email or (guardian_link.parent.user.email if guardian_link else None)
    if recipient_email:
        send_mail(
            subject="Password reset request",
            message=f"A password reset was requested for admission number "
                     f"{student_user.student_profile.admission_no}. "
                     f"Use this link within {settings.PASSWORD_RESET_TOKEN_EXPIRY_MINUTES} minutes: {link}\n\n"
                     f"If you didn't request this, ignore this message.",
            from_email=None,
            recipient_list=[recipient_email],
        )


# ---------------------------------------------------------------------------
# SUBJECT SELECTION VALIDATION
# ---------------------------------------------------------------------------
def validate_subject_selection(
    grade_level: models.GradeLevel,
    subject_ids: list[int],
    pathway_id: int | None = None,
    track_id: int | None = None,
):
    grade_subjects = models.GradeSubject.objects.filter(grade_level=grade_level).select_related("subject")
    compulsory_ids = {gs.subject_id for gs in grade_subjects if gs.is_compulsory}
    optional_ids = {gs.subject_id for gs in grade_subjects if not gs.is_compulsory}
    valid_ids = compulsory_ids | optional_ids

    chosen = set(subject_ids)
    invalid = chosen - valid_ids
    if invalid:
        raise ValueError(f"Subjects not offered at {grade_level}: {invalid}")

    missing_compulsory = compulsory_ids - chosen
    if missing_compulsory:
        raise ValueError(f"Missing compulsory subjects: {missing_compulsory}")

    chosen_optional = chosen & optional_ids
    rule = getattr(grade_level, "selection_rule", None)

    # ---- CBC single-pathway check ----
    if rule and rule.requires_pathway:
        if not pathway_id:
            raise ValueError("Please choose a pathway (STEM / Social Sciences / Arts & Sports Science) first.")
        pathway = models.Pathway.objects.filter(pk=pathway_id, is_active=True).first()
        if not pathway:
            raise ValueError("Invalid or inactive pathway selected.")
        mismatched = models.Subject.objects.filter(id__in=chosen_optional).exclude(
            Q(pathway=pathway) | Q(pathway__isnull=True)
        )
        if mismatched.exists():
            raise ValueError(f"All optional subjects must belong to the {pathway.name} pathway you selected.")

    # ---- 8-4-4 group/track check ----
    if models.SelectionTrack.objects.filter(grade_level=grade_level, is_active=True).exists():
        if not track_id:
            raise ValueError("Please choose an elective track first (e.g. Technical + Humanities, or Triple Science).")
        track = models.SelectionTrack.objects.filter(
            pk=track_id, grade_level=grade_level, is_active=True
        ).prefetch_related("group_rules__group").first()
        if not track:
            raise ValueError("Invalid track for this grade.")

        allowed_group_ids = {r.group_id for r in track.group_rules.all()}
        chosen_subjects = models.Subject.objects.filter(id__in=chosen_optional).select_related("elective_group")

        # Any optional subject with a group must belong to a group this track allows.
        stray = [
            s.name for s in chosen_subjects
            if s.elective_group_id and s.elective_group_id not in allowed_group_ids
        ]
        if stray:
            raise ValueError(f"These subjects don't belong to the '{track.name}' track: {', '.join(stray)}")

        for tgr in track.group_rules.all():
            count = sum(1 for s in chosen_subjects if s.elective_group_id == tgr.group_id)
            if count < tgr.min_choose:
                raise ValueError(f"Choose at least {tgr.min_choose} {tgr.group.name} subject(s).")
            if count > tgr.max_choose:
                raise ValueError(f"Choose at most {tgr.max_choose} {tgr.group.name} subject(s).")

    if rule:
        if len(chosen_optional) < rule.min_optional_subjects:
            raise ValueError(f"Must select at least {rule.min_optional_subjects} optional subject(s).")
        if len(chosen_optional) > rule.max_optional_subjects:
            raise ValueError(f"May select at most {rule.max_optional_subjects} optional subject(s).")
        total = len(chosen)
        if not (rule.min_total_subjects <= total <= rule.max_total_subjects):
            raise ValueError(f"Total subjects must be between {rule.min_total_subjects} and {rule.max_total_subjects}.")

    return models.Subject.objects.filter(id__in=chosen)


@transaction.atomic
def set_student_subjects(enrollment, subject_ids, pathway_id=None, track_id=None, allow_relock=False):
    """
    allow_relock=True bypasses the lock - reserved for Admin/Teacher calls.
    A regular student self-service call must leave this False: once a
    student has submitted their subject selection, subjects_locked_at is
    set and every subsequent student-initiated call is rejected until an
    admin clears it via EnrollmentViewSet.unlock_subjects.
    """
    if enrollment.subjects_locked_at and not allow_relock:
        raise ValueError(
            "Your subject selection has already been submitted and locked. "
            "Contact the school office if you need to make changes."
        )

    subjects = validate_subject_selection(enrollment.classroom.grade_level, subject_ids, pathway_id, track_id)
    models.StudentSubjectSelection.objects.filter(enrollment=enrollment).delete()
    models.StudentSubjectSelection.objects.bulk_create(
        [models.StudentSubjectSelection(enrollment=enrollment, subject=s) for s in subjects]
    )

    update_fields = []
    if pathway_id:
        enrollment.pathway_id = pathway_id
        update_fields.append("pathway")
    if track_id:
        enrollment.selection_track_id = track_id
        update_fields.append("selection_track")
    if not enrollment.subjects_locked_at:
        enrollment.subjects_locked_at = timezone.now()
        update_fields.append("subjects_locked_at")
    if update_fields:
        enrollment.save(update_fields=update_fields)

    return subjects


# ---------------------------------------------------------------------------
# GRADING (stage-aware, with fallback to a standard high-school scale)
# ---------------------------------------------------------------------------
GradeResult = namedtuple("GradeResult", ["grade_letter", "points", "remark"])

# Standard KCSE-style 12-point scale — used ONLY when the school hasn't
# configured a GradingScale for this curriculum/subject yet, so a report
# card never shows a blank grade just because Grading Scales isn't set up.
_DEFAULT_GRADING_SCALE = [
    (80, 100,   "A",  12, "Excellent"),
    (75, 79.99, "A-", 11, "Very Good"),
    (70, 74.99, "B+", 10, "Very Good"),
    (65, 69.99, "B",  9,  "Good"),
    (60, 64.99, "B-", 8,  "Good"),
    (55, 59.99, "C+", 7,  "Average"),
    (50, 54.99, "C",  6,  "Average"),
    (45, 49.99, "C-", 5,  "Below Average"),
    (40, 44.99, "D+", 4,  "Below Average"),
    (35, 39.99, "D",  3,  "Weak"),
    (30, 34.99, "D-", 2,  "Weak"),
    (0,  29.99, "E",  1,  "Needs Improvement"),
]


def default_grade_for_percentage(percentage) -> GradeResult:
    pct = float(percentage)
    for lo, hi, letter, points, remark in _DEFAULT_GRADING_SCALE:
        if lo <= pct <= hi:
            return GradeResult(letter, Decimal(points), remark)
    return GradeResult("E", Decimal(1), "Needs Improvement")


def grade_for_percentage(
    curriculum_type: str,
    percentage: Decimal,
    subject: models.Subject = None,
    grade_level: models.GradeLevel = None,
):
    """
    Looks up the applicable grade for a percentage score.

    `grade_level` is optional so every existing caller keeps working. When
    given, the learner's STAGE (see stages.py) decides the scale:
      - Pre-primary / Grade 1-3 : descriptive rubric (EE/ME/AE/BE), always.
      - Grade 4-6               : school's GradingScale if configured,
                                  else the 8-level rubric (EE1..BE2).
      - Everything else         : exactly the previous behaviour - the
                                  school's GradingScale, else the standard
                                  KCSE-style scale. Never returns None.
    """
    stage = stages.stage_for_grade(grade_level)

    if stage in stages.CODE_SCALE_STAGES:
        return stages.rubric_grade(stage, percentage)

    qs = models.GradingScale.objects.filter(
        curriculum_type=curriculum_type,
        min_percentage__lte=percentage,
        max_percentage__gte=percentage,
    )
    specific = qs.filter(subject=subject).first() if subject else None
    scale = specific or qs.filter(subject__isnull=True).first()
    if scale:
        return scale

    if stage in stages.RUBRIC_FALLBACK_STAGES:
        return stages.rubric_grade(stage, percentage)
    return default_grade_for_percentage(percentage)


# ---------------------------------------------------------------------------
# REPORT CARD QR VERIFICATION (stateless — signed token, no DB row needed)
# ---------------------------------------------------------------------------
REPORT_CARD_TOKEN_SALT = "report-card-verify-v1"


def generate_report_card_token(
    enrollment_id: int, term_id: int, exam_id: int = None,
    pos_term_id: int = None, pos_exam_type_id: int = None,
) -> str:
    data = {"enrollment_id": enrollment_id, "term_id": term_id, "exam_id": exam_id}
    if pos_term_id:
        data["pos_term_id"] = pos_term_id
        data["pos_exam_type_id"] = pos_exam_type_id
    return signing.dumps(data, salt=REPORT_CARD_TOKEN_SALT)


def read_report_card_token(token: str):
    try:
        return signing.loads(token, salt=REPORT_CARD_TOKEN_SALT)
    except signing.BadSignature:
        return None


def generate_report_card_qr_base64(token: str) -> str:
    verify_url = f"{settings.FRONTEND_URL}/verify-report-card/{token}"
    img = qrcode.make(verify_url)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def get_report_card_verification(token: str) -> dict:
    """
    Recomputes the student's result LIVE - never trusts a stored snapshot -
    so if a mark is corrected after printing, an old report card's QR will
    show the discrepancy instead of falsely confirming stale figures.
    Deliberately excludes fee data - this endpoint is public.

    Two shapes, decided by the token:
      - token carries an exam_id  -> figures for THAT exam only, computed by
        get_student_exam_summary() so they match the printed report card
        exactly (total marks, average, points, grade, class/grade position).
      - token has no exam_id      -> the combined-term view (every exam in
        the term), with the END-OF-TERM ranking position as before.

    If the token also carries pos_term_id, the positions are taken from that
    term / exam type instead, matching what was printed on the report card.
    """
    payload = read_report_card_token(token)
    if not payload:
        return {"valid": False, "detail": "This QR code is invalid or has been tampered with."}

    enrollment = models.Enrollment.objects.select_related(
        "student__user", "classroom__grade_level", "classroom__stream", "classroom__academic_year"
    ).filter(pk=payload["enrollment_id"]).first()
    term = models.Term.objects.filter(pk=payload["term_id"]).first()
    if not enrollment or not term:
        return {"valid": False, "detail": "This report card no longer exists."}

    exam = None
    if payload.get("exam_id"):
        exam = models.Exam.objects.filter(pk=payload["exam_id"]).first()
        if not exam:
            # Don't silently fall back to a combined-term view for an
            # exam-specific report card whose exam has been deleted.
            return {"valid": False, "detail": "This report card no longer exists."}

    classroom = enrollment.classroom

    identity = {
        "valid": True,
        "student_name": enrollment.student.user.get_full_name(),
        "admission_no": enrollment.student.admission_no,
        "classroom": str(classroom),
        "academic_year": classroom.academic_year.year,
        "term": str(term),
        "exam": exam.name if exam else "All Exams (Combined)",
    }

    ref_block = {}
    if payload.get("pos_term_id"):
        ref_term = models.Term.objects.select_related("academic_year").filter(
            pk=payload["pos_term_id"]
        ).first()
        if ref_term:
            ref_exam_type = (
                models.ExamType.objects.filter(pk=payload["pos_exam_type_id"]).first()
                if payload.get("pos_exam_type_id") else None
            )
            ref = get_reference_positions(
                ref_term, ref_exam_type, [enrollment.student_id], force_ranking=True
            ).get(enrollment.student_id)
            if ref:
                ref_block = {
                    "position_basis": reference_basis_label(ref_term, ref_exam_type),
                    "class_position": ref["class_position"],
                    "class_size": ref["class_size"],
                    "grade_position": ref["overall_position"],
                    "grade_size": ref["overall_size"],
                }

    # ---------------------------------------------------------------
    # Exam-specific report card: same numbers the student's PDF shows
    # ---------------------------------------------------------------
    if exam:
        summary = get_student_exam_summary(enrollment, exam)
        return {
            **identity,
            "average_marks": summary["average"],
            "overall_grade": summary["overall_grade"],
            "total_marks": summary["total_marks"],
            "total_max": summary["total_max"],
            "total_points": summary["total_points"],
            "average_points": summary["average_points"],
            "class_position": summary["class_position"],
            "class_size": summary["class_size"],
            "grade_position": summary["grade_position"],
            "grade_size": summary["grade_size"],
            **ref_block,
        }

    # ---------------------------------------------------------------
    # Combined-term report card (no exam_id in the token)
    # ---------------------------------------------------------------
    def result_filter(**extra):
        return models.ExamResult.objects.filter(
            is_absent=False, marks_obtained__isnull=False, max_marks__gt=0,
            exam__term=term, **extra
        )

    offered_subject_ids = set(
        models.Subject.objects.filter(grade_subjects__grade_level=classroom.grade_level).values_list("id", flat=True)
    )
    scored_subject_ids = set(result_filter(enrollment=enrollment).values_list("subject_id", flat=True))
    subjects = models.Subject.objects.filter(id__in=(offered_subject_ids | scored_subject_ids))

    pct_values, points_values = [], []
    for subject in subjects:
        qs = result_filter(enrollment=enrollment, subject=subject)
        if qs.exists():
            total_pct = sum(float(r.marks_obtained) / float(r.max_marks) * 100 for r in qs)
            avg_pct = round(total_pct / qs.count(), 1)
            grade = grade_for_percentage(
                classroom.grade_level.curriculum_type, Decimal(str(avg_pct)), subject,
                grade_level=classroom.grade_level,
            )
            pct_values.append(avg_pct)
            points_values.append(float(grade.points))

    has_marks = bool(pct_values)
    average = round(sum(pct_values) / len(pct_values), 1) if has_marks else None
    overall_grade = (
        grade_for_percentage(
            classroom.grade_level.curriculum_type, Decimal(str(average)),
            grade_level=classroom.grade_level,
        ) if has_marks else None
    )
    ranking = models.TermPositionRanking.objects.filter(
        enrollment=enrollment, term=term, checkpoint=models.TermPositionRanking.Checkpoint.ENDTERM
    ).first()

    return {
        **identity,
        "average_marks": average,
        "overall_grade": overall_grade.grade_letter if overall_grade else None,
        "total_marks": None,
        "total_max": None,
        "total_points": round(sum(points_values), 1) if points_values else None,
        "average_points": round(sum(points_values) / len(points_values), 2) if points_values else None,
        "class_position": ranking.class_position if ranking else None,
        "class_size": None,
        "grade_position": ranking.grade_position if ranking else None,
        "grade_size": None,
        **ref_block,
    }


# ---------------------------------------------------------------------------
# RANKING
# ---------------------------------------------------------------------------
def rank_classroom(term: models.Term, classroom: models.ClassRoom, checkpoint: str):
    """
    Computes and stores TermPositionRanking for every student in a classroom.

    checkpoint = "MIDTERM"  -> combine exams flagged counts_towards_midterm_rank
    checkpoint = "ENDTERM"  -> combine exams flagged counts_towards_endterm_rank

    Weighted average per student = sum(marks * exam_weight) / sum(max_marks * exam_weight)
    across all subjects and all included exams, expressed back out of 100.

    Stages with no positions (PP1 - Grade 3, see stages.NO_RANKING_STAGES)
    are skipped entirely.
    """
    if not stages.ranking_enabled(classroom.grade_level):
        return []  # no positions for PP1-Grade 3
    flag = "counts_towards_midterm_rank" if checkpoint == "MIDTERM" else "counts_towards_endterm_rank"
    exams = models.Exam.objects.filter(
        term=term, grade_level=classroom.grade_level, **{f"exam_type__{flag}": True}
    ).select_related("exam_type")

    enrollments = models.Enrollment.objects.filter(classroom=classroom, academic_year=term.academic_year)

    scored = []
    for enrollment in enrollments:
        weighted_sum = Decimal("0")
        weighted_max = Decimal("0")
        for exam in exams:
            weight = exam.exam_type.weight
            results = models.ExamResult.objects.filter(
                exam=exam, enrollment=enrollment, is_absent=False, marks_obtained__isnull=False
            )
            for r in results:
                weighted_sum += r.marks_obtained * weight
                weighted_max += r.max_marks * weight

        average = float(weighted_sum / weighted_max * 100) if weighted_max else 0
        scored.append({"enrollment": enrollment, "total": weighted_sum, "average": round(average, 2)})

    # Class position: rank by average, descending, ties share a rank (1,2,2,4 style).
    scored.sort(key=lambda x: x["average"], reverse=True)
    with transaction.atomic():
        prev_avg, rank = None, 0
        for idx, row in enumerate(scored, start=1):
            if row["average"] != prev_avg:
                rank = idx
            prev_avg = row["average"]
            models.TermPositionRanking.objects.update_or_create(
                term=term, enrollment=row["enrollment"], checkpoint=checkpoint,
                defaults={
                    "total_marks": row["total"],
                    "average_marks": row["average"],
                    "class_position": rank,
                },
            )
    return scored


def rank_grade(term: models.Term, grade_level: models.GradeLevel, checkpoint: str):
    """Ranks a student across ALL streams of a grade (e.g. Grade 9 Red + Blue + Green combined)."""
    if not stages.ranking_enabled(grade_level):
        return []  # no positions for PP1-Grade 3
    classrooms = models.ClassRoom.objects.filter(grade_level=grade_level, academic_year=term.academic_year)
    all_scores = []
    for classroom in classrooms:
        all_scores += rank_classroom(term, classroom, checkpoint)

    all_scores.sort(key=lambda x: x["average"], reverse=True)
    prev_avg, rank = None, 0
    for idx, row in enumerate(all_scores, start=1):
        if row["average"] != prev_avg:
            rank = idx
        prev_avg = row["average"]
        models.TermPositionRanking.objects.filter(
            term=term, enrollment=row["enrollment"], checkpoint=checkpoint
        ).update(grade_position=rank)
    return all_scores


# ---------------------------------------------------------------------------
# PER-EXAM STUDENT SUMMARY (total marks, points, overall grade, position)
# ---------------------------------------------------------------------------
RANKABLE_ENROLLMENT_STATUSES = (
    models.Enrollment.Status.ACTIVE,
    models.Enrollment.Status.PROMOTED,
    models.Enrollment.Status.GRADUATED,
    models.Enrollment.Status.REPEATED,
)


def _competition_ranks(averages: dict) -> dict:
    """{key: average} -> {key: rank}. Ties share a rank (1, 2, 2, 4)."""
    ranks, prev, rank = {}, None, 0
    for idx, (key, avg) in enumerate(sorted(averages.items(), key=lambda kv: -kv[1]), start=1):
        if avg != prev:
            rank = idx
        prev = avg
        ranks[key] = rank
    return ranks


def get_student_exam_summary(enrollment: models.Enrollment, exam: models.Exam) -> dict:
    """
    Everything the report card needs for ONE student in ONE exam:
    total marks, average, total points (8-4-4), overall grade, class
    position and grade-wide position.

    Subject % = sum(marks) / sum(max) across that subject's papers (same
    as the student results page). Overall average = mean of subject %s.
    Ranking is by that average; ties share a rank; students with no marks
    for the exam are not ranked. Positions are None for stages with no
    ranking (PP1 - Grade 3).
    """
    classroom = enrollment.classroom
    grade_level = classroom.grade_level
    curriculum_type = grade_level.curriculum_type
    is_844 = curriculum_type == models.CurriculumType.LEGACY_844
    ranked = stages.ranking_enabled(grade_level)  # False for PP1-Grade 3

    # Everyone in the same grade (all streams) for that academic year.
    classroom_by_enrollment = dict(
        models.Enrollment.objects.filter(
            classroom__grade_level=grade_level,
            classroom__academic_year=classroom.academic_year,
            status__in=RANKABLE_ENROLLMENT_STATUSES,
        ).values_list("id", "classroom_id")
    )

    rows = models.ExamResult.objects.filter(
        exam=exam,
        enrollment_id__in=list(classroom_by_enrollment.keys() | {enrollment.id}),
        is_absent=False,
        marks_obtained__isnull=False,
        max_marks__gt=0,
    ).values("enrollment_id", "subject_id", "marks_obtained", "max_marks")

    # enrollment_id -> subject_id -> [marks, max]
    per_subject = defaultdict(lambda: defaultdict(lambda: [Decimal("0"), Decimal("0")]))
    for r in rows:
        cell = per_subject[r["enrollment_id"]][r["subject_id"]]
        cell[0] += r["marks_obtained"]
        cell[1] += r["max_marks"]

    def subject_pct(cell):
        return float(cell[0] / cell[1] * 100)

    averages = {}
    for eid, subjects in per_subject.items():
        pcts = [subject_pct(c) for c in subjects.values()]
        averages[eid] = round(sum(pcts) / len(pcts), 2)

    mine = per_subject.get(enrollment.id)
    if not mine:
        return {
            "exam_id": exam.id, "enrollment_id": enrollment.id, "has_marks": False,
            "total_marks": None, "total_max": None, "average": None,
            "total_points": None, "average_points": None,
            "overall_grade": None, "overall_remark": None,
            "class_position": None, "class_size": 0,
            "grade_position": None, "grade_size": 0,
        }

    subjects_by_id = models.Subject.objects.in_bulk(list(mine.keys()))
    points = []
    for subject_id, cell in mine.items():
        pct = Decimal(str(round(subject_pct(cell), 2)))
        grade = grade_for_percentage(
            curriculum_type, pct, subjects_by_id.get(subject_id), grade_level=grade_level
        )
        points.append(float(grade.points))

    average = averages[enrollment.id]
    overall = grade_for_percentage(curriculum_type, Decimal(str(average)), grade_level=grade_level)

    grade_ranks = _competition_ranks({e: a for e, a in averages.items() if e in classroom_by_enrollment})
    class_ranks = _competition_ranks(
        {e: a for e, a in averages.items() if classroom_by_enrollment.get(e) == classroom.id}
    )

    return {
        "exam_id": exam.id,
        "enrollment_id": enrollment.id,
        "has_marks": True,
        "total_marks": float(sum(c[0] for c in mine.values())),
        "total_max": float(sum(c[1] for c in mine.values())),
        "average": average,
        "total_points": round(sum(points), 1) if is_844 else None,
        "average_points": round(sum(points) / len(points), 2) if is_844 else None,
        "overall_grade": overall.grade_letter,
        "overall_remark": overall.remark,
        "class_position": class_ranks.get(enrollment.id) if ranked else None,
        "class_size": len(class_ranks),
        "grade_position": grade_ranks.get(enrollment.id) if ranked else None,
        "grade_size": len(grade_ranks),
    }


# ---------------------------------------------------------------------------
# POSITIONS FROM ANOTHER TERM / EXAM TYPE (report card "position basis")
# ---------------------------------------------------------------------------
def reference_basis_label(term, exam_type=None) -> str:
    """e.g. 'Term 3 2026 End Term' or 'Term 3 2026 All Exams'."""
    return (
        f"{term.get_term_number_display()} {term.academic_year.year} "
        f"{exam_type.name if exam_type else 'All Exams'}"
    )


def get_reference_positions(term, exam_type, student_ids, force_ranking=False) -> dict:
    """
    Positions for the given students based on ONE term (any academic year) and
    optionally ONE exam type (None = every exam in that term combined).

    Each student is ranked in the classroom and grade they were in during that
    term's academic year. Returns {student_id: {classroom, average,
    class_position, class_size, overall_position, overall_size}}.
    Students with no enrollment in that year are absent from the result.
    Positions are None when there are no marks in scope, or the grade has no
    ranking (PP1 - Grade 3) - unless force_ranking=True, which is used when the
    user explicitly chose a position basis and wants positions shown anyway.
    """
    enrollments = list(
        models.Enrollment.objects.filter(
            academic_year=term.academic_year, status__in=RANKABLE_ENROLLMENT_STATUSES
        ).select_related("classroom__grade_level", "classroom__stream", "classroom__academic_year")
    )
    by_id = {e.id: e for e in enrollments}

    class_sizes, grade_sizes = defaultdict(int), defaultdict(int)
    for e in enrollments:
        class_sizes[e.classroom_id] += 1
        grade_sizes[e.classroom.grade_level_id] += 1

    results = models.ExamResult.objects.filter(
        exam__term=term, enrollment_id__in=list(by_id),
        is_absent=False, marks_obtained__isnull=False, max_marks__gt=0,
    )
    if exam_type:
        results = results.filter(exam__exam_type=exam_type)

    per_subject = defaultdict(lambda: defaultdict(list))
    for enr_id, subject_id, marks, max_m in results.values_list(
        "enrollment_id", "subject_id", "marks_obtained", "max_marks"
    ):
        per_subject[enr_id][subject_id].append(float(marks) / float(max_m) * 100)

    averages = {}
    for enr_id, subjects in per_subject.items():
        subject_avgs = [round(sum(v) / len(v), 1) for v in subjects.values()]
        averages[enr_id] = round(sum(subject_avgs) / len(subject_avgs), 1)

    by_class, by_grade = defaultdict(dict), defaultdict(dict)
    for enr_id, avg in averages.items():
        e = by_id[enr_id]
        by_class[e.classroom_id][enr_id] = avg
        by_grade[e.classroom.grade_level_id][enr_id] = avg
    class_ranks = {cid: _competition_ranks(d) for cid, d in by_class.items()}
    grade_ranks = {gid: _competition_ranks(d) for gid, d in by_grade.items()}

    wanted = set(student_ids)
    out = {}
    for e in enrollments:
        if e.student_id not in wanted:
            continue
        avg = averages.get(e.id)
        # force_ranking: the user explicitly asked for positions from this
        # term/exam, so show them even for stages with no ranking (PP1-Grade 3).
        ranked = avg is not None and (
            force_ranking or stages.ranking_enabled(e.classroom.grade_level)
        )
        out[e.student_id] = {
            "classroom": str(e.classroom),
            "average": avg,
            "class_position": class_ranks.get(e.classroom_id, {}).get(e.id) if ranked else None,
            "class_size": class_sizes[e.classroom_id],
            "overall_position": grade_ranks.get(e.classroom.grade_level_id, {}).get(e.id) if ranked else None,
            "overall_size": grade_sizes[e.classroom.grade_level_id],
        }
    return out


# ---------------------------------------------------------------------------
# PROMOTION
# ---------------------------------------------------------------------------
@transaction.atomic
def promote_student(enrollment: models.Enrollment, target_classroom: models.ClassRoom, force: bool = False):
    """
    Creates a new Enrollment for the next academic year, linked back to the
    old one via promoted_from. The OLD enrollment (and every ExamResult /
    Invoice FK'd to it) is left completely untouched.

    FEES: whatever the student still owes (or has prepaid) at the moment of
    promotion is carried into the new year automatically - see
    carry_forward_balance(). The promoted enrollment gets a
    `carried_forward_balance` attribute (Decimal) for the caller to report.
    """
    rule = getattr(enrollment.classroom.grade_level, "promotion_rule", None)
    if rule and not force and stages.ranking_enabled(enrollment.classroom.grade_level):
        ranking = models.TermPositionRanking.objects.filter(
            enrollment=enrollment, checkpoint="ENDTERM"
        ).order_by("-term__term_number").first()
        if not ranking or ranking.average_marks < rule.minimum_average_percentage:
            raise ValueError(
                "Student does not meet the minimum average "
                f"({rule.minimum_average_percentage}%) required for promotion. "
                "Pass force=True to override."
            )

    # Bring the old year's invoices fully up to date BEFORE moving the student on.
    sync_invoice_chains([enrollment.student_id])

    enrollment.status = models.Enrollment.Status.PROMOTED
    enrollment.save(update_fields=["status"])

    new_enrollment = models.Enrollment.objects.create(
        student=enrollment.student,
        classroom=target_classroom,
        academic_year=target_classroom.academic_year,
        status=models.Enrollment.Status.ACTIVE,
        promoted_from=enrollment,
    )
    new_enrollment.carried_forward_balance = carry_forward_balance(new_enrollment)
    return new_enrollment


def bulk_promote_classroom(classroom: models.ClassRoom, target_classroom: models.ClassRoom, force: bool = False):
    results = {"promoted": [], "failed": []}
    promoted_student_ids = []
    for enrollment in classroom.enrollments.filter(status=models.Enrollment.Status.ACTIVE):
        try:
            new_e = promote_student(enrollment, target_classroom, force=force)
            results["promoted"].append(new_e.id)
            promoted_student_ids.append(new_e.student_id)
        except ValueError as exc:
            results["failed"].append({"student": enrollment.student.admission_no, "reason": str(exc)})

    ledger = get_ledger_totals_bulk(promoted_student_ids) if promoted_student_ids else {}
    results["balance_carried_forward"] = float(
        sum((t["balance"] for t in ledger.values() if t["balance"] > 0), Decimal("0"))
    )
    return results


def resolve_next_classroom_target(source_classroom: models.ClassRoom) -> dict:
    """
    Dry-run resolution of where `source_classroom` promotes TO: same
    stream, grade_level.next_grade, and the AcademicYear whose year is
    source_classroom.academic_year.year + 1. Curriculum-agnostic - this
    walks the SAME next_grade chain whether the grade is CBC (Grade 9 ->
    Grade 10 -> ...) or legacy 8-4-4 (Form 1 -> Form 2 -> Form 3 -> Form 4).
    Does NOT create anything - used by the preview endpoint.
    """
    grade_level = source_classroom.grade_level
    next_grade = grade_level.next_grade
    if next_grade is None:
        return {"graduating": True}

    if next_grade.curriculum_type != grade_level.curriculum_type:
        raise ValueError(
            f"{grade_level}'s next grade is set to {next_grade}, which is a different "
            f"curriculum ({next_grade.get_curriculum_type_display()} vs "
            f"{grade_level.get_curriculum_type_display()}). Fix the 'next grade' link on "
            "Grade Levels before promoting this class."
        )

    target_year_value = source_classroom.academic_year.year + 1
    target_academic_year = models.AcademicYear.objects.filter(year=target_year_value).first()
    if not target_academic_year:
        raise ValueError(
            f"Academic year {target_year_value} hasn't been set up yet. "
            "Create it under Academic Calendar before promoting this class."
        )

    existing_classroom = models.ClassRoom.objects.filter(
        grade_level=next_grade, stream=source_classroom.stream, academic_year=target_academic_year,
    ).first()

    return {
        "graduating": False,
        "grade_level": next_grade,
        "stream": source_classroom.stream,
        "academic_year": target_academic_year,
        "existing_classroom": existing_classroom,
    }


def get_or_create_next_classroom(source_classroom: models.ClassRoom) -> models.ClassRoom:
    """Same resolution as above, but creates the target ClassRoom if it doesn't exist yet."""
    info = resolve_next_classroom_target(source_classroom)
    if info["graduating"]:
        raise ValueError("This grade has no next grade configured - it's a graduating class, not a promotion.")

    target_classroom, _ = models.ClassRoom.objects.get_or_create(
        grade_level=info["grade_level"], stream=info["stream"], academic_year=info["academic_year"],
    )
    return target_classroom


@transaction.atomic
def bulk_promote_classroom_auto(source_classroom: models.ClassRoom, force: bool = False, promoted_by=None) -> dict:
    """
    The guarded, auto-targeting entry point the UI calls. Refuses outright
    if this source_classroom already has a ClassroomPromotion record -
    that's the single source of truth for "already promoted", independent
    of how many ACTIVE enrollments happen to remain in it.
    """
    existing = models.ClassroomPromotion.objects.select_related("target_classroom").filter(
        source_classroom=source_classroom
    ).first()
    if existing:
        target_label = str(existing.target_classroom) if existing.target_classroom else "graduation"
        raise ValueError(
            f"This class has already been promoted (to {target_label}) on "
            f"{existing.promoted_at:%d %b %Y, %H:%M} by "
            f"{existing.promoted_by.get_full_name() if existing.promoted_by else 'an admin'}. "
            "Ask an administrator to clear that record first if this needs to be redone."
        )

    next_grade = source_classroom.grade_level.next_grade

    if next_grade is None:
        # Top of the ladder (Grade 12 / Form 4) - nowhere to promote TO,
        # so this bulk action graduates the class instead.
        active = source_classroom.enrollments.filter(status=models.Enrollment.Status.ACTIVE)
        count = active.count()
        active.update(status=models.Enrollment.Status.GRADUATED)
        models.ClassroomPromotion.objects.create(
            source_classroom=source_classroom, target_classroom=None,
            promoted_by=promoted_by, student_count=count,
        )
        return {"promoted": [], "failed": [], "graduated_count": count, "target_classroom": None}

    target_classroom = get_or_create_next_classroom(source_classroom)
    results = bulk_promote_classroom(source_classroom, target_classroom, force=force)

    models.ClassroomPromotion.objects.create(
        source_classroom=source_classroom,
        target_classroom=target_classroom,
        promoted_by=promoted_by,
        student_count=len(results["promoted"]),
    )
    results["target_classroom"] = str(target_classroom)
    results["target_classroom_id"] = target_classroom.id
    results["graduated_count"] = 0
    return results


# ---------------------------------------------------------------------------
# FEES - carry-forward ledger, invoice-chain sync, STK push, receipts
# ---------------------------------------------------------------------------
def get_ledger_totals_bulk(student_ids):
    """
    THE single source of truth for student money. Every page (student
    portal, finance reports, receipts, clearance, fee reminders) must go
    through this so they all show the same number.

        balance = opening + charged - paid

      opening = brought_forward of the student's EARLIEST invoice
                (arrears from before the system had any invoice for them;
                 negative = credit). Later invoices' brought_forward is
                already just the previous invoice's balance rolled
                forward, so only the first one is genuine opening money.
      charged = sum(amount_due - brought_forward) over all invoices
                (each term's own fee, so nothing is double-counted)
      paid    = sum(amount_paid) over all invoices

    Returns {student_id: {"opening", "charged", "paid", "balance"}} as
    Decimals, in ONE query. Students with no invoices are absent.
    Positive balance = owes, negative = prepaid credit.
    """
    rows = (
        models.Invoice.objects.filter(enrollment__student_id__in=list(student_ids))
        .order_by(
            "enrollment__student_id",
            "fee_structure__term__academic_year__year",
            "fee_structure__term__term_number",
            "id",
        )
        .values("enrollment__student_id", "brought_forward", "amount_due", "amount_paid")
    )

    out = {}
    for r in rows:
        student_id = r["enrollment__student_id"]
        t = out.get(student_id)
        if t is None:
            # Rows are ordered oldest-first, so the first one per student
            # is their earliest invoice.
            t = out[student_id] = {
                "opening": r["brought_forward"],
                "charged": Decimal("0"),
                "paid": Decimal("0"),
            }
        t["charged"] += r["amount_due"] - r["brought_forward"]
        t["paid"] += r["amount_paid"]

    for t in out.values():
        t["balance"] = t["opening"] + t["charged"] - t["paid"]
    return out


def get_outstanding_balance(student: models.StudentProfile) -> Decimal:
    """
    Total fee balance for one student. Positive = owes, negative =
    prepaid credit. Uses get_ledger_totals_bulk so it always agrees with
    the finance reports and the invoice pages.
    """
    sync_invoice_chains([student.id])
    t = get_ledger_totals_bulk([student.id]).get(student.id)
    return t["balance"] if t else Decimal("0")


def get_total_outstanding_balance(student_ids=None) -> Decimal:
    """
    School-wide money still owed = sum of every student's POSITIVE ledger
    balance (credits are not netted against other students' debts).
    Counts alumni too, because alumni balances are real money owed.
    Pass student_ids to restrict it to a set of students.
    """
    if student_ids is None:
        student_ids = set(
            models.Invoice.objects.values_list("enrollment__student_id", flat=True).distinct()
        )
    ledger = get_ledger_totals_bulk(student_ids)
    return sum((t["balance"] for t in ledger.values() if t["balance"] > 0), Decimal("0"))


def sync_invoice_chains(student_ids=None) -> int:
    """
    Makes every invoice's stored figures agree with reality, in memory and
    with ONE bulk write. Safe to call often - it only writes rows that are
    actually wrong. Fixes, per student, oldest invoice first:

      1. amount_paid  = sum of that invoice's Payment rows
                        (catches payments edited/added outside record_payment)
      2. brought_forward = balance rolled in from the previous invoice
                        (the EARLIEST invoice keeps its own brought_forward:
                         that is the genuine opening balance)
      3. amount_due   = this term's own charge + brought_forward
                        (the term's own charge is preserved, so per-student
                         fee overrides survive)

    Pass student_ids=None to sync everybody. Returns how many invoices changed.
    """
    qs = (
        models.Invoice.objects.select_related("enrollment", "fee_structure__term")
        .order_by(
            "enrollment__student_id",
            "fee_structure__term__academic_year__year",
            "fee_structure__term__term_number",
            "id",
        )
    )
    if student_ids is not None:
        student_ids = list(student_ids)
        if not student_ids:
            return 0
        qs = qs.filter(enrollment__student_id__in=student_ids)

    invoices = list(qs)
    if not invoices:
        return 0

    paid_by_invoice = {
        row["invoice_id"]: row["total"] or Decimal("0")
        for row in models.Payment.objects.filter(invoice_id__in=[i.id for i in invoices])
        .values("invoice_id").annotate(total=Sum("amount"))
    }

    changed = []
    current_student, running = None, Decimal("0")
    for inv in invoices:
        sid = inv.enrollment.student_id
        is_first = sid != current_student
        if is_first:
            current_student = sid
            running = inv.brought_forward  # genuine opening balance (arrears / credit)

        own_charge = inv.amount_due - inv.brought_forward
        correct_bf = running
        correct_due = own_charge + correct_bf
        correct_paid = paid_by_invoice.get(inv.id, Decimal("0"))

        if (
            inv.brought_forward != correct_bf
            or inv.amount_due != correct_due
            or inv.amount_paid != correct_paid
        ):
            inv.brought_forward = correct_bf
            inv.amount_due = correct_due
            inv.amount_paid = correct_paid
            changed.append(inv)

        running = correct_due - correct_paid

    if changed:
        models.Invoice.objects.bulk_update(changed, ["brought_forward", "amount_due", "amount_paid"])
    return len(changed)


def invoice_money_rows(invoices_qs, extra_fields=()):
    """
    REPORT HELPER - avoids double-counting.

    Every invoice's amount_due already CONTAINS the balance brought in from
    earlier terms, so summing amount_due across several terms counts the
    same arrears again and again. This returns one dict per invoice with:

        charged    = this term's own fee            (amount_due - brought_forward)
        carried_in = balance entering the SET       (brought_forward of the
                     student's first invoice in `invoices_qs`, 0 for the rest)
        due        = charged + carried_in
        paid       = amount_paid
        outstanding= due - paid

    so sum(due) - sum(paid) over any set of consecutive invoices equals the
    student's true balance at the end of that set. Add `extra_fields`
    (ORM lookups) to carry classroom / gender / month info along.
    """
    base = ("id", "enrollment__student_id", "brought_forward", "amount_due", "amount_paid")
    qs = invoices_qs.order_by(
        "enrollment__student_id",
        "fee_structure__term__academic_year__year",
        "fee_structure__term__term_number",
        "id",
    ).values(*base, *extra_fields)

    rows, seen = [], set()
    for r in qs:
        sid = r["enrollment__student_id"]
        charged = r["amount_due"] - r["brought_forward"]
        carried = Decimal("0") if sid in seen else r["brought_forward"]
        seen.add(sid)
        r["charged"] = charged
        r["carried_in"] = carried
        r["due"] = charged + carried
        r["paid"] = r["amount_paid"]
        r["outstanding"] = r["due"] - r["paid"]
        rows.append(r)
    return rows


def carry_forward_balance(enrollment: models.Enrollment) -> Decimal:
    """
    Called when a student moves into a new academic year (promotion,
    repeating a year...). Guarantees the PREVIOUS balance is added to the
    new year:

      * brings all existing invoices up to date,
      * generates invoices for every term of the new year that has already
        started (each one folds the running balance into brought_forward),
      * if the new year's terms haven't started yet, nothing is lost: the
        balance simply stays on the last invoice and is picked up by the
        first invoice generated later (generate_invoice / daily job).

    A missing FeeStructure never blocks promotion; it raises the usual
    FeeStructureMissingAlert instead. Returns the student's balance now
    (positive = owes, negative = prepaid credit).
    """
    student = enrollment.student
    sync_invoice_chains([student.id])

    today = timezone.localdate()
    terms = models.Term.objects.filter(
        academic_year=enrollment.academic_year, start_date__lte=today
    ).order_by("term_number")
    for term in terms:
        try:
            generate_invoice(enrollment, term)
        except ValueError:
            _record_missing_fee_structure(enrollment.classroom.grade_level, term)

    sync_invoice_chains([student.id])
    return get_outstanding_balance(student)


def generate_invoice(enrollment: models.Enrollment, term: models.Term) -> models.Invoice:
    """
    Creates this term's invoice, automatically folding in whatever the
    student's running balance was from ALL EARLIER terms (including earlier
    academic years):
      - Unpaid arrears (positive balance) get ADDED to this term's fee.
      - A credit/prepaid balance (negative, from an earlier overpayment)
        gets SUBTRACTED from this term's fee.

    The carried balance is taken from the invoice immediately BEFORE this
    term, not from the student's grand total, so back-filling an older term
    can never pull a later term's charges into it. If this becomes the
    student's earliest invoice, it inherits the opening balance. The whole
    chain is re-synced afterwards, so later invoices stay correct.

    Calling this twice for the same enrollment/fee_structure is safe - it
    just returns the existing invoice.
    """
    fee_structure = models.FeeStructure.objects.filter(
        grade_level=enrollment.classroom.grade_level, term=term
    ).first()
    if not fee_structure:
        raise ValueError("No fee structure defined for this grade/term yet.")

    existing = models.Invoice.objects.filter(enrollment=enrollment, fee_structure=fee_structure).first()
    if existing:
        return existing

    student = enrollment.student
    sync_invoice_chains([student.id])  # make sure the balance we carry is current

    def key(inv):
        t = inv.fee_structure.term
        return (t.academic_year.year, t.term_number)

    all_invoices = list(
        models.Invoice.objects.filter(enrollment__student=student)
        .select_related("fee_structure__term__academic_year")
    )
    this_key = (term.academic_year.year, term.term_number)
    prior = sorted((i for i in all_invoices if key(i) < this_key), key=lambda i: (key(i), i.id))
    later = sorted((i for i in all_invoices if key(i) > this_key), key=lambda i: (key(i), i.id))

    if prior:
        last = prior[-1]
        brought_forward = last.amount_due - last.amount_paid
    elif later:
        brought_forward = later[0].brought_forward  # opening balance moves to the new earliest invoice
    else:
        brought_forward = Decimal("0")

    invoice = models.Invoice.objects.create(
        enrollment=enrollment,
        fee_structure=fee_structure,
        brought_forward=brought_forward,
        amount_due=fee_structure.total_amount + brought_forward,
    )
    sync_invoice_chains([student.id])
    invoice.refresh_from_db()
    return invoice


def _max_receipt_seq() -> int:
    best = 0
    for model in (models.Payment, models.OtherPayment):
        last = (
            model.objects.filter(receipt_no__regex=r"^RCT-\d+$")
            .annotate(rn_len=Length("receipt_no"))
            .order_by("-rn_len", "-receipt_no")
            .first()
        )
        if last:
            try:
                best = max(best, int(last.receipt_no.split("-")[-1]))
            except (ValueError, TypeError):
                pass
    return best


def generate_receipt_no() -> str:
    """RCT-0001 ... RCT-9999, RCT-10000 ... shared by school-fee and other payments."""
    return f"RCT-{_max_receipt_seq() + 1:04d}"


def recalculate_student_invoice_chain(student: models.StudentProfile):
    """
    Recomputes brought_forward / amount_due / amount_paid for ONE student's
    whole invoice chain (see sync_invoice_chains for exactly what is fixed
    and what is preserved). Kept as a thin wrapper so every existing caller
    keeps working. Returns the ids of the invoices that changed.
    """
    before = {
        i["id"]: (i["brought_forward"], i["amount_due"], i["amount_paid"])
        for i in models.Invoice.objects.filter(enrollment__student=student)
        .values("id", "brought_forward", "amount_due", "amount_paid")
    }
    sync_invoice_chains([student.id])
    after = {
        i["id"]: (i["brought_forward"], i["amount_due"], i["amount_paid"])
        for i in models.Invoice.objects.filter(enrollment__student=student)
        .values("id", "brought_forward", "amount_due", "amount_paid")
    }
    return [iid for iid, vals in after.items() if before.get(iid) != vals]


def record_payment(invoice: models.Invoice, amount: Decimal, method: str, reference: str, recorded_by):
    """
    Records a payment against an invoice, then immediately recalculates
    that student's ENTIRE invoice chain so every later invoice's
    brought_forward/amount_due reflects what was just paid - regardless
    of which invoice (oldest or not) the payment landed on.
    """
    payment = models.Payment.objects.create(
        invoice=invoice, amount=amount, method=method, reference=reference,
        recorded_by=recorded_by, receipt_no=generate_receipt_no(),
    )
    invoice.amount_paid = invoice.payments.aggregate(total=Sum("amount"))["total"] or 0
    invoice.save(update_fields=["amount_paid"])

    recalculate_student_invoice_chain(invoice.enrollment.student)
    invoice.refresh_from_db()  # amount_due/brought_forward may have just changed above

    return payment


def _get_mpesa_access_token() -> str:
    response = requests.get(
        f"{settings.MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials",
        auth=(settings.MPESA_CONSUMER_KEY, settings.MPESA_CONSUMER_SECRET),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def initiate_payment(invoice, phone_number, amount, initiated_by, general=False):
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")

    student = invoice.enrollment.student

    if settings.DEBUG:
        if general:
            payments = record_bulk_payment(
                student, amount, models.Payment.Method.MPESA,
                reference="DEBUG-BYPASS", recorded_by=initiated_by,
            )
        else:
            payments = [record_payment(
                invoice, amount, models.Payment.Method.MPESA,
                reference="DEBUG-BYPASS", recorded_by=initiated_by,
            )]
        return {"status": "COMPLETED", "payment": payments[-1], "payments": payments}

    # ---- production: real Safaricom Daraja STK Push ----
    access_token = _get_mpesa_access_token()
    timestamp = timezone.now().strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(
        f"{settings.MPESA_SHORTCODE}{settings.MPESA_PASSKEY}{timestamp}".encode()
    ).decode()

    payload = {
        "BusinessShortCode": settings.MPESA_SHORTCODE,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": int(amount),
        "PartyA": phone_number,
        "PartyB": settings.MPESA_SHORTCODE,
        "PhoneNumber": phone_number,
        "CallBackURL": settings.MPESA_CALLBACK_URL,
        "AccountReference": f"FEES-{student.admission_no}" if general else f"FEES-{invoice.id}",
        "TransactionDesc": f"School fees - {student.admission_no}",
    }
    response = requests.post(
        f"{settings.MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest",
        json=payload,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    data = response.json()

    stk_request = models.MpesaSTKPushRequest.objects.create(
        invoice=invoice,
        is_general=general,
        phone_number=phone_number,
        amount=amount,
        checkout_request_id=data.get("CheckoutRequestID"),
        merchant_request_id=data.get("MerchantRequestID", ""),
        status=models.MpesaSTKPushRequest.Status.PENDING,
        initiated_by=initiated_by,
    )
    return {"status": "PENDING", "stk_request": stk_request, "raw_response": data}


@transaction.atomic
def handle_mpesa_callback(payload: dict):
    """
    Processes Safaricom's STK push callback:
    { "Body": { "stkCallback": {
          "CheckoutRequestID": "...", "ResultCode": 0,
          "CallbackMetadata": { "Item": [{"Name": "Amount", ...}, {"Name": "MpesaReceiptNumber", ...}] }
    }}}
    ResultCode 0 = success; anything else = failed/cancelled by the user.
    """
    callback = payload.get("Body", {}).get("stkCallback", {})
    checkout_id = callback.get("CheckoutRequestID")
    result_code = callback.get("ResultCode")

    stk_request = models.MpesaSTKPushRequest.objects.filter(checkout_request_id=checkout_id).first()
    if not stk_request or stk_request.status != models.MpesaSTKPushRequest.Status.PENDING:
        return None

    if result_code == 0:
        items = {i.get("Name"): i.get("Value") for i in callback.get("CallbackMetadata", {}).get("Item", [])}
        mpesa_receipt = items.get("MpesaReceiptNumber", "")
        amount = Decimal(str(items.get("Amount", stk_request.amount)))
        Method = models.Payment.Method

        if stk_request.is_general:
            payments = record_bulk_payment(
                stk_request.invoice.enrollment.student, amount, Method.MPESA,
                reference=mpesa_receipt, recorded_by=stk_request.initiated_by,
            )
            payment = payments[-1]
        else:
            payment = record_payment(
                stk_request.invoice, amount, Method.MPESA,
                reference=mpesa_receipt, recorded_by=stk_request.initiated_by,
            )

        stk_request.status = models.MpesaSTKPushRequest.Status.COMPLETED
        stk_request.mpesa_receipt_number = mpesa_receipt
        stk_request.save(update_fields=["status", "mpesa_receipt_number"])
        return payment

    stk_request.status = models.MpesaSTKPushRequest.Status.FAILED
    stk_request.result_description = callback.get("ResultDesc", "")
    stk_request.save(update_fields=["status", "result_description"])
    return None


def generate_receipt_qr_base64(payment: models.Payment) -> str:
    """
    Encodes a QR code linking to the public receipt-verification page, so
    anyone (a bursar, an auditor, the parent themselves) can scan a printed
    receipt and confirm it's genuine without trusting the paper alone.
    """
    verify_url = f"{settings.FRONTEND_URL}/verify-receipt/{payment.receipt_no}"
    img = qrcode.make(verify_url)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def record_bulk_payment(student: models.StudentProfile, amount: Decimal, method: str, reference: str, recorded_by):
    """
    Pays a student's TOTAL outstanding balance in one call, applying it
    oldest-invoice-first. Re-queries the student's invoices after EVERY
    payment (rather than working off a list computed once up front)
    because record_payment() now recalculates the whole chain each time,
    which can shrink a later invoice's balance mid-loop.
    """
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")

    sync_invoice_chains([student.id])
    remaining = Decimal(amount)
    payments = []

    while remaining > 0:
        invoice = (
            models.Invoice.objects.filter(enrollment__student=student, amount_due__gt=F("amount_paid"))
            .select_related("fee_structure__term")
            .order_by("fee_structure__term__academic_year__year", "fee_structure__term__term_number")
            .first()
        )
        if not invoice:
            break  # every invoice is fully settled
        pay_amount = min(remaining, invoice.balance)
        payments.append(record_payment(invoice, pay_amount, method, reference, recorded_by))
        remaining -= pay_amount

    if remaining > 0:
        # Every invoice fully settled but money's left over - park it as
        # credit on the most recent invoice, same as an ordinary
        # single-invoice overpayment.
        target = (
            models.Invoice.objects.filter(enrollment__student=student)
            .order_by("-fee_structure__term__academic_year__year", "-fee_structure__term__term_number")
            .first()
        )
        if not target:
            raise ValueError("This student has no invoices yet - nothing to pay against.")
        payments.append(record_payment(target, remaining, method, reference, recorded_by))

    if not payments:
        raise ValueError("This student has no invoices yet - nothing to pay against.")

    return payments


# ---------------------------------------------------------------------------
# INVOICE GENERATION ENGINE (the daily scheduled job runs this)
# ---------------------------------------------------------------------------
def _terms_to_process(academic_year: "models.AcademicYear"):
    """
    Every term of the given academic year that has already started
    (start_date in the past or today).

    Processing every started term - not just the one flagged is_current -
    is what gives the engine its backfill behaviour for free: if Term 1's
    invoices were never generated (e.g. its FeeStructure was only added
    after the fact), running this while Term 2 is current still catches
    Term 1, because Term 1's start_date is still <= today.
    """
    today = timezone.now().date()
    return models.Term.objects.filter(
        academic_year=academic_year, start_date__lte=today
    ).order_by("term_number")


def _record_missing_fee_structure(grade_level, term, affected_count=None):
    """
    Creates or refreshes the FeeStructureMissingAlert for (grade_level, term).

    Pass affected_count when you know the precise number (the nightly
    engine always does, since it processes a whole grade at once). Leave
    it None for an ad-hoc single-student call (e.g. right after admitting
    one new student mid-term) so it doesn't stomp a more accurate count
    that a previous full run already recorded - the next nightly run
    corrects the count regardless.
    """
    alert, created = models.FeeStructureMissingAlert.objects.get_or_create(
        grade_level=grade_level,
        term=term,
        defaults={"affected_student_count": affected_count or 1},
    )
    if not created:
        alert.is_resolved = False
        alert.resolved_at = None
        if affected_count is not None:
            alert.affected_student_count = affected_count
        alert.save(update_fields=["is_resolved", "resolved_at", "affected_student_count"])
    return alert


def _resolve_fee_structure_alert(grade_level, term):
    models.FeeStructureMissingAlert.objects.filter(
        grade_level=grade_level, term=term, is_resolved=False
    ).update(is_resolved=True, resolved_at=timezone.now())


def generate_invoices_for_term(term: "models.Term", enrollments=None) -> dict:
    """
    Generates (or backfills) invoices for every ACTIVE enrollment, for one
    term, across EVERY grade level at once.

    Idempotent: generate_invoice() already returns the existing invoice
    instead of duplicating one (see its `existing = ...` check), so this
    is completely safe to run repeatedly - a student never gets billed
    twice for the same term no matter how many times the job fires.

    Students whose grade has no FeeStructure configured for this term are
    counted and rolled into a FeeStructureMissingAlert instead of raising
    - one bad/missing fee structure never blocks the other grades from
    being invoiced in the same run.

    Every new invoice carries the student's previous balance (including from
    earlier academic years) via generate_invoice().
    """
    if enrollments is None:
        enrollments = models.Enrollment.objects.filter(
            academic_year=term.academic_year, status=models.Enrollment.Status.ACTIVE
        ).select_related("classroom__grade_level", "student__user")

    created, already_existed, missing_fee_structures = [], [], {}

    # Group by grade so FeeStructure is looked up once per grade (not once
    # per student) - this is what makes "run across all classes" cheap:
    # one query per grade rather than one per student per grade.
    by_grade = {}
    for enrollment in enrollments:
        by_grade.setdefault(enrollment.classroom.grade_level_id, []).append(enrollment)

    for grade_enrollments in by_grade.values():
        grade_level = grade_enrollments[0].classroom.grade_level
        fee_structure = models.FeeStructure.objects.filter(
            grade_level=grade_level, term=term
        ).first()

        if not fee_structure:
            _record_missing_fee_structure(grade_level, term, len(grade_enrollments))
            missing_fee_structures[grade_level.name] = len(grade_enrollments)
            continue

        # This grade/term is fully configured this run - clear any stale alert.
        _resolve_fee_structure_alert(grade_level, term)

        for enrollment in grade_enrollments:
            existing = models.Invoice.objects.filter(
                enrollment=enrollment, fee_structure=fee_structure
            ).first()
            if existing:
                already_existed.append(existing.id)
                continue
            invoice = generate_invoice(enrollment, term)
            created.append(invoice.id)

    return {
        "term": str(term),
        "invoices_created": len(created),
        "invoices_already_existed": len(already_existed),
        "missing_fee_structures": missing_fee_structures,
    }


def run_daily_invoice_generation() -> dict:
    """
    Entry point for the scheduled job (scheduler.py / management command).

    For the CURRENT academic year only, walks every term that has already
    started and generates/backfills invoices for every active enrollment,
    across every grade level in one pass. Concretely, this means:

      - A student admitted TODAY gets billed for the current term the
        next time this job runs (it's also triggered immediately on
        admission - see the hook in StudentEnrollSerializer.create()).
      - If an earlier term in the SAME academic year was never invoiced
        for some students (e.g. their FeeStructure only got configured
        after that term had already started), it gets backfilled
        automatically the next time this runs - no manual re-run needed.
      - A grade with no FeeStructure yet doesn't block anything else;
        it's flagged via FeeStructureMissingAlert and simply picked up
        automatically once ICT/Finance adds the missing FeeStructure.
      - Finally every student's invoice chain is re-synced so the
        brought_forward / amount_due / amount_paid figures on all
        invoices are current (previous-year balances included).

    Deliberately scoped to the CURRENT academic year only for GENERATING
    invoices - a past cohort's invoices are historical records and are never
    regenerated by this job (their figures are only re-synced).
    """
    current_year = models.AcademicYear.objects.filter(is_current=True).first()
    if not current_year:
        return {"detail": "No current academic year is configured.", "results": []}

    terms = _terms_to_process(current_year)
    if not terms.exists():
        return {
            "detail": "No terms have started yet for the current academic year.",
            "results": [],
        }

    active_enrollments = models.Enrollment.objects.filter(
        academic_year=current_year, status=models.Enrollment.Status.ACTIVE
    ).select_related("classroom__grade_level", "student__user")

    results = [generate_invoices_for_term(term, active_enrollments) for term in terms]
    synced = sync_invoice_chains()

    return {
        "academic_year": current_year.year,
        "terms_processed": len(results),
        "invoices_resynced": synced,
        "results": results,
    }


# ---------------------------------------------------------------------------
# PARENTS / GUARDIANS
# ---------------------------------------------------------------------------
def attach_guardian(
    student: models.StudentProfile,
    full_name: str,
    phone_number: str,
    relationship: str,
    email: str = "",
):
    """
    Links a parent/guardian to a newly admitted student.

    Reuses an existing ParentGuardianProfile if a PARENT user with this
    exact phone number already exists (e.g. admitting a second child of
    the same parent) instead of creating a duplicate account/login for
    the same person.

    If an existing parent has no email and a new email is provided,
    the parent's email is updated.

    Only creates a new User + ParentGuardianProfile when no matching
    parent account is found.
    """
    existing_user = models.User.objects.filter(
        role=models.User.Role.PARENT,
        phone_number=phone_number
    ).first()

    if existing_user:
        guardian_profile, _ = models.ParentGuardianProfile.objects.get_or_create(
            user=existing_user
        )

        # Add email to existing parent if they don't already have one.
        if email and not existing_user.email:
            existing_user.email = email
            existing_user.save(update_fields=["email"])

    else:
        name_parts = full_name.split(" ", 1) if full_name else ["Guardian"]

        first_name = name_parts[0]
        last_name = name_parts[1] if len(name_parts) > 1 else ""

        # Phone number doubles as the login username for parents.
        # Guard against username collisions.
        username = phone_number
        suffix = 1

        while models.User.objects.filter(username=username).exists():
            suffix += 1
            username = f"{phone_number}-{suffix}"

        guardian_user = models.User.objects.create(
            username=username,
            first_name=first_name,
            last_name=last_name,
            phone_number=phone_number,
            email=email,
            role=models.User.Role.PARENT,
        )

        # The parent's initial login password is their own phone number,
        # not a shared default.
        guardian_user.set_password(phone_number)
        guardian_user.save()

        guardian_profile = models.ParentGuardianProfile.objects.create(
            user=guardian_user
        )

    models.ParentStudentLink.objects.get_or_create(
        parent=guardian_profile,
        student=student,
        defaults={
            "relationship": relationship,
        },
    )

    return guardian_profile


def upsert_guardian(
    student: models.StudentProfile,
    full_name: str,
    phone_number: str,
    relationship: str,
    email: str = "",
):
    """
    Used by the admin Edit-Student form to keep "one guardian per student"
    in sync with whatever's typed in the form.

    - If the student already has a guardian with the same phone number,
      update their relationship, name, and email in place.
    - If the phone number changed, remove the old guardian link and attach
      the new guardian through attach_guardian().
    - attach_guardian() handles reusing an existing PARENT account with
      the same phone number.
    - This intentionally supports one guardian per student through this form.
      Students with multiple guardians can still be managed directly via
      the parent-links endpoints.
    """
    if not phone_number:
        return None

    existing_links = (
        models.ParentStudentLink.objects
        .filter(student=student)
        .select_related("parent__user")
    )

    match = existing_links.filter(
        parent__user__phone_number=phone_number
    ).first()

    if match:
        # Update relationship
        if match.relationship != relationship:
            match.relationship = relationship
            match.save(update_fields=["relationship"])

        # Update guardian name
        if full_name and match.parent.user.get_full_name() != full_name:
            parts = full_name.split(" ", 1)

            match.parent.user.first_name = parts[0]
            match.parent.user.last_name = parts[1] if len(parts) > 1 else ""

            match.parent.user.save(
                update_fields=["first_name", "last_name"]
            )

        # Update guardian email
        if email and match.parent.user.email != email:
            match.parent.user.email = email
            match.parent.user.save(update_fields=["email"])

        return match.parent

    # Phone number changed / no matching guardian.
    # Remove the old guardian link(s) and attach the new/reused guardian.
    existing_links.delete()

    return attach_guardian(
        student,
        full_name,
        phone_number,
        relationship,
        email,
    )


# ---------------------------------------------------------------------------
# COMMUNICATIONS & MESSAGING
# ---------------------------------------------------------------------------
def send_sms_notification(phone_number, message):
    """
    Placeholder SMS gateway. Wire this up to Africa's Talking, Twilio, etc.
    Mirrors the DEBUG-bypass pattern already used for M-Pesa STK push
    (see initiate_payment): in DEBUG we simulate a successful send instead
    of calling a real API, so the whole flow is testable with no credentials.
    Returns (ok: bool, error_message: str).
    """
    if not phone_number:
        return False, "No phone number on file."
    if settings.DEBUG:
        print(f"[DEBUG SMS] To {phone_number}: {message}")
        return True, ""
    # TODO: call your SMS provider here, e.g. Africa's Talking:
    #   africastalking.SMS.send(message, [phone_number])
    return False, "SMS gateway not configured for production."


def send_email_notification(to_email, subject, body):
    """Returns (ok: bool, error_message: str)."""
    if not to_email:
        return False, "No email address on file."
    try:
        send_mail(subject, body, getattr(settings, "DEFAULT_FROM_EMAIL", None), [to_email], fail_silently=False)
        return True, ""
    except Exception as exc:  # noqa: BLE001 - surfaced to CommunicationRecipient.error_message
        return False, str(exc)


def resolve_communication_audience(communication):
    """
    Returns a list of (user, student_or_None) pairs for `communication`,
    respecting include_students / include_guardians. student_or_None is
    the StudentProfile this row concerns, used for fee-balance
    personalization - None for role-wide broadcasts with no student
    context (e.g. "all Teachers").
    """
    students_qs = models.StudentProfile.objects.none()

    if communication.audience_type == models.Communication.AudienceType.ROLE:
        users = models.User.objects.filter(
            role__in=communication.target_roles, is_active_staff=True
        ).distinct()
        return [(u, None) for u in users]

    if communication.audience_type == models.Communication.AudienceType.GRADE:
        enrollments = models.Enrollment.objects.filter(
            status=models.Enrollment.Status.ACTIVE,
            classroom__grade_level=communication.grade_level,
        )
        if communication.academic_year_id:
            enrollments = enrollments.filter(academic_year=communication.academic_year)
        students_qs = models.StudentProfile.objects.filter(id__in=enrollments.values("student_id"))

    elif communication.audience_type == models.Communication.AudienceType.CLASSROOM:
        enrollments = models.Enrollment.objects.filter(
            status=models.Enrollment.Status.ACTIVE, classroom=communication.classroom
        )
        students_qs = models.StudentProfile.objects.filter(id__in=enrollments.values("student_id"))

    elif communication.audience_type == models.Communication.AudienceType.INDIVIDUAL:
        students_qs = communication.target_students.all()

    students_qs = students_qs.select_related("user")
    pairs = {}  # user_id -> (user, student) - a guardian with 2 targeted kids collapses to 1 row

    if communication.include_students:
        for student in students_qs:
            pairs[student.user_id] = (student.user, student)

    if communication.include_guardians:
        links = models.ParentStudentLink.objects.filter(student__in=students_qs).select_related(
            "parent__user", "student"
        )
        for link in links:
            guardian_user = link.parent.user
            # Keep the first linked student as the "primary" context for
            # this guardian; _personalize_fee_body below still lists ALL
            # of the guardian's targeted children, not just this one.
            pairs.setdefault(guardian_user.id, (guardian_user, link.student))

    return list(pairs.values())


def _personalize_fee_body(communication, user, primary_student):
    """
    For FEE_REMINDER communications, append each relevant student's live
    outstanding balance. Falls back to the plain body for every other category.
    """
    if communication.category != models.Communication.Category.FEE_REMINDER:
        return communication.body

    if user.role == models.User.Role.STUDENT:
        students = [primary_student] if primary_student else []
    elif user.role == models.User.Role.PARENT:
        target_ids = communication.target_students.values_list("id", flat=True)
        students = list(models.StudentProfile.objects.filter(id__in=target_ids, guardians__user=user))
    else:
        students = []

    if not students:
        return communication.body

    sync_invoice_chains([s.id for s in students])  # reminders must quote the up-to-date balance

    lines = [communication.body, ""]
    for student in students:
        balance = get_outstanding_balance(student)
        lines.append(f"{student.user.get_full_name()} ({student.admission_no}): KES {balance:,.2f} outstanding")
    return "\n".join(lines)


def send_communication(communication):
    """
    Resolves the audience, creates a CommunicationRecipient row per
    (user, channel), and dispatches each enabled channel immediately.
    Synchronous by design - there's no task queue in this project yet.
    If send volumes grow, move the per-recipient loop into a Celery task
    without changing this function's signature.
    """
    audience = resolve_communication_audience(communication)

    channels = []
    if communication.send_in_app:
        channels.append(models.CommunicationRecipient.Channel.IN_APP)
    if communication.send_sms:
        channels.append(models.CommunicationRecipient.Channel.SMS)
    if communication.send_email:
        channels.append(models.CommunicationRecipient.Channel.EMAIL)

    created = []
    for user, student in audience:
        body = _personalize_fee_body(communication, user, student)
        for channel in channels:
            recipient, _ = models.CommunicationRecipient.objects.get_or_create(
                communication=communication, user=user, channel=channel,
                defaults={"personalized_body": body},
            )
            if channel == models.CommunicationRecipient.Channel.IN_APP:
                recipient.status = models.CommunicationRecipient.Status.SENT
                recipient.sent_at = timezone.now()
            elif channel == models.CommunicationRecipient.Channel.SMS:
                ok, err = send_sms_notification(user.phone_number, body)
                recipient.status = (
                    models.CommunicationRecipient.Status.SENT if ok else models.CommunicationRecipient.Status.FAILED
                )
                recipient.error_message = err
                recipient.sent_at = timezone.now() if ok else None
            elif channel == models.CommunicationRecipient.Channel.EMAIL:
                ok, err = send_email_notification(user.email, communication.subject, body)
                recipient.status = (
                    models.CommunicationRecipient.Status.SENT if ok else models.CommunicationRecipient.Status.FAILED
                )
                recipient.error_message = err
                recipient.sent_at = timezone.now() if ok else None
            recipient.save()
            created.append(recipient)
    return created


# ---------------------------------------------------------------------------
# BULK CLASSROOM CREATION
# ---------------------------------------------------------------------------
def bulk_create_classrooms(academic_year, grade_level_ids, stream_ids):
    """
    Creates one ClassRoom for every (grade_level x stream) combination for
    the given academic_year. Idempotent - if a classroom already exists
    for a given combination (unique_together on ClassRoom), it's skipped
    rather than erroring, so this is safe to re-run e.g. after adding a
    new stream mid-year.
    """
    grade_levels = models.GradeLevel.objects.filter(id__in=grade_level_ids)
    streams = models.Stream.objects.filter(id__in=stream_ids)

    created, skipped = [], []
    for grade_level in grade_levels:
        for stream in streams:
            obj, was_created = models.ClassRoom.objects.get_or_create(
                grade_level=grade_level, stream=stream, academic_year=academic_year,
            )
            (created if was_created else skipped).append(obj)

    return {"created": created, "skipped": skipped}


# ---------------------------------------------------------------------------
# TIMETABLE MANAGEMENT
# ---------------------------------------------------------------------------
def get_unallocated_subjects(academic_year, classroom=None):
    """
    For each classroom in academic_year (or just one, if given), returns the
    subjects that GradeSubject says are offered at that grade but have no
    TeacherSubjectAllocation row yet. This is what powers the "Unallocated
    Subjects" tab on the Teacher Allocation page.
    """
    classrooms = models.ClassRoom.objects.filter(academic_year=academic_year).select_related(
        "grade_level", "stream"
    )
    if classroom:
        classrooms = classrooms.filter(pk=classroom.pk)

    result = []
    for room in classrooms:
        offered_ids = set(
            models.GradeSubject.objects.filter(grade_level=room.grade_level).values_list("subject_id", flat=True)
        )
        allocated_ids = set(
            models.TeacherSubjectAllocation.objects.filter(
                classroom=room, academic_year=academic_year
            ).values_list("subject_id", flat=True)
        )
        missing_ids = offered_ids - allocated_ids
        if missing_ids:
            result.append({"classroom": room, "subjects": models.Subject.objects.filter(id__in=missing_ids)})
    return result


def full_allocation_check(academic_year):
    """True/False + the gap list - the auto-generator's precondition."""
    gaps = get_unallocated_subjects(academic_year)
    return (len(gaps) == 0, gaps)


@transaction.atomic
def auto_generate_timetable(term):
    """
    Greedy weekly scheduler. Preconditions: every classroom in
    term.academic_year must have every offered subject allocated to a
    teacher (see full_allocation_check) - raises ValueError otherwise so
    the frontend can show exactly which classroom/subject is still open.

    TEACHER CLASH RULE:
    A teacher may only be in ONE (subject, classroom) at a time, with a
    single deliberate exception: if the SAME teacher teaches the SAME
    subject to a DIFFERENT stream of the SAME grade (e.g. Form 4 Blue and
    Form 4 Red both doing Maths with the same teacher), those lessons are
    allowed to share the same slot - that's a genuinely combined class,
    not a double-booking. Any other overlap (different subject, and/or
    different grade) is always blocked, no exceptions.

    Classrooms are processed grade-by-grade, then stream name
    alphabetically (e.g. "Form 4 Blue" before "Form 4 Red"), so that when
    the second stream's allocation is placed, the scheduler actively
    looks for the slot where the first stream's matching (teacher,
    subject, grade) lesson already sits and tries to land on it - this is
    what makes combining actually happen, rather than the two streams
    merely avoiding a clash in unrelated slots.

    Algorithm (per classroom, subjects interleaved so the same subject
    doesn't cluster on one day):
      - build a "todo" queue from each TeacherSubjectAllocation's
        periods_per_week / double_lesson
      - walk the week's days in round-robin, and for each todo item:
          1. FIRST try to align onto a slot where this exact teacher is
             already teaching this exact subject to a sibling classroom
             in the same grade (the "combine" pass).
          2. Otherwise fall back to the normal search: the first day
             where the subject hasn't already been placed that day
             (skipped for double lessons) AND there's a free block of
             the right size AND the teacher has no clashing booking
             elsewhere (clashing = a different subject or grade).
      - anything that can't be placed after a full pass is reported back
        as "skipped" for manual placement on the grid

    This clears and regenerates only the slots this function created for
    this term/classroom that are still auto_generated=True (hand-placed
    entries are left alone) before writing the new layout.
    """
    ok, gaps = full_allocation_check(term.academic_year)
    if not ok:
        raise ValueError({
            "detail": "Cannot auto-generate: some classrooms still have unallocated subjects.",
            "gaps": [
                {"classroom": str(g["classroom"]), "subjects": [s.name for s in g["subjects"]]}
                for g in gaps
            ],
        })

    lesson_slots_by_day = defaultdict(list)
    for slot in models.PeriodSlot.objects.filter(slot_type=models.PeriodSlot.SlotType.LESSON).order_by(
        "day", "order"
    ):
        lesson_slots_by_day[slot.day].append(slot)
    days = [d for d, _ in models.PeriodSlot.Day.choices if d in lesson_slots_by_day]
    if not days:
        raise ValueError({"detail": "No LESSON period slots configured yet. Set up the timetable structure first."})

    # Deterministic order: grade level sequence, then stream name -
    # e.g. Form 4 Blue is fully placed before Form 4 Red is attempted,
    # so Red's matching allocations have something to combine onto.
    classrooms = models.ClassRoom.objects.filter(academic_year=term.academic_year).select_related(
        "grade_level", "stream"
    ).order_by("grade_level__level_order", "stream__name")

    # Wipe only the auto-generated entries for this term - manual edits survive.
    models.TimetableEntry.objects.filter(term=term, auto_generated=True).delete()

    # period_slot_id -> teacher_id -> [(subject_id, grade_level_id, classroom_id), ...]
    teacher_busy = defaultdict(lambda: defaultdict(list))
    for entry in models.TimetableEntry.objects.filter(term=term).select_related(
        "allocation__subject", "classroom__grade_level"
    ):
        teacher_busy[entry.period_slot_id][entry.allocation.teacher_id].append(
            (entry.allocation.subject_id, entry.classroom.grade_level_id, entry.classroom_id)
        )

    def bookings_compatible(bookings, subject_id, grade_level_id):
        """True if the teacher's existing bookings at this slot are all the
        SAME subject+grade as what we're trying to place (i.e. combinable),
        or if there are no existing bookings at all."""
        if not bookings:
            return True
        return all(b_subject == subject_id and b_grade == grade_level_id for b_subject, b_grade, _ in bookings)

    def has_matching_presence(bookings, subject_id, grade_level_id):
        """True if the teacher already has a compatible booking here that we
        could combine onto (used only for the 'prefer to align' pass)."""
        return bool(bookings) and bookings_compatible(bookings, subject_id, grade_level_id)

    created, skipped = [], []

    for classroom in classrooms:
        allocations = models.TeacherSubjectAllocation.objects.filter(
            classroom=classroom, academic_year=term.academic_year
        ).select_related("teacher", "subject")

        queue = []
        for alloc in allocations:
            periods = alloc.periods_per_week or 5
            if alloc.double_lesson:
                pairs, remainder = divmod(periods, 2)
                queue += [(alloc, 2)] * pairs + ([(alloc, 1)] if remainder else [])
            else:
                queue += [(alloc, 1)] * periods

        # Interleave so the same subject isn't queued back-to-back.
        by_subject = defaultdict(list)
        for item in queue:
            by_subject[item[0].subject_id].append(item)
        interleaved = []
        while any(by_subject.values()):
            for subj_id in list(by_subject):
                if by_subject[subj_id]:
                    interleaved.append(by_subject[subj_id].pop(0))
        queue = interleaved

        day_cycle = cycle(days)
        subjects_placed_today = defaultdict(set)  # day -> {subject_id, ...}

        # Occupied slots for THIS classroom, refreshed as we place entries.
        classroom_occupied = set(
            models.TimetableEntry.objects.filter(classroom=classroom, term=term).values_list(
                "period_slot_id", flat=True
            )
        )

        for alloc, block_size in queue:
            placed = False
            grade_level_id = classroom.grade_level_id

            # ---- Pass 1: try to COMBINE onto a slot where this teacher
            # already teaches this exact subject to a sibling stream of
            # the same grade. ----
            for day in days:
                if placed:
                    break
                if alloc.subject_id in subjects_placed_today[day] and not alloc.double_lesson:
                    continue
                slots = lesson_slots_by_day[day]
                for start in range(len(slots) - block_size + 1):
                    block = slots[start:start + block_size]
                    if any(s.id in classroom_occupied for s in block):
                        continue
                    if not all(
                        has_matching_presence(
                            teacher_busy[s.id].get(alloc.teacher_id, []), alloc.subject_id, grade_level_id
                        )
                        for s in block
                    ):
                        continue
                    for s in block:
                        entry = models.TimetableEntry.objects.create(
                            classroom=classroom, period_slot=s, term=term, allocation=alloc,
                            is_double=(block_size == 2), auto_generated=True,
                        )
                        created.append(entry.id)
                        classroom_occupied.add(s.id)
                        teacher_busy[s.id][alloc.teacher_id].append((alloc.subject_id, grade_level_id, classroom.id))
                    subjects_placed_today[day].add(alloc.subject_id)
                    placed = True
                    break

            if placed:
                continue

            # ---- Pass 2: normal search. A teacher may be placed here only
            # if they have no OTHER-subject/OTHER-grade booking in this
            # slot; a matching (same subject+grade) booking is fine too,
            # it just means Pass 1 will find it next time. ----
            for _ in range(len(days) * 2):  # bounded attempts across the week
                day = next(day_cycle)
                if alloc.subject_id in subjects_placed_today[day] and not alloc.double_lesson:
                    continue
                slots = lesson_slots_by_day[day]
                for start in range(len(slots) - block_size + 1):
                    block = slots[start:start + block_size]
                    if any(s.id in classroom_occupied for s in block):
                        continue
                    if any(
                        not bookings_compatible(
                            teacher_busy[s.id].get(alloc.teacher_id, []), alloc.subject_id, grade_level_id
                        )
                        for s in block
                    ):
                        continue
                    for s in block:
                        entry = models.TimetableEntry.objects.create(
                            classroom=classroom, period_slot=s, term=term, allocation=alloc,
                            is_double=(block_size == 2), auto_generated=True,
                        )
                        created.append(entry.id)
                        classroom_occupied.add(s.id)
                        teacher_busy[s.id][alloc.teacher_id].append((alloc.subject_id, grade_level_id, classroom.id))
                    subjects_placed_today[day].add(alloc.subject_id)
                    placed = True
                    break
                if placed:
                    break
            if not placed:
                skipped.append({
                    "classroom": str(classroom), "subject": alloc.subject.name,
                    "teacher": alloc.teacher.get_full_name(),
                })

    return {"created_count": len(created), "skipped": skipped}


# ---------------------------------------------------------------------------
# ADMIN CROSS-SUBJECT MARK SPREADSHEET
# ---------------------------------------------------------------------------
def get_admin_exam_spreadsheet(classroom: models.ClassRoom, exam: models.Exam) -> dict:
    grade_level = classroom.grade_level
    subject_ids = list(
        models.GradeSubject.objects.filter(grade_level=grade_level).values_list("subject_id", flat=True)
    )
    subjects = (
        models.Subject.objects.filter(id__in=subject_ids)
        .prefetch_related("papers")
        .order_by("name")
    )

    subject_payload = []
    for s in subjects:
        # Per-exam setup saved by a teacher / class teacher (None if nobody set it up yet)
        configured = get_exam_paper_columns(exam, s)
        if configured:
            columns = [
                {
                    "paper_id": c["paper_id"],
                    "label": s.code if c["paper_number"] == 0 else f"{s.code} {c['name']}",
                    "max_marks": c["max_marks"],
                }
                for c in configured
            ]
            paper_setup = [
                {"paper_number": c["paper_number"], "name": c["name"], "max_marks": c["max_marks"]}
                for c in configured
            ]
        else:
            # Old behaviour: the subject's own papers, or a single mark out of 100
            papers = list(s.papers.order_by("paper_number"))
            if papers:
                columns = [
                    {"paper_id": p.id, "label": f"{s.code}{p.paper_number}", "max_marks": float(p.max_marks)}
                    for p in papers
                ]
                paper_setup = [
                    {"paper_number": p.paper_number, "name": p.name, "max_marks": float(p.max_marks)}
                    for p in papers
                ]
            else:
                columns = [{"paper_id": None, "label": s.code, "max_marks": 100.0}]
                paper_setup = [{"paper_number": 0, "name": "Marks", "max_marks": 100.0}]

        subject_payload.append({
            "subject_id": s.id,
            "subject_name": s.name,
            "subject_code": s.code,
            "columns": columns,
            "configured": bool(configured),
            "paper_setup": paper_setup,
        })

    enrollments = (
        classroom.enrollments.filter(status__in=RANKABLE_ENROLLMENT_STATUSES)
        .select_related("student__user")
        .order_by("student__user__first_name", "student__user__last_name")
    )
    students = [
        {
            "enrollment_id": e.id,
            "admission_no": e.student.admission_no,
            "full_name": e.student.user.get_full_name(),
            "enrollment_status": e.status,
            "enrollment_status_display": e.get_status_display(),
        }
        for e in enrollments
    ]

    results = models.ExamResult.objects.filter(
        exam=exam, enrollment__classroom=classroom, subject_id__in=subject_ids
    )
    marks = {}
    for r in results:
        key = f"{r.enrollment_id}:{r.subject_id}:{r.paper_id or 'single'}"
        marks[key] = {
            "marks_obtained": None if r.is_absent or r.marks_obtained is None else float(r.marks_obtained),
            "is_absent": r.is_absent,
        }

    return {
        "classroom": str(classroom),
        "exam": str(exam),
        "is_promoted": hasattr(classroom, "promotion_record"),
        "promoted_to_label": (
            (str(classroom.promotion_record.target_classroom)
             if classroom.promotion_record.target_classroom else "Graduated")
            if hasattr(classroom, "promotion_record") else None
        ),
        "subjects": subject_payload,
        "students": students,
        "marks": marks,
    }


@transaction.atomic
def save_admin_exam_spreadsheet(exam: models.Exam, entries: list, entered_by) -> dict:
    """
    entries: [{enrollment_id, subject_id, paper_id|None, max_marks, marks_obtained|None, is_absent}, ...]
    Blank, untouched cells (not absent, marks_obtained None) are skipped
    silently rather than counted as errors - the admin may only be filling
    in some subjects/students in this pass.
    """
    saved, errors = [], []
    for row in entries:
        enrollment_id = row.get("enrollment_id")
        subject_id = row.get("subject_id")
        paper_id = row.get("paper_id")
        max_marks = row.get("max_marks") or 100
        marks_obtained = row.get("marks_obtained")
        is_absent = bool(row.get("is_absent", False))

        if not is_absent and marks_obtained in (None, ""):
            continue

        enrollment = models.Enrollment.objects.filter(pk=enrollment_id).first()
        if not enrollment:
            errors.append({"enrollment_id": enrollment_id, "subject_id": subject_id, "error": "Enrollment not found"})
            continue

        try:
            obj, _ = models.ExamResult.objects.update_or_create(
                exam=exam, enrollment=enrollment, subject_id=subject_id, paper_id=paper_id,
                defaults={
                    "marks_obtained": None if is_absent else marks_obtained,
                    "max_marks": max_marks,
                    "is_absent": is_absent,
                    "entered_by": entered_by,
                },
            )
            saved.append(obj.id)
        except Exception as exc:  # noqa: BLE001
            errors.append({"enrollment_id": enrollment_id, "subject_id": subject_id, "error": str(exc)})

    return {"saved": saved, "errors": errors}


# ---------------------------------------------------------------------------
# LICENSING / SUBSCRIPTIONS
# ---------------------------------------------------------------------------
class LicenseLimitExceeded(Exception):
    pass


def get_school_license(school):
    lic, created = models.License.objects.get_or_create(
        school=school,
        defaults={"tier": models.PlanTier.TRIAL, "trial_ends_at": timezone.now() + timedelta(days=30)},
    )
    if created:
        lic.apply_tier_defaults()
        lic.valid_until = lic.trial_ends_at
        lic.save()
    return lic


def check_license_limit(school, resource, current_count, increment=1):
    """
    resource: "students" | "classrooms_per_year" | "teachers"
    current_count: caller supplies the live count (keeps this function
    query-agnostic - classrooms need scoping by academic_year, students/
    teachers don't).
    """
    lic = get_school_license(school)

    if lic.is_suspended:
        raise LicenseLimitExceeded("This account is suspended. Contact your software provider.")
    if lic.is_expired:
        models.LicenseAuditLog.objects.create(
            school=school, action=models.LicenseAuditLog.Action.EXPIRED,
            detail=f"Blocked action: license expired {lic.valid_until:%Y-%m-%d}.",
        )
        raise LicenseLimitExceeded("Your license has expired. Please renew to continue.")

    limit_field = {
        "students": lic.max_students,
        "classrooms_per_year": lic.max_classrooms_per_year,
        "teachers": lic.max_teachers,
    }[resource]

    if limit_field is None:
        return  # unlimited (Pro)

    if current_count + increment > limit_field:
        models.LicenseAuditLog.objects.create(
            school=school, action=models.LicenseAuditLog.Action.LIMIT_BLOCKED,
            detail=f"{resource}: {current_count}/{limit_field}, tried +{increment}.",
        )
        raise LicenseLimitExceeded(
            f"You've reached your plan's limit of {limit_field} {resource.replace('_', ' ')}. "
            f"Upgrade your plan to add more."
        )


def redeem_license_token(token_str, school, user):
    token = models.LicenseToken.objects.filter(token=token_str, is_active=True).first()
    if not token:
        raise ValueError("Invalid or deactivated code.")
    if token.is_redeemed:
        raise ValueError("This code has already been used.")
    if token.school_id and token.school_id != school.id:
        raise ValueError("This code isn't valid for your school.")

    lic = get_school_license(school)
    lic.tier = token.tier
    lic.apply_tier_defaults()
    for key, value in token.limits_override.items():
        setattr(lic, key, value)
    lic.valid_until = timezone.now() + timedelta(days=30 * token.valid_months)
    lic.is_suspended = False
    lic.save()

    token.school = school
    token.redeemed_at = timezone.now()
    token.redeemed_by = user
    token.save()

    models.LicenseAuditLog.objects.create(
        school=school, action=models.LicenseAuditLog.Action.REDEEMED,
        detail=f"Upgraded to {lic.get_tier_display()}, valid until {lic.valid_until:%Y-%m-%d}.",
        performed_by=user,
    )
    return lic


def _package_dict(package):
    if not package:
        return None
    return {
        "id": package.id,
        "tier": package.tier,
        "tier_display": package.get_tier_display(),
        "monthly_price": package.monthly_price,
        "max_students": package.max_students,
        "max_classrooms_per_year": package.max_classrooms_per_year,
        "max_teachers": package.max_teachers,
        "features": package.features,
    }


def get_license_usage(school):
    lic = get_school_license(school)
    current_year = models.AcademicYear.objects.filter(is_current=True).first()

    student_count = models.StudentProfile.objects.filter(is_active=True).count()
    teacher_count = models.User.objects.filter(role=models.User.Role.TEACHER, is_active_staff=True).count()
    classroom_count = (
        models.ClassRoom.objects.filter(academic_year=current_year).count() if current_year else 0
    )

    def usage_block(used, limit):
        return {"used": used, "limit": limit, "unlimited": limit is None}

    current_package = models.SubscriptionPackage.objects.filter(tier=lic.tier).first()

    return {
        "tier": lic.tier,
        "tier_display": lic.get_tier_display(),
        "valid_until": lic.valid_until,
        "trial_ends_at": lic.trial_ends_at,
        "is_suspended": lic.is_suspended,
        "is_expired": lic.is_expired,
        "usage": {
            "students": usage_block(student_count, lic.max_students),
            "classrooms_this_year": usage_block(classroom_count, lic.max_classrooms_per_year),
            "teachers": usage_block(teacher_count, lic.max_teachers),
        },
        "current_package": _package_dict(current_package),
    }


def list_active_packages():
    return models.SubscriptionPackage.objects.filter(is_active=True).order_by("display_order", "monthly_price")


def get_student_status_label(student: models.StudentProfile) -> str:
    """
    Resolves what to print as a student's "class" on receipts/report views:
    their current classroom, or a terminal status label (Graduated,
    Transferred Out, Dropped) once they're no longer active. Looks at the
    student's MOST RECENT enrollment overall (by academic year), not just
    the one flagged is_current, so a freshly-promoted or freshly-graduated
    student resolves correctly even before the academic year flag rolls over.
    """
    enrollment = (
        models.Enrollment.objects.filter(student=student)
        .select_related("classroom__grade_level", "classroom__stream", "classroom__academic_year")
        .order_by("-academic_year__year", "-id")
        .first()
    )
    if not enrollment:
        return "Not yet enrolled"

    terminal_labels = {
        models.Enrollment.Status.GRADUATED: "Graduated",
        models.Enrollment.Status.TRANSFERRED_OUT: "Transferred Out",
        models.Enrollment.Status.DROPPED: "Dropped",
    }
    return terminal_labels.get(enrollment.status, str(enrollment.classroom))


# ---------------------------------------------------------------------------
# STUDENT CLEARANCE
# ---------------------------------------------------------------------------
def generate_clearance_no() -> str:
    """CLR-<year>-00001, sequential per calendar year."""
    prefix = f"CLR-{timezone.now().year}-"
    last = (
        models.ClearanceApplication.objects.filter(clearance_no__startswith=prefix)
        .order_by("-clearance_no")
        .first()
    )
    next_seq = 1
    if last:
        try:
            next_seq = int(last.clearance_no.split("-")[-1]) + 1
        except ValueError:
            pass
    return f"{prefix}{next_seq:05d}"


def clearance_eligibility(student: models.StudentProfile) -> dict:
    """
    A student may apply for clearance once they have finished their final year:
      - their LATEST enrollment is in a grade with no next grade
        (Form 4 / Grade 12 - the same rule promotions use to graduate a class), and
      - that enrollment is GRADUATED, or is still ACTIVE but the final term of
        its academic year has started.
    Returns {"eligible": bool, "reason": str, "enrollment": Enrollment | None}.
    """
    enrollment = (
        models.Enrollment.objects.filter(student=student)
        .select_related("classroom__grade_level", "academic_year")
        .order_by("-academic_year__year", "-id")
        .first()
    )
    if not enrollment:
        return {"eligible": False, "reason": "You have no enrollment record yet.", "enrollment": None}

    grade = enrollment.classroom.grade_level
    if grade.next_grade_id is not None:
        return {
            "eligible": False,
            "reason": f"Clearance is for students who have finished their final year. You are currently in {grade.name}.",
            "enrollment": enrollment,
        }

    allowed = (models.Enrollment.Status.ACTIVE, models.Enrollment.Status.GRADUATED)
    if enrollment.status not in allowed:
        return {
            "eligible": False,
            "reason": f"Your last enrollment is marked '{enrollment.get_status_display()}', so online clearance "
                      "isn't available. Please see the school office.",
            "enrollment": enrollment,
        }

    if enrollment.status == models.Enrollment.Status.ACTIVE:
        final_term = (
            models.Term.objects.filter(academic_year=enrollment.academic_year).order_by("-term_number").first()
        )
        if not final_term:
            return {
                "eligible": False,
                "reason": "The terms for your final year haven't been set up yet. Please see the school office.",
                "enrollment": enrollment,
            }
        if final_term.start_date > timezone.localdate():
            return {
                "eligible": False,
                "reason": f"Clearance opens when your final term starts on {final_term.start_date:%d %b %Y}.",
                "enrollment": enrollment,
            }

    return {"eligible": True, "reason": "", "enrollment": enrollment}


def _notify_student(student, sender, subject, body):
    """In-app notification for one student, via the existing Communication system."""
    comm = models.Communication.objects.create(
        sender=sender,
        subject=subject,
        body=body,
        category=models.Communication.Category.GENERAL,
        audience_type=models.Communication.AudienceType.INDIVIDUAL,
        include_students=True,
        include_guardians=False,
        send_in_app=True,
        send_sms=False,
        send_email=False,
    )
    comm.target_students.set([student])
    send_communication(comm)


def get_student_clearance_state(student: models.StudentProfile) -> dict:
    """Everything the student's Clearance page needs in one payload."""
    info = clearance_eligibility(student)
    application = (
        models.ClearanceApplication.objects.filter(student=student)
        .select_related("student__user", "enrollment__classroom", "enrollment__academic_year",
                        "reviewed_by", "collected_recorded_by")
        .first()
    )
    enrollment = info["enrollment"]
    sync_invoice_chains([student.id])
    balance = get_outstanding_balance(student)  # positive = owes, negative = prepaid

    return {
        "student": {"name": student.user.get_full_name(), "admission_no": student.admission_no},
        "eligible": info["eligible"],
        "reason": info["reason"],
        "class_label": str(enrollment.classroom) if enrollment else None,
        "academic_year": enrollment.academic_year.year if enrollment else None,
        "outstanding_balance": float(balance),
        "can_apply": info["eligible"] and (
            application is None or application.status == models.ClearanceApplication.Status.REJECTED
        ),
        "application": serializers.ClearanceApplicationSerializer(application).data if application else None,
    }


@transaction.atomic
def submit_clearance_application(student: models.StudentProfile, remarks: str = ""):
    """Create the application, or reopen a REJECTED one. Notifies every admin."""
    info = clearance_eligibility(student)
    if not info["eligible"]:
        raise ValueError(info["reason"])

    Status = models.ClearanceApplication.Status
    existing = models.ClearanceApplication.objects.select_for_update().filter(student=student).first()
    if existing and existing.status == Status.PENDING:
        raise ValueError("Your application is already with the administration.")
    if existing and existing.status == Status.CLEARED:
        raise ValueError("You have already been cleared.")

    sync_invoice_chains([student.id])
    balance = get_outstanding_balance(student)

    if existing:  # re-applying after being marked Not Cleared
        application = existing
        application.enrollment = info["enrollment"]
        application.status = Status.PENDING
        application.student_remarks = remarks
        application.balance_at_submission = balance
        application.submitted_at = timezone.now()
        application.reviewed_by = None
        application.reviewed_at = None
        application.admin_remarks = ""
        application.clearance_no = None
        application.cleared_with_balance = False
        application.collected_at = None
        application.collected_recorded_by = None
        application.save()
    else:
        application = models.ClearanceApplication.objects.create(
            student=student, enrollment=info["enrollment"], student_remarks=remarks,
            balance_at_submission=balance,
        )

    _notify_admins(
        subject=f"Clearance application: {student.user.get_full_name()}",
        body=f"{student.user.get_full_name()} ({student.admission_no}, {info['enrollment'].classroom}) "
             "has applied for clearance. Review it under Student Clearance.",
    )
    return application


@transaction.atomic
def review_clearance(application, reviewer, decision: str, remarks: str = "", force: bool = False):
    """
    decision: "CLEAR" or "REJECT".
    Clearing a student who still owes fees is blocked unless force=True
    (same pattern as promotion's `force`); the override is recorded on the row.
    Rejecting needs a reason so the student knows what to fix.
    """
    Status = models.ClearanceApplication.Status
    if application.status != Status.PENDING:
        raise ValueError("Only pending applications can be reviewed.")

    remarks = (remarks or "").strip()
    sync_invoice_chains([application.student_id])
    balance = get_outstanding_balance(application.student)

    if decision == "CLEAR":
        if balance > 0 and not force:
            raise ValueError(
                f"This student still owes KES {balance:,.2f}. Ask them to clear the balance first, "
                "or tick the override to clear them anyway."
            )
        application.status = Status.CLEARED
        application.clearance_no = generate_clearance_no()
        application.cleared_with_balance = balance > 0
    elif decision == "REJECT":
        if not remarks:
            raise ValueError("Please give the reason, so the student knows what to fix.")
        application.status = Status.REJECTED
    else:
        raise ValueError("Unknown decision.")

    application.reviewed_by = reviewer
    application.reviewed_at = timezone.now()
    application.admin_remarks = remarks
    application.save()

    if decision == "CLEAR":
        _notify_student(
            application.student, reviewer,
            subject="You have been cleared",
            body=f"Your clearance ({application.clearance_no}) has been approved. Download your clearance "
                 "slip from the Clearance page and bring it with you when you come to collect your certificate."
                 + (f"\n\nNote from the administration: {remarks}" if remarks else ""),
        )
    else:
        _notify_student(
            application.student, reviewer,
            subject="Clearance not approved yet",
            body=f"Your clearance application was not approved: {remarks}\n\n"
                 "Please sort this out and apply again from the Clearance page.",
        )
    return application


@transaction.atomic
def reopen_clearance(application):
    """Send a CLEARED (not yet collected) or REJECTED application back to PENDING, e.g. after a mistake."""
    Status = models.ClearanceApplication.Status
    if application.status == Status.PENDING:
        raise ValueError("This application is already pending.")
    if application.collected_at:
        raise ValueError("The certificate has already been collected, so this clearance can't be reopened.")

    application.status = Status.PENDING
    application.clearance_no = None
    application.cleared_with_balance = False
    application.reviewed_by = None
    application.reviewed_at = None
    application.admin_remarks = ""
    application.save()
    return application


@transaction.atomic
def mark_clearance_collected(application, recorded_by):
    """Stamped by the admin when the student comes in person for their certificate."""
    if application.status != models.ClearanceApplication.Status.CLEARED:
        raise ValueError("Only a cleared student can collect their certificate.")
    if application.collected_at:
        raise ValueError("This certificate has already been marked as collected.")
    application.collected_at = timezone.now()
    application.collected_recorded_by = recorded_by
    application.save(update_fields=["collected_at", "collected_recorded_by"])
    return application


def get_payment_anchor_invoice(student):
    """Most recent invoice - only used to identify the student for a general payment."""
    return (
        models.Invoice.objects.filter(enrollment__student=student)
        .order_by("-fee_structure__term__academic_year__year", "-fee_structure__term__term_number")
        .first()
    )


def _record_payment_shared_receipt(invoice, amount, method, reference, recorded_by, receipt_no):
    """Same steps as record_payment(), but with a receipt number supplied by the caller."""
    payment = models.Payment.objects.create(
        invoice=invoice, amount=amount, method=method, reference=reference,
        recorded_by=recorded_by, receipt_no=receipt_no,
    )
    invoice.amount_paid = invoice.payments.aggregate(total=Sum("amount"))["total"] or 0
    invoice.save(update_fields=["amount_paid"])

    recalculate_student_invoice_chain(invoice.enrollment.student)
    invoice.refresh_from_db()
    return payment


@transaction.atomic
def record_finance_payment(student, amount, method, reference, recorded_by):
    """
    FINANCE-DESK ONLY. Pays a student's balance oldest-invoice-first, like
    record_bulk_payment(), but every split piece shares ONE receipt number
    and the whole thing is all-or-nothing. The student portal keeps using
    record_bulk_payment() unchanged.
    """
    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")

    sync_invoice_chains([student.id])  # allocate against up-to-date balances
    receipt_no = generate_receipt_no()  # once for the whole payment
    remaining = amount
    payments = []

    while remaining > 0:
        invoice = (
            models.Invoice.objects.filter(enrollment__student=student, amount_due__gt=F("amount_paid"))
            .select_related("fee_structure__term")
            .order_by("fee_structure__term__academic_year__year", "fee_structure__term__term_number")
            .first()
        )
        if not invoice:
            break
        pay_amount = min(remaining, invoice.balance)
        payments.append(
            _record_payment_shared_receipt(invoice, pay_amount, method, reference, recorded_by, receipt_no)
        )
        remaining -= pay_amount

    if remaining > 0:
        # Everything settled and money left over -> prepaid credit on the latest invoice.
        target = (
            models.Invoice.objects.filter(enrollment__student=student)
            .order_by("-fee_structure__term__academic_year__year", "-fee_structure__term__term_number")
            .first()
        )
        if not target:
            raise ValueError("This student has no invoices yet - nothing to pay against.")
        payments.append(
            _record_payment_shared_receipt(target, remaining, method, reference, recorded_by, receipt_no)
        )

    if not payments:
        raise ValueError("This student has no invoices yet - nothing to pay against.")

    # Safety check: recorded must equal received, otherwise the transaction rolls back.
    if sum(p.amount for p in payments) != amount:
        raise ValueError("Payment allocation mismatch - nothing was recorded. Please try again.")

    return payments


# ===========================================================================
# CUSTOM GRADING SCHEME RESOLUTION
# ===========================================================================
_GRADING_CACHE = {}
_GRADING_CACHE_TTL = 30  # seconds; also cleared immediately on publish (same process)


def clear_grading_cache():
    _GRADING_CACHE.clear()


def _cached(key, loader):
    hit = _GRADING_CACHE.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _GRADING_CACHE_TTL:
        return hit[1]
    value = loader()
    _GRADING_CACHE[key] = (now, value)
    return value


def find_grading_scheme(curriculum_type, grade_level, subject, term):
    """
    Most specific PUBLISHED scheme in force for `term`, as (scheme, bands) or None.
    "In force" = effective_from_term started on/before this term; the newest
    effective term wins, then the highest version.
    Specificity: class+subject > class > subject > curriculum default.
    """

    def load():
        scopes = []
        if grade_level and subject:
            scopes.append({"grade_level": grade_level, "subject": subject})
        if grade_level:
            scopes.append({"grade_level": grade_level, "subject__isnull": True})
        if subject:
            scopes.append({"grade_level__isnull": True, "subject": subject})
        scopes.append({"grade_level__isnull": True, "subject__isnull": True})

        for scope in scopes:
            scheme = (
                models.GradingScheme.objects.filter(
                    curriculum_type=curriculum_type,
                    status=models.GradingScheme.Status.PUBLISHED,
                    effective_from_term__start_date__lte=term.start_date,
                    **scope,
                )
                .order_by("-effective_from_term__start_date", "-version")
                .first()
            )
            if scheme:
                return scheme, list(scheme.bands.order_by("-min_percentage"))
        return None

    key = (
        "scheme", curriculum_type,
        grade_level.id if grade_level else None, subject.id if subject else None, term.id,
    )
    return _cached(key, load)


def grade_from_custom_scheme(curriculum_type, percentage, subject=None, grade_level=None, term=None):
    """GradeResult from an Exam-Officer scheme, or None if none applies (-> legacy behaviour)."""
    term = term or _cached(("current_term",), lambda: models.Term.objects.filter(is_current=True).first())
    if term is None:
        return None
    found = find_grading_scheme(curriculum_type, grade_level, subject, term)
    if not found:
        return None
    _scheme, bands = found
    pct = Decimal(str(percentage))
    for band in bands:                       # sorted high -> low; first band the score reaches
        if pct >= band.min_percentage:
            return GradeResult(band.grade_letter, band.points, band.remark)
    return None


# Replaces the earlier grade_for_percentage above (same name, defined later so this one wins).
def grade_for_percentage(
    curriculum_type: str,
    percentage: Decimal,
    subject: models.Subject = None,
    grade_level: models.GradeLevel = None,
    term: models.Term = None,
):
    """
    Order of precedence:
      1. Exam Officer GradingScheme in force for `term`
      2. stage rubric for PP1-Grade 3
      3. school's legacy GradingScale
      4. stage rubric fallback / KCSE-style scale
    `term` = the term of the exam being graded. Omit it only for "right now" views.
    """
    custom = grade_from_custom_scheme(curriculum_type, percentage, subject, grade_level, term)
    if custom:
        return custom

    stage = stages.stage_for_grade(grade_level)

    if stage in stages.CODE_SCALE_STAGES:
        return stages.rubric_grade(stage, percentage)

    qs = models.GradingScale.objects.filter(
        curriculum_type=curriculum_type,
        min_percentage__lte=percentage,
        max_percentage__gte=percentage,
    )
    specific = qs.filter(subject=subject).first() if subject else None
    scale = specific or qs.filter(subject__isnull=True).first()
    if scale:
        return scale

    if stage in stages.RUBRIC_FALLBACK_STAGES:
        return stages.rubric_grade(stage, percentage)
    return default_grade_for_percentage(percentage)


# ===========================================================================
# AUTOMATIC PROMOTION
# ===========================================================================
def _latest_ended_academic_year(cfg, ignore_dates=False):
    """
    The year whose classes should be promoted. A year qualifies if:
      - its last term has ended (+ grace days), OR
      - a LATER academic year is already current / has started, OR
      - ignore_dates=True (manual Preview / Promote Now) and next year exists.
    """
    today = timezone.localdate()
    years = list(models.AcademicYear.objects.order_by("-year"))
    year_values = {y.year for y in years}

    for year in years:
        final = models.Term.objects.filter(academic_year=year).order_by("-term_number").first()
        if not final:
            continue
        ended = final.end_date + timedelta(days=cfg.days_after_year_end) < today
        successor_started = any(
            y.year > year.year and (y.is_current or y.start_date <= today) for y in years
        )
        has_successor = (year.year + 1) in year_values
        if ended or successor_started or (ignore_dates and has_successor):
            return year, final
    return None, None


def _promotion_decision(enrollment, cfg, final_term):
    """-> ("PROMOTE" | "REPEAT" | "HOLD", reason)"""
    if enrollment.student.enrollments.filter(
        academic_year__year=enrollment.academic_year.year + 1
    ).exists():
        return "HOLD", "Already enrolled for next year"

    if cfg.mode == models.PromotionSettings.Mode.PROMOTE_ALL:
        return "PROMOTE", ""

    grade = enrollment.classroom.grade_level
    rule = getattr(grade, "promotion_rule", None)
    if not rule or not stages.ranking_enabled(grade):
        return "PROMOTE", ""            # nothing to measure against (same as manual promote)

    ranking = models.TermPositionRanking.objects.filter(
        enrollment=enrollment, term=final_term, checkpoint="ENDTERM"
    ).first()
    if not ranking or (ranking.total_marks == 0 and ranking.average_marks == 0):
        return "HOLD", "No end-of-term marks recorded"
    if ranking.average_marks < rule.minimum_average_percentage:
        return "REPEAT", (
            f"Average {ranking.average_marks}% is below the required {rule.minimum_average_percentage}%"
        )
    return "PROMOTE", ""


def _auto_promote_classroom(classroom, cfg, final_term):
    Status = models.Enrollment.Status
    active = list(
        classroom.enrollments.filter(status=Status.ACTIVE).select_related("student__user", "classroom__grade_level")
    )
    out = {
        "classroom": str(classroom),
        "students": len(active),
        "from_year": classroom.academic_year.year,
        "promoted": 0, "graduated": 0,
        "repeating": [], "held": [],
        "target": None, "target_year": None,
        "balance_carried_forward": 0.0,
    }

    info = resolve_next_classroom_target(classroom)       # ValueError if next year isn't set up yet

    if info["graduating"]:
        out["target"] = "Graduation"
        sync_invoice_chains([e.student_id for e in active])   # leavers' balances stay accurate
        models.Enrollment.objects.filter(pk__in=[e.pk for e in active]).update(status=Status.GRADUATED)
        out["graduated"] = len(active)
        models.ClassroomPromotion.objects.create(
            source_classroom=classroom, target_classroom=None, promoted_by=None, student_count=len(active)
        )
        return out

    if cfg.mode == models.PromotionSettings.Mode.RULE_BASED:
        rank_classroom(final_term, classroom, "ENDTERM")   # make sure positions/averages are fresh

    target = get_or_create_next_classroom(classroom)
    out["target"] = str(target)
    out["target_year"] = target.academic_year.year
    repeat_room = None
    moved_student_ids = []

    for enrollment in active:
        decision, reason = _promotion_decision(enrollment, cfg, final_term)
        who = {"admission_no": enrollment.student.admission_no,
               "name": enrollment.student.user.get_full_name(), "reason": reason}
        if decision == "PROMOTE":
            promote_student(enrollment, target, force=True)   # carries the balance forward
            out["promoted"] += 1
            moved_student_ids.append(enrollment.student_id)
        elif decision == "REPEAT":
            if repeat_room is None:
                repeat_room, _ = models.ClassRoom.objects.get_or_create(
                    grade_level=classroom.grade_level, stream=classroom.stream,
                    academic_year=target.academic_year,
                )
            sync_invoice_chains([enrollment.student_id])
            enrollment.status = Status.REPEATED
            enrollment.save(update_fields=["status"])
            repeat_enrollment = models.Enrollment.objects.create(
                student=enrollment.student, classroom=repeat_room, academic_year=repeat_room.academic_year,
                status=Status.ACTIVE, promoted_from=enrollment, remarks=f"Repeating: {reason}",
            )
            carry_forward_balance(repeat_enrollment)          # repeaters keep their balance too
            out["repeating"].append(who)
            moved_student_ids.append(enrollment.student_id)
        else:
            out["held"].append(who)        # stays ACTIVE - handle by hand via Promote (force)

    if moved_student_ids:
        ledger = get_ledger_totals_bulk(moved_student_ids)
        out["balance_carried_forward"] = float(
            sum((t["balance"] for t in ledger.values() if t["balance"] > 0), Decimal("0"))
        )

    models.ClassroomPromotion.objects.create(
        source_classroom=classroom, target_classroom=target, promoted_by=None, student_count=out["promoted"]
    )
    return out


def sync_academic_calendar():
    """Optional: flip the current year/term once the new one has started and the old year is promoted."""
    today = timezone.localdate()
    year = models.AcademicYear.objects.filter(start_date__lte=today, end_date__gte=today).first()
    if not year:
        return "No academic year covers today."
    if not year.is_current:
        old = models.AcademicYear.objects.filter(is_current=True).exclude(pk=year.pk).first()
        if old and models.ClassRoom.objects.filter(
            academic_year=old, promotion_record__isnull=True,
            enrollments__status=models.Enrollment.Status.ACTIVE,
        ).exists():
            return f"Waiting: {old.year} still has classes that have not been promoted."
        year.is_current = True
        year.save()                         # AcademicYear.save() clears the flag on the others
    term = models.Term.objects.filter(academic_year=year, start_date__lte=today, end_date__gte=today).first()
    if term and not term.is_current:
        term.is_current = True
        term.save()
    return f"Current year {year.year}" + (f", {term}" if term else "")


def run_auto_promotion(dry_run=False, scheduled=False, triggered_by=None, ignore_dates=None):
    """
    scheduled=True  : obeys the on/off switch and the date rules (daily job).
    Manual runs (Preview / Promote Now) ignore the end-of-year date gate by default.
    """
    if ignore_dates is None:
        ignore_dates = not scheduled

    cfg = models.PromotionSettings.load()
    if scheduled and not cfg.auto_promote_enabled:
        return {"ran": False, "detail": "Automatic promotion is switched off."}

    year, final_term = _latest_ended_academic_year(cfg, ignore_dates=ignore_dates)
    if not year:
        return {
            "ran": False,
            "detail": "Nothing to promote: no academic year has finished (or has a following "
                      "academic year set up). Check Academic Calendar.",
        }

    # ---- classes of this year that are ALREADY promoted ----
    already_promoted = [
        {
            "classroom": str(p.source_classroom),
            "target": str(p.target_classroom) if p.target_classroom else "Graduated",
            "students": p.student_count,
            "promoted_at": p.promoted_at.isoformat(),
            "promoted_by": p.promoted_by.get_full_name() if p.promoted_by else "Automatic",
        }
        for p in models.ClassroomPromotion.objects
        .filter(source_classroom__academic_year=year)
        .select_related("source_classroom__grade_level", "source_classroom__stream",
                        "target_classroom", "promoted_by")
        .order_by("source_classroom__grade_level__level_order", "source_classroom__stream__name")
    ]

    classrooms = (
        models.ClassRoom.objects.filter(academic_year=year, promotion_record__isnull=True)
        .select_related("grade_level", "stream")
        .order_by("grade_level__level_order", "stream__name")
    )
    results, errors = [], []
    for classroom in classrooms:
        if not classroom.enrollments.filter(status=models.Enrollment.Status.ACTIVE).exists():
            continue
        try:
            with transaction.atomic():
                results.append(_auto_promote_classroom(classroom, cfg, final_term))
                if dry_run:
                    transaction.set_rollback(True)
        except ValueError as exc:
            errors.append({"classroom": str(classroom), "reason": str(exc)})

    summary = {
        "ran": True, "dry_run": dry_run, "academic_year": year.year,
        "classes_processed": len(results),
        "promoted": sum(r["promoted"] for r in results),
        "graduated": sum(r["graduated"] for r in results),
        "repeating": sum(len(r["repeating"]) for r in results),
        "held": sum(len(r["held"]) for r in results),
        "balance_carried_forward": sum(r.get("balance_carried_forward", 0) for r in results),
        "classes": results, "errors": errors,
        "already_promoted": already_promoted,
    }

    if not dry_run:
        if cfg.auto_activate_next_year:
            summary["calendar"] = sync_academic_calendar()
        cfg.last_run_at = timezone.now()
        cfg.last_run_summary = {
            k: v for k, v in summary.items() if k not in ("classes", "already_promoted")
        }
        if triggered_by:
            cfg.updated_by = triggered_by
        cfg.save()
    return summary


# ---------------------------------------------------------------------------
# BULK EXAM CREATION
# ---------------------------------------------------------------------------
def bulk_create_exams(term, exam_type, grade_levels, start_date, end_date,
                      name_template="{grade} {type} – Term {term} {year}", is_published=False):
    """
    Creates one Exam per grade level for (term, exam_type). Idempotent:
    grades that already have this exam for this term are skipped, not
    errored, so re-running with an overlapping selection is safe.
    """
    existing = set(
        models.Exam.objects.filter(
            term=term, exam_type=exam_type, grade_level__in=grade_levels
        ).values_list("grade_level_id", flat=True)
    )

    created, skipped = [], []
    ordered = sorted(grade_levels, key=lambda g: (g.curriculum_type, g.level_order))
    with transaction.atomic():
        for grade in ordered:
            if grade.id in existing:
                skipped.append(grade)
                continue
            name = (
                name_template.replace("{grade}", grade.name)
                .replace("{type}", exam_type.name)
                .replace("{term}", str(term.term_number))
                .replace("{year}", str(term.academic_year.year))
            )[:120]
            created.append(models.Exam.objects.create(
                term=term, exam_type=exam_type, grade_level=grade, name=name,
                start_date=start_date, end_date=end_date, is_published=is_published,
            ))
    return {"created": created, "skipped": skipped}


# ---------------------------------------------------------------------------
# RECEIPT LOOKUP / CORRECTION / SPLIT PAYMENTS / ALUMNI BALANCES
# ---------------------------------------------------------------------------
def get_receipt_payments(receipt_no):
    """All Payment rows under one receipt number, oldest term first."""
    receipt_no = (receipt_no or "").strip().upper()
    if not receipt_no:
        return []
    return list(
        models.Payment.objects.filter(receipt_no=receipt_no)
        .select_related(
            "invoice__enrollment__student__user",
            "invoice__fee_structure__term__academic_year",
            "recorded_by",
        )
        .order_by(
            "invoice__fee_structure__term__academic_year__year",
            "invoice__fee_structure__term__term_number",
            "id",
        )
    )


def receipt_snapshot(payments):
    first = payments[0]
    student = first.invoice.enrollment.student
    return {
        "student_id": student.id,
        "admission_no": student.admission_no,
        "student_name": student.user.get_full_name(),
        "amount": str(sum((p.amount for p in payments), Decimal("0"))),
        "method": first.method,
        "reference": first.reference,
        "paid_at": first.paid_at.isoformat(),
        "recorded_by_name": first.recorded_by.get_full_name() if first.recorded_by else "Self-service",
        "pieces": [
            {"term": str(p.invoice.fee_structure.term), "amount": str(p.amount)} for p in payments
        ],
    }


def _allocate_payment(student, amount, method, reference, recorded_by, receipt_no, paid_at=None):
    """Oldest-invoice-first allocation under ONE receipt number; any excess becomes credit."""
    remaining = Decimal(str(amount))
    if remaining <= 0:
        raise ValueError("Payment amount must be greater than zero.")
    sync_invoice_chains([student.id])
    payments = []

    while remaining > 0:
        invoice = (
            models.Invoice.objects.filter(enrollment__student=student, amount_due__gt=F("amount_paid"))
            .select_related("fee_structure__term")
            .order_by("fee_structure__term__academic_year__year", "fee_structure__term__term_number")
            .first()
        )
        if not invoice:
            break
        pay_amount = min(remaining, invoice.balance)
        payments.append(
            _record_payment_shared_receipt(invoice, pay_amount, method, reference, recorded_by, receipt_no)
        )
        remaining -= pay_amount

    if remaining > 0:
        target = (
            models.Invoice.objects.filter(enrollment__student=student)
            .order_by("-fee_structure__term__academic_year__year", "-fee_structure__term__term_number")
            .first()
        )
        if not target:
            raise ValueError("This student has no invoices yet - nothing to pay against.")
        payments.append(
            _record_payment_shared_receipt(target, remaining, method, reference, recorded_by, receipt_no)
        )

    if not payments:
        raise ValueError("This student has no invoices yet - nothing to pay against.")

    if sum(p.amount for p in payments) != Decimal(str(amount)):
        raise ValueError("Payment allocation mismatch - nothing was recorded. Please try again.")

    if paid_at:
        for p in payments:
            p.paid_at = paid_at
            p.save(update_fields=["paid_at"])
    return payments


@transaction.atomic
def record_split_payment(allocations, method, reference, recorded_by, total_received):
    """
    ONE real-world payment (e.g. one M-Pesa code, KES 7,000) shared by several
    students (3,000 + 4,000). Each student gets their OWN receipt number; all
    share the same reference. All-or-nothing.
    allocations: [(StudentProfile, Decimal amount), ...]
    """
    if len(allocations) < 2:
        raise ValueError("A split payment needs at least two students.")
    total = sum((a for _, a in allocations), Decimal("0"))
    if total != Decimal(str(total_received)):
        raise ValueError(
            f"The amounts add up to KES {total:,.2f} but KES {Decimal(str(total_received)):,.2f} was received."
        )

    results = []
    for student, amount in allocations:
        try:
            payments = _allocate_payment(
                student, amount, method, reference, recorded_by, generate_receipt_no()
            )
        except ValueError as exc:
            raise ValueError(f"{student.admission_no}: {exc}")
        results.append({"student": student, "amount": amount, "payments": payments})
    return results


def get_reference_usage(reference):
    """Receipts already recorded with this reference (M-Pesa code etc.), grouped by receipt."""
    reference = (reference or "").strip()
    if not reference:
        return []
    rows = (
        models.Payment.objects.filter(reference__iexact=reference)
        .select_related("invoice__enrollment__student__user")
        .order_by("paid_at", "id")
    )
    grouped = {}
    for p in rows:
        key = p.receipt_no or f"id-{p.id}"
        student = p.invoice.enrollment.student
        entry = grouped.setdefault(key, {
            "receipt_no": p.receipt_no,
            "student_name": student.user.get_full_name(),
            "admission_no": student.admission_no,
            "paid_at": p.paid_at,
            "amount": Decimal("0"),
        })
        entry["amount"] += p.amount
    return list(grouped.values())


@transaction.atomic
def correct_receipt(receipt_no, corrected_by, reason, *, void=False, new_student=None,
                    new_amount=None, new_method=None, new_reference=None):
    """
    Fixes a receipt that was recorded wrongly. The receipt number and original
    date are kept, so the paper receipt/QR stay valid. Old payment rows are
    removed, invoices + the student's chain are recalculated, and the correct
    payment is re-recorded - all in one transaction, with an audit row.
    """
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("Please give the reason for this correction.")

    old = get_receipt_payments(receipt_no)
    if not old:
        raise ValueError("No receipt found with this number.")
    old_student = old[0].invoice.enrollment.student
    if len({p.invoice.enrollment.student_id for p in old}) > 1:
        raise ValueError("This receipt number covers more than one student - fix it in the admin.")

    before = receipt_snapshot(old)
    method = new_method or old[0].method
    reference = old[0].reference if new_reference is None else new_reference
    amount = Decimal(str(new_amount)) if new_amount not in (None, "") else Decimal(before["amount"])
    target = new_student or old_student
    receipt_no = old[0].receipt_no

    if not void and amount <= 0:
        raise ValueError("Amount must be greater than zero.")

    Action = models.ReceiptAdjustment.Action

    # Same student + same amount: only method/reference change - edit in place.
    if not void and target.id == old_student.id and amount == Decimal(before["amount"]):
        for p in old:
            p.method = method
            p.reference = reference
            p.save(update_fields=["method", "reference"])
        new_payments = old
    else:
        paid_at, recorder = old[0].paid_at, old[0].recorded_by
        invoice_ids = {p.invoice_id for p in old}
        models.Payment.objects.filter(pk__in=[p.pk for p in old]).delete()
        for inv in models.Invoice.objects.filter(pk__in=invoice_ids):
            inv.amount_paid = inv.payments.aggregate(total=Sum("amount"))["total"] or 0
            inv.save(update_fields=["amount_paid"])
        recalculate_student_invoice_chain(old_student)

        new_payments = []
        if not void:
            try:
                new_payments = _allocate_payment(
                    target, amount, method, reference, recorder, receipt_no, paid_at=paid_at
                )
            except ValueError as exc:
                raise ValueError(f"{target.admission_no}: {exc}")

    models.ReceiptAdjustment.objects.create(
        receipt_no=receipt_no,
        student=target if new_payments else old_student,
        action=Action.VOIDED if void else Action.CORRECTED,
        before=before,
        after=receipt_snapshot(new_payments) if new_payments else {},
        reason=reason[:255],
        adjusted_by=corrected_by,
    )
    return new_payments


@transaction.atomic
def create_alumni_balance_account(*, first_name, last_name, admission_no, gender, balance, year_left,
                                  grade_level, stream=None, phone_number="", guardian_name="",
                                  guardian_phone="", guardian_relationship="GUARDIAN"):
    """
    Brings a past student who still owes fees into the system WITHOUT making
    them a current student: inactive profile, login disabled, a GRADUATED
    enrollment in their last year, and ONE opening-balance invoice
    (brought_forward = balance, term charge 0). Because the ledger works off
    invoices, Pay Balance / receipts / QR / corrections all work unchanged.
    """
    balance = Decimal(str(balance))
    if balance <= 0:
        raise ValueError("The balance must be greater than zero.")

    admission_no = (admission_no or "").strip()
    if not admission_no:
        raise ValueError("Admission number is required (use their old one if you know it).")
    if models.StudentProfile.objects.filter(admission_no=admission_no).exists():
        raise ValueError("This admission number is already in use.")
    username = admission_no.replace("/", "-")
    if models.User.objects.filter(username=username).exists():
        raise ValueError(f"The username '{username}' is already taken.")

    stream = stream or models.Stream.objects.order_by("id").first()
    if not stream:
        raise ValueError("No streams are set up yet.")

    academic_year, _ = models.AcademicYear.objects.get_or_create(
        year=year_left,
        defaults={"start_date": date(year_left, 1, 1), "end_date": date(year_left, 12, 31), "is_current": False},
    )
    if academic_year.is_current:
        raise ValueError("Alumni must have left before the current academic year.")

    term = models.Term.objects.filter(academic_year=academic_year).order_by("-term_number").first()
    if not term:
        term = models.Term.objects.create(
            academic_year=academic_year, term_number=3,
            start_date=date(year_left, 9, 1), end_date=date(year_left, 12, 31), is_current=False,
        )

    fee_structure, _ = models.FeeStructure.objects.get_or_create(
        grade_level=grade_level, term=term, defaults={"total_amount": 0}
    )
    classroom, _ = models.ClassRoom.objects.get_or_create(
        grade_level=grade_level, stream=stream, academic_year=academic_year
    )

    user = models.User(
        username=username, first_name=first_name, last_name=last_name,
        phone_number=phone_number, role=models.User.Role.STUDENT, is_active=False,
    )
    user.set_unusable_password()
    user.save()

    profile = models.StudentProfile.objects.create(
        user=user, admission_no=admission_no, gender=gender,
        curriculum_type=grade_level.curriculum_type, is_active=False,
        date_admitted=date(year_left, 1, 1),  # old date keeps them out of "recent admissions"
    )
    enrollment = models.Enrollment.objects.create(
        student=profile, classroom=classroom, academic_year=academic_year,
        status=models.Enrollment.Status.GRADUATED,
        remarks="Alumni - opening fee balance imported.",
    )
    models.Invoice.objects.create(
        enrollment=enrollment, fee_structure=fee_structure,
        brought_forward=balance, amount_due=balance, amount_paid=0,
    )

    if guardian_phone:
        attach_guardian(profile, guardian_name, guardian_phone, guardian_relationship)
    return profile


# ---------------------------------------------------------------------------
# PER-EXAM PAPER SETUP (PP1/PP2/PP3 + "out of" for one subject in one exam)
# ---------------------------------------------------------------------------
def get_exam_paper_columns(exam, subject):
    """Configured columns for (exam, subject), or None if nobody has set it up yet."""
    setups = list(models.ExamPaperSetup.objects.filter(exam=exam, subject=subject).order_by("paper_number"))
    if not setups:
        return None
    papers = {p.paper_number: p for p in subject.papers.all()}
    cols = []
    for s in setups:
        if s.paper_number == 0:
            cols.append({"paper_id": None, "paper_number": 0, "name": s.name or "Marks",
                         "max_marks": float(s.max_marks)})
        elif s.paper_number in papers:
            cols.append({"paper_id": papers[s.paper_number].id, "paper_number": s.paper_number,
                         "name": s.name or f"Paper {s.paper_number}", "max_marks": float(s.max_marks)})
    return cols


@transaction.atomic
def save_exam_paper_setup(exam, subject, papers, user):
    """
    papers: [{paper_number, name, max_marks}, ...]
      - a single item with paper_number 0 = no papers, just one mark out of X
      - otherwise paper numbers 1, 2, 3...
    Replaces the whole setup for this (exam, subject). Existing marks are kept and
    their max_marks is updated so percentages stay correct. A paper that already
    has marks can't be removed.
    """
    if not papers:
        raise ValueError("Add at least one paper.")

    clean, seen = [], set()
    for p in papers:
        try:
            number = int(p.get("paper_number"))
            max_marks = Decimal(str(p.get("max_marks")))
        except Exception:
            raise ValueError("Every paper needs a number and a valid 'out of' value.")
        if number < 0 or number > 10:
            raise ValueError("Paper number must be between 1 and 10.")
        if number in seen:
            raise ValueError("Two papers have the same number.")
        if max_marks <= 0 or max_marks > 1000:
            raise ValueError("'Out of' must be greater than 0 and at most 1000.")
        seen.add(number)
        clean.append({"paper_number": number, "name": (p.get("name") or "").strip()[:50], "max_marks": max_marks})

    if 0 in seen and len(clean) > 1:
        raise ValueError("Use either a single mark or numbered papers, not both.")

    existing = {s.paper_number: s for s in models.ExamPaperSetup.objects.filter(exam=exam, subject=subject)}
    subject_papers = {p.paper_number: p for p in subject.papers.all()}

    def results_for(number):
        qs = models.ExamResult.objects.filter(exam=exam, subject=subject)
        if number == 0:
            return qs.filter(paper__isnull=True)
        sp = subject_papers.get(number)
        return qs.filter(paper=sp) if sp else qs.none()

    # Before the first save the exam may already have marks entered under the old
    # subject-wide papers, so check the "implicit" old layout too.
    old_numbers = set(existing) or ({0} | set(subject_papers))
    for number in old_numbers - seen:
        if results_for(number).exists():
            label = "the single mark column" if number == 0 else f"Paper {number}"
            raise ValueError(f"{label} already has marks entered for this exam. Clear those marks before removing it.")

    models.ExamPaperSetup.objects.filter(exam=exam, subject=subject).exclude(paper_number__in=seen).delete()

    for c in clean:
        n = c["paper_number"]
        if n > 0:
            sp = subject_papers.get(n)
            if not sp:
                sp = models.SubjectPaper.objects.create(
                    subject=subject, paper_number=n, name=c["name"] or f"Paper {n}", max_marks=int(c["max_marks"]),
                )
                subject_papers[n] = sp
            if not subject.has_papers:
                subject.has_papers = True
                subject.save(update_fields=["has_papers"])
        models.ExamPaperSetup.objects.update_or_create(
            exam=exam, subject=subject, paper_number=n,
            defaults={"name": c["name"], "max_marks": c["max_marks"], "updated_by": user},
        )
        results_for(n).update(max_marks=c["max_marks"])

    return get_exam_paper_columns(exam, subject)


# ---------------------------------------------------------------------------
# ADMISSION TERM FEE (pro-rated first term)
# ---------------------------------------------------------------------------
def resolve_admission_term(classroom, admit_date):
    """
    The term a student admitted on `admit_date` should be billed for:
      1. the term of the classroom's academic year that contains that date;
      2. otherwise the next term that starts after it (admitted in the holidays);
      3. otherwise None (every term of the year has already ended).
    """
    terms = list(models.Term.objects.filter(academic_year=classroom.academic_year).order_by("term_number"))
    for term in terms:
        if term.start_date <= admit_date <= term.end_date:
            return term
    for term in terms:
        if term.start_date > admit_date:
            return term
    return None


def get_admission_fee_preview(classroom, admit_date=None):
    """
    Works out what a new student would pay for their first term if charged only
    for the days they will actually attend (calendar days, term start to term
    end inclusive). Returns a suggestion only - the school decides the final amount.
    """
    from decimal import ROUND_HALF_UP

    admit_date = admit_date or timezone.localdate()
    term = resolve_admission_term(classroom, admit_date)
    if term is None:
        return {
            "applicable": False,
            "message": "All terms of this academic year have already ended, so there is no term fee to set.",
        }

    total_days = (term.end_date - term.start_date).days + 1
    counted_from = max(admit_date, term.start_date)
    days_remaining = max((term.end_date - counted_from).days + 1, 0)

    info = {
        "term_id": term.id,
        "term_label": str(term),
        "term_start": term.start_date.isoformat(),
        "term_end": term.end_date.isoformat(),
        "total_days": total_days,
        "days_remaining": days_remaining,
        "admit_date": admit_date.isoformat(),
    }

    fee_structure = models.FeeStructure.objects.filter(grade_level=classroom.grade_level, term=term).first()
    if not fee_structure:
        return {
            **info,
            "applicable": False,
            "message": f"No fee structure is set up yet for {classroom.grade_level.name} in {term}. "
                       "Ask Finance to add it first.",
        }

    full_fee = fee_structure.total_amount
    prorated = (full_fee * days_remaining / total_days).quantize(Decimal("1"), rounding=ROUND_HALF_UP)

    return {
        **info,
        "applicable": True,
        "full_fee": float(full_fee),
        "prorated_fee": float(prorated),
    }


@transaction.atomic
def set_admission_term_fee(student, amount, user, reason=""):
    """
    Sets what this student pays for their admission term (the school's decision,
    usually the pro-rated suggestion). Edits the term charge on that term's
    invoice; any balance brought forward is kept on top. The student's invoice
    chain is recalculated, and recalculate_student_invoice_chain preserves a
    per-student term charge, so this amount is not overwritten later.
    """
    amount = Decimal(str(amount))
    if amount < 0:
        raise ValueError("The term fee cannot be negative.")

    enrollment = student.current_enrollment
    if not enrollment:
        raise ValueError("This student has no enrollment in the current academic year.")

    admit_date = student.date_admitted
    if hasattr(admit_date, "date"):
        admit_date = admit_date.date()

    term = resolve_admission_term(enrollment.classroom, admit_date)
    if term is None:
        raise ValueError("All terms of this academic year have already ended.")

    invoice = generate_invoice(enrollment, term)  # returns the existing invoice if there is one
    full_fee = invoice.fee_structure.total_amount

    invoice.amount_due = amount + invoice.brought_forward
    invoice.save(update_fields=["amount_due"])
    recalculate_student_invoice_chain(student)
    invoice.refresh_from_db()

    note = (
        f"{timezone.localdate():%Y-%m-%d}: {term} fee set to KES {amount:,.2f} "
        f"(full term fee KES {full_fee:,.2f}) by {user.get_full_name() or user.username}"
    )
    reason = (reason or "").strip()[:200]
    if reason:
        note += f" - {reason}"
    enrollment.remarks = f"{enrollment.remarks}\n{note}".strip() if enrollment.remarks else note
    enrollment.save(update_fields=["remarks"])

    return invoice


# ---------------------------------------------------------------------------
# OTHER PAYMENTS (admission, uniform, ID, graduation, trip, damages, ...)
# Kept OUT of the fee ledger on purpose - they never affect fee balances.
# ---------------------------------------------------------------------------
def create_student_charge(student, charge_type, amount=None, description="", due_date=None, created_by=None):
    if not charge_type.is_active:
        raise ValueError("This charge type is inactive.")
    amount = Decimal(str(amount)) if amount not in (None, "") else charge_type.default_amount
    if amount is None or amount <= 0:
        raise ValueError("Enter an amount greater than zero.")
    return models.StudentCharge.objects.create(
        student=student, charge_type=charge_type, amount=amount,
        description=description, due_date=due_date, created_by=created_by,
    )


def bulk_create_student_charges(students, charge_type, amount=None, description="", due_date=None, created_by=None):
    """e.g. a trip fee for every student in a classroom. Skips students already charged the same type+description."""
    created, skipped = [], []
    with transaction.atomic():
        for student in students:
            exists = models.StudentCharge.objects.filter(
                student=student, charge_type=charge_type, description=description,
            ).exclude(status=models.StudentCharge.Status.CANCELLED).exists()
            if exists:
                skipped.append(student.admission_no)
                continue
            created.append(create_student_charge(student, charge_type, amount, description, due_date, created_by))
    return {"created": created, "skipped": skipped}


def _refresh_charge_status(charge):
    S = models.StudentCharge.Status
    if charge.status in (S.WAIVED, S.CANCELLED):
        return
    if charge.amount_paid >= charge.amount:
        charge.status = S.PAID
    elif charge.amount_paid > 0:
        charge.status = S.PARTIAL
    else:
        charge.status = S.UNPAID
    charge.save(update_fields=["amount_paid", "status"])


@transaction.atomic
def record_other_payment(student, amount, method, reference, recorded_by,
                         charge_type=None, charge=None, notes=""):
    """
    Pay against an existing charge (charge=...) OR take a walk-in payment
    (charge_type=...). Payments against a charge cannot exceed its balance.
    """
    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")

    if charge:
        charge = models.StudentCharge.objects.select_for_update().get(pk=charge.pk)
        if charge.student_id != student.id:
            raise ValueError("This charge belongs to a different student.")
        if charge.status in (models.StudentCharge.Status.WAIVED, models.StudentCharge.Status.CANCELLED):
            raise ValueError(f"This charge is {charge.get_status_display().lower()}.")
        if amount > charge.balance:
            raise ValueError(f"Amount exceeds the charge balance of KES {charge.balance:,.2f}.")
        charge_type = charge.charge_type
    elif charge_type is None:
        raise ValueError("Choose a payment type.")
    if not charge_type.is_active:
        raise ValueError("This charge type is inactive.")

    payment = models.OtherPayment.objects.create(
        student=student, charge_type=charge_type, charge=charge, amount=amount,
        method=method, reference=reference, notes=notes,
        recorded_by=recorded_by, receipt_no=generate_receipt_no(),
    )
    if charge:
        charge.amount_paid = charge.payments.aggregate(t=Sum("amount"))["t"] or 0
        _refresh_charge_status(charge)
    return payment


@transaction.atomic
def waive_or_cancel_charge(charge, action, user, reason):
    """action: 'WAIVE' or 'CANCEL'. Blocked once money has been paid, so receipts never point at a dead charge."""
    if charge.amount_paid > 0:
        raise ValueError("This charge already has payments - it can't be waived or cancelled.")
    if not (reason or "").strip():
        raise ValueError("Please give a reason.")
    S = models.StudentCharge.Status
    charge.status = S.WAIVED if action == "WAIVE" else S.CANCELLED
    charge.description = f"{charge.description} [{charge.status}: {reason.strip()}]"[:255]
    charge.save(update_fields=["status", "description"])
    return charge


def get_student_other_charges_summary(student):
    open_charges = models.StudentCharge.objects.filter(
        student=student,
        status__in=[models.StudentCharge.Status.UNPAID, models.StudentCharge.Status.PARTIAL],
    ).select_related("charge_type")
    return {
        "total_outstanding": sum((c.balance for c in open_charges), Decimal("0")),
        "charges": list(open_charges),
    }


def get_any_receipt(receipt_no):
    """Fee receipt first, then other-payment receipt. Handy for any lookup that must accept both kinds."""
    receipt_no = (receipt_no or "").strip().upper()
    fee = get_receipt_payments(receipt_no)
    if fee:
        return {"kind": "FEE", "payments": fee}
    other = models.OtherPayment.objects.filter(receipt_no=receipt_no).select_related(
        "student__user", "charge_type", "recorded_by"
    ).first()
    return {"kind": "OTHER", "payment": other} if other else None