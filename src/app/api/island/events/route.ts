import { bus, startBoardroomTail, type IslandEvent } from "@/lib/island/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-sent events: every island event, as it happens. */
export async function GET(req: Request) {
  startBoardroomTail();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: IslandEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));

      // A page opened mid-answer picks the turn up where it is.
      for (const e of bus.openTurns()) send(e);

      const unsubscribe = bus.subscribe(send);
      // Comment lines keep proxies and the browser from idling the stream out.
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
