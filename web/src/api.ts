/** Typed client for the proxy's JSON API (all requests are same-origin). */

export interface Channels {
  channels: string[];
}

export interface ScheduleItem {
  epg_id: number;
  date: string;
  title: string;
  start: string;
  end: string;
}

export interface Schedule {
  channel: string;
  items: ScheduleItem[];
}

export interface DayItem {
  epg_id: number;
  date: string;
  title: string;
  start: string;
  end: string;
  playable: boolean;
}

export interface PrevResult {
  date: string | null;
  earliest: string;
  items: DayItem[];
  end: boolean;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  channels: () => getJson<Channels>('/channels'),
  schedule: (channel: string) =>
    getJson<Schedule>(`/schedule?channel=${encodeURIComponent(channel)}`),
  historyPrev: (before: string, channel: string) =>
    getJson<PrevResult>(
      `/history/prev?before=${encodeURIComponent(before)}&channel=${encodeURIComponent(channel)}`,
    ),
};

export type Quality = 'best' | 'auto' | '720' | '480' | '360' | '240' | '144';

export const QUALITIES: { value: Quality; label: string }[] = [
  { value: 'best', label: 'Terbaik' },
  { value: 'auto', label: 'Otomatis' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: '240', label: '240p' },
  { value: '144', label: '144p' },
];
