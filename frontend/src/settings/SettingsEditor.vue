<script setup lang="ts">
/**
 * Settings → ModernUI: the page of the theme for administrators (docs/design.md §13.12, docs/settings.md §8, §14).
 *
 * One title (printed by the server, Index.tpl) with the saved state of the theme, the personal language and the way to
 * the personal preferences next to it; the sections in the order of the work — switching on, appearance, menu, users
 * and roles, compatibility, transfer — and "Service" (status, recovery, the check of this browser) apart from the
 * everyday fields. Appearance, menu and compatibility edit the common settings or the profile of one role: the scope
 * bar says which before anything is changed. The draft stays in this browser until "Save": the colours, density and
 * text size preview on this page at once (nothing is published), "Cancel" returns to the saved values, "Reset" names
 * what it resets for whom. Switching the scope or leaving with a draft never drops it silently: the tab keeps it and
 * offers it back after a reload; a save another administrator overtook is a conflict whose changes can be carried
 * over to the current version.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { History, RotateCcw, Save, Undo2 } from '@lucide/vue'
import type { Bootstrap } from '../api/types'
import { ApiError } from '../api/guards'
import { savePreferences } from '../api/client'
import { applyTokens, clearTokens, tokensFor } from '../boot/tokens'
import { effectiveLocale, isThemeLocale, THEME_LOCALES, type ThemeLocale } from '../i18n/locale'
import { loadEditor, saveScope } from './api'
import { conflictOf, errorsOf } from './guards'
import {
  changedKeys, createEditor, isDraftSection, parseStoredDraft, scopeKey, SCOPED_SECTIONS, SECTION_KEYS, SECTIONS, stableJson,
  storageKey, type SectionId, type StoredDraft,
} from './state'
import type { EditorData, Problem, ScopeRef } from './types'
import EnableSection from './sections/EnableSection.vue'
import AppearanceSection from './sections/AppearanceSection.vue'
import MenuSection from './sections/MenuSection.vue'
import AccessSection from './sections/AccessSection.vue'
import CompatibilitySection from './sections/CompatibilitySection.vue'
import TransferSection from './sections/TransferSection.vue'
import MaintenanceSection from './sections/MaintenanceSection.vue'
import ConflictDialog from './components/ConflictDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import LeaveDraftDialog from './components/LeaveDraftDialog.vue'
import ScopePicker from './components/ScopePicker.vue'
import type { ConflictInfo } from './dialogs'
import { fieldLabel } from './fields'
import { setPageFont } from './pageFont'

const props = defineProps<{ initial: EditorData; bootstrap: Bootstrap | null }>()

const { t, locale } = useI18n()
const editor = createEditor(props.initial)

function sectionFromHash(): SectionId {
  const hash = window.location.hash.replace(/^#mu-/, '')
  return SECTIONS.find((section) => section === hash) ?? 'enable'
}

const section = ref<SectionId>(sectionFromHash())
const busy = ref(false)
const status = ref<{ kind: 'success' | 'error'; text: string } | null>(null)
const problems = ref<Problem[]>([])
const conflict = ref<ConflictInfo | null>(null)
const notice = ref<{ kind: 'info' | 'warning'; text: string; fields: string[] } | null>(null)

watch(section, (value) => {
  history.replaceState(null, '', `#mu-${value}`)
})

const label = fieldLabel(t)
const scoped = computed(() => SCOPED_SECTIONS.includes(section.value))
const draftSection = computed(() => isDraftSection(section.value))
const roleName = (role: string): string => editor.data.value.roles.find((entry) => entry.id === role)?.name ?? role
const scopeName = (scope: ScopeRef): string => (scope.kind === 'global' ? t('editor.scope.global') : t('editor.scope.role', { name: roleName(scope.role) }))
const currentScopeName = computed(() => scopeName(editor.draft.scope))
const currentRole = computed(() => {
  const scope = editor.draft.scope
  return scope.kind === 'role' ? editor.data.value.roles.find((role) => role.id === scope.role) ?? null : null
})

// ---- The saved state of the theme next to the title ----
const savedMode = computed(() => {
  const value = editor.data.value.global.values['theme.mode'] ?? editor.data.value.defaults['theme.mode']
  return typeof value === 'string' ? value : 'off'
})
const savedCount = (key: string): number => {
  const value = editor.data.value.global.values[key]
  return Array.isArray(value) ? value.length : 0
}
const chip = computed(() => {
  const mode = savedMode.value
  const base = mode === 'pilot'
    ? t('editor.header.pilot', { users: savedCount('theme.pilot.users'), roles: savedCount('theme.pilot.roles') })
    : t(`editor.header.${mode === 'all' ? 'all' : 'off'}`)
  const forMe = props.bootstrap === null ? '' : props.bootstrap.theme.active ? t('editor.header.forMeOn') : t('editor.header.forMeOff')
  return forMe === '' ? base : `${base} · ${forMe}`
})
const headerTarget = document.querySelector('[data-mu-root="settings-header-tools"]') !== null

// ---- Scope: a draft is never dropped silently ----
const pendingScope = ref<ScopeRef | null>(null)

function openScope(next: ScopeRef): void {
  problems.value = []
  status.value = null
  notice.value = null
  editor.open(next)
  if (next.kind === 'role' && !scoped.value) {
    section.value = 'appearance'
  }
}

function requestScope(next: ScopeRef): void {
  if (scopeKey(next) === scopeKey(editor.draft.scope)) {
    return
  }
  if (editor.dirty.value) {
    pendingScope.value = next
    return
  }
  openScope(next)
}

async function leaveWithSave(): Promise<void> {
  const next = pendingScope.value
  if (next !== null && await save()) {
    pendingScope.value = null
    openScope(next)
  } else {
    pendingScope.value = null
  }
}

function leaveWithoutSave(): void {
  const next = pendingScope.value
  pendingScope.value = null
  if (next !== null) {
    openScope(next)
  }
}

function openRole(role: string): void {
  requestScope({ kind: 'role', role })
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
  setPageFont(tokens['font-family'])
}, { immediate: true })

function restoreTokens(): void {
  if (savedTokens !== null) {
    applyTokens(savedTokens)
    setPageFont(savedTokens['font-family'])
  } else {
    clearTokens()
    setPageFont(undefined)
  }
}

// ---- The draft kept by this tab (reload, leaving the page) ----
const STORE = storageKey(editor.data.value.me)
const offer = ref<StoredDraft | null>(null)

function readStored(): StoredDraft | null {
  try {
    return parseStoredDraft(window.sessionStorage.getItem(STORE))
  } catch {
    return null
  }
}

function writeStored(value: StoredDraft | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(STORE)
    } else {
      window.sessionStorage.setItem(STORE, JSON.stringify(value))
    }
  } catch {
    // Storage blocked: the draft is only in memory, leaving the page still asks first.
  }
}

let persistTimer: number | undefined
watch(() => stableJson([editor.draft.scope, editor.draft.values, editor.draft.inherit, editor.draft.revision]), () => {
  if (offer.value !== null) {
    // The person has not answered the offer yet: the kept draft stays as it is.
    return
  }
  window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    writeStored(editor.snapshot())
  }, 300)
})

function restoreOffered(): void {
  const stored = offer.value
  offer.value = null
  if (stored === null) {
    return
  }
  const result = editor.restore(stored)
  if (result === null) {
    writeStored(null)
    notice.value = { kind: 'warning', text: t('editor.restore.roleGone'), fields: [] }
    return
  }
  if (stored.scope.kind === 'role' && !scoped.value) {
    section.value = 'appearance'
  }
  notice.value = result.changed
    ? { kind: 'warning', text: t('editor.restore.rebased'), fields: result.overlap.map(label) }
    : { kind: 'info', text: t('editor.restore.restored', { scope: currentScopeName.value }), fields: [] }
  writeStored(editor.snapshot())
}

function dropOffered(): void {
  offer.value = null
  writeStored(editor.snapshot())
}

const offerText = computed(() => {
  const stored = offer.value
  if (stored === null) {
    return ''
  }
  const time = new Date(stored.savedAt)
  const when = Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
  const count = changedKeys(stored.base, stored.values).length
  return t('editor.restore.offer', { scope: scopeName(stored.scope), time: when, n: count }, count)
})

// ---- Save, cancel, conflicts ----
async function reload(): Promise<void> {
  editor.replaceData(await loadEditor())
}

async function save(baseRevision?: number): Promise<boolean> {
  if (busy.value) {
    return false
  }
  busy.value = true
  status.value = null
  problems.value = []
  const scope = editor.draft.scope
  const touchedSwitching = SECTION_KEYS.enable.some((key) => editor.dirtyKeys.value.includes(key))
  try {
    await saveScope(scope.kind, scope.kind === 'role' ? scope.role : '', editor.draft.values, baseRevision ?? editor.draft.revision, editor.draft.inherit)
    conflict.value = null
    notice.value = null
    await reload()
    writeStored(null)
    status.value = { kind: 'success', text: t('editor.toolbar.savedNotice', { scope: scopeName(scope) }) }
    if (touchedSwitching) {
      // The server parts of the page (state, service forms) show the saved mode and pilot after a reload.
      window.setTimeout(() => {
        window.location.reload()
      }, 600)
    }
    return true
  } catch (error) {
    if (error instanceof ApiError && error.code === 'MU_CONFLICT') {
      await showConflict(conflictOf(error.params))
    } else if (error instanceof ApiError && error.code === 'MU_INVALID_VALUE') {
      problems.value = errorsOf(error.params)
      status.value = { kind: 'error', text: t('editor.toolbar.invalid', problems.value.length) }
    } else {
      status.value = { kind: 'error', text: t('editor.toolbar.failed', { reason: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }) }
    }
    return false
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
  conflict.value = { ...info, theirs: theirs.map(label), mine: editor.dirtyKeys.value.map(label) }
}

async function rebaseOnCurrent(): Promise<void> {
  conflict.value = null
  try {
    const overlap = editor.rebase(await loadEditor())
    status.value = null
    notice.value = { kind: 'warning', text: t('editor.conflict.rebased'), fields: overlap.map(label) }
  } catch (error) {
    status.value = { kind: 'error', text: t('editor.toolbar.failed', { reason: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }) }
  }
}

async function loadCurrent(): Promise<void> {
  conflict.value = null
  await reload()
  notice.value = null
  status.value = { kind: 'success', text: t('editor.conflict.loaded') }
}

function overwrite(): void {
  const revision = conflict.value?.revision ?? editor.draft.revision
  conflict.value = null
  void save(revision)
}

const sectionName = computed(() => t(`editor.tabs.${section.value}`))
const canReset = computed(() => isDraftSection(section.value) && editor.resettable(section.value).length > 0)
const resetLabel = computed(() => t('editor.toolbar.resetSectionFor', { section: sectionName.value, scope: currentScopeName.value }))
const resetHelp = computed(() => (editor.isRole.value ? t('editor.toolbar.resetSectionRole') : t('editor.toolbar.resetSectionHelp')))

function resetSection(): void {
  const current = section.value
  if (isDraftSection(current)) {
    editor.resetSection(current)
    status.value = { kind: 'success', text: t('editor.toolbar.sectionReset', { section: sectionName.value, scope: currentScopeName.value }) }
  }
}

function cancel(): void {
  editor.cancel()
  problems.value = []
  notice.value = null
  status.value = { kind: 'success', text: t('editor.toolbar.cancelled') }
}

// ---- Leaving with a draft ----
function beforeUnload(event: BeforeUnloadEvent): void {
  if (editor.dirty.value) {
    writeStored(editor.snapshot())
    event.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  const stored = readStored()
  if (stored !== null && changedKeys(stored.base, stored.values).length + (stored.inherit !== stored.baseInherit ? 1 : 0) > 0) {
    offer.value = stored
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  window.clearTimeout(persistTimer)
  restoreTokens()
})

const languages = computed(() => [{ value: 'auto', label: t('editor.language.auto') }, ...THEME_LOCALES.map((code) => ({ value: code, label: t(`languages.${code}`) }))])
const themeLocale = computed<ThemeLocale>(() => (isThemeLocale(locale.value) ? locale.value : 'en-US'))
</script>

<template>
  <div class="mu-editor" :lang="themeLocale" :data-mu-current="section">
    <Teleport to="[data-mu-root=&quot;settings-header-tools&quot;]" :disabled="!headerTarget">
      <div class="mu-page-tools" :lang="themeLocale">
        <span class="mu-status-chip" :data-mu-mode="savedMode" data-mu-status-chip>
          <span class="mu-status-chip__dot" aria-hidden="true"></span>{{ chip }}
        </span>
        <a class="mu-page-tools__link" href="index.php?module=ModernUI&amp;view=Preferences" data-mu-action="my-preferences">{{ t('editor.header.myPreferences') }}</a>
        <label v-if="canChooseLanguage" class="mu-page-tools__language" :title="t('editor.language.help')">
          <span>{{ t('editor.language.label') }}</span>
          <select class="mu-select mu-select--small" :value="languageChoice" data-mu-field="language" @change="changeLanguage">
            <option v-for="option in languages" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
      </div>
    </Teleport>

    <TabsRoot v-model="section" class="mu-editor__tabs" :unmount-on-hide="false" activation-mode="manual">
      <div class="mu-editor__tabbar">
        <TabsList class="mu-tabs" :aria-label="t('editor.tabs.label')">
          <TabsTrigger v-for="id in SECTIONS" :key="id" :value="id" class="mu-tabs__tab" :class="{ 'mu-tabs__tab--service': id === 'maintenance' }" :data-mu-tab="id">
            {{ t(`editor.tabs.${id}`) }}
            <span v-if="isDraftSection(id) && editor.sectionDirty(id)" class="mu-tabs__dot" :aria-label="t('editor.tabs.changed')" :title="t('editor.tabs.changed')"></span>
          </TabsTrigger>
        </TabsList>
      </div>

      <div class="mu-editor__body">
        <div v-if="scoped" class="mu-scopebar" data-mu-scopebar>
          <span class="mu-scopebar__label">{{ t('editor.scope.label') }}</span>
          <ScopePicker :scope="editor.draft.scope" :roles="editor.data.value.roles" @select="requestScope" />
          <p class="mu-scopebar__text" data-mu-scope-text>
            <template v-if="currentRole === null">{{ t('editor.scope.globalText') }}</template>
            <template v-else>
              {{ t('editor.scope.roleText', { role: currentRole.name, n: currentRole.users }, currentRole.users) }}
              <template v-if="currentRole.profile === null"> {{ t('editor.scope.newProfile') }}</template>
            </template>
          </p>
          <label v-if="editor.isRole.value" class="mu-check mu-scopebar__inherit">
            <input v-model="editor.draft.inherit" type="checkbox" data-mu-field="inherit" />
            <span>{{ t('editor.scope.inherit') }}</span>
          </label>
          <button v-if="canReset" type="button" class="mu-link-btn mu-scopebar__reset" :disabled="busy" :title="resetHelp" data-mu-action="reset-section" @click="resetSection">
            <RotateCcw :size="13" aria-hidden="true" /><span>{{ resetLabel }}</span>
          </button>
        </div>
        <div v-else-if="draftSection" class="mu-scopebar mu-scopebar--common" data-mu-scopebar>
          <template v-if="editor.isRole.value">
            <p class="mu-scopebar__text">{{ t('editor.scope.commonOnlyRole', { scope: currentScopeName }) }}</p>
            <button type="button" class="mu-btn" data-mu-action="open-common" @click="requestScope({ kind: 'global' })">{{ t('editor.scope.openCommon') }}</button>
          </template>
          <template v-else>
            <p class="mu-scopebar__text">{{ t('editor.scope.commonOnly') }}</p>
            <button v-if="canReset" type="button" class="mu-link-btn mu-scopebar__reset" :disabled="busy" :title="resetHelp" data-mu-action="reset-section" @click="resetSection">
              <RotateCcw :size="13" aria-hidden="true" /><span>{{ resetLabel }}</span>
            </button>
          </template>
        </div>

        <div v-if="offer !== null" class="mu-note mu-note--info mu-editor__notice" role="status" data-mu-restore>
          <History :size="16" aria-hidden="true" />
          <span>{{ offerText }}</span>
          <span class="mu-note__actions">
            <button type="button" class="mu-btn" data-mu-action="restore-drop" @click="dropOffered">{{ t('editor.restore.drop') }}</button>
            <button type="button" class="mu-btn mu-btn--primary" data-mu-action="restore-draft" @click="restoreOffered">{{ t('editor.restore.restore') }}</button>
          </span>
        </div>
        <div v-if="notice !== null" class="mu-note mu-editor__notice" :class="`mu-note--${notice.kind}`" role="status" data-mu-notice>
          <span>{{ notice.text }}<template v-if="notice.fields.length > 0"> {{ t('editor.restore.overlap', { fields: notice.fields.join(', ') }) }}</template></span>
          <button type="button" class="mu-link-btn" @click="notice = null">{{ t('editor.restore.ok') }}</button>
        </div>

        <TabsContent value="enable" class="mu-editor__panel">
          <EnableSection v-if="!editor.isRole.value" :editor="editor" :problems="problems" />
        </TabsContent>
        <TabsContent value="appearance" class="mu-editor__panel">
          <AppearanceSection :editor="editor" :problems="problems" :bootstrap="bootstrap" />
        </TabsContent>
        <TabsContent value="menu" class="mu-editor__panel">
          <MenuSection :editor="editor" :problems="problems" :locale="themeLocale" />
        </TabsContent>
        <TabsContent value="access" class="mu-editor__panel">
          <AccessSection v-if="!editor.isRole.value" :editor="editor" :problems="problems" @open-role="openRole" @changed="reload" />
        </TabsContent>
        <TabsContent value="compatibility" class="mu-editor__panel">
          <CompatibilitySection :editor="editor" :problems="problems" />
        </TabsContent>
        <TabsContent value="transfer" class="mu-editor__panel">
          <TransferSection :dirty="editor.dirty.value" @imported="reload" />
        </TabsContent>
        <TabsContent value="maintenance" class="mu-editor__panel" force-mount>
          <MaintenanceSection />
        </TabsContent>
      </div>
    </TabsRoot>

    <div class="mu-editor__footer" role="region" :aria-label="t('editor.toolbar.label')" data-mu-footer>
      <p class="mu-editor__state" role="status" aria-live="polite" :title="status?.text ?? ''">
        <span v-if="status" :class="`mu-text-${status.kind}`" data-mu-status>{{ status.text }}</span>
        <span v-else-if="editor.dirty.value" class="mu-text-warning" data-mu-dirty>{{ t('editor.toolbar.unsaved', { scope: currentScopeName, n: editor.changes.value }, editor.changes.value) }}</span>
        <span v-else class="mu-text-muted">{{ t('editor.toolbar.clean', { scope: currentScopeName }) }}</span>
      </p>
      <div class="mu-editor__actions">
        <button type="button" class="mu-btn" :disabled="busy || !editor.dirty.value" data-mu-action="cancel" @click="cancel">
          <Undo2 :size="14" aria-hidden="true" /><span>{{ t('editor.toolbar.cancel') }}</span>
        </button>
        <button type="button" class="mu-btn mu-btn--primary mu-btn--save" :disabled="busy || !editor.dirty.value" data-mu-action="save" @click="save()">
          <Save :size="14" aria-hidden="true" /><span>{{ busy ? t('editor.toolbar.saving') : t('editor.toolbar.save') }}</span>
        </button>
      </div>
    </div>

    <ConflictDialog v-if="conflict" :conflict="conflict" @rebase="rebaseOnCurrent" @load="loadCurrent" @overwrite="overwrite" @close="conflict = null" />
    <LeaveDraftDialog
      v-if="pendingScope !== null" :from="currentScopeName" :to="scopeName(pendingScope)" :changes="editor.changes.value" :busy="busy"
      @save="leaveWithSave" @discard="leaveWithoutSave" @stay="pendingScope = null"
    />
    <ConfirmDialog />
  </div>
</template>
