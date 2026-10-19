// Transcripción de voz: recibe el audio crudo (WAV PCM16) como cuerpo de la
// petición y lo transcribe con un modelo Gemini vía OpenRouter.

import { getSetting } from "@/lib/settings";
import { LIMITS, providerError, rateLimit, tooMany } from "@/lib/guard";

const MAX_BYTES = LIMITS.listenBytes;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("flac")) return "flac";
  if (m.includes("aac")) return "aac";
  return "wav";
}

export async function POST(req: Request) {
  if (!rateLimit("listen", 20)) return tooMany();
  const apiKey = getSetting("openrouterApiKey");
  if (!apiKey) {
    return json({ error: "Falta la API key de OpenRouter: configúrala en Ajustes." }, 500);
  }

  const buf = await req.arrayBuffer();
  if (buf.byteLength < 100) {
    return json({ error: "No llegó audio." }, 400);
  }
  if (buf.byteLength > MAX_BYTES) {
    return json({ error: "El audio es demasiado largo." }, 413);
  }

  const format = formatFromMime(req.headers.get("content-type") ?? "audio/wav");
  const data = Buffer.from(buf).toString("base64");
  const model = getSetting("sttModel");

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Transcribe literalmente el audio adjunto, que está en español. " +
                  "Responde SOLO con la transcripción, sin comillas, comentarios ni explicaciones. " +
                  "Si no hay voz humana inteligible, responde con una cadena vacía.",
              },
              { type: "input_audio", input_audio: { data, format } },
            ],
          },
        ],
      }),
    });
  } catch {
    return json({ error: "No se pudo contactar con el servicio de transcripción." }, 502);
  }

  if (!res.ok) {
    return providerError("transcripción", res.status, await res.text().catch(() => ""));
  }

  const out = await res.json().catch(() => null);
  const content = out?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  return json({ text });
}
