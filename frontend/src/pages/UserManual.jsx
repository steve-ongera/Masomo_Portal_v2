import { useState } from "react";
import Breadcrumb from "../components/Breadcrumb";

/**
 * ============================================================================
 * USER MANUAL — Written Guides
 * ============================================================================
 * Shown to ADMIN / TEACHER / FINANCE / STUDENT (see App.jsx route guard).
 *
 * Each guide in GUIDES has:
 *   id        unique number
 *   title     heading shown on the card
 *   summary   one-line description shown under the title
 *   category  one of CATEGORIES (used by the filter pills)
 *   audience  roles that use the guide
 *   icon      a Bootstrap Icons class name, e.g. "bi-people"
 *   steps     ordered instructions
 *   tips      good-practice notes
 *
 * To add a guide, copy an entry in GUIDES and edit it. To rename a menu item,
 * search for its old name in the steps below and replace it.
 * ============================================================================
 */

const CATEGORIES = ["All", "Getting Started", "Academics", "Finance", "Admin"];

const ROLES = [
  {
    role: "Admin",
    tasks: "Manage students, classrooms and the timetable; oversee marks and rankings; send announcements; view reports.",
  },
  {
    role: "Teacher",
    tasks: "Enter exam marks for allocated subjects, view class results and rankings, view the timetable, send messages.",
  },
  {
    role: "Finance",
    tasks: "Set up fee structures, track M-Pesa payments and invoices, and produce finance reports.",
  },
  {
    role: "Student",
    tasks: "View results, fee balance and payment history, the timetable, and school messages.",
  },
];

const GUIDES = [
  {
    id: 1,
    title: "Logging In & Navigating the Portal",
    summary: "Sign in, find your way around the sidebar, and sign out safely.",
    category: "Getting Started",
    audience: ["Admin", "Teacher", "Finance", "Student"],
    icon: "bi-box-arrow-in-right",
    steps: [
      "Open the portal address provided by your school in a web browser.",
      "Enter your username (students use their admission number) and your password, then select Login.",
      "If you are asked to change a temporary password, choose a new one and keep it private.",
      "Use the sidebar to move between modules. On a phone, open the sidebar with the menu button at the top of the screen.",
      "The top bar shows your name, your notifications and the Sign out option.",
    ],
    tips: [
      "Menu items depend on your role. If you cannot see a module you expect, ask your school administrator.",
      "Always sign out when using a shared or public computer.",
      "Never share your password, including with colleagues or classmates.",
    ],
  },
  {
    id: 2,
    title: "Resetting a Forgotten Password",
    summary: "Regain access to your account.",
    category: "Getting Started",
    audience: ["Admin", "Teacher", "Finance", "Student"],
    icon: "bi-key",
    steps: [
      "On the login page, select Forgot password.",
      "Enter your username or registered email address and submit.",
      "Follow the instructions you receive to set a new password.",
      "If you do not receive instructions, ask your school administrator to reset your password for you.",
      "Log in with the new password and change it again if it was a temporary one.",
    ],
    tips: [
      "Choose a password that is long and not easy to guess, and do not reuse one from another service.",
      "Keep your phone number and email up to date so recovery is quick.",
    ],
  },
  {
    id: 3,
    title: "Messaging & School Communications",
    summary: "Send messages, read announcements and check notifications.",
    category: "Getting Started",
    audience: ["Admin", "Teacher", "Finance", "Student"],
    icon: "bi-chat-dots",
    steps: [
      "Open Messages from the sidebar.",
      "To send a one-to-one message, choose the recipient, type your message and select Send.",
      "To read a reply, open the conversation. Unread conversations are highlighted.",
      "Authorised staff can broadcast an announcement to a class, a group or the whole school from the announcements area.",
      "Select the notifications icon in the top bar to see new messages and announcements.",
    ],
    tips: [
      "Use announcements for notices that many people need to see, and messages for individual matters.",
      "Check your notifications at the start of each day so nothing is missed.",
      "Keep all communication professional. Messages are part of the school record.",
    ],
  },
  {
    id: 4,
    title: "Admin Dashboard Overview",
    summary: "Read the key figures and jump to common tasks.",
    category: "Admin",
    audience: ["Admin"],
    icon: "bi-speedometer2",
    steps: [
      "Log in as an administrator. The dashboard opens first.",
      "Review the key figures at the top, such as the number of students, teachers and classes, and fee collection.",
      "Use the quick links to go straight to Students, Classrooms and Reports.",
      "Return to the dashboard at any time by selecting Dashboard in the sidebar.",
    ],
    tips: [
      "Review the dashboard at the start of each day and at the beginning of every term.",
      "If a figure looks wrong, open the related module (for example Students) to check the underlying records.",
    ],
  },
  {
    id: 5,
    title: "Managing Students & Classrooms",
    summary: "Create classes, register students and keep records up to date.",
    category: "Admin",
    audience: ["Admin"],
    icon: "bi-people",
    steps: [
      "Create the classes (and streams, for example Grade 5 Blue) first, so there is somewhere to place new students.",
      "Open Students and select Add Student.",
      "Fill in the admission number, full name, gender, date of birth and the guardian's name and phone number.",
      "Choose the student's classroom and select Save.",
      "To correct details, open the student's record, edit the fields and save.",
      "To move a student to another class, open the record, change the classroom and save.",
    ],
    tips: [
      "Every student needs a unique admission number. Check for an existing record before adding a new one.",
      "Enter the guardian's phone number carefully, because it is used for school communication.",
      "At the start of each year, confirm every class list is correct before marks and fees are processed.",
    ],
  },
  {
    id: 6,
    title: "Timetable Management",
    summary: "Build and edit timetables and resolve clashes.",
    category: "Admin",
    audience: ["Admin"],
    icon: "bi-calendar-week",
    steps: [
      "Allocate teachers to their subjects and classes before building the timetable.",
      "Open Timetable and select the class you want to work on.",
      "Choose a day and period, then pick the subject and the teacher for that lesson.",
      "Repeat for every period until the week is complete.",
      "If the system reports a clash (a teacher or class booked twice), change the teacher, day or period until it clears.",
      "Save your changes so teachers and students see the updated timetable.",
    ],
    tips: [
      "Spread heavy subjects across the week rather than placing them all on one day.",
      "Check each teacher's total lessons to keep workloads fair.",
      "Tell affected teachers and students whenever a published timetable changes.",
    ],
  },
  {
    id: 7,
    title: "Mark Entry & Exam Rankings",
    summary: "Enter exam marks and generate class rankings.",
    category: "Academics",
    audience: ["Teacher", "Admin"],
    icon: "bi-journal-check",
    steps: [
      "Open the marks entry area and select the exam, the class and the subject.",
      "Enter each student's score. Scores must not be higher than the maximum for the paper.",
      "Record students who missed the exam as absent rather than entering zero.",
      "Review the list for blank entries, then select Save.",
      "Once every subject has been entered, an administrator opens the class results to view each student's total, mean, grade and position.",
      "Print or export the rankings if you need a copy.",
    ],
    tips: [
      "Teachers can enter marks only for the subjects and classes they are allocated.",
      "Double-check marks before saving, as published results are seen by students and parents.",
      "If a mark must be corrected after results are published, ask an administrator to make the change.",
    ],
  },
  {
    id: 8,
    title: "Fee Structures & M-Pesa Payments",
    summary: "Set fees per grade and term and track what has been paid.",
    category: "Finance",
    audience: ["Finance", "Admin"],
    icon: "bi-cash-coin",
    steps: [
      "Open Fees and go to Fee Structures.",
      "Choose the grade and term, then add each fee item (for example tuition or activities) with its amount.",
      "Save the structure. Repeat for every grade and term.",
      "Download the fee structure as a PDF when you need to share it with parents.",
      "Open Payments to review M-Pesa transactions. Check the transaction code, amount, date and the student the payment is applied to.",
      "Open a student's account to see their invoice, payments received and the remaining balance.",
    ],
    tips: [
      "Different grades usually have different fees, so create a separate structure for each one.",
      "Review payments regularly and resolve any that are not applied to a student.",
      "Update the fee structure before the term opens, so invoices are correct from the start.",
    ],
  },
  {
    id: 9,
    title: "Finance Reports: Collections & Class Analysis",
    summary: "Read the finance reports and export them.",
    category: "Finance",
    audience: ["Finance", "Admin"],
    icon: "bi-bar-chart-line",
    steps: [
      "Open Reports and choose the finance report you need.",
      "In the collections report, select a date range to see the money received in that period.",
      "In the class analysis, compare each class's total billed, total paid and outstanding balance.",
      "Use the filters on the detailed finance report to narrow it down, then select Export.",
      "Save or print the exported file for your records or for management.",
    ],
    tips: [
      "Compare collections against your M-Pesa and bank statements every week.",
      "Use the class analysis to decide which classes need fee reminders first.",
      "Export a copy at the end of each term and keep it with your financial records.",
    ],
  },
  {
    id: 10,
    title: "Viewing Results, Fees & Timetable",
    summary: "What students and parents can see in the portal.",
    category: "Academics",
    audience: ["Student"],
    icon: "bi-mortarboard",
    steps: [
      "Log in with your admission number and password.",
      "To see your results, open Results and choose the exam. Your scores, grades and class position are shown.",
      "To check fees, open Fees. You can see your balance and your payment history.",
      "To see your lessons, open Timetable for the weekly schedule.",
      "Open Messages to read notices from your teachers and school.",
    ],
    tips: [
      "Results appear only after the school has published them.",
      "If a score or fee amount looks wrong, speak to your class teacher or the school office.",
      "Keep your receipt or M-Pesa confirmation message until the payment shows in your account.",
    ],
  },
];

function GuideCard({ guide, open, onToggle }) {
  const panelId = `guide-panel-${guide.id}`;
  return (
    <div className="card mb-3" style={{ overflow: "hidden" }}>
      <button
        type="button"
        className="d-flex align-items-center gap-3 w-100 text-start"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        style={{ background: "none", border: "none", color: "inherit", padding: "1rem 1.25rem" }}
      >
        <i className={`bi ${guide.icon}`} style={{ fontSize: "1.4rem" }}></i>
        <span className="flex-grow-1">
          <span className="d-block fw-semibold">{guide.title}</span>
          <span className="d-block text-muted-soft" style={{ fontSize: "0.85rem" }}>
            {guide.summary}
          </span>
        </span>
        <span className="badge badge-blue">{guide.category}</span>
        <i className={`bi ${open ? "bi-chevron-up" : "bi-chevron-down"}`}></i>
      </button>

      {open && (
        <div id={panelId} style={{ padding: "0 1.25rem 1.25rem" }}>
          <p className="mb-3" style={{ fontSize: "0.85rem" }}>
            <strong>Who uses this: </strong>
            {guide.audience.join(", ")}
          </p>

          <h6 className="mb-2">Steps</h6>
          <ol className="mb-3 ps-3">
            {guide.steps.map((step, i) => (
              <li key={i} className="mb-1">
                {step}
              </li>
            ))}
          </ol>

          <h6 className="mb-2">Tips</h6>
          <ul className="mb-0 ps-3">
            {guide.tips.map((tip, i) => (
              <li key={i} className="mb-1">
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function UserManual() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [openIds, setOpenIds] = useState(() => new Set([GUIDES[0].id]));

  const filteredGuides =
    activeCategory === "All" ? GUIDES : GUIDES.filter((g) => g.category === activeCategory);

  const toggle = (id) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const expandAll = () => setOpenIds(new Set(filteredGuides.map((g) => g.id)));
  const collapseAll = () => setOpenIds(new Set());

  return (
    <div className="manual-page">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/" },
          { label: "User Manual", href: "#" },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title">User Manual</h1>
          <p className="page-subtitle">
            Step-by-step guides for using the Masomo System portal, written for each role in your school.
          </p>
        </div>
        <span className="badge badge-neutral" style={{ fontSize: "0.85rem", padding: "0.4rem 0.8rem" }}>
          <i className="bi bi-book me-1"></i>
          {GUIDES.length} guides
        </span>
      </div>

      <div className="manual-page__content">
        {/* Who can do what */}
        <div className="card mb-4">
          <div className="card-body">
            <h6 className="mb-3">Roles at a glance</h6>
            <div className="table-responsive">
              <table className="table mb-0">
                <thead>
                  <tr>
                    <th style={{ width: "140px" }}>Role</th>
                    <th>What you can do</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLES.map((r) => (
                    <tr key={r.role}>
                      <td className="fw-semibold">{r.role}</td>
                      <td>{r.tasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Category filter pills */}
        <ul className="nav nav-pills mb-3">
          {CATEGORIES.map((cat) => (
            <li className="nav-item" key={cat}>
              <button
                type="button"
                className={`nav-link ${activeCategory === cat ? "active" : ""}`}
                onClick={() => setActiveCategory(cat)}
                style={{ border: "none" }}
              >
                {cat}
              </button>
            </li>
          ))}
        </ul>

        <div className="d-flex justify-content-end gap-2 mb-3">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={collapseAll}>
            Collapse all
          </button>
        </div>

        {filteredGuides.map((guide) => (
          <GuideCard
            key={guide.id}
            guide={guide}
            open={openIds.has(guide.id)}
            onToggle={() => toggle(guide.id)}
          />
        ))}

        {filteredGuides.length === 0 && (
          <div className="empty-state">
            <i className="bi bi-journal-text"></i>
            <h6>No guides in this category yet</h6>
            <p className="text-muted-soft">Check back soon, or try a different category.</p>
          </div>
        )}
      </div>
    </div>
  );
}