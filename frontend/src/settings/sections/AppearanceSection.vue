<script setup lang="ts">
/**
 * Appearance (docs/settings.md §4, docs/design.md §3): accent, background and panels in the safe light range, density,
 * text size, font, default language of the theme; for the common settings also the logo and the title of the new
 * interface (by default the branding of the CRM). Changes preview on this page at once (SettingsEditor applies the
 * tokens), nothing is published before "Save".
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload } from '@lucide/vue'
import type { Bootstrap } from '../../api/types'
import { ApiError } from '../../api/guards'
import { THEME_LOCALES } from '../../i18n/locale'
import { isLabels, type Labels } from '../../menu/labels'
import { uploadLogo } from '../api'
import type { Editor } from '../state'
import type { Problem } from '../types'
import ColorField from '../components/ColorField.vue'
import LabelsEditor from '../components/LabelsEditor.vue'
import ScopedField from '../components/ScopedField.vue'

const props = defineProps<{ editor: Editor; problems: readonly Problem[]; bootstrap: Bootstrap | null }>()

const { t } = useI18n()
const DENSITIES = ['compact', 'standard', 'comfortable'] as const
const SCALES = [90, 100, 110, 125] as const
const FONTS = ['inter', 'system'] as const

const isGlobal = computed(() => !props.editor.isRole.value)
const asString = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
const asNumber = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : fallback)

// ---- Logo ----
const logo = computed(() => asString(props.editor.effective('branding.logo'), 'company'))
const wantCustomLogo = ref(logo.value !== 'company')
const logoBusy = ref(false)
const logoError = ref<string | null>(null)
const logoUrl = computed(() => (logo.value === 'company' ? null : `public.php?type=logo&key=${logo.value}`))

function chooseCompanyLogo(): void {
  wantCustomLogo.value = false
  props.editor.set('branding.logo', 'company')
}

async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file === undefined) {
    return
  }
  logoError.value = null
  if (file.size > 524288) {
    logoError.value = t('errors.MU_LOGO_TOO_LARGE')
    input.value = ''
    return
  }
  logoBusy.value = true
  try {
    const stored = await uploadLogo(file)
    props.editor.set('branding.logo', stored.file)
  } catch (error) {
    logoError.value = t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`)
  } finally {
    logoBusy.value = false
    input.value = ''
  }
}

// ---- Title ----
const title = computed<Labels | null>(() => {
  const value = props.editor.effective('branding.title')
  return isLabels(value) ? value : null
})
const wantCustomTitle = ref(title.value !== null)

function chooseCompanyTitle(): void {
  wantCustomTitle.value = false
  props.editor.set('branding.title', 'company')
}

function setTitle(labels: Labels | null): void {
  props.editor.set('branding.title', labels ?? 'company')
}

const sample = computed(() => props.editor.data.value.branding.companyName)
</script>

<template>
  <div class="mu-section" data-mu-section="appearance">
    <p class="mu-help">{{ isGlobal ? t('editor.appearance.intro') : t('editor.appearance.introRole') }}</p>

    <div class="mu-grid">
      <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="appearance.primaryColor" :problems="problems" :legend="t('fields.appearance_primaryColor')">
        <ColorField id="mu-primary" :label="t('fields.appearance_primaryColor')" :model-value="asString(value, '#3978fe')" :max-luminance="0.9" :show-contrast="true" :disabled="disabled" @update:model-value="update" />
      </ScopedField>
      <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="appearance.background" :problems="problems" :legend="t('fields.appearance_background')">
        <ColorField id="mu-background" :label="t('fields.appearance_background')" :model-value="asString(value, '#eff0f2')" :min-luminance="0.85" :disabled="disabled" @update:model-value="update" />
      </ScopedField>
      <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="appearance.surface" :problems="problems" :legend="t('fields.appearance_surface')">
        <ColorField id="mu-surface" :label="t('fields.appearance_surface')" :model-value="asString(value, '#ffffff')" :min-luminance="0.92" :disabled="disabled" @update:model-value="update" />
      </ScopedField>
    </div>

    <div class="mu-grid">
      <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="appearance.density" :problems="problems" :legend="t('fields.appearance_density')">
        <fieldset class="mu-choice" :disabled="disabled">
          <legend class="mu-field__label">{{ t('fields.appearance_density') }}</legend>
          <label v-for="density in DENSITIES" :key="density" class="mu-check">
            <input type="radio" name="mu-density" :value="density" :checked="value === density" :data-mu-density="density" @change="update(density)" />
            <span>{{ t(`editor.appearance.density.${density}`) }}</span>
          </label>
        </fieldset>
      </ScopedField>
      <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="appearance.fontScale" :problems="problems" :legend="t('fields.appearance_fontScale')">
        <fieldset class="mu-choice" :disabled="disabled">
          <legend class="mu-field__label">{{ t('fields.appearance_fontScale') }}</legend>
          <label v-for="scale in SCALES" :key="scale" class="mu-check">
            <input type="radio" name="mu-font-scale" :value="scale" :checked="asNumber(value, 100) === scale" :data-mu-font-scale="scale" @change="update(scale)" />
            <span>{{ scale }} %</span>
          </label>
        </fieldset>
      </ScopedField>
      <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="appearance.font" :problems="problems" :legend="t('fields.appearance_font')">
        <fieldset class="mu-choice" :disabled="disabled">
          <legend class="mu-field__label">{{ t('fields.appearance_font') }}</legend>
          <label v-for="font in FONTS" :key="font" class="mu-check">
            <input type="radio" name="mu-font" :value="font" :checked="value === font" @change="update(font)" />
            <span>{{ t(`editor.appearance.font.${font}`) }}</span>
          </label>
        </fieldset>
      </ScopedField>
      <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="locale.default" :problems="problems" :legend="t('fields.locale_default')">
        <div class="mu-field">
          <label class="mu-field__label" for="mu-locale-default">{{ t('fields.locale_default') }}</label>
          <select id="mu-locale-default" class="mu-select" :value="asString(value, 'auto')" :disabled="disabled" @change="update(($event.target as HTMLSelectElement).value)">
            <option value="auto">{{ t('editor.language.auto') }}</option>
            <option v-for="code in THEME_LOCALES" :key="code" :value="code">{{ t(`languages.${code}`) }}</option>
          </select>
          <p class="mu-help">{{ t('editor.appearance.localeHelp') }}</p>
        </div>
      </ScopedField>
    </div>

    <template v-if="isGlobal">
      <h3 class="mu-section__heading">{{ t('editor.appearance.branding') }}</h3>
      <div class="mu-grid">
        <fieldset class="mu-choice" data-mu-key="branding.logo">
          <legend class="mu-field__label">{{ t('fields.branding_logo') }}</legend>
          <label class="mu-check">
            <input type="radio" name="mu-logo" :checked="!wantCustomLogo" data-mu-logo="company" @change="chooseCompanyLogo" />
            <span>{{ t('editor.appearance.logoCompany') }}</span>
          </label>
          <label class="mu-check">
            <input type="radio" name="mu-logo" :checked="wantCustomLogo" data-mu-logo="custom" @change="wantCustomLogo = true" />
            <span>{{ t('editor.appearance.logoCustom') }}</span>
          </label>
          <div v-if="wantCustomLogo" class="mu-logo">
            <img v-if="logoUrl !== null" class="mu-logo__preview" :src="logoUrl" :alt="t('editor.appearance.logoPreview')" />
            <label class="mu-btn mu-file">
              <Upload :size="14" aria-hidden="true" />
              <span>{{ logoBusy ? t('editor.appearance.logoUploading') : t('editor.appearance.logoUpload') }}</span>
              <input type="file" accept="image/png,image/jpeg,image/gif" :disabled="logoBusy" data-mu-field="logo-file" @change="upload" />
            </label>
            <p class="mu-help">{{ t('editor.appearance.logoHelp') }}</p>
            <p v-if="logoError !== null" class="mu-field__error" role="alert" data-mu-error="logo">{{ logoError }}</p>
          </div>
        </fieldset>
        <fieldset class="mu-choice" data-mu-key="branding.title">
          <legend class="mu-field__label">{{ t('fields.branding_title') }}</legend>
          <label class="mu-check">
            <input type="radio" name="mu-title" :checked="!wantCustomTitle" @change="chooseCompanyTitle" />
            <span>{{ t('editor.appearance.titleCompany', { name: sample === '' ? '—' : sample }) }}</span>
          </label>
          <label class="mu-check">
            <input type="radio" name="mu-title" :checked="wantCustomTitle" data-mu-title="custom" @change="wantCustomTitle = true" />
            <span>{{ t('editor.appearance.titleCustom') }}</span>
          </label>
          <LabelsEditor v-if="wantCustomTitle" id="mu-title" :model-value="title" :required="true" @update:model-value="setTitle" />
        </fieldset>
      </div>
    </template>

    <h3 class="mu-section__heading">{{ t('editor.appearance.preview') }}</h3>
    <div class="mu-preview" data-mu-preview="appearance">
      <div class="mu-preview__bar">
        <button type="button" class="mu-btn mu-btn--primary" tabindex="-1">{{ t('editor.appearance.sampleSave') }}</button>
        <button type="button" class="mu-btn" tabindex="-1">{{ t('editor.appearance.sampleCancel') }}</button>
        <input class="mu-input" type="text" :value="t('editor.appearance.sampleInput')" tabindex="-1" readonly :aria-label="t('editor.appearance.sampleInput')" />
      </div>
      <table class="mu-preview__table">
        <thead><tr><th>{{ t('editor.appearance.sampleName') }}</th><th>{{ t('editor.appearance.sampleCity') }}</th></tr></thead>
        <tbody>
          <tr><td>Größenänderungsübersicht GmbH</td><td>Düsseldorf</td></tr>
          <tr><td>ООО «Съешь же ещё этих мягких французских булок»</td><td>Москва</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
