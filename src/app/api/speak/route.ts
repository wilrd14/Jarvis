import { getSetting } from "@/lib/settings";
import { recordCacheHit, recordUsage, rejectIfOverBudget } from "@/lib/usage.server";
import { speakCached } from "@/lib/tts.server";
import { LIMITS, providerError, rateLimit, rejectForeignRequest, tooMany } from "@/lib/guard";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function speakWithOpenRouter(text: string, apiKey: string) {
  const { result, cache } = await speakCached(text, apiKey);
  if (!result.ok) {
    if (result.message) {
      console.error(`[OpenRouter] voz error ${result.status}: ${result.detail.slice(0, 300)}`);
      return json({ error: result.message }, result.status >= 400 && result.status < 600 ? result.status : 502);
    }
    return providerError("OpenRouter", result.status, result.detail);
  }
  // audio/speech no devuelve coste: solo se cuenta la llamada. Un acierto de caché no llamó a nadie.
  if (cache === "hit") recordCacheHit();
  else recordUsage("voice");
  return new Response(result.audio as BodyInit, {
    headers: { "Content-Type": result.contentType, "X-Jarvis-Cache": cache },
  });
}

async function speakWithElevenLabs(text: string, apiKey: string, voiceId: string) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    return providerError("ElevenLabs", response.status, errorText);
  }

  return new Response(await response.arrayBuffer(), {
    headers: { "Content-Type": "audio/mpeg" },
  });
}

export async function POST(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  // Con voz en streaming cada turno pide una síntesis por frase (hasta ~8): el tope por minuto
  // es mayor que el del cerebro (30 turnos/min) sin dejar de proteger el saldo.
  if (!rateLimit("speak", 120)) return tooMany();
  const overBudget = await rejectIfOverBudget();
  if (overBudget) return overBudget;

  let text: unknown;
  try {
    ({ text } = await req.json());
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  if (!text || typeof text !== "string") {
    return json({ error: "Falta el texto a sintetizar." }, 400);
  }
  if (text.length > LIMITS.speakChars) {
    return json({ error: "El texto es demasiado largo para leerlo en voz alta." }, 413);
  }

  const openRouterKey = getSetting("openrouterApiKey");
  try {
    if (openRouterKey) return await speakWithOpenRouter(text, openRouterKey);

    const elevenKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    if (elevenKey && voiceId) return await speakWithElevenLabs(text, elevenKey, voiceId);
  } catch {
    return json({ error: "No se pudo contactar con el servicio de voz: revisa tu conexión a internet." }, 502);
  }

  return json(
    { error: "Falta OPENROUTER_API_KEY (o ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID) en .env.local." },
    500
  );
}
