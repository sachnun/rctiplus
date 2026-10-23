import { ref, watch, type Ref } from "vue";
import type { ApiClient, ScheduleItem } from "~/utils/api";

export type ReplaySection = { date: string; items: ScheduleItem[] };

/**
 * Infinite replay feed: the 7-day schedule seeds the list, then every scroll
 * to the bottom appends the next older playable day until the archive ends.
 */
export function useReplayFeed(api: ApiClient) {
  const sections = ref<ReplaySection[]>([]);
  const loading = ref(false);
  const done = ref(false);
  const error = ref("");
  const oldest = ref("");

  function reset(): void {
    sections.value = [];
    oldest.value = "";
    done.value = false;
    error.value = "";
  }

  async function load(channel: string): Promise<void> {
    reset();
    loading.value = true;
    try {
      const data = await api.schedule(channel);
      const byDate = new Map<string, ScheduleItem[]>();
      for (const item of data.items ?? []) {
        const list = byDate.get(item.date) ?? [];
        list.push(item);
        byDate.set(item.date, list);
      }
      const dates = [...byDate.keys()].sort();
      sections.value = [...dates]
        .reverse()
        .map((date) => ({ date, items: byDate.get(date) ?? [] }));
      oldest.value = dates[0] ?? "";
      done.value = dates.length === 0;
    } catch (cause) {
      error.value = `Failed to load replay: ${(cause as Error).message}`;
      done.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function loadMore(channel: string): Promise<void> {
    if (loading.value || done.value || !oldest.value) return;
    loading.value = true;
    try {
      const res = await api.historyPrev(oldest.value, channel);
      if (res.date && res.items.length) {
        sections.value = [
          ...sections.value,
          { date: res.date, items: res.items as unknown as ScheduleItem[] },
        ];
        oldest.value = res.date;
      }
      done.value = res.end;
    } catch (cause) {
      error.value = `Failed to load: ${(cause as Error).message}`;
      done.value = true;
    } finally {
      loading.value = false;
    }
  }

  return { sections, loading, done, error, oldest, load, loadMore, reset };
}

/** Watch a channel ref and (re)load the replay feed for it. */
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
