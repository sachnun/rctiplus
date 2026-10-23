import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ScheduleItem } from "~/utils/api";
import { addDays, titleSimilarity } from "~/utils/format";
import type { ReplaySection } from "./useReplayFeed";

/**
 * Auto-continue: when a replay program ends, jump to the same program (title)
 * on the next day when it exists, else fall back to the live channel.
 */
export function useAutoContinue(options: {
  sections: { value: ReplaySection[] };
  activeEpgId: { value: number | null };
  onNext(epgId: number, title: string): void;
  onLive(): void;
}) {
  const { sections, activeEpgId, onNext, onLive } = options;
  const enabled = ref(true);

  const current = computed<ScheduleItem | null>(() => {
    if (activeEpgId.value === null) return null;
    for (const section of sections.value) {
      const hit = section.items.find((item) => item.epg_id === activeEpgId.value);
      if (hit) return hit;
    }
    return null;
  });

  function pickNext(program: ScheduleItem): ScheduleItem | null {
    const nextDate = addDays(program.date, 1);
    if (!nextDate) return null;

    let best: ScheduleItem | null = null;
    let bestSimilarity = 0;
    let bestSlot = false;
    for (const section of sections.value) {
      if (section.date !== nextDate) continue;
      for (const candidate of section.items) {
        const similarity = titleSimilarity(program.title, candidate.title);
        if (similarity < 0.6) continue;
        const slot = candidate.start === program.start;
        if (
          best === null ||
          (slot && !bestSlot) ||
          (slot === bestSlot && similarity > bestSimilarity)
        ) {
          best = candidate;
          bestSimilarity = similarity;
          bestSlot = slot;
        }
      }
    }
    return best;
  }

  function handleEnded(): void {
    if (!enabled.value) return;
    const program = current.value;
    if (!program) {
      onLive();
      return;
    }
    const next = pickNext(program);
    if (!next) {
      onLive();
      return;
    }
    onNext(next.epg_id, next.title);
  }

  return { enabled, current, pickNext, handleEnded };
}

/** Remote-friendly directional focus movement over `[data-focusable]` nodes. */
export function useSpatialFocus(root: { value: HTMLElement | null }) {
  function focusables(): HTMLElement[] {
    if (!root.value) return [];
    return [...root.value.querySelectorAll<HTMLElement>("[data-focusable]")].filter(
      (element) => element.offsetParent !== null
    );
  }

  function move(direction: "up" | "down" | "left" | "right"): boolean {
    const elements = focusables();
    if (!elements.length) return false;
    const active = document.activeElement as HTMLElement | null;
    const current = active && elements.includes(active) ? active : elements[0]!;
    current.focus();
    const box = current.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;

    let best: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const element of elements) {
      if (element === current) continue;
      const rect = element.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - cx;
      const dy = rect.top + rect.height / 2 - cy;
      if (direction === "left" && dx >= -4) continue;
      if (direction === "right" && dx <= 4) continue;
      if (direction === "up" && dy >= -4) continue;
      if (direction === "down" && dy <= 4) continue;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = element;
      }
    }
    if (best) {
      best.focus();
      return true;
    }
    return false;
  }

  return { move, focusables };
}

/** Key handling for the TV remote, wired on mount and torn down on unmount. */
export function useRemoteKeys(handlers: {
  onMove(direction: "up" | "down" | "left" | "right"): boolean;
  onBack(): void;
  onWake(): void;
}) {
  function onKeydown(event: KeyboardEvent): void {
    handlers.onWake();
    const target = event.target as HTMLElement | null;
    if (target && ["SELECT", "INPUT", "TEXTAREA"].includes(target.tagName)) return;

    const key = event.key;
    if (key === "ArrowLeft") {
      if (!handlers.onMove("left")) event.preventDefault();
    } else if (key === "ArrowRight") {
      if (!handlers.onMove("right")) event.preventDefault();
    } else if (key === "ArrowUp") {
      if (!handlers.onMove("up")) event.preventDefault();
    } else if (key === "ArrowDown") {
      if (!handlers.onMove("down")) event.preventDefault();
    } else if (key === "Escape" || key === "Backspace") {
      handlers.onBack();
      event.preventDefault();
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeydown, true));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
}

/** Fullscreen handling, app-wide so the HUD and panel stay reachable. */
export function useFullscreen(target: { value: HTMLElement | null }) {
  const active = ref(false);

  function sync(): void {
    active.value = Boolean(document.fullscreenElement);
  }

  async function toggle(): Promise<void> {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await target.value?.requestFullscreen();
  }

  onMounted(() => {
    document.addEventListener("fullscreenchange", sync);
    sync();
  });
  onBeforeUnmount(() => document.removeEventListener("fullscreenchange", sync));

  return { active, toggle };
}
