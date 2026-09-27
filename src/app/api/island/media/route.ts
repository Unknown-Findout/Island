import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { mediaBackend, type MediaAction } from "@/lib/island/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: MediaAction[] = ["toggle", "play", "pause", "next", "previous", "seek"];

/**
 * Windows hands album art over as a data: URI. Sending that inside every
 * one-second poll would push ~50 KB a second and make the <img> re-decode the
 * same cover each time. So the bytes are parked here and the client gets a
 * stable URL per cover, which the browser caches like any image.
 */
const g = globalThis as unknown as { __islandArt?: Map<string, { mime: string; bytes: Buffer }> };
const artCache = (g.__islandArt ??= new Map());

function parkArt(dataUri: string): string | null {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUri);
  if (!m) return null;
  const k = createHash("sha1").update(m[2]).digest("hex").slice(0, 16);
  if (!artCache.has(k)) {
    artCache.set(k, { mime: m[1], bytes: Buffer.from(m[2], "base64") });
    // A handful of covers is plenty; the island only ever shows one.
    while (artCache.size > 8) artCache.delete(artCache.keys().next().value!);
  }
  return `/api/island/media?art=${k}`;
}

/** Now playing, or `{ nowPlaying: null }`. With `?art=<key>`, the cover image itself. */
export async function GET(req: NextRequest) {
  const artKey = req.nextUrl.searchParams.get("art");
  if (artKey) {
    const art = artCache.get(artKey);
    if (!art) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(art.bytes), {
      headers: { "Content-Type": art.mime, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  const backend = mediaBackend();
  const nowPlaying = await backend.get();
  if (nowPlaying?.artUrl?.startsWith("data:")) nowPlaying.artUrl = parkArt(nowPlaying.artUrl);
  return NextResponse.json({ backend: backend.name, nowPlaying });
}

/** `{ action: "toggle" | "play" | "pause" | "next" | "previous" }` or `{ action: "seek", seconds }`. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; seconds?: number };
  const action = body.action as MediaAction;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ ok: false, error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
  }
  const ok = await mediaBackend().act(action, Number(body.seconds) || 0);
  return NextResponse.json({ ok }, { status: ok ? 200 : 502 });
}
