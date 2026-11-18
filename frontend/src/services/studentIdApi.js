import api from "./api";

export const studentIdApi = {
  searchStudents: (q) => api.get("/student-id/students/search/", { params: { q } }),
  profile: (studentId) => api.get(`/student-id/profiles/${studentId}/`),
  saveProfile: (studentId, formData) => api.post(`/student-id/profiles/${studentId}/`, formData),

  cards: (params) => api.get("/student-id/cards/", { params }),
  issue: (payload) => api.post("/student-id/cards/issue/", payload),
  issueBulk: (classroom_id) => api.post("/student-id/cards/issue_bulk/", { classroom_id }),
  classSheet: (classroom) => api.get("/student-id/cards/class_sheet/", { params: { classroom } }),
  payload: (id) => api.get(`/student-id/cards/${id}/payload/`),
  setStatus: (id, status) => api.post(`/student-id/cards/${id}/set_status/`, { status }),

  scanAttendance: (body) => api.post("/student-id/scan/attendance/", body),
  lookup: (body) => api.post("/student-id/scan/lookup/", body),
  today: (params) => api.get("/student-id/attendance/today/", { params }),
  notifyAbsentees: (body) => api.post("/student-id/attendance/notify_absentees/", body),
};