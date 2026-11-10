<script setup lang="ts">
/**
 * Appearance (docs/settings.md §4, docs/design.md §13.12): accent, background and panels in the safe light range,
 * density, text size, font, default language of the theme; for the common settings also the logo and the title of the
 * new interface (by default the branding of the CRM). Every change previews on this page at once (the editor applies
 * the tokens to the page) and in the small sample next to the fields, which stays in view while the form scrolls;
 * nothing is published before "Save".
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Search, Upload } from '@lucide/vue'
import type { Bootstrap } from '../../api/types'
import { ApiError } from '../../api/guards'
import { isThemeLocale, THEME_LOCALES } from '../../i18n/locale'
import { isLabels, resolveLabel, type Labels } from '../../menu/labels'
import { uploadLogo } from '../api'
import type { Editor } from '../state'
import type { Problem } from '../types'
import ColorField from '../components/ColorField.vue'
import LabelsEditor from '../components/LabelsEditor.vue'
import ScopedField from '../components/ScopedField.vue'

const props = defineProps<{ editor: Editor; problems: readonly Problem[]; bootstrap: Bootstrap | null }>()

const { t, locale } = useI18n()
const DENSITIES = ['compact', 'standard', 'comfortable'] as const
const SCALES = [90, 100, 110, 125] as const
const FONTS = ['cloud', 'inter', 'system'] as const

const isGlobal = computed(() => !props.editor.isRole.value)
const asString = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
const asNumber = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : fallback)

// ---- Logo ----
const logo = computed(() => asString(props.editor.effective('branding.logo'), 'company'))
const wantCustomLogo = ref(logo.value !== 'company')
const logoBusy = ref(false)
const logoError = ref<string | null>(null)
const logoUrl = computed(() => (logo.value === 'company' ? null : `public.php?type=logo&key=${logo.value}`))
const companyLogo = computed(() => props.editor.data.value.branding.logoUrl)

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
const previewTitle = computed(() => (title.value !== null ? resolveLabel(title.value, isThemeLocale(locale.value) ? locale.value : 'en-US', null) : null))
const previewLogo = computed(() => logoUrl.value ?? companyLogo.value)
</script>

<template>
  <div class="mu-section mu-section--aside" data-mu-section="appearance">
    <div class="mu-section__main">
      <section class="mu-card">
        <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.appearance.colorsTitle') }}</h3></header>
        <div class="mu-card__body mu-card__body--rows">
          <ScopedField v-slot="{ value, update, labelId }" :editor="editor" field="appearance.primaryColor" :problems="problems" :label="t('fields.appearance_primaryColor')">
            <ColorField id="mu-primary" :label="t('fields.appearance_primaryColor')" :labelledby="labelId" :model-value="asString(value, '#3978fe')" :max-luminance="0.9" :show-contrast="true" @update:model-value="update" />
          </ScopedField>
          <ScopedField v-slot="{ value, update, labelId }" :editor="editor" field="appearance.background" :problems="problems" :label="t('fields.appearance_background')">
            <ColorField id="mu-background" :label="t('fields.appearance_background')" :labelledby="labelId" :model-value="asString(value, '#eff0f2')" :min-luminance="0.85" @update:model-value="update" />
          </ScopedField>
          <ScopedField v-slot="{ value, update, labelId }" :editor="editor" field="appearance.surface" :problems="problems" :label="t('fields.appearance_surface')">
            <ColorField id="mu-surface" :label="t('fields.appearance_surface')" :labelledby="labelId" :model-value="asString(value, '#ffffff')" :min-luminance="0.92" @update:model-value="update" />
          </ScopedField>
        </div>
      </section>

      <section class="mu-card">
        <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.appearance.textTitle') }}</h3></header>
        <div class="mu-card__body mu-card__body--rows">
          <ScopedField v-slot="{ value, update, labelId }" :editor="editor" field="appearance.density" :problems="problems" :label="t('fields.appearance_density')">
            <div class="mu-segmented" role="radiogroup" :aria-labelledby="labelId">
              <label v-for="density in DENSITIES" :key="density" class="mu-segmented__item">
                <input type="radio" name="mu-density" :value="density" :checked="value === density" :data-mu-density="density" @change="update(density)" />
                <span>{{ t(`editor.appearance.density.${density}`) }}</span>
              </label>
            </div>
          </ScopedField>
          <ScopedField v-slot="{ value, update, labelId }" :editor="editor" field="appearance.fontScale" :problems="problems" :label="t('fields.appearance_fontScale')">
            <div class="mu-segmented" role="radiogroup" :aria-labelledby="labelId">
              <label v-for="scale in SCALES" :key="scale" class="mu-segmented__item">
                <input type="radio" name="mu-font-scale" :value="scale" :checked="asNumber(value, 100) === scale" :data-mu-font-scale="scale" @change="update(scale)" />
                <span>{{ scale }} %</span>
              </label>
            </div>
          </ScopedField>
          <ScopedField v-slot="{ value, update, labelId }" :editor="editor" field="appearance.font" :problems="problems" :label="t('fields.appearance_font')">
            <div class="mu-radios" role="radiogroup" :aria-labelledby="labelId">
              <label v-for="font in FONTS" :key="font" class="mu-check">
                <input type="radio" name="mu-font" :value="font" :checked="value === font" :data-mu-font="font" @change="update(font)" />
                <span>{{ t(`editor.appearance.font.${font}`) }}</span>
              </label>
            </div>
          </ScopedField>
          <ScopedField v-slot="{ value, update }" :editor="editor" field="locale.default" :problems="problems" :label="t('fields.locale_default')" label-for="mu-locale-default" :help="t('editor.appearance.localeHelp')">
            <select id="mu-locale-default" class="mu-select mu-select--field" :value="asString(value, 'auto')" data-mu-field="locale-default" @change="update(($event.target as HTMLSelectElement).value)">
              <option value="auto">{{ t('editor.language.auto') }}</option>
              <option v-for="code in THEME_LOCALES" :key="code" :value="code">{{ t(`languages.${code}`) }}</option>
            </select>
          </ScopedField>
        </div>
      </section>

      <section v-if="isGlobal" class="mu-card">
        <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.appearance.branding') }}</h3></header>
        <div class="mu-card__body mu-card__body--rows">
          <ScopedField v-slot="{ labelId }" :editor="editor" field="branding.logo" :problems="problems" :label="t('fields.branding_logo')">
            <div class="mu-radios" role="radiogroup" :aria-labelledby="labelId">
              <label class="mu-check">
                <input type="radio" name="mu-logo" :checked="!wantCustomLogo" data-mu-logo="company" @change="chooseCompanyLogo" />
                <span>{{ t('editor.appearance.logoCompany') }}</span>
              </label>
              <label class="mu-check">
                <input type="radio" name="mu-logo" :checked="wantCustomLogo" data-mu-logo="custom" @change="wantCustomLogo = true" />
                <span>{{ t('editor.appearance.logoCustom') }}</span>
              </label>
            </div>
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
          </ScopedField>
          <ScopedField v-slot="{ labelId }" :editor="editor" field="branding.title" :problems="problems" :label="t('fields.branding_title')">
            <div class="mu-radios" role="radiogroup" :aria-labelledby="labelId">
              <label class="mu-check">
                <input type="radio" name="mu-title" :checked="!wantCustomTitle" @change="chooseCompanyTitle" />
                <span>{{ t('editor.appearance.titleCompany', { name: sample === '' ? '—' : sample }) }}</span>
              </label>
              <label class="mu-check">
                <input type="radio" name="mu-title" :checked="wantCustomTitle" data-mu-title="custom" @change="wantCustomTitle = true" />
                <span>{{ t('editor.appearance.titleCustom') }}</span>
              </label>
            </div>
            <LabelsEditor v-if="wantCustomTitle" id="mu-title" :model-value="title" :required="true" @update:model-value="setTitle" />
          </ScopedField>
          <ScopedField v-slot="{ value, update, labelId }" :editor="editor" field="branding.noticeEnabled" :problems="problems" :label="t('fields.branding_noticeEnabled')" :help="t('editor.appearance.noticeHelp')">
            <label class="mu-check">
              <input type="checkbox" :checked="value === true" :aria-labelledby="labelId" data-mu-field="notice-enabled" @change="update(($event.target as HTMLInputElement).checked)" />
              <span>{{ t('editor.appearance.noticeShow') }}</span>
            </label>
          </ScopedField>
          <ScopedField v-if="editor.effective('branding.noticeEnabled') === true" v-slot="{ value, update }" :editor="editor" field="branding.notice" :problems="problems" :label="t('fields.branding_notice')">
            <LabelsEditor id="mu-notice" :model-value="isLabels(value) ? value : null" :required="true" @update:model-value="update" />
          </ScopedField>
        </div>
      </section>
    </div>

    <aside class="mu-section__aside" :aria-label="t('editor.appearance.preview')">
      <section class="mu-card mu-preview" data-mu-preview="appearance">
        <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.appearance.preview') }}</h3></header>
        <div class="mu-preview__frame" aria-hidden="true">
          <div class="mu-preview__topbar">
            <span class="mu-preview__menu"></span>
            <img v-if="previewLogo !== null" class="mu-preview__logo" :src="previewLogo" alt="" />
            <span v-if="previewTitle !== null" class="mu-preview__brand">{{ previewTitle }}</span>
            <Search :size="13" class="mu-preview__search" />
          </div>
          <div class="mu-preview__page">
            <div class="mu-preview__tabs"><span class="mu-preview__tab mu-preview__tab--active">{{ t('editor.appearance.sampleTabA') }}</span><span class="mu-preview__tab">{{ t('editor.appearance.sampleTabB') }}</span></div>
            <div class="mu-preview__toolbar">
              <span class="mu-btn mu-btn--primary">{{ t('editor.appearance.sampleSave') }}</span>
              <span class="mu-btn">{{ t('editor.appearance.sampleCancel') }}</span>
            </div>
            <span class="mu-input mu-preview__input">{{ t('editor.appearance.sampleInput') }}</span>
            <div class="mu-preview__table">
              <div class="mu-preview__head"><span>{{ t('editor.appearance.sampleName') }}</span><span>{{ t('editor.appearance.sampleCity') }}</span></div>
              <div class="mu-preview__row mu-preview__row--selected"><span class="mu-preview__check"><Check :size="11" /></span><span>Größenänderung GmbH</span><span>Düsseldorf</span></div>
              <div class="mu-preview__row"><span class="mu-preview__check mu-preview__check--off"></span><span>ООО «Съешь ещё булок»</span><span>Москва</span></div>
            </div>
          </div>
        </div>
        <p class="mu-help mu-preview__note">{{ isGlobal ? t('editor.appearance.intro') : t('editor.appearance.introRole') }}</p>
      </section>
    </aside>
  </div>
</template>
