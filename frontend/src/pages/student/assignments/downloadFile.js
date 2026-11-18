// src/pages/student/assignments/downloadFile.js
// Files are private, so the browser can't just follow a link: we fetch the
// file with the login token, then hand the blob to the browser as a download.
import { assignmentsApi } from "../../../services/api";

export async function downloadMaterial(item) {
  const res = await assignmentsApi.student.download(item.id);
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = item.original_filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const fmtSize = (b) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;