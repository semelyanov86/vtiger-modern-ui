<script setup lang="ts">
/**
 * One setting as a row of a card (docs/design.md §13.12, the field row of the cloud form V07: the label on the left,
 * the control on the right). Under the control a line says where the value comes from: in a role profile "inherited
 * from the common settings: …" or "own value of the role" with the way back; in the common settings "changed, the
 * default is …" with the way back. The control stays usable in both cases: changing an inherited value in a role
 * profile makes it the role's own. Errors of the last save whose path is inside the key are shown under the field.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCcw } from '@lucide/vue'
import type { Editor } from '../state'
import { same } from '../state'
import type { Problem } from '../types'
import { describeValue, pathLabel } from '../fields'

const props = defineProps<{
  editor: Editor
  field: string
  problems: readonly Problem[]
  label: string
  /** id of the control, for the <label> (otherwise the label names the group, labelId in the slot). */
  labelFor?: string
  help?: string
  /** Wide controls (tables): the label above the control. */
  stacked?: boolean
}>()

const { t } = useI18n()
const id = useId()
const labelId = `${id}-label`
const state = computed(() => props.editor.keyState(props.field))
const errors = computed(() => props.problems.filter((problem) => problem.key === props.field))
const describe = (value: unknown): string => describeValue(t, props.field, value)
const changedFromDefault = computed(() => state.value === 'set' && !same(props.editor.get(props.field), props.editor.defaultValue(props.field)))

function update(value: unknown): void {
  props.editor.set(props.field, value)
}

function back(): void {
  props.editor.set(props.field, undefined)
}
</script>

<template>
  <div class="mu-row" :class="{ 'mu-row--stacked': stacked, 'mu-row--own': state === 'own' }" :data-mu-key="field" :data-mu-state="state">
    <div class="mu-row__label">
      <label v-if="labelFor !== undefined" :id="labelId" :for="labelFor">{{ label }}</label>
      <span v-else :id="labelId">{{ label }}</span>
    </div>
    <div class="mu-row__control">
      <slot :value="editor.effective(field)" :update="update" :label-id="labelId" />
      <p v-if="help !== undefined" class="mu-help">{{ help }}</p>
      <p v-if="state === 'inherited'" class="mu-row__origin" data-mu-origin="inherited">
        {{ t('editor.origin.inherited', { value: describe(editor.inherited(field)) }) }}
      </p>
      <p v-else-if="state === 'own'" class="mu-row__origin" data-mu-origin="own">
        <span class="mu-badge mu-badge--info">{{ t('editor.origin.own') }}</span>
        <button type="button" class="mu-link-btn" :data-mu-own="field" @click="back">
          <RotateCcw :size="13" aria-hidden="true" />{{ t('editor.origin.useCommon', { value: describe(editor.inherited(field)) }) }}
        </button>
      </p>
      <p v-else-if="changedFromDefault" class="mu-row__origin" data-mu-origin="set">
        {{ t('editor.origin.changed') }}
        <button type="button" class="mu-link-btn" :data-mu-default="field" @click="back">
          <RotateCcw :size="13" aria-hidden="true" />{{ t('editor.origin.useDefault', { value: describe(editor.defaultValue(field)) }) }}
        </button>
      </p>
      <p v-for="error in errors" :key="error.path" class="mu-field__error" role="alert">
        {{ t(`errors.${error.code}`, { key: pathLabel(t, error.path) }) }} ({{ pathLabel(t, error.path) }})
      </p>
    </div>
  </div>
</template>
