<script setup lang="ts">
/**
 * Logo and title of the new interface in the v7 header (branding.*). Inserted into the company logo link of the header
 * next to its image; the image of v7 is hidden only while this island is mounted with a logo of its own
 * (html[data-mu-replaced~="logo"]). The company logo of the CRM and its documents are not touched.
 */
import type { Branding } from '../api/types'
import { onMounted, onBeforeUnmount } from 'vue'

defineProps<{ branding: Branding }>()

// Migrate the familiar legacy notice visually without changing third-party links or the native template.
// Safe mode / a failed shell restores the original mark. No arbitrary sibling is hidden.
const legacy: HTMLElement[] = []
onMounted(() => {
  for (const element of document.querySelectorAll<HTMLElement>('nav.app-fixed-navbar .company-logo > span')) {
    if (/^(коммерческая тайна|trade secret|geschäftsgeheimnis)$/iu.test(element.textContent.trim())) {
      element.setAttribute('data-mu-legacy-notice', '')
      legacy.push(element)
    }
  }
})
onBeforeUnmount(() => { for (const element of legacy) element.removeAttribute('data-mu-legacy-notice') })
</script>

<template>
  <span class="mu-brand">
    <img v-if="branding.logoUrl !== null" class="mu-brand__logo" :src="branding.logoUrl" :alt="branding.title ?? ''" />
    <span v-if="branding.title !== null" class="mu-brand__title" :title="branding.title">{{ branding.title }}</span>
    <span v-if="branding.notice" class="mu-brand__notice" :title="branding.notice">{{ branding.notice }}</span>
  </span>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

html[data-mu-replaced~='logo'] nav.app-fixed-navbar .company-logo > img {
  display: none !important;
}

html.mu-shell-ready nav.app-fixed-navbar .company-logo {
  position: relative;

  > [data-mu-legacy-notice] { display: none !important; }
}

.mu-root .mu-brand__notice {
  position: absolute;
  right: 0;
  bottom: -3px;
  left: 0;
  color: #e53935;
  font: 600 9px/1.1 Arial, sans-serif;
  text-align: center;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mu-root.mu-brand-root {
  display: inline-flex;
  align-items: center;
  height: 100%;
  vertical-align: middle;
}

.mu-root .mu-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
}

nav.app-fixed-navbar .company-logo .mu-root .mu-brand__logo {
  display: block;
  width: auto;
  max-width: 160px;
  height: auto;
  max-height: 32px;
}

.mu-root .mu-brand__title {
  overflow: hidden;
  color: tok(text-heading);
  font-size: calc(15px * #{tok(font-scale)});
  font-weight: 600;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
