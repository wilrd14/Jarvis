import { hasValidSession, isRemoteHost } from "@/lib/remote.server";

// Utilidades de protección para las rutas /api: límites de tamaño, rate limit en memoria
// (protegen el saldo de OpenRouter) y respuestas de error que no filtran detalles del proveedor.

export const LIMITS = {
  messageChars: 4000,
  historyItemChars: 2000,
  historyItems: 12,
  speakChars: 1500,
  listenBytes: 2 * 1024 * 1024,
} as const;

const hits = new Map<string, number[]>();

/** true si se permite la petición; ventana deslizante por clave. */
export function rateLimit(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const tooMany = () =>
  jsonResponse({ error: "Demasiadas peticiones, espera un momento." }, 429);

/** Registra el detalle del proveedor en el log del servidor y devuelve un mensaje genérico. */
export function providerError(service: string, status: number, detail: string) {
  console.error(`[${service}] error ${status}: ${detail.slice(0, 500)}`);
  return jsonResponse(
    { error: `El servicio de ${service} no respondió bien (código ${status}).` },
    status >= 400 && status < 600 ? status : 502
  );
}

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

/**
 * Devuelve una respuesta 403 si la petición no viene de la propia app; null si es válida.
 * Además del equipo local, acepta el Host del acceso remoto (Tailscale) con sesión de PIN válida,
 * salvo en rutas `localOnly` (ajustes, PIN): esas solo se tocan desde el propio PC.
 */
export function rejectForeignRequest(req: Request, localOnly = false): Response | null {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");

  let ok = !!host && LOOPBACK.has(hostnameOf(host));
  if (!ok && !localOnly && isRemoteHost(host) && hasValidSession(req.headers.get("cookie"))) ok = true;
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
