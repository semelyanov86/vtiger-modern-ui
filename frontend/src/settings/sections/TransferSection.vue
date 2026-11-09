<script setup lang="ts">
/**
 * Transfer of the settings (docs/settings.md §9): a JSON file with the chosen parts (common settings, role profiles,
 * personal settings of users), without numeric ids, secrets, records or the logo. An import is checked first: the
 * report lists what changes, unknown users, roles and modules, filters to check, invalid values with their path; the
 * chosen parts are then applied in one transaction. The mode of the theme is applied only on request.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, FileUp } from '@lucide/vue'
import { ApiError } from '../../api/guards'
import { applyImport, exportUrl, previewImport } from '../api'
import { ask } from '../confirm'
import type { ImportReport, ReportChange } from '../types'
import { fieldLabel, pathLabel, valueText } from '../fields'

const props = defineProps<{ dirty: boolean }>()
const emit = defineEmits<{ imported: [] }>()
const { t } = useI18n()

type Part = 'global' | 'roles' | 'users'
const PARTS: readonly Part[] = ['global', 'roles', 'users']
const MAX_BYTES = 262144

const exportParts = ref<Part[]>(['global', 'roles'])
const exportHref = computed(() => exportUrl(exportParts.value))

const fileName = ref('')
const json = ref<string | null>(null)
const report = ref<ImportReport | null>(null)
const fingerprint = ref('')
const chosen = ref<Part[]>([])
const includeMode = ref(false)
const busy = ref(false)
const message = ref<{ kind: 'success' | 'error'; text: string } | null>(null)

const available = computed(() => PARTS.filter((part) => report.value?.[part] !== null && report.value !== null))
const label = fieldLabel(t)

async function choose(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  report.value = null
  message.value = null
  if (file === undefined) {
    return
  }
  fileName.value = file.name
  if (file.size > MAX_BYTES) {
    message.value = { kind: 'error', text: t('errors.MU_IMPORT_TOO_LARGE') }
    return
  }
  busy.value = true
  try {
    json.value = await file.text()
    const result = await previewImport(json.value)
    report.value = result.report
    fingerprint.value = result.fingerprint
    chosen.value = PARTS.filter((part) => result.report[part] !== null)
    includeMode.value = false
  } catch (error) {
    message.value = { kind: 'error', text: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }
  } finally {
    busy.value = false
  }
}

async function apply(): Promise<void> {
  if (json.value === null || chosen.value.length === 0) {
    return
  }
  const ok = await ask({
    title: t('editor.transfer.applyTitle'), text: t('editor.transfer.applyConfirm'),
    confirm: t('editor.transfer.apply'), cancel: t('editor.dialog.cancel'),
  })
  if (!ok) {
    return
  }
  busy.value = true
  try {
    await applyImport(json.value, chosen.value, includeMode.value, fingerprint.value)
    message.value = { kind: 'success', text: t('editor.transfer.applied') }
    report.value = null
    json.value = null
    emit('imported')
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'MU_UNKNOWN'
    message.value = { kind: 'error', text: code === 'MU_CONFLICT' ? t('editor.transfer.stale') : t(`errors.${code}`) }
  } finally {
    busy.value = false
  }
}

function changeText(change: ReportChange): string {
  return t('editor.transfer.change', { field: label(change.key), before: valueText(t, change.before), after: valueText(t, change.after) })
}
</script>

<template>
  <div class="mu-section" data-mu-section="transfer">
    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.transfer.exportTitle') }}</h3></header>
      <div class="mu-card__body">
        <p class="mu-help">{{ t('editor.transfer.exportHelp') }}</p>
        <fieldset class="mu-choice">
          <legend class="mu-field__label">{{ t('editor.transfer.parts') }}</legend>
          <label v-for="part in PARTS" :key="part" class="mu-check">
            <input v-model="exportParts" type="checkbox" :value="part" :data-mu-export="part" />
            <span>{{ t(`editor.transfer.part.${part}`) }}</span>
          </label>
        </fieldset>
        <p v-if="exportParts.includes('users')" class="mu-help">{{ t('editor.transfer.usersNote') }}</p>
        <a v-if="exportParts.length > 0" class="mu-btn" :href="exportHref" download data-mu-action="export"><Download :size="14" aria-hidden="true" /><span>{{ t('editor.transfer.download') }}</span></a>
      </div>
    </section>

    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.transfer.importTitle') }}</h3></header>
      <div class="mu-card__body">
        <p class="mu-help">{{ t('editor.transfer.importHelp') }}</p>
        <p v-if="props.dirty" class="mu-note mu-note--warning">{{ t('editor.transfer.dirty') }}</p>
        <label class="mu-btn mu-file">
          <FileUp :size="14" aria-hidden="true" />
          <span>{{ busy ? t('editor.transfer.checking') : t('editor.transfer.choose') }}</span>
          <input type="file" accept="application/json,.json" :disabled="busy" data-mu-field="import-file" @change="choose" />
        </label>
        <p v-if="message !== null" :class="`mu-text-${message.kind}`" role="status" data-mu-import-message>{{ message.text }}</p>

        <div v-if="report !== null" class="mu-report" data-mu-report>
          <p>{{ t('editor.transfer.source', { file: fileName, module: report.source.module ?? '—', vtiger: report.source.vtiger ?? '—', date: report.source.exportedAt ?? '—' }) }}</p>

          <section v-if="report.global !== null" data-mu-report-part="global">
            <h4>{{ t('editor.transfer.part.global') }}</h4>
            <ul class="mu-report__list">
              <li v-for="change in report.global.changes" :key="change.key">{{ changeText(change) }}</li>
              <li v-if="report.global.changes.length === 0" class="mu-help">{{ t('editor.transfer.noChanges') }}</li>
            </ul>
            <p v-if="report.global.unresolvedUsers.length > 0" class="mu-text-warning">{{ t('editor.transfer.unresolvedUsers', { names: report.global.unresolvedUsers.join(', ') }) }}</p>
            <p v-if="report.global.unresolvedRoles.length > 0" class="mu-text-warning">{{ t('editor.transfer.unresolvedRoles', { names: report.global.unresolvedRoles.join('; ') }) }}</p>
            <label v-if="report.global.modeChange !== null" class="mu-check" data-mu-field="include-mode">
              <input v-model="includeMode" type="checkbox" />
              <span>{{ t('editor.transfer.includeMode', { before: t(`editor.access.mode.${report.global.modeChange.before}`), after: t(`editor.access.mode.${report.global.modeChange.after}`) }) }}</span>
            </label>
          </section>

          <section v-if="report.roles !== null" data-mu-report-part="roles">
            <h4>{{ t('editor.transfer.part.roles') }}</h4>
            <ul class="mu-report__list">
              <li v-for="role in report.roles.matched" :key="role.id">
                {{ role.exists ? t('editor.transfer.roleReplace', { role: role.name }) : t('editor.transfer.roleNew', { role: role.name }) }}
                <span class="mu-help">{{ t('editor.transfer.changes', role.changes.length) }}</span>
              </li>
            </ul>
            <p v-if="report.roles.unresolved.length > 0" class="mu-text-warning">{{ t('editor.transfer.unresolvedRoles', { names: report.roles.unresolved.join('; ') }) }}</p>
            <p v-if="report.roles.ambiguous.length > 0" class="mu-text-warning">{{ t('editor.transfer.ambiguousRoles', { names: report.roles.ambiguous.join('; ') }) }}</p>
          </section>

          <section v-if="report.users !== null" data-mu-report-part="users">
            <h4>{{ t('editor.transfer.part.users') }}</h4>
            <p>{{ t('editor.transfer.usersMatched', report.users.matched) }} {{ t('editor.transfer.usersChanged', report.users.changed) }}</p>
            <p v-if="report.users.unresolved.length > 0" class="mu-text-warning">{{ t('editor.transfer.unresolvedUsers', { names: report.users.unresolved.join(', ') }) }}</p>
          </section>

          <p v-if="report.uploadLogo" class="mu-note mu-note--info">{{ t('editor.transfer.uploadLogo') }}</p>
          <p v-if="report.unknownModules.length > 0" class="mu-text-warning">{{ t('editor.transfer.unknownModules', { modules: report.unknownModules.join(', ') }) }}</p>
          <div v-if="report.checkFilters.length > 0" class="mu-text-warning">
            <p>{{ t('editor.transfer.checkFilters') }}</p>
            <ul><li v-for="entry in report.checkFilters" :key="`${entry.scope}-${entry.id}`">{{ entry.label ?? entry.id }}</li></ul>
          </div>
          <div v-if="report.invalid.length > 0" class="mu-text-error" data-mu-report-invalid>
            <p>{{ t('editor.transfer.invalid', report.invalid.length) }}</p>
            <ul><li v-for="entry in report.invalid" :key="`${entry.part}-${entry.scope}-${entry.path}`">{{ pathLabel(t, entry.path) }} — {{ t(`errors.${entry.code}`) }}</li></ul>
          </div>

          <fieldset class="mu-choice">
            <legend class="mu-field__label">{{ t('editor.transfer.applyParts') }}</legend>
            <label v-for="part in available" :key="part" class="mu-check">
              <input v-model="chosen" type="checkbox" :value="part" :data-mu-apply="part" />
              <span>{{ t(`editor.transfer.part.${part}`) }}</span>
            </label>
          </fieldset>
          <button type="button" class="mu-btn mu-btn--primary" :disabled="busy || chosen.length === 0 || props.dirty" data-mu-action="import-apply" @click="apply">{{ t('editor.transfer.apply') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>
