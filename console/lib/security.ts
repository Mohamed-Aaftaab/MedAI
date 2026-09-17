import type { NextRequest } from "next/server";

// Next.js can normalize its internal hostname to localhost. Use the original
// request Host, including its port, to validate browser mutation requests.
export function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      url.host === request.headers.get("host") &&
      url.protocol === request.nextUrl.protocol
    );
  } catch {
    return false;
  }
}
