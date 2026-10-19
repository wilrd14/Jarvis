import { USER_NAME, ASSISTANT_NAME } from "@/lib/config";
import type { AssistantAction } from "@/lib/actions";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface BrainRequestBody {
  message: string;
  history?: ChatTurn[];
}

interface BrainResponseBody {
  reply: string;
  action: AssistantAction | null;
}

const buildSystemPrompt = () => `Eres ${ASSISTANT_NAME}, el asistente de voz personal de ${USER_NAME}. Respondes siempre en español, de forma breve, natural y cálida, como si hablaras en voz alta.

Cuando ${USER_NAME} te pida enviar un correo o crear un evento de calendario, NO digas que ya lo hiciste — tú solo preparas la acción, y es ${USER_NAME} quien la confirma con un clic. Usa frases como "Te dejé listo el correo para que lo confirmes" o "Te preparé el evento, solo falta que le des guardar".

Debes responder EXCLUSIVAMENTE con un objeto JSON válido, sin texto adicional ni markdown, con esta forma exacta:
{
  "reply": "texto que Jarvis dice en voz alta",
  "action": null
}

Si la petición implica enviar un correo, en vez de null usa:
{
  "reply": "...",
  "action": { "type": "email", "to": "destinatario@ejemplo.com", "subject": "...", "body": "..." }
}

Si implica crear un evento de calendario, usa fechas ISO 8601 en UTC:
{
  "reply": "...",
  "action": { "type": "calendar", "title": "...", "details": "...", "location": "...", "start": "2026-08-15T18:00:00Z", "end": "2026-08-15T19:00:00Z" }
}

Si no tienes destinatario, asunto, fecha u hora suficientes, pregunta por los datos faltantes en "reply" y deja "action" en null.

Eres además un asistente muy capaz: razonas con cuidado, respondes preguntas de cualquier tema con datos correctos, ayudas a planear, redactar, programar y decidir. Usa el contexto de la conversación previa. Si no sabes algo, dilo con honestidad en vez de inventarlo. Mantén "reply" corto (1 a 3 frases) porque se lee en voz alta: sin listas, markdown ni símbolos.

Fecha y hora actuales: ${new Date().toLocaleString("es-ES", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "full", timeStyle: "short" })}. Úsala para resolver "mañana", "el viernes", etc.`;

function extractJson(text: string): BrainResponseBody | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.reply !== "string") return null;
    return { reply: parsed.reply, action: parsed.action ?? null };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const { message, history = [] } = (await req.json()) as BrainRequestBody;

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "Falta el mensaje." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Falta OPENROUTER_API_KEY en .env.local." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const recent = history
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-12);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-5.5",
      max_tokens: 700,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        ...recent,
        { role: "user", content: message },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(
      JSON.stringify({ error: `OpenRouter error: ${errorText}` }),
      { status: response.status, headers: { "Content-Type": "application/json" } }
    );
  }

  const data = await response.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "";

  const parsed = extractJson(rawText) ?? {
    reply: rawText || "No pude generar una respuesta, ¿podés repetirlo?",
    action: null,
  };

  return new Response(JSON.stringify(parsed), {
    headers: { "Content-Type": "application/json" },
  });
}
