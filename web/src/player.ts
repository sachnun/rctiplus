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

    const hls = new Hls({
      liveSyncDurationCount: 3,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 90,
      startFragPrefetch: true,
    });
    this.hls = hls;
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
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT
        ) {
          this.events.status('buffering', 'Menunggu program berikutnya…');
          this.fallbackToAuto();
          return;
        }
        if (
          data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT
        ) {
          this.events.status('buffering', 'Menunggu segmen berikutnya…');
        }
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        this.events.status('buffering', 'Mencoba pulihkan…');
        hls.recoverMediaError();
        return;
      }
      this.events.status('error', `Playback error: ${data.details || data.type}`);
      hls.destroy();
      this.hls = null;
    });
  }

  stop(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.video.removeAttribute('src');
    this.video.load();
  }
}
