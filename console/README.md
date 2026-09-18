# MedAI — Agent Console

**Live**: [medai-console.vercel.app](https://medai-console.vercel.app)

A standalone Next.js App Router / React / TypeScript operator dashboard for the existing MedAI FastAPI backend, with full feature parity to the original `/local/dashboard`: patient intake, OCR prescription upload, staff correction/approval, reminder scheduling and dispatch, KeeperHub payment and call dispatch, and system configuration. The opening animation presents MedAI in the center, moves it into the sidebar, then reveals the workspace. Shared layout navigation preserves the workspace connection across pages, with separate motion treatments for each section and reduced-motion support.

## Run locally

Requires Node.js 20.9+.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open http://127.0.0.1:3000. In PowerShell use `Copy-Item .env.example .env.local`.

- `MEDAI_BACKEND_URL`: server-side FastAPI URL; defaults to `http://127.0.0.1:8000`.
- `MEDAI_STAFF_TOKEN`: optional server-only token. Otherwise click **Connect backend** and enter the shared staff token. It is stored in an HTTP-only, SameSite=Strict session cookie, never localStorage or the JavaScript bundle. HTTPS makes the cookie Secure. Restart the server after changing env values.

There is no demo mode, sample dataset, generated receipt, or fabricated metric. Until the backend connects, pages show connection/loading/error states. After a successful response, empty backend lists display genuine zero counts. The entered token is validated against backend readiness before it is saved. A configured server token connects automatically. Disconnecting clears the staff cookie and suppresses the environment token for the current browser session.

## Pages

- `/`: live overview, summary statistics, payment-to-call pipeline, and latest confirmations. Widgets rise into place after the opening animation.
- `/intake`: create or select a patient, upload a prescription image for OCR extraction (or reopen a saved scan), accept suggested medication fields, and submit a new confirmation. Medications can also be entered or edited by hand.
- `/confirmations`: searchable confirmation queue with staggered row entrances.
- `/confirmations/[callId]`: patient, medication, payment authorization, receipt, and call outcome. Includes a direct (non-KeeperHub) call preview/dispatch path, staff correction and approval for `review`/`fallback` records, and a reminder-scheduling form once a prescription is `confirmed`. Supports direct links and browser history.
- `/reminders`: scheduled adherence and escalation jobs, with due/not-due gating and one-at-a-time dispatch.
- `/payments`: transfer ledger, verified ETH total, payment filters, and receipt reveal animations.
- `/calls`: call outcomes and dispatch cards with staggered scale/entrance motion.
- `/system`: payment and voice configuration, exact backend blockers, `/local/readiness` worker details, an editable call budget (working limit vs. the `.env` hard ceiling), and a read-only environment/config facts panel (tenant, database file, staff auth mode, verified locales, and more) — all with sequential service entrances.

The opening plays once per full page load; internal navigation uses Next.js links and plays only the destination page's animations. Resizing during the opening completes it immediately. Reduced-motion preferences skip movement.

## Integration

All requests go through allowlisted Next.js Route Handlers under `/api/backend`, matched by exact method and path pattern. They attach the operator token and forward to the existing backend, including request bodies (JSON and raw binary uploads) and response headers like `Content-Disposition` for file downloads; no browser-to-FastAPI calls and no CORS changes. Mutations (`POST`/`PUT`) require a matching same-origin header. Backend errors are shown, including array-valued `detail` responses. No backend endpoints are invented.

The shared workspace loads `/local/confirmations` and `/campaigns/readiness`, refreshing every 15 seconds while visible. The System page additionally reads `/local/readiness` and `/local/config`. The Reminders page reads `/local/jobs` and `/local/patients`. Payment and call pages derive their data from the shared confirmation records. Total ETH uses integer wei arithmetic and only verified payments. Calls completed are counted when a structured outcome is present or status is confirmed; the API has no dedicated completed-call field. Failed refreshes label retained records as the last successful sync and disable new payments.

**Intake**: `PUT /local/patients` creates or updates a patient, then `POST /local/intakes` submits the prescription. `POST /local/ocr/extract` runs the backend's real RapidOCR engine on an uploaded image and returns extracted text plus draft medication guesses; `GET /local/ocr`, `/local/ocr/{id}`, and `/local/ocr/{id}/source` list, inspect, and re-download a saved scan. Nothing is transcribed or guessed client-side.

**Correction and scheduling**: a `review`/`fallback` confirmation can be corrected and approved via `POST /local/confirmations/{call_id}/approve` with the edited medication list, a reason, and the record's version (optimistic concurrency). Once `confirmed`, `POST /local/confirmations/{call_id}/schedule` books a reminder for a chosen medicine and time; `POST /local/jobs/{job_id}/dispatch` places it. `POST /local/confirmations/{call_id}/dispatch` and `.../reconcile` cover the direct, non-KeeperHub call path.

**Payment**: select a confirmation to inspect medications, call outcomes, and payment metadata. **Pay via KeeperHub** requires configured payment/calling, Sepolia, an unpaid record, and no prior dispatch. A second confirmation shows the exact amount and phone number before POSTing to `/campaigns/{call_id}/pay`. The backend remains the authority for idempotency, readiness, and actual payment amount. Unknown or failed action responses disable repeat payment for that record in the current session and offer reconciliation. **Check payment status** POSTs `/campaigns/{call_id}/payment/reconcile`. All transaction hashes link to Sepolia Etherscan; ETH amounts and receipt fields are copyable.

**System**: the call budget form POSTs `/local/config/budget` with a new working limit; the backend enforces the `.env`-configured hard ceiling and the change applies immediately, no restart. The environment facts panel reads `/local/config` and is read-only — secrets, tokens, and phone numbers are never sent to the browser.

Fonts load from Google Fonts with local system fallbacks. The staff backend must be running to verify live integration. No real transaction or call is made by build or preview — the confirmation dialogs before dispatch and payment actions are the only path to a real Sepolia transaction or a real phone call. Test-only fixtures in `tests/proxy.mjs` run against isolated local ports and are never imported into the application.

## Validation

```sh
npm run typecheck
npm run build
node tests/proxy.mjs
```

Manual flow: opening animation → connect staff token → overview → intake a patient (typed and via OCR upload) → confirmations → patient details → correct and approve a `review`/`fallback` record → schedule and dispatch a reminder → authorize payment → inspect receipt/call response → payment and call pages → system budget edit and environment facts → reconcile when needed. Test invalid tokens, unreachable backend, empty lists, readiness blockers, uncertain payments, mobile layouts, and reduced motion. Proxy tests also verify direct loading of every route, request-body forwarding for JSON and binary uploads, and rejection of invalid credentials before a session is saved.
