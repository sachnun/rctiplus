/**
 * RCTI+ constants shared by the proxy services.
 *
 * RCTI+ hands out signed HLS URLs only to its own web app: the CDN enforces a
 * Referer ACL plus Akamai hdnts/hdntl tokens, and the JSON API requires a
 * client-side visitor JWT (`Authorization`) and an API key.
 */
export const CHANNELS = {
  rcti: 1,
  mnctv: 2,
  gtv: 3,
  globaltv: 3,
  inews: 4,
} as const;

export type ChannelSlug = keyof typeof CHANNELS;
export type ChannelId = (typeof CHANNELS)[ChannelSlug];

export const API_BASE = "https://toutatis.rctiplus.com/video/live/api/v1";
export const SITE_BASE = "https://www.rctiplus.com";
export const REFERER = "https://www.rctiplus.com/";
export const ORIGIN = "https://www.rctiplus.com";
export const API_KEY = "k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Fallback anonymous visitor JWT, baked into the desktop page template. */
export const FALLBACK_TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ2aWQiOjAsInRva2VuIjoiZjlhYjEyMjg1NmQ3NGYwZiIsInBsIjoid2ViIiwiZGV2aWNlX2lkIjoiMjllNWZkOGEtMDg2YS0xMWVmLTliYTAtMDAxNjNlMDQxOGVjIn0.T0iVov0r2Ai-bhP3NsSoOZhP2WansABSNhrWzvB29-c";

/**
 * Baked reference point for the deep-history id to date mapping: the largest
 * EPG id known to resolve on this date. Used only when the schedule page is
 * unreachable.
 */
export const HISTORY_REF = { id: 328842, date: "2026-08-05" } as const;

/** CDN host prefix to channel slug, used to self-heal expired live playlists. */
export const CDN_CHANNEL_HOSTS = [
  ["rcti-linier", "rcti"],
  ["mnctv-linier", "mnctv"],
  ["gtv-linier", "gtv"],
  ["inews-linier", "inews"],
] as const satisfies readonly (readonly [string, ChannelSlug])[];

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
  ttl: TTL,
  timeouts: TIMEOUTS,
};
