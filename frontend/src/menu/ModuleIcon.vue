<script setup lang="ts">
/**
 * Icon of a menu item: the module icon of v7 (vicon font, module image, two letters of a custom module) or an icon of
 * the menu set chosen in the settings. Decorative: the label next to it names the item.
 */
import type { ModuleIcon } from '../api/types'
import { ICON_COMPONENTS } from './icons'

withDefaults(defineProps<{ icon: ModuleIcon; size?: number }>(), { size: 16 })
</script>

<template>
  <span class="mu-module-icon" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${size}px` }" aria-hidden="true">
    <i v-if="icon.kind === 'vicon'" :class="icon.name"></i>
    <img v-else-if="icon.kind === 'image'" :src="icon.src" alt="" :width="size" :height="size" />
    <span v-else-if="icon.kind === 'letters'" class="mu-module-icon__letters">{{ icon.text }}</span>
    <component :is="ICON_COMPONENTS[icon.name]" v-else :size="size" :stroke-width="1.75" />
  </span>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

.mu-root .mu-module-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  line-height: 1;
  color: tok(text-2);

  i {
    font-size: inherit;
    line-height: 1;
  }

  img {
    max-width: 100%;
    max-height: 100%;
  }
}

.mu-root .mu-module-icon__letters {
  font-size: 0.7em;
  font-weight: 600;
  text-transform: none;
}
</style>
