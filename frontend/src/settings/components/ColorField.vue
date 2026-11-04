<script setup lang="ts">
/**
 * A colour of the theme: native colour picker and #rrggbb text, with the limits of the schema (docs/settings.md §4:
 * the accent must stay distinguishable on white, backgrounds and surfaces light). Only valid values reach the model.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { contrast, luminance } from '../../boot/color'
import { tokensFor } from '../../boot/tokens'

const props = defineProps<{
  id: string
  label: string
  modelValue: string
  minLuminance?: number | undefined
  maxLuminance?: number | undefined
  showContrast?: boolean | undefined
  disabled?: boolean | undefined
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()
const text = ref(props.modelValue)
watch(() => props.modelValue, (value) => {
  text.value = value
})

const error = computed(() => {
  const value = text.value.trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(value)) {
    return t('editor.color.format')
  }
  const lum = luminance(value)
  if (props.maxLuminance !== undefined && lum > props.maxLuminance) {
    return t('editor.color.tooLight')
  }
  if (props.minLuminance !== undefined && lum < props.minLuminance) {
    return t('editor.color.tooDark')
  }
  return null
})

// The same colour of buttons the server computes (ModernUI_Tokens_Model): the measured one for the default accent.
const strong = computed(() => (error.value === null && props.showContrast ? tokensFor({ primaryColor: text.value.toLowerCase() })['primary-strong'] : null))
const ratio = computed(() => (strong.value !== null ? contrast(strong.value, '#ffffff').toFixed(1) : null))

function commit(value: string): void {
  text.value = value
  const normalized = value.trim().toLowerCase()
  if (error.value === null && normalized !== props.modelValue) {
    emit('update:modelValue', normalized)
  }
}
</script>

<template>
  <div class="mu-field mu-color-field">
    <label class="mu-field__label" :for="id">{{ label }}</label>
    <div class="mu-color-field__row">
      <input class="mu-color-field__swatch" type="color" :value="error === null ? text.toLowerCase() : modelValue" :disabled="disabled" :aria-label="t('editor.color.picker', { name: label })" @input="commit(($event.target as HTMLInputElement).value)" />
      <input :id="id" class="mu-input mu-color-field__text" type="text" :value="text" maxlength="7" spellcheck="false" autocomplete="off" :disabled="disabled" :aria-invalid="error !== null" :aria-describedby="`${id}-note`" :data-mu-field="id" @input="commit(($event.target as HTMLInputElement).value)" />
    </div>
    <p v-if="error !== null" :id="`${id}-note`" class="mu-field__error" role="alert">{{ error }}</p>
    <p v-else-if="strong !== null" :id="`${id}-note`" class="mu-help">
      <span class="mu-color-field__sample" :style="{ background: strong }" aria-hidden="true">Aa</span>
      {{ t('editor.color.buttons', { color: strong, ratio: ratio ?? '' }) }}
    </p>
    <p v-else :id="`${id}-note`" class="mu-visually-hidden">{{ label }}</p>
  </div>
</template>
