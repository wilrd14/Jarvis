// Cliente del cerebro en streaming (SSE) y sesión de voz por frases. Solo navegador.
import type { AssistantAction } from "@/lib/actions";
import type { AudioQueue } from "@/hooks/useAudioAmplitude";

export interface BrainDone {
  reply: string;
  action: AssistantAction | null;
  actionToken?: string;
  sources?: { title: string; url: string }[];
  streamed?: number;
}

/** Error de red/servidor antes de recibir ninguna frase: el llamador puede reintentar sin streaming. */
export class StreamUnavailable extends Error {}

/**
 * Pide la respuesta como SSE. Llama a `onSentence` por cada frase y resuelve con el evento `done`.
 * Lanza StreamUnavailable si falla antes de la primera frase (o si el servidor no sirvió SSE).
 */
export async function streamBrain(opts: {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  signal: AbortSignal;
  onSentence: (text: string) => void;
}): Promise<BrainDone> {
  let sentences = 0;
  let res: Response;
  try {
    res = await fetch("/api/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: opts.message, history: opts.history, stream: true }),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal.aborted) throw err;
    throw new StreamUnavailable("No se pudo abrir el stream.");
  }
  if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    // Un 4xx/5xx con JSON trae un mensaje útil (presupuesto, key...): se muestra tal cual.
    const data = await res.json().catch(() => null);
    if (data?.error && res.status >= 400 && res.status < 500) throw new Error(data.error);
    throw new StreamUnavailable(data?.error ?? "El servidor no respondió con streaming.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done: BrainDone | null = null;
  const handle = (block: string) => {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (event === "sentence") {
      const text = (payload as { text?: unknown }).text;
      if (typeof text === "string" && text) {
        sentences++;
        opts.onSentence(text);
      }
    } else if (event === "done") {
      done = payload as BrainDone;
    } else if (event === "error") {
      const msg = (payload as { error?: unknown }).error;
      const text = typeof msg === "string" ? msg : "Error al pensar la respuesta.";
      throw sentences === 0 ? new StreamUnavailable(text) : new Error(text);
    }
  };
  try {
    for (;;) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        handle(buf.slice(0, sep).replace(/\r/g, ""));
        buf = buf.slice(sep + 2);
      }
    }
    if (buf.trim()) handle(buf.replace(/\r/g, ""));
  } catch (err) {
    if (opts.signal.aborted) throw err;
    if (err instanceof StreamUnavailable || sentences > 0) throw err;
    throw new StreamUnavailable("Se cortó el stream.");
  }
  if (!done) {
    if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
    throw sentences === 0 ? new StreamUnavailable("El stream terminó sin respuesta.") : new Error("Se cortó la respuesta de Jarvis.");
  }
  return done;
}

// --- Voz por frases ------------------------------------------------------------------------------

export interface SpeechSession {
  /** Encola una frase: su audio se pide de inmediato (prefetch) y suena en orden. */
  add: (text: string) => void;
  /** No habrá más frases. Resuelve cuando todo sonó ("ended") o se canceló ("cancelled"). */
  end: () => Promise<"ended" | "cancelled">;
  /** Corta todo: aborta las peticiones de voz y detiene el audio. */
  cancel: () => void;
  /** Mensaje del primer fallo de voz (null si todo fue bien) y cuántas frases sonaron. */
  readonly error: string | null;
  readonly played: number;
}

/**
 * Sesión de voz de un turno: una petición a /api/speak por frase, todas lanzadas en cuanto
 * llega la frase (así la siguiente ya está lista cuando termina la actual) y encadenadas en la
 * cola de audio en orden. Si falla la voz de una frase se salta: el texto ya está en pantalla.
 */
export function createSpeechSession(queue: AudioQueue): SpeechSession {
  const abort = new AbortController();
  let chain: Promise<void> = Promise.resolve();
  let error: string | null = null;
  let played = 0;
  let cancelled = false;
  let settle: (r: "ended" | "cancelled") => void = () => {};
  const finished = new Promise<"ended" | "cancelled">((resolve) => {
    settle = resolve;
  });

  let over = false;
  queue.begin((reason) => {
    over = true;
    settle(reason);
  });

  const fetchAudio = async (text: string): Promise<ArrayBuffer | null> => {
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 1400) }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Error al generar la voz.");
      }
      return await res.arrayBuffer();
    } catch (err) {
      if (!cancelled) {
        error ??=
          err instanceof Error && err.name === "TimeoutError"
            ? "La voz tardó demasiado en generarse."
            : err instanceof Error
              ? err.message
              : "Error al hablar.";
      }
      return null;
    }
  };

  return {
    add(text) {
      if (cancelled) return;
      const audio = fetchAudio(text); // en paralelo con la reproducción de la anterior
      chain = chain.then(async () => {
        const data = await audio;
        if (cancelled || !data) return;
        if (await queue.push(data)) played++;
        else if (!cancelled) error ??= "No se pudo reproducir el audio.";
      });
    },
    end() {
      void chain.then(() => queue.end());
      return finished;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      abort.abort();
      if (!over) queue.cancel(); // si la cola ya terminó, no toca el audio de otra sesión
      settle("cancelled");
    },
    get error() {
      return error;
    },
    get played() {
      return played;
    },
  };
}
