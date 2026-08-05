/**
 * RCTI+ immersive Android-TV player (Vite + Tailwind + hls.js).
 *
 * Design: a full-screen black theater. While watching, the screen shows only
 * the picture; the chrome (a tiny channel label and a `Channels` button)
 * fades in on any activity and back out on idle. One left-side panel holds
 * everything else — channels, replay schedule — kept deliberately
 * sparse (hairline rows, muted type, one white accent for the active item).
 */
import './style.css';
import { Player } from './player';
import { api, QUALITIES, type Quality, type ScheduleItem } from './api';

/* ------------------------------------------------------------- shell */
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<div class="fixed inset-0 bg-black text-white">
  <video id="video" class="absolute inset-0 h-full w-full object-contain"
         controls playsinline preload="auto"></video>

  <div id="backdrop" aria-hidden="true"></div>

  <div class="hud pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between
              p-4 text-sm">
    <div>
      <div id="now" class="text-white/60"></div>
      <div id="status" class="mt-0.5 text-xs text-white/40"></div>
    </div>
  </div>

  <div class="absolute top-4 right-4 flex gap-2">
    <button id="fs-btn" type="button" aria-label="Layar penuh"
      class="hud focusable rounded-sm border border-white/15 bg-black/60
             px-3.5 py-2.5 text-white/70 hover:text-white hover:border-white/40"></button>
    <button id="menu-btn" type="button"
      class="hud focusable rounded-sm border border-white/15 bg-black/60
             px-4 py-2.5 text-sm text-white/70 hover:text-white hover:border-white/40">
      Channels
    </button>
  </div>

  <aside id="side" aria-label="Menu"
    class="flex h-full w-80 max-w-[85vw] flex-col border-r border-white/10 bg-black">
    <div class="overflow-y-auto flex-1 pb-2">
      <div id="channels"></div>
      <div class="section-label">Replay</div>
      <div id="replay"></div>
    </div>
    <div class="flex items-center justify-between border-t border-white/10 px-4 py-3">
      <span class="text-[10px] uppercase tracking-[0.18em] text-white/35">Kualitas</span>
      <select id="quality" class="focusable rounded-sm bg-transparent text-right text-sm
        text-white/80 outline-none">
        ${QUALITIES.map((q) => `<option value="${q.value}">${q.label}</option>`).join('')}
      </select>
    </div>
  </aside>
</div>
`;

const video = document.getElementById('video') as HTMLVideoElement;
const backdrop = document.getElementById('backdrop') as HTMLDivElement;
const nowEl = document.getElementById('now') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const menuBtn = document.getElementById('menu-btn') as HTMLButtonElement;
const fsBtn = document.getElementById('fs-btn') as HTMLButtonElement;
const side = document.getElementById('side') as HTMLElement;
const channelList = document.getElementById('channels') as HTMLDivElement;
const replayList = document.getElementById('replay') as HTMLDivElement;
const qualitySel = document.getElementById('quality') as HTMLSelectElement;

/* ----------------------------------------------------------- state */
let channels: string[] = [];
let activeChannel = '';
let activeEpgId: number | null = null;
let quality: Quality = 'best';

let sideOpen = false;
let chromeTimer = 0;

const player = new Player(video, {
  status: (kind, msg) => {
    statusEl.textContent = msg;
    // No status line (e.g. while playing) → float the program title centered.
    document.body.classList.toggle('center-title', msg.trim() === '');
    statusEl.className = `mt-0.5 text-xs ${
      kind === 'error'
        ? 'text-red-400'
        : kind === 'buffering'
          ? 'text-white/50'
          : 'text-white/30'
    }
    ${kind === 'playing' ? 'hidden' : ''}`;
  },
  nowPlaying: (label) => {
    nowEl.textContent = label;
  },
});

/* ---------------------------------------------------------- fullscreen
   The native video controls fullscreen only the <video> element, hiding the
   custom HUD (channel label + Channels menu). Fullscreen is therefore always
   app-wide: the toggle below enters it on #app, and any video-only fullscreen
   (native button, TV browser auto-fullscreen) is migrated up to the app so
   the menu stays reachable while watching. */
const FS_ENTER_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  class="h-4 w-4" aria-hidden="true">
  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
</svg>`;
const FS_EXIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  class="h-4 w-4" aria-hidden="true">
  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
</svg>`;

const docAny = document as Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
function isFullscreen(): boolean {
  return !!(document.fullscreenElement || docAny.webkitFullscreenElement);
}
function fsRequest(el: HTMLElement): Promise<void> {
  if (el.requestFullscreen) return el.requestFullscreen();
  const w = el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  if (w.webkitRequestFullscreen) return w.webkitRequestFullscreen();
  return Promise.reject(new Error('Fullscreen tidak didukung.'));
}
function fsExit(): Promise<void> {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (docAny.webkitExitFullscreen) return docAny.webkitExitFullscreen();
  return Promise.resolve();
}
function toggleFullscreen(): void {
  if (isFullscreen()) fsExit().catch(() => {});
  else fsRequest(app).catch(() => {});
}
function syncFsIcon(): void {
  const fs = isFullscreen();
  fsBtn.innerHTML = fs ? FS_EXIT_ICON : FS_ENTER_ICON;
  fsBtn.setAttribute('aria-label', fs ? 'Keluar layar penuh' : 'Layar penuh');
}
fsBtn.addEventListener('click', toggleFullscreen);
function migrateVideoFullscreen(): void {
  const fsEl = document.fullscreenElement || docAny.webkitFullscreenElement;
  if (fsEl === video) {
    // Video-only fullscreen hides the HUD; collapse it and re-enter on #app.
    fsExit().catch(() => {});
    const enter = () => {
      if (!isFullscreen()) fsRequest(app).catch(() => {});
    };
    enter(); // same-task: the user's click activation is freshest here
    requestAnimationFrame(enter); // retry if the exit hadn't settled
  }
  syncFsIcon();
}
document.addEventListener('fullscreenchange', migrateVideoFullscreen);
document.addEventListener('webkitfullscreenchange', migrateVideoFullscreen);
syncFsIcon();

/* --------------------------------------------------------- chrome HUD
   Any activity wakes the chrome; it idles away after a few quiet seconds
   unless the panel is open (the panel stays while browsing). */
function wake(): void {
  document.body.classList.add('hud-on');
  window.clearTimeout(chromeTimer);
  chromeTimer = window.setTimeout(() => {
    if (sideOpen) return;
    document.body.classList.remove('hud-on');
  }, 3500);
}
['keydown', 'mousemove', 'pointermove', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, wake, { passive: true }),
);

/* ------------------------------------------------------ side panel */
function setSide(open: boolean): void {
  sideOpen = open;
  document.body.classList.toggle('side-open', open);
  wake();
  if (open) {
    const activeReplay = replayList.querySelector('.row.active') as HTMLElement | null;
    activeReplay?.scrollIntoView({ block: 'center' });
    const target = activeReplay ??
      (channelList.querySelector('.focusable') as HTMLElement | null);
    target?.focus();
  }
}
menuBtn.addEventListener('click', () => setSide(!sideOpen));
// Clicking the dimmed overlay behind the open panel closes it.
backdrop.addEventListener('click', () => setSide(false));
document.addEventListener('click', (e) => {
  if (!sideOpen) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.closest('#side') || t.closest('#menu-btn'))) return;
  setSide(false);
});

/* ------------------------------------------------- directional focus
   Remote-friendly: arrows move to the nearest focusable in that direction;
   when none exists inside the scrollable panel, they page the panel. */
function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.focusable')).filter(
    (el) => el.matches('#menuBtn') || (sideOpen && !!el.closest('#side')),
  );
}
function moveFocus(dir: 'up' | 'down' | 'left' | 'right'): boolean {
  const els = focusables();
  if (!els.length) return false;
  const cur = document.activeElement as HTMLElement | null;
  const current = cur && els.includes(cur) ? cur : els[0]!;
  current.focus();
  const c = current.getBoundingClientRect();
  const cx = c.left + c.width / 2;
  const cy = c.top + c.height / 2;
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const el of els) {
    if (el === current) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - cx;
    const dy = b.top + b.height / 2 - cy;
    if (dir === 'left' && dx >= -4) continue;
    if (dir === 'right' && dx <= 4) continue;
    if (dir === 'up' && dy >= -4) continue;
    if (dir === 'down' && dy <= 4) continue;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  if (best) {
    best.focus();
    return true;
  }
  return false;
}
function scroll(container: HTMLElement, dir: 'up' | 'down'): void {
  const step = container.clientHeight * 0.6;
  if (dir === 'down') container.scrollTop += step;
  else container.scrollTop -= step;
}
function scrollableOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const s = getComputedStyle(node);
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}
window.addEventListener(
  'keydown',
  (e) => {
    wake();
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
    ) {
      return;
    }
    if (e.key === 'ArrowLeft') {
      if (!moveFocus('left')) e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      if (!moveFocus('right')) e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      if (!moveFocus('up')) {
        const s = scrollableOf(document.activeElement as HTMLElement);
        if (s) scroll(s, 'up');
        e.preventDefault();
      }
    } else if (e.key === 'ArrowDown') {
      if (!moveFocus('down')) {
        const s = scrollableOf(document.activeElement as HTMLElement);
        if (s) scroll(s, 'down');
        e.preventDefault();
      }
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      // Android TV back button closes the panel first.
      if (sideOpen) setSide(false);
      e.preventDefault();
    }
  },
  true,
);

/* ---------------------------------------------------------- rendering */
function channelRow(ch: string, index: number): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'row focusable';
  b.setAttribute('data-ch', ch);
  b.innerHTML = `<span class="idx">${String(index + 1).padStart(2, '0')}</span>
                 <span class="title">${ch.toUpperCase()}</span>`;
  b.addEventListener('click', () => selectChannel(ch));
  return b;
}
function progRow(epgId: number, title: string, start: string, end: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'row focusable';
  b.setAttribute('data-epg', String(epgId));
  b.innerHTML = `<span class="time">${start}–${end}</span>
                 <span class="title"></span>`;
  (b.querySelector('.title') as HTMLSpanElement).textContent = title;
  if (epgId === activeEpgId) b.classList.add('active');
  b.addEventListener('click', () => playEpg(epgId, title));
  return b;
}

function renderChannels(): void {
  channels.forEach((ch, i) => {
    const b = channelRow(ch, i);
    if (ch === activeChannel) b.classList.add('active');
    channelList.appendChild(b);
  });
}
function markActive(): void {
  for (const el of channelList.querySelectorAll('.row')) {
    el.classList.toggle(
      'active',
      (el as HTMLElement).getAttribute('data-ch') === activeChannel,
    );
  }
}
function markActiveReplay(): void {
  for (const el of replayList.querySelectorAll('.row')) {
    const epg = (el as HTMLElement).getAttribute('data-epg');
    el.classList.toggle(
      'active',
      epg !== null && activeEpgId !== null && Number(epg) === activeEpgId,
    );
  }
}

/* ---------------------------------------------------------- playback */
function streamPath(slug: string): string {
  return `/${slug}.m3u8`;
}
async function selectChannel(ch: string): Promise<void> {
  activeChannel = ch;
  activeEpgId = null;
  markActive();
  markActiveReplay();
  sideOpen && setSide(false);
  player.play(streamPath(ch), ch.toUpperCase());
  loadReplay(ch);
}
function playEpg(epgId: number, title: string): void {
  activeEpgId = epgId;
  sideOpen && setSide(false);
  player.play(`/replay/${epgId}.m3u8`, title);
  markActiveReplay();
}

/* ------------------------------------------------------- replay list */
// Infinite scroll: the 7-day schedule window seeds the feed, then each time
// the sentinel at the bottom of the list scrolls into view we ask
// /history/prev for the next older playable day and append it, until the
// archive boundary (`earliest`) is reached.
let replayChannel = '';
let replayOldest = '';
let replayBusy = false;
let replayDone = false;
let replayObserver: IntersectionObserver | null = null;

/** Append one date section (header + program rows) to the replay list. */
function appendDateSection(date: string, items: ScheduleItem[]): void {
  const h = document.createElement('div');
  h.className = 'section-label';
  h.textContent = date;
  replayList.appendChild(h);
  for (const it of items) {
    replayList.appendChild(progRow(it.epg_id, it.title, it.start, it.end));
  }
}

/** Sentinels that trigger the next page of the feed when scrolled into view. */
function addSentinel(): void {
  const s = document.createElement('div');
  s.className = 'replay-sentinel flex items-center justify-center py-3 text-xs text-white/40';
  s.textContent = 'Memuat lebih lama…';
  s.id = 'replay-sentinel';
  replayList.appendChild(s);

  replayObserver?.disconnect();
  replayObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMoreReplay();
    },
    { root: replayList.closest('.overflow-y-auto'), rootMargin: '0px 0px 200px 0px' },
  );
  replayObserver.observe(s);
}

/** Fetch and append the next older day once there are playable days left. */
async function loadMoreReplay(): Promise<void> {
  if (replayBusy || replayDone || !replayOldest) return;
  replayBusy = true;
  const sentinel = document.getElementById('replay-sentinel');
  try {
    const res = await api.historyPrev(replayOldest, replayChannel);
    if (res.date && res.items.length) {
      appendDateSection(res.date, res.items);
      replayOldest = res.date;
    }
    replayDone = res.end;
    if (res.end && sentinel) {
      sentinel.textContent = 'Akhir arsip.';
      replayObserver?.disconnect();
      replayObserver = null;
    }
  } catch (err) {
    // A failed page should not kill the feed: mark done and surface the error.
    replayDone = true;
    if (sentinel) sentinel.textContent = `Gagal memuat: ${(err as Error).message}`;
  } finally {
    replayBusy = false;
    // If the sentinel is still visible (e.g. the panel is tall), keep going.
    if (!replayDone && replayObserver && sentinel) {
      const r = sentinel.getBoundingClientRect();
      const root = replayList.closest('.overflow-y-auto') as HTMLElement;
      if (r.top < root.getBoundingClientRect().bottom) loadMoreReplay();
    }
  }
}

async function loadReplay(channel: string): Promise<void> {
  replayChannel = channel;
  replayOldest = '';
  replayDone = false;
  replayBusy = false;
  replayObserver?.disconnect();
  replayObserver = null;
  replayList.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'px-4 py-2 text-xs text-white/40';
  label.textContent = `Memuat replay ${channel.toUpperCase()}…`;
  replayList.appendChild(label);

  try {
    const data = await api.schedule(channel);
    replayList.innerHTML = '';
    const items = data.items ?? [];
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'px-4 py-2 text-xs text-white/40';
      empty.textContent = 'Tidak ada catch-up.';
      replayList.appendChild(empty);
      replayDone = true;
      return;
    }
    const byDate = new Map<string, typeof items>();
    for (const it of items) {
      const list = byDate.get(it.date) ?? [];
      list.push(it);
      byDate.set(it.date, list);
    }
    [...byDate.keys()]
      .sort()
      .reverse()
      .forEach((date) => appendDateSection(date, byDate.get(date) ?? []));
    markActiveReplay();
    // Oldest date shown becomes the cursor for the next /history/prev step.
    replayOldest = [...byDate.keys()].sort()[0]!;
    addSentinel();
  } catch (err) {
    const e = document.createElement('div');
    e.className = 'px-4 py-2 text-xs text-red-400';
    e.textContent = `Gagal memuat replay: ${(err as Error).message}`;
    replayList.appendChild(e);
    replayDone = true;
  }
}

/* ------------------------------------------------------------- boot */
qualitySel.addEventListener('change', () => {
  quality = qualitySel.value as Quality;
  player.setQuality(quality);
});
(async () => {
  try {
    const data = await api.channels();
    channels = data.channels ?? [];
    renderChannels();
    if (channels.length) {
      activeChannel = channels[0]!;
      markActive();
      player.play(streamPath(activeChannel), activeChannel.toUpperCase());
      loadReplay(activeChannel);
    }
  } catch (err) {
    statusEl.textContent = `API tidak dapat dijangkau: ${(err as Error).message}`;
    statusEl.classList.remove('hidden');
  }
  wake();
})();