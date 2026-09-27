/**
 * Now-playing for the island, from the operating system rather than from
 * Spotify's web API.
 *
 * Going through the OS means no Spotify account link, no Premium requirement
 * for playback control, and it works with any player the desktop already
 * knows about. Spotify is preferred when it has a session.
 *
 *   Linux   - MPRIS over D-Bus, through `playerctl` (pacman -S playerctl).
 *   Windows - System Media Transport Controls, through a long-lived
 *             PowerShell helper (scripts/island/smtc.ps1).
 *
 * Server-only. Never import this from a client component.
 */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import type { MediaAction, NowPlaying, PlaybackStatus } from "./types";
export type { MediaAction, NowPlaying, PlaybackStatus };

export interface MediaBackend {
  name: string;
  get(): Promise<NowPlaying | null>;
  act(action: MediaAction, seconds?: number): Promise<boolean>;
}

//
// --------------- Linux: playerctl ---------------
//

const SEP = "\u001f";
const PLAYERCTL_FORMAT = [
  "{{playerName}}",
  "{{status}}",
  "{{xesam:title}}",
  "{{xesam:artist}}",
  "{{xesam:album}}",
  "{{mpris:artUrl}}",
  "{{mpris:length}}",
  "{{position}}",
].join(SEP);

/** Spotify if it is running, otherwise any player. */
const PLAYERS = process.env.ISLAND_PLAYERS || "spotify,%any";

function run(cmd: string, args: string[], timeoutMs = 1500): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/** Exported for the parser test: playerctl's formatted line to NowPlaying. */
export function parsePlayerctl(line: string, now = Date.now()): NowPlaying | null {
  const f = line.replace(/\r?\n$/, "").split(SEP);
  if (f.length < 8 || !f[2]) return null;
  const [player, status, title, artist, album, art, lengthUs, positionUs] = f;
  const lower = status.toLowerCase();
  return {
    source: player.toLowerCase().startsWith("spotify") ? "spotify" : player,
    title,
    artist,
    album,
    // Spotify's MPRIS art used to point at open.spotify.com, which serves a
    // page, not an image. The image lives on i.scdn.co under the same id.
    artUrl: art ? art.replace("https://open.spotify.com/image/", "https://i.scdn.co/image/") : null,
    status: lower === "playing" ? "playing" : lower === "paused" ? "paused" : "stopped",
    position: Number(positionUs) / 1e6 || 0,
    duration: Number(lengthUs) / 1e6 || 0,
    sampledAt: now,
    canNext: true,
    canPrev: true,
    canSeek: Number(lengthUs) > 0,
  };
}

const playerctl: MediaBackend = {
  name: "playerctl",
  async get() {
    try {
      const out = await run("playerctl", ["-p", PLAYERS, "metadata", "--format", PLAYERCTL_FORMAT]);
      return parsePlayerctl(out);
    } catch {
      // Exit 1 with "No players found" is the normal idle state, not an error.
      return null;
    }
  },
  async act(action, seconds) {
    const args =
      action === "toggle"
        ? ["play-pause"]
        : action === "seek"
          ? ["position", String(Math.max(0, seconds ?? 0))]
          : [action];
    try {
      await run("playerctl", ["-p", PLAYERS, ...args]);
      return true;
    } catch {
      return false;
    }
  },
};

//
// --------------- Windows: SMTC via PowerShell ---------------
//

/**
 * One helper process for the life of the server. Spawning PowerShell per poll
 * costs ~400 ms and a flash of CPU every second; a resident one answers in a
 * few milliseconds. Requests are serialised because the helper is a simple
 * line-in, line-out loop.
 */
class SmtcHelper {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private waiting: ((line: string) => void)[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  private ensure() {
    if (this.proc && this.proc.exitCode === null) return this.proc;
    const script = path.join(process.cwd(), "scripts", "island", "smtc.ps1");
    const proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true }
    );
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.waiting.shift()?.(line);
      }
    });
    proc.stderr.on("data", (d) => console.error("[island smtc]", String(d).trim()));
    proc.on("exit", () => {
      // Fail anything still waiting rather than hanging the request forever.
      for (const w of this.waiting.splice(0)) w('{"ok":false,"error":"helper exited"}');
      this.proc = null;
    });
    this.proc = proc;
    return proc;
  }

  send(command: string, timeoutMs = 4000): Promise<Record<string, unknown>> {
    const job = this.chain.then(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          const proc = this.ensure();
          const timer = setTimeout(() => {
            // A wedged helper is killed and respawned on the next call.
            this.waiting = this.waiting.filter((w) => w !== onLine);
            proc.kill();
            resolve({ ok: false, error: "timeout" });
          }, timeoutMs);
          const onLine = (line: string) => {
            clearTimeout(timer);
            try {
              resolve(JSON.parse(line));
            } catch {
              resolve({ ok: false, error: `bad reply: ${line.slice(0, 120)}` });
            }
          };
          this.waiting.push(onLine);
          proc.stdin.write(command + "\n");
        })
    );
    this.chain = job.catch(() => undefined);
    return job;
  }
}

const g = globalThis as unknown as { __islandSmtc?: SmtcHelper };
const smtcHelper = () => (g.__islandSmtc ??= new SmtcHelper());

const smtc: MediaBackend = {
  name: "smtc",
  async get() {
    // The first call spawns PowerShell and loads WinRT, which takes a couple of seconds.
    const r = await smtcHelper().send("get", 8000);
    if (r.none || r.ok === false || !r.title) return null;
    return {
      source: String(r.source ?? ""),
      title: String(r.title ?? ""),
      artist: String(r.artist ?? ""),
      album: String(r.album ?? ""),
      artUrl: (r.artUrl as string) || null,
      status: (r.status as PlaybackStatus) ?? "stopped",
      position: Number(r.position) || 0,
      duration: Number(r.duration) || 0,
      sampledAt: Number(r.sampledAt) || Date.now(),
      canNext: Boolean(r.canNext),
      canPrev: Boolean(r.canPrev),
      canSeek: Boolean(r.canSeek),
    };
  },
  async act(action, seconds) {
    const r = await smtcHelper().send(action === "seek" ? `seek ${seconds ?? 0}` : action);
    return r.ok === true;
  },
};

const none: MediaBackend = {
  name: "none",
  async get() {
    return null;
  },
  async act() {
    return false;
  },
};

export function mediaBackend(): MediaBackend {
  if (process.platform === "linux") return playerctl;
  if (process.platform === "win32") return smtc;
  return none;
}
