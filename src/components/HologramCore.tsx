"use client";

import { useEffect, useRef } from "react";

export type AssistantState = "idle" | "listening" | "processing" | "speaking";

interface HologramCoreProps {
  state: AssistantState;
  amplitude: number; // 0..1, live mic/audio amplitude for listening/speaking
  size?: number;
}

interface Particle {
  angle: number;
  radius: number;
  baseRadius: number;
  speed: number;
  size: number;
  hueMix: number; // 0 = core color, 1 = turquoise edge color
  flicker: number;
}

const COLORS = {
  core: [232, 255, 246] as const, // #e8fff6
  emerald: [31, 224, 160] as const, // #1fe0a0
  turquoise: [20, 196, 196] as const, // #14c4c4
  spark: [43, 255, 184] as const, // #2bffb8
};

function mix(a: readonly number[], b: readonly number[], t: number) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgba(c: readonly number[], alpha: number) {
  return `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${alpha})`;
}

export default function HologramCore({ state, amplitude, size = 360 }: HologramCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rotationRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  const amplitudeRef = useRef(amplitude);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    amplitudeRef.current = amplitude;
  }, [amplitude]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
  }, []);

  useEffect(() => {
    const particleCount = 260;
    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      const baseRadius = 40 + Math.random() * 130;
      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: baseRadius,
        baseRadius,
        speed: (0.15 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1),
        size: 0.6 + Math.random() * 1.8,
        hueMix: Math.random(),
        flicker: Math.random() * Math.PI * 2,
      });
    }
    particlesRef.current = particles;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    let lastTime = performance.now();

    function draw(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      if (!ctx) return;

      const reduced = reducedMotionRef.current;
      const currentState = stateRef.current;
      const amp = amplitudeRef.current;

      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = "lighter";

      // speeds & intensity per state
      let ringSpeed = 0.15;
      let breathe = Math.sin(now / 900) * 0.04 + 1;
      let coreIntensity = 0.55;
      let particleReactivity = 0;

      switch (currentState) {
        case "idle":
          ringSpeed = 0.12;
          coreIntensity = 0.5 + Math.sin(now / 1200) * 0.08;
          break;
        case "listening":
          ringSpeed = 0.35 + amp * 0.6;
          coreIntensity = 0.65 + amp * 0.35;
          particleReactivity = amp;
          breathe = 1 + amp * 0.15;
          break;
        case "processing":
          ringSpeed = 0.9;
          coreIntensity = 0.6 + Math.sin(now / 150) * 0.15;
          break;
        case "speaking":
          ringSpeed = 0.3 + amp * 0.5;
          coreIntensity = 0.6 + amp * 0.4;
          particleReactivity = amp * 0.8;
          breathe = 1 + amp * 0.12;
          break;
      }

      if (reduced) {
        ringSpeed *= 0.15;
      }

      rotationRef.current += ringSpeed * dt;
      const rot = rotationRef.current;

      // radiating fine lines
      const lineCount = 48;
      for (let i = 0; i < lineCount; i++) {
        const a = (i / lineCount) * Math.PI * 2 + rot * 0.5;
        const inner = 30 * breathe;
        const outer = inner + 60 + Math.sin(now / 500 + i) * 8 * (0.3 + coreIntensity);
        const color = mix(COLORS.emerald, COLORS.turquoise, i / lineCount);
        ctx.strokeStyle = rgba(color, 0.12 + 0.1 * coreIntensity);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
        ctx.stroke();
      }

      // concentric rings, alternating rotation
      const ringDefs = [
        { r: 70, width: 1.2, dir: 1, dash: false },
        { r: 100, width: 1, dir: -1, dash: true },
        { r: 135, width: 0.8, dir: 1, dash: false },
        { r: 165, width: 0.6, dir: -1, dash: true },
      ];
      for (const ring of ringDefs) {
        const a = rot * ring.dir;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.beginPath();
        if (ring.dash) ctx.setLineDash([2, 6]);
        else ctx.setLineDash([]);
        ctx.strokeStyle = rgba(
          mix(COLORS.emerald, COLORS.turquoise, ring.r / 165),
          0.35 * coreIntensity
        );
        ctx.lineWidth = ring.width;
        ctx.ellipse(0, 0, ring.r * breathe, ring.r * 0.94 * breathe, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // particles
      for (const p of particlesRef.current) {
        p.angle += p.speed * dt * (0.5 + particleReactivity);
        p.flicker += dt * 3;
        const wobble = Math.sin(p.flicker) * 6 * (0.3 + particleReactivity);
        const r = (p.baseRadius + wobble) * breathe;
        const x = cx + Math.cos(p.angle) * r;
        const y = cy + Math.sin(p.angle) * r * 0.94;
        const color = mix(COLORS.core, COLORS.turquoise, p.hueMix);
        const alpha = (0.25 + 0.5 * Math.abs(Math.sin(p.flicker))) * (0.5 + coreIntensity * 0.5);
        ctx.beginPath();
        ctx.fillStyle = rgba(color, alpha);
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // central glow core
      const coreRadius = 26 * breathe;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 2.2);
      grad.addColorStop(0, rgba(COLORS.core, 0.95 * coreIntensity));
      grad.addColorStop(0.4, rgba(COLORS.emerald, 0.6 * coreIntensity));
      grad.addColorStop(0.75, rgba(COLORS.turquoise, 0.25 * coreIntensity));
      grad.addColorStop(1, rgba(COLORS.turquoise, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgba(COLORS.core, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius * 0.4, 0, Math.PI * 2);
      ctx.fill();

      // processing extra sparks
      if (currentState === "processing" && !reduced) {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 40 + Math.random() * 100;
          ctx.beginPath();
          ctx.fillStyle = rgba(COLORS.spark, 0.5);
          ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Núcleo de energía de Jarvis, estado: ${state}`}
      style={{ display: "block" }}
    />
  );
}
