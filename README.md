# MedAI

**Integrates [KeeperHub](https://docs.keeperhub.com/) as the payment execution layer for [CALL-E](https://heycall-e.com), a live AI voice-calling platform.** No confirmation call goes out until KeeperHub simulates the transfer, broadcasts it on Sepolia, and independently verifies the receipt — the payment is what authorizes CALL-E to dial, not a separate decision the app could get wrong. MedAI is the real use case built on top: a medication-confirmation workflow that turns every automated call into an onchain-paid, independently-verifiable action. Built for [KeeperHub's Agent Economy Hackathon](https://dorahacks.io/hackathon/agent-economy/detail).

Local prescription OCR, staff review, a durable per-tenant workflow engine, and an AI voice-call layer sit underneath the payment gate: pay first, then call, with both steps independently verifiable — onchain for the payment, via the call provider's own API for the conversation.

**Status:** multiple independently-verified Sepolia transactions executed through KeeperHub, several via a full, real, end-to-end pay-then-call run — payment landed, call placed, patient reached, outcome captured. This is a hackathon application, not a clinically validated medical system, and not investment or medical advice.

**Live**: [medai-console.vercel.app](https://medai-console.vercel.app) (Agent Console) · [medai-calle.vercel.app](https://medai-calle.vercel.app) (backend API)

## How it works

```
Staff reviews a prescription (OCR + human correction)
        │
        ▼
POST /campaigns/{call_id}/pay
        │
        ├─► KeeperHub: simulate transfer  (dry run — nothing signed or broadcast)
        │        │  wouldRevert: false
        │        ▼
        ├─► KeeperHub: broadcast transfer (Idempotency-Key, real Sepolia tx)
        │        │  verified: true, receiptStatus: success
        │        ▼
        └─► CALL-E: place the confirmation call
                 │  patient hears the prescription read back, confirms or corrects
                 ▼
        Outcome recorded — confirmed / needs review / fallback
```

The payment is what authorizes the call, not a separate decision: if the KeeperHub simulation would revert, or the broadcast doesn't return a usable execution ID, the call is never placed and the budget is never spent.

The confirmation step is deliberately strict: it only auto-approves an exact match between the stored medication name and what CALL-E reports the patient confirmed, and fails closed to staff review on anything less — including a technically-correct readback that includes dosage in the name field. That's the same fail-closed posture as the payment gate above, applied to the clinical side.

## KeeperHub integration

**Surface used:** the [Direct Execution API](https://docs.keeperhub.com/api/direct-execution) — `POST /api/execute/transfer` (simulate, then broadcast) and `GET /api/execute/{executionId}/status` to read back the onchain receipt. A KeeperHub-native Workflow variant (Webhook trigger → `web3/transfer-funds` → Webhook plugin calling back into this app) is also built for the "agent-authored workflow" surface — `keeperhub_create_workflow.py`, `POST /campaigns/keeperhub-webhook/{secret}` — see Roadmap for where that stands.

**Network:** Sepolia testnet (`chainId 11155111`).

**Safety sequence**, matching KeeperHub's own documented safe-write pattern: read `GET /api/chains`, simulate (`simulate: true` — estimates gas, never signs or broadcasts), only broadcast the identical body with `simulate` removed and a stable `Idempotency-Key`, then poll `/status` and treat `receipts[].verified` / `receiptStatus` — re-fetched by KeeperHub from the chain — as the authoritative proof, not the self-reported top-level status.

**Verified transactions:**

| What | Tx | Block |
|---|---|---|
| Isolated payment check | [`0xdf122dc3...1133b`](https://sepolia.etherscan.io/tx/0xdf122dc383b189316572ef1648b7c0112ada45b707ac8dc55ca5d4434a71133b) | 11721593 |
| Full `pay → call` run, through `/campaigns/{key}/pay` | [`0x160e959a...9894b`](https://sepolia.etherscan.io/tx/0x160e959ac803001fcf21c9ad021d926a7f8e59ef00431d0d09894b188d0d01e5) | 11721723 |
| Full `pay → call` run, production deployment | [`0xbd6e33a9...4a0d84d1`](https://sepolia.etherscan.io/tx/0xbd6e33a98953b8a3db62c5b0efc42279f269dc65b5f7f20b280114754a0d84d1) | 11723854 |
| Full `pay → call` run, two medications, both confirmed | [`0x8dff73d1...39014`](https://sepolia.etherscan.io/tx/0x8dff73d121c1a3ec683f7f9f6f2c3ca795c0eea3926cf045334370d847239014) | 11725470 |

These aren't a single lucky run: four independent Sepolia transactions across different sessions and patients, three of them full end-to-end pay-then-call cycles. Each one: the payment landed (`verified: true`, `receiptStatus: success`), CALL-E placed a real call that reached the patient, and the structured result was captured and reconciled — real transcript-derived outcomes, not a mock. `tests/test_campaigns.py` covers the equivalent flow offline.

**Reliability, not just a happy path:**
- Every broadcast carries an `Idempotency-Key` derived from `call_id | chainId | recipient | amount`, so a retried request replays the original result instead of double-spending.
- A payment that fails to return a usable execution ID is recorded as `unknown` (budget retained, not silently dropped) rather than assumed successful.
- `POST /campaigns/{call_id}/payment/reconcile` re-reads the execution status independently of the original request — same pattern the app already uses for CALL-E outcomes when no webhook arrives.
- KeeperHub's own daily spend caps (0.02 ETH/day default on EVM chains) and this app's own `CALLE_CALL_BUDGET` bound worst-case exposure independently of each other.
- Field names and auth requirements used here (the webhook plugin's real config keys, the execution receipt's `hash` field, the separate `wfb_` webhook-trigger credential) were checked directly against KeeperHub's open-source implementation (`github.com/keeperhub/keeperhub`), not assumed from documentation prose — three real mismatches were caught and fixed this way before anything was broadcast for real.

## Run locally

Use Python 3.14. In a virtual environment:

```text
python -m pip install -r requirements.txt -r requirements-dev.txt
```

Copy `.env.example` to `.env`. Generate a staff access token with:

```text
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set `MEDAI_STAFF_TOKEN` to that token. Keep `CALLE_ENABLE_LIVE_CALLS=false`, `CALLE_CALL_BUDGET=0` and `KEEPERHUB_ENABLE_PAYMENTS=false` until you're ready for a controlled live test — no provider key is needed for local OCR, review, storage, or offline verification.

```text
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --no-access-log
```

Open `http://127.0.0.1:8000/local/dashboard` and unlock with the staff token. The token stays in browser memory; reload or lock requires authentication again.

## Agent Console (`console/`)

A full operator dashboard for the backend above, not just a payment viewer: patient intake with OCR prescription upload, staff correction and approval of low-confidence readings, reminder scheduling and dispatch, call budget editing, an environment/config facts panel, overview stats, a payment ledger with live Etherscan links, per-confirmation detail with a **Pay via KeeperHub** action, and a system-readiness view. It talks to the same backend above through server-side route handlers (no CORS changes, no browser-to-FastAPI calls, no invented endpoints) and stores the operator token in an HTTP-only cookie, never localStorage. No demo data — every number is read from the live backend, and an empty workspace shows genuine zeros rather than a fabricated sample.

```text
cd console
npm install
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:3000` with the backend above already running. See `console/README.md` for the full page list and validation steps (`npm run typecheck`, `npm run build`, `node tests/proxy.mjs`).

## The confirmation call workflow

1. Add or select a patient and record their consent and preferred language.
2. Upload PNG, JPEG, WebP or PDF. OCR runs locally, without sending documents to an external API.
3. Load editable draft medicine fields derived from the recognized text. Missing fields stay blank. Compare every value with the original; handwriting accuracy is not validated.
4. Save reviewed medication data. Original files and extracted text remain available through authenticated saved-scan endpoints. No fixture substitutes for an uploaded file.
5. Preview the confirmation call, or pay for one through KeeperHub via `POST /campaigns/{call_id}/pay`. Live dispatch requires explicit configuration, an allowed number, verified locale, HTTPS callback and remaining local budget — the dashboard's Call readiness panel names each missing setting and the environment variable that supplies it.
6. Call corrections go to staff review. Approved regimens can receive explicitly scheduled reminder jobs. Creating a schedule does not place a call; a reminder is either dialled by hand from the Reminders view once it falls due, or by the worker, which must be explicitly enabled.
7. A submitted call stays unresolved until its outcome is known. Reopen the prescription and use **Check outcome with provider** to read the outcome back; a dispatch the provider never confirmed is marked *Outcome unknown*, keeps its reserved budget, and is never redialled automatically.

The database defaults to `data/medai.sqlite3` (or `DATABASE_URL`/`POSTGRES_URL` for Postgres — see `medai_readback/workflow.py`). Use one clinic per database/process. Backups contain prescription data and need the same access protection as the source database.

CALL-E (`api.heycall-e.com`) is the voice layer: MedAI sends it a natural-language task and a result schema, CALL-E dials the number, runs its own conversational AI agent, and returns structured extraction from what the patient actually said.

## Calls and worker

Live settings are listed in `.env.example` and checked by `/local/readiness`. An accepted provider request is not proof that the phone connected. Dispatch reservations are durable; uncertain responses retain the budget and cannot automatically redial.

Without a public HTTPS callback the terminal webhook can never arrive, so a submitted call would stay unresolved. `POST /local/confirmations/{call_id}/reconcile` reads that call's state from the provider and applies the same outcome rules as the webhook, resolving the record. It places no call, spends no budget, works with live calling disabled, and is safe to repeat or to race with a late webhook.

```text
python worker.py --once
```

The default worker is a dry run. `--live` opts into dispatch and still requires all call settings. Do not enable it until a controlled live test succeeds.

## Verify without spending credits

```text
python verify.py --full
node --check medai_readback/local_dashboard.js
node tests/test_ui_state.cjs medai_readback/local_dashboard.js
```

Verification runs smoke checks first, uses dummy credentials, and blocks external sockets. The reviewed revision passes 232 Python tests (13 of them covering the KeeperHub client and `/campaigns` endpoints, against a mocked KeeperHub API) plus the JavaScript state regression.

## Roadmap

The Direct Execution path is live, verified, and what actually runs today. Three things extend it from here:

- **Batched, scheduled campaigns.** `/campaigns/{call_id}/pay` is one manual trigger per confirmation today. The natural next step is a Schedule-triggered KeeperHub Workflow paying out across a recipient list — the native-Workflow plumbing for this (trigger → pay → webhook) is already built in `keeperhub_create_workflow.py`, ready to point at a real campaign once there's a list to run it against.
- **Third-party recipients.** The current demo pays the org's own wallet — the fastest way to prove the payment rail end-to-end without needing a second party in the loop for a first test. Pointing `KEEPERHUB_RECIPIENT_ADDRESS` at a real recipient is a config change, not new code.
- **A live run of the Workflow surface.** The code path used in this README's verified transactions is Direct Execution. The Workflow variant is checked field-for-field against KeeperHub's own source (see Reliability above) and ready to go; the next milestone is triggering it against a live organization the same way Direct Execution already has been, twice.

## Documentation

- [OCR installation and behavior](OCR_SETUP.md)
- [Local workflow and readiness](LOCAL_READINESS.md)
- [Production configuration and release gates](PRODUCTION.md)
- [Reusable contribution](skills/prescription-readback/SKILL.md)

The production entrypoint `production:create_app` excludes legacy demo routes and requires named staff keys, explicit allowed hosts and persistent storage. It does not make the application clinically validated or resolve provider routing.

## Scope and limitations

- OCR drafts use conservative text patterns; no automatic clinical interpretation, invented medicines or inferred doses.
- Webhooks (both CALL-E's and KeeperHub's) use secret per-call URL capabilities, not provider signatures. Keep callback paths out of access logs.
- `ocr/main.py` and historical demo modules contain labelled offline fixtures. They are not part of the real upload path; demo endpoints are disabled by default.
- This is testnet money and a testnet phone budget. Nothing here should be pointed at mainnet or production call volume without a separate review.

## License

[MIT](LICENSE)
