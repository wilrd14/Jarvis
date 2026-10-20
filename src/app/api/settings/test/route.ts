import { rejectForeignRequest } from "@/lib/guard";
import { getSetting } from "@/lib/settings";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Verifica una key contra OpenRouter. Acepta { apiKey } opcional (para probar
// antes de guardar); si no viene, prueba la que está configurada.
export async function POST(req: Request) {
  const blocked = rejectForeignRequest(req, true);
  if (blocked) return blocked;
  let candidate = "";
  try {
    const body = await req.json();
    if (typeof body?.apiKey === "string") candidate = body.apiKey.trim();
  } catch {
    // sin cuerpo: se usa la key guardada
  }
  const apiKey = candidate || getSetting("openrouterApiKey");
  if (!apiKey) return json({ ok: false, error: "No hay ninguna API key configurada." }, 200);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return json({ ok: true });
    if (res.status === 401 || res.status === 403) {
      return json({ ok: false, error: "OpenRouter rechazó la key: no es válida." });
    }
    return json({ ok: false, error: `OpenRouter respondió con error ${res.status}.` });
  } catch {
    return json({ ok: false, error: "No se pudo contactar con OpenRouter." });
  }
}
