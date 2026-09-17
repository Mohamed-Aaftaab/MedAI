import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Isolated contract checks: this backend never sends payments or places calls.
const calls = [];
const fixture = {
  call_id: "contract-test",
  patient_name: "Test Fixture",
  status: "pending",
  medications: [],
  dispatch_state: "not_sent",
};
const mock = createServer((req, res) => {
  calls.push({
    path: req.url,
    method: req.method,
    authorization: req.headers.authorization,
  });
  res.setHeader("Content-Type", "application/json");
  if (req.headers.authorization !== "Bearer contract-only") {
    res.writeHead(401);
    res.end(JSON.stringify({ detail: "Invalid token" }));
    return;
  }
  if (req.url === "/local/confirmations")
    return res.end(JSON.stringify([fixture]));
  if (req.url === "/campaigns/readiness")
    return res.end(
      JSON.stringify({
        configured_for_payment: true,
        configured_for_call: true,
        keeperhub_blockers: [],
        call_blockers: [],
        chain_id: "11155111",
        amount_eth: "0.0005",
      }),
    );
  if (req.url === "/campaigns/blocked/pay") {
    res.writeHead(409);
    return res.end(
      JSON.stringify({
        detail: ["KeeperHub not configured", "Call not configured"],
      }),
    );
  }
  if (req.url === "/campaigns/uncertain/pay") {
    res.writeHead(502);
    return res.end(JSON.stringify({ detail: "Broadcast uncertain" }));
  }
  if (req.url?.endsWith("/payment/reconcile"))
    return res.end(
      JSON.stringify({
        ...fixture,
        payment_state: "submitted",
        payment_verified: true,
      }),
    );
  if (req.url?.endsWith("/pay"))
    return res.end(
      JSON.stringify({
        payment: { ...fixture, payment_state: "submitted" },
        call: { ...fixture, dispatch_state: "submitted" },
      }),
    );
  res.writeHead(404);
  res.end("{}");
});
await new Promise((resolve) => mock.listen(18080, "127.0.0.1", resolve));
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    env: {
      ...process.env,
      MEDAI_BACKEND_URL: "http://127.0.0.1:18080",
      MEDAI_STAFF_TOKEN: "",
    },
    stdio: "pipe",
    windowsHide: true,
  },
);
let logs = "";
app.stdout.on("data", (d) => (logs += d));
app.stderr.on("data", (d) => (logs += d));
const origin = "http://127.0.0.1:3100";
const request = (path, options = {}) => fetch(origin + path, options);
try {
  let started = false;
  for (let i = 0; i < 60; i++) {
    try {
      await request("/api/session");
      started = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(started, logs);
  assert.equal((await request("/api/backend/local/confirmations")).status, 401);
  assert.equal((await request("/api/backend/not-allowed")).status, 404);
  assert.equal(
    (
      await request("/api/session", {
        method: "POST",
        headers: {
          Origin: "https://other.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: "contract-only" }),
      })
    ).status,
    403,
  );
  const login = await request("/api/session", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token: "contract-only" }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("medai_token="));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=strict/i);
  const cookie = setCookie.split(";")[0];
  const headers = { Cookie: cookie, Origin: origin };
  const invalid = await request("/api/session", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token: "invalid-credential" }),
  });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.headers.get("set-cookie"), null);
  const malformed = await request("/api/session", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  for (const path of [
    "/",
    "/confirmations",
    "/payments",
    "/calls",
    "/system",
    "/confirmations/contract-test",
  ]) {
    const page = await request(path);
    assert.equal(page.status, 200, `${path} must be directly loadable`);
    assert.doesNotMatch(
      await page.text(),
      /Amelia Bennett|Sofia Patel|Demo mode|Sample workspace/,
    );
  }
  const rows = await request("/api/backend/local/confirmations", { headers });
  assert.deepEqual(await rows.json(), [fixture]);
  assert.equal(calls.at(-1).authorization, "Bearer contract-only");
  const pay = await request("/api/backend/campaigns/contract-test/pay", {
    method: "POST",
    headers,
  });
  assert.equal((await pay.json()).call.dispatch_state, "submitted");
  assert.equal(calls.at(-1).method, "POST");
  const reconcile = await request(
    "/api/backend/campaigns/contract-test/payment/reconcile",
    { method: "POST", headers },
  );
  assert.equal((await reconcile.json()).payment_verified, true);
  const blocked = await request("/api/backend/campaigns/blocked/pay", {
    method: "POST",
    headers,
  });
  assert.equal(blocked.status, 409);
  assert.deepEqual((await blocked.json()).detail, [
    "KeeperHub not configured",
    "Call not configured",
  ]);
  const uncertain = await request("/api/backend/campaigns/uncertain/pay", {
    method: "POST",
    headers,
  });
  assert.equal(uncertain.status, 502);
  assert.equal((await uncertain.json()).detail, "Broadcast uncertain");
  const before = calls.length;
  assert.equal(
    (
      await request("/api/backend/campaigns/contract-test/pay", {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://other.test" },
      })
    ).status,
    403,
  );
  assert.equal(calls.length, before);
  assert.equal(
    (
      await request("/api/backend/local/confirmations", {
        method: "POST",
        headers,
      })
    ).status,
    404,
  );
  const logout = await request("/api/session", { method: "DELETE", headers });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /medai_token=;/);
  const disconnected = logout.headers
    .getSetCookie()
    .find((value) => value.startsWith("medai_disconnected="))
    .split(";")[0];
  assert.equal(
    (
      await (
        await request("/api/session", { headers: { Cookie: disconnected } })
      ).json()
    ).connected,
    false,
  );
  assert.equal(
    (
      await request("/api/backend/local/confirmations", {
        headers: { Cookie: disconnected },
      })
    ).status,
    401,
  );
  console.log(
    "PASS: session cookies, authentication forwarding, endpoint allowlist, origin checks, payment dispatch, reconciliation, 409 arrays, 502 uncertainty, and logout.",
  );
} finally {
  app.kill();
  mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
}
