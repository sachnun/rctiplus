import Hls from "hls.js";

export type PlaybackStatus = "playing" | "buffering" | "error" | "idle";

export type PlayerEvents = {
  status(status: PlaybackStatus, message: string): void;
  nowPlaying(label: string): void;
  ended(): void;
};

const RESTART_GUARD_MS = 2000;
const MAX_MEDIA_RECOVERIES = 2;

export function shouldRestartOnPlay(state: {
  attached: boolean;
  now: number;
  lastRestartAt: number;
}): boolean {
  if (state.attached) return false;
  return state.now - state.lastRestartAt >= RESTART_GUARD_MS;
}

export class Player {
  private hls: Hls | null = null;
  private readonly video: HTMLVideoElement;
  private readonly events: PlayerEvents;
  private playing = false;
  private currentUrl: string | null = null;
  private currentLabel = "";
  private fatalCount = 0;
  private mediaRecoveries = 0;
  private manifestRetries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private restartAt = 0;

  constructor(video: HTMLVideoElement, events: PlayerEvents) {
    this.video = video;
    this.events = events;

    video.addEventListener("playing", () => {
      this.playing = true;
      this.events.status("playing", "");
    });
    video.addEventListener("waiting", () => this.events.status("buffering", "Buffering..."));
    video.addEventListener("pause", () => this.events.status("idle", "Paused"));
    video.addEventListener("ended", () => {
      this.events.status("playing", "Finished");
      this.events.ended();
    });
    video.addEventListener("play", (event) => {
      if (!event.isTrusted) return;
      const now = Date.now();
      const attached = this.hls !== null;
      if (!shouldRestartOnPlay({ attached, now, lastRestartAt: this.restartAt })) return;
      const url = this.currentUrl;
      if (!url) return;
      this.restartAt = now;
      this.play(url, this.currentLabel);
    });
  }

  get label(): string {
    return this.currentLabel;
  }

  private retryManifest(): boolean {
    if (this.retryTimer !== undefined || this.manifestRetries >= 2) return false;
    const url = this.currentUrl;
    const label = this.currentLabel;
    if (!url) return false;
    this.manifestRetries += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.currentUrl === url) this.play(url, label);
    }, 3000);
    return true;
  }

  play(url: string, label: string): void {
    if (url !== this.currentUrl) this.manifestRetries = 0;
    this.currentUrl = url;
    this.currentLabel = label;
    this.stop();
    this.playing = false;
    this.events.nowPlaying(label);

    if (!Hls.isSupported()) {
      this.events.status("error", "hls.js is unavailable in this browser.");
      return;
    }

    const hls = new Hls({
      testBandwidth: false,
      abrEwmaDefaultEstimate: 1_000_000,
      liveSyncDurationCount: 3,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 90,
      startFragPrefetch: true,
      manifestLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 30_000,
          maxLoadTimeMs: 60_000,
          timeoutRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 30_000 },
          errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 30_000 },
        },
      },
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 45_000,
          maxLoadTimeMs: 120_000,
          timeoutRetry: { maxNumRetry: 12, retryDelayMs: 1000, maxRetryDelayMs: 90_000 },
          errorRetry: { maxNumRetry: 12, retryDelayMs: 1000, maxRetryDelayMs: 90_000 },
        },
      },
    });

    this.hls = hls;
    this.fatalCount = 0;
    this.mediaRecoveries = 0;
    hls.loadSource(url);
    hls.attachMedia(this.video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.manifestRetries = 0;
      this.events.status("buffering", "Loading...");
      this.video.play().catch(() => this.events.status("idle", "Autoplay blocked, press play."));
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data?.fatal) return;
      this.fatalCount += 1;

      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const manifestError =
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT;
        if (manifestError && this.retryManifest()) {
          this.events.status("buffering", "Waiting for the next program...");
          return;
        }

        const fragmentError =
          data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_ERROR ||
          data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT;

        if (fragmentError && this.fatalCount < 3) {
          this.events.status("buffering", "Waiting for the next segment...");
          hls.startLoad();
          return;
        }
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (this.mediaRecoveries < MAX_MEDIA_RECOVERIES) {
          this.mediaRecoveries += 1;
          this.events.status("buffering", "Recovering...");
          hls.recoverMediaError();
          return;
        }
      }

      this.events.status("error", `Playback error: ${data.details || data.type}`);
      hls.destroy();
      this.hls = null;
    });
  }

  stop(): void {
    this.fatalCount = 0;
    this.mediaRecoveries = 0;
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.video.removeAttribute("src");
    this.video.load();
  }
}
