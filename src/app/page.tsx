"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import HologramCore, { AssistantState } from "@/components/HologramCore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useAudioAmplitude } from "@/hooks/useAudioAmplitude";
import { ASSISTANT_NAME, USER_NAME } from "@/lib/config";
import { isAutoRunAction, runAssistantAction, type AssistantAction } from "@/lib/actions";
import { useReminders } from "@/hooks/useReminders";
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
    try {
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
      // Acciones inocuas (notas, recordatorios...): se ejecutan al instante y Jarvis dice el resultado.
      let reply: string = data.reply;
      let action: AssistantAction | null = data.action ?? null;
      if (action && isAutoRunAction(action)) {
        try {
          reply = (await runAssistantAction(action)) ?? reply;
        } catch (err) {
          reply = err instanceof Error ? err.message : reply;
        }
        action = null;
      }
      historyRef.current = [
        ...historyRef.current,
        { role: "user" as const, content: text },
        { role: "assistant" as const, content: reply },
      ].slice(-12);
      setLastReply(reply);
      setPendingAction(action);
      if (VOICE_OUTPUT_ENABLED) {
        await speak(reply);
      } else {
        setState("idle");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Algo salió mal.");
      setState("idle");
    }
  }, [speak]);

  useReminders(speak);

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

        {shownError && (
          <p className="max-w-md text-center text-sm text-accent-spark/80">{shownError}</p>
        )}

        <AnimatePresence>
          {pendingAction && (
            <ActionCard action={pendingAction} onDone={(message) => {
                setPendingAction(null);
                if (message) {
                  setLastReply(message);
                  void speak(message);
                }
              }} />
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
