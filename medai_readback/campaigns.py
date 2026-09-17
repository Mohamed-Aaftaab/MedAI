"""KeeperHub-funded campaign calls.

Pays a small amount of Sepolia ETH through KeeperHub's Direct Execution API
for one existing confirmation, then places the same CALL-E call
local_api.place_confirmation_call() places for a manual dashboard dispatch —
the payment is what authorizes the call, not a separate decision.

/campaigns/keeperhub-webhook/{secret} is the same trigger reachable from
outside this process: it exists so a KeeperHub-native Workflow (see
keeperhub_create_workflow.py) can call this app back after its own
"pay ETH, then call a webhook" run, once one has been created. /pay above
does not depend on that workflow existing — it calls KeeperHub directly and
places the call in the same request, so the integration works before any
KeeperHub workflow has been set up.

Scope for now: one manual trigger per existing confirmation record. Batches,
schedules and per-recipient amounts are the "scale to campaigns" step described
in the README, not implemented here.
"""

from __future__ import annotations

import os
import secrets as secrets_module

from fastapi import APIRouter, Depends, Header, HTTPException
from loguru import logger

from medai_readback.keeperhub import KeeperHubClient, KeeperHubError
from medai_readback.local_api import live_settings, place_confirmation_call, public, staff, workflow

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


def keeperhub_settings():
    """Mirrors local_api.live_settings()'s shape: a list of human-readable
    blockers plus the resolved config, so campaign_readiness() and pay_and_call()
    read the same checks a staff member would see before triggering payment."""
    errors = []
    if not os.getenv("KEEPERHUB_API_KEY"):
        errors.append("KEEPERHUB_API_KEY missing")
    recipient = os.getenv("KEEPERHUB_RECIPIENT_ADDRESS", "").strip()
    if not recipient.startswith("0x") or len(recipient) != 42:
        errors.append("KEEPERHUB_RECIPIENT_ADDRESS missing or not a 0x-prefixed 20-byte address")
    amount = os.getenv("KEEPERHUB_TRANSFER_AMOUNT_ETH", "").strip()
    try:
        if not amount or float(amount) <= 0:
            raise ValueError()
    except ValueError:
        errors.append("KEEPERHUB_TRANSFER_AMOUNT_ETH must be a positive decimal string")
    if os.getenv("KEEPERHUB_ENABLE_PAYMENTS") != "true":
        errors.append("KeeperHub payments disabled")
    chain_id = os.getenv("KEEPERHUB_CHAIN_ID", "11155111")
    return errors, recipient, amount, chain_id


def webhook_secret():
    token = os.getenv("KEEPERHUB_WEBHOOK_SECRET", "")
    if len(token) < 32:
        raise HTTPException(503, "Configure KEEPERHUB_WEBHOOK_SECRET with at least 32 random characters")
    return token


@router.get("/readiness", dependencies=[Depends(staff)])
def campaign_readiness():
    kh_errors, recipient, amount, chain_id = keeperhub_settings()
    call_errors, *_ = live_settings()
    return {
        "configured_for_payment": not kh_errors,
        "configured_for_call": not call_errors,
        "keeperhub_blockers": kh_errors,
        "call_blockers": call_errors,
        "chain_id": chain_id,
        "amount_eth": amount or None,
        "note": "Configuration is not proof a transfer will land. No KeeperHub request is made by this check.",
    }


@router.post("/{key}/pay", dependencies=[Depends(staff)])
async def pay_and_call(key: str):
    kh_errors, recipient, amount, chain_id = keeperhub_settings()
    if kh_errors:
        raise HTTPException(409, kh_errors)
    call_errors, limit, phones, url = live_settings()
    if call_errors:
        raise HTTPException(409, call_errors)

    service = workflow()
    doc = service.get("confirmation", key)  # 404s via WorkflowError if missing
    if doc.get("payment_state") is not None:
        raise HTTPException(409, "Payment already submitted for this confirmation; no automatic re-pay")

    client = await KeeperHubClient.get_instance()
    idempotency_key = f"{key}|{chain_id}|{recipient.lower()}|{amount}"

    try:
        dry_run = await client.transfer(recipient, amount, chain_id=chain_id, simulate=True)
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from None
    if not dry_run.get("success") or dry_run.get("wouldRevert"):
        raise HTTPException(502, {"detail": "KeeperHub simulation failed; nothing was broadcast", "keeperhub": dry_run})

    try:
        broadcast = await client.transfer(recipient, amount, chain_id=chain_id, idempotency_key=idempotency_key)
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from None

    execution_id = broadcast.get("executionId")
    if broadcast.get("status_code", 500) >= 400 or not execution_id:
        service.record_payment(key, None)
        logger.warning("KeeperHub transfer for confirmation {} had no executionId: {}", key, broadcast)
        raise HTTPException(502, {"detail": "KeeperHub broadcast outcome uncertain; do not re-pay without reconciling",
                                   "keeperhub": broadcast})

    doc = service.record_payment(key, {
        "execution_id": execution_id, "chain_id": chain_id,
        "recipient": recipient, "amount": amount,
    })

    call_result = await place_confirmation_call(service, key, call_errors, limit, phones, url)
    return {"payment": public(doc), "call": call_result}


@router.post("/{key}/payment/reconcile", dependencies=[Depends(staff)])
async def reconcile_payment(key: str):
    service = workflow()
    doc = service.get("confirmation", key)
    execution_id = doc.get("payment_execution_id")
    if not execution_id:
        raise HTTPException(409, "No KeeperHub execution recorded for this confirmation")
    client = await KeeperHubClient.get_instance()
    try:
        status_body = await client.get_execution_status(execution_id)
    except KeeperHubError as exc:
        raise HTTPException(502, f"Could not read execution status from KeeperHub: {exc}") from None
    return public(service.reconcile_payment(key, status_body))


@router.post("/keeperhub-webhook/{token}")
async def keeperhub_webhook(token: str, body: dict):
    """Entry point for a KeeperHub-native workflow's Send-Webhook action.

    Guarded by a shared-secret path capability rather than a provider
    signature — same reasoning as /local/webhook/{token}: the Webhook plugin
    (https://docs.keeperhub.com/plugins/webhook) sends no signing header of
    its own, only a URL and a JSON payload.
    """
    expected = webhook_secret()
    if not secrets_module.compare_digest(token, expected):
        raise HTTPException(403, "Invalid webhook capability")
    key = body.get("call_id") if isinstance(body, dict) else None
    if not isinstance(key, str) or not key:
        raise HTTPException(422, "call_id is required")
    call_errors, limit, phones, url = live_settings()
    service = workflow()
    return await place_confirmation_call(service, key, call_errors, limit, phones, url)
