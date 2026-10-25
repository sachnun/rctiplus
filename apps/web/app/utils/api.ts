import { parsePlaylist, splitSlot, type PlaylistEntry } from "./playlist";

export type ReplayItem = {
  readonly epgId: number;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly url: string;
};

export type DaySection = {
  readonly date: string;
  readonly items: ReplayItem[];
};

export type ApiClient = {
  readonly root: string;
  catalog(): Promise<PlaylistEntry[]>;
  days(channel: string): Promise<string[]>;
  day(date: string, channel: string): Promise<ReplayItem[]>;
  streamUrl(channel: string): string;
  replayUrl(epgId: number): string;
};

export function epgIdOf(url: string): number {
  const match = /\/replay\/(\d+)\.m3u8/.exec(url);
  return match ? Number(match[1]) : 0;
}

export function createApiClient(baseUrl: string): ApiClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function getPlaylist(path: string): Promise<PlaylistEntry[]> {
    const res = await fetch(`${root}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parsePlaylist(await res.text(), res.url || path);
  }

  return {
    root,
    catalog: () => getPlaylist("/playlist.m3u8"),
    days: async (channel) =>
      (await getPlaylist(`/days/${encodeURIComponent(channel)}.m3u8`)).map((entry) => entry.name),
    day: async (date, channel) => {
      const entries = await getPlaylist(`/day/${date}/${encodeURIComponent(channel)}.m3u8`);
      return entries.map((entry) => {
        const slot = splitSlot(entry.name);
        return {
          epgId: epgIdOf(entry.url),
          title: slot.title,
          start: slot.start,
          end: slot.end,
          url: entry.url,
        } satisfies ReplayItem;
      });
    },
    streamUrl: (channel) => `${root}/live/${encodeURIComponent(channel)}.m3u8`,
    replayUrl: (epgId) => `${root}/replay/${epgId}.m3u8`,
  };
}
