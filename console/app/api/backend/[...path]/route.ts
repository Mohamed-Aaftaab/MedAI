import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security";
export const dynamic = "force-dynamic";
async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const path = (await ctx.params).path.join("/");
  const allowed =
    req.method === "GET"
      ? [
          "campaigns/readiness",
          "local/confirmations",
          "local/readiness",
          "local/patients",
        ].includes(path)
      : /^campaigns\/[a-zA-Z0-9_-]+\/(pay|payment\/reconcile)$/.test(path);
  if (!allowed)
    return NextResponse.json(
      { detail: "Endpoint not allowed." },
      { status: 404 },
    );
  if (req.method === "POST" && !isSameOrigin(req))
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
  try {
    const response = await fetch(
      `${(process.env.MEDAI_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/${path}`,
      {
        method: req.method,
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(req.method === "POST" ? 120000 : 15000),
      },
    );
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        detail:
          req.method === "POST"
            ? "The backend response is uncertain. Refresh and check payment status before retrying."
            : "Cannot reach the MedAI backend. Check MEDAI_BACKEND_URL and that FastAPI is running.",
      },
      { status: 502 },
    );
  }
}
export { proxy as GET, proxy as POST };
