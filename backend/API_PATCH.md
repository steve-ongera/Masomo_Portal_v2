# The one small change to the `api` app: a LIBRARIAN role

## api/models.py (2 edits in class User)

```python
class Role(models.TextChoices):
    ADMIN = "ADMIN", "Administrator"
    PRINCIPAL = "PRINCIPAL", "Principal"
    SECRETARY = "SECRETARY", "Secretary"
    TEACHER = "TEACHER", "Teacher"
    STUDENT = "STUDENT", "Student"
    PARENT = "PARENT", "Parent/Guardian"
    FINANCE = "FINANCE", "Finance Officer"
    LIBRARIAN = "LIBRARIAN", "Librarian"          # <-- add
```

```python
ROLES_REQUIRING_2FA = ("ADMIN", "PRINCIPAL", "SECRETARY", "TEACHER", "FINANCE", "LIBRARIAN")  # <-- add
```

Then: `python manage.py makemigrations api && python manage.py migrate`
This only records the new choice on `users.role`. No table or column changes.

Nothing else in `api` needs editing:
- The Users admin screen / UserCreateSerializer pick the new role up from Role.choices.
- Notifications and Communications already work for any authenticated role.
- With 2FA on (DEBUG off), a librarian needs an email address on their account for the login code.
