"""
entitlements/models.py

Additive only: this app references api.SubscriptionPackage and api.License by
foreign key and never alters an existing table.

  Feature                 one row per sellable capability (portal, module, action, service)
  Feature.packages        which plans include it  -> edited in Django Admin, no deploy
  LicenseFeatureOverride  per-school grant/revoke (add-ons, free previews, special deals)
"""
from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

code_validator = RegexValidator(r"^[a-z0-9_.]+$", "Lowercase letters, digits, underscore and dot only.")


class Feature(models.Model):
    class Kind(models.TextChoices):
        PORTAL = "PORTAL", "Portal (role login)"
        MODULE = "MODULE", "Module (pages + API)"
        ACTION = "ACTION", "Action inside a page"
        SERVICE = "SERVICE", "Service / support benefit"

    code = models.CharField(max_length=60, unique=True, validators=[code_validator])
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.MODULE)

    api_prefixes = models.JSONField(
        default=list, blank=True,
        help_text='API paths this feature owns, relative to /api/v1/, e.g. ["library/"]. '
                  "Requests under them are blocked when the plan lacks the feature.",
    )
    ui_prefixes = models.JSONField(
        default=list, blank=True,
        help_text='Frontend routes this feature owns, e.g. ["/librarian", "/student/library"].',
    )
    roles = models.JSONField(
        default=list, blank=True,
        help_text='PORTAL features only: user roles this portal lets in, e.g. ["STUDENT", "PARENT"].',
    )

    packages = models.ManyToManyField(
        "api.SubscriptionPackage", blank=True, related_name="plan_features",
        help_text="Plans that include this feature.",
    )
    is_core = models.BooleanField(default=False, help_text="Always on, whatever the plan (e.g. admin portal).")
    is_active = models.BooleanField(default=True, help_text="Untick to switch the feature off for everyone.")
    display_order = models.PositiveSmallIntegerField(default=100)

    class Meta:
        db_table = "ent_features"
        ordering = ["display_order", "code"]

    def __str__(self):
        return f"{self.name} [{self.code}]"


class LicenseFeatureOverride(models.Model):
    class Mode(models.TextChoices):
        GRANT = "GRANT", "Grant (even if the plan lacks it)"
        REVOKE = "REVOKE", "Revoke (even if the plan has it)"

    license = models.ForeignKey("api.License", on_delete=models.CASCADE, related_name="feature_overrides")
    feature = models.ForeignKey(Feature, on_delete=models.CASCADE, related_name="overrides")
    mode = models.CharField(max_length=10, choices=Mode.choices, default=Mode.GRANT)
    expires_at = models.DateTimeField(
        null=True, blank=True, help_text="Blank = permanent. Set a date for a free preview / trial of a feature."
    )
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "ent_license_feature_overrides"
        unique_together = ("license", "feature")

    def __str__(self):
        return f"{self.license} {self.mode} {self.feature.code}"
