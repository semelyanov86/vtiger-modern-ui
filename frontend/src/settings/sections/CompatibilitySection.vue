<script setup lang="ts">
/**
 * Compatibility (docs/settings.md §3): screens that always open in the standard view (module, view, parent; "*" for
 * any) and the adapters of public extensions with their status on this CRM and a switch (adapters.disabled, common
 * settings only). A role adds its own screens to the common ones.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2 } from '@lucide/vue'
import type { Editor } from '../state'
import type { AdapterInfo, Problem } from '../types'
import ScopedField from '../components/ScopedField.vue'

const props = defineProps<{ editor: Editor; problems: readonly Problem[] }>()
const { t } = useI18n()

interface Screen { module: string; view: string; parent: string }
const PART = /^(\*|[A-Za-z0-9_]{0,50})$/

function screens(value: unknown): Screen[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const item = entry as Record<string, unknown>
    const text = (part: unknown): string => (typeof part === 'string' ? part : '')
    return [{ module: text(item['module']), view: text(item['view']), parent: text(item['parent']) }]
  })
}

const inheritedScreens = computed(() => (props.editor.isRole.value ? screens(props.editor.data.value.global.values['theme.excludedScreens']) : []))

function change(list: Screen[], index: number, part: keyof Screen, value: string, update: (value: unknown) => void): void {
  const next = list.map((entry) => ({ ...entry }))
  const row = next[index]
  if (row !== undefined) {
    row[part] = value.trim()
    update(next)
  }
}

const adapters = computed(() => props.editor.data.value.adapters)

function disabledIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/** Only an adapter whose extension is there and checked can be switched; the others show why they do not work. */
function switchable(adapter: AdapterInfo): boolean {
  return adapter.status === 'active' || adapter.status === 'disabled'
}

function setAdapter(value: unknown, id: string, on: boolean, update: (value: unknown) => void): void {
  const ids = disabledIds(value).filter((entry) => entry !== id)
  update(on ? ids : [...ids, id])
}

function versions(adapter: AdapterInfo): string {
  const { min, below } = adapter.versions
  if (min !== null && below !== null) {
    return t('editor.compatibility.versionRange', { min, below })
  }
  return min !== null ? t('editor.compatibility.versionFrom', { min }) : t('editor.compatibility.versionAny')
}

/** Status shown for the draft: switching an adapter off or on is visible before saving. */
function status(adapter: AdapterInfo, value: unknown): AdapterInfo['status'] {
  if (!switchable(adapter)) {
    return adapter.status
  }
  return disabledIds(value).includes(adapter.id) ? 'disabled' : 'active'
}

function valid(screen: Screen): boolean {
  return screen.module !== '' && PART.test(screen.module) && PART.test(screen.view) && PART.test(screen.parent)
}
</script>

<template>
  <div class="mu-section" data-mu-section="compatibility">
    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('fields.theme_excludedScreens') }}</h3></header>
      <div class="mu-card__body">
        <p class="mu-help">{{ t('editor.compatibility.intro') }}</p>
        <div v-if="inheritedScreens.length > 0" class="mu-note">
          <span>{{ t('editor.compatibility.inherited') }}</span>
          <code v-for="(screen, index) in inheritedScreens" :key="index">{{ screen.module }} / {{ screen.view || '—' }} / {{ screen.parent || '—' }}</code>
        </div>
        <ScopedField v-slot="{ value, update }" :editor="editor" field="theme.excludedScreens" :problems="problems" :label="t('editor.compatibility.screensLabel')" :stacked="true">
          <div class="mu-table-scroll">
            <table class="mu-table" data-mu-table="screens">
              <caption class="mu-visually-hidden">{{ t('fields.theme_excludedScreens') }}</caption>
              <thead><tr><th scope="col">{{ t('editor.compatibility.module') }}</th><th scope="col">{{ t('editor.compatibility.view') }}</th><th scope="col">{{ t('editor.compatibility.parent') }}</th><th scope="col"><span class="mu-visually-hidden">{{ t('editor.access.actions') }}</span></th></tr></thead>
              <tbody>
                <tr v-for="(screen, index) in screens(value)" :key="index">
                  <td v-for="part in (['module', 'view', 'parent'] as const)" :key="part">
                    <input class="mu-input" type="text" maxlength="50" :value="screen[part]" :aria-label="t(`editor.compatibility.${part}`)" :aria-invalid="!valid(screen)" :data-mu-screen="`${index}-${part}`" @change="change(screens(value), index, part, ($event.target as HTMLInputElement).value, update)" />
                  </td>
                  <td class="mu-table__actions">
                    <button type="button" class="mu-icon-btn" :aria-label="t('editor.compatibility.remove', { screen: screen.module })" :title="t('editor.compatibility.remove', { screen: screen.module })" @click="update(screens(value).filter((_, position) => position !== index))"><Trash2 :size="14" /></button>
                  </td>
                </tr>
                <tr v-if="screens(value).length === 0"><td colspan="4" class="mu-table__empty">{{ t('editor.compatibility.none') }}</td></tr>
              </tbody>
            </table>
          </div>
          <p v-if="screens(value).some((screen) => !valid(screen))" class="mu-field__error" role="alert">{{ t('editor.compatibility.invalid') }}</p>
          <div class="mu-inline-actions">
            <button type="button" class="mu-btn" :disabled="screens(value).length >= 100" data-mu-action="add-screen" @click="update([...screens(value), { module: 'Reports', view: '*', parent: '' }])">
              <Plus :size="14" aria-hidden="true" /><span>{{ t('editor.compatibility.add') }}</span>
            </button>
            <span class="mu-help">{{ t('editor.compatibility.example') }}</span>
          </div>
        </ScopedField>
      </div>
    </section>

    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.compatibility.adaptersTitle') }}</h3></header>
      <div class="mu-card__body">
        <p class="mu-help">{{ t('editor.compatibility.adaptersIntro') }}</p>
        <p v-if="editor.isRole.value" class="mu-note">{{ t('editor.compatibility.adapterOnlyGlobal') }}</p>
        <ScopedField v-else v-slot="{ value, update }" :editor="editor" field="adapters.disabled" :problems="problems" :label="t('fields.adapters_disabled')" :stacked="true">
          <div class="mu-table-scroll">
            <table class="mu-table" data-mu-table="adapters">
              <caption class="mu-visually-hidden">{{ t('editor.compatibility.adaptersTitle') }}</caption>
              <thead><tr><th scope="col">{{ t('editor.compatibility.adapterColumn') }}</th><th scope="col">{{ t('editor.compatibility.adapterVersions') }}</th><th scope="col">{{ t('editor.compatibility.adapterVersion') }}</th><th scope="col">{{ t('editor.compatibility.adapterStatus') }}</th></tr></thead>
              <tbody>
                <tr v-for="adapter in adapters" :key="adapter.id" :data-mu-adapter="adapter.id" :data-mu-status="status(adapter, value)">
                  <td>
                    <label class="mu-check">
                      <input type="checkbox" :checked="status(adapter, value) === 'active'" :disabled="!switchable(adapter)" :aria-label="t('editor.compatibility.adapterOn', { name: adapter.title })" @change="setAdapter(value, adapter.id, ($event.target as HTMLInputElement).checked, update)" />
                      <span><strong>{{ adapter.title }}</strong> <span class="mu-text-muted">({{ adapter.vendor }}, {{ adapter.module }})</span></span>
                    </label>
                  </td>
                  <td>{{ versions(adapter) }}</td>
                  <td>{{ adapter.version || '—' }}</td>
                  <td><span class="mu-badge" :class="{ 'mu-badge--info': status(adapter, value) === 'active', 'mu-badge--warning': !['active', 'disabled', 'notInstalled'].includes(status(adapter, value)) }">{{ t(`editor.compatibility.status.${status(adapter, value)}`) }}</span></td>
                </tr>
                <tr v-if="adapters.length === 0"><td colspan="4" class="mu-table__empty">{{ t('editor.compatibility.adaptersNone') }}</td></tr>
              </tbody>
            </table>
          </div>
        </ScopedField>
      </div>
    </section>
  </div>
</template>
