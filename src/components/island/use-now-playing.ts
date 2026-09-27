"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaAction, NowPlaying } from "@/lib/island/types";

const POLL_MS = 1000;

/**
 * The OS media session, polled once a second, with the position extrapolated
 * in between so the progress bar moves smoothly rather than ticking.
 *
 * Controls are optimistic: pressing pause flips the icon at once and the next
 * poll confirms or corrects it. Waiting a round trip to change an icon under
 * the user's finger reads as lag, even at 50 ms.
 */
export function useNowPlaying() {
  const [np, setNp] = useState<NowPlaying | null>(null);
  const [backend, setBackend] = useState<string>("");
  // Ignore polls that were in flight when an action landed; they carry the old state.
  const actedAt = useRef(0);

  const poll = useCallback(async () => {
    const started = Date.now();
    try {
      const r = await fetch("/api/island/media", { cache: "no-store" });
      const j = (await r.json()) as { backend: string; nowPlaying: NowPlaying | null };
      if (started < actedAt.current) return;
      setBackend(j.backend);
      setNp(j.nowPlaying);
    } catch {
      /* server restarting; the next poll will do */
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") poll();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const act = useCallback(
    async (action: MediaAction, seconds?: number) => {
      actedAt.current = Date.now();
      setNp((cur) => {
        if (!cur) return cur;
        const pos = positionNow(cur);
        if (action === "toggle")
          return { ...cur, status: cur.status === "playing" ? "paused" : "playing", position: pos, sampledAt: Date.now() };
        if (action === "seek") return { ...cur, position: seconds ?? 0, sampledAt: Date.now() };
        return cur;
      });
      await fetch("/api/island/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, seconds }),
      }).catch(() => undefined);
      // Skips change the track; give the player a beat to report the new one.
      setTimeout(() => {
        actedAt.current = 0;
        poll();
      }, action === "next" || action === "previous" ? 450 : 250);
    },
    [poll]
  );

  return { nowPlaying: np, backend, act };
}

export function positionNow(np: NowPlaying, now = Date.now()) {
  const p = np.status === "playing" ? np.position + (now - np.sampledAt) / 1000 : np.position;
  return np.duration > 0 ? Math.min(Math.max(0, p), np.duration) : Math.max(0, p);
}

/** A ticking clock for the progress bar, only while something is playing. */
export function useTicker(active: boolean, ms = 250) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

/**
 * The cover's dominant colour, for the waveform, the way the real island tints
 * its bars from the album. Falls back to white when the image will not let a
 * canvas read it (a cross-origin cover without CORS headers).
 */
export function useArtColor(src: string | null | undefined) {
  const [color, setColor] = useState("#ffffff");
  useEffect(() => {
    if (!src) return setColor("#ffffff");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 16;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        // Weight by saturation so a grey border does not win over the colour.
        let r = 0, g = 0, b = 0, wsum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]);
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const w = (mx - mn) / 255 + 0.02;
          r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; wsum += w;
        }
        r /= wsum; g /= wsum; b /= wsum;
        // Lift dark covers so the bars stay visible on black.
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const lift = lum < 110 ? 110 / Math.max(lum, 1) : 1;
        const f = (v: number) => Math.round(Math.min(255, v * lift));
        setColor(`rgb(${f(r)}, ${f(g)}, ${f(b)})`);
      } catch {
        setColor("#ffffff");
      }
    };
    img.onerror = () => setColor("#ffffff");
    img.src = src;
  }, [src]);
  return color;
}
