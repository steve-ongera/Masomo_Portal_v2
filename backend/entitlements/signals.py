from django.db.models.signals import m2m_changed, post_delete, post_save

from . import services
from .models import Feature, LicenseFeatureOverride


def _invalidate(sender, **kwargs):
    services.invalidate()


def connect():
    from api.models import License, SubscriptionPackage

    for model in (License, SubscriptionPackage, Feature, LicenseFeatureOverride):
        post_save.connect(_invalidate, sender=model, weak=False, dispatch_uid=f"ent-save-{model.__name__}")
        post_delete.connect(_invalidate, sender=model, weak=False, dispatch_uid=f"ent-del-{model.__name__}")
    m2m_changed.connect(_invalidate, sender=Feature.packages.through, weak=False, dispatch_uid="ent-m2m-packages")
