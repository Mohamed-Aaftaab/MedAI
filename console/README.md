# MedAI — Agent Console

A standalone Next.js App Router / React / TypeScript dashboard for the existing MedAI FastAPI backend. The opening animation presents MedAI in the center, moves it into the sidebar, then reveals the workspace. Shared layout navigation preserves the workspace connection across pages, with separate motion treatments for each section and reduced-motion support.

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
- `/confirmations`: searchable confirmation queue with staggered row entrances.
- `/confirmations/[callId]`: dedicated patient, medication, payment authorization, receipt, and call outcome page. Supports direct links and browser history.
- `/payments`: transfer ledger, verified ETH total, payment filters, and receipt reveal animations.
- `/calls`: call outcomes and dispatch cards with staggered scale/entrance motion.
- `/system`: payment and voice configuration, exact backend blockers, and `/local/readiness` worker details with sequential service entrances.

The opening plays once per full page load; internal navigation uses Next.js links and plays only the destination page's animations. Resizing during the opening completes it immediately. Reduced-motion preferences skip movement.

## Integration

All requests go through allowlisted Next.js Route Handlers under `/api/backend`. They attach the operator token and forward to the existing backend; no browser-to-FastAPI calls and no CORS changes. Mutations require a matching same-origin header. Backend errors are shown, including array-valued `detail` responses. No backend endpoints are invented.

The shared workspace loads `/local/confirmations` and `/campaigns/readiness`, refreshing every 15 seconds while visible. The System page additionally reads `/local/readiness`. Payment and call pages derive their data from those records. Total ETH uses integer wei arithmetic and only verified payments. Calls completed are counted when a structured outcome is present or status is confirmed; the API has no dedicated completed-call field. Failed refreshes label retained records as the last successful sync and disable new payments.

Select a confirmation to inspect medications, call outcomes, and payment metadata. **Pay via KeeperHub** requires configured payment/calling, Sepolia, an unpaid record, and no prior dispatch. A second confirmation shows the exact amount and phone number before POSTing to `/campaigns/{call_id}/pay`. The backend remains the authority for idempotency, readiness, and actual payment amount. Unknown or failed action responses disable repeat payment for that record in the current session and offer reconciliation. **Check payment status** POSTs `/campaigns/{call_id}/payment/reconcile`. All transaction hashes link to Sepolia Etherscan; ETH amounts and receipt fields are copyable.

This is an operator console; no intake, OCR, patient management, scheduling, or account system is included. Fonts load from Google Fonts with local system fallbacks. The staff backend must be running to verify live integration. No real transaction or call is made by build or preview. Test-only fixtures in `tests/proxy.mjs` run against isolated local ports and are never imported into the application.

## Validation

```sh
npm run typecheck
npm run build
node tests/proxy.mjs
```

Manual flow: opening animation → connect staff token → overview → confirmations → patient details → authorize payment → inspect receipt/call response → payment and call pages → reconcile when needed. Test invalid tokens, unreachable backend, empty lists, readiness blockers, uncertain payments, mobile layouts, and reduced motion. Proxy tests also verify direct loading of every route and rejection of invalid credentials before a session is saved.
