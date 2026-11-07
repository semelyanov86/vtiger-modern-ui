<script setup lang="ts">
import { ref } from 'vue'

export interface Section { readonly id: string; readonly label: string }
defineProps<{ sections: readonly Section[]; label: string; search: string; empty: string; filter: (value: string) => number }>()
const emit = defineEmits<{ select: [id: string] }>()
const query = ref('')
const selected = ref('')
const noMatches = ref(false)
</script>

<template>
  <nav class="mu-record-sections" :aria-label="label">
    <h2>{{ label }}</h2>
    <button
      v-for="(section, index) in sections" :key="section.id" type="button"
      :class="{ active: selected === section.id || (selected === '' && index === 0) }"
      @click="selected = section.id; emit('select', section.id)"
    >
      {{ section.label }}
    </button>
  </nav>
  <div class="mu-record-search">
    <input v-model="query" type="search" :placeholder="search" :aria-label="search" @input="noMatches = filter(query) === 0" />
  </div>
  <p v-if="noMatches" class="mu-record-empty" role="status">{{ empty }}</p>
</template>
