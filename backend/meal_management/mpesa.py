"""
meal_management/mpesa.py - STK push for meal wallet top-ups, paid to the school till.

If you already have an STK helper in the `api` app, you can call that from
WalletPayView instead and delete this file. It only needs these settings:

    MPESA_ENV              = "production" | "sandbox"
    MPESA_CONSUMER_KEY     = "..."
    MPESA_CONSUMER_SECRET  = "..."
    MEAL_MPESA_SHORTCODE   = "..."   # the Store / Head Office number used to build the password
    MEAL_MPESA_PASSKEY     = "..."
    MEAL_PAY_TILL          = "56353" # the till customers pay to (PartyB)
    MEAL_MPESA_CALLBACK_URL= "https://<your-domain>/api/v1/meals/wallet/mpesa-callback/"
"""
import base64
import re
from datetime import datetime

import requests
from django.conf import settings


def _base():
    return (
        "https://api.safaricom.co.ke"
        if getattr(settings, "MPESA_ENV", "sandbox") == "production"
        else "https://sandbox.safaricom.co.ke"
    )


def _token():
    r = requests.get(
        f"{_base()}/oauth/v1/generate?grant_type=client_credentials",
        auth=(settings.MPESA_CONSUMER_KEY, settings.MPESA_CONSUMER_SECRET),
        timeout=20,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def normalize_phone(raw):
    """0712345678 / +254712345678 / 254712345678 -> 254712345678, or None if invalid."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif len(digits) == 9 and digits[0] in "17":
        digits = "254" + digits
    return digits if re.fullmatch(r"254[17]\d{8}", digits) else None


def pay_till():
    return str(getattr(settings, "MEAL_PAY_TILL", "56353"))


def stk_push(phone, amount, account_ref, description, callback_url):
    shortcode = settings.MEAL_MPESA_SHORTCODE
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    password = base64.b64encode(f"{shortcode}{settings.MEAL_MPESA_PASSKEY}{stamp}".encode()).decode()
    payload = {
        "BusinessShortCode": shortcode,
        "Password": password,
        "Timestamp": stamp,
        "TransactionType": "CustomerBuyGoodsOnline",  # till payments
        "Amount": int(amount),                         # STK only accepts whole shillings
        "PartyA": phone,
        "PartyB": pay_till(),
        "PhoneNumber": phone,
        "CallBackURL": callback_url,
        "AccountReference": account_ref[:12],
        "TransactionDesc": description[:13],
    }
    r = requests.post(
        f"{_base()}/mpesa/stkpush/v1/processrequest",
        json=payload,
        headers={"Authorization": f"Bearer {_token()}"},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    if str(data.get("ResponseCode")) != "0":
        raise RuntimeError(data.get("ResponseDescription") or "M-Pesa request failed.")
    return data