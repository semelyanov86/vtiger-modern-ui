<script setup lang="ts">
/**
 * Personal preferences of the new interface (docs/settings.md §4, docs/design.md §13.12, docs/I18N.md): language of
 * the theme ("As in the CRM", Русский, English, Deutsch), appearance and menu within what the administrator allows,
 * favorites (tiles as the favourites of the cloud's "Personalize", order by drag and drop or Alt+arrows), the standard
 * view. The page says first that only this person is affected and nothing of the data, permissions or formats of the
 * CRM changes; every value says whether it is the person's own or as the administrator set it. The language switches
 * the texts at once without losing the other unsaved values; everything is saved together with the revision of the
 * personal settings (a save in another tab in between is a conflict, not an overwrite).
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import { GripVertical, Plus, RotateCcw, Save, Star, Undo2, X } from '@lucide/vue'
import type { Bootstrap, MenuItem } from '../api/types'
import { ApiError } from '../api/guards'
import { clearPreferences, fetchBootstrap, savePreferences } from '../api/client'
import { applyTokens, clearTokens, tokensFor } from '../boot/tokens'
import { effectiveLocale, THEME_LOCALES } from '../i18n/locale'
import ColorField from '../settings/components/ColorField.vue'
import ConfirmDialog from '../settings/components/ConfirmDialog.vue'
import { ask } from '../settings/confirm'
import { describeValue } from '../settings/fields'
import { clone, same } from '../settings/state'
import { reorderAnimation } from '../boot/motion'

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

/** The line under a value: the person's own one (with the way back) or as the administrator set it. */
function origin(key: string): { own: boolean; text: string } {
  return has(key)
    ? { own: true, text: t('prefs.originOwn', { value: describeValue(t, key, inherited(key)) }) }
    : { own: false, text: t('prefs.originAdmin', { value: describeValue(t, key, inherited(key)) }) }
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
// The list the tiles drag: a copy, written back on every change.
const favoriteList = ref<string[]>([...favorites.value])
watch(favorites, (list) => {
  if (!same(list, favoriteList.value)) {
    favoriteList.value = [...list]
  }
})
const favoriteChoices = computed(() => [...menuModules.value.values()].filter((item) => !favorites.value.includes(item.module)).sort((a, b) => a.label.localeCompare(b.label)))
const newFavorite = ref<string>('')
const favoriteStatus = ref('')
const labelOf = (module: string): string => menuModules.value.get(module)?.label ?? module

function setFavorites(list: string[]): void {
  set('navigation.favorites', list)
}

function addFavorite(): void {
  const module = newFavorite.value !== '' ? newFavorite.value : favoriteChoices.value[0]?.module
  if (module !== undefined && favorites.value.length < 30) {
    setFavorites([...favorites.value, module])
    newFavorite.value = ''
    favoriteStatus.value = t('prefs.favoriteAdded', { name: labelOf(module) })
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
  favoriteStatus.value = t('prefs.favoriteMoved', { name: labelOf(item), position: target + 1, count: list.length })
  window.setTimeout(() => {
    document.querySelector<HTMLElement>(`[data-mu-favorite="${CSS.escape(item)}"]`)?.focus()
  }, 0)
}

function favoriteKey(event: KeyboardEvent, index: number, module: string): void {
  if (event.target !== event.currentTarget) {
    return
  }
  const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
  if (event.altKey && (back || event.key === 'ArrowDown' || event.key === 'ArrowRight')) {
    event.preventDefault()
    moveFavorite(index, back ? -1 : 1)
  } else if (event.key === 'Delete') {
    event.preventDefault()
    setFavorites(favorites.value.filter((entry) => entry !== module))
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
  const ok = await ask({ title: t('prefs.reset'), text: t('prefs.resetConfirm'), confirm: t('prefs.reset'), cancel: t('editor.dialog.cancel'), danger: true })
  if (!ok) {
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
const showAppearance = computed(() => ['appearance.density', 'appearance.fontScale', 'appearance.primaryColor', 'appearance.background', 'appearance.surface'].some((key) => allowed.value.has(key)))
const showMenu = computed(() => (allowed.value.has('navigation.favorites') && data.value.menu.favoritesEnabled) || allowed.value.has('navigation.compact'))
</script>

<template>
  <div class="mu-editor mu-prefs" data-mu-prefs>
    <div class="mu-prefs__intro">
      <p class="mu-prefs__lead" data-mu-prefs-scope>{{ t('prefs.onlyYou') }}</p>
      <span class="mu-status-chip" :data-mu-mode="data.theme.active ? 'all' : 'off'" data-mu-status-chip><span class="mu-status-chip__dot" aria-hidden="true"></span>{{ data.theme.active ? t('prefs.active') : t('prefs.inactive') }}</span>
    </div>

    <div class="mu-editor__body mu-prefs__body">
      <p v-if="nothing" class="mu-note">{{ t('prefs.nothing') }}</p>

      <section v-if="allowed.has('locale')" class="mu-card">
        <header class="mu-card__header"><h3 class="mu-card__title">{{ t('prefs.languageTitle') }}</h3></header>
        <div class="mu-card__body mu-card__body--rows">
          <div class="mu-row" data-mu-key="locale">
            <div class="mu-row__label"><label for="mu-pref-locale">{{ t('prefs.language') }}</label></div>
            <div class="mu-row__control">
              <select id="mu-pref-locale" class="mu-select mu-select--field" :value="localeChoice" data-mu-field="locale" @change="set('locale', ($event.target as HTMLSelectElement).value)">
                <option value="auto">{{ t('editor.language.auto') }}</option>
                <option v-for="code in THEME_LOCALES" :key="code" :value="code">{{ t(`languages.${code}`) }}</option>
              </select>
              <p class="mu-help">{{ t('prefs.languageHelp') }}</p>
            </div>
          </div>
        </div>
      </section>

      <section v-if="showAppearance" class="mu-card">
        <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.tabs.appearance') }}</h3></header>
        <div class="mu-card__body mu-card__body--rows">
          <div v-if="allowed.has('appearance.density')" class="mu-row" data-mu-key="appearance.density">
            <div class="mu-row__label"><label for="mu-pref-density">{{ t('fields.appearance_density') }}</label></div>
            <div class="mu-row__control">
              <select id="mu-pref-density" class="mu-select mu-select--field" :value="asString(draft['appearance.density'], '')" data-mu-field="density" @change="set('appearance.density', ($event.target as HTMLSelectElement).value || undefined)">
                <option value="">{{ t('prefs.asAdmin', { value: t(`editor.appearance.density.${asString(inherited('appearance.density'), 'standard')}`) }) }}</option>
                <option v-for="density in ['compact', 'standard', 'comfortable']" :key="density" :value="density">{{ t(`editor.appearance.density.${density}`) }}</option>
              </select>
              <p class="mu-row__origin" :data-mu-origin="origin('appearance.density').own ? 'own' : 'inherited'">{{ origin('appearance.density').text }}</p>
            </div>
          </div>
          <div v-if="allowed.has('appearance.fontScale')" class="mu-row" data-mu-key="appearance.fontScale">
            <div class="mu-row__label"><label for="mu-pref-scale">{{ t('fields.appearance_fontScale') }}</label></div>
            <div class="mu-row__control">
              <select id="mu-pref-scale" class="mu-select mu-select--field" :value="typeof draft['appearance.fontScale'] === 'number' ? String(draft['appearance.fontScale']) : ''" data-mu-field="font-scale" @change="set('appearance.fontScale', ($event.target as HTMLSelectElement).value === '' ? undefined : Number(($event.target as HTMLSelectElement).value))">
                <option value="">{{ t('prefs.asAdmin', { value: `${String(inherited('appearance.fontScale') ?? 100)} %` }) }}</option>
                <option v-for="scale in [90, 100, 110, 125]" :key="scale" :value="String(scale)">{{ scale }} %</option>
              </select>
              <p class="mu-row__origin" :data-mu-origin="origin('appearance.fontScale').own ? 'own' : 'inherited'">{{ origin('appearance.fontScale').text }}</p>
            </div>
          </div>
          <template v-for="key in (['appearance.primaryColor', 'appearance.background', 'appearance.surface'] as const)" :key="key">
            <div v-if="allowed.has(key)" class="mu-row" :data-mu-key="key">
              <div class="mu-row__label"><span :id="`mu-pref-${key}-label`">{{ t(`fields.${key.replace(/\./g, '_')}`) }}</span></div>
              <div class="mu-row__control">
                <label class="mu-switch">
                  <input type="checkbox" role="switch" :checked="has(key)" :data-mu-own="key" @change="set(key, ($event.target as HTMLInputElement).checked ? asString(inherited(key), '#3978fe') : undefined)" />
                  <span>{{ t('prefs.ownColor', { name: t(`fields.${key.replace(/\./g, '_')}`) }) }}</span>
                </label>
                <ColorField
                  :id="`mu-pref-${key}`" :label="t(`fields.${key.replace(/\./g, '_')}`)" :labelledby="`mu-pref-${key}-label`" :model-value="asString(effective(key), '#3978fe')" :disabled="!has(key)"
                  :max-luminance="key === 'appearance.primaryColor' ? 0.9 : undefined" :min-luminance="key === 'appearance.background' ? 0.85 : key === 'appearance.surface' ? 0.92 : undefined"
                  @update:model-value="set(key, $event)"
                />
                <p class="mu-row__origin" :data-mu-origin="origin(key).own ? 'own' : 'inherited'">{{ origin(key).text }}</p>
              </div>
            </div>
          </template>
        </div>
      </section>

      <section v-if="showMenu" class="mu-card">
        <header class="mu-card__header"><h3 class="mu-card__title">{{ t('prefs.menuTitle') }}</h3></header>
        <div class="mu-card__body">
          <template v-if="allowed.has('navigation.favorites') && data.menu.favoritesEnabled">
            <h4 class="mu-column__title mu-column__title--tiles">{{ t('fields.navigation_favorites') }}</h4>
            <p class="mu-help">{{ t('prefs.favoritesHelp', { count: favorites.length }) }}</p>
            <p class="mu-visually-hidden" role="status" aria-live="polite">{{ favoriteStatus }}</p>
            <VueDraggable v-model="favoriteList" tag="ol" class="mu-favorites" handle=".mu-favorite__drag" :animation="reorderAnimation()" data-mu-list="favorites" @end="setFavorites([...favoriteList])">
              <li
                v-for="(module, index) in favoriteList" :key="module" class="mu-favorite" tabindex="0" :data-mu-favorite="module"
                :aria-label="t('prefs.favoriteAria', { name: labelOf(module), position: index + 1, count: favoriteList.length })"
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Delete" @keydown="favoriteKey($event, index, module)"
              >
                <span class="mu-favorite__drag mu-drag" :title="t('editor.menu.drag')" aria-hidden="true"><GripVertical :size="13" /></span>
                <Star :size="13" class="mu-favorite__star" aria-hidden="true" />
                <span class="mu-favorite__label" :title="labelOf(module)">{{ labelOf(module) }}</span>
                <button type="button" class="mu-favorite__remove" :aria-label="t('prefs.removeFavorite', { name: labelOf(module) })" :title="t('prefs.removeFavorite', { name: labelOf(module) })" @click="setFavorites(favorites.filter((entry) => entry !== module))"><X :size="13" /></button>
              </li>
            </VueDraggable>
            <p v-if="favorites.length === 0" class="mu-empty">{{ t('prefs.noFavorites') }}</p>
            <div v-if="favoriteChoices.length > 0 && favorites.length < 30" class="mu-inline-field">
              <select v-model="newFavorite" class="mu-select mu-select--field" :aria-label="t('prefs.addFavorite')" data-mu-field="favorite">
                <option value="">{{ t('prefs.chooseModule') }}</option>
                <option v-for="item in favoriteChoices" :key="item.module" :value="item.module">{{ item.label }}</option>
              </select>
              <button type="button" class="mu-btn" data-mu-action="add-favorite" @click="addFavorite"><Plus :size="14" aria-hidden="true" /><span>{{ t('prefs.addFavorite') }}</span></button>
            </div>
          </template>
          <label v-if="allowed.has('navigation.compact')" class="mu-switch mu-prefs__compact">
            <input type="checkbox" role="switch" :checked="effective('navigation.compact') === true" data-mu-field="compact" @change="set('navigation.compact', ($event.target as HTMLInputElement).checked)" />
            <span>{{ t('fields.navigation_compact') }}</span>
          </label>
        </div>
      </section>

      <section v-if="canOptOut || canSelfEnable" class="mu-card">
        <header class="mu-card__header"><h3 class="mu-card__title">{{ t('prefs.viewTitle') }}</h3></header>
        <div class="mu-card__body">
          <label v-if="canOptOut" class="mu-switch mu-switch--block">
            <input type="checkbox" role="switch" :checked="effective('user.standardView') === true" data-mu-field="standard-view" @change="set('user.standardView', ($event.target as HTMLInputElement).checked)" />
            <span><strong>{{ t('prefs.standardView') }}</strong> <span class="mu-help">{{ t('prefs.standardViewHelp') }}</span></span>
          </label>
          <label v-if="canSelfEnable" class="mu-switch mu-switch--block">
            <input type="checkbox" role="switch" :checked="effective('user.selfEnabled') === true" data-mu-field="self-enabled" @change="set('user.selfEnabled', ($event.target as HTMLInputElement).checked)" />
            <span>{{ t('prefs.selfEnable') }}</span>
          </label>
        </div>
      </section>
    </div>

    <div class="mu-editor__footer" role="region" :aria-label="t('editor.toolbar.label')" data-mu-footer>
      <p class="mu-editor__state" role="status" aria-live="polite">
        <span v-if="message" :class="`mu-text-${message.kind}`" data-mu-status>{{ message.text }}</span>
        <span v-else-if="dirty" class="mu-text-warning">{{ t('prefs.unsaved') }}</span>
        <span v-else class="mu-text-muted">{{ t('prefs.clean') }}</span>
      </p>
      <div class="mu-editor__actions">
        <button v-if="conflict" type="button" class="mu-btn" data-mu-action="reload" @click="reloadCurrent"><RotateCcw :size="14" aria-hidden="true" /><span>{{ t('prefs.reload') }}</span></button>
        <button type="button" class="mu-btn mu-btn--quiet" :disabled="busy || data.personal.revision === 0" :title="t('prefs.reset')" :aria-label="t('prefs.reset')" data-mu-action="reset" @click="resetAll"><RotateCcw :size="14" aria-hidden="true" /><span>{{ t('prefs.reset') }}</span></button>
        <button type="button" class="mu-btn" :disabled="busy || !dirty" data-mu-action="cancel" @click="cancel"><Undo2 :size="14" aria-hidden="true" /><span>{{ t('editor.toolbar.cancel') }}</span></button>
        <button type="button" class="mu-btn mu-btn--primary mu-btn--save" :disabled="busy || !dirty" data-mu-action="save" @click="save"><Save :size="14" aria-hidden="true" /><span>{{ busy ? t('editor.toolbar.saving') : t('editor.toolbar.save') }}</span></button>
      </div>
    </div>
    <ConfirmDialog />
  </div>
</template>
