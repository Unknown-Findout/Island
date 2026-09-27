import { NextResponse, type NextRequest } from "next/server";
import { bus, type IslandEventKind } from "@/lib/island/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: IslandEventKind[] = ["thinking", "reply", "done", "error", "end"];

/**
 * The door every agent uses to reach the island.
 *
 *   curl -s -m 1 localhost:3005/api/island/notify -H "content-type: application/json" \
 *     -d '{"agent":"katie","kind":"thinking"}'
 *   ... -d '{"agent":"katie","kind":"done","text":"The build passed."}'
 *
 * `id` ties a thinking event to its reply; without one, each agent has one
 * open turn at a time.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as {
    agent?: string;
    kind?: string;
    text?: string;
    id?: string;
  };
  const agent = (b.agent ?? "").trim().toLowerCase();
  const kind = b.kind as IslandEventKind;
  if (!agent || !KINDS.includes(kind)) {
    return NextResponse.json(
      { ok: false, error: `need agent and kind (${KINDS.join(", ")})` },
      { status: 400 }
    );
  }
  bus.publish({
    id: b.id ?? `notify-${agent}`,
    kind,
    agent,
    text: typeof b.text === "string" ? b.text.slice(0, 20000) : undefined,
    origin: "notify",
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
