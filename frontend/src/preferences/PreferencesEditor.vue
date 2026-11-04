<script setup lang="ts">
/**
 * Personal preferences of the new interface (docs/settings.md §4, docs/I18N.md): language of the theme ("As in the
 * CRM", Русский, English, Deutsch), appearance and menu within what the administrator allows, favorites, the standard
 * view. The language switches the texts at once without losing the other unsaved values; everything is saved together
 * with the revision of the personal settings (a save in another tab in between is a conflict, not an overwrite). The
 * language and formats of the CRM profile are never changed.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2, Undo2 } from '@lucide/vue'
import type { Bootstrap, MenuItem } from '../api/types'
import { ApiError } from '../api/guards'
import { clearPreferences, fetchBootstrap, savePreferences } from '../api/client'
import { applyTokens, clearTokens, tokensFor } from '../boot/tokens'
import { effectiveLocale, THEME_LOCALES } from '../i18n/locale'
import ModuleIcon from '../menu/ModuleIcon.vue'
import ColorField from '../settings/components/ColorField.vue'
import { clone, same } from '../settings/state'

const props = defineProps<{ bootstrap: Bootstrap }>()

const { t, locale } = useI18n()
const data = ref<Bootstrap>(props.bootstrap)
const allowed = computed(() => new Set(data.value.personal.allowed))
const draft = reactive<Record<string, unknown>>(clone({ ...data.value.personal.values }))
const base = ref<Record<string, unknown>>(clone({ ...data.value.personal.values }))
const busy = ref(false)
const message = ref<{ kind: 'success' | 'error'; text: string } | null>(null)
const conflict = ref(false)

const dirty = computed(() => !same(draft, base.value))
// "in" is tracked by the reactive proxy (hasOwnProperty.call() is not): computed values follow added keys.
const has = (key: string): boolean => key in draft
const inherited = (key: string): unknown => data.value.personal.inherited[key]
const effective = (key: string): unknown => (has(key) ? draft[key] : inherited(key))

function set(key: string, value: unknown): void {
  if (value === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete draft[key]
  } else {
    draft[key] = value
  }
}

// ---- Language: switches the texts now, saved with the rest ----
const localeChoice = computed(() => (typeof draft['locale'] === 'string' ? draft['locale'] : 'auto'))
watch(localeChoice, (choice) => {
  locale.value = effectiveLocale(choice === 'auto' ? null : choice, data.value.user.crmLanguage, data.value.locale.default).locale
})

// ---- Live preview of the appearance on this page (the theme draws it only where it is active) ----
const savedTokens = data.value.theme.active ? data.value.appearance.tokens : null
const previewTokens = computed(() => tokensFor({
  primaryColor: allowed.value.has('appearance.primaryColor') ? effective('appearance.primaryColor') : data.value.appearance.primaryColor,
  background: allowed.value.has('appearance.background') ? effective('appearance.background') : data.value.appearance.background,
  surface: allowed.value.has('appearance.surface') ? effective('appearance.surface') : data.value.appearance.surface,
  density: allowed.value.has('appearance.density') ? effective('appearance.density') : data.value.appearance.density,
  fontScale: allowed.value.has('appearance.fontScale') ? effective('appearance.fontScale') : data.value.appearance.fontScale,
  font: data.value.appearance.font,
}))
watch(previewTokens, (tokens) => {
  applyTokens(tokens)
}, { immediate: true })

// ---- Favorites ----
const menuModules = computed(() => {
  const seen = new Map<string, MenuItem>()
  for (const group of data.value.menu.groups) {
    for (const item of group.items) {
      if (item.id.startsWith('m:') && !seen.has(item.module)) {
        seen.set(item.module, item)
      }
    }
  }
  for (const item of data.value.menu.favorites) {
    if (!seen.has(item.module)) {
      seen.set(item.module, item)
    }
  }
  return seen
})
const favorites = computed<string[]>(() => {
  const value = effective('navigation.favorites')
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && menuModules.value.has(entry)) : []
})
const favoriteChoices = computed(() => [...menuModules.value.values()].filter((item) => !favorites.value.includes(item.module)).sort((a, b) => a.label.localeCompare(b.label)))
const newFavorite = ref<string>('')

function setFavorites(list: string[]): void {
  set('navigation.favorites', list)
}

function addFavorite(): void {
  const module = newFavorite.value !== '' ? newFavorite.value : favoriteChoices.value[0]?.module
  if (module !== undefined && favorites.value.length < 30) {
    setFavorites([...favorites.value, module])
    newFavorite.value = ''
  }
}

function moveFavorite(index: number, delta: number): void {
  const list = [...favorites.value]
  const target = index + delta
  const item = list[index]
  if (item === undefined || target < 0 || target >= list.length) {
    return
  }
  list.splice(index, 1)
  list.splice(target, 0, item)
  setFavorites(list)
}

function favoriteKey(event: KeyboardEvent, index: number): void {
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.target === event.currentTarget) {
    event.preventDefault()
    moveFavorite(index, event.key === 'ArrowUp' ? -1 : 1)
  }
}

// ---- Save, cancel, reset ----
function changes(): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base.value), ...Object.keys(draft)])) {
    if (!same(base.value[key], draft[key])) {
      result[key] = has(key) ? draft[key] : null
    }
  }
  return result
}

async function refresh(): Promise<void> {
  data.value = await fetchBootstrap()
  const values = clone({ ...data.value.personal.values })
  for (const key of Object.keys(draft)) {
    set(key, undefined)
  }
  Object.assign(draft, values)
  base.value = clone(values)
}

async function save(): Promise<void> {
  busy.value = true
  message.value = null
  conflict.value = false
  try {
    await savePreferences(changes(), data.value.personal.revision)
    await refresh()
    message.value = { kind: 'success', text: t('prefs.saved') }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'MU_CONFLICT') {
      conflict.value = true
    }
    message.value = { kind: 'error', text: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  for (const key of Object.keys(draft)) {
    set(key, undefined)
  }
  Object.assign(draft, clone(base.value))
  message.value = { kind: 'success', text: t('prefs.cancelled') }
}

async function reloadCurrent(): Promise<void> {
  conflict.value = false
  await refresh()
  message.value = { kind: 'success', text: t('prefs.reloaded') }
}

async function resetAll(): Promise<void> {
  if (!window.confirm(t('prefs.resetConfirm'))) {
    return
  }
  busy.value = true
  try {
    await clearPreferences()
    await refresh()
    message.value = { kind: 'success', text: t('prefs.resetDone') }
  } catch (error) {
    message.value = { kind: 'error', text: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }
  } finally {
    busy.value = false
  }
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (dirty.value) {
    event.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  if (savedTokens !== null) {
    applyTokens(savedTokens)
  } else {
    clearTokens()
  }
})

const canOptOut = computed(() => allowed.value.has('user.standardView') && data.value.theme.mode !== 'off')
const canSelfEnable = computed(() => allowed.value.has('user.selfEnabled') && data.value.theme.mode === 'pilot')
const asString = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
const nothing = computed(() => allowed.value.size === 0)
</script>

<template>
  <div class="mu-editor mu-prefs" data-mu-prefs>
    <h2 class="mu-editor__title">{{ t('prefs.title') }}</h2>
    <p class="mu-help">{{ data.theme.active ? t('prefs.active') : t('prefs.inactive') }}</p>
    <p v-if="nothing" class="mu-help">{{ t('prefs.nothing') }}</p>

    <section v-if="allowed.has('locale')" class="mu-subsection">
      <div class="mu-field">
        <label class="mu-field__label" for="mu-pref-locale">{{ t('prefs.language') }}</label>
        <select id="mu-pref-locale" class="mu-select" :value="localeChoice" data-mu-field="locale" @change="set('locale', ($event.target as HTMLSelectElement).value)">
          <option value="auto">{{ t('editor.language.auto') }}</option>
          <option v-for="code in THEME_LOCALES" :key="code" :value="code">{{ t(`languages.${code}`) }}</option>
        </select>
        <p class="mu-help">{{ t('prefs.languageHelp') }}</p>
      </div>
    </section>

    <section v-if="allowed.has('appearance.density') || allowed.has('appearance.fontScale') || allowed.has('appearance.primaryColor')" class="mu-subsection">
      <h3 class="mu-section__heading">{{ t('editor.tabs.appearance') }}</h3>
      <div class="mu-grid">
        <div v-if="allowed.has('appearance.density')" class="mu-field">
          <label class="mu-field__label" for="mu-pref-density">{{ t('fields.appearance_density') }}</label>
          <select id="mu-pref-density" class="mu-select" :value="asString(draft['appearance.density'], '')" data-mu-field="density" @change="set('appearance.density', ($event.target as HTMLSelectElement).value || undefined)">
            <option value="">{{ t('prefs.asAdmin', { value: t(`editor.appearance.density.${asString(inherited('appearance.density'), 'standard')}`) }) }}</option>
            <option v-for="density in ['compact', 'standard', 'comfortable']" :key="density" :value="density">{{ t(`editor.appearance.density.${density}`) }}</option>
          </select>
        </div>
        <div v-if="allowed.has('appearance.fontScale')" class="mu-field">
          <label class="mu-field__label" for="mu-pref-scale">{{ t('fields.appearance_fontScale') }}</label>
          <select id="mu-pref-scale" class="mu-select" :value="typeof draft['appearance.fontScale'] === 'number' ? String(draft['appearance.fontScale']) : ''" data-mu-field="font-scale" @change="set('appearance.fontScale', ($event.target as HTMLSelectElement).value === '' ? undefined : Number(($event.target as HTMLSelectElement).value))">
            <option value="">{{ t('prefs.asAdmin', { value: `${String(inherited('appearance.fontScale') ?? 100)} %` }) }}</option>
            <option v-for="scale in [90, 100, 110, 125]" :key="scale" :value="String(scale)">{{ scale }} %</option>
          </select>
        </div>
        <template v-for="key in (['appearance.primaryColor', 'appearance.background', 'appearance.surface'] as const)" :key="key">
          <div v-if="allowed.has(key)" class="mu-scoped">
            <label class="mu-check">
              <input type="checkbox" :checked="has(key)" @change="set(key, ($event.target as HTMLInputElement).checked ? asString(inherited(key), '#3978fe') : undefined)" />
              <span>{{ t('prefs.ownColor', { name: t(`fields.${key.replace(/\./g, '_')}`) }) }}</span>
            </label>
            <ColorField
              :id="`mu-pref-${key}`" :label="t(`fields.${key.replace(/\./g, '_')}`)" :model-value="asString(effective(key), '#3978fe')" :disabled="!has(key)"
              :max-luminance="key === 'appearance.primaryColor' ? 0.9 : undefined" :min-luminance="key === 'appearance.background' ? 0.85 : key === 'appearance.surface' ? 0.92 : undefined"
              @update:model-value="set(key, $event)"
            />
          </div>
        </template>
      </div>
    </section>

    <section v-if="allowed.has('navigation.favorites') || allowed.has('navigation.compact')" class="mu-subsection">
      <h3 class="mu-section__heading">{{ t('editor.tabs.menu') }}</h3>
      <label v-if="allowed.has('navigation.compact')" class="mu-check">
        <input type="checkbox" :checked="effective('navigation.compact') === true" data-mu-field="compact" @change="set('navigation.compact', ($event.target as HTMLInputElement).checked)" />
        <span>{{ t('fields.navigation_compact') }}</span>
      </label>
      <template v-if="allowed.has('navigation.favorites') && data.menu.favoritesEnabled">
        <h4 class="mu-field__label">{{ t('fields.navigation_favorites') }}</h4>
        <p class="mu-help">{{ t('prefs.favoritesHelp', { count: favorites.length }) }}</p>
        <ol class="mu-plain-list" data-mu-list="favorites">
          <li v-for="(module, index) in favorites" :key="module" tabindex="0" :data-mu-favorite="module" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" @keydown="favoriteKey($event, index)">
            <ModuleIcon v-if="menuModules.get(module)" :icon="menuModules.get(module)?.icon ?? { kind: 'lucide', name: 'star' }" :size="15" />
            <span class="mu-item__label">{{ menuModules.get(module)?.label ?? module }}</span>
            <button type="button" class="mu-icon-btn" :disabled="index === 0" :aria-label="t('editor.menu.up', { name: menuModules.get(module)?.label ?? module })" @click="moveFavorite(index, -1)"><ArrowUp :size="14" /></button>
            <button type="button" class="mu-icon-btn" :disabled="index === favorites.length - 1" :aria-label="t('editor.menu.down', { name: menuModules.get(module)?.label ?? module })" @click="moveFavorite(index, 1)"><ArrowDown :size="14" /></button>
            <button type="button" class="mu-icon-btn" :aria-label="t('prefs.removeFavorite', { name: menuModules.get(module)?.label ?? module })" @click="setFavorites(favorites.filter((entry) => entry !== module))"><Trash2 :size="14" /></button>
          </li>
          <li v-if="favorites.length === 0" class="mu-help">{{ t('prefs.noFavorites') }}</li>
        </ol>
        <div v-if="favoriteChoices.length > 0 && favorites.length < 30" class="mu-inline-field">
          <select v-model="newFavorite" class="mu-select" :aria-label="t('prefs.addFavorite')" data-mu-field="favorite">
            <option value="">{{ t('prefs.chooseModule') }}</option>
            <option v-for="item in favoriteChoices" :key="item.module" :value="item.module">{{ item.label }}</option>
          </select>
          <button type="button" class="mu-btn" data-mu-action="add-favorite" @click="addFavorite"><Plus :size="14" aria-hidden="true" /><span>{{ t('prefs.addFavorite') }}</span></button>
        </div>
      </template>
    </section>

    <section v-if="canOptOut || canSelfEnable" class="mu-subsection">
      <label v-if="canOptOut" class="mu-check mu-check--block">
        <input type="checkbox" :checked="effective('user.standardView') === true" data-mu-field="standard-view" @change="set('user.standardView', ($event.target as HTMLInputElement).checked)" />
        <span>{{ t('prefs.standardView') }} <span class="mu-help">{{ t('prefs.standardViewHelp') }}</span></span>
      </label>
      <label v-if="canSelfEnable" class="mu-check">
        <input type="checkbox" :checked="effective('user.selfEnabled') === true" data-mu-field="self-enabled" @change="set('user.selfEnabled', ($event.target as HTMLInputElement).checked)" />
        <span>{{ t('prefs.selfEnable') }}</span>
      </label>
    </section>

    <div class="mu-editor__toolbar" role="region" :aria-label="t('editor.toolbar.label')">
      <p class="mu-editor__state" role="status" aria-live="polite">
        <span v-if="message" :class="`mu-text-${message.kind}`" data-mu-status>{{ message.text }}</span>
        <span v-else-if="dirty" class="mu-text-warning">{{ t('prefs.unsaved') }}</span>
        <span v-else class="mu-text-muted">{{ t('prefs.clean') }}</span>
      </p>
      <div class="mu-editor__actions">
        <button v-if="conflict" type="button" class="mu-btn" data-mu-action="reload" @click="reloadCurrent"><RotateCcw :size="14" aria-hidden="true" /><span>{{ t('prefs.reload') }}</span></button>
        <button type="button" class="mu-btn" :disabled="busy || data.personal.revision === 0" data-mu-action="reset" @click="resetAll"><RotateCcw :size="14" aria-hidden="true" /><span>{{ t('prefs.reset') }}</span></button>
        <button type="button" class="mu-btn" :disabled="busy || !dirty" data-mu-action="cancel" @click="cancel"><Undo2 :size="14" aria-hidden="true" /><span>{{ t('editor.toolbar.cancel') }}</span></button>
        <button type="button" class="mu-btn mu-btn--primary" :disabled="busy || !dirty" data-mu-action="save" @click="save"><Save :size="14" aria-hidden="true" /><span>{{ busy ? t('editor.toolbar.saving') : t('editor.toolbar.save') }}</span></button>
      </div>
    </div>
  </div>
</template>
