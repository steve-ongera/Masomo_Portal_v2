"""
python manage.py seed_procurement [--demo-users] [--password PW] [--force] [--reset --yes]

Fills the procurement module with realistic demo data so every page and chart has
something to show. Everything is created through the same service functions the
API uses, so statuses, numbers, approval logs, audit entries, stock and the
finance Expense postings are all genuine - not hand-forged rows.

  --demo-users   create demo_teacher / demo_principal / demo_procurement /
                 demo_finance / demo_storekeeper if no user has that role yet
  --password     password for those demo users (default Masomo@2026)
  --force        seed even though procurement documents already exist
  --reset --yes  delete ALL procurement documents (and the Expenses they posted)
                 first. Budgets and the approval chain are kept.

Scenarios seeded (dates are spread over the last 6 months so the charts have a trend):
  * Lab furniture: requisition -> approval -> RFQ -> 3 quotations -> documented
    selection -> PO (2-step approval) -> delivery with 1 damaged stool
    (partial) -> inspection -> matched invoice -> approved -> paid
  * 5 more fully paid purchase cycles across departments
  * invoice with a price discrepancy, an approved-but-unpaid overdue invoice,
    a delivery awaiting inspection, a PO awaiting approval, a PO awaiting delivery,
    a draft PO, plus a return, 3 contracts, and requisitions in every status
"""
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from api.models import AcademicYear, User
from procurement import models as m
from procurement import services as svc

DEMO_USERS = {
    "TEACHER": ("demo_teacher", "Tabitha", "Wanjiru"),
    "PRINCIPAL": ("demo_principal", "Peter", "Odhiambo"),
    "PROCUREMENT": ("demo_procurement", "Pauline", "Achieng"),
    "FINANCE": ("demo_finance", "Faith", "Mwangi"),
    "STAFF": ("demo_storekeeper", "Samuel", "Kiprop"),
}

SUPPLIERS = [
    ("ABC Educational Supplies", "Stationery & books", "Mary Njeri", "0711 000 101", "sales@abceducational.example"),
    ("Lab & Scientific Ltd", "Lab equipment", "Dennis Otieno", "0722 000 202", "orders@labscientific.example"),
    ("Mombasa Office Mart", "Office supplies", "Salma Hassan", "0733 000 303", "info@officemart.example"),
    ("Coast Furniture Works", "Furniture", "Juma Mwalimu", "0700 000 404", "coastfurniture@example.com"),
    ("Safi Cleaning Services", "Cleaning & hygiene", "Grace Atieno", "0744 000 505", "safi@cleaning.example"),
    ("Sportsline Kenya", "Sports equipment", "Brian Kimani", "0755 000 606", "team@sportsline.example"),
]

BUDGETS = {"Science": 600000, "Games": 250000, "Boarding": 400000, "Administration": 350000, "Library": 300000}


class _Req:
    """Minimal request stand-in so services.audit() records who did what."""
    META = {}

    def __init__(self, user):
        self.user = user


def d2(x):
    return Decimal(str(x)).quantize(Decimal("0.01"))


class Command(BaseCommand):
    help = "Seed realistic demo data for the procurement module."

    def add_arguments(self, p):
        p.add_argument("--demo-users", action="store_true", help="Create demo users for roles that have none.")
        p.add_argument("--password", default="Masomo@2026", help="Password for demo users.")
        p.add_argument("--force", action="store_true", help="Seed even if procurement documents already exist.")
        p.add_argument("--reset", action="store_true", help="Delete all procurement documents first (needs --yes).")
        p.add_argument("--yes", action="store_true", help="Confirm --reset.")

    # ------------------------------------------------------------ entry ---
    @transaction.atomic
    def handle(self, *a, **o):
        self.today = timezone.localdate()
        self.inv_counter = 0
        if o["reset"]:
            if not o["yes"]:
                raise CommandError("--reset deletes every procurement document. Re-run with --reset --yes to confirm.")
            self.reset()
        elif m.Requisition.objects.exists() and not o["force"]:
            raise CommandError("Procurement data already exists. Use --reset --yes to start over, or --force to add more.")

        self.year = AcademicYear.objects.filter(is_current=True).first()
        if not self.year:
            raise CommandError("No current academic year. Mark one as current in Academic Calendar first.")

        self.users = self.resolve_users(o["demo_users"], o["password"])
        self.seed_config()
        self.suppliers = self.seed_suppliers()
        self.seed_cycles()
        self.stdout.write(self.style.SUCCESS("\nProcurement demo data created."))
        self.summary()

    # ------------------------------------------------------------ reset ---
    def reset(self):
        expense_ids = list(m.SupplierInvoice.objects.exclude(expense_id=None).values_list("expense_id", flat=True))
        for model in (m.ProcurementReturn, m.SupplierInvoice, m.GoodsReceivedNote, m.PurchaseOrder, m.Quotation,
                      m.RFQ, m.Requisition, m.Contract, m.Supplier, m.ApprovalLog, m.AuditLog, m.DocumentSequence):
            model.objects.all().delete()
        try:
            from api.models import Expense
            Expense.objects.filter(pk__in=expense_ids).delete()
        except Exception:
            pass
        self.stdout.write("Existing procurement documents deleted.")

    # ------------------------------------------------------------ users ---
    def resolve_users(self, create_demo, password):
        users, missing = {}, []
        for role, (username, first, last) in DEMO_USERS.items():
            u = User.objects.filter(role=role, is_active=True).order_by("date_joined").first()
            if not u and create_demo:
                u = User.objects.create_user(username=username, password=password, role=role, first_name=first, last_name=last)
                self.stdout.write(f"  created demo user {username} ({role}) / {password}")
            if not u:
                missing.append(role)
            users[role] = u
        if missing:
            raise CommandError(
                f"No active user with role(s): {', '.join(missing)}. Create them, or re-run with --demo-users."
            )
        users["ADMIN"] = User.objects.filter(role="ADMIN", is_active=True).order_by("date_joined").first()
        return users

    def approver_for(self, role, owner_id):
        u = self.users.get(role)
        if u and u.pk != owner_id:
            return u
        admin = self.users.get("ADMIN")
        if admin and admin.pk != owner_id:
            return admin
        raise CommandError(f"Nobody with role {role} can approve (separation of duties). Add another {role} user.")

    # ----------------------------------------------------------- config ---
    def seed_config(self):
        if not m.ApprovalLevel.objects.filter(document_type="PR").exists():
            m.ApprovalLevel.objects.create(document_type="PR", order=1, role="PRINCIPAL")
        if not m.ApprovalLevel.objects.filter(document_type="PO").exists():
            m.ApprovalLevel.objects.create(document_type="PO", order=1, role="FINANCE")
            m.ApprovalLevel.objects.create(document_type="PO", order=2, role="PRINCIPAL")
        for dept, amount in BUDGETS.items():
            m.Budget.objects.get_or_create(academic_year=self.year, department=dept, defaults={"amount": amount})

    def seed_suppliers(self):
        out = {}
        for name, cat, contact, phone, email in SUPPLIERS:
            s, _ = m.Supplier.objects.get_or_create(
                name=name,
                defaults=dict(category=cat, contact_person=contact, phone=phone, email=email, address="Mombasa, Kenya",
                              kra_pin="P05" + str(abs(hash(name)) % 10**7).zfill(7) + "X", bank_name="Equity Bank",
                              bank_account=str(abs(hash(name + "acct")) % 10**10).zfill(10)),
            )
            out[name] = s
        return out

    # ---------------------------------------------------------- helpers ---
    def ago(self, days):
        return timezone.now() - timedelta(days=days)

    def make_pr(self, title, dept, items, stage="approved", months_ago=0, priority="NORMAL", reason=""):
        teacher = self.users["TEACHER"]
        pr = m.Requisition.objects.create(
            title=title, department=dept, requested_by=teacher, reason=reason, priority=priority, academic_year=self.year,
            required_by=self.today + timedelta(days=21 - months_ago * 30),
        )
        m.RequisitionItem.objects.bulk_create([
            m.RequisitionItem(requisition=pr, description=d, specification=s, quantity=q, unit=u, estimated_unit_cost=c)
            for d, s, q, u, c in items
        ])
        svc.recalc_requisition(pr)
        if stage != "draft":
            svc.submit_for_approval(pr, "PR", teacher, _Req(teacher))
        if stage == "rejected":
            approver = self.approver_for(svc.pending_role("PR", pr), teacher.pk)
            svc.decide(pr, "PR", approver, "REJECTED", "Specification unclear - please add brand and size, then resubmit.",
                       teacher.pk, _Req(approver))
        elif stage == "approved":
            self.approve_all(pr, "PR", teacher.pk)
        m.Requisition.objects.filter(pk=pr.pk).update(created_at=self.ago(months_ago * 30 + 4))
        pr.refresh_from_db()
        return pr

    def approve_all(self, doc, doc_type, owner_id):
        for _ in range(8):
            if doc.status != "PENDING_APPROVAL":
                break
            approver = self.approver_for(svc.pending_role(doc_type, doc), owner_id)
            try:
                svc.decide(doc, doc_type, approver, "APPROVED", "Approved", owner_id, _Req(approver))
            except ValidationError as e:
                self.stdout.write(self.style.WARNING(f"  {doc.number}: {e.detail}"))
                break

    def make_po(self, supplier, dept, items, stage="paid", months_ago=0, requisition=None, quotation=None,
                lead_days=7, receive=None, invoice_factor=1):
        """items = [(description, qty, unit, unit_price)]. receive = {item_index: (received, rejected, reason)}."""
        proc = self.users["PROCUREMENT"]
        store = self.users["STAFF"]
        order_date = self.today - timedelta(days=months_ago * 30)
        po = m.PurchaseOrder.objects.create(
            supplier=supplier, requisition=requisition, quotation=quotation, department=dept, created_by=proc,
            academic_year=self.year, order_date=order_date, expected_delivery=order_date + timedelta(days=lead_days),
            delivery_location="School Store",
        )
        m.POItem.objects.bulk_create([m.POItem(po=po, description=d, quantity=q, unit=u, unit_price=p) for d, q, u, p in items])
        svc.recalc_po(po)
        m.PurchaseOrder.objects.filter(pk=po.pk).update(created_at=self.ago(months_ago * 30))
        if stage == "draft":
            return po
        svc.submit_for_approval(po, "PO", proc, _Req(proc))
        if stage == "pending":
            return po
        self.approve_all(po, "PO", proc.pk)
        po.refresh_from_db()
        if stage == "approved" or po.status != "APPROVED":
            return po
        po.status, po.sent_at = "SENT", self.ago(max(months_ago * 30 - 1, 0))
        po.save(update_fields=["status", "sent_at"])
        if stage == "sent":
            return po

        # --- goods received note ---
        grn_date = min(order_date + timedelta(days=lead_days), self.today)
        grn = m.GoodsReceivedNote.objects.create(po=po, received_by=store, received_date=grn_date,
                                                 delivery_note_no=f"DN-{po.pk:04d}", notes="Delivered by supplier van")
        for i, it in enumerate(po.items.order_by("id")):
            rc, rj, why = (receive or {}).get(i, (it.quantity, 0, ""))
            m.GRNItem.objects.create(grn=grn, po_item=it, received_qty=rc, rejected_qty=rj, accepted_qty=rc - rj,
                                     rejection_reason=why)
        m.GoodsReceivedNote.objects.filter(pk=grn.pk).update(created_at=self.ago(max(months_ago * 30 - lead_days, 0)))
        svc.audit(_Req(store), "CREATE", grn)
        if stage == "grn_pending":
            return po
        svc.inspect_grn(grn, proc, "ACCEPTED", "Quantity, condition and specification checked.", _Req(proc))
        po.refresh_from_db()
        if stage == "received":
            return po

        # --- supplier invoice + 3-way match ---
        inv_date = min(grn_date + timedelta(days=3), self.today)
        self.inv_counter += 1
        inv = m.SupplierInvoice.objects.create(
            supplier=supplier, po=po, invoice_number=f"{supplier.name[:3].upper()}-{2600 + self.inv_counter}",
            invoice_date=inv_date, due_date=inv_date + timedelta(days=30), created_by=proc,
        )
        for it in po.items.all():
            if it.received_qty > 0:
                m.InvoiceItem.objects.create(invoice=inv, po_item=it, quantity=it.received_qty,
                                             unit_price=d2(it.unit_price * Decimal(str(invoice_factor))))
        svc.recalc_invoice(inv)
        svc.run_three_way_match(inv)
        svc.audit(_Req(proc), "CREATE", inv)
        if stage in ("invoiced", "discrepancy"):
            return po

        fin = self.users["FINANCE"]
        svc.approve_invoice(inv, fin, "Verified against PO and GRN.", _Req(fin))
        if stage == "invoice_approved":
            return po
        pay_day = min(inv_date + timedelta(days=12), self.today)
        svc.pay_invoice(inv, fin, "BANK", f"EFT{inv.pk:06d}", _Req(fin))
        m.SupplierInvoice.objects.filter(pk=inv.pk).update(
            paid_at=timezone.make_aware(timezone.datetime.combine(pay_day, timezone.datetime.min.time())) + timedelta(hours=10))
        if inv.expense_id:
            try:
                from api.models import Expense
                Expense.objects.filter(pk=inv.expense_id).update(expense_date=pay_day)
            except Exception:
                pass
        po.refresh_from_db()
        return po

    def make_rfq_with_quotes(self, pr, quotes, closes_in=10, send=True):
        """quotes = [(supplier_name, {item_index: unit_price}, delivery_days, warranty_months)]"""
        proc = self.users["PROCUREMENT"]
        rfq = m.RFQ.objects.create(title=pr.title, requisition=pr, issue_date=self.today - timedelta(days=45),
                                   closing_date=self.today + timedelta(days=closes_in), created_by=proc,
                                   notes="Please quote delivered to the school store, inclusive of VAT.")
        rfq_items = [m.RFQItem.objects.create(rfq=rfq, description=i.description, specification=i.specification,
                                              quantity=i.quantity, unit=i.unit) for i in pr.items.order_by("id")]
        rfq.suppliers.set([self.suppliers[n] for n, *_ in quotes])
        svc.audit(_Req(proc), "CREATE", rfq)
        if send:
            rfq.status = "SENT"
            rfq.save(update_fields=["status"])
            svc.audit(_Req(proc), "SENT", rfq)
        made = []
        for name, prices, days, warranty in quotes:
            q = m.Quotation.objects.create(rfq=rfq, supplier=self.suppliers[name], delivery_days=days, warranty_months=warranty)
            total = Decimal("0")
            for idx, price in prices.items():
                m.QuotationItem.objects.create(quotation=q, rfq_item=rfq_items[idx], unit_price=price)
                total += rfq_items[idx].quantity * Decimal(str(price))
            q.total_amount = total
            q.save(update_fields=["total_amount"])
            made.append(q)
        return rfq, made

    # --------------------------------------------------------- scenarios ---
    def seed_cycles(self):
        S, proc = self.suppliers, self.users["PROCUREMENT"]
        teacher = self.users["TEACHER"]

        # 1) the full showcase: requisition -> RFQ -> quotes -> evaluation -> PO -> partial delivery -> paid
        pr = self.make_pr("Additional laboratory furniture", "Science",
                          [("Laboratory stool", "Metal frame, adjustable height", 20, "pcs", 3000),
                           ("Laboratory table", "6-seater, acid-resistant top", 5, "pcs", 16000)],
                          stage="approved", months_ago=2, priority="HIGH", reason="Additional students joining Form 3 sciences.")
        rfq, quotes = self.make_rfq_with_quotes(pr, [
            ("ABC Educational Supplies", {0: 3100, 1: 16000}, 5, 12),
            ("Coast Furniture Works", {0: 2900, 1: 15000}, 10, 12),
            ("Lab & Scientific Ltd", {0: 3250, 1: 17000}, 3, 24)])
        chosen = quotes[0]
        chosen.is_selected = True
        chosen.evaluation_notes = ("ABC meets the specification and can deliver in 5 days, before term opening. Coast Furniture is "
                                   "cheapest but its 10-day lead time is too slow; Lab & Scientific is the most expensive.")
        chosen.save(update_fields=["is_selected", "evaluation_notes"])
        rfq.status = "AWARDED"
        rfq.save(update_fields=["status"])
        svc.audit(_Req(proc), "SELECT_QUOTATION", rfq, chosen.supplier.name)
        self.make_po(chosen.supplier, "Science",
                     [(i.rfq_item.description, i.rfq_item.quantity, i.rfq_item.unit, i.unit_price) for i in chosen.items.order_by("id")],
                     stage="paid", months_ago=2, requisition=pr, quotation=chosen, lead_days=5,
                     receive={0: (20, 1, "One stool delivered with a cracked seat")})

        # 2) five more complete cycles so the trend charts and supplier reports have history
        history = [
            (5, "Mombasa Office Mart", "Administration", "Office stationery restock",
             [("A4 photocopy paper", 200, "ream", 650), ("Printer toner HP 85A", 6, "pcs", 4800)]),
            (4, "Safi Cleaning Services", "Boarding", "Dormitory cleaning supplies",
             [("Liquid detergent 20L", 10, "drum", 3200), ("Heavy-duty mop", 30, "pcs", 450)]),
            (3, "Lab & Scientific Ltd", "Science", "Chemistry practical consumables",
             [("Beaker 250ml", 60, "pcs", 180), ("Bunsen burner", 12, "pcs", 2100)]),
            (2, "Sportsline Kenya", "Games", "Term 2 sports kit",
             [("Football size 5", 15, "pcs", 2400), ("Netball", 10, "pcs", 1900)]),
            (1, "ABC Educational Supplies", "Library", "Revision books",
             [("KCSE revision series", 120, "pcs", 850), ("Atlas", 25, "pcs", 1100)]),
        ]
        for months, sup, dept, title, items in history:
            hpr = self.make_pr(title, dept, [(d, "", q, u, p) for d, q, u, p in items], stage="approved", months_ago=months)
            self.make_po(S[sup], dept, items, stage="paid", months_ago=months, requisition=hpr, lead_days=6 + months)

        # 3) live work in progress, one of every state
        sports = self.make_po(S["Sportsline Kenya"], "Games", [("Training bibs (set of 12)", 8, "set", 1500), ("Cones (pack of 50)", 6, "pack", 900)],
                              stage="discrepancy", months_ago=1, lead_days=4, invoice_factor=1.1)
        gi = m.GRNItem.objects.filter(grn__po=sports, grn__status="ACCEPTED").first()
        if gi:
            ret = m.ProcurementReturn.objects.create(grn_item=gi, quantity=2, reason="Two sets arrived with torn stitching",
                                                     created_by=self.users["STAFF"])
            svc.audit(_Req(self.users["STAFF"]), "CREATE", ret)

        self.make_po(S["Coast Furniture Works"], "Boarding", [("Hostel mattress 3x6", 40, "pcs", 5200)],
                     stage="invoice_approved", months_ago=3, lead_days=14)             # approved but unpaid -> overdue
        self.make_po(S["Safi Cleaning Services"], "Boarding", [("Disinfectant 5L", 24, "pcs", 750)],
                     stage="grn_pending", months_ago=0, lead_days=3)                    # delivered, awaiting inspection
        self.make_po(S["Lab & Scientific Ltd"], "Science", [("Chemical reagents kit", 4, "kit", 18500)],
                     stage="sent", months_ago=0, lead_days=10)                          # awaiting delivery
        self.make_po(S["Mombasa Office Mart"], "Administration", [("Printer toner HP 85A", 4, "pcs", 4900)],
                     stage="pending", months_ago=0)                                     # awaiting approval
        self.make_po(S["ABC Educational Supplies"], "Library", [("Library shelving labels", 10, "pack", 350)],
                     stage="draft", months_ago=0)

        # requisitions in every status
        self.make_pr("Mattresses for new dormitory", "Boarding", [("Hostel mattress 3x6", "High-density foam", 30, "pcs", 5200)],
                     stage="pending", priority="URGENT", reason="New dormitory opens next term.")
        self.make_pr("Library reading tables", "Library", [("Reading table", "4-seater, laminated top", 6, "pcs", 9500)], stage="draft")
        self.make_pr("Projector for Form 4 class", "Administration", [("Projector", "", 1, "pcs", 55000)], stage="rejected")

        # an RFQ still collecting quotes
        pr2 = self.make_pr("Exam stationery term 3", "Administration",
                           [("Exam answer booklets", "32-page", 3000, "pcs", 22), ("Manila paper", "A1", 200, "sheet", 15)],
                           stage="approved", months_ago=0, priority="HIGH")
        self.make_rfq_with_quotes(pr2, [
            ("Mombasa Office Mart", {0: 21, 1: 14}, 4, 0),
            ("ABC Educational Supplies", {}, 5, 0),
            ("Sportsline Kenya", {}, 7, 0)], closes_in=6)
        m.Quotation.objects.filter(rfq__requisition=pr2, items__isnull=True).delete()   # only one supplier has replied so far

        # contracts
        for ref, title, sup, start, end, value, status in [
            ("CTR-2026-001", "Annual stationery supply", "ABC Educational Supplies", -150, 215, 600000, "ACTIVE"),
            ("CTR-2026-002", "Cleaning services & consumables", "Safi Cleaning Services", -335, 28, 360000, "ACTIVE"),
            ("CTR-2025-007", "Sports equipment framework", "Sportsline Kenya", -400, -40, 180000, "EXPIRED"),
        ]:
            m.Contract.objects.get_or_create(reference=ref, defaults=dict(
                title=title, supplier=S[sup], start_date=self.today + timedelta(days=start),
                end_date=self.today + timedelta(days=end), value=value, status=status))

    # ---------------------------------------------------------- summary ---
    def summary(self):
        rows = [("Suppliers", m.Supplier.objects.count()), ("Requisitions", m.Requisition.objects.count()),
                ("RFQs", m.RFQ.objects.count()), ("Quotations", m.Quotation.objects.count()),
                ("Purchase orders", m.PurchaseOrder.objects.count()), ("GRNs", m.GoodsReceivedNote.objects.count()),
                ("Supplier invoices", m.SupplierInvoice.objects.count()), ("Returns", m.ProcurementReturn.objects.count()),
                ("Contracts", m.Contract.objects.count()), ("Audit entries", m.AuditLog.objects.count())]
        for label, n in rows:
            self.stdout.write(f"  {label:<18}{n}")
        self.stdout.write("\nLog in as: " + ", ".join(f"{r}={u.username}" for r, u in self.users.items() if u))