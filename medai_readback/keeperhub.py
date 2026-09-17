"""KeeperHub Direct Execution client — moves value onchain through KeeperHub's
REST API (https://docs.keeperhub.com/api/direct-execution).

Mirrors CalleService's shape (a managed async-client singleton) so the two
external providers this app depends on — CALL-E for calls, KeeperHub for
onchain payment — are wired in the same way.

Environment:
  KEEPERHUB_API_KEY      required for transfer()/get_execution_status()
                         (organization key, kh_ prefix)
  KEEPERHUB_WEBHOOK_KEY  required only for trigger_workflow() — a *user*
                         webhook key, wfb_ prefix, from Settings > Developer >
                         API keys > Webhook keys. Verified against KeeperHub's
                         own source (app/api/workflows/[workflowId]/webhook/
                         route.ts): that endpoint rejects a kh_ org key with
                         401 wrong_key_type, so it is not interchangeable
                         with KEEPERHUB_API_KEY despite both being "the"
                         KeeperHub API key in the docs prose.
  KEEPERHUB_BASE_URL     default https://app.keeperhub.com
  KEEPERHUB_CHAIN_ID     default 11155111 (Ethereum Sepolia)
"""

from __future__ import annotations

import asyncio
import os
from typing import Optional

import httpx
from loguru import logger

_KEEPERHUB_API_KEY = lambda: os.getenv("KEEPERHUB_API_KEY", "")
_KEEPERHUB_WEBHOOK_KEY = lambda: os.getenv("KEEPERHUB_WEBHOOK_KEY", "")
_KEEPERHUB_BASE_URL = lambda: os.getenv("KEEPERHUB_BASE_URL", "https://app.keeperhub.com").rstrip("/")
_KEEPERHUB_CHAIN_ID = lambda: os.getenv("KEEPERHUB_CHAIN_ID", "11155111")


class KeeperHubError(Exception):
    def __init__(self, status_code: int, body):
        self.status_code = status_code
        self.body = body
        super().__init__(f"KeeperHub API error ({status_code}): {body}")


class KeeperHubClient:
    """Singleton KeeperHub Direct Execution API client with a managed httpx session."""

    _instance: Optional["KeeperHubClient"] = None
    _lock = asyncio.Lock()

    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None

    @classmethod
    async def get_instance(cls) -> "KeeperHubClient":
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
                    await cls._instance._init_client()
        return cls._instance

    async def _init_client(self):
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(base_url=_KEEPERHUB_BASE_URL(), timeout=30.0)
            logger.info("KeeperHubClient session initialized")

    async def _ensure_client(self):
        if self._client is None or self._client.is_closed:
            await self._init_client()

    def _headers(self, idempotency_key: Optional[str] = None) -> dict:
        key = _KEEPERHUB_API_KEY()
        if not key:
            raise ValueError("Missing KeeperHub credentials: KEEPERHUB_API_KEY")
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    async def transfer(
        self,
        recipient_address: str,
        amount: str,
        chain_id: Optional[str] = None,
        simulate: bool = False,
        idempotency_key: Optional[str] = None,
    ) -> dict:
        """POST /api/execute/transfer — native-token transfer (no tokenAddress).

        With simulate=True this estimates gas and catches a revert without
        signing or broadcasting; per KeeperHub's documented safe first-write
        sequence, always simulate once before the same call without the flag.
        A dry-run failure is diagnostic (HTTP 400 with wouldRevert in the
        body), not a transport error, so the parsed body is returned either
        way — callers read success/wouldRevert rather than relying on a raise.
        """
        await self._ensure_client()
        headers = self._headers(idempotency_key if not simulate else None)
        payload = {
            "chainId": chain_id or _KEEPERHUB_CHAIN_ID(),
            "recipientAddress": recipient_address,
            "amount": str(amount),
            "simulate": simulate,
        }
        resp = await self._client.post("/api/execute/transfer", json=payload, headers=headers)
        body = resp.json() if resp.content else {}
        if not isinstance(body, dict):
            body = {"raw": body}
        return {"status_code": resp.status_code, **body}

    async def get_execution_status(self, execution_id: str) -> dict:
        """GET /api/execute/{executionId}/status — poll after a broadcast."""
        await self._ensure_client()
        resp = await self._client.get(f"/api/execute/{execution_id}/status", headers=self._headers())
        if resp.status_code != 200:
            raise KeeperHubError(resp.status_code, resp.json() if resp.content else {})
        return resp.json()

    async def trigger_workflow(self, workflow_id: str, payload: dict, idempotency_key: Optional[str] = None) -> dict:
        """POST /api/workflows/{workflowId}/webhook — start a KeeperHub-native
        workflow run (see keeperhub_create_workflow.py). Authenticates with
        KEEPERHUB_WEBHOOK_KEY (wfb_), not KEEPERHUB_API_KEY (kh_) — see the
        module docstring."""
        key = _KEEPERHUB_WEBHOOK_KEY()
        if not key:
            raise ValueError(
                "Missing KeeperHub credentials: KEEPERHUB_WEBHOOK_KEY "
                "(a wfb_-prefixed webhook key from Settings > Developer > "
                "API keys > Webhook keys — not the same as KEEPERHUB_API_KEY)"
            )
        await self._ensure_client()
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        resp = await self._client.post(f"/api/workflows/{workflow_id}/webhook", json=payload, headers=headers)
        if resp.status_code >= 400:
            raise KeeperHubError(resp.status_code, resp.json() if resp.content else {})
        return resp.json() if resp.content else {}

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
        self._client = None
        logger.info("KeeperHubClient session closed")

    @classmethod
    async def shutdown(cls):
        if cls._instance:
            await cls._instance.close()
            cls._instance = None
