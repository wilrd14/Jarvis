import { USER_NAME, ASSISTANT_NAME } from "@/lib/config";
import { getSetting } from "@/lib/settings";
import { buildActionsPrompt, parseAction, type AssistantAction } from "@/lib/actions";

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

${buildActionsPrompt()}

Eres además un asistente muy capaz: razonas con cuidado, respondes preguntas de cualquier tema con datos correctos, ayudas a planear, redactar, programar y decidir. Usa el contexto de la conversación previa. Si no sabes algo, dilo con honestidad en vez de inventarlo. Mantén "reply" corto (1 a 3 frases) porque se lee en voz alta: sin listas, markdown ni símbolos.

Fecha y hora actuales: ${new Date().toLocaleString("es-ES", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "full", timeStyle: "short" })}. Úsala para resolver "mañana", "el viernes", etc. La zona horaria de ${USER_NAME} es UTC-3 (Buenos Aires): en las fechas ISO de las acciones escribe la hora local con ese offset (por ejemplo 2026-08-15T10:00:00-03:00).`;

function extractJson(text: string): BrainResponseBody | null {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.reply !== "string") return null;
    // Acción inválida o desconocida: se descarta sin romper la respuesta.
    return { reply: parsed.reply, action: parseAction(parsed.action) };
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

  const apiKey = getSetting("openrouterApiKey");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Falta la API key de OpenRouter: configúrala en Ajustes." }),
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
      model: getSetting("model"),
      // Margen amplio: el modelo razona antes de responder y con 700 el JSON salía cortado.
      max_tokens: 2500,
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
