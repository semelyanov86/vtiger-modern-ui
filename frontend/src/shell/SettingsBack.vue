<script setup lang="ts">
/**
 * "← Back to CRM" of the settings header (V09, docs/design.md §13.11): the settings of the cloud are a space of their own
 * whose header leads back to the working CRM. The link goes to the last page of the CRM opened in this tab, else to the
 * home page (adapters/v7/settings.ts). An ordinary link: new tab, history and the keyboard work as everywhere.
 */
import { useI18n } from 'vue-i18n'
import { ArrowLeft } from '@lucide/vue'

defineProps<{ href: string }>()

const { t } = useI18n()
</script>

<template>
  <a class="mu-settings-back" :href="href" :title="t('settings.backHint')" data-mu-item="settings-back">
    <ArrowLeft :size="25" :stroke-width="1.5" aria-hidden="true" class="mu-settings-back__icon" />
    <span class="mu-settings-back__text">{{ t('settings.back') }}</span>
  </a>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

// Cloud (layout v8, measured 2026-11-08): Poppins 20 px, weight 500 (drawn with the regular face), #0070d2, an arrow of
// 25 px and 8 px between the arrow and the text; the link starts 28 px from the left edge of the row.
.mu-root.mu-settings-back-root {
  font-family: #{$font-cloud};
}

.mu-settings-back {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  height: 36px;
  border-radius: tok(radius-sm);
  color: tok(settings-link);
  font-family: #{$font-cloud};
  font-size: fs(20);
  font-weight: 500;
  line-height: 22px;
  text-decoration: none;
  white-space: nowrap;

  &:hover,
  &:focus {
    color: tok(settings-link);
    text-decoration: none;
  }

  &:hover .mu-settings-back__text {
    text-decoration: underline;
  }

  &:focus-visible {
    @include focus-ring;

    outline: none;
  }
}

.mu-settings-back__icon {
  flex: none;
}

.mu-settings-back__text {
  overflow: hidden;
  padding: 2px 0 0 8px;
  text-overflow: ellipsis;
}

// Phones: the row also holds the logo and the toggles of v7.
@media (max-width: 767px) {
  .mu-settings-back {
    font-size: fs(16);
  }
}
</style>
