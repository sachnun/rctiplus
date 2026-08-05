/**
 * Browser media player page, server-rendered with Hono's built-in JSX engine
 * (`hono/jsx`).
 *
 * React-ish JSX on Hono: hono/jsx is the framework's own JSX renderer (see
 * https://hono.dev/docs/guides/jsx) and needs no extra dependencies — the
 * hls.js fallback is pulled from jsdelivr at runtime.  (Real React would
 * require adding `@hono/react-renderer` + `react` + `react-dom`, which is
 * overkill for a lightweight proxy, so we use hono/jsx instead.)
 *
 * The page lets you pick a live channel and plays its /<channel>.m3u8 stream
 * through this proxy, using native HLS on Safari and hls.js elsewhere.
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
  .stage { position: relative; border-radius: 10px; overflow: hidden;
    background: #000; border: 1px solid var(--border); }
  video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
  #status { margin-top: 14px; font-size: 14px; min-height: 18px; }
  #status.ok { color: var(--ok); }
  #status.err { color: var(--err); }
  .links { margin-top: 22px; font-size: 13px; color: var(--muted); }
  .links a { color: #58a6ff; text-decoration: none; margin-right: 14px; }
  .links a:hover { text-decoration: underline; }
  code { background: var(--panel); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  footer { margin-top: 26px; font-size: 12px; color: #6e7681; }
`;

function playerJs(channels: string[]): string {
  return `
const CHANNELS = ${JSON.stringify(channels)};
const video = document.getElementById('player');
const statusEl = document.getElementById('status');
const title = document.getElementById('title');
let hls = null;

function setStatus(msg, ok) {
  statusEl.textContent = msg;
  statusEl.className = ok ? 'ok' : 'err';
}

function stop() {
  if (hls) { hls.destroy(); hls = null; }
  video.removeAttribute('src');
  video.load();
}

function play(channel) {
  document.querySelectorAll('.chan').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-ch') === channel);
  });
  const url = '/' + channel + '.m3u8';
  stop();
  title.textContent = 'RCTI+ Proxy - ' + channel.toUpperCase();
  try {
    const native = video.canPlayType('application/vnd.apple.mpegurl');
    if (native) {
      video.src = url;
      video.play().catch(() => setStatus('Autoplay blocked: press play.', false));
      setStatus('Playing ' + channel.toUpperCase(), true);
      return;
    }
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => setStatus('Autoplay blocked: press play.', false));
        setStatus('Playing ' + channel.toUpperCase(), true);
      });
      hls.on(Hls.Events.ERROR, (e, data) => {
        if (data && data.fatal) setStatus('Playback error: ' + (data.details || data.type), false);
      });
      setStatus('Loading ' + channel.toUpperCase() + '...', true);
      return;
    }
    setStatus('HLS not supported in this browser (try Safari or load hls.js).', false);
  } catch (err) {
    setStatus('Failed to start playback: ' + (err && err.message), false);
  }
}

window.addEventListener('load', () => {
  document.querySelectorAll('.chan').forEach(function (b) {
    b.addEventListener('click', function () {
      play(b.getAttribute('data-ch'));
    });
  });
  if (CHANNELS.length) play(CHANNELS[0]);
});
`;
}

interface PlayerProps {
  port: number;
  channels: string[];
}

const PlayerPage: FC<PlayerProps> = ({ port, channels }) => (
  <html lang="en">
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
        <div class="links">
          {channels.map((ch) => (
            <a href={`/schedule?channel=${ch}`}>7-day catch-up · {ch.toUpperCase()}</a>
          ))}
        </div>
        <footer>
          Live HLS · <a href="/schedule">schedule JSON</a> ·
          replay <code>/{'{epg_id}'}.m3u8</code>
        </footer>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.20"></script>
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