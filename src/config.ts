/**
 * Central configuration for the RCTI+ proxy.
 *
 * RCTI+ hands out signed HLS URLs only to its own web app: the CDN enforces a
 * Referer ACL plus Akamai hdnts/hdntl tokens, and the JSON API requires a
 * client-side visitor JWT (`Authorization`) and an API key.  Everything this
 * proxy needs to impersonate the web app lives here.
 */

/** Channel slug -> RCTI+ API channel id (used by `live/{id}/url`). */
export const CHANNELS = {
  rcti: 1,
  mnctv: 2,
  gtv: 3,
  globaltv: 3,
  inews: 4,
} as const;

export type ChannelSlug = keyof typeof CHANNELS;
export type ChannelId = (typeof CHANNELS)[ChannelSlug];

export const CONFIG = {
  /** Port used when none is given via argv / PORT env. */
  defaultPort: 8080,

  /* ------------------------------------------------------- RCTI+ constants */
  apiBase: 'https://toutatis.rctiplus.com/video/live/api/v1',
  siteBase: 'https://www.rctiplus.com',
  referer: 'https://www.rctiplus.com/',
  origin: 'https://www.rctiplus.com',
  apiKey: 'k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',

  /**
   * Fallback anonymous visitor JWT, baked into the desktop page template.
   * The token manager re-extracts a fresh one from the live page every
   * `ttl.token` ms and falls back to this when the page changes shape.
   */
  fallbackToken:
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ2aWQiOjAsInRva2VuIjoiZjlhYjEyMjg1NmQ3NGYwZiIsInBsIjoid2ViIiwiZGV2aWNlX2lkIjoiMjllNWZkOGEtMDg2YS0xMWVmLTliYTAtMDAxNjNlMDQxOGVjIn0.T0iVov0r2Ai-bhP3NsSoOZhP2WansABSNhrWzvB29-c',

  channels: CHANNELS,

  /**
   * CDN host prefix -> channel slug.  Used to pick the live master a proxied
   * playlist should be re-resolved to when its hdntl token expires.
   */
  cdnChannelHosts: [
    ['rcti-linier', 'rcti'],
    ['mnctv-linier', 'mnctv'],
    ['gtv-linier', 'gtv'],
    ['inews-linier', 'inews'],
  ] as const satisfies readonly (readonly [string, ChannelSlug])[],

  /** Cache TTLs (ms). */
  ttl: {
    live: 5 * 60 * 1000, // resolved live master URL
    epg: 5 * 60 * 1000, // resolved replay master URL
    schedule: 10 * 60 * 1000, // scraped catch-up list
    token: 15 * 60 * 1000, // visitor JWT refresh interval
  },

  /** Upstream request timeouts (ms). */
  timeouts: {
    api: 15000,
    cdn: 20000,
    page: 20000,
    token: 10000,
  },
} as const;

export type Config = typeof CONFIG;
