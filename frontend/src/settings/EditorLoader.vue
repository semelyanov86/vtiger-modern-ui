<script setup lang="ts">
/**
 * Loads the data of the editor (action=Data) and shows the editor, or the reason it could not be loaded with a retry;
 * the server part of the page below keeps working either way.
 */
import { onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Bootstrap } from '../api/types'
import { ApiError } from '../api/guards'
import { loadEditor } from './api'
import type { EditorData } from './types'
import SettingsEditor from './SettingsEditor.vue'

defineProps<{ bootstrap: Bootstrap | null }>()

const { t } = useI18n()
const data = shallowRef<EditorData | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)

async function load(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    data.value = await loadEditor()
  } catch (failure) {
    error.value = t('editor.loadFailed', { reason: t(`errors.${failure instanceof ApiError ? failure.code : 'MU_UNKNOWN'}`) })
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <SettingsEditor v-if="data !== null" :initial="data" :bootstrap="bootstrap" />
  <div v-else class="mu-editor mu-editor--loading" role="status" aria-live="polite">
    <p v-if="error === null" class="mu-help">{{ t('editor.loading') }}</p>
    <template v-else>
      <p class="mu-field__error" data-mu-error="load">{{ error }}</p>
      <button type="button" class="mu-btn" :disabled="busy" @click="load">{{ t('editor.retry') }}</button>
    </template>
  </div>
</template>
