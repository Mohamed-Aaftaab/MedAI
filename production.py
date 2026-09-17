"""Single-clinic production entrypoint. Deliberately excludes legacy demos."""
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from medai_readback.local_api import router, workflow
from medai_readback.ocr_api import router as ocr_router
from medai_readback.campaigns import router as campaigns_router
from medai_readback.workflow import WorkflowError
from medai_readback.security import RequestProtection


def configuration_errors():
    errors = []
    try:
        keys = json.loads(os.getenv('MEDAI_STAFF_KEYS', '{}'))
        if not isinstance(keys, dict) or not keys or any(not isinstance(k, str) or not k.strip() or not isinstance(v, str) or len(v) < 32 for k, v in keys.items()):
            raise ValueError()
        if len(set(keys.values())) != len(keys):
            raise ValueError()
    except (ValueError, TypeError):
        errors.append('MEDAI_STAFF_KEYS must contain unique long tokens mapped to named staff.')
    if not os.getenv('MEDAI_TENANT_ID'):
        errors.append('Set MEDAI_TENANT_ID for this clinic.')
    dsn = os.getenv('DATABASE_URL') or os.getenv('POSTGRES_URL', '')
    path = os.getenv('MEDAI_DB_PATH', '')
    if os.getenv('VERCEL'):
        # A local file path is meaningless on Vercel's ephemeral filesystem -
        # require the real database explicitly rather than accepting a path
        # that would silently lose data on the next cold start.
        if not dsn:
            errors.append('Set DATABASE_URL or POSTGRES_URL; local SQLite does not persist on Vercel.')
    elif not dsn and (not path or not Path(path).is_absolute()):
        errors.append('Set DATABASE_URL/POSTGRES_URL, or an absolute MEDAI_DB_PATH on persistent private storage.')
    hosts = os.getenv('MEDAI_ALLOWED_HOSTS', '').split(',')
    if not hosts or any(not h.strip() or '*' in h for h in hosts):
        errors.append('Set explicit MEDAI_ALLOWED_HOSTS without wildcards.')
    if os.getenv('MEDAI_ENABLE_LEGACY_DEMO') == 'true':
        errors.append('Legacy demo mode must be disabled.')
    return errors


def create_app():
    errors = configuration_errors()
    if errors:
        raise RuntimeError('; '.join(errors))
    @asynccontextmanager
    async def lifespan(app):
        from medai_readback.calle import CalleService
        from medai_readback.keeperhub import KeeperHubClient
        workflow().budget()
        try:
            yield
        finally:
            await CalleService.shutdown()
            await KeeperHubClient.shutdown()
    app = FastAPI(lifespan=lifespan, title='MedAI', docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestProtection)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[h.strip() for h in os.environ['MEDAI_ALLOWED_HOSTS'].split(',')])
    app.include_router(router)
    app.include_router(ocr_router)
    app.include_router(campaigns_router)

    @app.exception_handler(WorkflowError)
    async def workflow_error(request, exc):
        return JSONResponse({'detail': str(exc)}, status_code=exc.status)

    @app.get('/health')
    def health():
        # Check storage availability without returning patient data.
        workflow().budget()
        return {'status': 'ok'}
    return app
