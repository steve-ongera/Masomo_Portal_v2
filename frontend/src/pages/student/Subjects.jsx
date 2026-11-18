import { useEffect, useState } from "react";
import {
  studentsApi,
  academicsApi,
  pathwaysApi,
  selectionTracksApi,
} from "../../services/api";

const SUBJECT_TAG = {
  compulsory: { badge: "badge-success", dot: "status-dot--online", label: "Compulsory" },
  pathway: { badge: "badge-blue", dot: "status-dot--online" },
  elective: { badge: "badge-neutral", dot: "status-dot--offline" },
  frozen: { badge: "badge-warning", dot: "status-dot--pending", label: "Max reached" },
};

export default function StudentSubjects() {
  const [enrollment, setEnrollment] = useState(null);
  const [availableSubjects, setAvailableSubjects] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [rule, setRule] = useState(null);

  const [pathways, setPathways] = useState([]);
  const [selectedPathway, setSelectedPathway] = useState(null);

  const [tracks, setTracks] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await studentsApi.enrollments({ status: "ACTIVE" });
        const list = data.results ?? data;
        const current = list[0];
        setEnrollment(current);
        if (!current) return;

        const gradeLevelId = current.grade_level_id;
        const isCBC = current.curriculum_type === "CBC";
        const isLegacy = current.curriculum_type === "8-4-4";

        const [gradeSubjectsRes, selectedRes, rulesRes] = await Promise.all([
          academicsApi.gradeSubjects({ grade_level: gradeLevelId }),
          studentsApi.getSubjects(current.id),
          academicsApi.selectionRules(),
        ]);

        const subjectsList = gradeSubjectsRes.data.results ?? gradeSubjectsRes.data;
        setAvailableSubjects(subjectsList);
        setSelectedIds((selectedRes.data || []).map((s) => s.subject));

        const allRules = rulesRes.data.results ?? rulesRes.data;
        const gradeRule = allRules.find((r) => r.grade_level === gradeLevelId) || null;
        setRule(gradeRule);

        if (isCBC && gradeRule?.requires_pathway) {
          const pRes = await pathwaysApi.list({ is_active: true });
          setPathways(pRes.data.results ?? pRes.data);
          setSelectedPathway(current.pathway || null);
        }

        if (isLegacy) {
          const tRes = await selectionTracksApi.list({
            grade_level: gradeLevelId,
            is_active: true,
          });
          const trackList = tRes.data.results ?? tRes.data;
          setTracks(trackList);
          setSelectedTrack(current.selection_track || null);
        }
      } catch (err) {
        console.error("Failed to load subject selection:", err);
        setMessageType("danger");
        setMessage("Could not load your subject selection. Please try again later.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const compulsoryIds = availableSubjects
    .filter((gs) => gs.is_compulsory)
    .map((gs) => gs.subject);

  const effectiveSelectedIds = Array.from(new Set([...compulsoryIds, ...selectedIds]));
  const totalSelected = effectiveSelectedIds.length;

  const minTotal = rule?.min_total_subjects ?? null;
  const maxTotal = rule?.max_total_subjects ?? null;

  const atMax = maxTotal != null && totalSelected >= maxTotal;
  const belowMin = minTotal != null && totalSelected < minTotal;
  const aboveMax = maxTotal != null && totalSelected > maxTotal;

  const toggleSubject = (subjectId) => {
    setSelectedIds((prev) => {
      const isChecked = prev.includes(subjectId);
      if (!isChecked && atMax) return prev;
      return isChecked ? prev.filter((id) => id !== subjectId) : [...prev, subjectId];
    });
  };

  const handlePathwayChange = (pathwayId) => {
    setSelectedPathway(pathwayId);
    setSelectedIds((prev) =>
      prev.filter((id) => {
        const gs = availableSubjects.find((g) => g.subject === id);
        return gs?.is_compulsory || !gs?.pathway || gs.pathway === pathwayId;
      })
    );
  };

  const handleTrackChange = (trackId) => {
    setSelectedTrack(trackId);
    const track = tracks.find((t) => t.id === trackId);
    const allowedGroupIds = new Set((track?.group_rules || []).map((r) => r.group));
    setSelectedIds((prev) =>
      prev.filter((id) => {
        const gs = availableSubjects.find((g) => g.subject === id);
        return gs?.is_compulsory || !gs?.elective_group || allowedGroupIds.has(gs.elective_group);
      })
    );
  };

  const save = async () => {
    setMessage("");
    setSaving(true);
    try {
      await studentsApi.setSubjects(
        enrollment.id,
        effectiveSelectedIds,
        selectedPathway,
        selectedTrack
      );
      setMessageType("success");
      setMessage("Subjects saved.");
    } catch (err) {
      setMessageType("danger");
      setMessage(err.response?.data?.detail || "Could not save subject selection.");
    } finally {
      setSaving(false);
    }
  };

  const isCBC = enrollment?.curriculum_type === "CBC";
  const isLegacy = enrollment?.curriculum_type === "8-4-4";
  const needsPathway = isCBC && !!rule?.requires_pathway;
  const needsTrack = isLegacy && tracks.length > 0;

  const electivesToShow = availableSubjects.filter((gs) => {
    if (gs.is_compulsory) return true;
    if (needsPathway && gs.pathway) return gs.pathway === selectedPathway;
    if (needsTrack && gs.elective_group) {
      const track = tracks.find((t) => t.id === selectedTrack);
      const allowedGroupIds = new Set((track?.group_rules || []).map((r) => r.group));
      return allowedGroupIds.has(gs.elective_group);
    }
    return true;
  });

  const readyForElectives = (!needsPathway || !!selectedPathway) && (!needsTrack || !!selectedTrack);

  const saveDisabled = !enrollment || saving || !readyForElectives || belowMin || aboveMax;

  const inRange = !belowMin && !aboveMax;
  const progressTone = aboveMax
    ? "progress-fill--danger"
    : inRange
    ? "progress-fill--success"
    : "progress-fill--gold";
  const progressPct =
    maxTotal && maxTotal > 0 ? Math.min(Math.round((totalSelected / maxTotal) * 100), 100) : 0;

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">My Subjects</h1>
            <p className="page-subtitle">Loading your subject selection...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Subjects</h1>
          <p className="page-subtitle">
            {enrollment
              ? `${enrollment.classroom_label} · ${
                  isCBC ? "CBC" : isLegacy ? "8-4-4" : enrollment.curriculum_type
                }`
              : "Choose the subjects you will study"}
          </p>
        </div>

        {enrollment && (
          <div className="page-header__actions">
            <button className="btn btn-primary" onClick={save} disabled={saveDisabled}>
              {saving ? (
                "Saving..."
              ) : belowMin ? (
                `Select ${minTotal - totalSelected} more to save`
              ) : (
                <>
                  <i className="bi bi-check2"></i>
                  Save Subject Selection
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {!enrollment && (
        <div className="table-wrap">
          <div className="empty-state">
            <i className="bi bi-exclamation-triangle"></i>
            <h6>No active enrollment found</h6>
            <p className="text-muted-soft">
              Please contact the school office to set up your enrollment.
            </p>
          </div>
        </div>
      )}

      {enrollment && (
        <>
          {message && (
            <div
              className={`alert alert-${messageType} alert-dismissible fade show`}
              role="alert"
            >
              <i
                className={`bi ${
                  messageType === "success" ? "bi-check2-circle" : "bi-exclamation-triangle"
                } me-1`}
              ></i>
              {message}
              <button type="button" className="btn-close" onClick={() => setMessage("")}></button>
            </div>
          )}

          {rule && (
            <div className="table-wrap mb-3">
              <div className="table-wrap__header">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-info-circle me-2 text-brand"></i>
                  Subject Selection Rules
                </span>
                <span
                  className={`badge ${
                    aboveMax
                      ? "badge-danger"
                      : atMax && !aboveMax
                      ? "badge-warning"
                      : inRange
                      ? "badge-success"
                      : "badge-gold"
                  }`}
                >
                  <span
                    className={`status-dot ${
                      aboveMax
                        ? "status-dot--offline"
                        : inRange
                        ? "status-dot--online"
                        : "status-dot--pending"
                    }`}
                  ></span>
                  {totalSelected} of {minTotal}–{maxTotal}
                </span>
              </div>

              <div className="p-3">
                <p className="form-text-hint mb-3">
                  Pick between <strong>{rule.min_optional_subjects}</strong> and{" "}
                  <strong>{rule.max_optional_subjects}</strong> optional subjects, for a total of{" "}
                  <strong>
                    {rule.min_total_subjects}–{rule.max_total_subjects}
                  </strong>{" "}
                  subjects overall.
                </p>

                {maxTotal != null && (
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${progressTone}`}
                      style={{ width: `${progressPct}%` }}
                    ></div>
                  </div>
                )}

                <div
                  className={`alert ${
                    aboveMax
                      ? "alert-danger"
                      : atMax && !aboveMax
                      ? "alert-warning"
                      : belowMin
                      ? "alert-warning"
                      : "alert-success"
                  } mt-3 mb-0 small`}
                >
                  <i
                    className={`bi ${
                      aboveMax ? "bi-x-circle" : inRange ? "bi-check2-circle" : "bi-info-circle"
                    } me-1`}
                  ></i>
                  {inRange && !atMax && "You're within the required range."}
                  {atMax && !aboveMax && "Maximum reached — uncheck one to swap it for another."}
                  {aboveMax && "You have too many selected. Please remove some."}
                  {belowMin && !atMax && `Choose at least ${minTotal - totalSelected} more.`}
                </div>
              </div>
            </div>
          )}

          {needsPathway && (
            <div className="table-wrap mb-3">
              <div className="table-wrap__header">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-signpost-split me-2 text-brand"></i>
                  Choose Your Pathway
                </span>
                {selectedPathway && (
                  <span className="badge badge-blue">
                    <span className="status-dot status-dot--online"></span>
                    Selected
                  </span>
                )}
              </div>

              <div className="p-3">
                {pathways.length === 0 ? (
                  <p className="form-text-hint mb-0">
                    No pathways configured yet. Contact the school office.
                  </p>
                ) : (
                  <div className="row g-2">
                    {pathways.map((p) => {
                      const active = selectedPathway === p.id;
                      return (
                        <div className="col-sm-6 col-lg-4" key={p.id}>
                          <button
                            type="button"
                            onClick={() => handlePathwayChange(p.id)}
                            className={`pick-item w-100 ${active ? "is-selected" : ""}`}
                          >
                            <i
                              className={`bi ${
                                active ? "bi-check-circle-fill text-brand" : "bi-circle text-muted-soft"
                              }`}
                            ></i>
                            <span className="cell-name flex-grow-1 text-start">
                              {p.name}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {needsTrack && (
            <div className="table-wrap mb-3">
              <div className="table-wrap__header">
                <span className="chart-card__title mb-0">
                  <i className="bi bi-diagram-3 me-2 text-brand"></i>
                  Choose Your Subject Track
                </span>
                {selectedTrack && (
                  <span className="badge badge-blue">
                    <span className="status-dot status-dot--online"></span>
                    Selected
                  </span>
                )}
              </div>

              <div className="p-3">
                <div className="d-flex flex-column gap-2">
                  {tracks.map((t) => {
                    const active = selectedTrack === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleTrackChange(t.id)}
                        className={`pick-item w-100 ${active ? "is-selected" : ""}`}
                      >
                        <i
                          className={`bi ${
                            active ? "bi-check-circle-fill text-brand" : "bi-circle text-muted-soft"
                          } mt-1`}
                        ></i>
                        <div className="flex-grow-1 text-start min-w-0">
                          <div className="cell-name">{t.name}</div>
                          {t.group_rules?.length > 0 && (
                            <div className="cell-muted small mt-1">
                              {t.group_rules
                                .map((r) =>
                                  r.min_choose === r.max_choose
                                    ? `${r.min_choose} ${r.group_name}`
                                    : `${r.min_choose}–${r.max_choose} ${r.group_name}`
                                )
                                .join(" · ")}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="table-wrap mb-3">
            <div className="table-wrap__header">
              <span className="chart-card__title mb-0">
                <i className="bi bi-list-check me-2 text-brand"></i>
                Subjects
              </span>
              <span className="chart-card__subtitle mb-0">
                {electivesToShow.length} available
              </span>
            </div>

            {readyForElectives ? (
              <div className="p-3">
                {electivesToShow.length === 0 ? (
                  <div className="empty-state">
                    <i className="bi bi-journal-x"></i>
                    <h6>No subjects configured for your grade yet</h6>
                    <p className="text-muted-soft">
                      Contact the school office to have your subjects set up.
                    </p>
                  </div>
                ) : (
                  <div className="row g-2">
                    {electivesToShow.map((gs) => {
                      const isSelected = gs.is_compulsory || selectedIds.includes(gs.subject);
                      const isFrozen = !gs.is_compulsory && !isSelected && atMax;

                      return (
                        <div className="col-12 col-lg-6" key={gs.id}>
                          <label
                            className={`pick-item w-100 ${isSelected ? "is-selected" : ""}`}
                            style={{
                              cursor: gs.is_compulsory || isFrozen ? "not-allowed" : "pointer",
                              opacity: isFrozen ? 0.7 : 1,
                            }}
                          >
                            <input
                              type="checkbox"
                              className="form-check-input mt-1"
                              checked={isSelected}
                              disabled={gs.is_compulsory || isFrozen}
                              onChange={() => toggleSubject(gs.subject)}
                            />
                            <div className="min-w-0 flex-grow-1 text-start">
                              <div className="cell-name">{gs.subject_name}</div>
                              <div className="d-flex flex-wrap gap-1 mt-1">
                                {gs.is_compulsory && (
                                  <span className={`badge ${SUBJECT_TAG.compulsory.badge}`}>
                                    <span className={`status-dot ${SUBJECT_TAG.compulsory.dot}`}></span>
                                    Compulsory
                                  </span>
                                )}
                                {gs.pathway_name && (
                                  <span className={`badge ${SUBJECT_TAG.pathway.badge}`}>
                                    <span className={`status-dot ${SUBJECT_TAG.pathway.dot}`}></span>
                                    {gs.pathway_name}
                                  </span>
                                )}
                                {gs.elective_group_name && (
                                  <span className={`badge ${SUBJECT_TAG.elective.badge}`}>
                                    {gs.elective_group_name}
                                  </span>
                                )}
                                {isFrozen && (
                                  <span className={`badge ${SUBJECT_TAG.frozen.badge}`}>
                                    <span className={`status-dot ${SUBJECT_TAG.frozen.dot}`}></span>
                                    Max reached
                                  </span>
                                )}
                              </div>
                            </div>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">
                <i className="bi bi-signpost-split"></i>
                <h6>
                  {needsPathway && !selectedPathway
                    ? "Select a pathway above to see your subjects"
                    : "Select a track above to see your subjects"}
                </h6>
                <p className="text-muted-soft">
                  Your available subjects depend on the choice above.
                </p>
              </div>
            )}

            {readyForElectives && electivesToShow.length > 0 && (
              <div className="table-wrap__footer">
                <span className="table-wrap__footer-info">
                  <strong>{totalSelected}</strong> of{" "}
                  {minTotal != null && maxTotal != null ? `${minTotal}–${maxTotal}` : "?"} subjects
                  selected
                </span>
                <button className="btn btn-primary" onClick={save} disabled={saveDisabled}>
                  {saving ? (
                    "Saving..."
                  ) : belowMin ? (
                    `Select ${minTotal - totalSelected} more to save`
                  ) : (
                    <>
                      <i className="bi bi-check2 me-1"></i>
                      Save Subject Selection
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}