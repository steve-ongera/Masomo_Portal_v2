"""Thin views: parse the request, call library.services, return a Response."""
from django.db.models import Count, Q
from django.utils.dateparse import parse_date
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import serializers, services
from .models import Book, BookCategory, BookCopy, Fine, LibrarySettings, Loan
from .permissions import IsLibrarian


class Pager(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 500


class LibrarianView(APIView):
    permission_classes = [IsLibrarian]


# ---------------------------------------------------------------------------
# CATALOGUE (everyone signed in can browse; only librarians change it)
# ---------------------------------------------------------------------------
class CategoryViewSet(viewsets.ModelViewSet):
    queryset = BookCategory.objects.all()
    serializer_class = serializers.CategorySerializer
    pagination_class = None

    def get_permissions(self):
        return [IsAuthenticated()] if self.action in ("list", "retrieve") else [IsLibrarian()]


class BookViewSet(viewsets.ModelViewSet):
    serializer_class = serializers.BookSerializer
    pagination_class = Pager

    def get_permissions(self):
        return [IsAuthenticated()] if self.action in ("list", "retrieve") else [IsLibrarian()]

    def get_queryset(self):
        qs = (
            Book.objects.select_related("category", "subject", "grade_level")
            .annotate(
                total_copies=Count("copies", filter=~Q(copies__status=BookCopy.Status.WITHDRAWN)),
                available_copies=Count("copies", filter=Q(copies__status=BookCopy.Status.AVAILABLE)),
            )
            .order_by("title")
        )
        if self.request.user.role not in ("LIBRARIAN", "ADMIN"):
            qs = qs.filter(is_active=True)
        p = self.request.query_params
        if p.get("q"):
            q = p["q"]
            qs = qs.filter(Q(title__icontains=q) | Q(author__icontains=q) | Q(isbn__icontains=q) | Q(copies__accession_no__iexact=q)).distinct()
        for field in ("category", "subject", "grade_level"):
            if p.get(field):
                qs = qs.filter(**{f"{field}_id": p[field]})
        if p.get("available") in ("1", "true"):
            qs = qs.filter(available_copies__gt=0)
        return qs

    def perform_create(self, serializer):
        copies = serializer.validated_data.pop("copies", 1)
        book = serializer.save()
        if copies:
            services.add_copies(book, copies)

    def perform_update(self, serializer):
        serializer.validated_data.pop("copies", None)
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        book = self.get_object()
        if Loan.objects.filter(copy__book=book).exists():
            return Response(
                {"detail": "This title has loan history, so it can't be deleted. Untick Active to hide it instead."},
                status=400,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"])
    def copies(self, request, pk=None):
        copies = BookCopy.objects.filter(book_id=pk).prefetch_related("loans")
        return Response(serializers.CopySerializer(copies, many=True).data)

    @action(detail=True, methods=["post"])
    def add_copies(self, request, pk=None):
        s = serializers.AddCopiesSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        numbers = services.add_copies(self.get_object(), s.validated_data["count"])
        return Response({"added": numbers}, status=201)


class CopyStatusView(LibrarianView):
    def post(self, request, pk):
        s = serializers.CopyStatusSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        copy = generics.get_object_or_404(BookCopy, pk=pk)
        services.set_copy_status(copy, s.validated_data["status"])
        return Response(serializers.CopySerializer(copy).data)


# ---------------------------------------------------------------------------
# DESK: students, issue, return, renew
# ---------------------------------------------------------------------------
class StudentSearchView(LibrarianView):
    def get(self, request):
        return Response(services.search_students(request.query_params.get("q")))


class IssueView(LibrarianView):
    def post(self, request):
        s = serializers.IssueSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        loan = services.issue_book(request.user, d["admission_no"], d["accession_no"], d.get("due_on"))
        loan = Loan.objects.select_related("copy__book", "issued_by").get(pk=loan.pk)
        return Response(services.loan_dict(loan), status=201)


class ReturnView(LibrarianView):
    def post(self, request):
        s = serializers.ReturnSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        loan, fines = services.return_book(
            request.user, d["accession_no"], d["condition"], d.get("fine_amount"), d.get("note", "")
        )
        loan = Loan.objects.select_related("copy__book", "issued_by").get(pk=loan.pk)
        return Response({"loan": services.loan_dict(loan), "fines": [services.fine_dict(f) for f in Fine.objects.filter(pk__in=[f.pk for f in fines]).select_related("loan__copy__book")]})


class ReturnPreviewView(LibrarianView):
    """GET /library/return-preview/?accession_no= - what a return would look like, before confirming."""

    def get(self, request):
        acc = (request.query_params.get("accession_no") or "").strip().upper()
        loan = Loan.objects.filter(copy__accession_no=acc, returned_on__isnull=True).select_related("copy__book", "issued_by").first()
        if not loan:
            raise services.LibraryError("This copy isn't on loan, or the accession number is wrong.")
        data = services.loan_dict(loan)
        data["book_price"] = loan.copy.book.price
        return Response(data)


class LoanViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsLibrarian]
    pagination_class = Pager

    def get_queryset(self):
        p = self.request.query_params
        return services.filter_loans(
            Loan.objects.all(), p.get("status"), p.get("q"),
            parse_date(p["date_from"]) if p.get("date_from") else None,
            parse_date(p["date_to"]) if p.get("date_to") else None,
        )

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([services.loan_dict(l) for l in page])

    @action(detail=True, methods=["post"])
    def renew(self, request, pk=None):
        loan = services.renew_loan(self.get_object())
        loan = Loan.objects.select_related("copy__book", "issued_by").get(pk=loan.pk)
        return Response(services.loan_dict(loan))


# ---------------------------------------------------------------------------
# FINES
# ---------------------------------------------------------------------------
class FineViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsLibrarian]
    pagination_class = Pager

    def get_queryset(self):
        qs = Fine.objects.select_related("loan__copy__book")
        p = self.request.query_params
        if p.get("status"):
            qs = qs.filter(status=p["status"])
        if p.get("q"):
            q = p["q"]
            qs = qs.filter(Q(loan__borrower_name__icontains=q) | Q(loan__borrower_admission_no__icontains=q) | Q(loan__copy__book__title__icontains=q))
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        resp = self.get_paginated_response([services.fine_dict(f) for f in page])
        from django.db.models import Sum
        resp.data["unpaid_total"] = Fine.objects.filter(status="UNPAID").aggregate(t=Sum("amount"))["t"] or 0
        return resp

    def _settle(self, request, action_name):
        s = serializers.SettleSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        fine = services.settle_fine(request.user, self.get_object(), action_name, s.validated_data.get("note", ""))
        return Response(services.fine_dict(fine))

    @action(detail=True, methods=["post"])
    def pay(self, request, pk=None):
        return self._settle(request, "PAY")

    @action(detail=True, methods=["post"])
    def waive(self, request, pk=None):
        return self._settle(request, "WAIVE")


# ---------------------------------------------------------------------------
# DASHBOARD, REPORTS, SETTINGS
# ---------------------------------------------------------------------------
class DashboardView(LibrarianView):
    def get(self, request):
        return Response(services.dashboard())


class OverdueReportView(LibrarianView):
    def get(self, request):
        return Response(services.report_overdue())


class PopularReportView(LibrarianView):
    def get(self, request):
        p = request.query_params
        return Response(services.report_popular(
            parse_date(p["date_from"]) if p.get("date_from") else None,
            parse_date(p["date_to"]) if p.get("date_to") else None,
        ))


class StockReportView(LibrarianView):
    def get(self, request):
        return Response(services.report_stock())


class RemindOverdueView(LibrarianView):
    def post(self, request):
        return Response(services.remind_overdue(request.user))


class SettingsView(LibrarianView):
    def get(self, request):
        return Response(serializers.SettingsSerializer(LibrarySettings.get()).data)

    def patch(self, request):
        s = serializers.SettingsSerializer(LibrarySettings.get(), data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)


class MyLibraryView(APIView):
    """GET /library/my/?student_id= - a learner's own loans, or a parent's child's."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(services.my_library(request.user, request.query_params.get("student_id")))
