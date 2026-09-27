import { NextResponse, type NextRequest } from "next/server";
import { registry } from "@/lib/island/activities";
import type { VoiceState } from "@/lib/island/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES: VoiceState[] = ["listening", "thinking", "speaking"];

/**
 * Starts, updates or ends the voice activity.
 *
 *   { "state": "listening" | "thinking" | "speaking", "transcript": "...", "agent": "katie" }
 *   { "state": "off" }
 *
 * The level that makes the orb breathe is NOT sent here: at 30 updates a second
 * it belongs on the client, next to the audio it measures.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { state?: string; transcript?: string; agent?: string };
  if (b.state === "off") {
    registry.end("voice");
    return NextResponse.json({ ok: true });
  }
  if (!STATES.includes(b.state as VoiceState)) {
    return NextResponse.json({ ok: false, error: `state must be off or ${STATES.join(", ")}` }, { status: 400 });
  }
  registry.upsert({
    id: "voice",
    kind: "voice",
    priority: 90,
    voice: {
      agent: (b.agent ?? "katie").toLowerCase(),
      state: b.state as VoiceState,
      transcript: typeof b.transcript === "string" ? b.transcript.slice(0, 2000) : "",
    },
  });
  // A voice session that stops reporting is over; do not leave the orb up.
  registry.endAfter("voice", 120_000);
  return NextResponse.json({ ok: true });
}
