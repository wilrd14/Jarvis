export async function POST(req: Request) {
  const { text } = await req.json();

  if (!text || typeof text !== "string") {
    return new Response(JSON.stringify({ error: "Falta el texto a sintetizar." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return new Response(
      JSON.stringify({
        error:
          "Faltan ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID en .env.local.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
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
    return new Response(
      JSON.stringify({ error: `ElevenLabs error: ${errorText}` }),
      { status: response.status, headers: { "Content-Type": "application/json" } }
    );
  }

  const audioBuffer = await response.arrayBuffer();
  return new Response(audioBuffer, {
    headers: { "Content-Type": "audio/mpeg" },
  });
}
