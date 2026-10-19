"use client";

import { useCallback, useRef, useState } from "react";

export function useAudioAmplitude() {
  const [amplitude, setAmplitude] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioElRef.current?.pause();
    setAmplitude(0);
  }, []);

  const playWithAmplitude = useCallback((audioUrl: string, onEnded?: () => void) => {
    stop();

    const audio = new Audio(audioUrl);
    audioElRef.current = audio;

    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const audioCtx = audioCtxRef.current;
    // Chrome crea el contexto suspendido si no hubo gesto reciente: sin esto no suena nada.
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const source = audioCtx.createMediaElementSource(audio);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      const analyserNode = analyserRef.current;
      if (!analyserNode) return;
      analyserNode.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255;
      setAmplitude(avg);
      rafRef.current = requestAnimationFrame(tick);
    }

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
    rafRef.current = requestAnimationFrame(tick);
  }, [stop]);

  return { amplitude, playWithAmplitude, stop };
}
