import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCache } from '../src/cache.js';
import { b64, createCdnProxy, filterMaster, unb64 } from '../src/hls.js';
import { HttpError } from '../src/rctiplus.js';
import type { ApiClient } from '../src/rctiplus.js';

function makeCdn() {
  const api = {
    invalidateLive: vi.fn(),
  } as unknown as ApiClient;
  const cache = createCache();
  return { cdn: createCdnProxy({ config: CONFIG, api, cache }), api, cache };
}

describe('b64 / unb64', () => {
  it('round-trips URLs with special characters', () => {
    const url = 'https://cdn.example/v/a.m3u8?hdntl=exp=1~acl=%2F*~hmac=xyz';
    expect(unb64(b64(url))).toBe(url);
  });
});

describe('rewritePlaylist', () => {
  it('rewrites URL lines to /h/<b64> and keeps # lines / blanks intact', () => {
    const { cdn } = makeCdn();
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '../seg.ts',
      'http://cdn.example/x.m3u8',
      '',
    ].join('\n');
    const out = cdn.rewritePlaylist(body, 'https://cdn.example/v/it/');
    const lines = out.split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[1]).toBe('#EXT-X-VERSION:3');
    expect(lines[2]).toBe('/h/' + b64('https://cdn.example/v/seg.ts'));
    expect(lines[3]).toBe('/h/' + b64('http://cdn.example/x.m3u8'));
    expect(lines[4]).toBe('');
  });

  it('resolves relative hdntl-prefixed lines against the master URL', () => {
    const { cdn } = makeCdn();
    const line = 'hdntl=exp=1~acl=%2F*~hmac=abc/rcti-sdi.m3u8';
    const out = cdn.rewritePlaylist(line + '\n', 'https://rcti-linier.rctiplus.id/rcti-sdi.m3u8');
    expect(out.trim()).toBe(
      '/h/' + b64('https://rcti-linier.rctiplus.id/hdntl=exp=1~acl=%2F*~hmac=abc/rcti-sdi.m3u8'),
    );
  });
});

describe('selfHeal', () => {
  it('returns null for segments and non-hdntl playlists', () => {
    const { cdn } = makeCdn();
    expect(cdn.selfHeal('https://cdn.example/seg-1.ts')).toBeNull();
    expect(cdn.selfHeal('https://cdn.example/index.m3u8')).toBeNull();
  });

  it('redirects expiring hdntl playlists to a fresh master and invalidates the cache', () => {
    const { cdn, api } = makeCdn();
    const url = 'https://rcti-linier.rctiplus.id/hdntl=exp=1~hmac=x/rcti-sdi.m3u8';
    expect(cdn.selfHeal(url)).toBe('/rcti.m3u8');
    expect(api.invalidateLive).toHaveBeenCalledWith(1);
  });

  it('maps unknown CDN hosts to rcti', () => {
    const { cdn } = makeCdn();
    const url = 'https://mystery.example/hdntl=exp=1~hmac=x/a.m3u8';
    expect(cdn.selfHeal(url)).toBe('/rcti.m3u8');
  });
});

describe('filterMaster', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=223255,RESOLUTION=256x144',
    'a-144.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1272655,RESOLUTION=1280x720',
    'a-720.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=806255,RESOLUTION=854x480',
    'a-480.m3u8',
  ].join('\n');

  it('pins to the single highest-resolution variant when mode is best', () => {
    const out = filterMaster(master, { mode: 'best' }).split('\n');
    expect(out).toHaveLength(4);
    expect(out[0]).toBe('#EXTM3U');
    expect(out[1]).toBe('#EXT-X-VERSION:3');
    expect(out[2]).toContain('RESOLUTION=1280x720');
    expect(out[3]).toBe('a-720.m3u8');
  });

  it('picks the highest variant at or below the requested height', () => {
    const out = filterMaster(master, { mode: 'max-height', height: 480 }).split('\n');
    expect(out[2]).toContain('RESOLUTION=854x480');
    expect(out[3]).toBe('a-480.m3u8');
  });

  it('leaves the body unchanged when there are no variants to filter', () => {
    const plain = '#EXTM3U\n#EXT-X-VERSION:3\nsomething.ts\n';
    expect(filterMaster(plain, { mode: 'best' })).toBe(plain);
  });
});

describe('serveMaster / handleAsset', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serveMaster rewrites the playlist and tags it revalidatable mpegurl', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(
      new Response('#EXTM3U\n#EXT-X-VERSION:3\nv.m3u8\n', {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'last-modified': 'Wed, 05 Aug 2026 03:50:55 GMT',
        },
      }),
    );
    const out = await cdn.serveMaster('https://cdn.example/rcti-sdi.m3u8');
    expect(out.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
    expect(out.headers['Cache-Control']).toBe('no-cache, max-age=1');
    // Live playlists must keep the upstream Last-Modified so native players
    // can pace their re-polls instead of hammering the playlist in a loop.
    expect(out.headers['Last-Modified']).toBe('Wed, 05 Aug 2026 03:50:55 GMT');
    expect(out.body).toContain('/h/' + b64('https://cdn.example/v.m3u8'));
  });

  it('serveMaster applies a quality filter before rewriting', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        [
          '#EXTM3U',
          '#EXT-X-STREAM-INF:BANDWIDTH=223255,RESOLUTION=256x144',
          'lo.m3u8',
          '#EXT-X-STREAM-INF:BANDWIDTH=1272655,RESOLUTION=1280x720',
          'hi.m3u8',
        ].join('\n'),
        { headers: { 'content-type': 'application/vnd.apple.mpegurl' } },
      ),
    );
    const out = await cdn.serveMaster('https://cdn.example/rcti-sdi.m3u8', {
      filter: { mode: 'best' },
    });
    expect(out.body).toContain('RESOLUTION=1280x720');
    expect(out.body).not.toContain('RESOLUTION=256x144');
    expect(out.body).toContain('/h/' + b64('https://cdn.example/hi.m3u8'));
  });

  it('serveMaster throws HttpError when upstream is not a playlist', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(new Response('garbage'));
    await expect(cdn.serveMaster('https://cdn.example/x.m3u8')).rejects.toBeInstanceOf(HttpError);
  });

  it('handleAsset serves TS segments as seekable byte files', async () => {
    const { cdn } = makeCdn();
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    vi.mocked(fetch).mockResolvedValue(
      new Response(bytes, { headers: { 'content-type': 'video/mp2t' } }),
    );
    const out = await cdn.handleAsset('https://cdn.example/seg-1.ts');
    expect(out.headers['Content-Type']).toBe('video/mp2t');
    expect(out.headers['Cache-Control']).toBe('public, max-age=300');
    expect(out.headers['Accept-Ranges']).toBe('bytes');
    expect(out.headers['Content-Length']).toBe('8');
    expect(new Uint8Array(out.body as Uint8Array)).toEqual(bytes);
  });

  it('handleAsset honors Range requests with 206 partial content', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), {
        headers: { 'content-type': 'video/mp2t' },
      }),
    );
    const out = await cdn.handleAsset('https://cdn.example/seg-1.ts', {
      range: 'bytes=2-5',
    });
    expect(out.status).toBe(206);
    expect(out.headers['Content-Range']).toBe('bytes 2-5/8');
    expect(out.headers['Content-Length']).toBe('4');
    expect(new Uint8Array(out.body as Uint8Array)).toEqual(new Uint8Array([3, 4, 5, 6]));
  });

  it('handleAsset answers conditional requests with 304 Not Modified', async () => {
    const { cdn } = makeCdn();
    const lm = 'Wed, 05 Aug 2026 04:36:30 GMT';
    vi.mocked(fetch).mockResolvedValue(
      new Response('#EXTM3U\nts.ts\n', {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'last-modified': lm,
        },
      }),
    );
    // First load populates the cache.
    await cdn.handleAsset('https://cdn.example/a/index.m3u8');
    // Revalidation with the same Last-Modified -> 304, no body, no refetch.
    const out = await cdn.handleAsset('https://cdn.example/a/index.m3u8', {
      ifModifiedSince: lm,
    });
    expect(out.status).toBe(304);
    expect(out.body).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); // served from the 1s playlist cache
  });

  it('serveMaster answers If-None-Match with 304 when ETag matches', async () => {
    const { cdn } = makeCdn();
    const etag = 'W/"aa445492-819f"';
    vi.mocked(fetch).mockResolvedValue(
      new Response('#EXTM3U\nv.m3u8\n', {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          etag,
        },
      }),
    );
    const out = await cdn.serveMaster('https://cdn.example/x.m3u8', {
      ifNoneMatch: etag,
    });
    expect(out.status).toBe(304);
    expect(out.body).toBeNull();
  });

  it('serveMaster forwards the CDN freshness headers', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(
      new Response('#EXTM3U\nv.m3u8\n', {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'cache-control': 'max-age=1',
          'last-modified': 'Wed, 05 Aug 2026 04:36:30 GMT',
          expires: 'Wed, 05 Aug 2026 04:36:31 GMT',
          etag: 'W/"aa"',
        },
      }),
    );
    const out = await cdn.serveMaster('https://cdn.example/x.m3u8');
    expect(out.headers['Cache-Control']).toBe('max-age=1');
    expect(out.headers['Expires']).toBe('Wed, 05 Aug 2026 04:36:31 GMT');
    expect(out.headers['Last-Modified']).toBe('Wed, 05 Aug 2026 04:36:30 GMT');
    expect(out.headers['ETag']).toBe('W/"aa"');
  });

  it('handleAsset rewrites inner playlists recursively', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(
      new Response('#EXTM3U\nts.ts\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      }),
    );
    const out = await cdn.handleAsset('https://cdn.example/a/index.m3u8');
    expect(out.headers['Cache-Control']).toBe('no-cache, max-age=1');
    expect(out.body).toContain('/h/' + b64('https://cdn.example/a/ts.ts'));
  });

  // handleAsset does not validate upstream status (it just inspects the
  // content-type); a 403 body is streamed through like any other segment.
});