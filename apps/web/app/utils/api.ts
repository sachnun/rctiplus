/** Typed client for the proxy JSON API. */
export type Channels = { channels: string[] };

export type ScheduleItem = {
  epg_id: number;
  date: string;
  title: string;
  start: string;
  end: string;
};

export type Schedule = { channel: string; items: ScheduleItem[] };

export type DayItem = {
  epg_id: number;
  date: string;
  title: string;
  start: string;
  end: string;
  playable: boolean;
};

export type PrevResult = {
  date: string | null;
  earliest: string;
  items: DayItem[];
  end: boolean;
};

export type ApiClient = {
  readonly root: string;
  channels(): Promise<Channels>;
  schedule(channel: string): Promise<Schedule>;
  historyPrev(before: string, channel: string): Promise<PrevResult>;
  streamUrl(channel: string, quality: string): string;
  replayUrl(epgId: number, quality: string): string;
};

function qualitySuffix(quality: string): string {
  return quality === "auto" ? "" : `?quality=${quality}`;
}

export function createApiClient(baseUrl: string): ApiClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${root}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    root,
    channels: () => getJson<Channels>("/channels"),
    schedule: (channel) => getJson<Schedule>(`/schedule?channel=${encodeURIComponent(channel)}`),
    historyPrev: (before, channel) =>
      getJson<PrevResult>(
        `/history/prev?before=${encodeURIComponent(before)}&channel=${encodeURIComponent(channel)}`
      ),
    streamUrl: (channel, quality) =>
      `${root}/${encodeURIComponent(channel)}.m3u8${qualitySuffix(quality)}`,
    replayUrl: (epgId, quality) => `${root}/replay/${epgId}.m3u8${qualitySuffix(quality)}`,
  };
}
