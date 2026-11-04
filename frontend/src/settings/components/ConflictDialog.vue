<script setup lang="ts">
/**
 * The settings were saved by someone else since this draft was opened (docs/settings.md §8): show who and when, what
 * they changed and what this draft changes; load the current values (the draft is dropped) or overwrite them.
 */
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { ConflictInfo } from '../dialogs'

defineProps<{ conflict: ConflictInfo }>()
const emit = defineEmits<{ load: []; overwrite: []; close: [] }>()
const { t } = useI18n()
</script>

<template>
  <DialogRoot :open="true" @update:open="(open: boolean) => { if (!open) emit('close') }">
    <DialogPortal to="#mu-overlay-root">
      <DialogOverlay class="mu-dialog-overlay" />
      <DialogContent class="mu-dialog" data-mu-dialog="conflict">
        <DialogTitle class="mu-dialog__title">{{ t('editor.conflict.title') }}</DialogTitle>
        <DialogDescription class="mu-dialog__text">
          {{ conflict.updatedBy !== null && conflict.updatedAt !== null
            ? t('editor.conflict.by', { user: conflict.updatedBy, time: conflict.updatedAt })
            : t('editor.conflict.unknown') }}
        </DialogDescription>
        <div class="mu-dialog__columns">
          <section>
            <h4>{{ t('editor.conflict.theirs') }}</h4>
            <ul v-if="conflict.theirs.length > 0"><li v-for="name in conflict.theirs" :key="name">{{ name }}</li></ul>
            <p v-else class="mu-help">{{ t('editor.conflict.nothing') }}</p>
          </section>
          <section>
            <h4>{{ t('editor.conflict.mine') }}</h4>
            <ul v-if="conflict.mine.length > 0"><li v-for="name in conflict.mine" :key="name">{{ name }}</li></ul>
            <p v-else class="mu-help">{{ t('editor.conflict.nothing') }}</p>
          </section>
        </div>
        <div class="mu-dialog__actions">
          <button type="button" class="mu-btn" data-mu-action="conflict-close" @click="emit('close')">{{ t('editor.conflict.keep') }}</button>
          <button type="button" class="mu-btn" data-mu-action="conflict-load" @click="emit('load')">{{ t('editor.conflict.load') }}</button>
          <button type="button" class="mu-btn mu-btn--danger" data-mu-action="conflict-overwrite" @click="emit('overwrite')">{{ t('editor.conflict.overwrite') }}</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
