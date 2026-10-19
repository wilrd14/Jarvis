"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import HologramCore, { AssistantState } from "@/components/HologramCore";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useAudioAmplitude } from "@/hooks/useAudioAmplitude";
import { ASSISTANT_NAME, USER_NAME } from "@/lib/config";
import { isAutoRun, runAssistantAction, type AssistantAction } from "@/lib/actions";
import { useReminders } from "@/hooks/useReminders";
import ActionCard from "@/components/ActionCard";
import SettingsPanel, { type PublicSettings } from "@/components/SettingsPanel";

// Margen tras terminar el audio de Jarvis antes de reabrir el micrófono
// (evita captar la cola/eco de su propia voz).
const REOPEN_DELAY_MS = 700;
// En modo conversación, sin voz durante este tiempo se cierra el micrófono.
const CONVERSATION_NO_SPEECH_MS = 8000;

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
  const [pendingToken, setPendingToken] = useState<string | undefined>(undefined);
  const [sources, setSources] = useState<{ title: string; url: string }[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const reopenTimerRef = useRef<number | null>(null);
  const settingsRef = useRef<PublicSettings | null>(null);
  const startVoiceRef = useRef<(opts?: { noSpeechMs?: number }) => void>(() => {});
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const { amplitude: speakAmplitude, playWithAmplitude, stop: stopSpeaking } = useAudioAmplitude();

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const cancelReopen = useCallback(() => {
    if (reopenTimerRef.current !== null) {
      window.clearTimeout(reopenTimerRef.current);
      reopenTimerRef.current = null;
    }
    setReopening(false);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PublicSettings | null) => {
        if (!data) return;
        setSettings(data);
        if (!data.hasKey) setSettingsOpen(true);
      })
      .catch(() => {});
    return () => cancelReopen();
  }, [cancelReopen]);

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
        // Modo conversación: reabrir el micrófono solo cuando el audio terminó (+ margen).
        if (settingsRef.current?.conversationMode) {
          setReopening(true);
          reopenTimerRef.current = window.setTimeout(() => {
            reopenTimerRef.current = null;
            setReopening(false);
            startVoiceRef.current({ noSpeechMs: CONVERSATION_NO_SPEECH_MS });
          }, REOPEN_DELAY_MS);
        }
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error al hablar.");
      setState("idle");
    }
  }, [playWithAmplitude]);

  const handleFinalTranscript = useCallback(async (text: string, opts?: { untrusted?: boolean }) => {
    if (!text) {
      setState("idle");
      return;
    }
    setState("processing");
    setErrorMsg(null);
    setSources([]);
    try {
      // Hasta 2 vueltas: una acción de riesgo bajo (buscar archivos, notas, recordatorios...)
      // se ejecuta sola; su resultado vuelve al cerebro (followUp) o Jarvis lo dice (message).
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
        let reply: string = data.reply;
        let action: AssistantAction | null = data.action ?? null;

        // Un turno originado en datos externos (portapapeles) nunca ejecuta acciones solo.
        if (action && turn === 0 && !opts?.untrusted && isAutoRun(action)) {
          try {
            const out = await runAssistantAction(action);
            if (out.followUp) {
              historyRef.current = [
                ...historyRef.current,
                { role: "user" as const, content: text },
                { role: "assistant" as const, content: reply },
              ].slice(-12);
              text = out.followUp;
              continue;
            }
            if (out.message) reply = out.message;
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
        setSources(Array.isArray(data.sources) ? data.sources : []);
        setPendingAction(action);
        setPendingToken(typeof data.actionToken === "string" ? data.actionToken : undefined);
        if (VOICE_OUTPUT_ENABLED) {
          await speak(reply);
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

  useReminders(speak);

  const voice = useVoiceInput(handleFinalTranscript, { silenceMs: settings?.silenceMs });
  useEffect(() => {
    startVoiceRef.current = (opts) => {
      void voice.start(opts);
    };
  });
  const conversationOn = settings?.conversationMode ?? false;
  const isListening = voice.status === "listening";
  const effectiveState: AssistantState = isListening
    ? "listening"
    : voice.status === "processing"
      ? "processing"
      : state;
  const amplitude = isListening ? voice.level : speakAmplitude;
  const shownError = errorMsg ?? voice.error;

  const handleMicClick = useCallback(() => {
    // Un clic siempre detiene el ciclo de conversación pendiente.
    if (reopening) {
      cancelReopen();
      return;
    }
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
  }, [voice, state, stopSpeaking, reopening, cancelReopen]);

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
        {conversationOn && (
          <p
            className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-0.5 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest ${
              isListening || reopening
                ? "border-accent-spark/70 text-accent-spark"
                : "border-emerald/30 text-emerald/60"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full bg-current ${isListening || reopening ? "animate-pulse" : ""}`}
            />
            {reopening
              ? "Conversación: abriendo micrófono…"
              : isListening
                ? "Conversación: te escucho"
                : "Modo conversación"}
          </p>
        )}
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
              token={pendingToken}
              onDone={(out) => {
                setPendingAction(null);
                if (out?.followUp) {
                  // El resultado (portapapeles, archivos) vuelve al cerebro como siguiente turno.
                  handleFinalTranscript(out.followUp, { untrusted: true });
                } else if (out?.message) {
                  setLastReply(out.message);
                  void speak(out.message);
                }
              }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* El cuadro de texto se oculta mientras el usuario habla por voz. */}
      <AnimatePresence>
        {!isListening && !reopening && (
          <motion.form
            key="text-input"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleTextSubmit}
            className="mb-6 flex w-full max-w-sm gap-2"
          >
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
          </motion.form>
        )}
      </AnimatePresence>

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
        {reopening ? "Toca para cancelar" : isListening ? "Toca para enviar" : effectiveState === "speaking" ? "Toca para interrumpir" : "Toca para hablar"}
      </p>

      <button
        onClick={() => setSettingsOpen(true)}
        aria-label="Ajustes"
        title="Ajustes"
        className="fixed right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-emerald/20 bg-panel/70 text-foreground/50 transition hover:border-turquoise/60 hover:text-core"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-[18px] w-[18px]">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      </button>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        forced={settings !== null && !settings.hasKey}
        onClose={() => setSettingsOpen(false)}
        onSaved={(s) => {
          setSettings(s);
          if (!s.conversationMode) cancelReopen();
        }}
      />
    </main>
  );
}
