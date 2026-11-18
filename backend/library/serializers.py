from rest_framework import serializers

from .models import Book, BookCategory, BookCopy, LibrarySettings, Loan


class CategorySerializer(serializers.ModelSerializer):
    book_count = serializers.SerializerMethodField()

    class Meta:
        model = BookCategory
        fields = ["id", "name", "book_count"]

    def get_book_count(self, obj):
        return obj.books.count()


class BookSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    subject_name = serializers.CharField(source="subject.name", read_only=True, default=None)
    grade_level_name = serializers.CharField(source="grade_level.name", read_only=True, default=None)
    total_copies = serializers.IntegerField(read_only=True)
    available_copies = serializers.IntegerField(read_only=True)
    # write-only: how many physical copies to register when creating a title
    copies = serializers.IntegerField(write_only=True, required=False, min_value=0, max_value=500, default=1)

    class Meta:
        model = Book
        fields = [
            "id", "title", "author", "isbn", "publisher", "publication_year", "edition",
            "category", "category_name", "subject", "subject_name", "grade_level", "grade_level_name",
            "shelf_location", "price", "description", "is_active",
            "total_copies", "available_copies", "copies",
        ]


class CopySerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    borrower = serializers.SerializerMethodField()

    class Meta:
        model = BookCopy
        fields = ["id", "accession_no", "status", "status_display", "notes", "acquired_on", "borrower"]

    def get_borrower(self, obj):
        loan = obj.loans.filter(returned_on__isnull=True).first()
        return {"name": loan.borrower_name, "admission_no": loan.borrower_admission_no, "due_on": loan.due_on} if loan else None


class AddCopiesSerializer(serializers.Serializer):
    count = serializers.IntegerField(min_value=1, max_value=200)


class CopyStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=BookCopy.Status.choices)


class IssueSerializer(serializers.Serializer):
    admission_no = serializers.CharField(max_length=30)
    accession_no = serializers.CharField(max_length=30)
    due_on = serializers.DateField(required=False, allow_null=True)


class ReturnSerializer(serializers.Serializer):
    accession_no = serializers.CharField(max_length=30)
    condition = serializers.ChoiceField(choices=Loan.Condition.choices, default="GOOD")
    fine_amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, min_value=0)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class SettleSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class SettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = LibrarySettings
        exclude = ["id"]
        read_only_fields = ["updated_at"]
