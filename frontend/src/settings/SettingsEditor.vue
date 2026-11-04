<script setup lang="ts">
/**
 * Settings → ModernUI: the editor of the theme for administrators (docs/settings.md §8).
 *
 * Sections: appearance, menu, users and roles, compatibility, import and export. Appearance, menu and compatibility
 * edit the common settings or the profile of one role; the draft stays in this browser until "Save" (the colours,
 * density and text size preview on this page at once, the menu preview is built by the server with the permissions of
 * this administrator and saves nothing). "Cancel" returns to the saved values. A save that another administrator or
 * tab overtook is a conflict: load the current values, compare, or overwrite.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { RotateCcw, Save, Undo2 } from '@lucide/vue'
import type { Bootstrap } from '../api/types'
import { ApiError } from '../api/guards'
import { savePreferences } from '../api/client'
import { applyTokens, clearTokens, tokensFor } from '../boot/tokens'
import { effectiveLocale, isThemeLocale, THEME_LOCALES, type ThemeLocale } from '../i18n/locale'
import { loadEditor, saveScope } from './api'
import { conflictOf, errorsOf } from './guards'
import { changedKeys, createEditor, SECTION_KEYS, type SectionId } from './state'
import type { EditorData, Problem, ScopeRef } from './types'
import AppearanceSection from './sections/AppearanceSection.vue'
import MenuSection from './sections/MenuSection.vue'
import AccessSection from './sections/AccessSection.vue'
import CompatibilitySection from './sections/CompatibilitySection.vue'
import TransferSection from './sections/TransferSection.vue'
import ConflictDialog from './components/ConflictDialog.vue'
import type { ConflictInfo } from './dialogs'
import { fieldLabel } from './fields'

const props = defineProps<{ initial: EditorData; bootstrap: Bootstrap | null }>()

const { t, locale } = useI18n()
const editor = createEditor(props.initial)
const SECTIONS: readonly SectionId[] = ['appearance', 'menu', 'access', 'compatibility', 'transfer']
const SCOPED: readonly SectionId[] = ['appearance', 'menu', 'compatibility']

function sectionFromHash(): SectionId {
  const hash = window.location.hash.replace(/^#mu-/, '')
  return SECTIONS.find((section) => section === hash) ?? 'appearance'
}

const section = ref<SectionId>(sectionFromHash())
const busy = ref(false)
const status = ref<{ kind: 'success' | 'error'; text: string } | null>(null)
const problems = ref<Problem[]>([])
const conflict = ref<ConflictInfo | null>(null)

watch(section, (value) => {
  history.replaceState(null, '', `#mu-${value}`)
})

const roleOptions = computed(() => editor.data.value.roles.filter((role) => !role.root && !role.missing))
const scopeValue = computed(() => (editor.draft.scope.kind === 'global' ? 'global' : `role:${editor.draft.scope.role}`))
const scopeName = computed(() => {
  const scope = editor.draft.scope
  return scope.kind === 'global' ? t('editor.scope.global') : t('editor.scope.role', { name: editor.data.value.roles.find((role) => role.id === scope.role)?.name ?? scope.role })
})

function changeScope(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const next: ScopeRef = value === 'global' ? { kind: 'global' } : { kind: 'role', role: value.slice(5) }
  if (editor.dirty.value && !window.confirm(t('editor.scope.discard'))) {
    ;(event.target as HTMLSelectElement).value = scopeValue.value
    return
  }
  problems.value = []
  status.value = null
  editor.open(next)
  if (section.value !== 'appearance' && section.value !== 'menu' && section.value !== 'compatibility') {
    section.value = 'appearance'
  }
}

function openRole(role: string): void {
  if (editor.dirty.value && !window.confirm(t('editor.scope.discard'))) {
    return
  }
  problems.value = []
  editor.open({ kind: 'role', role })
  section.value = 'appearance'
}

// ---- Language of the theme (personal choice of this administrator, saved at once, the draft stays) ----
const canChooseLanguage = computed(() => props.bootstrap?.personal.allowed.includes('locale') ?? false)
const storedLanguage = props.bootstrap?.personal.values['locale']
const languageChoice = ref<string>(typeof storedLanguage === 'string' ? storedLanguage : 'auto')

async function changeLanguage(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  const previous = languageChoice.value
  languageChoice.value = value
  const next = effectiveLocale(value === 'auto' ? null : value, props.bootstrap?.user.crmLanguage, props.bootstrap?.locale.default)
  locale.value = next.locale
  try {
    await savePreferences({ locale: value })
    status.value = { kind: 'success', text: t('editor.language.saved') }
  } catch (error) {
    languageChoice.value = previous
    status.value = { kind: 'error', text: t('editor.language.failed', { reason: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }) }
  }
}

// ---- Live preview of the appearance on this page ----
const savedTokens = props.bootstrap?.theme.active === true ? props.bootstrap.appearance.tokens : null
const previewTokens = computed(() => tokensFor({
  primaryColor: editor.effective('appearance.primaryColor'),
  background: editor.effective('appearance.background'),
  surface: editor.effective('appearance.surface'),
  density: editor.effective('appearance.density'),
  fontScale: editor.effective('appearance.fontScale'),
  font: editor.effective('appearance.font'),
}))

watch(previewTokens, (tokens) => {
  applyTokens(tokens)
}, { immediate: true })

function restoreTokens(): void {
  if (savedTokens !== null) {
    applyTokens(savedTokens)
  } else {
    clearTokens()
  }
}

// ---- Save, cancel, conflicts ----
async function reload(): Promise<void> {
  editor.replaceData(await loadEditor())
}

async function save(baseRevision?: number): Promise<void> {
  if (busy.value) {
    return
  }
  busy.value = true
  status.value = null
  problems.value = []
  const scope = editor.draft.scope
  const touchedAccess = SECTION_KEYS.access.some((key) => editor.dirtyKeys.value.includes(key))
  try {
    await saveScope(scope.kind, scope.kind === 'role' ? scope.role : '', editor.draft.values, baseRevision ?? editor.draft.revision, editor.draft.inherit)
    conflict.value = null
    await reload()
    status.value = { kind: 'success', text: t('editor.toolbar.savedNotice') }
    if (touchedAccess) {
      // The server part of the page (status, pilot forms) shows the saved mode and pilot after a reload.
      window.setTimeout(() => {
        window.location.reload()
      }, 600)
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'MU_CONFLICT') {
      await showConflict(conflictOf(error.params))
    } else if (error instanceof ApiError && error.code === 'MU_INVALID_VALUE') {
      problems.value = errorsOf(error.params)
      status.value = { kind: 'error', text: t('editor.toolbar.invalid', problems.value.length) }
    } else {
      status.value = { kind: 'error', text: t('editor.toolbar.failed', { reason: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }) }
    }
  } finally {
    busy.value = false
  }
}

async function showConflict(info: { revision: number; updatedBy: string | null; updatedAt: string | null }): Promise<void> {
  let theirs: string[] = []
  try {
    const fresh = await loadEditor()
    const scope = editor.draft.scope
    const current = scope.kind === 'global' ? fresh.global.values : fresh.roles.find((role) => role.id === scope.role)?.profile?.values ?? {}
    theirs = changedKeys(editor.draft.base, current)
  } catch {
    theirs = []
  }
  conflict.value = { ...info, theirs: theirs.map(fieldLabel(t)), mine: editor.dirtyKeys.value.map(fieldLabel(t)) }
}

async function loadCurrent(): Promise<void> {
  conflict.value = null
  await reload()
  status.value = { kind: 'success', text: t('editor.conflict.loaded') }
}

function overwrite(): void {
  const revision = conflict.value?.revision ?? editor.draft.revision
  conflict.value = null
  void save(revision)
}

function resetSection(): void {
  if (section.value !== 'transfer') {
    editor.resetSection(section.value)
    status.value = { kind: 'success', text: t('editor.toolbar.sectionReset') }
  }
}

function cancel(): void {
  editor.cancel()
  problems.value = []
  status.value = { kind: 'success', text: t('editor.toolbar.cancelled') }
}

// ---- Leaving with a draft ----
function beforeUnload(event: BeforeUnloadEvent): void {
  if (editor.dirty.value) {
    event.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  restoreTokens()
})

const languages = computed(() => [{ value: 'auto', label: t('editor.language.auto') }, ...THEME_LOCALES.map((code) => ({ value: code, label: t(`languages.${code}`) }))])
const themeLocale = computed<ThemeLocale>(() => (isThemeLocale(locale.value) ? locale.value : 'en-US'))
</script>

<template>
  <div class="mu-editor" :lang="themeLocale">
    <header class="mu-editor__header">
      <h2 class="mu-editor__title">{{ t('editor.title') }}</h2>
      <div class="mu-editor__header-controls">
        <label v-if="canChooseLanguage" class="mu-inline-field">
          <span>{{ t('editor.language.label') }}</span>
          <select class="mu-select" :value="languageChoice" data-mu-field="language" @change="changeLanguage">
            <option v-for="option in languages" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
      </div>
    </header>

    <TabsRoot v-model="section" class="mu-editor__tabs" :unmount-on-hide="false" activation-mode="manual">
      <TabsList class="mu-tabs" :aria-label="t('editor.tabs.label')">
        <TabsTrigger v-for="id in SECTIONS" :key="id" :value="id" class="mu-tabs__tab" :data-mu-tab="id">
          {{ t(`editor.tabs.${id}`) }}
          <span v-if="id !== 'transfer' && editor.sectionDirty(id)" class="mu-tabs__dot" :aria-label="t('editor.tabs.changed')" :title="t('editor.tabs.changed')"></span>
        </TabsTrigger>
      </TabsList>

      <div v-if="SCOPED.includes(section)" class="mu-editor__scope">
        <label class="mu-inline-field">
          <span>{{ t('editor.scope.label') }}</span>
          <select class="mu-select" :value="scopeValue" data-mu-field="scope" @change="changeScope">
            <option value="global">{{ t('editor.scope.global') }}</option>
            <option v-for="role in roleOptions" :key="role.id" :value="`role:${role.id}`">{{ ' '.repeat(Math.max(0, role.depth - 1)) }}{{ role.name }}{{ role.profile ? ` — ${t('editor.scope.hasProfile')}` : '' }}</option>
          </select>
        </label>
        <p v-if="editor.isRole.value" class="mu-help">{{ t('editor.scope.roleHelp') }}</p>
        <label v-if="editor.isRole.value" class="mu-check">
          <input v-model="editor.draft.inherit" type="checkbox" data-mu-field="inherit" />
          <span>{{ t('editor.scope.inherit') }}</span>
        </label>
      </div>

      <TabsContent value="appearance" class="mu-editor__panel">
        <AppearanceSection :editor="editor" :problems="problems" :bootstrap="bootstrap" />
      </TabsContent>
      <TabsContent value="menu" class="mu-editor__panel">
        <MenuSection :editor="editor" :problems="problems" :locale="themeLocale" />
      </TabsContent>
      <TabsContent value="access" class="mu-editor__panel">
        <AccessSection :editor="editor" :problems="problems" @open-role="openRole" @changed="reload" />
      </TabsContent>
      <TabsContent value="compatibility" class="mu-editor__panel">
        <CompatibilitySection :editor="editor" :problems="problems" />
      </TabsContent>
      <TabsContent value="transfer" class="mu-editor__panel">
        <TransferSection :dirty="editor.dirty.value" @imported="reload" />
      </TabsContent>
    </TabsRoot>

    <div v-if="section !== 'transfer'" class="mu-editor__toolbar" role="region" :aria-label="t('editor.toolbar.label')">
      <p class="mu-editor__state" role="status" aria-live="polite">
        <span v-if="status" :class="`mu-text-${status.kind}`" data-mu-status>{{ status.text }}</span>
        <span v-else-if="editor.dirty.value" class="mu-text-warning">{{ t('editor.toolbar.unsaved', { scope: scopeName }) }}</span>
        <span v-else class="mu-text-muted">{{ t('editor.toolbar.clean', { scope: scopeName }) }}</span>
      </p>
      <div class="mu-editor__actions">
        <button type="button" class="mu-btn" :disabled="busy" :title="editor.isRole.value ? t('editor.toolbar.resetSectionRole') : t('editor.toolbar.resetSectionHelp')" data-mu-action="reset-section" @click="resetSection">
          <RotateCcw :size="14" aria-hidden="true" /><span>{{ t('editor.toolbar.resetSection') }}</span>
        </button>
        <button type="button" class="mu-btn" :disabled="busy || !editor.dirty.value" data-mu-action="cancel" @click="cancel">
          <Undo2 :size="14" aria-hidden="true" /><span>{{ t('editor.toolbar.cancel') }}</span>
        </button>
        <button type="button" class="mu-btn mu-btn--primary" :disabled="busy || !editor.dirty.value" data-mu-action="save" @click="save()">
          <Save :size="14" aria-hidden="true" /><span>{{ busy ? t('editor.toolbar.saving') : t('editor.toolbar.save') }}</span>
        </button>
      </div>
    </div>

    <ConflictDialog v-if="conflict" :conflict="conflict" @load="loadCurrent" @overwrite="overwrite" @close="conflict = null" />
  </div>
</template>
