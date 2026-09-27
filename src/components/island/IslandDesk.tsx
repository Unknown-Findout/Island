"use client";

import { useEffect, useRef, useState } from "react";
import IslandSystem from "./IslandSystem";
import type { VoiceState } from "@/lib/island/types";

/**
 * A stand-in desktop for judging the island by eye before it moves into the
 * Linux top layer: his real wallpaper, a maximised window to see how the two
 * modes treat apps, and a panel of switches. Everything in the island itself
 * is live (music, agent events); only the voice has a demo source until
 * Katie's speech is wired in.
 */

type Wall = "mine" | "dark" | "light";
type Mode = "notch" | "float";

const WALLS: Record<Exclude<Wall, "mine">, string> = {
  dark: "radial-gradient(120% 90% at 20% 10%, #1e1b4b 0%, #0b0b12 55%, #050507 100%)",
  light: "radial-gradient(120% 90% at 70% 0%, #fdf2f8 0%, #e0e7ff 45%, #f5f5f4 100%)",
};

const BAR_H = 38;

function load<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private window */
  }
}

export default function IslandDesk() {
  const [wall, setWall] = useState<Wall>("mine");
  const [mode, setMode] = useState<Mode>("notch");
  const [windowOn, setWindowOn] = useState(true);
  const [voiceState, setVoiceState] = useState<VoiceState | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [scale, setScale] = useState(1.25);
  const level = useVoiceLevel(voiceState, micOn);

  useEffect(() => {
    setWall(load<Wall>("island.wall", "mine"));
    setMode(load<Mode>("island.mode", "notch"));
  }, []);

  // The voice is a real activity on the server, like any other source; only
  // its level stays here, next to the audio it measures.
  useEffect(() => {
    const transcript =
      voiceState === "listening"
        ? micOn
          ? ""
          : "(test) What is on the list for tonight?"
        : voiceState === "speaking"
          ? "This is a test line, so you can see how my voice looks while I talk."
          : "";
    fetch("/api/island/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(voiceState ? { state: voiceState, transcript, agent: "katie" } : { state: "off" }),
    }).catch(() => undefined);
  }, [voiceState, micOn]);

  const background =
    wall === "mine" ? `#0b0b12 url(/api/island/wallpaper) center / cover no-repeat` : WALLS[wall];

  return (
    <div className="fixed inset-0 overflow-hidden text-white" style={{ background }}>
      {/* Notch mode reserves a strip, like a menu bar, so apps start below it. */}
      {mode === "notch" ? (
        <div
          className="absolute inset-x-0 top-0 border-b border-white/10 bg-black/35 backdrop-blur-2xl backdrop-saturate-150"
          style={{ height: BAR_H }}
        >
          <div className="flex h-full items-center justify-between px-4 text-[12.5px] font-medium text-white/85">
            <span>Katie</span>
            <Clock />
          </div>
        </div>
      ) : null}

      {windowOn ? <FakeWindow top={mode === "notch" ? BAR_H : 0} /> : null}

      <div
        className="absolute inset-x-0 z-40 flex justify-center"
        style={{ top: mode === "notch" ? 2 : 8 }}
      >
        <div style={{ zoom: scale }}>
          <IslandSystem voiceLevel={level} />
        </div>
      </div>

      <Panel
        wall={wall}
        setWall={(w) => {
          setWall(w);
          save("island.wall", w);
        }}
        mode={mode}
        setMode={(m) => {
          setMode(m);
          save("island.mode", m);
        }}
        windowOn={windowOn}
        setWindowOn={setWindowOn}
        voiceState={voiceState}
        setVoiceState={setVoiceState}
        micOn={micOn}
        setMicOn={setMicOn}
        scale={scale}
        setScale={setScale}
      />
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  return <span>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>;
}

/** A maximised app, so the island can be judged against a real title bar. */
function FakeWindow({ top }: { top: number }) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 overflow-hidden border-t border-white/10 bg-[#1b1b1f]/95 shadow-2xl"
      style={{ top }}
    >
      <div className="flex h-9 items-center gap-2 border-b border-white/5 bg-[#232327] px-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[12px] text-white/45">Obsidian - BRAIN-HOME</span>
      </div>
      <div className="mx-auto mt-16 max-w-xl space-y-3 px-6">
        <div className="h-5 w-2/3 rounded bg-white/10" />
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-11/12 rounded bg-white/5" />
        <div className="h-3 w-4/5 rounded bg-white/5" />
      </div>
    </div>
  );
}

/**
 * Voice level. With the mic on it is the real input level; otherwise a
 * speech-shaped fake: syllables of 120-260 ms with gaps, which is what makes
 * the orb breathe like talking rather than pulse like a metronome.
 */
function useVoiceLevel(state: VoiceState | null, mic: boolean) {
  const [level, setLevel] = useState(0);
  const micLevel = useMicLevel(mic && state !== null);

  useEffect(() => {
    if (!state || mic) return;
    let raf = 0;
    let syllableEnd = 0;
    let target = 0;
    let cur = 0;
    const loop = (t: number) => {
      if (t > syllableEnd) {
        const speaking = state === "speaking";
        const gap = Math.random() < (speaking ? 0.22 : 0.5);
        target = gap ? 0.05 : speaking ? 0.45 + Math.random() * 0.55 : 0.15 + Math.random() * 0.3;
        syllableEnd = t + (gap ? 90 + Math.random() * 180 : 120 + Math.random() * 140);
      }
      if (state === "thinking") target = 0.25 + 0.08 * Math.sin(t / 300);
      cur += (target - cur) * 0.25;
      setLevel(cur);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, mic]);

  return mic && state ? micLevel : state ? level : 0;
}

function useMicLevel(on: boolean) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(an);
        const buf = new Float32Array(an.fftSize);
        const loop = () => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          // RMS to a 0-1 feel: speech sits around 0.02-0.2 RMS.
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
          raf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => setLevel(0));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
  }, [on]);
  return level;
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: [T | null, string][];
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="flex rounded-full bg-white/10 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={label}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={
            "rounded-full px-3 py-1 text-[12px] transition-colors " +
            (value === v ? "bg-white text-black" : "text-white/75 hover:text-white")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Panel(p: {
  wall: Wall;
  setWall: (w: Wall) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  windowOn: boolean;
  setWindowOn: (v: boolean) => void;
  voiceState: VoiceState | null;
  setVoiceState: (v: VoiceState | null) => void;
  micOn: boolean;
  setMicOn: (v: boolean) => void;
  scale: number;
  setScale: (v: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState("");

  const testReply = async () => {
    const post = (body: object) =>
      fetch("/api/island/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    setStatus("Sending a test reply from Katie through the real notify door...");
    await post({ agent: "katie", kind: "thinking", id: "demo" });
    await new Promise((r) => setTimeout(r, 2600));
    await post({
      agent: "katie",
      kind: "done",
      id: "demo",
      text: "Test message. This is how a reply from me lands in the island. Tap it to read the whole thing and answer.",
    });
    setStatus("");
  };

  return (
    <div className="absolute bottom-4 left-4 z-50 w-[340px] rounded-2xl border border-white/10 bg-black/60 p-3 text-[12px] backdrop-blur-xl">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between font-medium text-white/85">
        Island controls <span className="text-white/40">{open ? "hide" : "show"}</span>
      </button>
      {open ? (
        <div className="mt-3 space-y-2.5">
          <Row label="Wallpaper">
            <Seg value={p.wall} options={[["mine", "Mine"], ["dark", "Dark"], ["light", "Light"]]} onChange={(v) => p.setWall(v ?? "mine")} />
          </Row>
          <Row label="Mode">
            <Seg value={p.mode} options={[["notch", "Notch"], ["float", "Float"]]} onChange={(v) => p.setMode(v ?? "notch")} />
          </Row>
          <Row label="Window">
            <Seg value={p.windowOn ? "on" : "off"} options={[["on", "On"], ["off", "Off"]]} onChange={(v) => p.setWindowOn(v === "on")} />
          </Row>
          <Row label="Size">
            <Seg
              value={String(p.scale)}
              options={[["1", "Phone 1x"], ["1.25", "1.25x"], ["1.5", "1.5x"]]}
              onChange={(v) => p.setScale(Number(v ?? 1.25))}
            />
          </Row>
          <Row label="Voice">
            <Seg
              value={p.voiceState}
              options={[[null, "Off"], ["listening", "Listen"], ["thinking", "Think"], ["speaking", "Speak"]]}
              onChange={p.setVoiceState}
            />
          </Row>
          <Row label="Mic level">
            <Seg value={p.micOn ? "on" : "off"} options={[["off", "Fake"], ["on", "My mic"]]} onChange={(v) => p.setMicOn(v === "on")} />
          </Row>
          <div className="flex items-center gap-2 pt-1">
            <button onClick={testReply} className="rounded-full bg-white/10 px-3 py-1.5 text-white/85 hover:bg-white/15">
              Test: Katie replies
            </button>
            <span className="text-white/40">or press / to ask</span>
          </div>
          {status ? <p className="text-white/45">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-white/55">{label}</span>
      {children}
    </div>
  );
}
