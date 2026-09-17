"""Vercel entrypoint. Uses production.create_app() - the hardened entrypoint
(named staff keys, TrustedHostMiddleware, no legacy demo routes, no docs
endpoints) - not app.py, which is the more permissive local/dev app.

create_app() raises RuntimeError at import time if required configuration
(MEDAI_STAFF_KEYS, MEDAI_TENANT_ID, DATABASE_URL/POSTGRES_URL,
MEDAI_ALLOWED_HOSTS) is missing, so a misconfigured deployment fails loudly
on every request instead of silently running unsafe.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from production import create_app  # noqa: E402

app = create_app()
