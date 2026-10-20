import { rejectForeignRequest } from "@/lib/guard";
import { remoteStatus, revokeSessions, updateRemote } from "@/lib/remote.server";
import { tailscaleInfo, tailscaleServeOff, tailscaleServeOn } from "@/lib/tailscale.server";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function view() {
  return { ...remoteStatus(), tailscale: await tailscaleInfo() };
}

// Solo desde el propio PC (localOnly): un celular con sesión no puede cambiar el PIN ni la dirección.
export async function GET(req: Request) {
  const blocked = rejectForeignRequest(req, true);
  if (blocked) return blocked;
  return json(await view());
}

export async function PUT(req: Request) {
  const blocked = rejectForeignRequest(req, true);
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Cuerpo JSON inválido." }, 400);
  }
  let message = "";

  if (body.action === "revoke") {
    revokeSessions();
    message = "Sesiones del celular cerradas.";
  } else if (body.action === "serve-on" || body.action === "serve-off") {
    const r = body.action === "serve-on" ? await tailscaleServeOn() : await tailscaleServeOff();
    if (!r.ok) return json({ error: r.out.slice(0, 400) || "Tailscale no respondió. ¿Está instalado y con la sesión iniciada?" }, 502);
    message = r.out.slice(0, 400);
  } else {
    const patch: { enabled?: boolean; host?: string; pin?: string } = {};
    if (typeof body.host === "string") patch.host = body.host;
    if (typeof body.pin === "string" && body.pin) patch.pin = body.pin;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    const r = updateRemote(patch);
    if (!r.ok) return json({ error: r.error }, 400);
  }
  return json({ ...(await view()), message });
}
