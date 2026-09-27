"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup, motion, MotionConfig, useReducedMotion } from "framer-motion";
import { computeMorph, MOTION_PROFILES, type Footprint } from "@/lib/island-physics";
import type { Activity, MediaAction } from "@/lib/island/types";
import { AskField, present, type Presentation } from "./presentations";
import { SPEC } from "./spec";
import { useArtColor } from "./use-now-playing";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Mode =
  | { kind: "idle" }
  | { kind: "compact"; a: Activity }
  | { kind: "minimal"; attached: Activity; detached: Activity }
  | { kind: "expanded"; a: Activity; userOpened: boolean }
  | { kind: "ask" };

/** The activity list, live from the server. */
function useActivities() {
  const [list, setList] = useState<Activity[]>([]);
  useEffect(() => {
    const es = new EventSource("/api/island/activities");
    es.onmessage = (m) => {
      try {
        setList(JSON.parse(m.data));
      } catch {
        /* ignore a torn frame; the next one is a full list */
      }
    };
    return () => es.close();
  }, []);
  return list;
}

/**
 * The island, as the system component Apple makes it.
 *
 *   nothing live     -> the resting island
 *   one activity     -> compact: leading and trailing either side of centre
 *   two or more      -> minimal: the first attached, the second detached
 *   an alert         -> expanded on its own for a few seconds, then back
 *   click            -> expanded, until clicked again, Escape, or a click away
 *
 * The container's spring comes from the project's computeMorph, fed with the
 * spec sizes; elements shared between presentations move via layoutId.
 */
export default function IslandSystem({
  voiceLevel = 0,
  profileId = "fluid",
  askAgent = "katie",
}: {
  voiceLevel?: number;
  profileId?: string;
  askAgent?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const profile = MOTION_PROFILES.find((p) => p.id === profileId) ?? MOTION_PROFILES[0];
  const serverList = useActivities();

  // Optimistic media: the play/pause icon flips under the finger, and the next
  // server update (a new updatedAt) replaces the guess with the truth.
  const [mediaGuess, setMediaGuess] = useState<{ basis: number; patch: Partial<NonNullable<Activity["media"]>> } | null>(null);
  const list = useMemo(
    () =>
      serverList.map((a) =>
        a.kind === "media" && a.media && mediaGuess && mediaGuess.basis === a.updatedAt
          ? { ...a, media: { ...a.media, ...mediaGuess.patch } }
          : a
      ),
    [serverList, mediaGuess]
  );

  const media = list.find((a) => a.kind === "media")?.media;
  const artColor = useArtColor(media?.artUrl);

  const [opened, setOpened] = useState<string | "ask" | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [, forceTick] = useState(0);

  // Wake up exactly when the earliest alert expires, so it collapses on time.
  const now = Date.now();
  const nextAlertEnd = Math.min(...list.map((a) => (a.alertUntil && a.alertUntil > now ? a.alertUntil : Infinity)));
  useEffect(() => {
    if (!Number.isFinite(nextAlertEnd)) return;
    const id = setTimeout(() => forceTick((t) => t + 1), nextAlertEnd - Date.now() + 20);
    return () => clearTimeout(id);
  }, [nextAlertEnd]);

  // An opened activity that has ended closes.
  useEffect(() => {
    if (opened && opened !== "ask" && !list.some((a) => a.id === opened)) setOpened(null);
  }, [list, opened]);

  const act = useCallback(
    async (action: MediaAction, seconds?: number) => {
      const cur = serverList.find((a) => a.kind === "media");
      if (cur?.media) {
        const m = cur.media;
        const pos = m.status === "playing" ? m.position + (Date.now() - m.sampledAt) / 1000 : m.position;
        if (action === "toggle")
          setMediaGuess({ basis: cur.updatedAt, patch: { status: m.status === "playing" ? "paused" : "playing", position: pos, sampledAt: Date.now() } });
        if (action === "seek") setMediaGuess({ basis: cur.updatedAt, patch: { position: seconds ?? 0, sampledAt: Date.now() } });
      }
      await fetch("/api/island/media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, seconds }),
      }).catch(() => undefined);
    },
    [serverList]
  );

  const ask = useCallback(
    async (prompt: string) => {
      // Asked from the resting island: step back and let the reply arrive as an
      // activity. Asked from an open conversation: stay in it and watch.
      setOpened((o) => (o === "ask" ? null : o));
      await fetch("/api/island/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      }).catch(() => undefined);
    },
    []
  );

  //
  // Choose the presentation.
  //
  const alerting = list.find((a) => a.alertUntil && a.alertUntil > now && dismissed[a.id] !== a.updatedAt);
  let mode: Mode;
  if (opened === "ask") mode = { kind: "ask" };
  else if (opened && list.some((a) => a.id === opened)) mode = { kind: "expanded", a: list.find((a) => a.id === opened)!, userOpened: true };
  else if (alerting) mode = { kind: "expanded", a: alerting, userOpened: false };
  else if (list.length >= 2) mode = { kind: "minimal", attached: list[0], detached: list[1] };
  else if (list.length === 1) mode = { kind: "compact", a: list[0] };
  else mode = { kind: "idle" };

  const ctxFor = (userOpened: boolean) => ({ act, ask, userOpened, level: voiceLevel, artColor });
  const pres: Presentation | null =
    mode.kind === "compact" ? present(mode.a, ctxFor(false))
    : mode.kind === "expanded" ? present(mode.a, ctxFor(mode.userOpened))
    : mode.kind === "minimal" ? present(mode.attached, ctxFor(false))
    : null;
  const detachedPres = mode.kind === "minimal" ? present(mode.detached, ctxFor(false)) : null;

  //
  // Size. Everything is fixed by the spec except the expanded height, which
  // follows its content between 84 and 160 (a conversation you opened may run
  // taller: that is the island standing in for the app it would open).
  //
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyH, setBodyH] = useState<number>(SPEC.expandedMinH);
  const expandedKey = mode.kind === "expanded" ? mode.a.id + (mode.userOpened ? ":open" : ":alert") : mode.kind;
  useIsoLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setBodyH(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expandedKey]);

  const maxH = (mode.kind === "expanded" && mode.userOpened && mode.a.kind === "agent") || mode.kind === "ask" ? 380 : SPEC.expandedMaxH;
  const size: Footprint =
    mode.kind === "idle" ? { w: SPEC.idleWidth, h: SPEC.height }
    : mode.kind === "compact" ? { w: SPEC.compactWidth, h: SPEC.height }
    : mode.kind === "minimal" ? { w: SPEC.idleWidth + SPEC.minimalMax, h: SPEC.height }
    : { w: SPEC.expandedWidth, h: Math.max(SPEC.expandedMinH, Math.min(maxH, bodyH)) };
  const radius = size.h <= SPEC.height + 0.5 ? SPEC.height / 2 : SPEC.expandedRadius;

  // The spring for each change of shape, derived from the two sizes.
  const prevSize = useRef(size);
  const [spring, setSpring] = useState(() => computeMorph(size, size, profile, reduced).spring);
  const shapeKey = `${mode.kind}:${Math.round(size.w)}x${Math.round(size.h)}`;
  const prevShapeKey = useRef(shapeKey);
  if (prevShapeKey.current !== shapeKey) {
    prevShapeKey.current = shapeKey;
    const m = computeMorph(prevSize.current, size, profile, reduced);
    prevSize.current = size;
    setSpring({ ...m.spring, duration: Math.min(m.spring.duration, SPEC.maxAnimation) });
  }

  //
  // Input.
  //
  const islandRef = useRef<HTMLDivElement>(null);
  const onIsland = () => {
    if (mode.kind === "idle") setOpened("ask");
    else if (mode.kind === "compact") setOpened(mode.a.id);
    else if (mode.kind === "minimal") setOpened(mode.attached.id);
    else if (mode.kind === "expanded") {
      // Tapping an alert opens it for real (on the phone, it opens the app);
      // tapping something already open puts it away.
      if (!mode.userOpened) {
        setDismissed((d) => ({ ...d, [mode.a.id]: mode.a.updatedAt }));
        setOpened(mode.a.id);
      } else setOpened(null);
    } else if (mode.kind === "ask") setOpened(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The target is the window itself when nothing has focus, and a window
      // has no closest(); asking it would throw and swallow the key.
      const typing = e.target instanceof Element && e.target.closest("input, textarea, [contenteditable]");
      if (e.key === "Escape") setOpened(null);
      else if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpened("ask");
      }
    };
    // A click anywhere else puts an opened island away, as on the phone.
    const onDown = (e: PointerEvent) => {
      if (!islandRef.current?.contains(e.target as Node)) setOpened(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  const keyline = pres?.keyline ?? "rgba(255,255,255,0.3)";
  const enter = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, scale: 0.9, filter: "blur(4px)" },
        animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
      };
  const enterT = { duration: Math.min(0.45, spring.duration * 0.7), ease: EASE_OUT, delay: reduced ? 0 : 0.05 };

  return (
    <MotionConfig transition={spring} reducedMotion="user">
      <LayoutGroup>
        <style>{ISLAND_CSS}</style>
        <div ref={islandRef} className="flex items-start" style={{ gap: SPEC.detachedGap }}>
          <motion.div
            role="button"
            tabIndex={0}
            aria-label={mode.kind === "idle" ? "Ask Katie" : "Island"}
            onClick={onIsland}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                e.preventDefault();
                onIsland();
              }
            }}
            initial={false}
            animate={{ width: size.w, height: size.h, borderRadius: radius }}
            transition={spring}
            className="island-surface relative cursor-pointer overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            style={{
              // Apple's key line: a hairline tinted to the content, so the black
              // shape reads against a dark background. The shadow does the same
              // job on a light one.
              boxShadow: `0 0 0 1px color-mix(in srgb, ${keyline} 32%, transparent), 0 10px 30px -10px rgba(0,0,0,0.55)`,
            }}
          >
            {mode.kind === "compact" || mode.kind === "minimal" ? (
              <>
                <div
                  className="absolute left-0 top-0 flex items-center justify-center"
                  style={{ width: mode.kind === "compact" ? SPEC.compactSide : SPEC.minimalMax, height: SPEC.height }}
                >
                  <motion.div key={`${expandedKey}:cl`} {...enter} transition={enterT}>
                    {mode.kind === "compact" ? pres!.compactLeading : pres!.minimal}
                  </motion.div>
                </div>
                {mode.kind === "compact" ? (
                  <div
                    className="absolute right-0 top-0 flex items-center justify-center"
                    style={{ width: SPEC.compactSide, height: SPEC.height }}
                  >
                    <motion.div key={`${expandedKey}:ct`} {...enter} transition={enterT}>
                      {pres!.compactTrailing}
                    </motion.div>
                  </div>
                ) : null}
              </>
            ) : null}

            {mode.kind === "expanded" || mode.kind === "ask" ? (
              <div ref={bodyRef} className="absolute left-0 top-0" style={{ width: SPEC.expandedWidth, padding: SPEC.margin + 4 }}>
                {mode.kind === "ask" ? (
                  <motion.div key="ask" {...enter} transition={enterT}>
                    <AskField agent={askAgent} onSubmit={ask} />
                  </motion.div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      {pres!.expanded.leading ? <div className="shrink-0">{pres!.expanded.leading}</div> : null}
                      <motion.div key={`${expandedKey}:c`} className="min-w-0 flex-1" {...enter} transition={enterT}>
                        {pres!.expanded.center}
                      </motion.div>
                      {pres!.expanded.trailing ? <div className="shrink-0 self-start pt-1">{pres!.expanded.trailing}</div> : null}
                    </div>
                    {pres!.expanded.bottom ? (
                      <motion.div key={`${expandedKey}:b`} {...enter} transition={{ ...enterT, delay: enterT.delay + 0.04 }}>
                        {pres!.expanded.bottom}
                      </motion.div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </motion.div>

          {detachedPres && mode.kind === "minimal" ? (
            <motion.button
              key={`detached:${mode.detached.id}`}
              aria-label="Open the second activity"
              onClick={() => setOpened(mode.detached.id)}
              // The detached circle buds off the island's trailing edge.
              initial={{ opacity: 0, scale: 0.5, x: -24, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, x: 0, filter: "blur(0px)" }}
              // Blur and opacity ride a tween: a spring overshoots them below
              // zero, and a negative blur is not a value the browser accepts.
              transition={{
                ...spring,
                filter: { duration: 0.3, ease: EASE_OUT },
                opacity: { duration: 0.25, ease: EASE_OUT },
              }}
              className="island-surface flex items-center justify-center overflow-hidden rounded-full bg-black"
              style={{
                width: SPEC.minimalMin,
                height: SPEC.height,
                boxShadow: `0 0 0 1px color-mix(in srgb, ${detachedPres.keyline} 32%, transparent), 0 10px 30px -10px rgba(0,0,0,0.55)`,
              }}
            >
              {detachedPres.minimal}
            </motion.button>
          ) : null}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}

const ISLAND_CSS = `
.island-surface { font-family: var(--font-island), ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.island-shimmer {
  background: linear-gradient(90deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.3) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: island-shimmer 1.6s linear infinite;
}
@keyframes island-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .island-shimmer { animation: none; color: rgba(255,255,255,0.6); } }
`;
