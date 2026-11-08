<script setup lang="ts">
import type { Section } from '../record/RecordSections.vue'

defineProps<{ sections: readonly Section[]; label: string; active: string }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <nav class="mu-form-sections" :aria-label="label">
    <h2>{{ label }}</h2>
    <button
      v-for="section in sections" :key="section.id" type="button"
      :class="{ active: active === section.id }" :aria-current="active === section.id ? 'location' : undefined"
      @click="emit('select', section.id)"
    >
      {{ section.label }}
    </button>
  </nav>
</template>
