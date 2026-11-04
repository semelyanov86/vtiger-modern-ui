<script setup lang="ts">
/**
 * A key of the settings in the scope being edited. In a role profile the key is either inherited from the common
 * settings (shown, not editable) or set for the role; in the common settings it is always editable. Errors of the
 * last save whose path is inside the key are shown under the field.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Editor } from '../state'
import { clone } from '../state'
import type { Problem } from '../types'
import { pathLabel } from '../fields'

const props = defineProps<{ editor: Editor; field: string; problems: readonly Problem[]; legend?: string }>()

const { t } = useI18n()
const own = computed(() => !props.editor.isRole.value || props.editor.has(props.field))
const errors = computed(() => props.problems.filter((problem) => problem.key === props.field))

function toggle(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  props.editor.set(props.field, checked ? clone(props.editor.inherited(props.field)) : undefined)
}

function update(value: unknown): void {
  props.editor.set(props.field, value)
}
</script>

<template>
  <div class="mu-scoped" :class="{ 'mu-scoped--inherited': !own }" :data-mu-key="field">
    <label v-if="editor.isRole.value" class="mu-check mu-scoped__toggle">
      <input type="checkbox" :checked="own" :data-mu-own="field" @change="toggle" />
      <span>{{ t('editor.scope.own', { name: legend ?? field }) }}</span>
    </label>
    <slot :value="editor.effective(field)" :disabled="!own" :update="update" />
    <p v-for="error in errors" :key="error.path" class="mu-field__error" role="alert">
      {{ t(`errors.${error.code}`, { key: pathLabel(t, error.path) }) }} ({{ pathLabel(t, error.path) }})
    </p>
  </div>
</template>
