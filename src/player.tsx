/**
 * Browser media player page, server-rendered with Hono's built-in JSX engine
 * (`hono/jsx`).
 *
 * React-ish JSX on Hono: hono/jsx is the framework's own JSX renderer (see
 * https://hono.dev/docs/guides/jsx) and needs no extra dependencies — the
 * hls.js fallback is served locally by the proxy at /hls.js (from
 * node_modules), so the page never depends on an external CDN.  (Real React
 * would require adding `@hono/react-renderer` + `react` + `react-dom`, which
 * is overkill for a lightweight proxy, so we use hono/jsx instead.)
 *
 * The page lets you pick a live channel and plays its /<channel>.m3u8 stream
 * through this proxy, always via hls.js — never the browser's native HLS,
 * which some browsers spin in a tight loop against live manifests. The
 * 7-day catch-up schedule ("jadwal replay") is fetched from /schedule and
 * rendered inline as a playable list; clicking a program plays its
 * /replay/<epg_id>.m3u8 stream in the same player.
 */
import { raw } from 'hono/html';
import type { FC } from 'hono/jsx';

const CSS = /* css */ `
  :root {
    --bg: #0d1117; --panel: #161b22; --border: #30363d;
    --fg: #e6edf3; --muted: #8b949e; --accent: #1f6feb;
    --ok: #3fb950; --err: #f85149;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 48px; }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h1 { font-size: 20px; margin: 0; }
  .sub { color: var(--muted); font-size: 13px; margin: 4px 0 18px; }
  .chans { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .chan { padding: 9px 18px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--panel); color: var(--fg); cursor: pointer; font-size: 14px;
    font-weight: 600; letter-spacing: .5px; transition: background .15s; }
  .chan:hover { border-color: var(--muted); }
  .chan.active { background: var(--accent); border-color: var(--accent); }
  select#quality { background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 10px; font-size: 13px; font-weight: 600; }
  select#quality:hover { border-color: var(--muted); }
  .ctrl { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .ctrl label { font-size: 13px; color: var(--muted); }
  .stage { position: relative; border-radius: 10px; overflow: hidden;
    background: #000; border: 1px solid var(--border); }
  video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }

  #status { margin-top: 14px; font-size: 14px; min-height: 18px; }
  #status.ok { color: var(--ok); }
  #status.err { color: var(--err); }
  .sched { margin-top: 28px; }
  .sched h2 { font-size: 15px; margin: 0 0 4px; }
  .sched .sub { margin: 0 0 12px; }
  .sched .date { font-size: 13px; color: var(--muted); font-weight: 600;
    margin: 18px 0 8px; text-transform: uppercase; letter-spacing: .4px; }
  .prog { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
    padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--panel); color: var(--fg); cursor: pointer; font-size: 13.5px;
    margin-bottom: 6px; transition: border-color .15s, background .15s; }
  .prog:hover { border-color: var(--muted); }
  .prog.active { border-color: var(--accent); background: rgba(31, 111, 235, .14); }
  .prog .time { color: var(--muted); font-variant-numeric: tabular-nums;
    white-space: nowrap; min-width: 84px; }
  .prog .ttl { flex: 1; }
  .prog .play { color: var(--accent); font-size: 12px; white-space: nowrap; }
  .empty { color: var(--muted); font-size: 13px; margin: 8px 0; }
  .arch { margin-top: 28px; }
  .arch h2 { font-size: 15px; margin: 0 0 4px; }
  .arch .sub { margin: 0 0 12px; }
  input#arch-date { background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 10px; font-size: 13px; margin-bottom: 12px;
    color-scheme: dark; }
  input#arch-date:hover { border-color: var(--muted); }
  code { background: var(--panel); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  footer { margin-top: 26px; font-size: 12px; color: #6e7681; }
  footer a { color: #58a6ff; text-decoration: none; margin-right: 12px; }
  footer a:hover { text-decoration: underline; }
`;

function playerJs(channels: string[]): string {
  return `
const CHANNELS = ${JSON.stringify(channels)};
const video = document.getElementById('player');
const statusEl = document.getElementById('status');
const title = document.getElementById('title');
let hls = null;
let quality = 'best';   // hoisted so the select listener can read it
let currentPath = null;
let currentLabel = '';

// Append the proxy-side quality filter to a local path (auto → no filter).
function streamUrl(path) {
  return quality && quality !== 'auto' ? path + '?quality=' + quality : path;
}

function setStatus(msg, ok) {
  statusEl.textContent = msg;
  statusEl.className = ok ? 'ok' : 'err';
}

// Track *actual* playback via media events, never optimistic promises.  Unmuted
// autoplay is blocked without a user gesture, and the play() promise can stay
// pending forever instead of rejecting — so the events are the only reliable
// signal.
let playing = false;
video.addEventListener('playing', function () {
  playing = true;
  setStatus('Playing ' + (currentLabel || ''), true);
});
video.addEventListener('waiting', function () {
  setStatus('Buffering ' + (currentLabel || '') + '...', true);
});

// Make the BUILT-IN play button work after a blocked autoplay attempt.  hls.js
// had already attached its media during the non-gesture attempt, and a plain
// play() won't resume that stale state — but a real (isTrusted) click on the
// native button is a valid user gesture, so restart the current program under
// it, exactly like switching channels.  The short delay + playing-flag check
// avoid restarting when autoplay actually succeeded.
video.addEventListener('play', function (ev) {
  if (!ev.isTrusted || playing) return;   // ignore our own programmatic plays
  const path = currentPath;
  const label = currentLabel;
  if (!path) return;
  setTimeout(function () {
    if (!playing && video.currentTime === 0 && path) playPath(path, label);
  }, 500);
});

function stop() {
  if (hls) { hls.destroy(); hls = null; }
  video.removeAttribute('src');
  video.load();
}

function playPath(path, label) {
  currentPath = path;
  currentLabel = label;
  playUrl(streamUrl(path), label);
}

function playUrl(url, label) {
  stop();
  playing = false;
  title.textContent = 'RCTI+ Proxy - ' + label;
  try {
    if (!window.Hls || !Hls.isSupported()) {
      setStatus('hls.js tidak tersedia di browser ini.', false);
      return;
    }
    // Always hls.js — never the browser's native HLS.  Some browsers report
    // native HLS support and spin the native element in a tight loop against
    // the proxy's live playlist (no-stopa); hls.js is a well-behaved client
    // that paces re-polls on the manifest and self-heals.
    hls = new Hls({
      // Live: start a bit before the live edge and cap buffering so we don't
      // chase an ever-growing window.
      liveSyncDurationCount: 3,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 90,
      // Bump legacy autoplay policies with an allowed start.
      startFragPrefetch: true,
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setStatus('Loading ' + label + '...', true);
      const p = video.play();
      if (p && p.then) p.catch(() => setStatus('Autoplay blocked — press play.', false));
    });
    // Never let a single bad segment push the stream to a dead-end: recover
    // network/media errors transparently and only surface real failures.
    hls.on(Hls.Events.ERROR, (e, data) => {
      if (!data || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // A dead live window (e.g. between programs) retries on its own.
        if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
          setStatus('Menunggu program berikutnya...', true);
          return;
        }
        if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT) {
          setStatus('Menunggu segmen berikutnya...', true);
        }
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        setStatus('Mencoba pulihkan playback...', true);
        hls.recoverMediaError();
        return;
      }
      setStatus('Playback error: ' + (data.details || data.type), false);
      hls.destroy();
      hls = null;
    });
    setStatus('Loading ' + label + '...', true);
  } catch (err) {
    setStatus('Failed to start playback: ' + (err && err.message), false);
  }
}

function play(channel) {
  document.querySelectorAll('.chan').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-ch') === channel);
  });
  playPath('/' + channel + '.m3u8', channel.toUpperCase());
  loadSchedule(channel);
  if (archInput.value) loadArchive(archInput.value);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function loadSchedule(channel) {
  const listEl = document.getElementById('sched-list');
  const status = document.getElementById('sched-status');
  listEl.innerHTML = '';
  status.className = 'sub';
  status.textContent = 'Memuat jadwal ' + channel.toUpperCase() + '...';
  fetch('/schedule?channel=' + encodeURIComponent(channel))
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      const items = (data && data.items) || [];
      if (!items.length) {
        status.textContent = 'Tidak ada program catch-up untuk ' + channel.toUpperCase() + '.';
        return;
      }
      status.textContent = '';
      const byDate = {};
      items.forEach(function (it) {
        (byDate[it.date] = byDate[it.date] || []).push(it);
      });
      Object.keys(byDate).sort().reverse().forEach(function (date) {
        const h = document.createElement('div');
        h.className = 'date';
        h.textContent = date;
        listEl.appendChild(h);
        byDate[date].forEach(function (it) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'prog';
          b.setAttribute('data-epg', it.epg_id);
          const time = document.createElement('span');
          time.className = 'time';
          time.textContent = it.start + '\\u2013' + it.end;
          const ttl = document.createElement('span');
          ttl.className = 'ttl';
          ttl.textContent = it.title;
          const play = document.createElement('span');
          play.className = 'play';
          play.textContent = '\\u25b6 Putar';
          b.appendChild(time);
          b.appendChild(ttl);
          b.appendChild(play);
          b.addEventListener('click', function () { playEpg(it.epg_id, it.title); });
          listEl.appendChild(b);
        });
      });
    })
    .catch(function (err) {
      status.className = 'err';
      status.textContent = 'Gagal memuat jadwal: ' + (err && err.message);
    });
}

function playEpg(epgId, progTitle) {
  document.querySelectorAll('.prog').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-epg') === String(epgId));
  });
  playPath('/replay/' + epgId + '.m3u8', progTitle);
}

// ----------------------------------------------------- deep history archive
// The web page only lists 7 days, but VOD files on the CDN are kept ~4 months.
// /history/range gives the playable window, /history/day/<date> finds the
// programs for an arbitrary date by scanning the EPG id space.
const archInput = document.getElementById('arch-date');

function loadRange() {
  fetch('/history/range')
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function (r) {
      archInput.min = r.earliest;
      archInput.max = r.latest;
      if (!archInput.value) archInput.value = r.earliest;
      loadArchive(archInput.value);
    })
    .catch(function () {
      const status = document.getElementById('arch-status');
      status.className = 'err';
      status.textContent = 'Tidak dapat memuat rentang arsip.';
    });
}

function loadArchive(date) {
  const channel = document.querySelector('.chan.active').getAttribute('data-ch');
  const listEl = document.getElementById('arch-list');
  const status = document.getElementById('arch-status');
  listEl.innerHTML = '';
  status.className = 'sub';
  status.textContent = 'Memuat arsip ' + date + '...';
  fetch('/history/day/' + date + '?channel=' + encodeURIComponent(channel))
    .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(function (data) {
      const items = (data && data.items) || [];
      const playable = items.filter(function (it) { return it.playable; });
      if (!playable.length) {
        status.textContent = items.length
          ? 'Program pada tanggal ini sudah tidak tersedia di CDN (retensi \u00b14 bulan).'
          : 'Tidak ada program catch-up untuk tanggal ini.';
        return;
      }
      status.textContent = playable.length + ' program tersedia (' + date + ')';
      playable.forEach(function (it) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'prog';
        b.setAttribute('data-epg', it.epg_id);
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = it.start + '\u2013' + it.end;
        const ttl = document.createElement('span');
        ttl.className = 'ttl';
        ttl.textContent = it.title;
        const play = document.createElement('span');
        play.className = 'play';
        play.textContent = '\u25b6 Putar';
        b.appendChild(time);
        b.appendChild(ttl);
        b.appendChild(play);
        b.addEventListener('click', function () { playEpg(it.epg_id, it.title); });
        listEl.appendChild(b);
      });
    })
    .catch(function (err) {
      status.className = 'err';
      status.textContent = 'Gagal memuat arsip: ' + (err && err.message);
    });
}

window.addEventListener('load', () => {
  document.getElementById('quality').addEventListener('change', function (e) {
    quality = e.target.value;
    if (currentPath) playPath(currentPath, currentLabel);
  });
  document.querySelectorAll('.chan').forEach(function (b) {
    b.addEventListener('click', function () {
      play(b.getAttribute('data-ch'));
    });
  });
  archInput.addEventListener('change', function () { loadArchive(archInput.value); });
  loadRange();
  if (CHANNELS.length) play(CHANNELS[0]);
});
`;
}

interface PlayerProps {
  port: number;
  channels: string[];
}

const PlayerPage: FC<PlayerProps> = ({ port, channels }) => (
  <html lang="id">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title id="title">RCTI+ Proxy — Player</title>
      <style>{raw(CSS)}</style>
    </head>
    <body>
      <div class="wrap">
        <header>
          <h1>RCTI+ Proxy</h1>
          <span class="sub">live player · port {port}</span>
        </header>
        <p class="sub">
          Server-rendered with Hono's built-in JSX (<code>hono/jsx</code>). Streams are
          proxied by this app; URLs work in any player, e.g.{' '}
          <code>http://localhost:{port}/rcti.m3u8</code>.
        </p>
        <div class="ctrl">
          <label for="quality">Kualitas</label>
          <select id="quality">
            <option value="best" selected>Tertinggi (720p)</option>
            <option value="auto">Otomatis (ABR)</option>
            <option value="720">720p</option>
            <option value="480">480p</option>
            <option value="360">360p</option>
            <option value="240">240p</option>
            <option value="144">144p</option>
          </select>
        </div>
        <div class="chans">
          {channels.map((ch) => (
            <button class="chan" data-ch={ch} type="button">
              {ch.toUpperCase()}
            </button>
          ))}
        </div>
        <div class="stage">
          <video id="player" controls playsinline preload="auto" />
        </div>
        <div id="status">Pick a channel.</div>
        <div class="sched">
          <h2>Jadwal Replay — 7 hari terakhir</h2>
          <div id="sched-status" class="sub"></div>
          <div id="sched-list"></div>
        </div>
        <div class="arch">
          <h2>Arsip Replay — lebih dari 7 hari</h2>
          <p class="sub">
            RCTI+ hanya menampilkan 7 hari di daftar, tapi file VOD di CDN
            tersimpan hingga {'±'}4 bulan. Pilih tanggal untuk menemukan
            program lama (mungkin butuh beberapa detik untuk memindai).
          </p>
          <input type="date" id="arch-date" />
          <div id="arch-status" class="sub"></div>
          <div id="arch-list"></div>
        </div>
        <footer>
          Live HLS · <a href="/schedule">jadwal JSON</a> ·
          arsip <code>/{'history/day/YYYY-MM-DD'}</code> ·
          replay <code>/{'{epg_id}'}.m3u8</code>
        </footer>
      </div>
      <script src="/hls.js"></script>
      <script>{raw(playerJs(channels))}</script>
    </body>
  </html>
);

/**
 * Render the full HTML document for the player page. Fully static tree, so the
 * sync `String()` coercion yields a plain HTML string for Hono's `c.html()`.
 */
export function playerPage(port: number, channels: string[]): string {
  return `<!doctype html>${String(<PlayerPage port={port} channels={channels} />)}`;
}
