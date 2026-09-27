"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "framer-motion";

/**
 * Katie's voice. The feel of the assistant orb that lives in the real island,
 * in purple, and deliberately not that product: no name, no mark, its own
 * palette.
 *
 * What makes that orb read as alive is not one gradient but several soft
 * light sources drifting past each other at different speeds inside a sphere,
 * so the colour never repeats the same way twice. Here that is four blurred
 * blobs on independent rotations, clipped to a circle, with a glass highlight
 * on top. Voice level drives two things: how big the light is, and how fast it
 * moves. Silence is a slow breath, not a freeze.
 */

export type VoiceState = "listening" | "thinking" | "speaking";

const BLOBS = [
  // colour, size (fraction of orb), orbit radius, seconds per turn, direction
  { c: "#8B5CF6", s: 0.95, r: 0.16, t: 7.5, d: 1 },
  { c: "#D946EF", s: 0.7, r: 0.26, t: 5.2, d: -1 },
  { c: "#6366F1", s: 0.75, r: 0.24, t: 6.4, d: 1 },
  { c: "#F0ABFC", s: 0.42, r: 0.3, t: 3.9, d: -1 },
];

export function VoiceOrb({
  size,
  level,
  state,
}: {
  size: number;
  /** 0-1, the current voice level. */
  level: number;
  state: VoiceState;
}) {
  const reduced = useReducedMotion();
  // Levels arrive jagged; the spring is what turns them into breathing.
  const lvl = useSpring(0, { stiffness: 180, damping: 18, mass: 0.6 });
  useEffect(() => {
    lvl.set(reduced ? 0.3 : level);
  }, [level, reduced, lvl]);

  const scale = useTransform(lvl, [0, 1], [0.86, 1.12]);
  const glow = useTransform(lvl, [0, 1], [0.35, 0.9]);
  // Thinking spins faster with a steady level; speaking follows the voice.
  const speed = state === "thinking" ? 1.9 : state === "speaking" ? 1.35 : 1;

  return (
    <motion.div
      className="relative shrink-0"
      style={{ width: size, height: size, scale }}
      aria-hidden
    >
      {/* Bloom behind the sphere, so it lights the black around it. */}
      <motion.div
        className="absolute rounded-full"
        style={{
          inset: -size * 0.28,
          opacity: glow,
          background: "radial-gradient(circle, rgba(168,85,247,0.75) 0%, rgba(124,58,237,0.25) 45%, transparent 70%)",
          filter: `blur(${Math.max(4, size * 0.18)}px)`,
        }}
      />
      <div
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{ background: "radial-gradient(circle at 50% 60%, #2E1065 0%, #0B0418 80%)" }}
      >
        {BLOBS.map((b, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2"
            style={{
              width: 0,
              height: 0,
              animation: reduced ? undefined : `island-orbit ${b.t / speed}s linear infinite`,
              animationDirection: b.d < 0 ? "reverse" : "normal",
            }}
          >
            <div
              className="absolute rounded-full"
              style={{
                width: size * b.s,
                height: size * b.s,
                left: size * b.r - (size * b.s) / 2,
                top: -(size * b.s) / 2,
                background: `radial-gradient(circle, ${b.c} 0%, ${b.c}00 70%)`,
                filter: `blur(${size * 0.08}px)`,
                mixBlendMode: "screen",
              }}
            />
          </div>
        ))}
        {/* Glass: a soft top highlight and a darker lower rim give it depth. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 35% 25%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 32%), radial-gradient(circle at 50% 120%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 55%)",
          }}
        />
        <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/15" />
      </div>
      <style>{`@keyframes island-orbit { to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  );
}

/**
 * A live waveform in the same purple, for the right-hand side of the pill.
 * Bars are shaped by the level with a little independent jitter each, so it
 * reads as a voice, not an equaliser.
 */
export function VoiceWave({ level, bars = 5, height = 18 }: { level: number; bars?: number; height?: number }) {
  const [jitter, setJitter] = useState<number[]>(() => Array.from({ length: bars }, () => 0.5));
  const reduced = useReducedMotion();
  const tick = useRef(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      tick.current++;
      setJitter((prev) => prev.map((v) => Math.min(1, Math.max(0.15, v + (Math.random() - 0.5) * 0.7))));
    }, 110);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <div className="flex items-center gap-[3px]" style={{ height }} aria-hidden>
      {jitter.map((j, i) => {
        // The middle bars carry the voice; the ends taper, like a real waveform.
        const centre = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2 + 0.5);
        const h = Math.max(0.14, Math.min(1, (0.25 + level * 0.9) * (0.45 + 0.55 * centre) * (0.6 + 0.4 * j)));
        return (
          <motion.div
            key={i}
            className="w-[3px] rounded-full"
            style={{ background: "linear-gradient(to top, #7C3AED, #E879F9)" }}
            animate={{ height: `${h * 100}%` }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.25 }}
          />
        );
      })}
    </div>
  );
}
