<script setup lang="ts">
import { ref } from 'vue'

export interface OverflowTab { readonly label: string; readonly element: HTMLElement; readonly active: boolean }
defineProps<{ label: string; tabs: readonly OverflowTab[] }>()
const open = ref(false)
const select = (tab: OverflowTab): void => {
  open.value = false
  tab.element.click()
}
</script>

<template>
  <div v-if="tabs.length" class="mu-record-tab-overflow" @keydown.esc.stop="open = false">
    <button type="button" :class="{ 'is-active': tabs.some(tab => tab.active) }" :aria-expanded="open" :aria-label="label" @click="open = !open">{{ tabs.find(tab => tab.active)?.label ?? label }} ▾</button>
    <div v-if="open" class="mu-record-tab-menu">
      <button v-for="(tab, index) in tabs" :key="index" type="button" @click="select(tab)">{{ tab.label }}</button>
    </div>
  </div>
</template>
