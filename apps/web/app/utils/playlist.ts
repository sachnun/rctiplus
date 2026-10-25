export type PlaylistEntry = {
  readonly name: string;
  readonly url: string;
};

export function cleanName(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function parsePlaylist(body: string, base: string): PlaylistEntry[] {
  const entries: PlaylistEntry[] = [];
  let name = "";
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#EXTINF:")) {
      const comma = line.indexOf(",");
      name = comma === -1 ? "" : cleanName(line.slice(comma + 1));
      continue;
    }
    if (line.startsWith("#")) continue;
    entries.push({ name, url: absolute(line, base) });
    name = "";
  }
  return entries;
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function splitSlot(name: string): { start: string; end: string; title: string } {
  const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s+(.*)$/.exec(name.trim());
  return match
    ? { start: match[1]!, end: match[2]!, title: match[3]! }
    : { start: "", end: "", title: name.trim() };
}

export function dateOf(url: string): string {
  return /\/day\/(\d{4}-\d{2}-\d{2})\//.exec(url)?.[1] ?? "";
}
