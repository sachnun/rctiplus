/**
 * HLS playback engine. Always hls.js — never the browser's native HLS, which
 * some browsers spin in a tight loop against live manifests. The proxy's
 * playlists/segments are relative and same-origin, so no CORS work is needed.
 */
import Hls, { type ErrorData } from 'hls.js';

export type PlaybackStatus = 'playing' | 'buffering' | 'error' | 'idle';

export interface PlayerEvents {
  status(status: PlaybackStatus, message: string): void;
  nowPlaying(label: string): void;
  /** The current program reached its end (VOD replay finished). */
  ended(): void;
}

/** Manifest-level load failures: the master itself is dead/expired. */
const MANIFEST_ERRORS = new Set([
  Hls.ErrorDetails.MANIFEST_LOAD_ERROR,
  Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT,
]);

/** Fragment/level load failures: the stream is struggling to start. */
const FRAGMENT_ERRORS = new Set([
  Hls.ErrorDetails.FRAG_LOAD_ERROR,
  Hls.ErrorDetails.FRAG_LOAD_TIMEOUT,
  Hls.ErrorDetails.LEVEL_LOAD_ERROR,
  Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT,
]);

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

    if (!Hls.isSupported()) {
      this.events.status('error', 'hls.js tidak tersedia di browser ini.');
      return;
    }

    const url = this.quality !== 'auto' ? `${path}?quality=${this.quality}` : path;
    const hls = this.buildHls();
    this.hls = hls;
    this.fatalCount = 0;
    hls.loadSource(url);
    hls.attachMedia(this.video);
    this.attachLifecycleHandlers(hls);
  }

  /**
   * hls.js with generous, explicit load timeouts and many internal retries:
   * fragments on the catch-up CDN (past-event.rctiplus.id) can be slow to
   * first byte on weaker links, especially the opening segment of a replay.
   * A slow (not dead) stream is given time to start instead of aborting early.
   */
  private buildHls(): Hls {
    return new Hls({
      liveSyncDurationCount: 3,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 90,
      startFragPrefetch: true,
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
  }

  private attachLifecycleHandlers(hls: Hls): void {
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.events.status('buffering', 'Memuat…');
      const p = this.video.play();
      if (p && typeof p.then === 'function') {
        p.catch(() => this.events.status('idle', 'Autoplay diblokir — tekan play.'));
      }
    });
    this.attachErrorHandler(hls);
  }

  /** Fatal hls.js error handling: recover in place, else surface once. */
  private attachErrorHandler(hls: Hls): void {
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data || !data.fatal) return;
      this.fatalCount += 1;

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (this.handleNetworkError(hls, data)) return;
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

  /** True when the network error was handled in-place (no teardown needed). */
  private handleNetworkError(hls: Hls, data: ErrorData): boolean {
    if (MANIFEST_ERRORS.has(data.details)) {
      // Dead/expired master (live or expired catch-up token): point at a
      // fresh resolution before calling it a day.
      this.events.status('buffering', 'Menunggu program berikutnya…');
      this.fallbackToAuto();
      return true;
    }

    // Give a struggling stream a couple of in-place recoveries first.
    if (FRAGMENT_ERRORS.has(data.details) && this.fatalCount < 3) {
      this.events.status('buffering', 'Menunggu segmen berikutnya…');
      hls.startLoad();
      return true;
    }

    // Nothing buffered and fragments still won't load: drop to 'auto' (ABR,
    // starts at the lowest variant) instead of retrying seg-1 from the top
    // forever. A lower-bandwidth rendition usually starts where the pinned
    // 720p would not.
    if (this.quality !== 'auto') {
      this.events.status('buffering', 'Mencoba kualitas lebih rendah…');
      this.fallbackToAuto();
      return true;
    }
    return false;
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
