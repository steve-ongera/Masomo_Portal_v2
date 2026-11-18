"""
Stage logic for the Kenyan CBC ladder (PP1 -> Grade 12) plus legacy 8-4-4.

Everything here is DERIVED from GradeLevel.name / curriculum_type, so no
model, table or migration is touched. Nothing in this file imports Django
models, which keeps it trivially testable.

Policy lives in the three sets below - edit them, nothing else.
"""
import re
from collections import namedtuple

PRE_PRIMARY = "PRE_PRIMARY"      # Baby Class, PP1, PP2
LOWER_PRIMARY = "LOWER_PRIMARY"  # Grade 1-3
UPPER_PRIMARY = "UPPER_PRIMARY"  # Grade 4-6
JUNIOR = "JUNIOR"                # Grade 7-9
SENIOR = "SENIOR"                # Grade 10-12
LEGACY = "LEGACY"                # 8-4-4 Forms

Grade = namedtuple("Grade", ["grade_letter", "points", "remark"])

# --- POLICY ---------------------------------------------------------------
# Stages ALWAYS graded with the descriptive rubric (even if CBC GradingScale
# rows exist - those rows cannot be scoped per grade, so they would wrongly
# apply to a PP1 child).
CODE_SCALE_STAGES = {PRE_PRIMARY, LOWER_PRIMARY}

# Stages graded with the rubric ONLY when the school has configured no
# GradingScale. Add JUNIOR / SENIOR here to move Grade 7-12 off the KCSE
# A-E fallback too. Left out by default so existing Grade 9-12 behaviour
# is exactly what it was.
RUBRIC_FALLBACK_STAGES = {UPPER_PRIMARY}

# Stages with no class / grade positions on report cards and rankings.
NO_RANKING_STAGES = {PRE_PRIMARY, LOWER_PRIMARY}
# --------------------------------------------------------------------------

PRIMARY_STAGES = {PRE_PRIMARY, LOWER_PRIMARY, UPPER_PRIMARY}

# VERIFY against the current KNEC / Ministry circular before go-live.
# (min_percentage, letter, points, remark) - checked top-down.
_RUBRIC_4 = [
    (75, "EE", 4, "Exceeding Expectations"),
    (50, "ME", 3, "Meeting Expectations"),
    (25, "AE", 2, "Approaching Expectations"),
    (0,  "BE", 1, "Below Expectations"),
]
_RUBRIC_8 = [
    (90, "EE1", 8, "Exceeding Expectations"),
    (75, "EE2", 7, "Exceeding Expectations"),
    (58, "ME1", 6, "Meeting Expectations"),
    (41, "ME2", 5, "Meeting Expectations"),
    (31, "AE1", 4, "Approaching Expectations"),
    (21, "AE2", 3, "Approaching Expectations"),
    (11, "BE1", 2, "Below Expectations"),
    (0,  "BE2", 1, "Below Expectations"),
]

_PRE_PREFIXES = ("baby", "playgroup", "play group", "pp", "pre")


def stage_for_grade(grade_level):
    """Returns a stage constant, or None when it can't be worked out."""
    if grade_level is None:
        return None
    if grade_level.curriculum_type != "CBC":
        return LEGACY
    name = grade_level.name.strip().lower()
    if name.startswith(_PRE_PREFIXES):
        return PRE_PRIMARY
    m = re.search(r"\d+", name)
    if not m:
        return None  # unknown -> callers keep the old behaviour
    n = int(m.group())
    if n <= 3:
        return LOWER_PRIMARY
    if n <= 6:
        return UPPER_PRIMARY
    if n <= 9:
        return JUNIOR
    return SENIOR


def rubric_grade(stage, percentage):
    table = _RUBRIC_4 if stage in (PRE_PRIMARY, LOWER_PRIMARY) else _RUBRIC_8
    pct = float(percentage)
    for lo, letter, points, remark in table:
        if pct >= lo:
            return Grade(letter, points, remark)
    return Grade(table[-1][1], table[-1][2], table[-1][3])


def ranking_enabled(grade_level):
    return stage_for_grade(grade_level) not in NO_RANKING_STAGES


def is_primary(grade_level):
    return stage_for_grade(grade_level) in PRIMARY_STAGES


def grade_name_sort_key(name):
    """
    Sort key for grade NAMES so charts list Baby/PP1/PP2, Grade 1..12,
    then Form 1..4 - instead of alphabetical ("Grade 10" before "Grade 2").
    """
    n = (name or "").strip().lower().replace(" ", "")
    for i, prefix in enumerate(("baby", "playgroup", "pp1", "pp2")):
        if n.startswith(prefix):
            return (0, i)
    m = re.search(r"\d+", n)
    num = int(m.group()) if m else 0
    if n.startswith("grade"):
        return (1, num)
    if n.startswith("form"):
        return (2, num)
    return (3, num)