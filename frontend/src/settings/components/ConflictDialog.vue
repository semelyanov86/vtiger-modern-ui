<script setup lang="ts">
/**
 * The settings were saved by someone else since this draft was opened (docs/settings.md §8, §14): show who and when,
 * what they changed and what this draft changes. The work is not lost: the changes of the draft can be carried over to
 * the current version (then reviewed and saved), or the current values loaded (the draft is dropped), or overwritten.
 */
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { ConflictInfo } from '../dialogs'

defineProps<{ conflict: ConflictInfo }>()
const emit = defineEmits<{ rebase: []; load: []; overwrite: []; close: [] }>()
const { t } = useI18n()
</script>

<template>
  <DialogRoot :open="true" @update:open="(open: boolean) => { if (!open) emit('close') }">
    <DialogPortal to="#mu-overlay-root">
      <DialogOverlay class="mu-dialog-overlay" />
      <DialogContent class="mu-dialog mu-dialog--wide" data-mu-dialog="conflict">
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
        <p class="mu-help">{{ t('editor.conflict.rebaseHelp') }}</p>
        <div class="mu-dialog__actions">
          <button type="button" class="mu-btn mu-btn--danger-text" data-mu-action="conflict-overwrite" @click="emit('overwrite')">{{ t('editor.conflict.overwrite') }}</button>
          <span class="mu-dialog__spacer"></span>
          <button type="button" class="mu-btn" data-mu-action="conflict-load" @click="emit('load')">{{ t('editor.conflict.load') }}</button>
          <button type="button" class="mu-btn mu-btn--primary" data-mu-action="conflict-rebase" @click="emit('rebase')">{{ t('editor.conflict.rebase') }}</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
