<script setup lang="ts">
import type { ReplaySection } from "~/composables/useReplayFeed";
import { formatDate } from "~/utils/format";

defineProps<{
  sections: readonly ReplaySection[];
  activeEpgId: number | null;
  loading: boolean;
  done: boolean;
  error: string;
}>();

const emit = defineEmits<{ select: [epgId: number, title: string] }>();
</script>

<template>
  <div>
    <div
      v-for="section in sections"
      :key="section.date"
      class="replay-section"
    >
      <div class="section-label replay-date">{{ formatDate(section.date) }}</div>
      <button
        v-for="item in section.items"
        :key="item.epg_id"
        type="button"
        data-focusable
        class="row focusable"
        :class="{ active: item.epg_id === activeEpgId }"
        @click="emit('select', item.epg_id, item.title)"
      >
        <span class="time">{{ item.start }}-{{ item.end }}</span>
        <span class="title">{{ item.title }}</span>
      </button>
    </div>
    <div v-if="loading" class="px-4 py-3 text-xs text-white/40">Loading more...</div>
    <div v-else-if="error" class="px-4 py-3 text-xs text-red-400">{{ error }}</div>
    <div v-else-if="done" class="px-4 py-3 text-xs text-white/40">End of archive.</div>
  </div>
</template>
