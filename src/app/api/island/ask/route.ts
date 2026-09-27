import { NextResponse, type NextRequest } from "next/server";
import { bus } from "@/lib/island/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ask a model from the island. Any OpenAI-compatible server works; the default
 * is Katie's vLLM (Qwen3.8-27B on card 1). This talks to her MODEL, not to her
 * DSH harness, so it has no tools and none of her memory plugins.
 *
 *   ISLAND_AI_URL     default http://127.0.0.1:18020/v1
 *   ISLAND_AI_MODEL   default qwen3.8-27b
 *   ISLAND_AI_KEY     falls back to LOCAL_QWEN_API_KEY, the variable DSH uses
 *   ISLAND_AI_AGENT   the name the island shows, default katie
 *   ISLAND_AI_EFFORT  low | medium | xhigh, default low
 *
 * Returns at once with the turn id; the answer arrives over /api/island/events
 * as thinking -> reply -> done, like any other agent's.
 */

type Msg = { role: "system" | "user" | "assistant"; content: string };

const g = globalThis as unknown as { __islandHistory?: Msg[]; __islandBusy?: boolean };
const history = (g.__islandHistory ??= []);

const SYSTEM =
  "Wesley is talking to you through a small Dynamic Island at the top of his screen. " +
  "The answer is read in a pill a few lines tall, so lead with the answer and keep it short " +
  "unless he asks for more. Plain text, no markdown tables.";

export async function POST(req: NextRequest) {
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  const text = (prompt ?? "").trim();
  if (!text) return NextResponse.json({ ok: false, error: "empty prompt" }, { status: 400 });
  if (g.__islandBusy) return NextResponse.json({ ok: false, error: "already answering" }, { status: 409 });

  const agent = (process.env.ISLAND_AI_AGENT ?? "katie").toLowerCase();
  const id = `ask-${Date.now()}`;
  bus.publish({ id, kind: "thinking", agent, text: "", origin: "ask", ts: Date.now() });

  g.__islandBusy = true;
  void stream(id, agent, text).finally(() => {
    g.__islandBusy = false;
  });
  return NextResponse.json({ ok: true, id, agent });
}

/** Clears the conversation. */
export async function DELETE() {
  history.splice(0);
  return NextResponse.json({ ok: true });
}

async function stream(id: string, agent: string, prompt: string) {
  const base = (process.env.ISLAND_AI_URL ?? "http://127.0.0.1:18020/v1").replace(/\/$/, "");
  const key = process.env.ISLAND_AI_KEY ?? process.env.LOCAL_QWEN_API_KEY ?? "";
  const model = process.env.ISLAND_AI_MODEL ?? "qwen3.8-27b";
  const effort = process.env.ISLAND_AI_EFFORT ?? "low";

  const messages: Msg[] = [{ role: "system", content: SYSTEM }, ...history.slice(-12), { role: "user", content: prompt }];
  const fail = (why: string) =>
    bus.publish({ id, kind: "error", agent, text: why, origin: "ask", ts: Date.now() });

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages, stream: true, reasoning_effort: effort }),
    });
  } catch {
    return fail(`Can't reach ${agent}'s model at ${base}. Is it running?`);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    return fail(`${agent}'s model said ${res.status}: ${detail.slice(0, 160)}`);
  }

  let thinking = "";
  let reply = "";
  let lastSent = 0;
  // Publishing every token would push hundreds of events a second at 150 tok/s.
  // Twelve a second is smoother than the eye can follow in a pill anyway.
  const flush = (force = false) => {
    const now = Date.now();
    if (!force && now - lastSent < 80) return;
    lastSent = now;
    if (reply) bus.publish({ id, kind: "reply", agent, text: reply, origin: "ask", ts: now });
    else bus.publish({ id, kind: "thinking", agent, text: thinking, origin: "ask", ts: now });
  };

  const decoder = new TextDecoder();
  let buf = "";
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta ?? {};
          // vLLM names the channel reasoning_content; newer servers call it reasoning.
          thinking += delta.reasoning_content ?? delta.reasoning ?? "";
          reply += delta.content ?? "";
          flush();
        } catch {
          /* keep-alive or a partial frame */
        }
      }
    }
  } catch {
    return fail(`The stream from ${agent} broke off.`);
  }

  const answer = reply.trim();
  if (!answer) return fail(`${agent} finished without an answer.`);
  history.push({ role: "user", content: prompt }, { role: "assistant", content: answer });
  bus.publish({ id, kind: "done", agent, text: answer, origin: "ask", ts: Date.now() });
}
