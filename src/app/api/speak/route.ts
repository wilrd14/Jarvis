import { getSetting } from "@/lib/settings";
import { rejectForeignRequest } from "@/lib/guard";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// OpenRouter devuelve PCM16 mono a 24 kHz; lo envolvemos en WAV para el navegador.
function pcm16ToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

async function speakWithOpenRouter(text: string, apiKey: string) {
  // Modelo TTS dedicado: lee el texto tal cual, sin reinterpretarlo.
  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getSetting("ttsModel"),
      voice: getSetting("ttsVoice"),
      input: text,
      response_format: "pcm",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return json({ error: `OpenRouter error: ${errorText}` }, response.status || 502);
  }

  // El content-type indica la frecuencia, p. ej. "audio/pcm;rate=24000;channels=1".
  const rate = Number(response.headers.get("content-type")?.match(/rate=(\d+)/)?.[1]) || 24000;
  const pcm = new Uint8Array(await response.arrayBuffer());
  if (!pcm.length) return json({ error: "OpenRouter no devolvió audio." }, 502);

  return new Response(pcm16ToWav(pcm, rate) as BodyInit, {
    headers: { "Content-Type": "audio/wav" },
  });
}

async function speakWithElevenLabs(text: string, apiKey: string, voiceId: string) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
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
    return json({ error: `ElevenLabs error: ${errorText}` }, response.status);
  }

  return new Response(await response.arrayBuffer(), {
    headers: { "Content-Type": "audio/mpeg" },
  });
}

export async function POST(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  let text: unknown;
  try {
    text = (await req.json())?.text;
  } catch {
    return json({ error: "Cuerpo JSON inválido." }, 400);
  }

  if (!text || typeof text !== "string") {
    return json({ error: "Falta el texto a sintetizar." }, 400);
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
