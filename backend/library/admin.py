from django.contrib import admin

from .models import Book, BookCategory, BookCopy, Fine, LibrarySettings, Loan


class CopyInline(admin.TabularInline):
    model = BookCopy
    extra = 0


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ("title", "author", "isbn", "category", "is_active")
    search_fields = ("title", "author", "isbn")
    list_filter = ("category", "is_active")
    inlines = [CopyInline]


@admin.register(Loan)
class LoanAdmin(admin.ModelAdmin):
    list_display = ("copy", "borrower_admission_no", "borrower_name", "issued_on", "due_on", "returned_on")
    search_fields = ("borrower_admission_no", "borrower_name", "copy__accession_no")
    raw_id_fields = ("copy", "student")


admin.site.register(BookCategory)
admin.site.register(Fine)
admin.site.register(LibrarySettings)
