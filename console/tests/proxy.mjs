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
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const bodyBuf = Buffer.concat(chunks);
    calls.push({
      path: req.url,
      method: req.method,
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      body: bodyBuf,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer contract-only") {
      res.writeHead(401);
      res.end(JSON.stringify({ detail: "Invalid token" }));
      return;
    }
    let parsedBody = {};
    try {
      parsedBody = bodyBuf.length ? JSON.parse(bodyBuf.toString("utf8")) : {};
    } catch {
      /* binary body (OCR upload) -- left as raw bytes */
    }
    if (req.url === "/local/confirmations")
      return res.end(JSON.stringify([fixture]));
    if (req.url === "/local/patients" && req.method === "PUT")
      return res.end(JSON.stringify({ ...parsedBody, echoed: true }));
    if (req.url === "/local/intakes" && req.method === "POST")
      return res.end(JSON.stringify({ ...fixture, source_id: parsedBody.source_id }));
    if (req.url === "/local/jobs")
      return res.end(
        JSON.stringify([
          { job_id: "job-1", call_id: "contract-test", patient_id: "p1", kind: "adherence",
            due_at: "2020-01-01T00:00:00Z", medication: { name: "Metformin" },
            status: "pending", dispatch_state: "not_sent" },
        ]),
      );
    if (req.url === "/local/config")
      return res.end(
        JSON.stringify({
          calling: { enabled: true, working_limit: 3, ceiling: 5, reserved: 1,
            allowed_phone_count: 1, verified_locales: ["en-IN"], callback_host: null, provider_host: "api.heycall-e.com" },
          automation: { running: false, seen_at: null, age_seconds: null, mode: null },
          storage: { tenant: "test", database: "test.sqlite3", scheduled_jobs: 0, due_jobs: 0 },
          auth: { named_staff_keys: false, legacy_demo_enabled: false },
          blockers: [],
        }),
      );
    if (req.url === "/local/config/budget" && req.method === "POST")
      return res.end(JSON.stringify({ working_limit: parsedBody.limit, ceiling: 5, reserved: 1 }));
    if (req.url === "/local/ocr")
      return res.end(JSON.stringify([{ scan_id: "ocr-1", created_at: "2020-01-01T00:00:00Z", pages: 1 }]));
    if (req.url === "/local/ocr/extract" && req.method === "POST")
      return res.end(
        JSON.stringify({
          scan_id: "ocr-new", engine: "RapidOCR local", text: "Metformin 500mg",
          pages: [{ text: "Metformin 500mg" }], draft_medications: [], created_at: "2020-01-01T00:00:00Z", sha256: "abc",
        }),
      );
    if (req.url === "/local/ocr/ocr-1/source") {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment; filename=prescription-source");
      return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    if (req.url === "/local/ocr/ocr-1")
      return res.end(
        JSON.stringify({ scan_id: "ocr-1", engine: "RapidOCR local", text: "Metformin 500mg",
          pages: [{ text: "Metformin 500mg" }], draft_medications: [], created_at: "2020-01-01T00:00:00Z", sha256: "abc" }),
      );
    if (req.url?.endsWith("/preview"))
      return res.end(JSON.stringify({ task: "Read back Metformin 500mg", live_blockers: [] }));
    if (req.url?.endsWith("/confirmations/contract-test/dispatch"))
      return res.end(JSON.stringify({ ...fixture, dispatch_state: "submitted", provider_id: "call-x" }));
    if (req.url?.endsWith("/confirmations/contract-test/reconcile"))
      return res.end(JSON.stringify({ status: "processed", call_status: "completed", disposition: "confirmed" }));
    if (req.url?.endsWith("/confirmations/contract-test/approve"))
      return res.end(
        JSON.stringify({ ...fixture, status: "confirmed", approved_medications: parsedBody.medications }),
      );
    if (req.url?.endsWith("/confirmations/contract-test/schedule"))
      return res.end(
        JSON.stringify({ ...fixture, status: "scheduled", scheduled_due_at: parsedBody.due_at }),
      );
    if (req.url === "/local/jobs/job-1/dispatch" && req.method === "POST")
      return res.end(JSON.stringify({ job_id: "job-1", dispatch_state: "submitted" }));
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
    "/intake",
    "/reminders",
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

  // Request bodies must actually reach the backend -- the original proxy
  // never forwarded a body at all, which would have silently broken every
  // one of these (intake, patient upsert, approve, schedule, budget).
  const putPatient = await request("/api/backend/local/patients", {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id: "p1", name: "Test Patient" }),
  });
  assert.equal(putPatient.status, 200);
  const patientEcho = await putPatient.json();
  assert.equal(patientEcho.name, "Test Patient");
  assert.equal(patientEcho.echoed, true);

  const intake = await request("/api/backend/local/intakes", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id: "p1", source_id: "rx-99", medications: [] }),
  });
  assert.equal(intake.status, 200);
  assert.equal((await intake.json()).source_id, "rx-99");

  const jobs = await request("/api/backend/local/jobs", { headers });
  assert.equal((await jobs.json())[0].job_id, "job-1");

  const config = await request("/api/backend/local/config", { headers });
  assert.equal((await config.json()).calling.working_limit, 3);

  const budget = await request("/api/backend/local/config/budget", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 7 }),
  });
  assert.equal((await budget.json()).working_limit, 7);

  const scans = await request("/api/backend/local/ocr", { headers });
  assert.equal((await scans.json())[0].scan_id, "ocr-1");

  const scan = await request("/api/backend/local/ocr/ocr-1", { headers });
  assert.equal((await scan.json()).text, "Metformin 500mg");

  // OCR extract sends raw bytes, not JSON -- confirm the proxy forwards the
  // exact binary body and content-type, and doesn't try to JSON-encode it.
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const extract = await request("/api/backend/local/ocr/extract", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/octet-stream" },
    body: pngBytes,
  });
  assert.equal(extract.status, 200);
  assert.equal((await extract.json()).scan_id, "ocr-new");
  const forwarded = calls.find((c) => c.path === "/local/ocr/extract");
  assert.equal(forwarded.contentType, "application/octet-stream");
  assert.equal(Buffer.compare(forwarded.body, Buffer.from(pngBytes)), 0);

  // OCR source download must pass binary bytes and Content-Disposition
  // through unmodified -- the original .text()-based proxy would have
  // corrupted this via UTF-8 decoding.
  const source = await request("/api/backend/local/ocr/ocr-1/source", { headers });
  assert.equal(source.status, 200);
  assert.equal(source.headers.get("content-disposition"), "attachment; filename=prescription-source");
  const sourceBytes = new Uint8Array(await source.arrayBuffer());
  assert.deepEqual([...sourceBytes], [0x89, 0x50, 0x4e, 0x47]);

  const preview = await request("/api/backend/local/confirmations/contract-test/preview", { headers });
  assert.equal((await preview.json()).task, "Read back Metformin 500mg");

  const dispatch = await request("/api/backend/local/confirmations/contract-test/dispatch", {
    method: "POST",
    headers,
  });
  assert.equal((await dispatch.json()).dispatch_state, "submitted");

  const reconcile2 = await request("/api/backend/local/confirmations/contract-test/reconcile", {
    method: "POST",
    headers,
  });
  assert.equal((await reconcile2.json()).disposition, "confirmed");

  const approve = await request("/api/backend/local/confirmations/contract-test/approve", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ medications: [{ name: "Metformin" }], reason: "verified", version: 1 }),
  });
  assert.deepEqual((await approve.json()).approved_medications, [{ name: "Metformin" }]);

  const schedule = await request("/api/backend/local/confirmations/contract-test/schedule", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ due_at: ["2030-01-01T00:00:00Z"], medication_names: ["Metformin"], version: 1 }),
  });
  assert.deepEqual((await schedule.json()).scheduled_due_at, ["2030-01-01T00:00:00Z"]);

  const jobDispatch = await request("/api/backend/local/jobs/job-1/dispatch", {
    method: "POST",
    headers,
  });
  assert.equal((await jobDispatch.json()).dispatch_state, "submitted");

  // A PUT mutation is still subject to the same-origin check, same as POST.
  assert.equal(
    (
      await request("/api/backend/local/patients", {
        method: "PUT",
        headers: { Cookie: cookie, Origin: "https://other.test", "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: "p1" }),
      })
    ).status,
    403,
  );

  // Endpoints outside the allowlist stay blocked regardless of method.
  assert.equal((await request("/api/backend/local/not-a-real-endpoint", { headers })).status, 404);
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
    "PASS: session cookies, authentication forwarding, endpoint allowlist, origin checks, " +
      "payment dispatch, reconciliation, 409 arrays, 502 uncertainty, logout, JSON body " +
      "forwarding (patients/intakes/approve/schedule/budget), binary body and Content-Disposition " +
      "passthrough (OCR upload/download), PUT same-origin enforcement, and every new page route.",
  );
} finally {
  app.kill();
  mock.closeAllConnections();
  await new Promise((resolve) => mock.close(resolve));
}
