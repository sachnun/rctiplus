<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ScheduleItem } from "~/utils/api";
import { useApi } from "~/composables/useApi";
import { usePlayer } from "~/composables/usePlayer";
import { useReplayForChannel } from "~/composables/useReplayFeed";
import {
  useAutoContinue,
  useFullscreen,
  useRemoteKeys,
  useSpatialFocus,
} from "~/composables/usePlaybackControls";

const api = useApi();
const shell = ref<HTMLElement | null>(null);
const sideScroll = ref<HTMLElement | null>(null);

const channels = ref<string[]>([]);
const loadError = ref("");

const {
  video,
  status,
  statusMessage,
  nowPlaying,
  quality,
  sideOpen,
  hudVisible,
  activeChannel,
  activeEpgId,
  onEnded,
  wake,
  setSide,
  playChannel,
  playReplay,
} = usePlayer();

const feed = useReplayForChannel(api, activeChannel);
const { sections, loading, done, error: feedError } = feed;
const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen(shell);
const { move } = useSpatialFocus(shell);

const autoContinue = useAutoContinue({
  sections,
  activeEpgId,
  onNext: (epgId, title) => playReplay(epgId, title, api),
  onLive: () => playChannel(activeChannel.value, api),
});

onEnded(() => autoContinue.handleEnded());

function selectChannel(channel: string): void {
  playChannel(channel, api);
}

function selectReplay(epgId: number, title: string): void {
  playReplay(epgId, title, api);
}

useRemoteKeys({
  onMove: (direction) => move(direction),
  onBack: () => setSide(false),
  onWake: wake,
});

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

watch(sentinel, (element) => {
  observer?.disconnect();
  observer = null;
  if (!element) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void feed.loadMore(activeChannel.value);
    },
    { root: sideScroll.value, rootMargin: "0px 0px 200px 0px" }
  );
  observer.observe(element);
});

onMounted(async () => {
  try {
    const data = await api.channels();
    channels.value = data.channels ?? [];
    if (channels.value.length) playChannel(channels.value[0]!, api);
  } catch (cause) {
    loadError.value = `API unreachable: ${(cause as Error).message}`;
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

const isPlaying = (kind: string) => kind === "playing";
</script>

<template>
  <div
    ref="shell"
    class="fixed inset-0 bg-black text-white"
    :class="{ 'hud-on': hudVisible, 'side-open': sideOpen }"
    @mousemove="wake"
    @pointermove="wake"
    @touchstart="wake"
  >
    <video
      ref="video"
      class="absolute inset-0 h-full w-full object-contain"
      controls
      playsinline
      preload="auto"
    />

    <div class="backdrop" aria-hidden="true" @click="setSide(false)" />

    <div
      class="hud pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 text-sm"
    >
      <div>
        <div class="text-white/60">{{ nowPlaying }}</div>
        <div
          class="mt-0.5 text-xs"
          :class="{
            'text-red-400': status === 'error',
            'text-white/50': status === 'buffering',
            'text-white/30': status !== 'error' && status !== 'buffering',
            hidden: isPlaying(status) && !statusMessage,
          }"
        >
          {{ statusMessage }}
        </div>
      </div>
    </div>

    <div class="absolute top-4 right-4 z-30 flex gap-2">
      <select
        v-model="quality"
        aria-label="Quality"
        class="hud focusable rounded-sm border border-white/15 bg-black/60 px-2 py-2.5 text-xs text-white/70"
      >
        <option value="best">HD</option>
        <option value="720">720p</option>
        <option value="480">480p</option>
        <option value="360">360p</option>
        <option value="auto">Auto</option>
      </select>
      <button
        type="button"
        data-focusable
        aria-label="Fullscreen"
        class="hud focusable rounded-sm border border-white/15 bg-black/60 px-3.5 py-2.5 text-white/70 hover:border-white/40 hover:text-white"
        @click="toggleFullscreen"
      >
        {{ fullscreen ? "Exit" : "Full" }}
      </button>
      <button
        type="button"
        data-focusable
        class="hud focusable rounded-sm border border-white/15 bg-black/60 px-4 py-2.5 text-sm text-white/70 hover:border-white/40 hover:text-white"
        @click="setSide(!sideOpen)"
      >
        Channels
      </button>
    </div>

    <aside
      aria-label="Menu"
      class="side-panel flex h-full w-80 max-w-[85vw] flex-col border-r border-white/10 bg-black"
    >
      <div ref="sideScroll" class="side-scroll flex-1 overflow-y-auto pb-2">
        <ChannelList
          :channels="channels"
          :active-channel="activeChannel"
          @select="selectChannel"
        />
        <div class="section-label">Replay</div>
        <ReplayList
          :sections="sections"
          :active-epg-id="activeEpgId"
          :loading="loading"
          :done="done"
          :error="feedError"
          @select="selectReplay"
        />
        <div ref="sentinel" class="py-3 text-center text-xs text-white/30">
          {{ done ? "" : "Loading older..." }}
        </div>
      </div>
    </aside>

    <div
      v-if="loadError"
      class="absolute inset-x-0 bottom-6 text-center text-xs text-red-400"
    >
      {{ loadError }}
    </div>
  </div>
</template>
