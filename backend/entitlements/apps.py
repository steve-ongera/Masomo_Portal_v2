from django.apps import AppConfig


class EntitlementsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "entitlements"

    def ready(self):
        from . import signals
        signals.connect()
