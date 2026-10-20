import { checkPin, issueSessionCookie, loginLockedMs } from "@/lib/remote.server";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

// Solo llega aquí con el Host del acceso remoto (el proxy rechaza cualquier otro que no sea el PC).
export async function POST(req: Request) {
  let pin: unknown;
  try {
    ({ pin } = await req.json());
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }
  const result = checkPin(pin);
  if (result === "locked") {
    const min = Math.max(1, Math.ceil(loginLockedMs() / 60_000));
    return json({ error: `Demasiados intentos. Espera ${min} min.` }, 429);
  }
  if (result === "unavailable") return json({ error: "El acceso desde el celular no está activado." }, 403);
  if (result === "bad") return json({ error: "PIN incorrecto." }, 401);
  const cookie = issueSessionCookie();
  if (!cookie) return json({ error: "No se pudo iniciar la sesión." }, 500);
  return json({ ok: true }, 200, { "Set-Cookie": cookie });
}
