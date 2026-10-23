import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Player, type PlaybackStatus } from "~/utils/player";

const HUD_IDLE_MS = 3500;

/** Immersive TV player state: playback, chrome visibility and the side panel. */
export function usePlayer() {
  let endedHandler: (() => void) | undefined;
  const video = ref<HTMLVideoElement | null>(null);
  const player = ref<Player | null>(null);
  const status = ref<PlaybackStatus>("idle");
  const statusMessage = ref("");
  const nowPlaying = ref("");
  const quality = ref("best");
  const sideOpen = ref(false);
  const hudVisible = ref(false);
  const activeChannel = ref("");
  const activeEpgId = ref<number | null>(null);

  let hudTimer: ReturnType<typeof setTimeout> | undefined;

  function wake(): void {
    hudVisible.value = true;
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      if (sideOpen.value) return;
      hudVisible.value = false;
    }, HUD_IDLE_MS);
  }

  function setSide(open: boolean): void {
    sideOpen.value = open;
    wake();
  }

  function playChannel(channel: string, api: ReturnType<typeof useApi>): void {
    activeChannel.value = channel;
    activeEpgId.value = null;
    player.value?.play(api.streamUrl(channel, quality.value), channel.toUpperCase());
  }

  function playReplay(epgId: number, title: string, api: ReturnType<typeof useApi>): void {
    activeEpgId.value = epgId;
    sideOpen.value = false;
    player.value?.play(api.replayUrl(epgId, quality.value), title);
    wake();
  }

  watch(quality, (next) => player.value?.setQuality(next));

  onMounted(() => {
    if (!video.value) return;
    player.value = new Player(video.value, {
      status: (kind, message) => {
        status.value = kind;
        statusMessage.value = message;
      },
      nowPlaying: (label) => {
        nowPlaying.value = label;
      },
      ended: () => {
        statusMessage.value = "Finished";
        endedHandler?.();
      },
    });
    wake();
  });

  onBeforeUnmount(() => {
    clearTimeout(hudTimer);
    player.value?.stop();
  });

  function onEnded(handler: () => void): void {
    endedHandler = handler;
  }

  return {
    onEnded,
    video,
    player,
    status,
    statusMessage,
    nowPlaying,
    quality,
    sideOpen,
    hudVisible,
    activeChannel,
    activeEpgId,
    wake,
    setSide,
    playChannel,
    playReplay,
  };
}
