"""
library/models.py

School library for Masomo. Only POINTS AT api tables (StudentProfile,
Subject, GradeLevel) with foreign keys; no api model is edited here.

Every physical book is a BookCopy with its own accession number (the
barcode on the spine), so a loan always says exactly which copy left the
shelf. A Book is the title; copies are the stock.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class LibrarySettings(models.Model):
    """One row (pk=1) of lending rules, editable by the librarian."""

    loan_days = models.PositiveSmallIntegerField(default=14, help_text="Days a book can be borrowed for.")
    max_active_loans = models.PositiveSmallIntegerField(default=3, help_text="Books a learner can hold at once.")
    max_renewals = models.PositiveSmallIntegerField(default=2)
    fine_per_day = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("5.00"), help_text="KES per overdue day.")
    grace_days = models.PositiveSmallIntegerField(default=0, help_text="Overdue days before fines start.")
    block_if_overdue = models.BooleanField(default=True, help_text="No new loans while the learner has an overdue book.")
    block_if_unpaid_fines = models.BooleanField(default=True, help_text="No new loans while the learner has unpaid library fines.")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "library_settings"

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class BookCategory(models.Model):
    name = models.CharField(max_length=80, unique=True)

    class Meta:
        db_table = "library_categories"
        ordering = ["name"]
        verbose_name_plural = "book categories"

    def __str__(self):
        return self.name


class Book(models.Model):
    title = models.CharField(max_length=200)
    author = models.CharField(max_length=150, blank=True)
    isbn = models.CharField(max_length=20, blank=True, db_index=True)
    publisher = models.CharField(max_length=120, blank=True)
    publication_year = models.PositiveSmallIntegerField(null=True, blank=True)
    edition = models.CharField(max_length=40, blank=True)
    category = models.ForeignKey(BookCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name="books")
    subject = models.ForeignKey(
        "api.Subject", on_delete=models.SET_NULL, null=True, blank=True, related_name="library_books",
        help_text="For textbooks: the subject this book supports.",
    )
    grade_level = models.ForeignKey(
        "api.GradeLevel", on_delete=models.SET_NULL, null=True, blank=True, related_name="library_books",
        help_text="For textbooks: the grade it is meant for.",
    )
    shelf_location = models.CharField(max_length=40, blank=True)
    price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, help_text="Replacement cost, used when a copy is lost."
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True, help_text="Untick to hide from the catalogue without deleting.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "library_books"
        ordering = ["title"]

    def __str__(self):
        return self.title


class BookCopy(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "AVAILABLE", "Available"
        ON_LOAN = "ON_LOAN", "On loan"
        DAMAGED = "DAMAGED", "Damaged"
        LOST = "LOST", "Lost"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"

    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="copies")
    accession_no = models.CharField(max_length=30, unique=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.AVAILABLE)
    notes = models.CharField(max_length=255, blank=True)
    acquired_on = models.DateField(default=timezone.localdate)

    class Meta:
        db_table = "library_copies"
        ordering = ["accession_no"]

    def __str__(self):
        return f"{self.accession_no} - {self.book.title}"


class Loan(models.Model):
    class Condition(models.TextChoices):
        GOOD = "GOOD", "Good"
        DAMAGED = "DAMAGED", "Damaged"
        LOST = "LOST", "Lost"

    copy = models.ForeignKey(BookCopy, on_delete=models.PROTECT, related_name="loans")
    student = models.ForeignKey(
        "api.StudentProfile", on_delete=models.SET_NULL, null=True, blank=True, related_name="library_loans"
    )
    # Snapshots, so history survives if a student record is ever deleted.
    borrower_admission_no = models.CharField(max_length=30)
    borrower_name = models.CharField(max_length=150)

    issued_on = models.DateField(default=timezone.localdate)
    due_on = models.DateField()
    returned_on = models.DateField(null=True, blank=True)
    renewals = models.PositiveSmallIntegerField(default=0)
    return_condition = models.CharField(max_length=10, choices=Condition.choices, blank=True)
    note = models.CharField(max_length=255, blank=True)

    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="library_loans_issued")
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="library_loans_received")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "library_loans"
        ordering = ["-issued_on", "-id"]
        indexes = [models.Index(fields=["returned_on", "due_on"])]
        constraints = [
            models.UniqueConstraint(
                fields=["copy"], condition=Q(returned_on__isnull=True), name="uniq_active_loan_per_copy"
            )
        ]

    @property
    def is_active(self):
        return self.returned_on is None

    def __str__(self):
        return f"{self.copy.accession_no} -> {self.borrower_admission_no}"


class Fine(models.Model):
    class Reason(models.TextChoices):
        OVERDUE = "OVERDUE", "Overdue"
        LOST = "LOST", "Lost book"
        DAMAGED = "DAMAGED", "Damaged book"

    class Status(models.TextChoices):
        UNPAID = "UNPAID", "Unpaid"
        PAID = "PAID", "Paid"
        WAIVED = "WAIVED", "Waived"

    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="fines")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reason = models.CharField(max_length=10, choices=Reason.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UNPAID)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    settled_at = models.DateTimeField(null=True, blank=True)
    settled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="library_fines_settled")

    class Meta:
        db_table = "library_fines"
        ordering = ["-created_at"]

    def __str__(self):
        return f"KES {self.amount} {self.reason} [{self.status}]"
