/**
 * The island's activity registry: the one place that decides what is live.
 *
 * Modelled on how Apple splits the job. Apps do not draw into the Dynamic
 * Island; they start, update and end a Live Activity with data, and the SYSTEM
 * picks the presentation (compact, minimal, expanded), the priority and the
 * motion. Here the sources are the OS media session, the agents (through the
 * notify door and the boardroom) and the voice, and the renderer on the client
 * is only a view of this list.
 *
 * Server-only. One instance on globalThis so dev reloads keep one registry.
 */
import { bus } from "./bus";
import { mediaBackend } from "./media";
import type { Activity, IslandEvent } from "./types";

type Listener = (list: Activity[]) => void;

/** Higher wins the full compact presentation; the next one goes minimal. */
const PRIORITY = { voice: 90, agent: 70, media: 50 } as const;

/** How long a finished reply is held expanded, like a Live Activity alert. */
const alertMs = (text: string) => Math.min(9000, 4500 + text.length * 35);

class Registry {
  private items = new Map<string, Activity>();
  private listeners = new Set<Listener>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private mediaTimer: ReturnType<typeof setInterval> | null = null;
  private lastMediaJson = "";

  list(): Activity[] {
    // Ties broken by id, so two activities started in the same millisecond can
    // never trade places between one update and the next.
    return Array.from(this.items.values()).sort(
      (a, b) => b.priority - a.priority || b.startedAt - a.startedAt || a.id.localeCompare(b.id)
    );
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    this.ensureMediaPolling();
    return () => {
      this.listeners.delete(l);
      if (this.listeners.size === 0) this.stopMediaPolling();
    };
  }

  private emit() {
    const list = this.list();
    Array.from(this.listeners).forEach((l) => {
      try {
        l(list);
      } catch {
        /* one dead stream must not take the others down */
      }
    });
  }

  upsert(a: Omit<Activity, "startedAt" | "updatedAt"> & { startedAt?: number }) {
    const prev = this.items.get(a.id);
    const now = Date.now();
    this.items.set(a.id, { ...a, startedAt: prev?.startedAt ?? a.startedAt ?? now, updatedAt: now } as Activity);
    this.emit();
  }

  end(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    if (this.items.delete(id)) this.emit();
  }

  /** Ends an activity after `ms`, unless it is updated again before then. */
  endAfter(id: string, ms: number) {
    const prev = this.timers.get(id);
    if (prev) clearTimeout(prev);
    const stamp = this.items.get(id)?.updatedAt;
    this.timers.set(
      id,
      setTimeout(() => {
        if (this.items.get(id)?.updatedAt === stamp) this.end(id);
      }, ms)
    );
  }

  //
  // --------------- sources ---------------
  //

  /** Media is polled only while someone is watching the island. */
  private ensureMediaPolling() {
    if (this.mediaTimer) return;
    const tick = async () => {
      const np = await mediaBackend().get().catch(() => null);
      if (!np || np.status === "stopped") {
        if (this.items.has("media")) this.end("media");
        this.lastMediaJson = "";
        return;
      }
      // Only a real change goes out; position is extrapolated on the client.
      const json = JSON.stringify({ ...np, position: Math.round(np.position), sampledAt: 0 });
      if (json === this.lastMediaJson) return;
      this.lastMediaJson = json;
      this.upsert({ id: "media", kind: "media", priority: PRIORITY.media, media: np });
    };
    void tick();
    this.mediaTimer = setInterval(tick, 1000);
  }

  private stopMediaPolling() {
    if (this.mediaTimer) clearInterval(this.mediaTimer);
    this.mediaTimer = null;
  }

  /** Agent turns from the bus become one activity per agent. */
  onAgentEvent(e: IslandEvent) {
    const id = `agent:${e.agent}`;
    // A turn that was abandoned or cancelled leaves without an alert.
    if (e.kind === "end") return this.end(id);
    if (e.kind === "thinking" || e.kind === "reply") {
      const prev = this.items.get(id);
      this.upsert({
        id,
        kind: "agent",
        priority: PRIORITY.agent,
        agent: {
          agent: e.agent,
          phase: e.kind,
          thinking: e.kind === "thinking" ? e.text ?? "" : prev?.agent?.thinking ?? "",
          text: e.kind === "reply" ? e.text ?? "" : "",
          to: e.to,
          origin: e.origin,
        },
      });
      // A turn nobody finishes must not sit in the island forever.
      this.endAfter(id, 5 * 60_000);
      return;
    }
    const text = e.text ?? "";
    const prev = this.items.get(id);
    this.upsert({
      id,
      kind: "agent",
      priority: PRIORITY.agent,
      alertUntil: Date.now() + alertMs(text),
      agent: {
        agent: e.agent,
        phase: e.kind === "error" ? "error" : "done",
        thinking: prev?.agent?.thinking ?? "",
        text,
        to: e.to,
        origin: e.origin,
      },
    });
    // Apple ends a Live Activity when its task ends, with a short dismissal
    // window. A reply stays reachable (tap to reread and answer) for a minute.
    this.endAfter(id, alertMs(text) + 60_000);
  }
}

const g = globalThis as unknown as { __islandRegistry?: Registry; __islandRegistryWired?: boolean };
export const registry = (g.__islandRegistry ??= new Registry());

if (!g.__islandRegistryWired) {
  g.__islandRegistryWired = true;
  bus.subscribe((e) => registry.onAgentEvent(e));
}
