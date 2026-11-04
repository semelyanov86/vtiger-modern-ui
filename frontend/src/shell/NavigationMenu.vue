<script setup lang="ts">
/**
 * The menu of the new interface (docs/settings.md §6.2): the modules the user may open, grouped and labelled by the
 * settings, favorites first. A non-modal popover next to the system menu; Esc and a click outside close it, the
 * focus returns to the button. The full navigation shell (mega menu instead of the v7 app menu, favorites bar) is
 * stage 06; the menu data and its settings are the same.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { LayoutGrid } from '@lucide/vue'
import type { Menu } from '../api/types'
import MenuPanel from '../menu/MenuPanel.vue'

defineProps<{ menu: Menu }>()

const { t } = useI18n()
const open = ref(false)
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger class="mu-system-menu__trigger mu-navigation__trigger" :aria-label="t('menu.button')" :title="t('menu.button')">
      <LayoutGrid :size="18" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal to="#mu-overlay-root">
      <PopoverContent class="mu-navigation" side="bottom" align="end" :side-offset="6" :collision-padding="8" :aria-label="t('menu.title')">
        <MenuPanel :menu="menu" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

.mu-root.mu-navigation-root {
  float: right;
  display: flex;
  align-items: center;
  height: 100%;
  min-height: 50px;
  padding: 0 0 0 8px;
}

.mu-root .mu-navigation {
  width: min(760px, calc(100vw - 16px));
  max-height: min(70vh, 640px);
  overflow: auto;
  padding: 16px;
  border: 1px solid tok(divider);
  border-radius: 6px;
  background: tok(menu-bg);
  box-shadow: 0 0 16px rgba(0, 0, 0, 0.14);
}
</style>
