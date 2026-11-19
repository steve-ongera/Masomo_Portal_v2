import axios from "axios";

export const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://127.0.0.1:8000/api/v1";


const api = axios.create({
  baseURL: BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let queue = [];

const processQueue = (error, token = null) => {
  queue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  queue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = localStorage.getItem("refresh_token");

      if (!refreshToken) {
        localStorage.clear();
        window.location.href = "/login";
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(`${BASE_URL}/auth/refresh/`, { refresh: refreshToken });
        localStorage.setItem("access_token", data.access);
        processQueue(null, data.access);
        originalRequest.headers.Authorization = `Bearer ${data.access}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.clear();
        window.location.href = "/login";
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username, password) => api.post("/auth/login/", { username, password }),
  verifyOtp: (challengeToken, otpCode) =>
    api.post("/auth/verify-otp/", { challenge_token: challengeToken, otp_code: otpCode }),
  forgotPassword: (admissionNo) => api.post("/auth/forgot-password/", { admission_no: admissionNo }),
  resetPassword: (token, newPassword) =>
    api.post("/auth/reset-password/", { token, new_password: newPassword }),
  me: () => api.get("/auth/me/"),
  changePassword: (payload) => api.post("/auth/change-password/", payload),
};

export const securityApi = {
  lockedUsers: () => api.get("/users/locked/"),
  unlockUser: (id) => api.post(`/users/${id}/unlock/`),
  loginAttempts: (params) => api.get("/login-attempts/", { params }),
  loginAttemptsSummary: () => api.get("/login-attempts/summary/"),
};

export const profileApi = {
  me: () => api.get("/profile/me/"),
  update: (payload) => api.patch("/profile/me/", payload),
};

export const dashboardApi = {
  stats: () => api.get("/dashboard/stats/"),
  principalStats: () => api.get("/dashboard/principal-stats/"),
  secretaryStats: () => api.get("/dashboard/secretary-stats/"),
  examOfficerStats: () => api.get("/dashboard/exam-officer-stats/"),   // NEW
};

export const reportsApi = {
  overview: () => api.get("/reports/overview/"),
};

export const schoolApi = {
  list: () => api.get("/schools/"),
  create: (payload) => api.post("/schools/", payload),
  update: (id, payload) => api.patch(`/schools/${id}/`, payload),
};

export const guardiansApi = {
  list: (params) => api.get("/parents/", { params }),
  create: (payload) => api.post("/parents/", payload),
  links: (params) => api.get("/parent-links/", { params }),
  linkStudent: (payload) => api.post("/parent-links/", payload),
  unlink: (id) => api.delete(`/parent-links/${id}/`),
};

export const calendarApi = {
  academicYears: () => api.get("/academic-years/"),
  createAcademicYear: (payload) => api.post("/academic-years/", payload),
  updateAcademicYear: (id, payload) => api.patch(`/academic-years/${id}/`, payload),
  terms: (params) => api.get("/terms/", { params }),
  createTerm: (payload) => api.post("/terms/", payload),
  updateTerm: (id, payload) => api.patch(`/terms/${id}/`, payload),
};

export const academicsApi = {
  gradeLevels: (params) => api.get("/grade-levels/", { params }),

  streams: () => api.get("/streams/"),
  classrooms: (params) => api.get("/classrooms/", { params }),
  allClassrooms: (params) => api.get("/classrooms/all/", { params }),

  classroomResults: (id, params) => api.get(`/classrooms/${id}/results/`, { params }),
  gradeLevelResults: (id, params) => api.get(`/grade-levels/${id}/results/`, { params }),

  promotionPreview: (classroomId) => api.get(`/classrooms/${classroomId}/promotion_preview/`),
  bulkPromoteClassroom: (classroomId, payload) => api.post(`/classrooms/${classroomId}/bulk_promote/`, payload),

  subjects: (params) => api.get("/subjects/", { params }),
  createSubject: (payload) => api.post("/subjects/", payload),
  updateSubject: (id, payload) => api.patch(`/subjects/${id}/`, payload),
  deleteSubject: (id) => api.delete(`/subjects/${id}/`),

  subjectPapers: (params) => api.get("/subject-papers/", { params }),
  createSubjectPaper: (payload) => api.post("/subject-papers/", payload),
  updateSubjectPaper: (id, payload) => api.patch(`/subject-papers/${id}/`, payload),
  deleteSubjectPaper: (id) => api.delete(`/subject-papers/${id}/`),

  gradeSubjects: (params) => api.get("/grade-subjects/", { params }),
  createGradeSubject: (payload) => api.post("/grade-subjects/", payload),
  updateGradeSubject: (id, payload) => api.patch(`/grade-subjects/${id}/`, payload),
  deleteGradeSubject: (id) => api.delete(`/grade-subjects/${id}/`),

  selectionRules: () => api.get("/selection-rules/"),
  createSelectionRule: (payload) => api.post("/selection-rules/", payload),
  updateSelectionRule: (id, payload) => api.patch(`/selection-rules/${id}/`, payload),
  deleteSelectionRule: (id) => api.delete(`/selection-rules/${id}/`),

  gradingScales: (params) => api.get("/grading-scales/", { params }),
  createGradingScale: (payload) => api.post("/grading-scales/", payload),
  updateGradingScale: (id, payload) => api.patch(`/grading-scales/${id}/`, payload),
  deleteGradingScale: (id) => api.delete(`/grading-scales/${id}/`),

  addSubjectPaper: (payload) => api.post("/subject-papers/", payload),

  examSpreadsheet: (classroomId, examId) =>
    api.get(`/classrooms/${classroomId}/exam_spreadsheet/`, { params: { exam: examId } }),
  saveExamSpreadsheet: (classroomId, payload) =>
    api.post(`/classrooms/${classroomId}/save_exam_spreadsheet/`, payload),
};

// ---------------------------------------------------------------------------
// GRADING SCHEMES (Exam Officer / Admin)
// Versioned grade bands per class and/or subject. A published scheme applies
// from its chosen term onward; earlier terms keep the grades they already had.
// ---------------------------------------------------------------------------
export const gradingApi = {
  list: (params) => api.get("/grading-schemes/", { params }),
  create: (payload) => api.post("/grading-schemes/", payload),
  update: (id, payload) => api.patch(`/grading-schemes/${id}/`, payload),
  remove: (id) => api.delete(`/grading-schemes/${id}/`),
  publish: (id) => api.post(`/grading-schemes/${id}/publish/`),
  clone: (id) => api.post(`/grading-schemes/${id}/clone/`),
  resolve: (params) => api.get("/grading-schemes/resolve/", { params }),
};

// ---------------------------------------------------------------------------
// AUTOMATIC PROMOTION SETTINGS (Exam Officer / Admin)
// run(true) = preview only (nothing is changed), run(false) = promote now.
// ---------------------------------------------------------------------------
export const promotionSettingsApi = {
  get: () => api.get("/promotion-settings/"),
  save: (payload) => api.patch("/promotion-settings/", payload),
  run: (dry_run) => api.post("/promotion-settings/run/", { dry_run }),
};

export const studentsApi = {
  list: (params) => api.get("/students/", { params }),
  detail: (id) => api.get(`/students/${id}/`),
  admit: (payload) => api.post("/students/admit/", payload),
  update: (id, payload) => api.patch(`/students/${id}/`, payload),
  remove: (id) => api.delete(`/students/${id}/`),
  resetPassword: (id, payload) => api.post(`/students/${id}/reset_password/`, payload),

  enrollments: (params) => api.get("/enrollments/", { params }),
  promote: (enrollmentId, payload) => api.post(`/enrollments/${enrollmentId}/promote/`, payload),
  bulkPromote: (payload) => api.post("/enrollments/bulk_promote/", payload),

  getSubjects: (enrollmentId) => api.get(`/enrollments/${enrollmentId}/subjects/`),
  unlockSubjects: (enrollmentId) => api.post(`/enrollments/${enrollmentId}/unlock_subjects/`),
  setSubjects: (enrollmentId, subjectIds, pathwayId, trackId) =>
    api.post(`/enrollments/${enrollmentId}/subjects/`, {
      subject_ids: subjectIds,
      pathway_id: pathwayId ?? null,
      track_id: trackId ?? null,
    }),
};

export const admissionFeeApi = {
  preview: (params) => api.get("/admission-fee/preview/", { params }),
  apply: (payload) => api.post("/admission-fee/apply/", payload),
};

export const subjectGroupsApi = {
  list: (params) => api.get("/subject-groups/", { params }),
  create: (payload) => api.post("/subject-groups/", payload),
  update: (id, payload) => api.patch(`/subject-groups/${id}/`, payload),
  delete: (id) => api.delete(`/subject-groups/${id}/`),
};

export const selectionTracksApi = {
  list: (params) => api.get("/selection-tracks/", { params }),
  create: (payload) => api.post("/selection-tracks/", payload),
  update: (id, payload) => api.patch(`/selection-tracks/${id}/`, payload),
  delete: (id) => api.delete(`/selection-tracks/${id}/`),
};

export const trackRulesApi = {
  list: (params) => api.get("/track-group-rules/", { params }),
  create: (payload) => api.post("/track-group-rules/", payload),
  update: (id, payload) => api.patch(`/track-group-rules/${id}/`, payload),
  delete: (id) => api.delete(`/track-group-rules/${id}/`),
};

export const pathwaysApi = {
  list: (params) => api.get("/pathways/", { params }),
  create: (payload) => api.post("/pathways/", payload),
  update: (id, payload) => api.patch(`/pathways/${id}/`, payload),
  delete: (id) => api.delete(`/pathways/${id}/`),
};

export const timetableApi = {
  periodSlots: () => api.get("/period-slots/"),
  bulkSetStructure: (slots) => api.post("/period-slots/bulk_set/", { slots }),
  grid: (term, classroom) => api.get("/timetable-entries/grid/", { params: { term, classroom } }),
  createEntry: (payload) => api.post("/timetable-entries/", payload),
  updateEntry: (id, payload) => api.patch(`/timetable-entries/${id}/`, payload),
  deleteEntry: (id) => api.delete(`/timetable-entries/${id}/`),
  autoGenerate: (term) => api.post("/timetable-entries/auto_generate/", { term }),
  myTeaching: (params) => api.get("/timetable/my-teaching/", { params }),
  myClass: (params) => api.get("/timetable/my-class/", { params }),
};

export const teacherApi = {
  myAllocations: () => api.get("/my-allocations/"),
  allAllocations: (params) => api.get("/teacher-allocations/", { params }),
  unallocated: (params) => api.get("/teacher-allocations/unallocated/", { params }),
  myClassTeacherClassrooms: () => api.get("/my-class-teacher-classrooms/"),
};

export const gatepassApi = {
  classCards: (params) => api.get("/gatepass/class/", { params }),
  verify: (token) => api.get(`/gatepass/verify/${token}/`),
};

export const examsApi = {
  examTypes: () => api.get("/exam-types/"),
  exams: (params) => api.get("/exams/", { params }),
  bulkCreateExams: (payload) => api.post("/exams/bulk_create/", payload), 
  results: (params) => api.get("/exam-results/", { params }),
  bulkEntry: (payload) => api.post("/exam-results/bulk_entry/", payload),
  rankings: (params) => api.get("/rankings/", { params }),
  rank: (payload) => api.post("/rank/", payload),
  summary: (params) => api.get("/exam-summary/", { params }),
   paperSetup: (params) => api.get("/exam-paper-setup/", { params }),
  savePaperSetup: (payload) => api.post("/exam-paper-setup/", payload),
};

export const financeApi = {
  feeStructures: (params) => api.get("/fee-structures/", { params }),
  createFeeStructure: (payload) => api.post("/fee-structures/", payload),
  updateFeeStructure: (id, payload) => api.patch(`/fee-structures/${id}/`, payload),
  deleteFeeStructure: (id) => api.delete(`/fee-structures/${id}/`),

  invoices: (params) => api.get("/invoices/", { params }),
  generateInvoice: (payload) => api.post("/invoices/generate/", payload),

  recordPayment: (payload) => api.post("/payments/", payload),
  recordBulkPayment: (payload) => api.post("/payments/pay_balance/", payload),

  status: () => api.get("/fees/status/"),
  myStructures: (params) => api.get("/fees/my-structures/", { params }),

  payments: (params) => api.get("/payments/", { params }),
  paymentReceipt: (paymentId) => api.get(`/payments/${paymentId}/finance_receipt/`),
  verifyReceiptSecure: (receiptNo) => api.get(`/payments/verify/${encodeURIComponent(receiptNo)}/`),

  studentLookup: (admission_no) => api.get("/payments/student_lookup/", { params: { admission_no } }),
  referenceUsage: (reference) => api.get("/payments/reference_usage/", { params: { reference } }),
  paySplit: (payload) => api.post("/payments/pay_split/", payload),
  receiptLookup: (receipt_no) => api.get("/payments/receipt_lookup/", { params: { receipt_no } }),
  correctReceipt: (payload) => api.post("/payments/correct_receipt/", payload),
  addAlumniBalance: (payload) => api.post("/payments/add_alumni_balance/", payload),


};

export const performanceApi = {
  dashboard: (params) => api.get("/students/me/performance/", { params }),
};

export const clearanceApi = {
  me: () => api.get("/my-clearance/"),
  apply: (payload) => api.post("/my-clearance/", payload),

  list: (params) => api.get("/clearance/", { params }),
  summary: () => api.get("/clearance/summary/"),
  clear: (id, payload) => api.post(`/clearance/${id}/clear/`, payload),
  reject: (id, payload) => api.post(`/clearance/${id}/reject/`, payload),
  reopen: (id) => api.post(`/clearance/${id}/reopen/`),
  markCollected: (id) => api.post(`/clearance/${id}/mark_collected/`),
};

export const communicationApi = {
  list: (params) => api.get("/communications/", { params }),
  send: (payload) => api.post("/communications/", payload),
};

export const notificationApi = {
  list: (params) => api.get("/notifications/", { params }),
  unreadCount: () => api.get("/notifications/unread_count/"),
  markRead: (id) => api.post(`/notifications/${id}/mark_read/`),
  markAllRead: () => api.post("/notifications/mark_all_read/"),
};

export const messagingApi = {
  conversations: () => api.get("/conversations/"),
  start: (payload) => api.post("/conversations/", payload),
  messages: (conversationId) => api.get(`/conversations/${conversationId}/messages/`),
  send: (conversationId, body) => api.post(`/conversations/${conversationId}/messages/`, { body }),
  unreadCount: () => api.get("/conversations/unread_count/"),
  searchRecipients: (params) => api.get("/messaging/recipients/", { params }),
};

export const financeReportsApi = {
  collections: (params) => api.get("/finance-reports/collections/", { params }),
  classAnalysis: (params) => api.get("/finance-reports/class-analysis/", { params }),
  detailed: (params) => api.get("/finance-reports/detailed/", { params }),
  studentBalances: (params) => api.get("/finance-reports/student-balances/", { params }),
};

export const licenseApi = {
  me: () => api.get("/license/me/"),
  redeem: (token) => api.post("/license/redeem/", { token }),
  status: () => api.get("/license/status/"),
};

export const packagesApi = {
  list: () => api.get("/subscription-packages/"),
};

export const expensesApi = {
  categories: (params) => api.get("/expense-categories/", { params }),
  createCategory: (payload) => api.post("/expense-categories/", payload),
  updateCategory: (id, payload) => api.patch(`/expense-categories/${id}/`, payload),
  deleteCategory: (id) => api.delete(`/expense-categories/${id}/`),

  list: (params) => api.get("/expenses/", { params }),
  create: (payload) => api.post("/expenses/", payload),
  update: (id, payload) => api.patch(`/expenses/${id}/`, payload),
  delete: (id) => api.delete(`/expenses/${id}/`),
  summary: (params) => api.get("/expenses/summary/", { params }),
};

export const reportCardsApi = {
  qrCode: (token) => api.get(`/report-cards/${token}/qr/`),
  verify: (token) => api.get(`/report-cards/verify/${token}/`),
};

export const paymentsApi = {
  initiate: (payload) => api.post("/payments/initiate/", payload),
  status: (checkoutRequestId) => api.get(`/payments/status/${checkoutRequestId}/`),
  receipt: (paymentId) => api.get(`/payments/${paymentId}/receipt/`),
  verifyReceipt: (receiptNo) => api.get(`/receipts/verify/${receiptNo}/`),
};


export const lessonPlanningApi = {
  // curriculum topics
  topics: (params) => api.get("/lesson-planning/topics/", { params }),
  createTopic: (payload) => api.post("/lesson-planning/topics/", payload),

  // schemes of work
  schemes: (params) => api.get("/lesson-planning/schemes/", { params }),
  scheme: (id) => api.get(`/lesson-planning/schemes/${id}/`),
  createScheme: (payload) => api.post("/lesson-planning/schemes/", payload),
  updateScheme: (id, payload) => api.patch(`/lesson-planning/schemes/${id}/`, payload),
  deleteScheme: (id) => api.delete(`/lesson-planning/schemes/${id}/`),
  saveSchemeEntries: (id, entries) => api.post(`/lesson-planning/schemes/${id}/save_entries/`, { entries }),
  submitScheme: (id) => api.post(`/lesson-planning/schemes/${id}/submit/`),
  withdrawScheme: (id) => api.post(`/lesson-planning/schemes/${id}/withdraw/`),
  reviewScheme: (id, decision, remarks) =>
    api.post(`/lesson-planning/schemes/${id}/review/`, { decision, remarks }),
  schemeEntry: (id) => api.get(`/lesson-planning/scheme-entries/${id}/`),

  // lesson plans
  plans: (params) => api.get("/lesson-planning/lesson-plans/", { params }),
  plan: (id) => api.get(`/lesson-planning/lesson-plans/${id}/`),
  createPlan: (payload) => api.post("/lesson-planning/lesson-plans/", payload),
  updatePlan: (id, payload) => api.patch(`/lesson-planning/lesson-plans/${id}/`, payload),
  deletePlan: (id) => api.delete(`/lesson-planning/lesson-plans/${id}/`),
  submitPlan: (id) => api.post(`/lesson-planning/lesson-plans/${id}/submit/`),
  withdrawPlan: (id) => api.post(`/lesson-planning/lesson-plans/${id}/withdraw/`),
  reviewPlan: (id, decision, remarks) =>
    api.post(`/lesson-planning/lesson-plans/${id}/review/`, { decision, remarks }),
  saveCoverage: (id, payload) => api.post(`/lesson-planning/lesson-plans/${id}/coverage/`, payload),
  today: () => api.get("/lesson-planning/lesson-plans/today/"),

  // syllabus coverage overview
  coverage: (params) => api.get("/lesson-planning/coverage/", { params }),
};

export const attendanceApi = {
  myClasses: () => api.get("/attendance/my-classes/"),
  lessons: (params) => api.get("/attendance/lessons/", { params }),
  sheet: (params) => api.get("/attendance/sheet/", { params }),
  save: (payload) => api.post("/attendance/sheet/save/", payload),
  sessions: (params) => api.get("/attendance/sessions/", { params }),
  session: (id) => api.get(`/attendance/sessions/${id}/`),
  summary: (params) => api.get("/attendance/summary/", { params }),
  studentHistory: (enrollmentId, params) => api.get(`/attendance/students/${enrollmentId}/`, { params }),
};

// ---------------------------------------------------------------------------
// ASSIGNMENTS & REVISION MATERIAL  (backed by the separate `assignments`
// Django app, mounted at /api/v1/assignments/)
//
// Teacher create/update take a FormData (text fields + optional file).
// Student download returns a Blob: files are private, so they are fetched
// with the login token rather than opened from a plain link.
// ---------------------------------------------------------------------------
export const assignmentsApi = {
  teacher: {
    myClasses: () => api.get("/assignments/teacher/my-classes/"),
    list: (params) => api.get("/assignments/teacher/materials/", { params }),
    get: (id) => api.get(`/assignments/teacher/materials/${id}/`),
    create: (formData) => api.post("/assignments/teacher/materials/", formData),
    update: (id, formData) => api.patch(`/assignments/teacher/materials/${id}/`, formData),
    remove: (id) => api.delete(`/assignments/teacher/materials/${id}/`),
    publish: (id) => api.post(`/assignments/teacher/materials/${id}/publish/`),
    unpublish: (id) => api.post(`/assignments/teacher/materials/${id}/unpublish/`),
    tracking: (id, params) => api.get(`/assignments/teacher/materials/${id}/tracking/`, { params }),
  },
  student: {
    summary: () => api.get("/assignments/student/materials/summary/"),
    list: (params) => api.get("/assignments/student/materials/", { params }),
    get: (id) => api.get(`/assignments/student/materials/${id}/`),
    download: (id) =>
      api.get(`/assignments/student/materials/${id}/download/`, { responseType: "blob" }),
  },
};

const hrCrud = (path) => ({
  list: (params) => api.get(`/hr/${path}/`, { params }),
  create: (payload) => api.post(`/hr/${path}/`, payload),
  update: (id, payload) => api.patch(`/hr/${path}/${id}/`, payload),
});

export const hrApi = {
  dashboard: () => api.get("/hr/dashboard/"),
  departments: hrCrud("departments"),
  positions: hrCrud("positions"),
  leaveTypes: hrCrud("leave-types"),
  employees: {
    ...hrCrud("employees"),
    createLogin: (id) => api.post(`/hr/employees/${id}/create_login/`),
    exit: (id, payload) => api.post(`/hr/employees/${id}/exit/`, payload),
    availableUsers: () => api.get("/hr/employees/available_users/"),
    unlinkUser: (id) => api.post(`/hr/employees/${id}/unlink_user/`),
  },
  leave: {
    ...hrCrud("leave"),
    approve: (id, remarks) => api.post(`/hr/leave/${id}/approve/`, { remarks }),
    reject: (id, remarks) => api.post(`/hr/leave/${id}/reject/`, { remarks }),
  },
  attendance: {
    ...hrCrud("attendance"),
    bulk: (date, rows) => api.post("/hr/attendance/bulk/", { date, rows }),
  },
};

const hrList = (r) => r.data.results ?? r.data;
export { hrList };
export const payrollApi = {
  salaries: (p) => api.get("/hr/salaries/", { params: p }),
  saveSalary: (payload, id) => (id ? api.patch(`/hr/salaries/${id}/`, payload) : api.post("/hr/salaries/", payload)),
  rates: () => api.get("/hr/statutory-rates/"),
  runs: () => api.get("/hr/payroll-runs/"),
  generate: (year, month) => api.post("/hr/payroll-runs/", { year, month }),
  payslips: (id) => api.get(`/hr/payroll-runs/${id}/payslips/`),
  approve: (id) => api.post(`/hr/payroll-runs/${id}/approve/`),
  markPaid: (id) => api.post(`/hr/payroll-runs/${id}/mark_paid/`),
  mine: () => api.get("/hr/my-payslips/"),
  syncRun: (id) => api.post(`/hr/payroll-runs/${id}/sync/`),
  editPayslip: (id, slipId, payload) => api.post(`/hr/payroll-runs/${id}/payslips/${slipId}/edit/`, payload),
};
export const recruitmentApi = {
  vacancies: () => api.get("/hr/vacancies/"),
  createVacancy: (p) => api.post("/hr/vacancies/", p),
  applications: (vacancy) => api.get("/hr/applications/", { params: { vacancy } }),
  addApplication: (p) => api.post("/hr/applications/", p),
  update: (id, p) => api.patch(`/hr/applications/${id}/`, p),
  hire: (id, p) => api.post(`/hr/applications/${id}/hire/`, p),
};
export const gateApi = {
  code: () => api.get("/hr/attendance-gate/code/"),
  settings: () => api.get("/hr/attendance-gate/settings/"),
  saveSettings: (p) => api.patch("/hr/attendance-gate/settings/", p),
  log: () => api.get("/hr/attendance-gate/scan-log/"),
  resetDevice: (id) => api.post(`/hr/attendance-gate/reset-device/${id}/`),
  scan: (p) => api.post("/hr/scan/", p),
};
export const hrReportsApi = {
  get: (name, params) => api.get(`/hr/reports/${name}/`, { params }),
  csv: (name, params) => api.get(`/hr/reports/${name}/`, { params: { ...params, format: "csv" }, responseType: "blob" }),
};


export const mealApi = {
  // scan desk
  scan: (qr_token, meal_type) => api.post("/meals/scan/", { qr_token, meal_type }),
  issue: (qr_token, meal_type) => api.post("/meals/issue/", { qr_token, meal_type }),
  sync: (scans) => api.post("/meals/sync/", { scans }),
  roster: () => api.get("/meals/roster/"),

  // reports
  dashboard: (params) => api.get("/meals/dashboard/", { params }),
  missing: (params) => api.get("/meals/missing/", { params }),
  collections: (params) => api.get("/meals/collections/", { params }),
  undoCollection: (id) => api.post(`/meals/collections/${id}/undo/`),

  // plans
  plans: (params) => api.get("/meals/plans/", { params }),
  createPlan: (payload) => api.post("/meals/plans/", payload),
  updatePlan: (id, payload) => api.patch(`/meals/plans/${id}/`, payload),
  studentPlans: (params) => api.get("/meals/student-plans/", { params }),
  bulkAssign: (payload) => api.post("/meals/student-plans/bulk_assign/", payload),

  deletePlan: (id) => api.delete(`/meals/plans/${id}/`),
  createStudentPlan: (payload) => api.post("/meals/student-plans/", payload),
  updateStudentPlan: (id, payload) => api.patch(`/meals/student-plans/${id}/`, payload),
  removeStudentPlan: (id) => api.delete(`/meals/student-plans/${id}/`),

  // cards
  cards: (params) => api.get("/meals/cards/", { params }),
  issueCard: (student_id) => api.post("/meals/cards/issue/", { student_id }),
  issueCardsForClass: (classroom_id) => api.post("/meals/cards/issue_bulk/", { classroom_id }),
  setCardStatus: (id, status) => api.post(`/meals/cards/${id}/set_status/`, { status }),
  classSheet: (classroom) => api.get("/meals/cards/class_sheet/", { params: { classroom } }),

  // wallet (office / finance)
  wallet: (admission_no) => api.get("/meals/wallet/", { params: { admission_no } }),
  topUp: (payload) => api.post("/meals/wallet/topup/", payload),

  // attendants
  attendants: () => api.get("/meals/attendants/"),
  addAttendant: (user) => api.post("/meals/attendants/", { user, is_active: true }),
  updateAttendant: (id, payload) => api.patch(`/meals/attendants/${id}/`, payload),
  removeAttendant: (id) => api.delete(`/meals/attendants/${id}/`),

  // student / parent (parents pass { student_id } as params to pick a child)
  my: (params) => api.get("/meals/my/", { params }),
  payWallet: (payload, params) => api.post("/meals/wallet/pay/", payload, { params }),
  payStatus: (checkoutId, params) => api.get(`/meals/wallet/pay/status/${checkoutId}/`, { params }),
};


export const libraryApi = {
  dashboard: () => api.get("/library/dashboard/"),

  categories: () => api.get("/library/categories/"),
  createCategory: (payload) => api.post("/library/categories/", payload),

  books: (params) => api.get("/library/books/", { params }),
  createBook: (payload) => api.post("/library/books/", payload),
  updateBook: (id, payload) => api.patch(`/library/books/${id}/`, payload),
  deleteBook: (id) => api.delete(`/library/books/${id}/`),
  copies: (bookId) => api.get(`/library/books/${bookId}/copies/`),
  addCopies: (bookId, count) => api.post(`/library/books/${bookId}/add_copies/`, { count }),
  setCopyStatus: (copyId, status) => api.post(`/library/copies/${copyId}/status/`, { status }),

  searchStudents: (q) => api.get("/library/students/search/", { params: { q } }),
  issue: (payload) => api.post("/library/issue/", payload),
  returnPreview: (accession_no) => api.get("/library/return-preview/", { params: { accession_no } }),
  returnBook: (payload) => api.post("/library/return/", payload),

  loans: (params) => api.get("/library/loans/", { params }),
  renew: (id) => api.post(`/library/loans/${id}/renew/`),
  fines: (params) => api.get("/library/fines/", { params }),
  payFine: (id) => api.post(`/library/fines/${id}/pay/`, {}),
  waiveFine: (id, note) => api.post(`/library/fines/${id}/waive/`, { note }),

  overdueReport: () => api.get("/library/reports/overdue/"),
  popularReport: (params) => api.get("/library/reports/popular/", { params }),
  stockReport: () => api.get("/library/reports/stock/"),
  remindOverdue: () => api.post("/library/reports/remind/"),

  settings: () => api.get("/library/settings/"),
  saveSettings: (payload) => api.patch("/library/settings/", payload),

  my: (params) => api.get("/library/my/", { params }),
};


// ---------------------------------------------------------------------------
// PROCUREMENT  (backed by the separate `procurement` Django app,
// mounted at /api/v1/procurement/)
// ---------------------------------------------------------------------------
const procCrud = (path) => ({
  list: (params) => api.get(`/procurement/${path}/`, { params: { page_size: 500, ...params } }),
  get: (id) => api.get(`/procurement/${path}/${id}/`),
  create: (payload) => api.post(`/procurement/${path}/`, payload),
  update: (id, payload) => api.patch(`/procurement/${path}/${id}/`, payload),
  remove: (id) => api.delete(`/procurement/${path}/${id}/`),
  // workflow actions, e.g. act(id, "submit"), act(id, "approve", { comment })
  act: (id, action, body = {}) => api.post(`/procurement/${path}/${id}/${action}/`, body),
  read: (id, action) => api.get(`/procurement/${path}/${id}/${action}/`),
});

// list responses may be paginated ({results}) or plain arrays
export const procUnwrap = (r) => r?.data?.results ?? r?.data ?? [];

// turns a DRF error response into one readable sentence
export const procErrMsg = (e) => {
  const d = e?.response?.data;
  if (!d) return e?.message || "Something went wrong.";
  if (typeof d === "string") return d.slice(0, 300);
  if (d.detail) return d.detail;
  const flat = (v) =>
    Array.isArray(v) ? v.map(flat).join(" ") : v && typeof v === "object" ? Object.values(v).map(flat).join(" ") : String(v);
  return Object.entries(d)
    .map(([k, v]) => (k === "non_field_errors" ? flat(v) : `${k.replaceAll("_", " ")}: ${flat(v)}`))
    .join(" | ");
};

// short names used by the procurement pages: import { procApi, unwrap, errMsg } from "../../services/api"
export const unwrap = procUnwrap;
export const errMsg = procErrMsg;

export const procApi = {
  // dashboard, approvals inbox, reports
  dashboard: () => api.get("/procurement/dashboard/"),
  inbox: () => api.get("/procurement/approvals/pending/"),
  report: (name, params) => api.get(`/procurement/reports/${name}/`, { params }),
  reportCsv: (name, params) =>
    api.get(`/procurement/reports/${name}/`, { params: { ...params, export: "csv" }, responseType: "blob" }),

  // configuration
  levels: procCrud("approval-levels"),
  budgets: procCrud("budgets"),

  // masters
  suppliers: procCrud("suppliers"),
  contracts: procCrud("contracts"),

  // workflow documents
  requisitions: procCrud("requisitions"), // act: submit | approve | reject | cancel ; read: history
  rfqs: procCrud("rfqs"),                 // act: send | close | cancel
  quotations: procCrud("quotations"),     // act: select
  purchaseOrders: {                       // act: submit | approve | reject | send | close | cancel ; read: history
    ...procCrud("purchase-orders"),
    fromQuotation: (payload) => api.post("/procurement/purchase-orders/from_quotation/", payload),
  },
  grns: procCrud("grns"),                 // act: inspect
  grnItems: procCrud("grn-items"),
  invoices: procCrud("invoices"),         // act: rematch | approve | reject | pay
  returns: procCrud("returns"),           // act: mark_returned | mark_credited

  // audit trail (read-only)
  audit: procCrud("audit-log"),
};


const bursaryCrud = (path) => ({
  list: (params) => api.get(`/bursaries/${path}/`, { params }),
  create: (payload) => api.post(`/bursaries/${path}/`, payload),
  update: (id, payload) => api.patch(`/bursaries/${path}/${id}/`, payload),
  remove: (id) => api.delete(`/bursaries/${path}/${id}/`),
});
 
export const bursaryApi = {
  dashboard: (params) => api.get("/bursaries/dashboard/", { params }),
  my: (params) => api.get("/bursaries/my/", { params }),
 
  sources: bursaryCrud("sources"),
 
  schemes: {
    ...bursaryCrud("schemes"),
    candidates: (id) => api.get(`/bursaries/schemes/${id}/evaluate/`),
    createFromCandidates: (id, payload) => api.post(`/bursaries/schemes/${id}/evaluate/`, payload),
  },
 
  awards: {
    list: (params) => api.get("/bursaries/awards/", { params }),
    create: (payload) => api.post("/bursaries/awards/", payload),
    terms: (id) => api.get(`/bursaries/awards/${id}/terms/`),
    approve: (id) => api.post(`/bursaries/awards/${id}/approve/`),
    reject: (id, reason) => api.post(`/bursaries/awards/${id}/reject/`, { reason }),
    suspend: (id) => api.post(`/bursaries/awards/${id}/suspend/`),
    resume: (id) => api.post(`/bursaries/awards/${id}/resume/`),
    reapply: (id) => api.post(`/bursaries/awards/${id}/reapply/`),
    reverseTerm: (id, award_term, reason) =>
      api.post(`/bursaries/awards/${id}/reverse_term/`, { award_term, reason }),
  },
 
  remittances: {
    list: (params) => api.get("/bursaries/remittances/", { params }),
    create: (payload) => api.post("/bursaries/remittances/", payload),
    candidates: (id) => api.get(`/bursaries/remittances/${id}/candidates/`),
    allocations: (id) => api.get(`/bursaries/remittances/${id}/allocations/`),
    allocate: (id, rows) => api.post(`/bursaries/remittances/${id}/allocate/`, { rows }),
    reverseAllocation: (id, allocation, reason) =>
      api.post(`/bursaries/remittances/${id}/reverse_allocation/`, { allocation, reason }),
  },
};



// ---------------------------------------------------------------------------
// BOARDING & HOSTEL API
// ---------------------------------------------------------------------------
const B = "/boarding";

export const boardingApi = {
  // who am I / what may I do
  access: () => api.get(`${B}/access/`),
  dashboard: () => api.get(`${B}/dashboard/`),

  // settings (admin writes, staff read)
  settings: () => api.get(`${B}/settings/`),
  updateSettings: (payload) => api.patch(`${B}/settings/`, payload),
  wardenUsers: () => api.get(`${B}/wardens/`),

  // structure
  dormitories: (params) => api.get(`${B}/dormitories/`, { params }),
  createDormitory: (payload) => api.post(`${B}/dormitories/`, payload),
  updateDormitory: (id, payload) => api.patch(`${B}/dormitories/${id}/`, payload),
  deleteDormitory: (id) => api.delete(`${B}/dormitories/${id}/`),
  setWardens: (id, userIds) => api.post(`${B}/dormitories/${id}/set_wardens/`, { user_ids: userIds }),
  generateRooms: (id, payload) => api.post(`${B}/dormitories/${id}/generate_rooms/`, payload),
  occupancy: (id, academicYear) =>
    api.get(`${B}/dormitories/${id}/occupancy/`, { params: { academic_year: academicYear } }),

  rooms: (params) => api.get(`${B}/rooms/`, { params }),
  updateRoom: (id, payload) => api.patch(`${B}/rooms/${id}/`, payload),
  deleteRoom: (id) => api.delete(`${B}/rooms/${id}/`),
  addBeds: (roomId, count) => api.post(`${B}/rooms/${roomId}/add_beds/`, { count }),

  beds: (params) => api.get(`${B}/beds/`, { params }),
  updateBed: (id, payload) => api.patch(`${B}/beds/${id}/`, payload),
  deleteBed: (id) => api.delete(`${B}/beds/${id}/`),
  bedHistory: (id, params) => api.get(`${B}/beds/${id}/history/`, { params }),

  // boarders
  registrations: (params) => api.get(`${B}/registrations/`, { params }),
  eligible: (params) => api.get(`${B}/registrations/eligible/`, { params }),
  registerStudent: (payload) => api.post(`${B}/registrations/`, payload),
  registerClassroom: (classroom) => api.post(`${B}/registrations/register_classroom/`, { classroom }),
  withdraw: (id, reason) => api.post(`${B}/registrations/${id}/withdraw/`, { reason }),
  studentHistory: (student) => api.get(`${B}/registrations/history/`, { params: { student } }),

  // bed allocation
  allocations: (params) => api.get(`${B}/allocations/`, { params }),
  allocate: (payload) => api.post(`${B}/allocations/allocate/`, payload),
  transfer: (payload) => api.post(`${B}/allocations/transfer/`, payload),
  release: (id, payload = {}) => api.post(`${B}/allocations/${id}/release/`, payload),
  autoAllocate: (payload) => api.post(`${B}/allocations/auto_allocate/`, payload),
  rollover: (payload) => api.post(`${B}/allocations/rollover/`, payload),

  // exeat / leave-out
  exeats: (params) => api.get(`${B}/exeats/`, { params }),
  createExeat: (payload) => api.post(`${B}/exeats/`, payload),
  exeat: (id) => api.get(`${B}/exeats/${id}/`),
  exeatAct: (id, action, body = {}) => api.post(`${B}/exeats/${id}/${action}/`, body),
  // actions: approve | reject (note required) | cancel | check_out | check_in

  // roll call
  rollCalls: (params) => api.get(`${B}/roll-calls/`, { params }),
  openRollCall: (payload) => api.post(`${B}/roll-calls/`, payload),
  rollCall: (id) => api.get(`${B}/roll-calls/${id}/`),
  markRollCall: (id, marks) => api.post(`${B}/roll-calls/${id}/mark/`, { marks }),
  submitRollCall: (id) => api.post(`${B}/roll-calls/${id}/submit/`),
  reopenRollCall: (id) => api.post(`${B}/roll-calls/${id}/reopen/`),
  absentees: (date) => api.get(`${B}/roll-calls/absentees/`, { params: { date } }),

  // boarding fees
  feeRates: (params) => api.get(`${B}/fee-rates/`, { params }),
  createFeeRate: (payload) => api.post(`${B}/fee-rates/`, payload),
  updateFeeRate: (id, payload) => api.patch(`${B}/fee-rates/${id}/`, payload),
  deleteFeeRate: (id) => api.delete(`${B}/fee-rates/${id}/`),
  billFees: (payload) => api.post(`${B}/fee-rates/bill/`, payload),
  billings: (params) => api.get(`${B}/fee-rates/billings/`, { params }),

  // student / parent
  my: () => api.get(`${B}/my/`),
  requestExeat: (payload) => api.post(`${B}/my/exeat-requests/`, payload),
};


export const otherPaymentsApi = {
  types: () => api.get("/charge-types/"),
  createType: (body) => api.post("/charge-types/", body),
  updateType: (id, body) => api.patch(`/charge-types/${id}/`, body),
  deleteType: (id) => api.delete(`/charge-types/${id}/`),
  charges: (params) => api.get("/student-charges/", { params }),
  createCharge: (body) => api.post("/student-charges/", body),
  bulkCharges: (body) => api.post("/student-charges/bulk/", body),
  waiveCharge: (id, reason) => api.post(`/student-charges/${id}/waive/`, { reason }),
  cancelCharge: (id, reason) => api.post(`/student-charges/${id}/cancel/`, { reason }),
  payments: (params) => api.get("/other-payments/", { params }),
  record: (body) => api.post("/other-payments/", body),
  summary: (params) => api.get("/other-payments/summary/", { params }),
  lookup: (q) => api.get("/other-payments/student-lookup/", { params: { q } }),
  receipt: (id) => api.get(`/other-payments/${id}/receipt/`),
  classrooms: () => api.get("/classrooms/all/"),
};

export const student360Api = {
  overview: (id) => api.get(`/students/${id}/360/overview/`),
  fees: (id) => api.get(`/students/${id}/360/fees/`),
  academics: (id) => api.get(`/students/${id}/360/academics/`),
  meals: (id) => api.get(`/students/${id}/360/meals/`),
  library: (id) => api.get(`/students/${id}/360/library/`),
  discipline: (id) => api.get(`/students/${id}/360/discipline/`),
  addDiscipline: (id, payload) => api.post(`/students/${id}/360/discipline/`, payload),
  account: (id) => api.get(`/students/${id}/360/account/`),
  setActive: (id, payload) => api.post(`/students/${id}/360/account/`, payload),
  uploadPhoto: (id, formData) => api.post(`/student-id/profiles/${id}/`, formData),
};



export default api;