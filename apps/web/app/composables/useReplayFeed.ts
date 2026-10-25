import { ref, watch, type Ref } from "vue";
import type { ApiClient, DaySection, ReplayItem } from "~/utils/api";

const BATCH = 3;

export function useReplayFeed(api: ApiClient) {
  const sections = ref<DaySection[]>([]);
  const loading = ref(false);
  const done = ref(false);
  const error = ref("");
  const dates = ref<string[]>([]);
  const cursor = ref(0);

  function reset(): void {
    sections.value = [];
    dates.value = [];
    cursor.value = 0;
    done.value = false;
    error.value = "";
  }

  async function fetchBatch(channel: string): Promise<boolean> {
    let added = false;
    for (let i = 0; i < BATCH && cursor.value < dates.value.length; i++) {
      const date = dates.value[cursor.value]!;
      cursor.value += 1;
      const items = await api.day(date, channel);
      if (!items.length) continue;
      sections.value = [...sections.value, { date, items }];
      added = true;
    }
    return added;
  }

  async function load(channel: string): Promise<void> {
    reset();
    loading.value = true;
    try {
      dates.value = await api.days(channel);
      if (!dates.value.length) {
        done.value = true;
        return;
      }
      await fetchBatch(channel);
      done.value = cursor.value >= dates.value.length;
    } catch (cause) {
      error.value = `Failed to load replay: ${(cause as Error).message}`;
      done.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function loadMore(channel: string): Promise<void> {
    if (loading.value || done.value || cursor.value >= dates.value.length) return;
    loading.value = true;
    try {
      await fetchBatch(channel);
      done.value = cursor.value >= dates.value.length;
    } catch (cause) {
      error.value = `Failed to load: ${(cause as Error).message}`;
      done.value = true;
    } finally {
      loading.value = false;
    }
  }

  
  function find(epgId: number): ReplayItem | null {
    for (const section of sections.value) {
      const hit = section.items.find((item) => item.epgId === epgId);
      if (hit) return hit;
    }
    return null;
  }

  return { sections, loading, done, error, dates, cursor, load, loadMore, reset, find };
}

export function useReplayForChannel(api: ApiClient, channel: Ref<string>) {
  const feed = useReplayFeed(api);
  watch(
    channel,
    (next) => {
      if (next) void feed.load(next);
    },
    { immediate: true }
  );
  return feed;
}
