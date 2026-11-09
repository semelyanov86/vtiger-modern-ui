<script setup lang="ts">
/**
 * The confirmation of confirm.ts as the cloud draws it (V07 discard confirmation: 500 px, radius 12, the confirming
 * action last, primary or destructive).
 */
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { confirmRequest } from '../confirm'
</script>

<template>
  <DialogRoot v-if="confirmRequest !== null" :open="true" @update:open="(open: boolean) => { if (!open) confirmRequest?.resolve(false) }">
    <DialogPortal to="#mu-overlay-root">
      <DialogOverlay class="mu-dialog-overlay" />
      <DialogContent class="mu-dialog mu-dialog--confirm" data-mu-dialog="confirm">
        <DialogTitle class="mu-dialog__title">{{ confirmRequest.title }}</DialogTitle>
        <DialogDescription class="mu-dialog__text">{{ confirmRequest.text }}</DialogDescription>
        <div class="mu-dialog__actions">
          <button type="button" class="mu-btn" data-mu-action="confirm-cancel" @click="confirmRequest.resolve(false)">{{ confirmRequest.cancel }}</button>
          <button type="button" class="mu-btn" :class="confirmRequest.danger ? 'mu-btn--danger' : 'mu-btn--primary'" data-mu-action="confirm-ok" @click="confirmRequest.resolve(true)">{{ confirmRequest.confirm }}</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
