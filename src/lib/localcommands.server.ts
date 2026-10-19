// Respuesta HTTP de /api/brain para las órdenes locales (sin IA): firma las acciones con
// confirmación igual que el cerebro y, en streaming, emite `sentence` (si se puede hablar ya) y `done`.
import { getActionDefinition } from "./actions";
import { jsonResponse, rateLimit, tooMany } from "./guard";
import { matchLocalCommand } from "./localcommands";
import { signProposal } from "./proposals.server";
import { SentenceSplitter } from "./replystream";

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * Si `message` es una orden local devuelve la Response lista (JSON o SSE); si no, null y el
 * llamador sigue el flujo normal con el cerebro. No toca OpenRouter, la API key ni el presupuesto.
 */
export function localCommandResponse(message: string, stream: boolean): Response | null {
  const match = matchLocalCommand(message);
  if (!match) return null;
  // Límite propio y holgado: las órdenes locales no cuestan, pero tampoco se dejan a ráfaga ilimitada.
  if (!rateLimit("brain-local", 120)) return tooMany();

  const def = match.action ? getActionDefinition(match.action.type) : undefined;
  const actionToken =
    match.action && def?.risk === "confirm" && def.execution.kind === "server" ? signProposal(match.action) : undefined;
  const result = { reply: match.reply, action: match.action, actionToken, local: true as const };
  if (!stream) return jsonResponse(result);

  // Igual que el cerebro: se habla la respuesta al instante salvo con acciones que se ejecutan solas
  // (el cliente dirá entonces el resultado real de la acción, p. ej. "Nota guardada").
  const speakable = !match.action || def?.risk === "confirm";
  const sentences: string[] = [];
  if (speakable) {
    const splitter = new SentenceSplitter();
    sentences.push(...splitter.push(match.reply), ...splitter.flush());
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      sentences.forEach((text, index) => controller.enqueue(sse("sentence", { text, index })));
      controller.enqueue(sse("done", { ...result, streamed: sentences.length }));
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
