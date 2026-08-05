import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCache } from '../src/cache.js';
import { createApiClient } from '../src/rctiplus.js';
import { HttpError } from '../src/rctiplus.js';
import { createTokenManager } from '../src/token.js';

function makeApi() {
  const cache = createCache();
  const tokenManager = {
    headers: vi.fn(async () => ({ Authorization: 'tok', apikey: CONFIG.apiKey })),
  };
  return { api: createApiClient({ config: CONFIG, cache, tokenManager }), cache };
}

describe('createApiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a live master and caches it (single upstream call)', async () => {
    const { api } = makeApi();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { url: 'https://cdn/x.m3u8' } })),
    );
    expect(await api.resolveMaster(1)).toBe('https://cdn/x.m3u8');
    expect(await api.resolveMaster(1)).toBe('https://cdn/x.m3u8');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves an EPG master through its own cache key', async () => {
    const { api } = makeApi();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { url: 'https://past/replay.m3u8' } })),
    );
    expect(await api.resolveEpgMaster('328332')).toBe('https://past/replay.m3u8');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws HttpError when the API reply has no url', async () => {
    const { api } = makeApi();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: {} })));
    await expect(api.resolveMaster(1)).rejects.toBeInstanceOf(HttpError);
  });

  it('throws HttpError carrying the upstream status on non-ok responses', async () => {
    const { api } = makeApi();
    vi.mocked(fetch).mockResolvedValue(new Response('err', { status: 500 }));
    await expect(api.resolveMaster(1)).rejects.toMatchObject({ status: 500 });
  });

  it('invalidates the live cache so the next call re-resolves', async () => {
    const { api } = makeApi();
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify({ data: { url: 'https://cdn/a.m3u8' } })),
    );
    await api.resolveMaster(1);
    api.invalidateLive(1);
    expect(await api.resolveMaster(1)).toBe('https://cdn/a.m3u8');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('createTokenManager', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to the baked-in token when the page fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network'));
    const tm = createTokenManager({ config: CONFIG });
    expect(await tm.get()).toBe(CONFIG.fallbackToken);
  });

  it('extracts a fresh visitorsToken from the page', async () => {
    const fresh = 'X'.repeat(150);
    vi.mocked(fetch).mockResolvedValue(new Response(`var visitorsToken = "${fresh}";`));
    const tm = createTokenManager({ config: CONFIG });
    expect(await tm.get()).toBe(fresh);
  });

  it('keeps the fallback when the extracted token is too short', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('var visitorsToken = "abc";'));
    const tm = createTokenManager({ config: CONFIG });
    expect(await tm.get()).toBe(CONFIG.fallbackToken);
  });

  it('builds API headers including Authorization and apikey', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(''));
    const tm = createTokenManager({ config: CONFIG });
    const headers = await tm.headers();
    expect(headers.Authorization).toBe(CONFIG.fallbackToken);
    expect(headers.apikey).toBe(CONFIG.apiKey);
    expect(headers.Referer).toBe(CONFIG.referer);
  });
});