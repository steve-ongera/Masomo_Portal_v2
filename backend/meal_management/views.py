#meal_management/views.py
import uuid

from django.conf import settings
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api import models as api_models

from . import models, mpesa, serializers, services
from .permissions import IsMealAdmin, IsMealFinance, IsMealOperator, IsMealViewer


class MealPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 1000


def _date_param(request, name="date"):
    raw = request.query_params.get(name)
    return parse_date(raw) if raw else None


# ---------------------------------------------------------------------------
# plans & assignment
# ---------------------------------------------------------------------------
class MealPlanViewSet(viewsets.ModelViewSet):
    queryset = models.MealPlan.objects.prefetch_related("items").all()
    serializer_class = serializers.MealPlanSerializer
    filterset_fields = ["is_active", "billing_mode"]
    filter_backends = [DjangoFilterBackend]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsMealViewer()]
        return [IsMealAdmin()]

    def destroy(self, request, *args, **kwargs):
        """A plan that students are assigned to cannot be deleted (it is PROTECTed)."""
        plan = self.get_object()
        in_use = plan.student_plans.count()
        if in_use:
            return Response(
                {"detail": (
                    f'"{plan.name}" is assigned to {in_use} student(s) and cannot be deleted. '
                    "Move them to another plan or remove them first, or mark the plan inactive instead."
                )},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": f'"{plan.name}" is still in use and cannot be deleted. Mark it inactive instead.'},
                status=status.HTTP_400_BAD_REQUEST,
            )


class StudentMealPlanViewSet(viewsets.ModelViewSet):
    queryset = models.StudentMealPlan.objects.select_related("student__user", "plan", "academic_year").all()
    serializer_class = serializers.StudentMealPlanSerializer
    permission_classes = [IsMealAdmin]
    pagination_class = MealPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["academic_year", "plan", "student", "is_active"]
    search_fields = ["student__admission_no", "student__user__first_name", "student__user__last_name"]

    def perform_create(self, serializer):
        serializer.save()

    @action(detail=False, methods=["post"])
    def bulk_assign(self, request):
        """POST { plan_id, academic_year_id, classroom_id | grade_level_id } - ACTIVE students only."""
        s = serializers.BulkAssignPlanSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data

        # d["plan_id"] is already a MealPlan instance (PrimaryKeyRelatedField);
        # the other three are plain integers (IntegerField).
        plan = d["plan_id"]
        year = get_object_or_404(api_models.AcademicYear, pk=d["academic_year_id"])

        enrollments = api_models.Enrollment.objects.filter(
            academic_year=year, status=api_models.Enrollment.Status.ACTIVE
        )
        if d.get("classroom_id"):
            enrollments = enrollments.filter(classroom_id=d["classroom_id"])
        if d.get("grade_level_id"):
            enrollments = enrollments.filter(classroom__grade_level_id=d["grade_level_id"])

        count = 0
        for student_id in enrollments.values_list("student_id", flat=True).distinct():
            models.StudentMealPlan.objects.update_or_create(
                student_id=student_id, academic_year=year,
                defaults={"plan": plan, "is_active": True, "assigned_by": request.user},
            )
            count += 1
        return Response({"assigned": count})


# ---------------------------------------------------------------------------
# cards
# ---------------------------------------------------------------------------
class MealCardViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = models.MealCard.objects.select_related("student__user").all()
    serializer_class = serializers.MealCardSerializer
    pagination_class = MealPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["status", "student"]
    search_fields = ["card_number", "student__admission_no", "student__user__first_name", "student__user__last_name"]

    # The cafeteria desk (Admin, Secretary, CAFETERIA role, explicit attendants -
    # see IsMealOperator) can view, issue and print cards. Changing a card's
    # status (block / lose / replace) stays admin-only. To let cafeteria do that
    # too, add "set_status" to this set.
    DESK_ACTIONS = {"list", "retrieve", "issue", "issue_bulk", "qr", "class_sheet"}

    def get_permissions(self):
        if self.action in self.DESK_ACTIONS:
            return [IsMealOperator()]
        return [IsMealAdmin()]

    @action(detail=False, methods=["post"])
    def issue(self, request):
        """POST { student_id } - issues a card; any current active card becomes REPLACED."""
        student = get_object_or_404(api_models.StudentProfile, pk=request.data.get("student_id"))
        card = services.issue_card(student, issued_by=request.user)
        data = serializers.MealCardSerializer(card).data
        data["qr_code_base64"] = services.qr_base64(card.qr_token)
        # classroom for the printed card (blank if the student has no active enrollment)
        _, enrollment = services._student_block(student, services.year_for(timezone.localdate()))
        data["classroom"] = str(enrollment.classroom) if enrollment else ""
        return Response(data, status=201)

    @action(detail=False, methods=["post"])
    def issue_bulk(self, request):
        """POST { classroom_id } - cards for every ACTIVE student in the class who has no active card."""
        classroom = get_object_or_404(api_models.ClassRoom, pk=request.data.get("classroom_id"))
        has_card = set(
            models.MealCard.objects.filter(status=models.MealCard.Status.ACTIVE).values_list("student_id", flat=True)
        )
        students = api_models.StudentProfile.objects.filter(
            enrollments__classroom=classroom, enrollments__status=api_models.Enrollment.Status.ACTIVE,
            is_active=True,
        ).distinct()
        created = [services.issue_card(s, issued_by=request.user) for s in students if s.id not in has_card]
        return Response({"created": len(created)}, status=201)

    @action(detail=True, methods=["post"])
    def set_status(self, request, pk=None):
        card = self.get_object()
        try:
            services.set_card_status(card, request.data.get("status"))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(serializers.MealCardSerializer(card).data)

    @action(detail=True, methods=["get"])
    def qr(self, request, pk=None):
        card = self.get_object()
        return Response({"card_number": card.card_number, "qr_code_base64": services.qr_base64(card.qr_token)})

    @action(detail=False, methods=["get"])
    def class_sheet(self, request):
        """GET ?classroom=<id> - every ACTIVE card in a class with its QR image, for printing."""
        classroom = get_object_or_404(api_models.ClassRoom, pk=request.query_params.get("classroom"))
        cards = models.MealCard.objects.filter(
            status=models.MealCard.Status.ACTIVE,
            student__enrollments__classroom=classroom,
            student__enrollments__status=api_models.Enrollment.Status.ACTIVE,
        ).select_related("student__user").order_by("student__user__first_name").distinct()
        return Response({
            "classroom": str(classroom),
            "cards": [
                {
                    "card_number": c.card_number,
                    "name": c.student.user.get_full_name(),
                    "admission_no": c.student.admission_no,
                    "classroom": str(classroom),
                    "issued_at": c.issued_at,
                    "qr_code_base64": services.qr_base64(c.qr_token),
                }
                for c in cards
            ],
        })


# ---------------------------------------------------------------------------
# scan desk
# ---------------------------------------------------------------------------
def _with_wallet(card, payload):
    """
    Make sure the scan desk always gets the student's wallet balance, even when the
    meal is refused for some other reason (not in plan, card blocked, already
    collected...). Shown for wallet-billed students or anyone who has a wallet.
    """
    wallet = models.MealWallet.objects.filter(student=card.student).first()
    if wallet or payload.get("billing_mode") == models.MealPlan.Billing.WALLET:
        payload["wallet_balance"] = str(wallet.balance) if wallet else "0.00"
        payload["overdraft_limit"] = str(services.overdraft_limit())
    return payload


class ScanView(APIView):
    """
    POST { qr_token, meal_type } - look up + eligibility. Changes nothing.

    `qr_token` may be the QR token, the printed card number, or the student's
    admission number (see services.resolve_card).

    An unknown code is answered with HTTP 200 and found=false (not a 404), so
    a typo is a normal desk result instead of a red "404" in the browser console.
    A card that IS found always comes back with the student's details and wallet
    balance, whatever the eligibility result.
    """

    permission_classes = [IsMealOperator]

    def post(self, request):
        s = serializers.ScanSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        card = services.resolve_card(s.validated_data["qr_token"])
        if not card:
            return Response({
                "found": False, "eligible": False,
                "reason": "Card not recognised. Check the card number or admission number.",
            })
        payload = services.check_eligibility(card, s.validated_data["meal_type"])
        return Response(_with_wallet(card, payload))


class IssueMealView(APIView):
    """POST { qr_token, meal_type } - records the meal as collected."""

    permission_classes = [IsMealOperator]

    def post(self, request):
        s = serializers.ScanSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        card = services.resolve_card(s.validated_data["qr_token"])
        if not card:
            return Response({"found": False, "reason": "Card not recognised."}, status=404)
        try:
            collection, _ = services.issue_meal(card, s.validated_data["meal_type"], request.user)
        except services.MealNotAllowed as exc:
            return Response(_with_wallet(card, exc.check), status=409)
        return Response(
            {
                "issued": True,
                "student_name": card.student.user.get_full_name(),
                "meal_label": services.MEAL_LABELS[collection.meal_type],
                "collected_at": collection.collected_at,
                "amount_charged": str(collection.amount_charged),
            },
            status=201,
        )


class SyncView(APIView):
    """POST { scans: [{client_uuid, qr_token, meal_type, scanned_at}] } - upload offline scans."""

    permission_classes = [IsMealOperator]

    def post(self, request):
        s = serializers.SyncSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        return Response({"results": services.sync_offline(s.validated_data["scans"], request.user)})


class RosterView(APIView):
    """GET - today's offline roster for the tablet (tokens + entitlements)."""

    permission_classes = [IsMealOperator]

    def get(self, request):
        return Response(services.build_roster(timezone.localdate()))


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------
class DashboardView(APIView):
    permission_classes = [IsMealViewer]

    def get(self, request):
        return Response(services.dashboard(_date_param(request) or timezone.localdate()))


class MissingView(APIView):
    """GET ?date=&meal_type= - entitled students who have not collected yet."""

    permission_classes = [IsMealViewer]

    def get(self, request):
        meal_type = request.query_params.get("meal_type")
        if meal_type not in services.MEAL_LABELS:
            return Response({"detail": "meal_type is required."}, status=400)
        on_date = _date_param(request) or timezone.localdate()
        return Response({"date": on_date, "meal_type": meal_type, "students": services.missing_students(on_date, meal_type)})


class MealCollectionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = models.MealCollection.objects.select_related("student__user", "collected_by").all()
    serializer_class = serializers.MealCollectionSerializer
    permission_classes = [IsMealViewer]
    pagination_class = MealPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = {"date": ["exact", "gte", "lte"], "meal_type": ["exact"], "student": ["exact"], "source": ["exact"]}
    search_fields = ["student__admission_no", "student__user__first_name", "student__user__last_name"]

    @action(detail=True, methods=["post"], permission_classes=[IsMealAdmin])
    def undo(self, request, pk=None):
        """Admin correction: removes the collection (and refunds the wallet if it was charged)."""
        services.undo_collection(self.get_object(), request.user)
        return Response({"detail": "Collection removed."})


# ---------------------------------------------------------------------------
# wallet
# ---------------------------------------------------------------------------
class WalletView(APIView):
    """GET ?admission_no= - balance + recent transactions."""

    permission_classes = [IsMealFinance]

    def get(self, request):
        student = get_object_or_404(api_models.StudentProfile, admission_no=request.query_params.get("admission_no"))
        wallet = models.MealWallet.objects.filter(student=student).first()
        txns = wallet.transactions.all()[:50] if wallet else []
        return Response({
            "student_name": student.user.get_full_name(),
            "admission_no": student.admission_no,
            "balance": str(wallet.balance) if wallet else "0.00",
            "transactions": serializers.WalletTransactionSerializer(txns, many=True).data,
        })


class WalletTopUpView(APIView):
    """POST { admission_no, amount, reference? } - office/finance credits a wallet (e.g. after a phone call)."""

    permission_classes = [IsMealFinance]

    def post(self, request):
        s = serializers.WalletTopUpSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        student = get_object_or_404(api_models.StudentProfile, admission_no=d["admission_no"])
        try:
            wallet = services.topup_wallet(student, d["amount"], request.user, d.get("reference", ""))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"balance": str(wallet.balance)}, status=201)


# ---------------------------------------------------------------------------
# attendants
# ---------------------------------------------------------------------------
class CafeteriaAttendantViewSet(viewsets.ModelViewSet):
    queryset = models.CafeteriaAttendant.objects.select_related("user").all()
    serializer_class = serializers.CafeteriaAttendantSerializer
    permission_classes = [IsMealAdmin]


# ---------------------------------------------------------------------------
# student / parent view
# ---------------------------------------------------------------------------
def _portal_student(request):
    user = request.user
    student = getattr(user, "student_profile", None)
    if student:
        return student
    if user.role == api_models.User.Role.PARENT:
        sid = request.query_params.get("student_id")
        links = api_models.ParentStudentLink.objects.filter(parent__user=user).select_related("student__user")
        link = links.filter(student_id=sid).first() if sid else links.first()
        return link.student if link else None
    return None


class MyMealsView(APIView):
    """GET /meals/my/ (parents: ?student_id=) - own card + QR, plan, today's meals, wallet."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        student = _portal_student(request)
        if not student:
            return Response({"detail": "No student profile found for this account."}, status=404)
        return Response(services.my_meals(student))


class WalletPayView(APIView):
    """POST { amount, phone } (parents: ?student_id=) - starts an M-Pesa STK push into the meal wallet."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        student = _portal_student(request)
        if not student:
            return Response({"detail": "No student profile found for this account."}, status=404)
        s = serializers.WalletPaySerializer(data=request.data)
        s.is_valid(raise_exception=True)
        phone = mpesa.normalize_phone(s.validated_data["phone"])
        if not phone:
            return Response({"detail": "Enter a valid Safaricom number, e.g. 0712345678."}, status=400)

        payment = models.MealWalletPayment.objects.create(
            student=student, initiated_by=request.user, phone=phone, amount=s.validated_data["amount"]
        )

        # DEV ONLY: skip M-Pesa and credit the wallet straight away.
        # Runs only when DEBUG is True. Set MEAL_MPESA_DEV_BYPASS = False in settings
        # to test the real STK flow in development.
        if settings.DEBUG and getattr(settings, "MEAL_MPESA_DEV_BYPASS", True):
            payment.checkout_request_id = f"DEV-{uuid.uuid4().hex[:16]}"
            payment.save(update_fields=["checkout_request_id"])
            services.complete_wallet_payment(
                payment.id, f"DEV{payment.id:06d}", True, "Dev bypass", payment.amount
            )
            return Response({"checkout_request_id": payment.checkout_request_id}, status=201)

        callback = getattr(settings, "MEAL_MPESA_CALLBACK_URL", None) or request.build_absolute_uri(
            "/api/v1/meals/wallet/mpesa-callback/"
        )
        try:
            data = mpesa.stk_push(phone, payment.amount, student.admission_no, "Meal wallet", callback)
        except Exception as exc:  # noqa: BLE001
            payment.status = models.MealWalletPayment.Status.FAILED
            payment.result_desc = str(exc)[:255]
            payment.save(update_fields=["status", "result_desc"])
            return Response(
                {"detail": "Could not start the M-Pesa request. Try again or pay to the till."}, status=502
            )

        payment.checkout_request_id = data["CheckoutRequestID"]
        payment.save(update_fields=["checkout_request_id"])
        return Response({"checkout_request_id": payment.checkout_request_id}, status=201)


class WalletPayStatusView(APIView):
    """GET - the frontend polls this until the STK push is paid or fails."""

    permission_classes = [IsAuthenticated]

    def get(self, request, checkout_id):
        student = _portal_student(request)
        payment = get_object_or_404(models.MealWalletPayment, checkout_request_id=checkout_id, student=student)
        return Response(
            {"status": payment.status, "reason": payment.result_desc, "receipt": payment.mpesa_receipt}
        )


class MpesaWalletCallbackView(APIView):
    """
    Safaricom posts the STK result here. Public by nature, but it can only credit a
    PENDING payment whose checkout id this server created, and only once.
    Consider restricting this URL to Safaricom's IP ranges in nginx.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        cb = (request.data.get("Body") or {}).get("stkCallback") or {}
        payment = models.MealWalletPayment.objects.filter(checkout_request_id=cb.get("CheckoutRequestID")).first()
        if payment:
            ok = cb.get("ResultCode") == 0
            receipt, paid = "", None
            if ok:
                items = {i.get("Name"): i.get("Value") for i in (cb.get("CallbackMetadata") or {}).get("Item", [])}
                receipt = str(items.get("MpesaReceiptNumber", ""))
                paid = items.get("Amount")
            services.complete_wallet_payment(payment.id, receipt, ok, cb.get("ResultDesc", ""), paid)
        return Response({"ResultCode": 0, "ResultDesc": "Accepted"})