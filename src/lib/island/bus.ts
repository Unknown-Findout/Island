/**
 * The island's event bus: every AI surface in the house talks to the island
 * through here.
 *
 *   - Any agent or hook can POST /api/island/notify with a thinking, reply
 *     or done event. That is the whole contract; nothing else is needed.
 *   - Asking from the island itself (POST /api/island/ask) publishes the same
 *     events while the model streams, so a question typed into the island and
 *     a reply from an agent in another window look identical.
 *   - The boardroom log is tailed, so agent-to-agent traffic surfaces as
 *     messages without any agent having to change.
 *
 * Server-only. The single instance lives on globalThis so Next's dev reloads
 * do not split subscribers across two copies of the module.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { IslandEvent, IslandEventKind } from "./types";
export type { IslandEvent, IslandEventKind };

type Listener = (e: IslandEvent) => void;

class Bus {
  private listeners = new Set<Listener>();
  /** A short memory, so a page opened mid-turn still sees the turn. */
  private recent: IslandEvent[] = [];

  publish(e: IslandEvent) {
    this.recent.push(e);
    if (this.recent.length > 50) this.recent.splice(0, this.recent.length - 50);
    for (const l of Array.from(this.listeners)) {
      try {
        l(e);
      } catch {
        /* one dead stream must not take the others down */
      }
    }
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** The last event of every turn that has not finished yet. */
  openTurns(): IslandEvent[] {
    const byId = new Map<string, IslandEvent>();
    for (const e of this.recent) byId.set(e.id, e);
    return Array.from(byId.values()).filter((e) => e.kind === "thinking" || e.kind === "reply");
  }
}

const g = globalThis as unknown as { __islandBus?: Bus; __islandTail?: boolean };
export const bus = (g.__islandBus ??= new Bus());

//
// --------------- Boardroom tail ---------------
//

// On Windows the house keeps the Brain on the Desktop; anywhere else, say where.
const DEFAULT_BOARDROOM =
  process.platform === "win32" ? path.join(os.homedir(), "Desktop", "Brain", "boardroom", "log.jsonl") : "";

/**
 * Follows the boardroom log by byte offset. Starts at the end of the file:
 * the island announces what happens from now on, it does not replay history.
 * Set ISLAND_BOARDROOM to the log's path on Linux, or to "off".
 */
export function startBoardroomTail() {
  if (g.__islandTail) return;
  const file = process.env.ISLAND_BOARDROOM ?? DEFAULT_BOARDROOM;
  if (!file || file === "off" || !fs.existsSync(file)) return;
  g.__islandTail = true;

  let offset = fs.statSync(file).size;
  let partial = "";

  const read = () => {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < offset) offset = 0; // truncated or rotated
    if (size === offset) return;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    partial += buf.toString("utf8");
    const lines = partial.split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line) as { ts?: string; from?: string; to?: string; text?: string; h?: string };
        if (!m.from || !m.text) continue;
        bus.publish({
          id: `br-${m.h ?? Date.now()}`,
          kind: "done",
          agent: m.from.toLowerCase(),
          to: m.to,
          text: m.text,
          origin: "boardroom",
          ts: m.ts ? Date.parse(m.ts) : Date.now(),
        });
      } catch {
        /* a half-written line is picked up on the next read */
      }
    }
  };

  setInterval(read, 1500).unref?.();
}
