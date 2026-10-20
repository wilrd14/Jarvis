// Endpoint de chat/completions de OpenRouter para el código NUEVO de documentos (no lo usan brain ni websearch).
// SOLO para pruebas: OPENROUTER_CHAT_URL_OVERRIDE (variable de entorno del proceso) se respeta si NODE_ENV no
// es producción o si además se define JARVIS_ALLOW_CHAT_URL_OVERRIDE=1, y únicamente si apunta a http en
// loopback (127.0.0.1/localhost/::1): la API key jamás puede viajar a un host remoto. No se lee de ajustes ni de
// ninguna petición, y `sanitize` de settings.ts lo ignora.
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function chatEndpoint(): string {
  const o = process.env.OPENROUTER_CHAT_URL_OVERRIDE;
  if (o && (process.env.NODE_ENV !== "production" || process.env.JARVIS_ALLOW_CHAT_URL_OVERRIDE === "1")) {
    try {
      const u = new URL(o);
      if (u.protocol === "http:" && !u.username && !u.password && LOOPBACK_HOSTS.has(u.hostname)) return o;
    } catch {}
  }
  return OPENROUTER_CHAT_URL;
}
