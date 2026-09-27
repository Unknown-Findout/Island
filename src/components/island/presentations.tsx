"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Activity, MediaAction, NowPlaying } from "@/lib/island/types";
import { agentLook } from "./agents";
import { positionNow, useArtColor, useTicker } from "./use-now-playing";
import { VoiceOrb, VoiceWave } from "./VoiceOrb";

/**
 * What each kind of activity supplies to the island, in ActivityKit's terms:
 * a compact leading and trailing view, a minimal view, and an expanded view in
 * four regions. The island (IslandSystem) owns placement, size and motion.
 *
 * Elements that exist in more than one presentation carry a `layoutId`, so when
 * the island expands the album art or the orb MOVES to its new place instead of
 * fading out and back in. That is Apple's rule: "preserve as much of the
 * existing layout as possible by animating existing elements to their new
 * positions".
 */

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export interface Regions {
  leading?: React.ReactNode;
  center?: React.ReactNode;
  trailing?: React.ReactNode;
  bottom?: React.ReactNode;
}

export interface Presentation {
  compactLeading: React.ReactNode;
  compactTrailing: React.ReactNode;
  minimal: React.ReactNode;
  expanded: Regions;
  /** The thin outline Apple tints to the content on dark backgrounds. */
  keyline: string;
}

export interface PresentCtx {
  act: (a: MediaAction, seconds?: number) => void;
  ask: (prompt: string) => void;
  /** True when the person opened it, false when an alert opened it. */
  userOpened: boolean;
  level: number;
  artColor: string;
}

export function present(a: Activity, ctx: PresentCtx): Presentation {
  if (a.kind === "media" && a.media) return presentMedia(a.id, a.media, ctx);
  if (a.kind === "agent" && a.agent) return presentAgent(a, ctx);
  return presentVoice(a, ctx);
}

//
// --------------- shared pieces ---------------
//

function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, "0")}`;
}

export function Avatar({ agent, size, pulse, layoutId }: { agent: string; size: number; pulse?: boolean; layoutId?: string }) {
  const look = agentLook(agent);
  const reduced = useReducedMotion();
  return (
    <motion.div layoutId={layoutId} className="relative shrink-0" style={{ width: size, height: size }}>
      {pulse && !reduced ? (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: look.glow }}
          animate={{ scale: [1, 1.6], opacity: [0.75, 0] }}
          transition={{ duration: 1.5, ease: EASE_OUT, repeat: Infinity }}
        />
      ) : null}
      <div
        className="relative flex h-full w-full items-center justify-center rounded-full font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
        style={{ background: `linear-gradient(145deg, ${look.from}, ${look.to})`, fontSize: size * 0.45 }}
      >
        {look.name.charAt(0)}
      </div>
    </motion.div>
  );
}

function TypingDots({ layoutId }: { layoutId?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div layoutId={layoutId} className="flex items-center gap-[3px] rounded-full bg-white/[0.12] px-[7px] py-[6px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-[5px] w-[5px] rounded-full bg-white/80"
          animate={reduced ? { opacity: 0.8 } : { opacity: [0.35, 1, 0.35], y: [0, -1.5, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: "easeInOut" }}
        />
      ))}
    </motion.div>
  );
}

/** Music bars tinted from the album; they rest low while paused. */
function Bars({ color, playing, height, layoutId }: { color: string; playing: boolean; height: number; layoutId?: string }) {
  const [lv, setLv] = useState([0.55, 0.85, 0.45, 0.7]);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!playing || reduced) return;
    const id = setInterval(() => setLv((p) => p.map((v) => Math.min(1, Math.max(0.2, v + (Math.random() - 0.5) * 0.85)))), 170);
    return () => clearInterval(id);
  }, [playing, reduced]);
  return (
    <motion.div layoutId={layoutId} className="flex items-center gap-[2.5px]" style={{ height }} aria-hidden>
      {lv.map((l, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full"
          style={{ background: color, minHeight: 3 }}
          animate={{ height: playing ? `${l * 100}%` : "22%" }}
          transition={{ type: "spring", bounce: 0.25, duration: 0.32 }}
        />
      ))}
    </motion.div>
  );
}

function Art({ np, size, radius, layoutId }: { np: NowPlaying; size: number; radius: number; layoutId?: string }) {
  return (
    <motion.div
      layoutId={layoutId}
      className="shrink-0 overflow-hidden bg-gradient-to-br from-[#2a2a2e] to-[#141416]"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {np.artUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={np.artUrl} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : null}
    </motion.div>
  );
}

function Button({
  label,
  onClick,
  size,
  disabled,
  children,
  className = "",
}: {
  label: string;
  onClick: () => void;
  size: number;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.button
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={stop}
      whileTap={disabled ? undefined : { scale: 0.86 }}
      transition={{ duration: 0.16, ease: EASE_OUT }}
      style={{ width: size, height: size }}
      className={"flex shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:opacity-30 [@media(hover:hover)]:hover:bg-white/10 " + className}
    >
      {children}
    </motion.button>
  );
}

//
// --------------- Music ---------------
//

function presentMedia(id: string, np: NowPlaying, ctx: PresentCtx): Presentation {
  const playing = np.status === "playing";
  return {
    keyline: ctx.artColor,
    compactLeading: <Art np={np} size={23} radius={6} layoutId={`${id}:art`} />,
    compactTrailing: <Bars color={ctx.artColor} playing={playing} height={14} layoutId={`${id}:bars`} />,
    minimal: <Bars color={ctx.artColor} playing={playing} height={13} layoutId={`${id}:bars`} />,
    expanded: {
      leading: <Art np={np} size={56} radius={14} layoutId={`${id}:art`} />,
      center: (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight text-white">{np.title}</p>
          <p className="truncate text-[14px] font-medium leading-snug text-white/55">{np.artist}</p>
        </div>
      ),
      trailing: <Bars color={ctx.artColor} playing={playing} height={20} layoutId={`${id}:bars`} />,
      bottom: <MediaControls np={np} act={ctx.act} />,
    },
  };
}

function MediaControls({ np, act }: { np: NowPlaying; act: PresentCtx["act"] }) {
  const playing = np.status === "playing";
  useTicker(playing);
  const pos = positionNow(np);
  const pct = np.duration > 0 ? (pos / np.duration) * 100 : 0;
  const barRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 text-[11px] font-medium tabular-nums text-white/50">
        <span className="w-8 text-right">{fmt(pos)}</span>
        <div
          ref={barRef}
          role="slider"
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(np.duration)}
          aria-valuenow={Math.round(pos)}
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            const r = barRef.current?.getBoundingClientRect();
            if (!r || !np.canSeek || np.duration <= 0) return;
            act("seek", Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * np.duration);
          }}
          className={"group flex-1 py-2 " + (np.canSeek ? "cursor-pointer" : "")}
        >
          <div className="h-[5px] overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover:h-[7px]">
            {/* Linear: a readout of the song's position must not be eased. */}
            <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className="w-8">-{fmt(Math.max(0, np.duration - pos))}</span>
      </div>
      <div className="flex items-center justify-center gap-9">
        <Button label="Previous track" size={38} disabled={!np.canPrev} onClick={() => act("previous")}>
          <svg viewBox="0 0 24 24" className="h-[26px] w-[26px] fill-current" aria-hidden>
            <path d="M11.2 12 19.5 6.6v10.8L11.2 12ZM3.2 12 11.5 6.6v10.8L3.2 12Z" />
          </svg>
        </Button>
        <Button label={playing ? "Pause" : "Play"} size={44} onClick={() => act("toggle")}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.svg
              key={playing ? "pause" : "play"}
              initial={{ opacity: 0, scale: 0.5, filter: "blur(3px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.5, filter: "blur(3px)" }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
              viewBox="0 0 24 24"
              className="h-[30px] w-[30px] fill-current"
              aria-hidden
            >
              {playing ? (
                <path d="M6.8 4.2h3.6v15.6H6.8zM13.6 4.2h3.6v15.6h-3.6z" />
              ) : (
                <path d="M7.2 4.6a.9.9 0 0 1 1.37-.77l11 6.9a.9.9 0 0 1 0 1.54l-11 6.9A.9.9 0 0 1 7.2 18.4V4.6Z" />
              )}
            </motion.svg>
          </AnimatePresence>
        </Button>
        <Button label="Next track" size={38} disabled={!np.canNext} onClick={() => act("next")}>
          <svg viewBox="0 0 24 24" className="h-[26px] w-[26px] fill-current" aria-hidden>
            <path d="M12.8 12 4.5 17.4V6.6L12.8 12ZM20.8 12l-8.3 5.4V6.6L20.8 12Z" />
          </svg>
        </Button>
      </div>
    </div>
  );
}

//
// --------------- Agents ---------------
//

function presentAgent(a: Activity, ctx: PresentCtx): Presentation {
  const t = a.agent!;
  const look = agentLook(t.agent);
  const live = t.phase === "thinking" || t.phase === "reply";
  const id = a.id;
  const status =
    t.phase === "thinking" ? "thinking" : t.phase === "reply" ? "writing" : t.phase === "error" ? "couldn't answer" : t.to ? `to ${agentLook(t.to).name}` : "now";

  return {
    keyline: look.from,
    compactLeading: <Avatar agent={t.agent} size={23} pulse={live} layoutId={`${id}:avatar`} />,
    compactTrailing: live ? (
      <TypingDots layoutId={`${id}:dots`} />
    ) : (
      <motion.span layoutId={`${id}:badge`} className="text-[13px] font-semibold" style={{ color: look.from }}>
        {look.name}
      </motion.span>
    ),
    minimal: <Avatar agent={t.agent} size={23} pulse={live} layoutId={`${id}:avatar`} />,
    expanded: {
      leading: <Avatar agent={t.agent} size={44} pulse={live} layoutId={`${id}:avatar`} />,
      center: (
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight text-white">{look.name}</p>
          <p className={"text-[13px] font-medium leading-snug " + (live ? "island-shimmer" : "text-white/50")}>{status}</p>
        </div>
      ),
      trailing: live ? <TypingDots layoutId={`${id}:dots`} /> : null,
      bottom: <AgentBody a={a} ctx={ctx} />,
    },
  };
}

function AgentBody({ a, ctx }: { a: Activity; ctx: PresentCtx }) {
  const t = a.agent!;
  const live = t.phase === "thinking" || t.phase === "reply";
  const [showThinking, setShowThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Follow the answer as it is written, the way a chat does.
    if (live && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [t.text, live]);

  const text = t.text || (t.phase === "thinking" ? "" : "(no text)");
  return (
    <div className="flex flex-col gap-2.5" onClick={ctx.userOpened ? stop : undefined}>
      {text ? (
        <div
          ref={scroller}
          className={
            "whitespace-pre-wrap text-[14px] leading-[1.4] " +
            (t.phase === "error" ? "text-[#FF8A80] " : "text-white/85 ") +
            (ctx.userOpened ? "max-h-[220px] overflow-y-auto pr-1" : "line-clamp-2")
          }
        >
          {text}
        </div>
      ) : null}
      {ctx.userOpened && t.thinking ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowThinking((v) => !v);
          }}
          className="self-start text-[12px] font-medium text-white/45 hover:text-white/70"
        >
          {showThinking ? "Hide thinking" : "Show thinking"}
        </button>
      ) : null}
      {ctx.userOpened && showThinking ? (
        <div className="max-h-[110px] overflow-y-auto rounded-[16px] bg-white/[0.06] px-3 py-2 text-[12.5px] italic leading-relaxed text-white/45">
          {t.thinking}
        </div>
      ) : null}
      {ctx.userOpened && t.agent === "katie" ? <AskField agent={t.agent} onSubmit={ctx.ask} disabled={live} /> : null}
    </div>
  );
}

export function AskField({ agent, onSubmit, disabled }: { agent: string; onSubmit: (p: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const look = agentLook(agent);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = setTimeout(() => ref.current?.focus(), 160);
    return () => clearTimeout(id);
  }, []);
  const send = () => {
    const v = text.trim();
    if (!v || disabled) return;
    onSubmit(v);
    setText("");
  };
  return (
    // Concentric: the field's radius is the island's 44 minus the 14 margin.
    <div className="flex items-center gap-2 rounded-[30px] bg-white/[0.1] py-1 pl-4 pr-1" onClick={stop} onPointerDown={stop}>
      <input
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") send();
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        placeholder={`Message ${look.name}`}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-white placeholder:text-white/35 focus:outline-none"
      />
      <motion.button
        aria-label="Send"
        disabled={disabled || !text.trim()}
        onClick={(e) => {
          e.stopPropagation();
          send();
        }}
        whileTap={{ scale: 0.86 }}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-full disabled:opacity-30"
        style={{ background: `linear-gradient(145deg, ${look.from}, ${look.to})` }}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" aria-hidden>
          <path d="M12 4.5a1 1 0 0 1 .7.3l6 6a1 1 0 0 1-1.4 1.4L13 7.9V19a1 1 0 1 1-2 0V7.9l-4.3 4.3a1 1 0 0 1-1.4-1.4l6-6a1 1 0 0 1 .7-.3Z" />
        </svg>
      </motion.button>
    </div>
  );
}

//
// --------------- Voice ---------------
//

const VOICE_WORDS = { listening: "Listening", thinking: "Thinking", speaking: "Speaking" } as const;

function presentVoice(a: Activity, ctx: PresentCtx): Presentation {
  const v = a.voice!;
  const look = agentLook(v.agent);
  const id = a.id;
  const lvl = v.state === "thinking" ? 0.3 : ctx.level;
  return {
    keyline: "#A855F7",
    compactLeading: <motion.div layoutId={`${id}:orb`}><VoiceOrb size={24} level={lvl} state={v.state} /></motion.div>,
    compactTrailing: <motion.div layoutId={`${id}:wave`}><VoiceWave level={v.state === "thinking" ? 0.15 : lvl} height={16} /></motion.div>,
    minimal: <motion.div layoutId={`${id}:orb`}><VoiceOrb size={24} level={lvl} state={v.state} /></motion.div>,
    expanded: {
      leading: <motion.div layoutId={`${id}:orb`}><VoiceOrb size={50} level={lvl} state={v.state} /></motion.div>,
      center: (
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight text-[#C4B5FD]">
            {look.name} <span className="font-medium text-white/40">· {VOICE_WORDS[v.state]}</span>
          </p>
          <p className="mt-0.5 line-clamp-2 text-[15px] font-medium leading-snug text-white">
            {v.transcript || <span className="text-white/30">...</span>}
          </p>
        </div>
      ),
      trailing: <motion.div layoutId={`${id}:wave`}><VoiceWave level={v.state === "thinking" ? 0.15 : lvl} height={22} /></motion.div>,
    },
  };
}

export { useArtColor };
