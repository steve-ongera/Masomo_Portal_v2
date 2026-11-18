import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { EntitlementProvider } from "./context/EntitlementContext";
import ProtectedRoute from "./components/ProtectedRoute";
import { FeatureRoute } from "./components/FeatureGate";
import AppLayout from "./components/AppLayout";
import PageLoader from "./components/PageLoader";

// ---------------------------------------------------------------------------
// Every page is lazy-loaded: its code is only downloaded when someone opens
// it, which makes the first visit to the domain much lighter. While a page
// downloads, a <Suspense> boundary shows the circular loader.
// (AuthProvider, EntitlementProvider, ProtectedRoute, FeatureRoute, AppLayout
// and PageLoader stay eager so the shell and the loader itself are always
// available.)
// ---------------------------------------------------------------------------
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Profile = lazy(() => import("./pages/Profile"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const Notifications = lazy(() => import("./pages/Notifications"));
const VerifyReportCard = lazy(() => import("./pages/VerifyReportCard"));
const NotFound = lazy(() => import("./pages/NotFound"));

// help & support - shared across ADMIN / TEACHER / FINANCE / STUDENT
const UserManual = lazy(() => import("./pages/UserManual"));
const ContactDeveloper = lazy(() => import("./pages/ContactDeveloper"));

// clearance
const StudentClearance = lazy(() => import("./pages/student/Clearance"));
const AdminClearance = lazy(() => import("./pages/admin/Clearance"));

// admin
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminLicense = lazy(() => import("./pages/admin/License"));
const AdminStudents = lazy(() => import("./pages/admin/Students"));
const AdminMarkEntry = lazy(() => import("./pages/admin/MarkEntry"));
const AdminClassrooms = lazy(() => import("./pages/admin/Classrooms"));
const AdminSubjects = lazy(() => import("./pages/admin/Subjects"));
const AdminTeacherAllocation = lazy(() => import("./pages/admin/TeacherAllocation"));
const AdminTimetableManagement = lazy(() => import("./pages/admin/TimetableManagement"));
const AdminExams = lazy(() => import("./pages/admin/Exams"));
const AdminRankings = lazy(() => import("./pages/admin/Rankings"));
const AdminPromotions = lazy(() => import("./pages/admin/Promotions"));
const AdminFees = lazy(() => import("./pages/admin/Fees"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminSecurityMonitor = lazy(() => import("./pages/admin/SecurityMonitor"));
const AdminExpenses = lazy(() => import("./pages/admin/Expenses"));
const AdminReports = lazy(() => import("./pages/admin/Reports"));
const AdminCalendar = lazy(() => import("./pages/admin/Calendar"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));
const AdminParents = lazy(() => import("./pages/admin/Parents"));
const AdminLetters = lazy(() => import("./pages/admin/Letters"));

// admin finance reports
const AdminFinanceCollections = lazy(() => import("./pages/admin/finance/Collections"));
const AdminFinanceClassAnalysis = lazy(() => import("./pages/admin/finance/ClassAnalysis"));
const AdminFinanceDetailedReport = lazy(() => import("./pages/admin/finance/DetailedReport"));

// principal — own dashboard only; everywhere else it reuses the Admin
// page components above (imported once, mounted under /principal/*)
const PrincipalDashboard = lazy(() => import("./pages/principal/Dashboard"));

// secretary — own dashboard only; everywhere else it reuses the Admin
// (and, for Invoices/Payments/Verify Receipt, the Finance) page
// components imported above, mounted under /secretary/*
const SecretaryDashboard = lazy(() => import("./pages/secretary/Dashboard"));

// examination officer — own dashboard only; everywhere else it reuses the
// Admin page components above, mounted under /exam-officer/*
const ExamOfficerDashboard = lazy(() => import("./pages/examofficer/Dashboard"));

// grading scales + automatic promotion settings. Built once, mounted under
// both /exam-officer/* and /admin/* (the API allows ADMIN and EXAM_OFFICER).
const GradingScales = lazy(() => import("./pages/examofficer/GradingScales"));
const PromotionSettings = lazy(() => import("./pages/examofficer/PromotionSettings"));

// finance
const FinanceDashboard = lazy(() => import("./pages/finance/Dashboard"));
const FinanceStructures = lazy(() => import("./pages/finance/Structures"));
const FinanceInvoices = lazy(() => import("./pages/finance/Invoices"));
const FinancePayments = lazy(() => import("./pages/finance/Payments"));
const FinanceExpenses = lazy(() => import("./pages/finance/Expenses"));
const FinanceCollections = lazy(() => import("./pages/finance/Collections"));
const FinanceClassAnalysis = lazy(() => import("./pages/finance/ClassAnalysis"));
const FinanceDetailedReport = lazy(() => import("./pages/finance/DetailedReport"));
import FinanceVerifyReceipt from "./pages/finance/FinanceVerifyReceipt";
const FeeUpdateCards = lazy(() => import("./pages/finance/FeeUpdateCards"));
const VerifyGatepass = lazy(() => import("./pages/VerifyGatepass"));

// teacher
const TeacherDashboard = lazy(() => import("./pages/teacher/Dashboard"));
const TeacherClasses = lazy(() => import("./pages/teacher/Classes"));
const TeacherTimetable = lazy(() => import("./pages/teacher/Timetable"));
const TeacherMarkEntry = lazy(() => import("./pages/teacher/MarkEntry"));
const TeacherClassMarkEntry = lazy(() => import("./pages/teacher/ClassMarkEntry"));
const TeacherRankings = lazy(() => import("./pages/teacher/Rankings"));
const LessonPlanningHome = lazy(() => import("./pages/teacher/lesson-planning/LessonPlanningHome"));
const SchemesOfWork = lazy(() => import("./pages/teacher/lesson-planning/SchemesOfWork.jsx"));
const SchemeEditor = lazy(() => import("./pages/teacher/lesson-planning/SchemeEditor"));
const LessonPlans = lazy(() => import("./pages/teacher/lesson-planning/LessonPlans"));
const LessonPlanEditor = lazy(() => import("./pages/teacher/lesson-planning/LessonPlanEditor"));

// teacher attendance (backed by the separate `attendance` Django app)
const AttendanceHome = lazy(() => import("./pages/teacher/attendance/AttendanceHome"));
const MarkAttendance = lazy(() => import("./pages/teacher/attendance/MarkAttendance"));
const AttendanceRecords = lazy(() => import("./pages/teacher/attendance/AttendanceRecords"));
const AttendanceReports = lazy(() => import("./pages/teacher/attendance/AttendanceReports"));

// teacher assignments & revision material (backed by the separate
// `assignments` Django app): send CATs / take-aways / homework / holiday
// homework / revision notes to allocated classes, then see who opened or
// downloaded them.
const TeacherAssignments = lazy(() => import("./pages/teacher/assignments/Assignments"));
const TeacherAssignmentTracking = lazy(() => import("./pages/teacher/assignments/Tracking"));

// student
const StudentDashboard = lazy(() => import("./pages/student/Dashboard"));
const StudentResults = lazy(() => import("./pages/student/Results"));
const StudentSubjects = lazy(() => import("./pages/student/Subjects"));
const StudentTimetable = lazy(() => import("./pages/student/Timetable"));
const StudentFees = lazy(() => import("./pages/student/Fees"));
const StudentFeeStructure = lazy(() => import("./pages/student/FeeStructure"));

// student assignments & revision material (list + open/download)
const StudentAssignments = lazy(() => import("./pages/student/assignments/Assignments"));
const StudentAssignmentView = lazy(() => import("./pages/student/assignments/AssignmentView"));

// parent
const ParentDashboard = lazy(() => import("./pages/parent/Dashboard"));
const ParentChildren = lazy(() => import("./pages/parent/Children"));
const ParentResults = lazy(() => import("./pages/parent/Results"));
const ParentFees = lazy(() => import("./pages/parent/Fees"));

// boarding / hostel warden (backed by the separate `boarding` Django app)
const BoardingDashboard = lazy(() => import("./pages/warden/Dashboard"));
const Hostels = lazy(() => import("./pages/warden/Hostels"));
const Boarders = lazy(() => import("./pages/warden/Boarders"));
const Allocations = lazy(() => import("./pages/warden/Allocations"));
const Exeats = lazy(() => import("./pages/warden/Exeats"));
const RollCall = lazy(() => import("./pages/warden/RollCall"));
const BoardingHistory = lazy(() => import("./pages/warden/History"));
const BoardingRollover = lazy(() => import("./pages/warden/Rollover"));
const BoardingSettings = lazy(() => import("./pages/warden/Settings"));
const MyBoarding = lazy(() => import("./pages/shared/MyBoarding"));

// mirror boarding/permissions.py
const BOARD_VIEW = ["ADMIN", "PRINCIPAL", "SECRETARY", "HOSTEL_WARDEN"];
const BOARD_ADMIN = ["ADMIN"];
const BOARD_SETTINGS = ["ADMIN", "FINANCE"];

// bursaries, scholarships & fee discounts (backed by the separate
// `bursaries` Django app, mounted at /api/v1/bursaries/)
const BursaryDashboard = lazy(() => import("./pages/bursaries/Dashboard"));
const BursaryAwards = lazy(() => import("./pages/bursaries/Awards"));
const BursarySetup = lazy(() => import("./pages/bursaries/Setup"));
const BursaryRemittances = lazy(() => import("./pages/bursaries/Remittances"));

// mirror bursaries/permissions.py
const BURSARY_VIEW = ["ADMIN", "PRINCIPAL", "SECRETARY", "FINANCE"]; // overview, awards (request / approve)
const BURSARY_SETUP = ["ADMIN", "FINANCE"]; // funders, schemes, funds received

// communications & messaging - shared across roles
const Communications = lazy(() => import("./pages/Communications"));
const Messages = lazy(() => import("./pages/Messages"));

// hr — HR officer pages (/hr/*) plus staff self-service (QR sign in/out,
// own payslips). Backed by the separate `hr` Django app.
const HRDashboard = lazy(() => import("./pages/hr/Dashboard"));
const HREmployees = lazy(() => import("./pages/hr/Employees"));
const HRRecruitment = lazy(() => import("./pages/hr/Recruitment"));
const HRAttendance = lazy(() => import("./pages/hr/Attendance"));
const HRGateScreen = lazy(() => import("./pages/hr/GateScreen"));
const HRLeave = lazy(() => import("./pages/hr/Leave"));
const HRPayroll = lazy(() => import("./pages/hr/Payroll"));
const HRReports = lazy(() => import("./pages/hr/Reports"));
const StaffScan = lazy(() => import("./pages/hr/Scan"));
const MyPayslips = lazy(() => import("./pages/hr/MyPayslips"));

// library — librarian pages (/librarian/*) plus the learner/parent view.
// Backed by the separate `library` Django app.
const LibraryDashboard = lazy(() => import("./pages/librarian/Dashboard"));
const LibraryDesk = lazy(() => import("./pages/librarian/Desk"));
const LibraryCatalogue = lazy(() => import("./pages/librarian/Catalogue"));
const LibraryLoans = lazy(() => import("./pages/librarian/Loans"));
const LibraryReports = lazy(() => import("./pages/librarian/Reports"));
const LibrarySettings = lazy(() => import("./pages/librarian/Settings"));
const MyLibrary = lazy(() => import("./pages/shared/MyLibrary"));

const CafeteriaScanDesk = lazy(() => import("./pages/cafeteria/ScanDesk"));
const MealDashboard = lazy(() => import("./pages/meals/Dashboard"));
const MealPlans = lazy(() => import("./pages/meals/Plans"));
const MealCards = lazy(() => import("./pages/meals/Cards"));
const MealCollections = lazy(() => import("./pages/meals/Collections"));
const MealBilling = lazy(() => import("./pages/meals/Billing"));
const MealAttendants = lazy(() => import("./pages/meals/Attendants"));
// student / parent: meal plan, QR card, meal wallet and M-Pesa top-up
const MyMeals = lazy(() => import("./pages/shared/MyMeals"));

const MEAL_OPERATE = ["ADMIN", "SECRETARY", "CAFETERIA"]; // dashboard, cards, collections
const MEAL_ADMIN = ["ADMIN", "SECRETARY"]; // plans, attendants
const MEAL_BILLING = ["ADMIN", "SECRETARY", "FINANCE"];

// student ID cards, morning gate scan & ID lookup (backed by the separate
// `idcards` Django app, mounted at /api/v1/student-id/)
const StudentIdCards = lazy(() => import("./pages/StudentId/StudentIdCards"));
const StudentIdScan = lazy(() => import("./pages/StudentId/StudentIdScan"));
const StudentIdLookup = lazy(() => import("./pages/StudentId/StudentIdLookup"));

// mirror idcards/views.py (ISSUERS / SCANNERS / VIEWERS)
const ID_ISSUE = ["ADMIN", "SECRETARY", "PRINCIPAL"]; // create / replace / print ID cards
const ID_SCAN = ["TEACHER", "ADMIN", "SECRETARY", "PRINCIPAL", "STAFF"]; // morning attendance scan
const ID_LOOKUP = ["ADMIN", "PRINCIPAL", "SECRETARY", "FINANCE"]; // scan a card -> all student data

// procurement — requisition-to-payment workflow (/procurement/*), shared by
// the PROCUREMENT officer and the roles that request, approve, receive or pay.
// Backed by the separate `procurement` Django app.
const ProcDashboard = lazy(() => import("./pages/procurement/Dashboard"));
const ProcRequisitions = lazy(() => import("./pages/procurement/Requisitions"));
const ProcApprovals = lazy(() => import("./pages/procurement/Approvals"));
const ProcSuppliers = lazy(() => import("./pages/procurement/Suppliers"));
const ProcRfqs = lazy(() => import("./pages/procurement/Rfqs"));
const ProcPurchaseOrders = lazy(() => import("./pages/procurement/PurchaseOrders"));
const ProcGoodsReceived = lazy(() => import("./pages/procurement/GoodsReceived"));
const ProcInvoices = lazy(() => import("./pages/procurement/Invoices"));
const ProcContracts = lazy(() => import("./pages/procurement/Contracts"));
const ProcReturns = lazy(() => import("./pages/procurement/Returns"));
const ProcBudgets = lazy(() => import("./pages/procurement/Budgets"));
const ProcReports = lazy(() => import("./pages/procurement/Reports"));
const ProcAudit = lazy(() => import("./pages/procurement/AuditTrail"));

// ---------------------------------------------------------------------------
// Route guards. These sit INSIDE AppLayout, so their Suspense fallback is the
// inline loader: the sidebar and navbar stay on screen while a page loads.
//
// Order matters: ProtectedRoute (are you signed in, is it your role?) ->
// FeatureRoute (is this module in the school's plan?) -> Suspense/page.
// The route -> feature map comes from the database (Feature.ui_prefixes), so
// none of the ~200 routes below need to change when a plan changes.
// ---------------------------------------------------------------------------
function Guarded({ roles, children }) {
  return (
    <ProtectedRoute allowedRoles={roles}>
      <FeatureRoute>
        <Suspense fallback={<PageLoader inline />}>{children}</Suspense>
      </FeatureRoute>
    </ProtectedRoute>
  );
}

function RoleSection({ role, children }) {
  return <Guarded roles={[role]}>{children}</Guarded>;
}

// Gate Pass verification (scanning a Fee Update Card's QR, or looking one
// up manually): every signed-in role EXCEPT the student themself. A
// student is exactly who the card is about, so they're deliberately left
// out here - everyone else (gate/security-facing staff, teachers,
// parents dropping off a child, finance/admin/secretary/principal/exam
// officer) can verify one.
const GATEPASS_VERIFIER_ROLES = ["ADMIN", "PRINCIPAL", "SECRETARY", "TEACHER", "PARENT", "FINANCE", "EXAM_OFFICER"];

// Everyone who is a school employee: can scan the gate QR to sign in/out
// and read their own released payslips. This is EVERY role except STUDENT
// and PARENT:
//   ADMIN, PRINCIPAL, SECRETARY, EXAM_OFFICER, TEACHER, FINANCE, HR,
//   LIBRARIAN, CAFETERIA, PROCUREMENT, HOSTEL_WARDEN and STAFF (support
//   staff / ICT / administration employees with no other role).
// The `hr` backend must accept all of these roles as well, otherwise the
// page will open but its API calls will 403.
const STAFF_ROLES = [
  "ADMIN", "PRINCIPAL", "SECRETARY", "EXAM_OFFICER",
  "TEACHER", "FINANCE", "HR", "LIBRARIAN", "CAFETERIA", "PROCUREMENT", "STAFF",
  "HOSTEL_WARDEN",
];

// Shared help pages.
const HELP_ROLES = [
  "ADMIN", "TEACHER", "FINANCE", "STUDENT", "PRINCIPAL", "SECRETARY", "LIBRARIAN", "CAFETERIA", "PROCUREMENT",
  "EXAM_OFFICER", "HOSTEL_WARDEN",
];

// Meal scan desk. The API itself also requires Admin / Secretary / an
// active CAFETERIA user (or an explicitly added attendant).
const CAFETERIA_ROLES = ["ADMIN", "SECRETARY", "CAFETERIA"];

// Procurement access. These mirror procurement/permissions.py on the backend
// (MANAGE / VIEW_ALL / REQUESTERS / STORE) so the UI never offers a page the
// API would refuse.
//   PROC_VIEW    - procurement officer plus oversight roles (dashboard, POs, suppliers, invoices, reports...)
//   PROC_REQUEST - anyone who may raise a purchase requisition (own requisitions only, unless PROC_VIEW)
//   PROC_STORE   - people who receive goods at the store (GRN, returns)
const PROC_VIEW = ["ADMIN", "PROCUREMENT", "PRINCIPAL", "FINANCE", "SECRETARY"];
const PROC_REQUEST = [...PROC_VIEW, "TEACHER", "STAFF", "HR", "LIBRARIAN", "CAFETERIA", "EXAM_OFFICER"];
const PROC_STORE = [...PROC_VIEW, "STAFF"];
const PROC_AUDIT = ["ADMIN", "PROCUREMENT", "PRINCIPAL"];

export default function App() {
  return (
    <AuthProvider>
      {/* Outer boundary: full-screen loader for public pages (login, reset,
          verify) and for anything that loads outside the app layout. */}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/verify-report-card/:token" element={<VerifyReportCard />} />
          {/* Student-only self-service password reset. Admin/Teacher/Finance
              accounts are deliberately NOT reachable here - see AdminUsers /
              SecurityMonitor for staff password resets and unlocks. */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />

          {/* Everything inside the app shell can ask "what does this school's
              plan include?" through useEntitlements(). The provider sits inside
              AuthProvider (it needs the signed-in user) and outside AppLayout
              (so the sidebar can hide / lock menu items too). Public pages above
              are deliberately outside it. */}
          <Route element={<EntitlementProvider><AppLayout /></EntitlementProvider>}>
            {/* shared - any authenticated role */}
            <Route path="/profile" element={<Guarded><Profile /></Guarded>} />
            <Route path="/change-password" element={<Guarded><ChangePassword /></Guarded>} />
            <Route path="/messages" element={<Guarded><Messages /></Guarded>} />
            <Route path="/notifications" element={<Guarded><Notifications /></Guarded>} />

            {/* GATE PASS VERIFICATION - moved inside the authenticated shell
                (it used to be a fully public route). Reachable two ways
                under the SAME guard: "/verify-gatepass" from a sidebar link
                for typing/looking a card up manually, and
                "/verify-gatepass/:token" for the deep link a Fee Update
                Card's QR code opens. Every role except STUDENT can use
                either - see GATEPASS_VERIFIER_ROLES above. */}
            <Route
              path="/verify-gatepass"
              element={<Guarded roles={GATEPASS_VERIFIER_ROLES}><VerifyGatepass /></Guarded>}
            />
            <Route
              path="/verify-gatepass/:token"
              element={<Guarded roles={GATEPASS_VERIFIER_ROLES}><VerifyGatepass /></Guarded>}
            />

            <Route path="/finance/fee-cards" element={<RoleSection role="FINANCE"><FeeUpdateCards /></RoleSection>} />
            <Route path="/secretary/fee-cards" element={<RoleSection role="SECRETARY"><FeeUpdateCards /></RoleSection>} />
            <Route path="/admin/fee-cards" element={<RoleSection role="ADMIN"><FeeUpdateCards /></RoleSection>} />

            {/* STUDENT ID CARDS — shared /student-id/* pages. Roles mirror
                idcards/views.py (ID_ISSUE / ID_SCAN / ID_LOOKUP above):
                  /student-id/cards  - create, print, replace ID cards
                  /student-id/scan   - morning attendance camera scan (teachers at the gate)
                  /student-id/lookup - scan a card to see the student's fees, class,
                                       cafeteria wallet/plan and attendance
                The scan page needs HTTPS (or localhost) for the camera. */}
            <Route path="/student-id/cards" element={<Guarded roles={ID_ISSUE}><StudentIdCards /></Guarded>} />
            <Route path="/student-id/scan" element={<Guarded roles={ID_SCAN}><StudentIdScan /></Guarded>} />
            <Route path="/student-id/lookup" element={<Guarded roles={ID_LOOKUP}><StudentIdLookup /></Guarded>} />

            {/* HELP & SUPPORT - see HELP_ROLES above.
                Add "PARENT" there if you want parents included too. */}
            <Route
              path="/user-manual"
              element={<Guarded roles={HELP_ROLES}><UserManual /></Guarded>}
            />
            <Route
              path="/contact-developer"
              element={<Guarded roles={HELP_ROLES}><ContactDeveloper /></Guarded>}
            />

            {/* CAFETERIA — meal scan desk. Admin and Secretary can open it
                too (e.g. to cover a shift); see CAFETERIA_ROLES above. */}
            <Route path="/cafeteria" element={<Guarded roles={CAFETERIA_ROLES}><CafeteriaScanDesk /></Guarded>} />
            <Route path="/meals" element={<Guarded roles={[...MEAL_OPERATE, ...CAFETERIA_ROLES]}><MealDashboard /></Guarded>} />
            <Route path="/meals/plans" element={<Guarded roles={[...MEAL_ADMIN, ...CAFETERIA_ROLES]}><MealPlans /></Guarded>} />
            <Route path="/meals/cards" element={<Guarded roles={[...MEAL_OPERATE, ...CAFETERIA_ROLES]}><MealCards /></Guarded>} />
            <Route path="/meals/collections" element={<Guarded roles={[...MEAL_OPERATE, ...CAFETERIA_ROLES]}><MealCollections /></Guarded>} />
            <Route path="/meals/billing" element={<Guarded roles={[...MEAL_BILLING, ...CAFETERIA_ROLES]}><MealBilling /></Guarded>} />
            <Route path="/meals/attendants" element={<Guarded roles={[...MEAL_ADMIN, ...CAFETERIA_ROLES]}><MealAttendants /></Guarded>} />

            {/* PROCUREMENT — one shared set of pages under /procurement/*.
                Each page is guarded by the roles that make sense for it; the
                API enforces the same rules (and the finer separation-of-duties
                checks: you cannot approve your own requisition, the PO creator
                cannot receive or pay, etc.). */}
            <Route path="/procurement" element={<Guarded roles={PROC_VIEW}><ProcDashboard /></Guarded>} />
            <Route path="/procurement/requisitions" element={<Guarded roles={PROC_REQUEST}><ProcRequisitions /></Guarded>} />
            <Route path="/procurement/approvals" element={<Guarded roles={PROC_VIEW}><ProcApprovals /></Guarded>} />
            <Route path="/procurement/suppliers" element={<Guarded roles={PROC_VIEW}><ProcSuppliers /></Guarded>} />
            <Route path="/procurement/rfqs" element={<Guarded roles={PROC_VIEW}><ProcRfqs /></Guarded>} />
            <Route path="/procurement/purchase-orders" element={<Guarded roles={PROC_VIEW}><ProcPurchaseOrders /></Guarded>} />
            <Route path="/procurement/goods-received" element={<Guarded roles={PROC_STORE}><ProcGoodsReceived /></Guarded>} />
            <Route path="/procurement/invoices" element={<Guarded roles={PROC_VIEW}><ProcInvoices /></Guarded>} />
            <Route path="/procurement/contracts" element={<Guarded roles={PROC_VIEW}><ProcContracts /></Guarded>} />
            <Route path="/procurement/returns" element={<Guarded roles={PROC_STORE}><ProcReturns /></Guarded>} />
            <Route path="/procurement/budgets" element={<Guarded roles={PROC_VIEW}><ProcBudgets /></Guarded>} />
            <Route path="/procurement/reports" element={<Guarded roles={PROC_VIEW}><ProcReports /></Guarded>} />
            <Route path="/procurement/audit" element={<Guarded roles={PROC_AUDIT}><ProcAudit /></Guarded>} />

            {/* BURSARIES, SCHOLARSHIPS & FEE DISCOUNTS — shared /bursaries/*
                pages. Roles mirror bursaries/permissions.py. Anyone in
                BURSARY_VIEW can see and request awards; the API limits
                approve / reject / suspend / reverse to ADMIN and PRINCIPAL,
                and funders, schemes and funds received to ADMIN and FINANCE
                (BURSARY_SETUP). The requester can never approve their own
                award. */}
            <Route path="/bursaries" element={<Guarded roles={BURSARY_VIEW}><BursaryDashboard /></Guarded>} />
            <Route path="/bursaries/awards" element={<Guarded roles={BURSARY_VIEW}><BursaryAwards /></Guarded>} />
            <Route path="/bursaries/setup" element={<Guarded roles={BURSARY_SETUP}><BursarySetup /></Guarded>} />
            <Route path="/bursaries/remittances" element={<Guarded roles={BURSARY_SETUP}><BursaryRemittances /></Guarded>} />

            {/* ADMIN */}
            <Route path="/admin" element={<RoleSection role="ADMIN"><AdminDashboard /></RoleSection>} />
            <Route path="/admin/license" element={<RoleSection role="ADMIN"><AdminLicense /></RoleSection>} />
            <Route path="/admin/students" element={<RoleSection role="ADMIN"><AdminStudents /></RoleSection>} />
            <Route path="/admin/classrooms" element={<RoleSection role="ADMIN"><AdminClassrooms /></RoleSection>} />
            <Route path="/admin/mark-entry" element={<RoleSection role="ADMIN"><AdminMarkEntry /></RoleSection>} />
            <Route path="/admin/subjects" element={<RoleSection role="ADMIN"><AdminSubjects /></RoleSection>} />
            <Route path="/admin/teachers" element={<RoleSection role="ADMIN"><AdminTeacherAllocation /></RoleSection>} />
            <Route path="/admin/timetable" element={<RoleSection role="ADMIN"><AdminTimetableManagement /></RoleSection>} />
            <Route path="/admin/exams" element={<RoleSection role="ADMIN"><AdminExams /></RoleSection>} />
            <Route path="/admin/grading" element={<RoleSection role="ADMIN"><GradingScales /></RoleSection>} />
            <Route path="/admin/rankings" element={<RoleSection role="ADMIN"><AdminRankings /></RoleSection>} />
            <Route path="/admin/promotions" element={<RoleSection role="ADMIN"><AdminPromotions /></RoleSection>} />
            <Route path="/admin/promotion-settings" element={<RoleSection role="ADMIN"><PromotionSettings /></RoleSection>} />
            <Route path="/admin/fees" element={<RoleSection role="ADMIN"><AdminFees /></RoleSection>} />
            {/* Admin can see/record Payments too — reuses the Finance Payments page.
                The payments API must allow the ADMIN role (IsAdminOrFinance). */}
            <Route path="/admin/payments" element={<RoleSection role="ADMIN"><FinancePayments /></RoleSection>} />
            <Route path="/admin/expenses" element={<RoleSection role="ADMIN"><AdminExpenses /></RoleSection>} />
            <Route path="/admin/verify-receipt" element={<RoleSection role="ADMIN"><FinanceVerifyReceipt /></RoleSection>} />
            <Route path="/admin/users" element={<RoleSection role="ADMIN"><AdminUsers /></RoleSection>} />
            <Route path="/admin/security" element={<RoleSection role="ADMIN"><AdminSecurityMonitor /></RoleSection>} />

            <Route path="/admin/reports" element={<RoleSection role="ADMIN"><AdminReports /></RoleSection>} />
            <Route path="/admin/calendar" element={<RoleSection role="ADMIN"><AdminCalendar /></RoleSection>} />
            <Route path="/admin/settings" element={<RoleSection role="ADMIN"><AdminSettings /></RoleSection>} />
            <Route path="/admin/parents" element={<RoleSection role="ADMIN"><AdminParents /></RoleSection>} />
            <Route path="/admin/clearance" element={<RoleSection role="ADMIN"><AdminClearance /></RoleSection>} />
            <Route path="/admin/letters" element={<RoleSection role="ADMIN"><AdminLetters /></RoleSection>} />

            {/* ADMIN finance reports */}
            <Route path="/admin/finance-reports/collections" element={<RoleSection role="ADMIN"><AdminFinanceCollections /></RoleSection>} />
            <Route path="/admin/finance-reports/class-analysis" element={<RoleSection role="ADMIN"><AdminFinanceClassAnalysis /></RoleSection>} />
            <Route path="/admin/finance-reports/detailed" element={<RoleSection role="ADMIN"><AdminFinanceDetailedReport /></RoleSection>} />

            {/* PRINCIPAL — own dashboard, plus the same Admin page
                components reused for oversight (read-leaning: classes,
                exams, rankings, promotion previews, calendar, clearance,
                students, teacher allocation, reports, announcements).
                Requires the backend permission_classes swaps in
                08/09_*_patch.py so these endpoints actually let a
                PRINCIPAL account through. */}
            <Route path="/principal" element={<RoleSection role="PRINCIPAL"><PrincipalDashboard /></RoleSection>} />
            <Route path="/principal/students" element={<RoleSection role="PRINCIPAL"><AdminStudents /></RoleSection>} />
            <Route path="/principal/classrooms" element={<RoleSection role="PRINCIPAL"><AdminClassrooms /></RoleSection>} />
            <Route path="/principal/teachers" element={<RoleSection role="PRINCIPAL"><AdminTeacherAllocation /></RoleSection>} />
            <Route path="/principal/exams" element={<RoleSection role="PRINCIPAL"><AdminExams /></RoleSection>} />
            <Route path="/principal/rankings" element={<RoleSection role="PRINCIPAL"><AdminRankings /></RoleSection>} />
            <Route path="/principal/promotions" element={<RoleSection role="PRINCIPAL"><AdminPromotions /></RoleSection>} />
            <Route path="/principal/reports" element={<RoleSection role="PRINCIPAL"><AdminReports /></RoleSection>} />
            <Route path="/principal/calendar" element={<RoleSection role="PRINCIPAL"><AdminCalendar /></RoleSection>} />
            <Route path="/principal/clearance" element={<RoleSection role="PRINCIPAL"><AdminClearance /></RoleSection>} />
            <Route path="/principal/communications" element={<RoleSection role="PRINCIPAL"><Communications /></RoleSection>} />

            {/* SECRETARY — own dashboard, plus the front-office slice of
                the Admin tools: admitting/managing student records,
                guardians, the clearance desk, classes/calendar for
                reference, announcements and letters — plus Timetable
                Management, Teacher Allocation, Mark Entry, Exams,
                Rankings, Promotions (all reusing the matching Admin page
                components), and a full Finance slice: Expenses,
                Invoices, Payments, Verify Receipt and the Detailed
                finance report (reusing the Finance/Admin page
                components).
                NOTE: several of these endpoints (Timetable, Teacher
                Allocation, Mark Entry, Exams, Rankings, Promotions,
                Expenses, Invoices, Payments, Verify Receipt, Detailed
                Report) are currently permissioned IsAdmin /
                IsAdminOrFinance on the backend
                (see utils.py / views.py). The pages will render for a
                SECRETARY account, but API calls will 403 until the
                matching permission classes are widened to include
                SECRETARY, the same way the PRINCIPAL patch above did. */}
            <Route path="/secretary" element={<RoleSection role="SECRETARY"><SecretaryDashboard /></RoleSection>} />
            <Route path="/secretary/students" element={<RoleSection role="SECRETARY"><AdminStudents /></RoleSection>} />
            <Route path="/secretary/parents" element={<RoleSection role="SECRETARY"><AdminParents /></RoleSection>} />
            <Route path="/secretary/classrooms" element={<RoleSection role="SECRETARY"><AdminClassrooms /></RoleSection>} />
            <Route path="/secretary/clearance" element={<RoleSection role="SECRETARY"><AdminClearance /></RoleSection>} />
            <Route path="/secretary/calendar" element={<RoleSection role="SECRETARY"><AdminCalendar /></RoleSection>} />
            <Route path="/secretary/communications" element={<RoleSection role="SECRETARY"><Communications /></RoleSection>} />
            <Route path="/secretary/letters" element={<RoleSection role="SECRETARY"><AdminLetters /></RoleSection>} />
            <Route path="/secretary/timetable" element={<RoleSection role="SECRETARY"><AdminTimetableManagement /></RoleSection>} />
            <Route path="/secretary/teachers" element={<RoleSection role="SECRETARY"><AdminTeacherAllocation /></RoleSection>} />
            <Route path="/secretary/mark-entry" element={<RoleSection role="SECRETARY"><AdminMarkEntry /></RoleSection>} />
            <Route path="/secretary/exams" element={<RoleSection role="SECRETARY"><AdminExams /></RoleSection>} />
            <Route path="/secretary/rankings" element={<RoleSection role="SECRETARY"><AdminRankings /></RoleSection>} />
            <Route path="/secretary/promotions" element={<RoleSection role="SECRETARY"><AdminPromotions /></RoleSection>} />
            <Route path="/secretary/expenses" element={<RoleSection role="SECRETARY"><AdminExpenses /></RoleSection>} />
            <Route path="/secretary/invoices" element={<RoleSection role="SECRETARY"><FinanceInvoices /></RoleSection>} />
            <Route path="/secretary/payments" element={<RoleSection role="SECRETARY"><FinancePayments /></RoleSection>} />
            <Route path="/secretary/verify-receipt" element={<RoleSection role="SECRETARY"><FinanceVerifyReceipt /></RoleSection>} />
            <Route path="/secretary/finance-reports/detailed" element={<RoleSection role="SECRETARY"><AdminFinanceDetailedReport /></RoleSection>} />

            {/* BOARDING / HOSTEL WARDEN — shared /warden/* pages. Roles mirror
                boarding/permissions.py (BOARD_VIEW / BOARD_ADMIN /
                BOARD_SETTINGS above). */}
            <Route path="/warden" element={<Guarded roles={BOARD_VIEW}><BoardingDashboard /></Guarded>} />
            <Route path="/warden/hostels" element={<Guarded roles={BOARD_VIEW}><Hostels /></Guarded>} />
            <Route path="/warden/boarders" element={<Guarded roles={BOARD_VIEW}><Boarders /></Guarded>} />
            <Route path="/warden/allocations" element={<Guarded roles={BOARD_VIEW}><Allocations /></Guarded>} />
            <Route path="/warden/exeats" element={<Guarded roles={BOARD_VIEW}><Exeats /></Guarded>} />
            <Route path="/warden/roll-call" element={<Guarded roles={BOARD_VIEW}><RollCall /></Guarded>} />
            <Route path="/warden/history" element={<Guarded roles={BOARD_VIEW}><BoardingHistory /></Guarded>} />
            <Route path="/warden/rollover" element={<Guarded roles={BOARD_ADMIN}><BoardingRollover /></Guarded>} />
            <Route path="/warden/settings" element={<Guarded roles={BOARD_SETTINGS}><BoardingSettings /></Guarded>} />
            <Route path="/student/boarding" element={<RoleSection role="STUDENT"><MyBoarding /></RoleSection>} />
            <Route path="/parent/boarding" element={<RoleSection role="PARENT"><MyBoarding /></RoleSection>} />

            {/* EXAMINATION OFFICER — own dashboard, plus the same Admin page
                components reused: exams, mark entry, rankings, promotions,
                reports, academic calendar (academic years & terms), classes,
                subjects, teacher allocation, timetable management, students,
                parents, clearance and letters. Grading Scales and Automatic
                Promotion are the Exam Officer's own pages (also mounted for
                ADMIN above).
                NOTE: the matching permission classes in utils.py must
                include EXAM_OFFICER, or these pages will render but their
                API calls will 403. */}
            <Route path="/exam-officer" element={<RoleSection role="EXAM_OFFICER"><ExamOfficerDashboard /></RoleSection>} />
            <Route path="/exam-officer/exams" element={<RoleSection role="EXAM_OFFICER"><AdminExams /></RoleSection>} />
            <Route path="/exam-officer/grading" element={<RoleSection role="EXAM_OFFICER"><GradingScales /></RoleSection>} />
            <Route path="/exam-officer/mark-entry" element={<RoleSection role="EXAM_OFFICER"><AdminMarkEntry /></RoleSection>} />
            <Route path="/exam-officer/rankings" element={<RoleSection role="EXAM_OFFICER"><AdminRankings /></RoleSection>} />
            <Route path="/exam-officer/promotions" element={<RoleSection role="EXAM_OFFICER"><AdminPromotions /></RoleSection>} />
            <Route path="/exam-officer/promotion-settings" element={<RoleSection role="EXAM_OFFICER"><PromotionSettings /></RoleSection>} />
            <Route path="/exam-officer/reports" element={<RoleSection role="EXAM_OFFICER"><AdminReports /></RoleSection>} />
            <Route path="/exam-officer/calendar" element={<RoleSection role="EXAM_OFFICER"><AdminCalendar /></RoleSection>} />
            <Route path="/exam-officer/classrooms" element={<RoleSection role="EXAM_OFFICER"><AdminClassrooms /></RoleSection>} />
            <Route path="/exam-officer/subjects" element={<RoleSection role="EXAM_OFFICER"><AdminSubjects /></RoleSection>} />
            <Route path="/exam-officer/teachers" element={<RoleSection role="EXAM_OFFICER"><AdminTeacherAllocation /></RoleSection>} />
            <Route path="/exam-officer/timetable" element={<RoleSection role="EXAM_OFFICER"><AdminTimetableManagement /></RoleSection>} />
            <Route path="/exam-officer/students" element={<RoleSection role="EXAM_OFFICER"><AdminStudents /></RoleSection>} />
            <Route path="/exam-officer/parents" element={<RoleSection role="EXAM_OFFICER"><AdminParents /></RoleSection>} />
            <Route path="/exam-officer/clearance" element={<RoleSection role="EXAM_OFFICER"><AdminClearance /></RoleSection>} />
            <Route path="/exam-officer/letters" element={<RoleSection role="EXAM_OFFICER"><AdminLetters /></RoleSection>} />
            <Route path="/exam-officer/communications" element={<RoleSection role="EXAM_OFFICER"><Communications /></RoleSection>} />

            {/* TEACHER */}
            <Route path="/teacher" element={<RoleSection role="TEACHER"><TeacherDashboard /></RoleSection>} />
            <Route path="/teacher/classes" element={<RoleSection role="TEACHER"><TeacherClasses /></RoleSection>} />
            <Route path="/teacher/timetable" element={<RoleSection role="TEACHER"><TeacherTimetable /></RoleSection>} />
            <Route path="/teacher/marks" element={<RoleSection role="TEACHER"><TeacherMarkEntry /></RoleSection>} />
            <Route path="/teacher/class-marks" element={<RoleSection role="TEACHER"><TeacherClassMarkEntry /></RoleSection>} />
            <Route path="/teacher/rankings" element={<RoleSection role="TEACHER"><TeacherRankings /></RoleSection>} />
            <Route path="/teacher/lesson-planning" element={<RoleSection role="TEACHER"><LessonPlanningHome /></RoleSection>} />
            <Route path="/teacher/lesson-planning/schemes" element={<RoleSection role="TEACHER"><SchemesOfWork /></RoleSection>} />
            <Route path="/teacher/lesson-planning/schemes/:id" element={<RoleSection role="TEACHER"><SchemeEditor /></RoleSection>} />
            <Route path="/teacher/lesson-planning/plans" element={<RoleSection role="TEACHER"><LessonPlans /></RoleSection>} />
            <Route path="/teacher/lesson-planning/plans/:id" element={<RoleSection role="TEACHER"><LessonPlanEditor /></RoleSection>} />
            <Route path="/teacher/attendance" element={<RoleSection role="TEACHER"><AttendanceHome /></RoleSection>} />
            <Route path="/teacher/attendance/mark" element={<RoleSection role="TEACHER"><MarkAttendance /></RoleSection>} />
            <Route path="/teacher/attendance/records" element={<RoleSection role="TEACHER"><AttendanceRecords /></RoleSection>} />
            <Route path="/teacher/attendance/reports" element={<RoleSection role="TEACHER"><AttendanceReports /></RoleSection>} />
            <Route path="/teacher/assignments" element={<RoleSection role="TEACHER"><TeacherAssignments /></RoleSection>} />
            <Route path="/teacher/assignments/:id/tracking" element={<RoleSection role="TEACHER"><TeacherAssignmentTracking /></RoleSection>} />

            {/* STUDENT */}
            <Route path="/student" element={<RoleSection role="STUDENT"><StudentDashboard /></RoleSection>} />
            <Route path="/student/results" element={<RoleSection role="STUDENT"><StudentResults /></RoleSection>} />
            <Route path="/student/subjects" element={<RoleSection role="STUDENT"><StudentSubjects /></RoleSection>} />
            <Route path="/student/timetable" element={<RoleSection role="STUDENT"><StudentTimetable /></RoleSection>} />
            <Route path="/student/fees" element={<RoleSection role="STUDENT"><StudentFees /></RoleSection>} />
            <Route path="/student/fee-structure" element={<RoleSection role="STUDENT"><StudentFeeStructure /></RoleSection>} />
            <Route path="/student/clearance" element={<RoleSection role="STUDENT"><StudentClearance /></RoleSection>} />
            <Route path="/student/library" element={<RoleSection role="STUDENT"><MyLibrary /></RoleSection>} />
            <Route path="/student/meals" element={<RoleSection role="STUDENT"><MyMeals /></RoleSection>} />
            <Route path="/student/assignments" element={<RoleSection role="STUDENT"><StudentAssignments /></RoleSection>} />
            <Route path="/student/assignments/:id" element={<RoleSection role="STUDENT"><StudentAssignmentView /></RoleSection>} />

            {/* PARENT */}
            <Route path="/parent" element={<RoleSection role="PARENT"><ParentDashboard /></RoleSection>} />
            <Route path="/parent/children" element={<RoleSection role="PARENT"><ParentChildren /></RoleSection>} />
            <Route path="/parent/results" element={<RoleSection role="PARENT"><ParentResults /></RoleSection>} />
            <Route path="/parent/fees" element={<RoleSection role="PARENT"><ParentFees /></RoleSection>} />
            <Route path="/parent/library" element={<RoleSection role="PARENT"><MyLibrary /></RoleSection>} />
            <Route path="/parent/meals" element={<RoleSection role="PARENT"><MyMeals /></RoleSection>} />

            {/* FINANCE */}
            <Route path="/finance" element={<RoleSection role="FINANCE"><FinanceDashboard /></RoleSection>} />
            <Route path="/finance/structures" element={<RoleSection role="FINANCE"><FinanceStructures /></RoleSection>} />
            <Route path="/finance/invoices" element={<RoleSection role="FINANCE"><FinanceInvoices /></RoleSection>} />
            <Route path="/finance/payments" element={<RoleSection role="FINANCE"><FinancePayments /></RoleSection>} />
            <Route path="/finance/expenses" element={<RoleSection role="FINANCE"><FinanceExpenses /></RoleSection>} />
            <Route path="/finance/verify-receipt" element={<RoleSection role="FINANCE"><FinanceVerifyReceipt /></RoleSection>} />
            <Route path="/verify-receipt/:receiptNo" element={<RoleSection role="FINANCE"><FinanceVerifyReceipt /></RoleSection>} />

            {/* FINANCE reports */}
            <Route path="/finance/reports/collections" element={<RoleSection role="FINANCE"><FinanceCollections /></RoleSection>} />
            <Route path="/finance/reports/class-analysis" element={<RoleSection role="FINANCE"><FinanceClassAnalysis /></RoleSection>} />
            <Route path="/finance/reports/detailed" element={<RoleSection role="FINANCE"><FinanceDetailedReport /></RoleSection>} />

            {/* LIBRARIAN — runs the school library: the issue/return desk,
                catalogue, loans & fines, reports and lending rules.
                Backend (`library` app) is permissioned to the LIBRARIAN
                and ADMIN roles; browsing the catalogue is open to every
                signed-in user. */}
            <Route path="/librarian" element={<RoleSection role="LIBRARIAN"><LibraryDashboard /></RoleSection>} />
            <Route path="/librarian/desk" element={<RoleSection role="LIBRARIAN"><LibraryDesk /></RoleSection>} />
            <Route path="/librarian/catalogue" element={<RoleSection role="LIBRARIAN"><LibraryCatalogue /></RoleSection>} />
            <Route path="/librarian/loans" element={<RoleSection role="LIBRARIAN"><LibraryLoans /></RoleSection>} />
            <Route path="/librarian/reports" element={<RoleSection role="LIBRARIAN"><LibraryReports /></RoleSection>} />
            <Route path="/librarian/settings" element={<RoleSection role="LIBRARIAN"><LibrarySettings /></RoleSection>} />

            {/* HR — HR officer: employees, recruitment, staff attendance (and the
                rotating gate QR screen), leave, payroll & payslips, reports.
                Backend is permissioned to the HR and ADMIN roles only. */}
            <Route path="/hr" element={<RoleSection role="HR"><HRDashboard /></RoleSection>} />
            <Route path="/hr/employees" element={<RoleSection role="HR"><HREmployees /></RoleSection>} />
            <Route path="/hr/recruitment" element={<RoleSection role="HR"><HRRecruitment /></RoleSection>} />
            <Route path="/hr/attendance" element={<RoleSection role="HR"><HRAttendance /></RoleSection>} />
            <Route path="/hr/gate" element={<RoleSection role="HR"><HRGateScreen /></RoleSection>} />
            <Route path="/hr/leave" element={<RoleSection role="HR"><HRLeave /></RoleSection>} />
            <Route path="/hr/payroll" element={<RoleSection role="HR"><HRPayroll /></RoleSection>} />
            <Route path="/hr/reports" element={<RoleSection role="HR"><HRReports /></RoleSection>} />

            {/* STAFF SELF-SERVICE — "/my-attendance/scan/:token" is the deep link
                the gate QR opens on the employee's own phone; "/my-payslips"
                lists only the signed-in employee's released payslips.
                Open to every role except STUDENT and PARENT - see
                STAFF_ROLES above. */}
            <Route path="/my-attendance/scan" element={<Guarded roles={STAFF_ROLES}><StaffScan /></Guarded>} />
            <Route path="/my-attendance/scan/:token" element={<Guarded roles={STAFF_ROLES}><StaffScan /></Guarded>} />
            <Route path="/my-payslips" element={<Guarded roles={STAFF_ROLES}><MyPayslips /></Guarded>} />

            {/* COMMUNICATIONS - Admin, Finance, Principal, Secretary and
                Examination Officer can all broadcast; each keeps its own
                path so the sidebar entry sits naturally in its own role group.
                The page itself is NOT a gated module: in-app notices work on
                every plan, and only the SMS / email action is plan-gated by
                "bulk_messaging" on the API. */}
            <Route path="/admin/communications" element={<RoleSection role="ADMIN"><Communications /></RoleSection>} />
            <Route path="/finance/communications" element={<RoleSection role="FINANCE"><Communications /></RoleSection>} />

            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* Any signed-in user hitting an unknown path within the app
                shell (e.g. a stale link under their role) sees 404 with
                the sidebar/navbar still in place, instead of a blank page
                or an unexplained redirect. */}
            <Route path="*" element={<Guarded><NotFound /></Guarded>} />
          </Route>

          {/* Anything outside the app shell entirely (typo'd URL, dead
              bookmark, no session) gets the same 404 page, full-screen. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}