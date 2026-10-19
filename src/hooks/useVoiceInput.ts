"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus = "idle" | "listening" | "processing";

const SILENCE_MS = 1200; // silencio tras la voz para cortar solo
const MIN_VOICE_MS = 300; // voz mínima para considerarlo habla
const MAX_RECORD_MS = 30_000;
const NO_SPEECH_TIMEOUT_MS = 10_000; // si nadie habla, se cancela
const CALIBRATION_MS = 400; // ruido ambiente inicial
const MIN_THRESHOLD = 0.015; // RMS mínimo para contar como voz
const NOISE_FACTOR = 3;
const TARGET_RATE = 16000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

// Decodifica lo grabado (webm/opus, mp4...) y lo convierte a WAV PCM16 mono 16 kHz.
async function blobToWav(blob: Blob): Promise<Blob> {
  const arr = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
  const decoded = await ctx.decodeAudioData(arr);
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }
  return encodeWav(mono, decoded.sampleRate);
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "No tengo permiso para usar el micrófono. Habilítalo en los permisos del navegador (icono del candado) y vuelve a intentarlo.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No encuentro ningún micrófono conectado.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "El micrófono está siendo usado por otra aplicación o no responde.";
  }
  return "No pude acceder al micrófono.";
}

export function useVoiceInput(onFinal: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const sessionRef = useRef<{
    cancelled: boolean;
    discard: boolean;
    stream: MediaStream;
    ctx: AudioContext;
    recorder: MediaRecorder;
    timer: number;
    chunks: Blob[];
  } | null>(null);

  const teardown = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    window.clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    s.ctx.close().catch(() => {});
    setLevel(0);
  }, []);

  // Detiene la grabación; con discard=true no se envía nada.
  const finish = useCallback((discard: boolean) => {
    const s = sessionRef.current;
    if (!s || s.recorder.state === "inactive") return;
    s.discard = discard;
    window.clearInterval(s.timer);
    s.recorder.stop();
  }, []);

  const startingRef = useRef(false);

  const start = useCallback(async () => {
    if (sessionRef.current || startingRef.current) return;
    startingRef.current = true;
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      startingRef.current = false;
      setError("Este navegador no permite grabar audio.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      startingRef.current = false;
      setError(micErrorMessage(err));
      return;
    }
    startingRef.current = false;

    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const t0 = performance.now();
    let last = t0;
    let calibSum = 0;
    let calibN = 0;
    let threshold = MIN_THRESHOLD;
    let voiceMs = 0;
    let lastVoiceAt = 0;
    let smooth = 0;

    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);

      smooth = smooth * 0.6 + Math.min(1, rms * 6) * 0.4;
      setLevel(smooth);

      const elapsed = now - t0;
      if (elapsed < CALIBRATION_MS) {
        calibSum += rms;
        calibN++;
        if (calibN > 0) threshold = Math.max(MIN_THRESHOLD, (calibSum / calibN) * NOISE_FACTOR);
        return;
      }

      if (rms > threshold) {
        voiceMs += dt;
        lastVoiceAt = now;
      }

      if (voiceMs >= MIN_VOICE_MS && now - lastVoiceAt >= SILENCE_MS) {
        finish(false);
      } else if (elapsed >= MAX_RECORD_MS) {
        finish(false);
      } else if (voiceMs < MIN_VOICE_MS && elapsed >= NO_SPEECH_TIMEOUT_MS) {
        finish(true); // nadie habló
      }
    }, 50);

    const session = { cancelled: false, discard: false, stream, ctx, recorder, timer, chunks };
    sessionRef.current = session;

    recorder.onstop = async () => {
      const heardVoice = voiceMs >= MIN_VOICE_MS;
      const mime = recorder.mimeType || "audio/webm";
      teardown();
      sessionRef.current = null;
      if (session.discard || session.cancelled || !heardVoice || chunks.length === 0) {
        setStatus("idle");
        return;
      }
      setStatus("processing");
      try {
        const wav = await blobToWav(new Blob(chunks, { type: mime }));
        const res = await fetch("/api/listen", {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: wav,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "No se pudo transcribir el audio.");
        const text = String(data?.text ?? "").trim();
        setStatus("idle");
        if (text) onFinalRef.current(text);
        else setError("No te entendí, ¿puedes repetirlo?");
      } catch (err) {
        setStatus("idle");
        setError(err instanceof Error ? err.message : "No se pudo transcribir el audio.");
      }
    };

    recorder.start();
    setStatus("listening");
  }, [finish, teardown]);

  // Corte manual: envía lo grabado hasta ahora.
  const stop = useCallback(() => finish(false), [finish]);

  // Cancela sin enviar nada.
  const cancel = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    s.cancelled = true;
    finish(true);
  }, [finish]);

  useEffect(() => {
    return () => {
      const s = sessionRef.current;
      if (s) {
        s.cancelled = true;
        if (s.recorder.state !== "inactive") s.recorder.stop();
        else teardown();
      }
    };
  }, [teardown]);

  return { status, level, error, start, stop, cancel };
}
