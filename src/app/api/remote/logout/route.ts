import { clearSessionCookie } from "@/lib/remote.server";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json", "Set-Cookie": clearSessionCookie() },
  });
}
