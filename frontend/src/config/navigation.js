// config/navigation.js
//
// ORDERING RULE (used for every role): the things a person does every day
// come first, then occasional/setup work, then reports, then housekeeping.
//   1. Unlabelled top group  - Dashboard, Messages, Notifications
//   2. Core work groups      - most-used first (people -> academics -> finance)
//   3. Boarding, Communication, Procurement, Cafeteria
//   4. Administration / Reports
//   5. Account (always last)

// -----------------------------------------------------------------
// PROCUREMENT sidebar groups. Defined once and reused by every role
// that touches the requisition-to-payment workflow, so a label or icon
// change happens in a single place. Pages live under /procurement/* in
// App.jsx and are backed by the separate `procurement` Django app.
// Items follow the workflow: request -> approve -> source -> order ->
// receive -> pay -> review.
// -----------------------------------------------------------------

// Procurement officer / Admin: the whole workflow.
const PROC_FULL = [
  { to: "/procurement", icon: "bi-speedometer2", label: "Procurement Dashboard" },
  { to: "/procurement/requisitions", icon: "bi-clipboard-plus", label: "Requisitions" },
  { to: "/procurement/approvals", icon: "bi-check2-square", label: "Approvals" },
  { to: "/procurement/suppliers", icon: "bi-truck", label: "Suppliers" },
  { to: "/procurement/rfqs", icon: "bi-envelope-paper", label: "RFQs & Quotations" },
  { to: "/procurement/purchase-orders", icon: "bi-bag-check", label: "Purchase Orders" },
  { to: "/procurement/goods-received", icon: "bi-box-seam", label: "Goods Received" },
  { to: "/procurement/invoices", icon: "bi-receipt", label: "Supplier Invoices" },
  { to: "/procurement/contracts", icon: "bi-file-earmark-text", label: "Contracts" },
  { to: "/procurement/returns", icon: "bi-arrow-return-left", label: "Returns" },
  { to: "/procurement/budgets", icon: "bi-piggy-bank", label: "Budgets & Approval Chain" },
  { to: "/procurement/reports", icon: "bi-graph-up", label: "Procurement Reports" },
  { to: "/procurement/audit", icon: "bi-journal-check", label: "Audit Trail" },
];

// Principal / Finance / Secretary: approve, oversee, pay, report.
const PROC_OVERSIGHT = [
  { to: "/procurement", icon: "bi-speedometer2", label: "Procurement Dashboard" },
  { to: "/procurement/approvals", icon: "bi-check2-square", label: "Approvals" },
  { to: "/procurement/requisitions", icon: "bi-clipboard-plus", label: "Requisitions" },
  { to: "/procurement/purchase-orders", icon: "bi-bag-check", label: "Purchase Orders" },
  { to: "/procurement/invoices", icon: "bi-receipt", label: "Supplier Invoices" },
  { to: "/procurement/reports", icon: "bi-graph-up", label: "Procurement Reports" },
];

// Anyone who can only ask for something (teachers, HR, librarian, cafeteria...).
const PROC_REQUESTER = [
  { to: "/procurement/requisitions", icon: "bi-clipboard-plus", label: "My Requisitions" },
];

// Store keeper (STAFF role): raise requisitions, receive goods, send back damaged items.
const PROC_STORE = [
  { to: "/procurement/requisitions", icon: "bi-clipboard-plus", label: "Requisitions" },
  { to: "/procurement/goods-received", icon: "bi-box-seam", label: "Goods Received" },
  { to: "/procurement/returns", icon: "bi-arrow-return-left", label: "Returns" },
];

// -----------------------------------------------------------------
// CAFETERIA / MEALS sidebar group. Defined once and reused by the
// ADMIN and CAFETERIA roles so a label or icon change happens in a
// single place. Pages are /cafeteria and /meals/* in App.jsx and are
// backed by the separate `meal_management` Django app. These mirror
// the role lists in App.jsx:
//   CAFETERIA_ROLES = ADMIN, SECRETARY, CAFETERIA   (scan desk)
//   MEAL_OPERATE    = ADMIN, SECRETARY, CAFETERIA   (dashboard, cards, collections)
//   MEAL_ADMIN      = ADMIN, SECRETARY              (plans, attendants)
//   MEAL_BILLING    = ADMIN, SECRETARY, FINANCE     (cafeteria billing)
// ADMIN is in every list above, so the whole group is open to Admin.
// Items follow the daily routine: scan -> overview -> collections ->
// cards -> setup (plans, attendants) -> billing.
// -----------------------------------------------------------------
const CAFETERIA_FULL = [
  { to: "/cafeteria", icon: "bi-qr-code-scan", label: "Meal Scan Desk" },
  { to: "/meals", icon: "bi-speedometer2", label: "Meal Dashboard" },
  { to: "/meals/collections", icon: "bi-collection", label: "Collections" },
  { to: "/meals/cards", icon: "bi-credit-card", label: "Meal Cards" },
  { to: "/meals/plans", icon: "bi-calendar3", label: "Meal Plans" },
  { to: "/meals/attendants", icon: "bi-people", label: "Attendants" },
  { to: "/meals/billing", icon: "bi-receipt", label: "Cafeteria Billing" },
];

// -----------------------------------------------------------------
// BOARDING sidebar groups. Pages live under /warden/* in App.jsx.
// These mirror the role lists in App.jsx / boarding/permissions.py:
//   BOARD_VIEW     = ADMIN, PRINCIPAL, SECRETARY, HOSTEL_WARDEN
//   BOARD_ADMIN    = ADMIN                (rollover)
//   BOARD_SETTINGS = ADMIN, FINANCE       (settings)
// Items follow the daily routine: overview -> who is where -> movement
// -> roll call -> history -> year-end/setup.
// -----------------------------------------------------------------

// Everything a warden / oversight role can open (BOARD_VIEW pages).
const BOARD_VIEW_ITEMS = [
  { to: "/warden", icon: "bi-speedometer2", label: "Boarding Dashboard" },
  { to: "/warden/roll-call", icon: "bi-clipboard-check", label: "Roll Call" },
  { to: "/warden/exeats", icon: "bi-box-arrow-right", label: "Exeats" },
  { to: "/warden/boarders", icon: "bi-person-badge", label: "Boarders" },
  { to: "/warden/allocations", icon: "bi-diagram-3", label: "Bed Allocations" },
  { to: "/warden/hostels", icon: "bi-building", label: "Hostels & Rooms" },
  { to: "/warden/history", icon: "bi-clock-history", label: "Boarding History" },
];

// Admin: the whole module (adds Rollover and Settings).
const BOARD_FULL = [
  ...BOARD_VIEW_ITEMS,
  { to: "/warden/rollover", icon: "bi-arrow-repeat", label: "Term Rollover" },
  { to: "/warden/settings", icon: "bi-sliders", label: "Boarding Settings" },
];

// Finance: settings only (BOARD_SETTINGS includes FINANCE, BOARD_VIEW does not).
const BOARD_SETTINGS_ONLY = [
  { to: "/warden/settings", icon: "bi-sliders", label: "Boarding Settings" },
];

// -----------------------------------------------------------------
// BURSARIES, SCHOLARSHIPS & FEE DISCOUNTS sidebar groups. Pages live
// under /bursaries/* in App.jsx and are backed by the separate
// `bursaries` Django app. These mirror the role lists in App.jsx /
// bursaries/permissions.py:
//   BURSARY_VIEW  = ADMIN, PRINCIPAL, SECRETARY, FINANCE
//                   (overview, awards: request / approve)
//   BURSARY_SETUP = ADMIN, FINANCE
//                   (funders & schemes, funds received)
// Items follow the work: overview -> awards -> money in -> setup.
// -----------------------------------------------------------------

// Principal / Secretary: see and request awards (Principal also approves).
const BURSARY_VIEW_ITEMS = [
  { to: "/bursaries", icon: "bi-speedometer2", label: "Aid Overview" },
  { to: "/bursaries/awards", icon: "bi-award", label: "Awards" },
];

// Admin / Finance: the whole module.
const BURSARY_FULL = [
  ...BURSARY_VIEW_ITEMS,
  { to: "/bursaries/remittances", icon: "bi-bank", label: "Funds Received" },
  { to: "/bursaries/setup", icon: "bi-sliders", label: "Funders & Schemes" },
];

// -----------------------------------------------------------------
// STUDENT ID CARDS, MORNING GATE SCAN & ID LOOKUP. Pages live under
// /student-id/* in App.jsx and are backed by the separate `idcards`
// Django app. These mirror the role lists in App.jsx / idcards/views.py:
//   ID_ISSUE  = ADMIN, SECRETARY, PRINCIPAL                      (create / replace / print cards)
//   ID_SCAN   = TEACHER, ADMIN, SECRETARY, PRINCIPAL, STAFF      (morning attendance scan)
//   ID_LOOKUP = ADMIN, PRINCIPAL, SECRETARY, FINANCE             (scan -> all student data)
// Items follow the daily routine: scan -> look up -> issue cards.
// -----------------------------------------------------------------
const ID_SCAN_ITEM = { to: "/student-id/scan", icon: "bi-qr-code-scan", label: "Morning Gate Scan" };
const ID_LOOKUP_ITEM = { to: "/student-id/lookup", icon: "bi-person-vcard", label: "Student ID Lookup" };
const ID_ISSUE_ITEM = { to: "/student-id/cards", icon: "bi-postcard", label: "Issue ID Cards" };

// Admin / Principal / Secretary: the whole module.
const ID_FULL = [ID_SCAN_ITEM, ID_LOOKUP_ITEM, ID_ISSUE_ITEM];

// -----------------------------------------------------------------
// STAFF SELF-SERVICE. Every role except STUDENT and PARENT is a school
// employee: they can open the gate-QR sign in/out page
// (/my-attendance/scan/:token - reached by scanning the rotating QR on
// the HR gate screen, so it needs no sidebar link) and read their own
// released payslips. Keep in sync with STAFF_ROLES in App.jsx.
// -----------------------------------------------------------------
const MY_ATTENDANCE = { to: "/my-attendance/scan", icon: "bi-qr-code-scan", label: "Sign In / Out" };
const MY_PAYSLIPS = { to: "/my-payslips", icon: "bi-cash-stack", label: "My Payslips" };

export const NAV_BY_ROLE = {
  // -----------------------------------------------------------------
  // ADMIN — priority order:
  // Dashboard/Messages -> People -> Student ID & Attendance -> Academics ->
  // Finance -> Bursaries -> Boarding -> Communication -> Procurement ->
  // Cafeteria -> Administration -> Account
  // -----------------------------------------------------------------
  ADMIN: [
    {
      items: [
        { to: "/admin", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "People",
      items: [
        { to: "/admin/students", icon: "bi-people", label: "Students" },
        { to: "/admin/parents", icon: "bi-person-hearts", label: "Parents & Guardians" },
        { to: "/admin/teachers", icon: "bi-person-workspace", label: "Teacher Allocation" },
      ],
    },
    {
      label: "Student ID & Attendance",
      items: ID_FULL,
    },
    {
      label: "Academics",
      items: [
        { to: "/admin/classrooms", icon: "bi-door-open", label: "Classes & Streams" },
        { to: "/admin/subjects", icon: "bi-journal-bookmark", label: "Subjects" },
        { to: "/admin/calendar", icon: "bi-calendar-week", label: "Academic Calendar" },
        { to: "/admin/timetable", icon: "bi-grid-3x3", label: "Timetable Management" },
        { to: "/admin/exams", icon: "bi-pencil-square", label: "Exams" },
        { to: "/admin/mark-entry", icon: "bi-grid-3x3-gap", label: "Mark Entry (All Subjects)" },
        { to: "/admin/grading", icon: "bi-award", label: "Grading Scales" },
        { to: "/admin/rankings", icon: "bi-bar-chart-line", label: "Rankings" },
        { to: "/admin/promotions", icon: "bi-arrow-up-circle", label: "Promotions" },
        { to: "/admin/promotion-settings", icon: "bi-arrow-repeat", label: "Automatic Promotion" },
        { to: "/admin/clearance", icon: "bi-patch-check", label: "Student Clearance" },
      ],
    },
    {
      label: "Finance",
      items: [
        { to: "/admin/payments", icon: "bi-credit-card", label: "Payments" },
        { to: "/admin/fees", icon: "bi-cash-coin", label: "Fee Structures" },
        { to: "/admin/fee-cards", icon: "bi-credit-card-2-front", label: "Fee Update Cards" },
        { to: "/admin/verify-receipt", icon: "bi-qr-code-scan", label: "Verify Receipt" },
        { to: "/verify-gatepass", icon: "bi-shield-check", label: "Verify Gatepass" },
        { to: "/admin/expenses", icon: "bi-wallet2", label: "Expenses" },
        { to: "/admin/finance-reports/detailed", icon: "bi-table", label: "Student Balance & Reports" },
        { to: "/admin/finance-reports/collections", icon: "bi-graph-up-arrow", label: "Collections Report" },
        { to: "/admin/finance-reports/class-analysis", icon: "bi-bar-chart-steps", label: "Class Analysis" },
      ],
    },
    {
      label: "Bursaries & Discounts",
      items: BURSARY_FULL,
    },
    {
      label: "Boarding",
      items: BOARD_FULL,
    },
    {
      label: "Communication",
      items: [
        { to: "/admin/communications", icon: "bi-megaphone", label: "Announcements" },
        { to: "/admin/letters", icon: "bi-envelope-paper", label: "Letters & Documents" },
      ],
    },
    {
      label: "Procurement",
      items: PROC_FULL,
    },
    {
      // Full cafeteria module: scan desk, dashboard, collections, cards,
      // plans, attendants and billing (every /meals/* page + /cafeteria).
      label: "Cafeteria",
      items: CAFETERIA_FULL,
    },
    {
      label: "Administration",
      items: [
        { to: "/admin/reports", icon: "bi-graph-up", label: "Reports & Analytics" },
        { to: "/admin/users", icon: "bi-shield-lock", label: "User Accounts" },
        { to: "/admin/settings", icon: "bi-gear", label: "School Settings" },
        { to: "/admin/security", icon: "bi-shield-exclamation", label: "Security Monitor" },
      ],
    },
    {
      label: "Account",
      items: [
        MY_ATTENDANCE,
        MY_PAYSLIPS,
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/admin/license", icon: "bi-key-fill", label: "License" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // -----------------------------------------------------------------
  // PRINCIPAL — oversight role: academics, staffing, results, reports.
  // Reuses the same page components as ADMIN (via /principal/* routes
  // in App.jsx) rather than duplicating pages — the Principal just gets
  // a narrower, read/oversight-leaning slice of the same tools.
  // Also the default approver for procurement requisitions / POs, and
  // (with Admin) the approver of bursary / discount awards.
  // Priority: approvals/oversight first, then academics, people,
  // student ID, boarding, bursaries, reports, communication, procurement.
  // -----------------------------------------------------------------
  PRINCIPAL: [
    {
      items: [
        { to: "/principal", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
        { to: "/verify-gatepass", icon: "bi-shield-check", label: "Verify Gatepass" },
      ],
    },
    {
      label: "Academics",
      items: [
        { to: "/principal/classrooms", icon: "bi-door-open", label: "Classes & Streams" },
        { to: "/principal/exams", icon: "bi-pencil-square", label: "Exams" },
        { to: "/principal/rankings", icon: "bi-bar-chart-line", label: "Rankings" },
        { to: "/principal/promotions", icon: "bi-arrow-up-circle", label: "Promotions" },
        { to: "/principal/clearance", icon: "bi-patch-check", label: "Student Clearance" },
      ],
    },
    {
      label: "People",
      items: [
        { to: "/principal/students", icon: "bi-people", label: "Students" },
        { to: "/principal/teachers", icon: "bi-person-workspace", label: "Teacher Allocation" },
      ],
    },
    {
      label: "Student ID & Attendance",
      items: ID_FULL,
    },
    {
      label: "Boarding",
      items: BOARD_VIEW_ITEMS,
    },
    {
      label: "Bursaries & Discounts",
      items: BURSARY_VIEW_ITEMS,
    },
    {
      label: "Reports",
      items: [
        { to: "/principal/reports", icon: "bi-graph-up", label: "Reports & Analytics" },
      ],
    },
    {
      label: "Communication",
      items: [
        { to: "/principal/communications", icon: "bi-megaphone", label: "Announcements" },
      ],
    },
    {
      label: "Procurement",
      items: [
        ...PROC_OVERSIGHT,
        { to: "/procurement/audit", icon: "bi-journal-check", label: "Audit Trail" },
      ],
    },
    {
      label: "Account",
      items: [
        MY_ATTENDANCE,
        MY_PAYSLIPS,
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // -----------------------------------------------------------------
  // SECRETARY — front-office role: admitting/managing student records,
  // student ID cards, clearance desk, a full Finance slice (payments,
  // student balance & reports, expenses, invoices, verify receipt, fee
  // update cards), then Mark Entry, Exams, Rankings, Promotions,
  // timetable & teacher-allocation reference, boarding, announcements
  // and letters.
  // Reuses the ADMIN/FINANCE page components under /secretary/* routes.
  // Can request bursary / discount awards (approval is Admin/Principal).
  // Priority: student records -> student ID -> finance -> bursaries ->
  // academics -> boarding -> communication -> procurement -> cafeteria.
  // -----------------------------------------------------------------
  SECRETARY: [
    {
      items: [
        { to: "/secretary", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "Student Records",
      items: [
        { to: "/secretary/students", icon: "bi-people", label: "Students (Admit & Mng)" },
        { to: "/secretary/clearance", icon: "bi-patch-check", label: "Student Clearance" },
      ],
    },
    {
      label: "Student ID & Attendance",
      items: ID_FULL,
    },
    {
      label: "Finance",
      items: [
        { to: "/secretary/payments", icon: "bi-cash-coin", label: "Payments" },
        { to: "/secretary/invoices", icon: "bi-file-earmark-text", label: "Invoices" },
        { to: "/secretary/fee-cards", icon: "bi-credit-card-2-front", label: "Fee Update Cards" },
        { to: "/secretary/verify-receipt", icon: "bi-qr-code-scan", label: "Verify Receipt" },
        { to: "/verify-gatepass", icon: "bi-shield-check", label: "Verify Gatepass" },
        { to: "/secretary/expenses", icon: "bi-wallet2", label: "Expenses" },
        { to: "/secretary/finance-reports/detailed", icon: "bi-table", label: "Student Balance & Reports" },
      ],
    },
    {
      label: "Bursaries & Discounts",
      items: BURSARY_VIEW_ITEMS,
    },
    {
      label: "Academics & Staffing",
      items: [
        { to: "/secretary/classrooms", icon: "bi-door-open", label: "Classes & Streams" },
        { to: "/secretary/timetable", icon: "bi-grid-3x3", label: "Timetable Management" },
        { to: "/secretary/teachers", icon: "bi-person-workspace", label: "Teacher Allocation" },
        { to: "/secretary/exams", icon: "bi-pencil-square", label: "Exams" },
        { to: "/secretary/mark-entry", icon: "bi-grid-3x3-gap", label: "Mark Entry (All Subjects)" },
        { to: "/secretary/rankings", icon: "bi-bar-chart-line", label: "Rankings" },
        { to: "/secretary/promotions", icon: "bi-arrow-up-circle", label: "Promotions" },
      ],
    },
    {
      label: "Boarding",
      items: BOARD_VIEW_ITEMS,
    },
    {
      label: "Communication",
      items: [
        { to: "/secretary/communications", icon: "bi-megaphone", label: "Announcements" },
        { to: "/secretary/letters", icon: "bi-envelope-paper", label: "Letters & Documents" },
      ],
    },
    {
      label: "Procurement",
      items: PROC_OVERSIGHT,
    },
    {
      label: "Cafeteria",
      items: [
        { to: "/cafeteria", icon: "bi-qr-code-scan", label: "Meal Scan Desk" },
      ],
    },
    {
      label: "Account",
      items: [
        MY_ATTENDANCE,
        MY_PAYSLIPS,
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  EXAM_OFFICER: [
    {
      items: [
        { to: "/exam-officer", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "Examinations",
      items: [
        { to: "/exam-officer/exams", icon: "bi-pencil-square", label: "Exams" },
        { to: "/exam-officer/mark-entry", icon: "bi-grid-3x3-gap", label: "Mark Entry (All Subjects)" },
        { to: "/exam-officer/rankings", icon: "bi-bar-chart-line", label: "Rankings" },
        { to: "/exam-officer/grading", icon: "bi-award", label: "Grading Scales" },
        { to: "/exam-officer/promotions", icon: "bi-arrow-up-circle", label: "Promotions" },
        { to: "/exam-officer/promotion-settings", icon: "bi-arrow-repeat", label: "Automatic Promotion" },
        { to: "/exam-officer/reports", icon: "bi-graph-up", label: "Reports & Analytics" },
      ],
    },
    {
      label: "Academics",
      items: [
        { to: "/exam-officer/classrooms", icon: "bi-door-open", label: "Classes & Streams" },
        { to: "/exam-officer/subjects", icon: "bi-journal-bookmark", label: "Subjects" },
        { to: "/exam-officer/calendar", icon: "bi-calendar-week", label: "Academic Calendar" },
        { to: "/exam-officer/timetable", icon: "bi-grid-3x3", label: "Timetable Management" },
        { to: "/exam-officer/teachers", icon: "bi-person-workspace", label: "Teacher Allocation" },
      ],
    },
    {
      label: "People",
      items: [
        { to: "/exam-officer/students", icon: "bi-people", label: "Students" },
      ],
    },
    {
      label: "Account",
      items: [
        MY_ATTENDANCE,
        MY_PAYSLIPS,
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // TEACHER — daily classroom work first (classes, timetable, morning
  // gate scan, attendance, marks), then planning and assignments.
  TEACHER: [
    {
      items: [
        { to: "/teacher", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/verify-gatepass", icon: "bi-shield-check", label: "Verify Gatepass" },
      ],
    },
    {
      label: "Academics",
      items: [
        { to: "/teacher/classes", icon: "bi-door-open", label: "My Classes" },
        { to: "/teacher/timetable", icon: "bi-calendar3-week", label: "My Timetable" },
        ID_SCAN_ITEM,
        { to: "/teacher/attendance", icon: "bi-calendar-check", label: "Attendance" },
        { to: "/teacher/marks", icon: "bi-pencil-square", label: "Subject Marks Entry" },
        { to: "/teacher/class-marks", icon: "bi-grid-3x3-gap", label: "Class Marks Sheet" },
        { to: "/teacher/rankings", icon: "bi-bar-chart-line", label: "Class Rankings" },
        { to: "/teacher/assignments", icon: "bi-journal-text", label: "Assignments & Revision" },
        { to: "/teacher/lesson-planning", icon: "bi-journal-richtext", label: "Lesson Planning" },
      ],
    },
    {
      label: "Communication",
      items: [
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
        MY_ATTENDANCE,
        MY_PAYSLIPS,
      ],
    },
    {
      label: "Procurement",
      items: PROC_REQUESTER,
    },
    {
      label: "Account",
      items: [
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // STUDENT and PARENT are deliberately NOT staff: no payslips and no
  // gate-QR sign in/out (see STAFF_ROLES in App.jsx).
  STUDENT: [
    {
      items: [
        { to: "/student", icon: "bi-speedometer2", label: "Dashboard" },
      ],
    },
    {
      label: "Academics",
      items: [
        { to: "/student/results", icon: "bi-journal-text", label: "My Results" },
        { to: "/student/assignments", icon: "bi-journal-arrow-down", label: "Assignments & Revision" },
        { to: "/student/timetable", icon: "bi-calendar3-week", label: "Class Timetable" },
        { to: "/student/subjects", icon: "bi-journal-bookmark", label: "My Subjects" },
        { to: "/student/library", icon: "bi-book", label: "Library" },
        { to: "/student/clearance", icon: "bi-patch-check", label: "Clearance" },
      ],
    },
    {
      label: "Finance",
      items: [
        { to: "/student/fees", icon: "bi-cash-coin", label: "Fee Statement" },
        { to: "/student/fee-structure", icon: "bi-card-list", label: "Fee Structure" },
        { to: "/student/meals", icon: "bi-egg-fried", label: "Meals & Wallet" },
      ],
    },
    {
      label: "Boarding",
      items: [
        { to: "/student/boarding", icon: "bi-building", label: "My Boarding" },
      ],
    },
    {
      label: "Communication",
      items: [
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "Account",
      items: [
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
      ],
    },
  ],

  PARENT: [
    {
      items: [
        { to: "/parent", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/verify-gatepass", icon: "bi-shield-check", label: "Verify Gatepass" },
      ],
    },
    {
      label: "Family",
      items: [
        { to: "/parent/children", icon: "bi-people", label: "My Children" },
      ],
    },
    {
      label: "Academics",
      items: [
        { to: "/parent/results", icon: "bi-journal-text", label: "Results" },
        { to: "/parent/library", icon: "bi-book", label: "Library" },
      ],
    },
    {
      label: "Finance",
      items: [
        { to: "/parent/fees", icon: "bi-cash-coin", label: "Fee Statements" },
        { to: "/parent/meals", icon: "bi-egg-fried", label: "Meals & Wallet" },
      ],
    },
    {
      label: "Boarding",
      items: [
        { to: "/parent/boarding", icon: "bi-building", label: "My Child's Boarding" },
      ],
    },
    {
      label: "Communication",
      items: [
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "Account",
      items: [
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // FINANCE — collecting money first (payments, invoices), then setup,
  // verification, student ID lookup, expenses, reports, bursaries &
  // discounts (funders, schemes, funds received), boarding settings,
  // communication, procurement.
  FINANCE: [
    {
      items: [
        { to: "/finance", icon: "bi-speedometer2", label: "Dashboard" },
      ],
    },
    {
      label: "Fee Management",
      items: [
        { to: "/finance/payments", icon: "bi-cash-coin", label: "Payments" },
        { to: "/finance/invoices", icon: "bi-file-earmark-text", label: "Invoices" },
        { to: "/finance/structures", icon: "bi-receipt", label: "Fee Structures" },
        { to: "/finance/fee-cards", icon: "bi-credit-card-2-front", label: "Fee Update Cards" },
        { to: "/finance/verify-receipt", icon: "bi-qr-code-scan", label: "Verify Receipt" },
        { to: "/verify-gatepass", icon: "bi-shield-check", label: "Verify Gatepass" },
        ID_LOOKUP_ITEM,
        { to: "/finance/expenses", icon: "bi-wallet2", label: "Expenses" },
      ],
    },
    {
      label: "Reports",
      items: [
        { to: "/finance/reports/detailed", icon: "bi-table", label: "Student Balance & Reports" },
        { to: "/finance/reports/collections", icon: "bi-graph-up-arrow", label: "Collections Report" },
        { to: "/finance/reports/class-analysis", icon: "bi-bar-chart-steps", label: "Class Analysis" },
      ],
    },
    {
      label: "Bursaries & Discounts",
      items: BURSARY_FULL,
    },
    {
      label: "Boarding",
      items: BOARD_SETTINGS_ONLY,
    },
    {
      label: "Communication",
      items: [
        { to: "/finance/communications", icon: "bi-megaphone", label: "Announcements" },
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
        MY_ATTENDANCE,
        MY_PAYSLIPS,
      ],
    },
    {
      label: "Procurement",
      items: PROC_OVERSIGHT,
    },
    {
      label: "Account",
      items: [
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // -----------------------------------------------------------------
  // HOSTEL_WARDEN — runs the boarding house day to day: roll call,
  // exeats, boarders, bed allocations, hostels & rooms and history.
  // Rollover and Settings are Admin/Finance only (see BOARD_ADMIN /
  // BOARD_SETTINGS in App.jsx), so they are not listed here. Pages live
  // under /warden/* in App.jsx and are backed by the `boarding` app.
  // -----------------------------------------------------------------
  HOSTEL_WARDEN: [
    {
      items: [
        { to: "/warden", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "Boarding",
      items: BOARD_VIEW_ITEMS.slice(1), // dashboard is already the top link
    },
    {
      label: "Account",
      items: [
        MY_ATTENDANCE,
        MY_PAYSLIPS,
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // -----------------------------------------------------------------
  // PROCUREMENT — procurement officer: requisitions, approvals inbox,
  // suppliers, RFQs & quotation comparison, purchase orders, goods
  // received, supplier invoices (3-way match), contracts, returns,
  // budgets, reports and the audit trail. Pages live under
  // /procurement/* in App.jsx and are backed by the separate
  // `procurement` Django app.
  // -----------------------------------------------------------------
  PROCUREMENT: [
    {
      label: "Procurement",
      items: PROC_FULL,
    },
    {
      label: "Communication",
      items: [
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
        MY_ATTENDANCE,
        MY_PAYSLIPS,
      ],
    },
    {
      label: "Account",
      items: [
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // -----------------------------------------------------------------
  // LIBRARIAN — runs the school library: issue/return desk, catalogue,
  // loans & fines, reports and lending rules. Pages live under
  // /librarian/* in App.jsx and are backed by the separate `library`
  // Django app.
  // -----------------------------------------------------------------
  LIBRARIAN: [
    {
      items: [
        { to: "/librarian", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "Circulation",
      items: [
        { to: "/librarian/desk", icon: "bi-upc-scan", label: "Issue & Return" },
        { to: "/librarian/loans", icon: "bi-arrow-left-right", label: "Loans & Fines" },
      ],
    },
    {
      label: "Collection",
      items: [
        { to: "/librarian/catalogue", icon: "bi-book", label: "Catalogue" },
      ],
    },
    {
      label: "Reports & Rules",
      items: [
        { to: "/librarian/reports", icon: "bi-graph-up", label: "Library Reports" },
        { to: "/librarian/settings", icon: "bi-sliders", label: "Lending Rules" },
      ],
    },
    {
      label: "Procurement",
      items: PROC_REQUESTER,
    },
    {
      label: "Account",
      items: [
        MY_ATTENDANCE,
        MY_PAYSLIPS,
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // -----------------------------------------------------------------
  // CAFETERIA — runs the meal scan desk: scan student meal cards and
  // issue meals, plus the meal dashboard, collections, cards, plans,
  // attendants and billing. Uses the same CAFETERIA_FULL list as ADMIN.
  // Pages live at /cafeteria and /meals/* in App.jsx and are backed by
  // the separate `meal_management` Django app.
  // -----------------------------------------------------------------
  CAFETERIA: [
    {
      items: [
        ...CAFETERIA_FULL,
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "Procurement",
      items: PROC_REQUESTER,
    },
    {
      label: "Account",
      items: [
        MY_ATTENDANCE,
        MY_PAYSLIPS,
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
        { to: "/user-manual", icon: "bi-play-circle", label: "User Manual" },
        { to: "/contact-developer", icon: "bi-headset", label: "Contact Developer" },
      ],
    },
  ],

  // -----------------------------------------------------------------
  // HR — human resources officer: employees, recruitment, staff
  // attendance (incl. the rotating gate QR screen), leave, payroll &
  // payslips, and HR reports. Pages live under /hr/* in App.jsx and are
  // backed by the separate `hr` Django app.
  // -----------------------------------------------------------------
  HR: [
    {
      items: [
        { to: "/hr", icon: "bi-speedometer2", label: "Dashboard" },
        { to: "/messages", icon: "bi-chat-right-text", label: "Messages" },
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "People",
      items: [
        { to: "/hr/employees", icon: "bi-people", label: "Employees" },
        { to: "/hr/recruitment", icon: "bi-person-plus", label: "Recruitment" },
      ],
    },
    {
      label: "Attendance & Leave",
      items: [
        { to: "/hr/attendance", icon: "bi-calendar-check", label: "Staff Attendance" },
        { to: "/hr/leave", icon: "bi-calendar2-minus", label: "Leave Requests" },
        { to: "/hr/gate", icon: "bi-qr-code", label: "Gate QR Screen" },
      ],
    },
    {
      label: "Payroll",
      items: [
        { to: "/hr/payroll", icon: "bi-cash-stack", label: "Payroll & Payslips" },
      ],
    },
    {
      label: "Reports",
      items: [
        { to: "/hr/reports", icon: "bi-graph-up", label: "HR Reports" },
      ],
    },
    {
      label: "Procurement",
      items: PROC_REQUESTER,
    },
    {
      label: "Account",
      items: [
        MY_ATTENDANCE,
        { to: "/my-payslips", icon: "bi-receipt", label: "My Payslips" },
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
      ],
    },
  ],

  // -----------------------------------------------------------------
  // STAFF — employees with no other role (support staff, ICT,
  // administration, store keeper). They sign in/out by scanning the
  // gate QR with their own phone, read their own payslips here, take
  // the morning student gate scan, and handle store receiving (goods
  // received & returns).
  // -----------------------------------------------------------------
  STAFF: [
    {
      items: [
        MY_ATTENDANCE,
        MY_PAYSLIPS,
        ID_SCAN_ITEM,
        { to: "/notifications", icon: "bi-bell", label: "Notifications" },
      ],
    },
    {
      label: "Stores",
      items: PROC_STORE,
    },
    {
      label: "Account",
      items: [
        { to: "/profile", icon: "bi-person", label: "My Profile" },
        { to: "/change-password", icon: "bi-shield-lock", label: "Change Password" },
      ],
    },
  ],
};