"""Create the KeeperHub workflow this app's /campaigns endpoints assume:
pay a small amount of Sepolia ETH, then call this app's webhook to trigger a
CALL-E confirmation call.

/campaigns/{key}/pay already does both steps itself by calling KeeperHub's
Direct Execution API directly — this script is for the separate,
KeeperHub-native "agent-authored workflow" variant described in the README,
where KeeperHub's own platform runs the two steps and calls
/campaigns/keeperhub-webhook/{KEEPERHUB_WEBHOOK_SECRET} back.

Run once per environment, after filling in .env:

    python keeperhub_create_workflow.py

Requires KEEPERHUB_API_KEY, KEEPERHUB_RECIPIENT_ADDRESS,
KEEPERHUB_TRANSFER_AMOUNT_ETH, MEDAI_PUBLIC_BASE_URL and
KEEPERHUB_WEBHOOK_SECRET. Prints the created workflow's id and how to trigger
it; set KEEPERHUB_WORKFLOW_ID to the id if the app should trigger it later.

The webhook action's field names below are not guessed from the docs page
(which shows only UI labels — "URL", "Payload" — not the underlying API
field names). They are read from KeeperHub's own open-source implementation,
cloned from https://github.com/keeperhub/keeperhub and checked directly:

  - actionType "webhook/send-webhook", with config keys webhookUrl,
    webhookMethod, webhookPayload — plugins/webhook/index.ts
  - a Webhook trigger's output is {body, headers, method, query,
    triggeredAt}, NOT the posted fields spread at the top level — so a
    downstream node reads {{@trigger-1:Webhook.body.call_id}}, not
    {{@trigger-1:Webhook.call_id}} — lib/workflow/editor/trigger-output-fields.ts
  - POST /api/workflows/{id}/webhook authenticates with a *webhook key*
    (wfb_ prefix, Settings > Developer > API keys > Webhook keys), which is
    a different credential from the kh_ org API key used to create the
    workflow here — a kh_ key is explicitly rejected with 401
    wrong_key_type — app/api/workflows/[workflowId]/webhook/route.ts

This script still calls GET /api/mcp/schemas and warns (does not fail) if
the live registry disagrees with the constants above, in case the plugin
has changed since this was verified.

One more thing this cannot verify without a real org: workflows/create's
route comments list "Send Webhook" alongside actions that may be gated to a
paid plan (enforceWorkflowFeatures). If workflow creation fails with an
upgrade-required response, that is what happened — /campaigns/{key}/pay
does not depend on this script and works without it.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import env_config  # noqa: F401,E402 — loads .env into os.environ before reads below

import httpx  # noqa: E402

WEBHOOK_ACTION_TYPE = "webhook/send-webhook"
WEBHOOK_URL_FIELD = "webhookUrl"
WEBHOOK_METHOD_FIELD = "webhookMethod"
WEBHOOK_PAYLOAD_FIELD = "webhookPayload"


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Error: {name} is not set. Copy .env.example to .env and fill it in.")
    return value


def warn_if_schema_disagrees(client: httpx.Client) -> None:
    """Best-effort cross-check against the live schema registry. Only warns —
    the constants above are the verified source of truth, this just catches
    a future KeeperHub-side rename before it produces a silently broken node."""
    try:
        resp = client.get("/api/mcp/schemas", timeout=10.0)
        resp.raise_for_status()
        actions = resp.json().get("actions", {})
    except httpx.HTTPError as exc:
        print(f"(could not reach /api/mcp/schemas to cross-check field names: {exc} — continuing)")
        return
    schema = actions.get(WEBHOOK_ACTION_TYPE)
    if schema is None:
        print(f"WARNING: {WEBHOOK_ACTION_TYPE} is not in the live schema registry. "
              "KeeperHub may have renamed the Webhook plugin's action — check "
              "https://github.com/keeperhub/keeperhub/blob/main/plugins/webhook/index.ts "
              "before trusting the workflow this script creates.")


def main():
    api_key = _require("KEEPERHUB_API_KEY")
    base_url = os.environ.get("KEEPERHUB_BASE_URL", "https://app.keeperhub.com").rstrip("/")
    chain_id = os.environ.get("KEEPERHUB_CHAIN_ID", "11155111")
    recipient = _require("KEEPERHUB_RECIPIENT_ADDRESS")
    amount = _require("KEEPERHUB_TRANSFER_AMOUNT_ETH")
    public_base_url = _require("MEDAI_PUBLIC_BASE_URL").rstrip("/")
    webhook_secret = _require("KEEPERHUB_WEBHOOK_SECRET")

    client = httpx.Client(
        base_url=base_url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout=30.0,
    )

    warn_if_schema_disagrees(client)
    callback_url = f"{public_base_url}/campaigns/keeperhub-webhook/{webhook_secret}"

    body = {
        "name": "MedAI campaign call payment",
        "description": (
            "Pays a small amount of Sepolia ETH, then calls the MedAI/CALL-E "
            "app's webhook to trigger a confirmation call. Created by "
            "keeperhub_create_workflow.py."
        ),
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger",
                "data": {"label": "Webhook", "config": {"triggerType": "Webhook"}},
            },
            {
                "id": "pay-eth",
                "type": "action",
                "data": {
                    "label": "Pay campaign ETH",
                    "config": {
                        "actionType": "web3/transfer-funds",
                        "network": chain_id,
                        "recipientAddress": recipient,
                        "amount": amount,
                    },
                },
            },
            {
                "id": "notify-app",
                "type": "action",
                "data": {
                    "label": "Trigger MedAI call",
                    "config": {
                        "actionType": WEBHOOK_ACTION_TYPE,
                        WEBHOOK_URL_FIELD: callback_url,
                        WEBHOOK_METHOD_FIELD: "POST",
                        WEBHOOK_PAYLOAD_FIELD: json.dumps(
                            {"call_id": "{{@trigger-1:Webhook.body.call_id}}"}
                        ),
                    },
                },
            },
        ],
        "edges": [
            {"id": "trigger-to-pay", "source": "trigger-1", "target": "pay-eth"},
            {"id": "pay-to-notify", "source": "pay-eth", "target": "notify-app"},
        ],
        "enabled": True,
    }

    resp = client.post("/api/workflows/create", json=body)
    if resp.status_code >= 400:
        raise SystemExit(f"KeeperHub rejected the workflow ({resp.status_code}): {resp.text}")
    created = resp.json()
    workflow_id = created["id"]
    print(f"Created KeeperHub workflow: {workflow_id}")
    print(f"Set KEEPERHUB_WORKFLOW_ID={workflow_id} in .env if the app should trigger it directly.")
    print()
    print(f"To trigger it, POST to {base_url}/api/workflows/{workflow_id}/webhook")
    print("  with a *webhook key* (wfb_..., from Settings > Developer > API keys >")
    print("  Webhook keys) — the kh_ key used above to create it will NOT work here.")
    print('  Authorization: Bearer wfb_...')
    print('  body: {"call_id": "<confirmation call_id>"}')


if __name__ == "__main__":
    main()
