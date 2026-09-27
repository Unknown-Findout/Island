import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The desktop's own wallpaper, so the island is judged against what it will
 * actually sit on rather than a stock gradient.
 *
 *   Windows: the transcoded copy Windows keeps of the current wallpaper.
 *   Linux:   ISLAND_WALLPAPER=/path/to/image (Plasma keeps it per screen in
 *            plasma-org.kde.plasma.desktop-appletsrc; not parsed yet).
 */
function wallpaperPath(): string | null {
  if (process.env.ISLAND_WALLPAPER) return process.env.ISLAND_WALLPAPER;
  if (process.platform === "win32") {
    return path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
  }
  return null;
}

export async function GET() {
  const p = wallpaperPath();
  if (!p || !fs.existsSync(p)) return new Response(null, { status: 404 });
  const bytes = fs.readFileSync(p);
  // The Windows copy has no extension; sniff PNG vs JPEG from the magic bytes.
  const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": type, "Cache-Control": "no-cache" },
  });
}
