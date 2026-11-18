"""
python manage.py seed_library

Fills the library with demo data so every screen has something to show:
categories, books with copies, and a realistic mix of loans (on time,
overdue, returned late, damaged, lost) with fines in every state.

Borrowers are picked at RANDOM from the real active students already in
the `api` app, so run it on a database that has students. It only writes
to library tables and never touches `api` data.

Examples
    python manage.py seed_library
    python manage.py seed_library --books 30 --loans 60 --students 25
    python manage.py seed_library --seed 42            # same result every time
    python manage.py seed_library --clear              # wipe library data, then seed
    python manage.py seed_library --clear --no-seed    # just wipe

Safety: refuses to run when DEBUG is False unless you pass --force.
"""
import random
from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from api import models as api_models
from library import services
from library.models import Book, BookCategory, BookCopy, Fine, LibrarySettings, Loan

# (title, author, category)
CATALOGUE = [
    ("The River Between", "Ngũgĩ wa Thiong'o", "Fiction"),
    ("Weep Not, Child", "Ngũgĩ wa Thiong'o", "Fiction"),
    ("A Grain of Wheat", "Ngũgĩ wa Thiong'o", "Fiction"),
    ("Things Fall Apart", "Chinua Achebe", "Fiction"),
    ("Blossoms of the Savannah", "Henry Ole Kulet", "Fiction"),
    ("Betrayal in the City", "Francis Imbuga", "Fiction"),
    ("Inheritance", "David Mulwa", "Fiction"),
    ("Animal Farm", "George Orwell", "Fiction"),
    ("Cry, the Beloved Country", "Alan Paton", "Fiction"),
    ("The Pearl", "John Steinbeck", "Fiction"),
    ("Romeo and Juliet", "William Shakespeare", "Fiction"),
    ("Chozi la Heri", "Assumpta Matei", "Kiswahili"),
    ("Kidagaa Kimemwozea", "Ken Walibora", "Kiswahili"),
    ("Siku Njema", "Ken Walibora", "Kiswahili"),
    ("Kamusi ya Kiswahili Sanifu", "TUKI", "Reference"),
    ("Oxford Advanced Learner's Dictionary", "Oxford University Press", "Reference"),
    ("Oxford School Atlas", "Oxford University Press", "Reference"),
    ("Unbowed", "Wangari Maathai", "Biography"),
    ("Long Walk to Freedom", "Nelson Mandela", "Biography"),
    ("Born a Crime", "Trevor Noah", "Biography"),
    ("I Write What I Like", "Steve Biko", "Biography"),
    ("A Brief History of Time", "Stephen Hawking", "Science"),
    ("Cosmos", "Carl Sagan", "Science"),
    ("The Selfish Gene", "Richard Dawkins", "Science"),
    ("How to Solve It", "George Polya", "Mathematics"),
    ("The Man Who Counted", "Malba Tahan", "Mathematics"),
    ("Sapiens", "Yuval Noah Harari", "History"),
    ("Decolonising the Mind", "Ngũgĩ wa Thiong'o", "History"),
    ("The Innovators", "Walter Isaacson", "Technology"),
    ("The Holy Bible (NIV)", "", "Religion"),
    ("The Holy Quran (English translation)", "", "Religion"),
]

SHELF_BY_CATEGORY = {
    "Fiction": "F", "Kiswahili": "K", "Reference": "R", "Biography": "B", "Science": "S",
    "Mathematics": "M", "History": "H", "Technology": "T", "Religion": "X", "Textbooks": "TB",
}


class Command(BaseCommand):
    help = "Seed the library with demo books, copies, loans and fines, using random real students."

    def add_arguments(self, parser):
        parser.add_argument("--books", type=int, default=40, help="Max titles to create (default 40).")
        parser.add_argument("--copies-max", type=int, default=4, help="Max copies per title (default 4).")
        parser.add_argument("--loans", type=int, default=30, help="Loans to create (default 30).")
        parser.add_argument("--students", type=int, default=20, help="How many random students to borrow from (default 20).")
        parser.add_argument("--seed", type=int, default=None, help="Random seed, for repeatable output.")
        parser.add_argument("--clear", action="store_true", help="Delete all library books, copies, loans and fines first.")
        parser.add_argument("--no-seed", action="store_true", help="With --clear: only wipe, don't seed.")
        parser.add_argument("--force", action="store_true", help="Allow running when DEBUG is False.")

    # ------------------------------------------------------------------
    def handle(self, *args, **o):
        if not settings.DEBUG and not o["force"]:
            raise CommandError("DEBUG is False. This command creates fake data; pass --force if you really mean it.")

        rng = random.Random(o["seed"])

        with transaction.atomic():
            if o["clear"]:
                self._clear()
                if o["no_seed"]:
                    return

            students = self._random_students(rng, o["students"])
            librarian = self._librarian()

            categories_made, books_made, copies_made = self._seed_books(rng, o["books"], o["copies_max"])
            loans_made, fines_made, skipped = self._seed_loans(rng, students, librarian, o["loans"])

        self.stdout.write(self.style.SUCCESS("Library seeded."))
        self.stdout.write(f"  Borrowers drawn from : {len(students)} random active students")
        self.stdout.write(f"  Categories created   : {categories_made}")
        self.stdout.write(f"  Books created        : {books_made}")
        self.stdout.write(f"  Copies created       : {copies_made}")
        self.stdout.write(f"  Loans created        : {sum(loans_made.values())} "
                          f"({loans_made['active']} on time, {loans_made['overdue']} overdue, {loans_made['returned']} returned)")
        self.stdout.write(f"  Fines created        : {fines_made}")
        if skipped:
            self.stdout.write(self.style.WARNING(f"  Loans skipped        : {skipped} (ran out of free copies; add --books or --copies-max)"))
        if not librarian:
            self.stdout.write(self.style.WARNING("  No LIBRARIAN or ADMIN user found, so loans have no 'issued by'."))

    # ------------------------------------------------------------------
    def _clear(self):
        fines = Fine.objects.count()
        loans = Loan.objects.count()
        copies = BookCopy.objects.count()
        books = Book.objects.count()
        Fine.objects.all().delete()
        Loan.objects.all().delete()        # before copies: Loan.copy is PROTECT
        BookCopy.objects.all().delete()
        Book.objects.all().delete()
        BookCategory.objects.all().delete()
        self.stdout.write(self.style.WARNING(
            f"Cleared {books} books, {copies} copies, {loans} loans, {fines} fines."
        ))

    def _random_students(self, rng, how_many):
        ids = list(api_models.StudentProfile.objects.filter(is_active=True).values_list("id", flat=True))
        if not ids:
            raise CommandError("No active students found in the api app. Admit some students first.")
        picked = rng.sample(ids, min(how_many, len(ids)))
        return list(api_models.StudentProfile.objects.filter(id__in=picked).select_related("user"))

    def _librarian(self):
        for role in (api_models.User.Role.LIBRARIAN, api_models.User.Role.ADMIN):
            user = api_models.User.objects.filter(role=role, is_active=True).first()
            if user:
                return user
        return None

    # ------------------------------------------------------------------
    def _seed_books(self, rng, cap, copies_max):
        cat_cache, cats_made = {}, 0

        def category(name):
            nonlocal cats_made
            if name not in cat_cache:
                obj, created = BookCategory.objects.get_or_create(name=name)
                cats_made += int(created)
                cat_cache[name] = obj
            return cat_cache[name]

        candidates = []
        for title, author, cat in CATALOGUE:
            candidates.append({
                "title": title, "author": author, "category": cat,
                "price": Decimal(rng.randrange(350, 1100, 50)),
                "subject": None, "grade_level": None,
            })

        # Textbooks tied to real subjects and grades already in the system.
        subjects = list(api_models.Subject.objects.all())
        grades = list(api_models.GradeLevel.objects.all())
        for subject in rng.sample(subjects, min(8, len(subjects))):
            grade = rng.choice(grades) if grades else None
            candidates.append({
                "title": f"{subject.name} {grade.name if grade else ''} Textbook".replace("  ", " ").strip(),
                "author": "KLB / Oxford", "category": "Textbooks",
                "price": Decimal(rng.randrange(500, 1600, 50)),
                "subject": subject, "grade_level": grade,
            })

        rng.shuffle(candidates)
        candidates = candidates[:cap]

        books_made = copies_made = 0
        for c in candidates:
            book, created = Book.objects.get_or_create(
                title=c["title"],
                defaults={
                    "author": c["author"],
                    "category": category(c["category"]),
                    "isbn": "978" + "".join(str(rng.randint(0, 9)) for _ in range(10)),
                    "publisher": "Demo Publisher",
                    "publication_year": rng.randint(2005, 2024),
                    "subject": c["subject"],
                    "grade_level": c["grade_level"],
                    "price": c["price"],
                    "shelf_location": f"{SHELF_BY_CATEGORY.get(c['category'], 'G')}-{rng.randint(1, 20):02d}",
                },
            )
            books_made += int(created)
            if not book.copies.exists():
                n = rng.randint(1, max(copies_max, 1))
                services.add_copies(book, n)
                copies_made += n
        return cats_made, books_made, copies_made

    # ------------------------------------------------------------------
    def _seed_loans(self, rng, students, librarian, how_many):
        cfg = LibrarySettings.get()
        today = timezone.localdate()
        loan_days = cfg.loan_days

        copies = list(BookCopy.objects.filter(status=BookCopy.Status.AVAILABLE).select_related("book"))
        rng.shuffle(copies)

        held = defaultdict(int)
        for row in Loan.objects.filter(returned_on__isnull=True, student__isnull=False).values("student_id").annotate(c=Count("id")):
            held[row["student_id"]] = row["c"]

        made = {"active": 0, "overdue": 0, "returned": 0}
        fines_made = skipped = 0

        for _ in range(how_many):
            if not copies:
                skipped += 1
                continue
            student = rng.choice(students)
            scenario = rng.choices(["active", "overdue", "returned"], weights=[40, 25, 35])[0]
            if scenario != "returned" and held[student.id] >= cfg.max_active_loans:
                scenario = "returned"
            copy = copies.pop()
            base = {
                "copy": copy, "student": student,
                "borrower_admission_no": student.admission_no,
                "borrower_name": student.user.get_full_name(),
                "issued_by": librarian,
            }

            if scenario == "active":
                issued = today - timedelta(days=rng.randint(0, max(loan_days - 2, 0)))
                due = issued + timedelta(days=loan_days)
                renewals = 0
                if rng.random() < 0.2 and cfg.max_renewals > 0:
                    renewals, due = 1, due + timedelta(days=loan_days)
                Loan.objects.create(**base, issued_on=issued, due_on=due, renewals=renewals)
                copy.status = BookCopy.Status.ON_LOAN
                copy.save(update_fields=["status"])
                held[student.id] += 1

            elif scenario == "overdue":
                due = today - timedelta(days=rng.randint(1, 30))
                issued = due - timedelta(days=loan_days)
                Loan.objects.create(**base, issued_on=issued, due_on=due)
                copy.status = BookCopy.Status.ON_LOAN
                copy.save(update_fields=["status"])
                held[student.id] += 1

            else:
                issued = today - timedelta(days=rng.randint(loan_days + 1, 100))
                due = issued + timedelta(days=loan_days)
                days_late = rng.choices([0, rng.randint(1, 15)], weights=[70, 30])[0]
                returned = min(due + timedelta(days=days_late), today)
                condition = rng.choices(
                    [Loan.Condition.GOOD, Loan.Condition.DAMAGED, Loan.Condition.LOST], weights=[90, 6, 4]
                )[0]
                loan = Loan.objects.create(
                    **base, issued_on=issued, due_on=due, returned_on=returned,
                    return_condition=condition, received_by=librarian,
                )
                fines_made += self._returned_fines(rng, loan, copy, condition, librarian)

            made[scenario] += 1

        return made, fines_made, skipped

    def _returned_fines(self, rng, loan, copy, condition, librarian):
        """Create the fines a real return would have raised, in a mix of states."""
        pending = []
        days_late = services.overdue_days(loan)
        late_fee = services.fine_for_days(days_late)
        if late_fee > 0:
            pending.append((Fine.Reason.OVERDUE, late_fee, f"{days_late} day(s) late"))

        if condition == Loan.Condition.LOST:
            pending.append((Fine.Reason.LOST, copy.book.price or Decimal("500"), "Replacement fee"))
            copy.status = BookCopy.Status.LOST
            copy.save(update_fields=["status"])
        elif condition == Loan.Condition.DAMAGED:
            pending.append((Fine.Reason.DAMAGED, Decimal(rng.randrange(100, 350, 50)), "Torn pages"))
            copy.status = BookCopy.Status.DAMAGED
            copy.save(update_fields=["status"])

        stamp = timezone.make_aware(datetime.combine(loan.returned_on, time(10, 0)))
        for reason, amount, note in pending:
            status = rng.choices([Fine.Status.PAID, Fine.Status.WAIVED, Fine.Status.UNPAID], weights=[55, 10, 35])[0]
            fine = Fine.objects.create(loan=loan, amount=amount, reason=reason, note=note, status=status)
            updates = {"created_at": stamp}
            if status != Fine.Status.UNPAID:
                updates.update(settled_at=stamp + timedelta(hours=rng.randint(1, 48)), settled_by=librarian)
                if status == Fine.Status.WAIVED:
                    updates["note"] = f"{note}. Waived by the librarian (demo data)"
            Fine.objects.filter(pk=fine.pk).update(**updates)  # created_at is auto_now_add, so backdate with update()
        return len(pending)
