export type CatalogEntry = {
  readonly name: string;
  readonly url: string;
};

export const HLS_TAGS = [
  "#EXT-X-TARGETDURATION",
  "#EXT-X-MEDIA-SEQUENCE",
  "#EXT-X-KEY",
  "#EXT-X-ALLOW-CACHE",
  "#EXT-X-ENDLIST",
  "#EXT-X-STREAM-INF",
  "#EXT-X-DISCONTINUITY",
  "#EXT-X-VERSION",
] as const;

export function cleanName(input: string): string {
  return input.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

export function slotName(title: string, start?: string, end?: string): string {
  const slot = start && end ? `${start}-${end}` : "";
  return cleanName(slot ? `${slot} ${title}` : title);
}

export function splitSlot(name: string): { slot: string; title: string } {
  const match = /^(\d{1,2}:\d{2}-\d{1,2}:\d{2})\s+(.*)$/.exec(name.trim());
  return match ? { slot: match[1]!, title: match[2]! } : { slot: "", title: name.trim() };
}

export function buildPlaylist(entries: ReadonlyArray<CatalogEntry>): string {
  const lines = ["#EXTM3U"];
  for (const entry of entries) {
    lines.push(`#EXTINF:-1,${cleanName(entry.name)}`);
    lines.push(entry.url);
  }
  return `${lines.join("\n")}\n`;
}

export function playlistHeaders(cacheControl = "no-cache, max-age=1"): Record<string, string> {
  return {
    "Content-Type": "audio/x-mpegurl",
    "Cache-Control": cacheControl,
    "Access-Control-Allow-Origin": "*",
  };
}

export function parseExtinf(line: string): string | null {
  const match = /^#EXTINF:.*?,(.*)$/.exec(line.trim());
  return match ? cleanName(match[1] ?? "") : null;
}

export function absolutize(body: string, origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return body
    .split("\n")
    .map((line) => (line.startsWith("/") ? `${base}${line}` : line))
    .join("\n");
}

export function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}
