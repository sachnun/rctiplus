export const CHANNELS = {
  rcti: 1,
  mnctv: 2,
  gtv: 3,
  globaltv: 3,
  inews: 4,
} as const;

export type ChannelSlug = keyof typeof CHANNELS;
export type ChannelId = (typeof CHANNELS)[ChannelSlug];

export function playerChannels(): string[] {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const [slug, id] of Object.entries(CHANNELS)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(slug);
  }
  return out;
}

export function channelId(slug: string): number | undefined {
  return CHANNELS[slug.toLowerCase() as ChannelSlug];
}

export const API_BASE = "https://toutatis.rctiplus.com/video/live/api/v1";
export const SITE_BASE = "https://www.rctiplus.com";
export const REFERER = "https://www.rctiplus.com/";
export const ORIGIN = "https://www.rctiplus.com";
export const API_KEY = "k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const FALLBACK_TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ2aWQiOjAsInRva2VuIjoiZjlhYjEyMjg1NmQ3NGYwZiIsInBsIjoid2ViIiwiZGV2aWNlX2lkIjoiMjllNWZkOGEtMDg2YS0xMWVmLTliYTAtMDAxNjNlMDQxOGVjIn0.T0iVov0r2Ai-bhP3NsSoOZhP2WansABSNhrWzvB29-c";

export const HISTORY_REF = { id: 328842, date: "2026-08-05" } as const;

export const CDN_CHANNEL_HOSTS = [
  ["rcti-linier", "rcti"],
  ["mnctv-linier", "mnctv"],
  ["gtv-linier", "gtv"],
  ["inews-linier", "inews"],
] as const satisfies readonly (readonly [string, ChannelSlug])[];

export const LIVE_PATH_RE = /\/live\/web\/([a-z]+)\//;

export const TOKEN_QUERY_KEYS = ["auth_key", "hdnts"] as const;

export const TTL = {
  live: 5 * 60 * 1000,
  epg: 5 * 60 * 1000,
  schedule: 10 * 60 * 1000,
  token: 15 * 60 * 1000,
  day: 10 * 60 * 1000,
  range: 60 * 60 * 1000,
  anchor: 12 * 60 * 60 * 1000,
  playlist: 1000,
} as const;

export const TIMEOUTS = {
  api: 15_000,
  cdn: 20_000,
  page: 20_000,
  token: 10_000,
} as const;

export type Config = {
  readonly channels: typeof CHANNELS;
  readonly apiBase: string;
  readonly siteBase: string;
  readonly referer: string;
  readonly origin: string;
  readonly apiKey: string;
  readonly userAgent: string;
  readonly fallbackToken: string;
  readonly historyRef: { readonly id: number; readonly date: string };
  readonly cdnChannelHosts: typeof CDN_CHANNEL_HOSTS;
  readonly livePathRe: RegExp;
  readonly tokenQueryKeys: readonly string[];
  readonly ttl: typeof TTL;
  readonly timeouts: typeof TIMEOUTS;
};

export const CONFIG: Config = {
  channels: CHANNELS,
  apiBase: API_BASE,
  siteBase: SITE_BASE,
  referer: REFERER,
  origin: ORIGIN,
  apiKey: API_KEY,
  userAgent: USER_AGENT,
  fallbackToken: FALLBACK_TOKEN,
  historyRef: HISTORY_REF,
  cdnChannelHosts: CDN_CHANNEL_HOSTS,
  livePathRe: LIVE_PATH_RE,
  tokenQueryKeys: TOKEN_QUERY_KEYS,
  ttl: TTL,
  timeouts: TIMEOUTS,
};
