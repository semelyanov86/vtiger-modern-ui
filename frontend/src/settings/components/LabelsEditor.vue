<script setup lang="ts">
/**
 * Custom label of a menu group or item in Russian, English, German and for any other language (docs/I18N.md: the map
 * of translations is kept as it is in the settings and in the JSON file). Plain text, 1–60 characters.
 */
import { useI18n } from 'vue-i18n'
import { cleanLabel, compactLabels, LABEL_LOCALES, LABEL_MAX, type LabelLocale, type Labels } from '../../menu/labels'

const props = defineProps<{ id: string; modelValue: Labels | null; required?: boolean; placeholder?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: Labels | null] }>()

const { t } = useI18n()

function value(locale: LabelLocale): string {
  return props.modelValue?.[locale] ?? ''
}

function error(locale: LabelLocale): string | null {
  const text = value(locale)
  return text !== '' && cleanLabel(text) === null ? t('editor.labels.invalid', { max: LABEL_MAX }) : null
}

function update(locale: LabelLocale, text: string): void {
  const next: Labels = { ...(props.modelValue ?? {}) }
  if (text === '') {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete next[locale]
  } else {
    next[locale] = text
  }
  emit('update:modelValue', compactLabels(next))
}
</script>

<template>
  <fieldset class="mu-labels">
    <legend class="mu-field__label">{{ t('editor.labels.title') }}</legend>
    <p class="mu-help">{{ required ? t('editor.labels.helpRequired') : t('editor.labels.help') }}</p>
    <div v-for="code in LABEL_LOCALES" :key="code" class="mu-labels__row">
      <label :for="`${id}-${code}`">{{ t(`editor.labels.locale.${code === '*' ? 'any' : code}`) }}</label>
      <input :id="`${id}-${code}`" class="mu-input" type="text" :value="value(code)" :maxlength="LABEL_MAX + 20" :placeholder="placeholder ?? ''" :aria-invalid="error(code) !== null" :data-mu-label="code" @input="update(code, ($event.target as HTMLInputElement).value)" />
      <p v-if="error(code) !== null" class="mu-field__error" role="alert">{{ error(code) }}</p>
    </div>
  </fieldset>
</template>
