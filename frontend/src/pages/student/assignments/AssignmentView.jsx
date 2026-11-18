// src/pages/student/assignments/AssignmentView.jsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { assignmentsApi, errMsg } from "../../../services/api";
import { downloadMaterial, fmtSize } from "./downloadFile";

export default function StudentAssignmentView() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [loading, setLoading] = useState(true);

  // opening this page is what records a "view" for the teacher
  useEffect(() => {
    let alive = true;
    assignmentsApi.student
      .get(id)
      .then((r) => {
        if (!alive) return;
        setItem(r.data);
        setDownloaded(r.data.downloaded);
      })
      .catch((e) => {
        if (!alive) return;
        setError(
          e?.response?.status === 404
            ? "This item is not available."
            : errMsg(e)
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const download = async () => {
    setBusy(true);
    try {
      await downloadMaterial(item);
      setDownloaded(true);
    } catch (e) {
      setError(
        e?.response?.status === 404
          ? "This file is not available. Please tell your teacher."
          : "Download failed. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Assignment</h1>
            <p className="page-subtitle">Loading...</p>
          </div>
        </div>
        <div className="page-loader page-loader--inline">
          <div className="page-loader__ring" />
        </div>
      </div>
    );
  }

  if (error && !item) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Assignment</h1>
          </div>
        </div>
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
        </div>
        <Link
          to="/student/assignments"
          className="btn btn-secondary mt-3"
        >
          <i className="bi bi-arrow-left me-1"></i>
          Back to Assignments
        </Link>
      </div>
    );
  }

  if (!item) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{item.title}</h1>
          <p className="page-subtitle">
            <i className="bi bi-person me-1"></i>
            {item.teacher_name}
            {" · "}
            <i className="bi bi-calendar-event me-1"></i>
            Posted{" "}
            {item.published_at
              ? new Date(item.published_at).toLocaleDateString()
              : "—"}
            {item.due_date && (
              <>
                {" · "}
                <span className="text-gold fw-semibold">
                  <i className="bi bi-alarm me-1"></i>
                  Due {new Date(item.due_date).toLocaleDateString()}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="page-header__actions">
          <Link
            to="/student/assignments"
            className="btn btn-outline-secondary btn-sm"
          >
            <i className="bi bi-arrow-left"></i>
            Back
          </Link>
        </div>
      </div>

      {/* ---- Meta badges ---- */}
      <div className="d-flex flex-wrap gap-2 mb-3">
        <span className="badge badge-blue">{item.subject_name}</span>
        <span className="badge badge-neutral">{item.kind_display}</span>
        {downloaded && (
          <span className="badge badge-success">
            <span className="status-dot status-dot--online"></span>
            Downloaded
          </span>
        )}
      </div>

      {/* ---- Inline error (e.g. a failed download) ---- */}
      {error && item && (
        <div
          className="alert alert-danger alert-dismissible fade show"
          role="alert"
        >
          <i className="bi bi-exclamation-triangle me-1"></i>
          {error}
          <button
            type="button"
            className="btn-close"
            onClick={() => setError("")}
          ></button>
        </div>
      )}

      {/* ==================== DESCRIPTION ==================== */}
      {item.description && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-info-circle me-2 text-brand"></i>
              Instructions
            </span>
          </div>
          <div
            className="p-3 small text-muted-soft"
            style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
          >
            {item.description}
          </div>
        </div>
      )}

      {/* ==================== BODY ==================== */}
      {item.body && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-journal-text me-2 text-brand"></i>
              Content
            </span>
          </div>
          <div
            className="p-3 small"
            style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}
          >
            {item.body}
          </div>
        </div>
      )}

      {/* ==================== FILE ==================== */}
      {item.has_file && (
        <div className="table-wrap mb-3">
          <div className="table-wrap__header">
            <span className="chart-card__title mb-0">
              <i className="bi bi-paperclip me-2 text-brand"></i>
              Attachment
            </span>
            {downloaded && (
              <span className="badge badge-success">
                <span className="status-dot status-dot--online"></span>
                Downloaded
              </span>
            )}
          </div>

          <div className="p-3">
            <div className="note-card mb-0">
              <div
                className="dm-card__icon"
                style={{ width: 44, height: 44, fontSize: "1.3rem" }}
              >
                <i className="bi bi-file-earmark-arrow-down"></i>
              </div>

              <div className="flex-grow-1 min-w-0">
                <div
                  className="cell-name"
                  style={{ wordBreak: "break-all" }}
                >
                  {item.original_filename}
                </div>
                <div className="cell-muted small mt-1">
                  <i className="bi bi-hdd me-1"></i>
                  {fmtSize(item.file_size)}
                  {downloaded && " · downloaded"}
                </div>
              </div>

              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={download}
              >
                {busy ? (
                  <>
                    <span className="dot-loader me-2">
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                    Downloading...
                  </>
                ) : (
                  <>
                    <i className="bi bi-download me-1"></i>
                    {downloaded ? "Download Again" : "Download"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Nothing to show at all ---- */}
      {!item.has_file && !item.body && !item.description && (
        <div className="table-wrap mb-3">
          <div className="empty-state">
            <i className="bi bi-file-earmark"></i>
            <h6>No content</h6>
            <p className="text-muted-soft">
              This assignment has no description, body, or file attached.
            </p>
          </div>
        </div>
      )}

      {/* ---- Footer notice ---- */}
      <div className="note-card mb-0">
        <i className="bi bi-info-circle"></i>
        <span>
          Do this work on paper. Nothing is submitted through the portal.
        </span>
      </div>
    </div>
  );
}