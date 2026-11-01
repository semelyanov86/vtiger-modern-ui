<script lang="ts">
import type { Bootstrap, ErrorCode } from '../api/types'

export type DiagnosticsResult = { ok: true; data: Bootstrap } | { ok: false; code: ErrorCode }
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, CircleAlert, RefreshCw } from '@lucide/vue'

const props = defineProps<{
  initial: DiagnosticsResult
  pageBuild: string
  check: () => Promise<DiagnosticsResult>
}>()

const { t } = useI18n()
const result = ref<DiagnosticsResult>(props.initial)
const busy = ref(false)

const mismatch = computed(() => result.value.ok && props.pageBuild !== '' && result.value.data.build !== props.pageBuild)

async function recheck(): Promise<void> {
  busy.value = true
  try {
    result.value = await props.check()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mu-diagnostics" role="status" aria-live="polite">
    <template v-if="result.ok">
      <p class="mu-diagnostics__line mu-diagnostics__line--ok">
        <CircleCheck :size="16" aria-hidden="true" />
        <span>{{ t('diagnostics.ok') }} {{ t('diagnostics.build', { build: result.data.build }) }}</span>
      </p>
      <p v-if="mismatch" class="mu-diagnostics__line mu-diagnostics__line--warn">
        <CircleAlert :size="16" aria-hidden="true" />
        <span>{{ t('diagnostics.buildMismatch', { page: pageBuild, server: result.data.build }) }}</span>
      </p>
      <p class="mu-diagnostics__line">
        {{ t('diagnostics.language', { language: t(`languages.${result.data.locale.effective}`), source: t(`diagnostics.source.${result.data.locale.source}`) }) }}
      </p>
      <p class="mu-diagnostics__line">
        {{ result.data.theme.active ? t('diagnostics.themeActive') : t('diagnostics.themeInactive') }}
        {{ t('diagnostics.systemItems', result.data.menu.system.length) }}
      </p>
    </template>
    <p v-else class="mu-diagnostics__line mu-diagnostics__line--warn">
      <CircleAlert :size="16" aria-hidden="true" />
      <span>{{ t('diagnostics.failed', { reason: t(`errors.${result.code}`) }) }}</span>
    </p>
    <button type="button" class="mu-button" :disabled="busy" @click="recheck">
      <RefreshCw :size="14" aria-hidden="true" />
      <span>{{ busy ? t('diagnostics.checking') : t('diagnostics.recheck') }}</span>
    </button>
  </div>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

.mu-root .mu-diagnostics {
  max-width: 760px;
  padding: 12px 16px;
  border: 1px solid tok(divider);
  border-radius: 6px;
  background: tok(surface);
}

.mu-root .mu-diagnostics__line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;

  &--ok {
    color: tok(success);
  }

  &--warn {
    color: tok(danger);
  }
}

.mu-root .mu-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: tok(button-height);
  padding: 0 12px;
  border: 1px solid tok(border-input);
  border-radius: 4px;
  background: tok(surface);
  color: tok(text);
  cursor: pointer;

  &:hover {
    background: tok(surface-subtle);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px tok(focus-ring);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}
</style>
