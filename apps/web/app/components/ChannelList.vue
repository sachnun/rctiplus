<script setup lang="ts">
defineProps<{
  channels: readonly string[];
  activeChannel: string;
}>();

const emit = defineEmits<{ select: [channel: string] }>();
</script>

<template>
  <div>
    <div class="section-label">Channels</div>
    <button
      v-for="(channel, index) in channels"
      :key="channel"
      type="button"
      data-focusable
      class="row focusable"
      :class="{ active: channel === activeChannel }"
      @click="emit('select', channel)"
    >
      <span class="idx">{{ String(index + 1).padStart(2, "0") }}</span>
      <span class="title">{{ channel.toUpperCase() }}</span>
    </button>
  </div>
</template>
