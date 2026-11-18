# Masomo Digital Portal

A school management information system (MIS) for Kenyan schools, built for The Nyali School and designed to be deployed to many schools. It brings academics, finance, boarding, meals, library, HR, procurement and parent/student portals into one platform.

- **Backend:** Django with Django REST Framework (`backend/`)
- **Frontend:** React with Vite, Bootstrap and Bootstrap Icons (`frontend/`)
- **Fonts:** Inter for the interface and IBM Plex Mono for figures and codes

---

## Modules

Each module is a Django app on the backend with matching pages on the frontend.

| Module | Backend app | What it covers |
|---|---|---|
| Core academics and finance | `api` | Students, classrooms, subjects, exams, mark entry, rankings, promotions, grading, fees, payments, expenses, reports, timetable, messaging, notifications |
| Assignments | `assignments` | Teachers set assignments, students view and submit them, teachers track submissions |
| Attendance | `attendance` | Mark attendance, attendance records and reports |
| Boarding | `boarding` | Hostels, allocations, boarders, exeats, roll call, history, term rollover |
| Bursaries | `bursaries` | Bursary setup, awards, remittances |
| Entitlements | `entitlements` | Feature catalogue and licence enforcement, controlling which modules a school can use |
| HR and payroll | `hr` | Employees, recruitment, leave, attendance, payroll, payslips, gate scanning |
| ID cards | `idcards` | Student ID cards, lookup, QR scanning, absentee notifications |
| Lesson planning | `lesson_planning` | Schemes of work and lesson plans |
| Library | `library` | Catalogue, loans, desk, reports, settings |
| Meal management | `meal_management` | Meal plans, cards, billing, collections, attendants, M-Pesa |
| Procurement | `procurement` | Requisitions, RFQs and quotations, purchase orders, goods received, invoices, contracts, budgets, returns, approvals, audit trail |
| Student 360 | `student360` | A single combined view of a student |

### Portals by role

The frontend has a separate set of pages for each role under `frontend/src/pages/`:

| Role | Folder |
|---|---|
| Administrator | `admin/` (including `admin/finance/`) |
| Principal | `principal/` |
| Secretary | `secretary/` |
| Teacher | `teacher/` (assignments, attendance, lesson planning, marks, rankings, timetable) |
| Student | `student/` |
| Parent | `parent/` |
| Finance | `finance/` |
| Exam officer | `examofficer/` |
| Librarian | `librarian/` |
| Warden (boarding) | `warden/` |
| Meals and cafeteria | `meals/`, `cafeteria/` |
| HR | `hr/` |
| Procurement | `procurement/` |
| Bursaries | `bursaries/` |

Public pages: login, forgot and reset password, gate pass verification and report card verification. All signed-in users also have messages, notifications, communications, a profile, a built-in **User Manual** and a contact-developer page.

---

## Project structure

Only meaningful source files are shown. `node_modules`, `__pycache__`, virtual environments, build output and migrations are left out.

```
kenya-school-system-main/
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── API_PATCH.md                  # notes on API changes
│   ├── diagnose_enrollment.py        # helper script for enrolment problems
│   ├── backend/                      # Django project package
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── wsgi.py
│   │   └── asgi.py
│   ├── api/                          # core app
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── services.py               # main business logic
│   │   ├── views.py
│   │   ├── urls.py
│   │   ├── admin.py
│   │   ├── grading_api.py            # grading endpoints
│   │   ├── stages.py                 # level / stage helpers
│   │   ├── scheduler.py              # scheduled jobs
│   │   ├── utils.py
│   │   └── management/commands/
│   │       ├── auto_promote.py
│   │       ├── seed_data.py
│   │       ├── seed_allocation.py
│   │       └── seed_grading_scales.py
│   ├── assignments/  attendance/  boarding/  bursaries/  entitlements/
│   ├── hr/  idcards/  lesson_planning/  library/  meal_management/
│   ├── procurement/  student360/     # each app: models, serializers, services,
│   │                                 # views, urls, permissions (where needed)
│   ├── media/                        # uploaded files, e.g. student photos
│   ├── private_media/                # protected uploads, e.g. assignment files
│   └── logs/                         # runtime logs
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── .oxlintrc.json                # lint rules
    ├── public/
    └── src/
        ├── main.jsx
        ├── App.jsx                   # routes
        ├── config/
        │   └── navigation.js         # sidebar menus per role
        ├── context/                  # Auth, Entitlement, License, LicenseUsage
        ├── hooks/                    # useAuth, usePermission, useSidebar, useDevice, useFullscreen
        ├── services/                 # api.js, boardingApi.js, studentIdApi.js
        ├── components/               # shared UI: layout, navbar, sidebar, modal, tables,
        │   │                         # pagination, QR scanner, timetable grid, feature gate,
        │   │                         # licence overlay, protected route
        │   └── procurement/          # procurement-specific components
        ├── pages/                    # one folder per role or module (see table above)
        └── styles/                   # main.css, mobile.css
```

Conventions that apply across the backend: models, serializers, services, views and URLs are kept in separate files in each app. Put business rules in `services.py` and keep `views.py` focused on request handling.

---

## Getting started

**You need:** Python 3.11 or newer and Node.js 18 or newer. Check `backend/requirements.txt` and `frontend/package.json` for exact versions.

### Backend (Windows PowerShell)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

The API runs at http://127.0.0.1:8000. Configuration, including the database, CORS and allowed hosts, is in `backend/backend/settings.py`.

If PowerShell blocks the activate script, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The Vite dev server starts at http://localhost:5173 by default.

---

## Management commands

Run these from `backend/` with the virtual environment active. Use `python manage.py <command> --help` to see the options of any command.

| Command | App | Purpose |
|---|---|---|
| `seed_data` | api | Load sample school data |
| `seed_grading_scales` | api | Load grading scales |
| `seed_allocation` | api | Load teacher subject allocations |
| `auto_promote` | api | Promote students at the end of an academic year |
| `seed_boarding` | boarding | Load sample boarding data |
| `seed_bursary` | bursaries | Load sample bursary data |
| `sync_features` | entitlements | Sync the feature catalogue to the database |
| `seed_hr`, `seed_hr_defaults` | hr | Load sample HR data and default HR settings |
| `create_hr_user` | hr | Create an HR user account |
| `seed_library` | library | Load sample library data |
| `seed_meal_data` | meal_management | Load sample meal plans and data |
| `seed_procurement` | procurement | Load sample procurement data |
| `notify_absentees` | idcards | Notify guardians about absent students |

Only run seed commands on development or demo databases, never on live school data.

---

## Features and licensing

The `entitlements` app and the frontend contexts and components (`EntitlementContext`, `LicenseContext`, `FeatureGate`, `LicenseLockOverlay`, `LicenseUsageToasts`) control which modules a school can use. Wrap new pages in `FeatureGate` and register new modules in `entitlements/catalog.py`, then run `python manage.py sync_features`.

Sidebar menus for each role are defined in `frontend/src/config/navigation.js`. To add a page, create it under `src/pages/<role>/`, add its route in `App.jsx`, and add its menu entry in `navigation.js`.

---

## Files and uploads

- `backend/media/` holds public uploads such as student photos.
- `backend/private_media/` holds protected uploads such as assignment files.
- `backend/logs/` holds application logs.

Keep all three out of version control and back them up on the live server.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `no such table` or missing column errors | Run `python manage.py migrate`. |
| A page or menu item is missing for a user | Check the user's role, the school's licence and features (`sync_features`), and `config/navigation.js`. |
| Frontend cannot reach the API | Confirm Django is running on port 8000 and check the API address in `frontend/src/services/api.js`. |
| Seed command fails on a non-empty database | Seed commands are meant for fresh development databases. Check `--help` for a reset or flush option. |