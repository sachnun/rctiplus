function qualityQuery(quality?: string): string {
  return quality && quality !== "auto" ? `?quality=${encodeURIComponent(quality)}` : "";
}

export function liveUrl(channel: string, quality?: string): string {
  return `/live/${channel}.m3u8${qualityQuery(quality)}`;
}

export function replayUrl(epgId: number | string, quality?: string): string {
  return `/replay/${epgId}.m3u8${qualityQuery(quality)}`;
}

export function dayUrl(date: string, channel?: string): string {
  return `/day/${date}/${channel ?? "all"}.m3u8`;
}

export function catalogUrl(quality?: string): string {
  return `/playlist.m3u8${qualityQuery(quality)}`;
}
