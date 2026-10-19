export interface WebSource {
  title: string;
  url: string;
}

export interface WebAnswer {
  reply: string;
  sources: WebSource[];
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Limpia URLs y markdown para que la respuesta sea hablable. */
export function toSpeakable(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Segundo paso del cerebro: responde con datos actuales usando el plugin "web"
 * de OpenRouter. Solo se llama cuando el primer paso pidió buscar, para no
 * pagar búsqueda (~0,04 USD por llamada) en cada charla.
 */
export async function answerWithWebSearch(opts: {
  apiKey: string;
  model: string;
  system: string;
  history: ChatTurn[];
  message: string;
  query: string;
}): Promise<WebAnswer | null> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 1500,
      plugins: [{ id: "web", max_results: 3 }],
      messages: [
        {
          role: "system",
          content: `${opts.system}\n\nAhora tienes resultados de búsqueda web actuales. Responde la pregunta del usuario con esos datos, en 1 a 3 frases habladas, en español, en TEXTO PLANO (no JSON): sin URLs, sin markdown, sin listas. Incluye cifras concretas y menciona la fuente solo si es relevante (por ejemplo "según medios locales"). Si los resultados no alcanzan, dilo con honestidad. Consulta sugerida: ${opts.query}`,
        },
        ...opts.history,
        { role: "user", content: opts.message },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  const reply = toSpeakable(typeof msg?.content === "string" ? msg.content : "");
  if (!reply) return null;

  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const a of Array.isArray(msg?.annotations) ? msg.annotations : []) {
    const c = a?.url_citation;
    if (a?.type !== "url_citation" || typeof c?.url !== "string") continue;
    let u: URL;
    try {
      u = new URL(c.url);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    sources.push({ title: String(c.title ?? u.hostname).slice(0, 120), url: u.href });
    if (sources.length >= 3) break;
  }
  return { reply, sources };
}
