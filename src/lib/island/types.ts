/** Types shared by the island's server routes and its client. No runtime code. */

export type PlaybackStatus = "playing" | "paused" | "stopped";

export interface NowPlaying {
  source: string;
  title: string;
  artist: string;
  album: string;
  /** https URL (Linux/Spotify) or a same-origin cover URL (Windows). */
  artUrl: string | null;
  status: PlaybackStatus;
  /** Seconds, as of `sampledAt`. */
  position: number;
  /** Seconds. 0 when the player does not say. */
  duration: number;
  /** Epoch ms at which `position` was true. The client extrapolates from here. */
  sampledAt: number;
  canNext: boolean;
  canPrev: boolean;
  canSeek: boolean;
}

export type MediaAction = "toggle" | "play" | "pause" | "next" | "previous" | "seek";

export type VoiceState = "listening" | "thinking" | "speaking";

export interface AgentActivity {
  agent: string;
  phase: "thinking" | "reply" | "done" | "error";
  thinking: string;
  text: string;
  to?: string;
  origin: "notify" | "ask" | "boardroom";
}

export interface VoiceActivity {
  agent: string;
  state: VoiceState;
  transcript: string;
}

/**
 * A live activity, in the ActivityKit sense: data, not drawing. The island
 * decides how it looks in each presentation.
 */
export interface Activity {
  id: string;
  kind: "media" | "agent" | "voice";
  /** Higher gets the compact presentation; the runner-up goes minimal. */
  priority: number;
  startedAt: number;
  updatedAt: number;
  /** While in the future, the island shows this activity expanded unasked. */
  alertUntil?: number;
  media?: NowPlaying;
  agent?: AgentActivity;
  voice?: VoiceActivity;
}

/** "end" removes the agent's activity quietly: no alert, nothing to read. */
export type IslandEventKind = "thinking" | "reply" | "done" | "error" | "end";

export interface IslandEvent {
  /** Groups the events of one turn: thinking -> reply -> done. */
  id: string;
  kind: IslandEventKind;
  /** Lower-case seat name: katie, charles, astra, quill, ... */
  agent: string;
  /** For "thinking" and "reply": the text so far, not a delta. */
  text?: string;
  /** Who the message was for, when it came from the boardroom. */
  to?: string;
  origin: "notify" | "ask" | "boardroom";
  ts: number;
}
