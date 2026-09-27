import { registry } from "@/lib/island/activities";
import { startBoardroomTail } from "@/lib/island/bus";
import type { Activity } from "@/lib/island/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events: the whole activity list, every time it changes. Sending
 * the full list rather than deltas means a dropped frame can never leave the
 * island showing something that has already ended.
 */
export async function GET(req: Request) {
  startBoardroomTail();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (list: Activity[]) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(list)}\n\n`));
      send(registry.list());
      const unsubscribe = registry.subscribe(send);
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15000);
      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
