import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security";
export const dynamic = "force-dynamic";

// Every backend path this proxy will forward, by method. Path parameters
// (call_id, job_id, scan_id) are opaque ids the backend itself generates --
// [a-zA-Z0-9_-]+ matches all of them without trusting the segment's meaning.
const ROUTES: { method: string; pattern: RegExp }[] = [
  { method: "GET", pattern: /^campaigns\/readiness$/ },
  { method: "GET", pattern: /^local\/confirmations$/ },
  { method: "GET", pattern: /^local\/readiness$/ },
  { method: "GET", pattern: /^local\/patients$/ },
  { method: "GET", pattern: /^local\/jobs$/ },
  { method: "GET", pattern: /^local\/config$/ },
  { method: "GET", pattern: /^local\/ocr$/ },
  { method: "GET", pattern: /^local\/ocr\/[a-zA-Z0-9_-]+$/ },
  { method: "GET", pattern: /^local\/ocr\/[a-zA-Z0-9_-]+\/source$/ },
  { method: "GET", pattern: /^local\/confirmations\/[a-zA-Z0-9_-]+\/preview$/ },
  { method: "PUT", pattern: /^local\/patients$/ },
  { method: "POST", pattern: /^local\/intakes$/ },
  { method: "POST", pattern: /^local\/ocr\/extract$/ },
  {
    method: "POST",
    pattern: /^local\/confirmations\/[a-zA-Z0-9_-]+\/(dispatch|reconcile|approve|schedule)$/,
  },
  { method: "POST", pattern: /^local\/config\/budget$/ },
  { method: "POST", pattern: /^local\/jobs\/[a-zA-Z0-9_-]+\/dispatch$/ },
  { method: "POST", pattern: /^campaigns\/[a-zA-Z0-9_-]+\/(pay|payment\/reconcile)$/ },
];

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const path = (await ctx.params).path.join("/");
  const allowed = ROUTES.some((r) => r.method === req.method && r.pattern.test(path));
  if (!allowed)
    return NextResponse.json(
      { detail: "Endpoint not allowed." },
      { status: 404 },
    );
  if ((req.method === "POST" || req.method === "PUT") && !isSameOrigin(req))
    return NextResponse.json({ detail: "Invalid origin." }, { status: 403 });
  const jar = await cookies();
  const token =
    jar.get("medai_disconnected")?.value === "1"
      ? undefined
      : jar.get("medai_token")?.value || process.env.MEDAI_STAFF_TOKEN;
  if (!token)
    return NextResponse.json(
      { detail: "Connect with your staff token first." },
      { status: 401 },
    );
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: ArrayBuffer | undefined;
  if (req.method === "POST" || req.method === "PUT") {
    body = await req.arrayBuffer();
    // OCR upload sends raw bytes; every other mutation here sends JSON.
    headers["Content-Type"] =
      req.headers.get("content-type") || "application/json";
  }
  try {
    const response = await fetch(
      `${(process.env.MEDAI_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/${path}`,
      {
        method: req.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(
          req.method === "GET" && !path.endsWith("/source") ? 15000 : 120000,
        ),
      },
    );
    const buffer = await response.arrayBuffer();
    const outHeaders: Record<string, string> = {
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    };
    const disposition = response.headers.get("content-disposition");
    if (disposition) outHeaders["Content-Disposition"] = disposition;
    return new NextResponse(buffer, { status: response.status, headers: outHeaders });
  } catch {
    return NextResponse.json(
      {
        detail:
          req.method === "GET"
            ? "Cannot reach the MedAI backend. Check MEDAI_BACKEND_URL and that FastAPI is running."
            : "The backend response is uncertain. Refresh and check status before retrying.",
      },
      { status: 502 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PUT };
