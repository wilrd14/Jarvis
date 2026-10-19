"use client";

import { useEffect, useRef } from "react";

interface DueItem {
  id: string;
  kind: "reminder" | "timer" | "alarm";
  text: string;
}

const POLL_MS = 5000;

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/** Beep corto generado con WebAudio (sin archivos). Las alarmas suenan más. */
function beep(times: number) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  void ctx.resume().catch(() => undefined);
  const start = ctx.currentTime + 0.05;
  for (let i = 0; i < times; i++) {
    const t = start + i * 0.32;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = i % 2 === 0 ? 880 : 1175;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}

function titleFor(item: DueItem) {
  return item.kind === "timer" ? "Temporizador" : item.kind === "alarm" ? "Alarma" : "Recordatorio";
}

function spokenFor(items: DueItem[]): string {
  return items
    .map((i) =>
      i.kind === "timer"
        ? `Tu temporizador ha terminado: ${i.text}.`
        : i.kind === "alarm"
          ? `Suena tu alarma: ${i.text}.`
          : `Recordatorio: ${i.text}.`
    )
    .join(" ");
}

function notify(item: DueItem) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(titleFor(item), { body: item.text, tag: item.id });
    }
  } catch {
    // Algunos entornos (móvil) no permiten `new Notification`; el aviso hablado cubre.
  }
}

/**
 * Sondea /api/reminders/due y, al vencer algo, muestra notificación nativa,
 * suena un beep y llama a `announce` para que Jarvis lo diga en voz alta.
 * El servidor entrega cada aviso una sola vez; lo vencido con la app cerrada
 * sale en la primera consulta al abrirla.
 */
export function useReminders(announce: (text: string) => void) {
  const announceRef = useRef(announce);
  useEffect(() => {
    announceRef.current = announce;
  }, [announce]);

  useEffect(() => {
    let busy = false;

    // Permisos y audio solo pueden activarse tras un gesto del usuario.
    const unlock = () => {
      getAudioCtx()?.resume().catch(() => undefined);
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await fetch("/api/reminders/due", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { due?: DueItem[] };
        const due = Array.isArray(data.due) ? data.due : [];
        // Sin comprobar `stopped`: el servidor ya los marcó como entregados.
        if (!due.length) return;
        due.forEach(notify);
        beep(due.some((d) => d.kind === "alarm") ? 6 : 3);
        announceRef.current(spokenFor(due));
      } catch {
        // Sin red o servidor reiniciando: se reintenta en el siguiente ciclo.
      } finally {
        busy = false;
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
}
