<script setup lang="ts">
import { Info, EllipsisVertical } from '@lucide/vue'
defineProps<{ actions: string; context: string; actionsOpen: boolean; contextOpen: boolean }>()
const emit = defineEmits<{ actions: [open: boolean]; context: [open: boolean] }>()
</script>

<template>
  <button
    type="button" class="mu-record-context-toggle" :title="context" :aria-label="context" :aria-expanded="contextOpen"
    @click="emit('context', !contextOpen)"
  >
    <Info :size="18" aria-hidden="true" />
  </button>
  <button
    type="button" class="mu-record-actions-toggle" :title="actions" :aria-label="actions" :aria-expanded="actionsOpen"
    @click="emit('actions', !actionsOpen)"
  >
    <EllipsisVertical :size="18" aria-hidden="true" />
  </button>
</template>
