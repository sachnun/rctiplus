#!/usr/bin/env node
/**
 * RCTI+ proxy for VLC — live TV + schedule replay (catch-up)
 *
 * RCTI+ only hands out signed HLS URLs to its own web app (Referer ACL +
 * Akamai hdnts/hdntl tokens + an API key).  This proxy:
 *   1. resolves the signed master playlist from the RCTI+ API,
 *   2. serves it as /<channel>.m3u8 or /replay/<epg>.m3u8, rewriting every
 *      inner URL to go through itself (/h/<base64url>),
 *   3. fetches playlists & segments from the CDN with the required Referer
 *      header so VLC (which sends no Referer) can play them,
 *   4. exposes the 7-day catch-up schedule as JSON via /schedule.
 *
 * Usage:  node proxy.js [port]      (default port 8080)
 *   live:  vlc http://localhost:8080/rcti.m3u8
 *   list:  curl http://localhost:8080/schedule?channel=rcti
 *   replay: vlc "http://localhost:8080/replay/<epg_id>.m3u8"
 */
'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const API_KEY = 'k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0';
const REFERER = 'https://www.rctiplus.com/';
const ORIGIN = 'https://www.rctiplus.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// Fallback anonymous visitor token, hardcoded in the desktop page template.
const FALLBACK_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ2aWQiOjAsInRva2VuIjoiZjlhYjEyMjg1NmQ3NGYwZiIsInBsIjoid2ViIiwiZGV2aWNlX2lkIjoiMjllNWZkOGEtMDg2YS0xMWVmLTliYTAtMDAxNjNlMDQxOGVjIn0.T0iVov0r2Ai-bhP3NsSoOZhP2WansABSNhrWzvB29-c';

const CHANNELS = { rcti: 1, mnctv: 2, gtv: 3, globaltv: 3, inews: 4 };
const CDN_CHANNEL = [
  ['rcti-linier', 'rcti'],
  ['mnctv-linier', 'mnctv'],
  ['gtv-linier', 'gtv'],
  ['inews-linier', 'inews'],
];

/* ------------------------------------------------------------------ state */
let token = FALLBACK_TOKEN;
let tokenAt = 0;
const cache = new Map(); // key -> {value, at}

function cacheGet(key, ttlMs) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  return undefined;
}
function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
}

async function getToken() {
  // Refresh the anonymous visitor token every 15 min from the live page.
  if (Date.now() - tokenAt < 15 * 60 * 1000) return token;
  try {
    const res = await fetch('https://www.rctiplus.com/tv/rcti', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const m = html.match(/visitorsToken\s*=\s*"([^"]+)"/);
    if (m && m[1] && m[1].length > 100) {
      token = m[1];
      tokenAt = Date.now();
    }
  } catch (_) {
    /* keep last token */
  }
  return token;
}

async function apiHeaders() {
  return {
    Authorization: await getToken(),
    apikey: API_KEY,
    Origin: ORIGIN,
    Referer: REFERER,
    'User-Agent': UA,
  };
}

async function apiGet(url) {
  const res = await fetch(url, {
    headers: await apiHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Resolve the signed master playlist URL for a live channel id. */
async function resolveMaster(channelId) {
  const cached = cacheGet(`live:${channelId}`, 5 * 60 * 1000);
  if (cached) return cached;
  const json = await apiGet(`${API_URL()}/live/${channelId}/url?appierid=vlc-proxy`);
  if (!json.data || !json.data.url) throw new Error('no stream url in API reply');
  cacheSet(`live:${channelId}`, json.data.url);
  return json.data.url;
}

/** Resolve the signed master playlist URL for a catch-up (replay) EPG id. */
async function resolveEpgMaster(epgId) {
  const cached = cacheGet(`epg:${epgId}`, 5 * 60 * 1000);
  if (cached) return cached;
  const json = await apiGet(`${API_URL()}/epg/${epgId}/url?appierid=vlc-proxy`);
  if (!json.data || !json.data.url) throw new Error('no replay url in API reply');
  cacheSet(`epg:${epgId}`, json.data.url);
  return json.data.url;
}

function API_URL() {
  return 'https://toutatis.rctiplus.com/video/live/api/v1';
}

/* ------------------------------------------------------------ proxying */
const b64 = (u) => Buffer.from(u, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

/** Fetch a URL from the CDN with the headers the CDN requires. */
async function cdnFetch(url) {
  return fetch(url, {
    headers: {
      Referer: REFERER,
      Origin: ORIGIN,
      'User-Agent': UA,
      Accept: '*/*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
}

/** Rewrite every URL line in an HLS playlist to go through this proxy. */
function rewritePlaylist(body, baseUrl) {
  return body
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t === '' || t.startsWith('#')) return line;
      const abs = new URL(t, baseUrl).toString();
      return '/h/' + b64(abs);
    })
    .join('\n');
}

async function handlePlaylist(url) {
  const res = await cdnFetch(url);
  if (!res.ok) throw Object.assign(new Error(`CDN ${res.status}`), { status: res.status });
  const body = await res.text();
  if (!body.startsWith('#EXTM3U')) throw new Error('not an HLS playlist');
  return rewritePlaylist(body, url);
}

async function handleAsset(req, res) {
  const url = unb64(req.url.slice(3)); // strip /h/
  try {
    const upstream = await cdnFetch(url);
    const ctype = upstream.headers.get('content-type') || 'application/octet-stream';
    const isPlaylist = /mpegurl|hls/i.test(ctype);

    res.writeHead(200, {
      'Content-Type': isPlaylist ? 'application/vnd.apple.mpegurl' : ctype,
      'Cache-Control': isPlaylist ? 'no-store' : 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    });
    if (isPlaylist) {
      const body = await upstream.text();
      res.end(rewritePlaylist(body, url));
    } else {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    }
  } catch (e) {
    // hdnts/hdntl tokens expire; if a playlist dies mid-session, point the
    // player back at a fresh master so it re-resolves with new tokens.
    if (e.status === 403 && /\/hdntl=/.test(url) && /\.m3u8/i.test(url)) {
      let channel = 'rcti';
      try {
        const host = new URL(url).hostname;
        const hit = CDN_CHANNEL.find(([h]) => host.startsWith(h));
        if (hit) channel = hit[1];
      } catch (_) {}
      cache.delete(`live:${CHANNELS[channel]}`);
      res.writeHead(302, { Location: `/${channel}.m3u8` });
      return res.end();
    }
    res.writeHead(e.status || 502, { 'Content-Type': 'text/plain' });
    res.end(`proxy error: ${e.message}`);
  }
}

async function serveMaster(masterUrl, res) {
  try {
    const body = await handlePlaylist(masterUrl);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(e.status || 502, { 'Content-Type': 'text/plain' });
    res.end(`proxy error: ${e.message}`);
  }
}

async function handleLive(channelId, res) {
  try {
    await serveMaster(await resolveMaster(channelId), res);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`proxy error: ${e.message}`);
  }
}

async function handleReplay(epgId, res) {
  try {
    await serveMaster(await resolveEpgMaster(epgId), res);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`proxy error: ${e.message}`);
  }
}

/* ----------------------------------------------------------- schedule */
async function fetchSchedule(channel) {
  const cached = cacheGet(`schedule:${channel}`, 10 * 60 * 1000);
  if (cached) return cached;

  const page = await fetch(`https://www.rctiplus.com/tv/${channel}`, {
    headers: { 'User-Agent': UA, Referer: REFERER },
    signal: AbortSignal.timeout(20000),
  });
  const html = await page.text();

  const items = [];
  // note: capture groups are (channel, epg_id, slug, date, title, start, end)
  const re =
    /clickCatchup\(\s*'https:\/\/www\.rctiplus\.com\/tv\/(rcti|mnctv|gtv|inews)\/(\d+)\/([a-z0-9-]+)\?date=([0-9-]+)'[^>]*>\s*<h2>\s*([^<]+?)\s*<\/h2>\s*<br>\s*<h4>\s*([0-9:]+)\s*-\s*([0-9:]+)\s*<\/h4>/gs;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== channel) continue;
    items.push({
      epg_id: Number(m[2]),
      slug: m[3],
      date: m[4],
      title: m[5].trim(),
      start: m[6],
      end: m[7],
      url: `/replay/${m[2]}.m3u8`,
      permalink: `https://www.rctiplus.com/tv/${m[1]}/${m[2]}/${m[3]}?date=${m[4]}`,
    });
  }

  const result = { channel, generated_at: new Date().toISOString(), items };
  cacheSet(`schedule:${channel}`, result);
  return result;
}

function handleSchedule(channel, res) {
  fetchSchedule(channel)
    .then((data) => {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(data, null, 2));
    })
    .catch((e) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`proxy error: ${e.message}`);
    });
}

/* ------------------------------------------------------------- server */
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const query = Object.fromEntries(
    new URL(req.url, 'http://x').searchParams
  );

  if (path === '/' || path === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(
      'RCTI+ proxy\n' +
        '  live    vlc http://localhost:' + PORT + '/rcti.m3u8   (rcti|mnctv|gtv|inews)\n' +
        '  list    curl http://localhost:' + PORT + '/schedule?channel=rcti\n' +
        '  replay  vlc "http://localhost:' + PORT + '/replay/<epg_id>.m3u8"\n'
    );
    return;
  }

  if (path.startsWith('/h/')) return void handleAsset(req, res);

  // /schedule?channel=rcti  or  /rcti/schedule
  if (path === '/schedule') {
    const ch = (query.channel || 'rcti').toLowerCase();
    if (!CHANNELS[ch]) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('unknown channel: ' + ch);
    }
    return void handleSchedule(ch, res);
  }
  const sch = path.match(/^\/(rcti|mnctv|gtv|inews)\/schedule$/);
  if (sch) return void handleSchedule(sch[1], res);

  // /replay/<epg_id>.m3u8
  const rp = path.match(/^\/replay\/(\d+)\.m3u8$/i);
  if (rp) return void handleReplay(rp[1], res);

  // live: /<channel>.m3u8
  const name = path.replace(/^\/+/, '').replace(/\.m3u8$/i, '').toLowerCase();
  const channelId = CHANNELS[name];
  if (channelId) return void handleLive(channelId, res);

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('unknown route: ' + path);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`RCTI+ proxy running on http://localhost:${PORT}`);
  console.log('  live:    /rcti.m3u8 /mnctv.m3u8 /gtv.m3u8 /inews.m3u8');
  console.log('  list:    /schedule?channel=rcti');
  console.log('  replay:  /replay/<epg_id>.m3u8');
});
