import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { b64, createCdnProxy, unb64 } from '../src/hls.js';
import { HttpError } from '../src/rctiplus.js';
import type { ApiClient } from '../src/rctiplus.js';

function makeCdn() {
  const api = {
    invalidateLive: vi.fn(),
  } as unknown as ApiClient;
  return { cdn: createCdnProxy({ config: CONFIG, api }), api };
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

describe('serveMaster / handleAsset', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serveMaster rewrites the playlist and tags it no-store mpegurl', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(
      new Response('#EXTM3U\n#EXT-X-VERSION:3\nv.m3u8\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      }),
    );
    const out = await cdn.serveMaster('https://cdn.example/rcti-sdi.m3u8');
    expect(out.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(out.body).toContain('/h/' + b64('https://cdn.example/v.m3u8'));
  });

  it('serveMaster throws HttpError when upstream is not a playlist', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(new Response('garbage'));
    await expect(cdn.serveMaster('https://cdn.example/x.m3u8')).rejects.toBeInstanceOf(HttpError);
  });

  it('handleAsset streams TS segments with public cache', async () => {
    const { cdn } = makeCdn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3]));
        c.close();
      },
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(stream, { headers: { 'content-type': 'video/mp2t' } }),
    );
    const out = await cdn.handleAsset('https://cdn.example/seg-1.ts');
    expect(out.headers['Content-Type']).toBe('video/mp2t');
    expect(out.headers['Cache-Control']).toBe('public, max-age=300');
    expect(out.body).toBeInstanceOf(ReadableStream);
  });

  it('handleAsset rewrites inner playlists recursively', async () => {
    const { cdn } = makeCdn();
    vi.mocked(fetch).mockResolvedValue(
      new Response('#EXTM3U\nts.ts\n', {
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      }),
    );
    const out = await cdn.handleAsset('https://cdn.example/a/index.m3u8');
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(out.body).toContain('/h/' + b64('https://cdn.example/a/ts.ts'));
  });

  // handleAsset does not validate upstream status (it just inspects the
  // content-type); a 403 body is streamed through like any other segment.
});