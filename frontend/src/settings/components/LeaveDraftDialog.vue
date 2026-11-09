<script setup lang="ts">
/**
 * Another scope is chosen while the draft of the current one is not saved (docs/settings.md §14): save it and switch,
 * switch without it, or stay. Nothing is dropped silently.
 */
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

defineProps<{ from: string; to: string; changes: number; busy: boolean }>()
const emit = defineEmits<{ save: []; discard: []; stay: [] }>()
const { t } = useI18n()
</script>

<template>
  <DialogRoot :open="true" @update:open="(open: boolean) => { if (!open) emit('stay') }">
    <DialogPortal to="#mu-overlay-root">
      <DialogOverlay class="mu-dialog-overlay" />
      <DialogContent class="mu-dialog mu-dialog--confirm" data-mu-dialog="leave-draft">
        <DialogTitle class="mu-dialog__title">{{ t('editor.leave.title') }}</DialogTitle>
        <DialogDescription class="mu-dialog__text">{{ t('editor.leave.text', { from, to }) }} {{ t('editor.leave.changes', changes) }}</DialogDescription>
        <div class="mu-dialog__actions">
          <button type="button" class="mu-btn" :disabled="busy" data-mu-action="leave-stay" @click="emit('stay')">{{ t('editor.leave.stay') }}</button>
          <button type="button" class="mu-btn" :disabled="busy" data-mu-action="leave-discard" @click="emit('discard')">{{ t('editor.leave.discard') }}</button>
          <button type="button" class="mu-btn mu-btn--primary" :disabled="busy" data-mu-action="leave-save" @click="emit('save')">{{ t('editor.leave.save') }}</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
