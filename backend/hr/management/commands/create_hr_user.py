from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create an HR login: python manage.py create_hr_user <username> <password> [--name 'Jane Doe']"

    def add_arguments(self, p):
        p.add_argument("username")
        p.add_argument("password")
        p.add_argument("--name", default="")

    def handle(self, *a, **o):
        User = get_user_model()
        first, _, last = o["name"].partition(" ")
        u, created = User.objects.get_or_create(username=o["username"], defaults={
            "role": "HR", "first_name": first, "last_name": last})
        u.role = "HR"
        u.set_password(o["password"])
        u.save()
        self.stdout.write(self.style.SUCCESS(f"HR user {'created' if created else 'updated'}: {u.username}"))
