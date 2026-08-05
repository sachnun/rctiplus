/**
 * HLS playback engine. Always hls.js — never the browser's native HLS, which
 * some browsers spin in a tight loop against live manifests. The proxy's
 * playlists/segments are relative and same-origin, so no CORS work is needed.
 */
import Hls from 'hls.js';

export type PlaybackStatus = 'playing' | 'buffering' | 'error' | 'idle';

export interface PlayerEvents {
  status(status: PlaybackStatus, message: string): void;
  nowPlaying(label: string): void;
  /** The current program reached its end (VOD replay finished). */
  ended(): void;
}

export class Player {
  private hls: Hls | null = null;
  private video: HTMLVideoElement;
  private events: PlayerEvents;
  private playing = false;
  /** Only two modes now: HD ('best') first, 'auto' as fallback. */
  private quality: string = 'best';
  private currentPath: string | null = null;
  private currentLabel = '';
  /** Consecutive fatal hls.js errors since the last start, for bounded recovery. */
  private fatalCount = 0;

  constructor(video: HTMLVideoElement, events: PlayerEvents) {
    this.video = video;
    this.events = events;

    video.addEventListener('playing', () => {
      this.playing = true;
      this.events.status('playing', '');
    });
    video.addEventListener('waiting', () => {
      this.events.status('buffering', 'Buffering…');
    });
    video.addEventListener('pause', () => {
      this.events.status('idle', 'Paused');
    });
    video.addEventListener('ended', () => {
      this.events.status('playing', 'Selesai');
      this.events.ended();
    });

    // Make the BUILT-IN play button work after a blocked autoplay attempt:
    // a trusted click on the native button restarts the current program.
    video.addEventListener('play', (ev) => {
      if (!ev.isTrusted || this.playing) return;
      const path = this.currentPath;
      const label = this.currentLabel;
      if (!path) return;
      setTimeout(() => {
        if (!this.playing && this.video.currentTime === 0 && path) {
          this.play(path, label);
        }
      }, 500);
    });
  }

  get label(): string {
    return this.currentLabel;
  }

  /** Retry once at 'auto' when the HD manifest cannot be loaded. */
  private fallbackToAuto(): void {
    if (this.quality === 'auto') return;
    this.quality = 'auto';
    if (this.currentPath) this.play(this.currentPath, this.currentLabel);
  }

  /** Start a stream (path relative to the proxy origin). */
  play(path: string, label: string): void {
    this.currentPath = path;
    this.currentLabel = label;
    this.stop();
    this.playing = false;
    this.events.nowPlaying(label);

    const url = this.quality !== 'auto' ? `${path}?quality=${this.quality}` : path;
    if (!Hls.isSupported()) {
      this.events.status('error', 'hls.js tidak tersedia di browser ini.');
      return;
    }

    // Fragments on the catch-up CDN (past-event.rctiplus.id) can be slow to
    // first byte on weaker links, especially the opening segment of a replay.
    // Use generous, explicit load timeouts and many internal retries so a slow
    // (not dead) stream is given time to start instead of aborting early.
    const hls = new Hls({
      liveSyncDurationCount: 3,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 90,
      startFragPrefetch: true,
      // Slow-first-byte tolerance (catch-up CDN can be slow on the first
      // segment, especially at the very start of a replay).
      manifestLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 30000,
          maxLoadTimeMs: 60000,
          timeoutRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 30000 },
          errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 30000 },
        },
      },
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 45000,
          maxLoadTimeMs: 120000,
          timeoutRetry: { maxNumRetry: 12, retryDelayMs: 1000, maxRetryDelayMs: 90000 },
          errorRetry: { maxNumRetry: 12, retryDelayMs: 1000, maxRetryDelayMs: 90000 },
        },
      },
    });
    this.hls = hls;
    this.fatalCount = 0;
    hls.loadSource(url);
    hls.attachMedia(this.video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.events.status('buffering', 'Memuat…');
      const p = this.video.play();
      if (p && typeof p.then === 'function') {
        p.catch(() => this.events.status('idle', 'Autoplay diblokir — tekan play.'));
      }
    });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data || !data.fatal) return;
      this.fatalCount += 1;

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const manifestError =
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT;
        if (manifestError) {
          // Dead/expired master (live or expired catch-up token): point at a
          // fresh resolution before calling it a day.
          this.events.status('buffering', 'Menunggu program berikutnya…');
          this.fallbackToAuto();
          return;
        }

        const fragmentError =
          data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT;

        // Give a struggling stream a couple of in-place recoveries first.
        if (fragmentError && this.fatalCount < 3) {
          this.events.status('buffering', 'Menunggu segmen berikutnya…');
          hls.startLoad();
          return;
        }

        // Nothing buffered and fragments still won't load: drop to 'auto'
        // (ABR, starts at the lowest variant) instead of retrying seg-1 from
        // the top forever. A lower-bandwidth rendition usually starts where
        // the pinned 720p would not.
        if (this.quality !== 'auto') {
          this.events.status('buffering', 'Mencoba kualitas lebih rendah…');
          this.fallbackToAuto();
          return;
        }
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        this.events.status('buffering', 'Mencoba pulihkan…');
        hls.recoverMediaError();
        return;
      }

      // Unrecoverable — surface it once instead of looping silently forever.
      this.events.status('error', `Playback error: ${data.details || data.type}`);
      hls.destroy();
      this.hls = null;
    });
  }

  stop(): void {
    this.fatalCount = 0;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.video.removeAttribute('src');
    this.video.load();
  }
}
