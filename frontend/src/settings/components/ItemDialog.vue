<script setup lang="ts">
/**
 * Editing a group, a module item or a route of the menu: labels in RU/EN/DE and for other languages, an icon of the
 * set; a route names a module, a view and optionally a filter of the CRM — never a URL.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { NAME } from '../../menu/config'
import type { ItemDialogValue } from '../dialogs'
import { cleanLabel, LABEL_LOCALES } from '../../menu/labels'
import type { CatalogModule } from '../types'
import IconPicker from './IconPicker.vue'
import LabelsEditor from './LabelsEditor.vue'

const props = defineProps<{ value: ItemDialogValue; title: string; modules: readonly CatalogModule[] }>()
const emit = defineEmits<{ save: [value: ItemDialogValue]; close: [] }>()

const { t } = useI18n()
const draft = ref<ItemDialogValue>(JSON.parse(JSON.stringify(props.value)) as ItemDialogValue)

const labelsValid = computed(() => LABEL_LOCALES.every((code) => {
  const text = draft.value.label?.[code]
  return text === undefined || cleanLabel(text) !== null
}))
const routeValid = computed(() => draft.value.kind !== 'route' || (NAME.test(draft.value.module) && NAME.test(draft.value.view)
  && (draft.value.viewname === '' || /^[0-9]{1,10}$/.test(draft.value.viewname)) && draft.value.label !== null))
const valid = computed(() => labelsValid.value && routeValid.value)

function submit(): void {
  if (valid.value) {
    emit('save', draft.value)
  }
}
</script>

<template>
  <DialogRoot :open="true" @update:open="(open: boolean) => { if (!open) emit('close') }">
    <DialogPortal to="#mu-overlay-root">
      <DialogOverlay class="mu-dialog-overlay" />
      <DialogContent class="mu-dialog mu-dialog--wide" data-mu-dialog="item">
        <form @submit.prevent="submit">
          <DialogTitle class="mu-dialog__title">{{ title }}</DialogTitle>
          <template v-if="draft.kind === 'route'">
            <div class="mu-field">
              <label class="mu-field__label" for="mu-route-module">{{ t('editor.menu.route.module') }}</label>
              <select id="mu-route-module" v-model="draft.module" class="mu-select" data-mu-field="route-module">
                <option v-for="module in modules" :key="module.module" :value="module.module">{{ module.label }} ({{ module.module }})</option>
              </select>
            </div>
            <div class="mu-field">
              <label class="mu-field__label" for="mu-route-view">{{ t('editor.menu.route.view') }}</label>
              <input id="mu-route-view" v-model.trim="draft.view" class="mu-input" type="text" maxlength="50" :aria-invalid="!NAME.test(draft.view)" data-mu-field="route-view" />
              <p class="mu-help">{{ t('editor.menu.route.viewHelp') }}</p>
            </div>
            <div class="mu-field">
              <label class="mu-field__label" for="mu-route-filter">{{ t('editor.menu.route.filter') }}</label>
              <input id="mu-route-filter" v-model.trim="draft.viewname" class="mu-input" type="text" inputmode="numeric" maxlength="10" data-mu-field="route-filter" />
              <p class="mu-help">{{ t('editor.menu.route.filterHelp') }}</p>
            </div>
          </template>
          <LabelsEditor id="mu-item-labels" v-model="draft.label" :required="draft.kind === 'route'" :placeholder="draft.kind === 'route' ? null : draft.placeholder" />
          <p v-if="draft.kind === 'route' && draft.label === null" class="mu-field__error" role="alert">{{ t('editor.labels.needOne') }}</p>
          <IconPicker id="mu-item-icon" v-model="draft.icon" />
          <div class="mu-dialog__actions">
            <DialogClose as-child>
              <button type="button" class="mu-btn">{{ t('editor.dialog.cancel') }}</button>
            </DialogClose>
            <button type="submit" class="mu-btn mu-btn--primary" :disabled="!valid" data-mu-action="dialog-save">{{ t('editor.dialog.apply') }}</button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
