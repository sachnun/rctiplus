import type { Config } from './config.js';

/**
 * Anonymous visitor JWT manager.
 *
 * Every JSON API call must carry `Authorization: <visitor JWT>` plus the
 * `apikey` header.  The web app embeds a fresh token in every page render
 * (`var visitorsToken = "..."`); we re-extract it periodically and fall back
 * to a static token baked into the config when extraction fails.
 */
export interface TokenManager {
  /** Return the current token, refreshing it from the live page if stale. */
  get(): Promise<string>;
  /** Headers shared by every RCTI+ API request. */
  headers(): Promise<Record<string, string>>;
}

export function createTokenManager({ config }: { config: Config }): TokenManager {
  let token: string = config.fallbackToken;
  let tokenAt = 0;

  async function get(): Promise<string> {
    if (Date.now() - tokenAt < config.ttl.token) return token;

    try {
      const res = await fetch(`${config.siteBase}/tv/rcti`, {
        headers: { 'User-Agent': config.userAgent },
        signal: AbortSignal.timeout(config.timeouts.token),
      });
      const html = await res.text();
      const m = html.match(/visitorsToken\s*=\s*"([^"]+)"/);
      if (m && m[1] && m[1].length > 100) {
        token = m[1];
        tokenAt = Date.now();
      }
    } catch {
      /* page unreachable or changed shape — keep the last token */
    }
    return token;
  }

  async function headers(): Promise<Record<string, string>> {
    return {
      Authorization: await get(),
      apikey: config.apiKey,
      Origin: config.origin,
      Referer: config.referer,
      'User-Agent': config.userAgent,
    };
  }

  return { get, headers };
}
