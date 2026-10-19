"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import HologramCore, { AssistantState } from "@/components/HologramCore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useAudioAmplitude } from "@/hooks/useAudioAmplitude";
import { ASSISTANT_NAME, USER_NAME } from "@/lib/config";
import { isAutoRun, runAssistantAction, type AssistantAction } from "@/lib/actions";
import ActionCard from "@/components/ActionCard";

const STATE_LABEL: Record<AssistantState, string> = {
  idle: "En espera",
  listening: "Escuchando…",
  processing: "Procesando…",
  speaking: "Hablando…",
};

// Voz de salida vía /api/speak (OpenRouter, con ElevenLabs como respaldo).
const VOICE_OUTPUT_ENABLED = true;

export default function Home() {
  const [state, setState] = useState<AssistantState>("idle");
  const [lastReply, setLastReply] = useState<string>(
    `Hola ${USER_NAME}, soy ${ASSISTANT_NAME}. Toca el micrófono para hablarme.`
  );
  const [pendingAction, setPendingAction] = useState<AssistantAction | null>(null);
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const { amplitude: speakAmplitude, playWithAmplitude, stop: stopSpeaking } = useAudioAmplitude();

  const speak = useCallback(async (text: string) => {
    setState("speaking");
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Error al generar la voz.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      playWithAmplitude(url, () => {
        setState("idle");
        URL.revokeObjectURL(url);
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error al hablar.");
      setState("idle");
    }
  }, [playWithAmplitude]);

  const handleFinalTranscript = useCallback(async (text: string) => {
    if (!text) {
      setState("idle");
      return;
    }
    setState("processing");
    setErrorMsg(null);
    setSources([]);
    try {
      // Hasta 2 vueltas: una acción de riesgo bajo (p. ej. buscar archivos) se ejecuta
      // sola y su resultado vuelve al cerebro como siguiente turno.
      for (let turn = 0; turn < 2; turn++) {
        const res = await fetch("/api/brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history: historyRef.current }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Error al pensar la respuesta.");
        }
        const data = await res.json();
        historyRef.current = [
          ...historyRef.current,
          { role: "user" as const, content: text },
          { role: "assistant" as const, content: data.reply },
        ].slice(-12);
        setLastReply(data.reply);
        setSources(Array.isArray(data.sources) ? data.sources : []);

        const action: AssistantAction | null = data.action ?? null;
        if (action && turn === 0 && isAutoRun(action)) {
          const out = await runAssistantAction(action);
          if (out.followUp) {
            text = out.followUp;
            continue;
          }
        }
        setPendingAction(action);
        if (VOICE_OUTPUT_ENABLED) {
          await speak(data.reply);
        } else {
          setState("idle");
        }
        return;
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Algo salió mal.");
      setState("idle");
    }
  }, [speak]);

  const voice = useVoiceInput(handleFinalTranscript);
  const isListening = voice.status === "listening";
  const effectiveState: AssistantState = isListening
    ? "listening"
    : voice.status === "processing"
      ? "processing"
      : state;
  const amplitude = isListening ? voice.level : speakAmplitude;
  const shownError = errorMsg ?? voice.error;

  const handleMicClick = useCallback(() => {
    if (voice.status === "listening") {
      voice.stop();
      return;
    }
    if (voice.status === "processing" || state === "processing") return;
    if (state === "speaking") {
      stopSpeaking();
      setState("idle");
    }
    setErrorMsg(null);
    setPendingAction(null);
    voice.start();
  }, [voice, state, stopSpeaking]);

  const handleTextSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = textInput.trim();
      if (!text || state === "processing" || state === "speaking") return;
      setTextInput("");
      handleFinalTranscript(text);
    },
    [textInput, state, handleFinalTranscript]
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-between bg-background px-6 py-12 text-foreground">
      <header className="text-center">
        <h1 className="font-[family-name:var(--font-heading)] text-2xl tracking-wide text-core">
          {ASSISTANT_NAME}
        </h1>
        <p className="mt-1 font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.2em] text-emerald/70">
          {STATE_LABEL[effectiveState]}
        </p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <HologramCore state={effectiveState} amplitude={amplitude} size={340} />

        <AnimatePresence mode="wait">
          <motion.p
            key={isListening ? "listening" : lastReply}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="max-w-md text-center text-lg text-foreground/90"
          >
            {isListening ? "Te escucho…" : lastReply}
          </motion.p>
        </AnimatePresence>

        {sources.length > 0 && (
          <p className="max-w-md text-center text-[11px] text-foreground/40">
            Fuentes:{" "}
            {sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && " · "}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground/70"
                >
                  {s.title.length > 40 ? `${s.title.slice(0, 40)}…` : s.title}
                </a>
              </span>
            ))}
          </p>
        )}

        {shownError && (
          <p className="max-w-md text-center text-sm text-accent-spark/80">{shownError}</p>
        )}

        <AnimatePresence>
          {pendingAction && (
            <ActionCard
              action={pendingAction}
              onDone={(followUp) => {
                setPendingAction(null);
                // El resultado (portapapeles, archivos) vuelve al cerebro como siguiente turno.
                if (followUp) handleFinalTranscript(followUp);
              }}
            />
          )}
        </AnimatePresence>
      </div>

      <form onSubmit={handleTextSubmit} className="mb-6 flex w-full max-w-sm gap-2">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          disabled={state === "processing" || state === "speaking"}
          placeholder={`Escribile a ${ASSISTANT_NAME}...`}
          className="flex-1 rounded-lg border border-emerald/30 bg-panel px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 outline-none focus:border-turquoise/60 disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={state === "processing" || state === "speaking" || !textInput.trim()}
          className="rounded-lg bg-emerald/90 px-4 py-2 text-sm font-medium text-background transition hover:bg-emerald disabled:opacity-40"
        >
          Enviar
        </button>
      </form>

      <button
        onClick={handleMicClick}
        disabled={effectiveState === "processing"}
        aria-pressed={isListening}
        className="relative flex h-16 w-16 items-center justify-center rounded-full border border-turquoise/50 bg-panel text-core transition disabled:opacity-40 active:scale-95"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-6 w-6"
        >
          <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
          <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A7 7 0 0 0 19 11Z" />
        </svg>
      </button>
      <p className="mt-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-foreground/40">
        {isListening ? "Toca para enviar" : effectiveState === "speaking" ? "Toca para interrumpir" : "Toca para hablar"}
      </p>
    </main>
  );
}
