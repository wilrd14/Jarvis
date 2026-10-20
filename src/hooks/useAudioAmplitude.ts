"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Cola de audio por Web Audio: cada frase se programa justo al terminar la anterior (sin huecos). */
interface QueueStream {
  nextTime: number;
  sources: Set<AudioBufferSourceNode>;
  pending: number;
  inputDone: boolean;
  finished: boolean;
  onEnded: (reason: "ended" | "cancelled") => void;
}

export interface AudioQueue {
  /** Empieza una cola nueva (detiene lo que sonara). `onEnded` se llama una sola vez. */
  begin: (onEnded: (reason: "ended" | "cancelled") => void) => void;
  /** Decodifica y encadena un audio (WAV/MP3). Devuelve false si no se pudo decodificar. */
  push: (data: ArrayBuffer) => Promise<boolean>;
  /** No llegarán más audios: la cola termina cuando suene el último. */
  end: () => void;
  /** Corta el audio y cancela la cola. */
  cancel: () => void;
}

/**
 * iOS: tras usar el micrófono la sesión de audio queda en modo "llamada" (auricular, o mudo con el
 * interruptor de silencio). "playback" hace sonar la respuesta por el altavoz; "play-and-record" se
 * pone antes de grabar. Navegadores sin Audio Session API lo ignoran.
 */
export function setAudioSessionType(type: "playback" | "play-and-record") {
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== type) session.type = type;
  } catch {
    /* sin Audio Session API */
  }
}

export function useAudioAmplitude() {
  const [amplitude, setAmplitude] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<QueueStream | null>(null);

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    // Chrome crea el contexto suspendido si no hubo gesto reciente: sin esto no suena nada.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }, []);

  // iOS/Safari solo deja sonar el audio si el contexto se crea y se reanuda dentro de un gesto del
  // usuario; las respuestas llegan tras esperas de red, ya sin gesto. Se "desbloquea" en el primer toque.
  useEffect(() => {
    const events = ["pointerdown", "touchend", "click", "keydown"] as const;
    const unlock = () => {
      const ctx = getCtx();
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* sin audio disponible */
      }
      if (ctx.state === "running") events.forEach((e) => window.removeEventListener(e, unlock, true));
    };
    events.forEach((e) => window.addEventListener(e, unlock, true));
    return () => events.forEach((e) => window.removeEventListener(e, unlock, true));
  }, [getCtx]);

  const stopTick = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const startTick = useCallback((analyser: AnalyserNode) => {
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    function tick() {
      const analyserNode = analyserRef.current;
      if (!analyserNode) return;
      analyserNode.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      setAmplitude(sum / data.length / 255);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stop = useCallback(() => {
    stopTick();
    audioElRef.current?.pause();
    const q = queueRef.current;
    if (q) {
      queueRef.current = null;
      if (!q.finished) {
        q.finished = true;
        for (const s of q.sources) {
          s.onended = null;
          try {
            s.stop();
          } catch {
            /* ya terminado */
          }
        }
        q.sources.clear();
        q.onEnded("cancelled");
      }
    }
    setAmplitude(0);
  }, [stopTick]);

  const playWithAmplitude = useCallback((audioUrl: string, onEnded?: () => void) => {
    stop();
    setAudioSessionType("playback");

    const audio = new Audio(audioUrl);
    audioElRef.current = audio;

    const audioCtx = getCtx();
    const source = audioCtx.createMediaElementSource(audio);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    audio.onended = () => {
      stop();
      onEnded?.();
    };

    audio.onerror = () => {
      stop();
      onEnded?.();
    };

    audio.play().catch(() => {
      stop();
      onEnded?.();
    });
    startTick(analyser);
  }, [stop, getCtx, startTick]);

  const finishIfIdle = useCallback((q: QueueStream) => {
    if (q.finished || !q.inputDone || q.pending > 0 || q.sources.size > 0) return;
    q.finished = true;
    if (queueRef.current === q) queueRef.current = null;
    stopTick();
    setAmplitude(0);
    q.onEnded("ended");
  }, [stopTick]);

  const queue = useMemo<AudioQueue>(() => ({
    begin: (onEnded) => {
      stop();
      setAudioSessionType("playback");
      const ctx = getCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(ctx.destination);
      queueRef.current = {
        nextTime: 0,
        sources: new Set(),
        pending: 0,
        inputDone: false,
        finished: false,
        onEnded,
      };
      startTick(analyser); // la animación sigue viva durante toda la cola, también entre frases
    },
    push: async (data) => {
      const q = queueRef.current;
      const analyser = analyserRef.current;
      if (!q || q.finished || !analyser) return false;
      const ctx = getCtx();
      q.pending++;
      try {
        const buffer = await ctx.decodeAudioData(data);
        if (queueRef.current !== q || q.finished) return false;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(analyser);
        const at = Math.max(ctx.currentTime + 0.02, q.nextTime);
        q.nextTime = at + buffer.duration;
        q.sources.add(src);
        src.onended = () => {
          q.sources.delete(src);
          finishIfIdle(q);
        };
        src.start(at);
        return true;
      } catch {
        return false;
      } finally {
        q.pending--;
        finishIfIdle(q);
      }
    },
    end: () => {
      const q = queueRef.current;
      if (!q) return;
      q.inputDone = true;
      finishIfIdle(q);
    },
    cancel: stop,
  }), [stop, getCtx, startTick, finishIfIdle]);

  return { amplitude, playWithAmplitude, stop, queue };
}
