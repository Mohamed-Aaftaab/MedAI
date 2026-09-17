import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/security";
export async function GET() {
  const jar = await cookies();
  return NextResponse.json({
    connected:
      jar.get("medai_disconnected")?.value !== "1" &&
      !!(jar.get("medai_token")?.value || process.env.MEDAI_STAFF_TOKEN),
  });
}
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req))
    return NextResponse.json({ detail: "Invalid origin" }, { status: 403 });
  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !token.trim() || token.length > 4096)
    return NextResponse.json(
      { detail: "Enter a valid staff token." },
      { status: 400 },
    );
  try {
    const response = await fetch(
      `${(process.env.MEDAI_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/campaigns/readiness`,
      {
        headers: { Authorization: `Bearer ${token.trim()}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ detail: "Backend authentication failed." }));
      return NextResponse.json(
        { detail: body.detail || "Backend authentication failed." },
        { status: response.status },
      );
    }
  } catch {
    return NextResponse.json(
      {
        detail:
          "Cannot reach MedAI. Start the FastAPI backend and check MEDAI_BACKEND_URL.",
      },
      { status: 502 },
    );
  }
  const jar = await cookies();
  jar.delete("medai_disconnected");
  jar.set("medai_token", token.trim(), {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "strict",
    path: "/",
  });
  return NextResponse.json({ connected: true });
}
export async function DELETE(req: NextRequest) {
  if (!isSameOrigin(req))
    return NextResponse.json({ detail: "Invalid origin" }, { status: 403 });
  (await cookies()).delete("medai_token");
  (await cookies()).set("medai_disconnected", "1", {
    httpOnly: true,
    sameSite: "strict",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
  });
  return NextResponse.json({ connected: false });
}
