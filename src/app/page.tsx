"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import HologramCore, { AssistantState } from "@/components/HologramCore";
import {
  useSpeechRecognition,
  isSpeechRecognitionSupported,
} from "@/hooks/useSpeechRecognition";
import { useAudioAmplitude } from "@/hooks/useAudioAmplitude";
import { ASSISTANT_NAME, USER_NAME } from "@/lib/config";
import { runAssistantAction, type AssistantAction } from "@/lib/actions";

const STATE_LABEL: Record<AssistantState, string> = {
  idle: "En espera",
  listening: "Escuchando…",
  processing: "Procesando…",
  speaking: "Hablando…",
};

// La voz de ElevenLabs todavía no está lista (falta clonar una voz propia).
// Mientras tanto, Jarvis responde solo por texto.
const VOICE_OUTPUT_ENABLED = false;

export default function Home() {
  const [state, setState] = useState<AssistantState>("idle");
  const [lastReply, setLastReply] = useState<string>(
    `Hola ${USER_NAME}, soy ${ASSISTANT_NAME}. Mantené presionado el botón para hablarme.`
  );
  const [pendingAction, setPendingAction] = useState<AssistantAction | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");

  const { transcript, isListening, start, stop } = useSpeechRecognition();
  const { amplitude, playWithAmplitude } = useAudioAmplitude();

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
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Error al pensar la respuesta.");
      }
      const data = await res.json();
      setLastReply(data.reply);
      setPendingAction(data.action ?? null);
      if (VOICE_OUTPUT_ENABLED) {
        await speak(data.reply);
      } else {
        setState("idle");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Algo salió mal.");
      setState("idle");
    }
  }, [speak]);

  const handleMicDown = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      setErrorMsg(
        "Tu navegador no soporta reconocimiento de voz. Probá con Chrome de escritorio."
      );
      return;
    }
    setErrorMsg(null);
    setPendingAction(null);
    setState("listening");
    start(handleFinalTranscript);
  }, [start, handleFinalTranscript]);

  const handleMicUp = useCallback(() => {
    stop();
  }, [stop]);

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
          {STATE_LABEL[state]}
        </p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <HologramCore state={state} amplitude={amplitude} size={340} />

        <AnimatePresence mode="wait">
          <motion.p
            key={isListening ? transcript || "listening" : lastReply}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="max-w-md text-center text-lg text-foreground/90"
          >
            {isListening ? transcript || "…" : lastReply}
          </motion.p>
        </AnimatePresence>

        {errorMsg && (
          <p className="max-w-md text-center text-sm text-accent-spark/80">{errorMsg}</p>
        )}

        <AnimatePresence>
          {pendingAction && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-xl border border-emerald/30 bg-panel p-4 shadow-[0_0_30px_-10px_rgba(31,224,160,0.4)]"
            >
              <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-widest text-turquoise">
                {pendingAction.type === "email" ? "Correo listo" : "Evento listo"}
              </p>
              <p className="mt-2 text-sm text-foreground/80">
                {pendingAction.type === "email"
                  ? `Para: ${pendingAction.to} — ${pendingAction.subject}`
                  : pendingAction.title}
              </p>
              <button
                onClick={() => {
                  runAssistantAction(pendingAction);
                  setPendingAction(null);
                }}
                className="mt-3 w-full rounded-lg bg-emerald/90 px-4 py-2 text-sm font-medium text-background transition hover:bg-emerald"
              >
                Confirmar y abrir
              </button>
            </motion.div>
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
        onMouseDown={handleMicDown}
        onMouseUp={handleMicUp}
        onTouchStart={handleMicDown}
        onTouchEnd={handleMicUp}
        disabled={state === "processing" || state === "speaking"}
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
        Mantené presionado para hablar
      </p>
    </main>
  );
}
