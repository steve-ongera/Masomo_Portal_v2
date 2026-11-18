from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services


class MyEntitlementsView(APIView):
    """
    GET /api/v1/entitlements/me/   (any signed-in role)
    What the UI needs to hide, lock or upsell. Deliberately small: no usage numbers, no prices of
    other tenants. `all_open` is true in shadow mode so the UI never locks what the API still allows.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        snap = services.get_snapshot()
        if not snap:
            return Response({"all_open": True, "enforced": False, "tier": None, "tier_display": "", "gates": []})
        gates = [
            {
                "code": f["code"], "name": f["name"], "description": f["description"], "kind": f["kind"],
                "enabled": f["enabled"], "ui": f["ui"],
                "upgrade_to": f.get("upgrade_to"), "upgrade_price": f.get("upgrade_price"),
            }
            for f in snap["catalog"]
        ]
        return Response({
            "all_open": not services.enforcing(),
            "enforced": services.enforcing(),
            "tier": snap["tier"], "tier_display": snap["tier_display"],
            "valid_until": snap["valid_until"], "active": snap["active"],
            "gates": gates,
        })
