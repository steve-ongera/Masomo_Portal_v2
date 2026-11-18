"""
Django settings for the Kenya High School Management System.
Configured for local development and same-Wi-Fi LAN testing.
"""

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# ENVIRONMENT VARIABLES
# ---------------------------------------------------------------------------

load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    """Read a True/False flag from the environment (.env)."""
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "dev-secret-key-change-me-in-production",
)

# Development mode
DEBUG = True


# ---------------------------------------------------------------------------
# ALLOWED HOSTS
# ---------------------------------------------------------------------------

ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "10.214.5.92",
]


# ---------------------------------------------------------------------------
# INSTALLED APPS
# ---------------------------------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Third party
    "rest_framework",
    "rest_framework_simplejwt",
    "django_filters",
    "corsheaders",

    # Local
    "api",
    "hr",
    "meal_management",
    "procurement",
    "library",
    "lesson_planning",
    "attendance",
    "assignments",
    "bursaries",
    "boarding",
    "idcards",

    # SaaS plan / feature access (must come after "api": it references api models)
    "entitlements",
]


# ---------------------------------------------------------------------------
# MIDDLEWARE
# ---------------------------------------------------------------------------
# FeatureGateMiddleware sits right after CorsMiddleware so that a "feature not
# in your plan" 403 still carries the CORS headers the browser needs to read it.

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",

    "corsheaders.middleware.CorsMiddleware",
    "entitlements.enforcement.FeatureGateMiddleware",

    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


# ---------------------------------------------------------------------------
# URL / WSGI
# ---------------------------------------------------------------------------

ROOT_URLCONF = "backend.urls"

WSGI_APPLICATION = "backend.wsgi.application"


# ---------------------------------------------------------------------------
# TEMPLATES
# ---------------------------------------------------------------------------

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


# ---------------------------------------------------------------------------
# DATABASE
# ---------------------------------------------------------------------------
# SQLite for local development.
# PostgreSQL can be configured later for production.

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}


# ---------------------------------------------------------------------------
# CACHE
# ---------------------------------------------------------------------------
# The entitlements snapshot (what the school's plan allows) is cached for 60 s
# and cleared instantly by signals when a licence/package/feature changes.
#
# Local development: per-process memory is fine.
# Production with several Gunicorn workers: set REDIS_URL in .env so every
# worker shares one cache and an upgrade opens features on all of them at once.
#   REDIS_URL=redis://127.0.0.1:6379/1      (needs: pip install redis)

if os.environ.get("REDIS_URL"):
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": os.environ["REDIS_URL"],
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "masomo-default",
        }
    }


# ---------------------------------------------------------------------------
# CUSTOM USER
# ---------------------------------------------------------------------------

AUTH_USER_MODEL = "api.User"


# ---------------------------------------------------------------------------
# PASSWORD VALIDATION
# ---------------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "MinimumLengthValidator"
        ),
        "OPTIONS": {
            "min_length": 6,
        },
    },
]


# ---------------------------------------------------------------------------
# INTERNATIONALIZATION
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "en-us"

TIME_ZONE = "Africa/Nairobi"

USE_I18N = True
USE_TZ = True


# ---------------------------------------------------------------------------
# STATIC / MEDIA
# ---------------------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"


DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# ---------------------------------------------------------------------------
# SECURITY
# Login lockout / OTP / password reset
# ---------------------------------------------------------------------------

ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 3
ACCOUNT_LOCKOUT_DURATION_MINUTES = 30

OTP_EXPIRY_MINUTES = 5

PASSWORD_RESET_TOKEN_EXPIRY_MINUTES = 30


# ---------------------------------------------------------------------------
# DJANGO REST FRAMEWORK
# ---------------------------------------------------------------------------
# EntitledJWTAuthentication behaves exactly like JWTAuthentication, and in
# addition refuses a user whose role's portal is not in the school's current
# plan (so a downgrade locks them out even while their token is still valid).
# ADMIN is always allowed in, otherwise nobody could redeem an upgrade token.

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "entitlements.enforcement.EntitledJWTAuthentication",
    ),

    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),

    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
    ),

    "DEFAULT_PAGINATION_CLASS": (
        "rest_framework.pagination.PageNumberPagination"
    ),

    "PAGE_SIZE": 200,

    "DEFAULT_THROTTLE_RATES": {
        "login": "10/min",
        "otp_verify": "8/min",
        "forgot_password": "3/hour",
    },
}


# ---------------------------------------------------------------------------
# SIMPLE JWT
# ---------------------------------------------------------------------------

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),

    "ROTATE_REFRESH_TOKENS": True,

    "AUTH_HEADER_TYPES": ("Bearer",),
}


# ---------------------------------------------------------------------------
# SAAS PLAN ENFORCEMENT (entitlements app)
# ---------------------------------------------------------------------------
# ENTITLEMENTS_ENFORCE
#   False -> SHADOW MODE (default): nothing is blocked; every request that
#            WOULD have been blocked is logged as "[ENTITLEMENTS shadow]".
#            Use this for the first days after deploying.
#   True  -> real enforcement: modules/portals outside the plan return 403
#            {"code": "feature_not_in_plan", ...}.
# Flip it from .env (ENTITLEMENTS_ENFORCE=True) - no code change needed.

ENTITLEMENTS_ENFORCE = env_bool("ENTITLEMENTS_ENFORCE", True)

# Only requests under this prefix are checked by FeatureGateMiddleware.
ENTITLEMENTS_API_PREFIX = "/api/v1/"


# ---------------------------------------------------------------------------
# LOGGING
# ---------------------------------------------------------------------------
# Shadow-mode warnings go to the console AND logs/entitlements.log so you can
# review a few days of "would block" lines before turning enforcement on.

LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
        "entitlements_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": LOG_DIR / "entitlements.log",
            "maxBytes": 2 * 1024 * 1024,
            "backupCount": 3,
            "formatter": "simple",
        },
    },
    "loggers": {
        "entitlements": {
            "handlers": ["console", "entitlements_file"],
            "level": "INFO",
            "propagate": False,
        },
    },
}


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
# React/Vite can be accessed from:
#
# Local machine:
#   http://localhost:5174
#   http://127.0.0.1:5174
#
# Same Wi-Fi:
#   http://10.214.5.92:5174
#
# Change 5174 to 5173 if your Vite server uses port 5173.

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://10.214.5.92:5174",
]


CORS_ALLOW_CREDENTIALS = True


# ---------------------------------------------------------------------------
# FRONTEND
# ---------------------------------------------------------------------------
# Used for:
# - Password reset links
# - QR-code verification links
# - Other links generated by Django
#
# LAN demo URL

FRONTEND_URL = os.environ.get(
    "FRONTEND_URL",
    "http://10.214.5.92:5174",
)


# ---------------------------------------------------------------------------
# FEES / M-PESA
# ---------------------------------------------------------------------------
# NOTE: the Safaricom callback below is deliberately NOT under any gated
# prefix in entitlements/catalog.py. Webhooks must always be reachable,
# whatever plan the school is on.

MPESA_BASE_URL = os.environ.get(
    "MPESA_BASE_URL",
    "https://sandbox.safaricom.co.ke",
)

MPESA_CONSUMER_KEY = os.environ.get(
    "MPESA_CONSUMER_KEY",
    "",
)

MPESA_CONSUMER_SECRET = os.environ.get(
    "MPESA_CONSUMER_SECRET",
    "",
)

MPESA_SHORTCODE = os.environ.get(
    "MPESA_SHORTCODE",
    "174379",
)

MPESA_PASSKEY = os.environ.get(
    "MPESA_PASSKEY",
    "",
)

MPESA_CALLBACK_URL = os.environ.get(
    "MPESA_CALLBACK_URL",
    "https://yourschool.example.com/api/v1/payments/mpesa-callback/",
)


# ---------------------------------------------------------------------------
# EMAIL
# ---------------------------------------------------------------------------
# DEBUG=True means OTP/reset emails are printed to the terminal.
#
# When DEBUG=False, Django uses the real SMTP server.

if DEBUG:
    EMAIL_BACKEND = (
        "django.core.mail.backends.console.EmailBackend"
    )
else:
    EMAIL_BACKEND = (
        "django.core.mail.backends.smtp.EmailBackend"
    )


EMAIL_HOST = os.environ.get(
    "EMAIL_HOST",
    "smtp.gmail.com",
)

EMAIL_PORT = int(
    os.environ.get(
        "EMAIL_PORT",
        "587",
    )
)

EMAIL_USE_TLS = (
    os.environ.get(
        "EMAIL_USE_TLS",
        "True",
    ) == "True"
)

EMAIL_USE_SSL = (
    os.environ.get(
        "EMAIL_USE_SSL",
        "False",
    ) == "True"
)

EMAIL_HOST_USER = os.environ.get(
    "EMAIL_HOST_USER",
    "",
)

EMAIL_HOST_PASSWORD = os.environ.get(
    "EMAIL_HOST_PASSWORD",
    "",
)

DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL",
    "no-reply@school.example.com",
)

SERVER_EMAIL = DEFAULT_FROM_EMAIL


# ---------------------------------------------------------------------------
# EMAIL CONFIGURATION WARNING
# ---------------------------------------------------------------------------
# Only warn about missing credentials when using real SMTP.

if not DEBUG and not (
    EMAIL_HOST_USER and EMAIL_HOST_PASSWORD
):
    import warnings

    warnings.warn(
        "EMAIL_HOST_USER / EMAIL_HOST_PASSWORD are not set. "
        "OTP emails, password reset emails, and admin security "
        "notifications will fail. Check your .env file."
    )


# ---------------------------------------------------------------------------
# MEAL WALLET
# ---------------------------------------------------------------------------

MEAL_WALLET_OVERDRAFT_LIMIT = 1000          # a student may be served until balance hits -100 KES
MEAL_PAY_TILL = "56353"
# plus the MPESA_* / MEAL_MPESA_* values listed at the top of mpesa.py