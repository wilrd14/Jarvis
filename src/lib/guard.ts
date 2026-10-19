// Defensa del servidor local contra páginas web ajenas (CSRF y DNS rebinding).
// Jarvis escucha en 127.0.0.1 sin autenticación: sin esto, cualquier web abierta en el
// navegador podría enviar un POST "simple" (text/plain, sin preflight) a /api/actions/execute
// y bloquear la pantalla, abrir apps o cambiar la API key en Ajustes.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(hostHeader: string): string {
  // "127.0.0.1:3737" -> "127.0.0.1"; "[::1]:3737" -> "[::1]"
  const m = hostHeader.trim().toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/);
  return m ? m[1] : "";
}

/** Devuelve una respuesta 403 si la petición no viene de la propia app local; null si es válida. */
export function rejectForeignRequest(req: Request): Response | null {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");

  let ok = !!host && LOOPBACK.has(hostnameOf(host));
  if (ok && origin && origin !== "null") {
    try {
      ok = new URL(origin).host.toLowerCase() === host!.trim().toLowerCase();
    } catch {
      ok = false;
    }
  } else if (ok && origin === "null") {
    ok = false;
  }
  if (ok && fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") ok = false;

  if (ok) return null;
  return new Response(JSON.stringify({ ok: false, error: "Petición rechazada: origen no permitido." }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
