<script setup lang="ts">
/**
 * Menu (docs/settings.md §6): groups and their items, order, labels in RU/EN/DE, icons, hidden modules, favorites and
 * the compact state. Order by drag and drop and by buttons and keys (Alt+↑/↓ moves, Enter edits, Delete hides with
 * undo). Hiding only takes an item out of the menu of the theme: permissions and direct links stay as Vtiger has them.
 * Modules that are not placed appear by themselves (in the group of their app or in "Other modules"). The preview is
 * built by the server with the permissions of this administrator; nothing is saved by it.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Pencil, Plus, Trash2 } from '@lucide/vue'
import type { Menu, ModuleIcon as ModuleIconData } from '../../api/types'
import { ApiError } from '../../api/guards'
import { THEME_LOCALES, type ThemeLocale } from '../../i18n/locale'
import { cloneGroups, freshId, itemKey, mentionedModules, parseGroups, type GroupConfig, type ItemConfig } from '../../menu/config'
import { ICON_COMPONENTS, type MenuIconName } from '../../menu/icons'
import { resolveLabel } from '../../menu/labels'
import MenuPanel from '../../menu/MenuPanel.vue'
import ModuleIcon from '../../menu/ModuleIcon.vue'
import { previewMenu } from '../api'
import { same, type Editor } from '../state'
import type { CatalogModule, Problem, Values } from '../types'
import ItemDialog from '../components/ItemDialog.vue'
import type { ItemDialogValue } from '../dialogs'
import ScopedField from '../components/ScopedField.vue'
import { pathLabel } from '../fields'

const props = defineProps<{ editor: Editor; problems: readonly Problem[]; locale: ThemeLocale }>()

const { t } = useI18n()
const APPS = ['MARKETING', 'SALES', 'INVENTORY', 'SUPPORT', 'PROJECT', 'TOOLS'] as const
/** Default icons of the groups of the v7 apps (ModernUI_Menu_Model::$apps). */
const APP_ICONS: Readonly<Record<string, MenuIconName>> = {
  MARKETING: 'megaphone', SALES: 'target', INVENTORY: 'package', SUPPORT: 'life-buoy', PROJECT: 'briefcase', TOOLS: 'wrench',
}

function groupIcon(group: GroupConfig): MenuIconName {
  return group.icon ?? (group.source !== undefined ? APP_ICONS[group.source.app] : undefined) ?? 'layout-grid'
}

const catalog = computed(() => new Map(props.editor.data.value.catalog.modules.map((module) => [module.module, module])))
const sortedCatalog = computed(() => [...props.editor.data.value.catalog.modules].sort((a, b) => a.label.localeCompare(b.label)))
const ownMenu = computed(() => !props.editor.isRole.value || props.editor.has('navigation.groups') || props.editor.has('navigation.hidden'))
const readonly = computed(() => !ownMenu.value)
const configured = computed(() => Array.isArray(props.editor.effective('navigation.groups')))

function load(): GroupConfig[] {
  return parseGroups(props.editor.effective('navigation.groups')) ?? cloneGroups(props.editor.data.value.catalog.defaultGroups)
}

const groups = ref<GroupConfig[]>(load())
watch(() => props.editor.effective('navigation.groups'), () => {
  const next = load()
  if (!same(next, groups.value)) {
    groups.value = next
  }
}, { deep: true })

function commit(): void {
  props.editor.set('navigation.groups', cloneGroups(groups.value))
}

const hidden = computed<string[]>(() => {
  const value = props.editor.effective('navigation.hidden')
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
})

function setHidden(list: string[]): void {
  props.editor.set('navigation.hidden', list)
}

const mentioned = computed(() => mentionedModules(groups.value))

// ---- Labels in the editor language ----
function appLabel(app: string): string {
  return (APPS as readonly string[]).includes(app) ? t(`menu.apps.${app}`) : app
}

function groupLabel(group: GroupConfig): string {
  const system = group.source !== undefined ? appLabel(group.source.app) : group.id === 'other' ? t('menu.otherGroup') : null
  return resolveLabel(group.label, props.locale, system) ?? group.id
}

function itemLabel(item: ItemConfig): string {
  if (item.type === 'route') {
    return resolveLabel(item.label, props.locale, null) ?? item.id
  }
  return resolveLabel(item.label, props.locale, catalog.value.get(item.module)?.label ?? item.module) ?? item.module
}

function iconFor(item: ItemConfig): ModuleIconData {
  const module = item.type === 'module' && item.icon === null ? catalog.value.get(item.module) : undefined
  return module !== undefined ? module.icon : { kind: 'lucide', name: item.icon ?? 'link' }
}

// ---- Role profile: own menu or the common one ----
function useOwnMenu(): void {
  props.editor.set('navigation.groups', cloneGroups(groups.value))
  props.editor.set('navigation.hidden', [...hidden.value])
}

function useCommonMenu(): void {
  props.editor.set('navigation.groups', undefined)
  props.editor.set('navigation.hidden', undefined)
}

function useCrmMenu(): void {
  if (window.confirm(t('editor.menu.crmMenuConfirm'))) {
    props.editor.set('navigation.groups', props.editor.isRole.value ? cloneGroups(props.editor.data.value.catalog.defaultGroups) : undefined)
  }
}

// ---- Moving ----
async function focusRow(key: string): Promise<void> {
  await nextTick()
  document.querySelector<HTMLElement>(`[data-mu-row="${CSS.escape(key)}"]`)?.focus()
}

function moveItem(groupIndex: number, index: number, delta: number): void {
  const items = groups.value[groupIndex]?.items
  const target = index + delta
  if (items === undefined || target < 0 || target >= items.length) {
    return
  }
  const [item] = items.splice(index, 1)
  if (item === undefined) {
    return
  }
  items.splice(target, 0, item)
  commit()
  void focusRow(`${groups.value[groupIndex]?.id ?? ''}/${itemKey(item)}`)
}

function moveItemTo(groupIndex: number, index: number, targetIndex: number): void {
  const source = groups.value[groupIndex]
  const target = groups.value[targetIndex]
  const item = source?.items[index]
  if (source === undefined || target === undefined || item === undefined || groupIndex === targetIndex) {
    return
  }
  source.items.splice(index, 1)
  if (!target.items.some((entry) => itemKey(entry) === itemKey(item))) {
    target.items.push(item)
  }
  commit()
  status.value = t('editor.menu.moved', { item: itemLabel(item), group: groupLabel(target) })
}

function moveGroup(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= groups.value.length) {
    return
  }
  const [group] = groups.value.splice(index, 1)
  if (group !== undefined) {
    groups.value.splice(target, 0, group)
    commit()
    void focusRow(`group/${group.id}`)
  }
}

/** After drag and drop: a module may be once per group only. */
function afterDrag(): void {
  for (const group of groups.value) {
    const seen = new Set<string>()
    group.items = group.items.filter((item) => {
      const key = itemKey(item)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }
  commit()
}

// ---- Hiding (with undo), removing ----
const status = ref<string | null>(null)
const undo = ref<{ module: string; label: string } | null>(null)

function hide(module: string, label: string): void {
  if (!hidden.value.includes(module)) {
    setHidden([...hidden.value, module])
  }
  undo.value = { module, label }
  status.value = null
}

function show(module: string): void {
  setHidden(hidden.value.filter((entry) => entry !== module))
  if (undo.value?.module === module) {
    undo.value = null
  }
}

function undoHide(): void {
  if (undo.value !== null) {
    show(undo.value.module)
    status.value = t('editor.menu.restored')
  }
}

function removeItem(groupIndex: number, index: number): void {
  groups.value[groupIndex]?.items.splice(index, 1)
  commit()
}

function removeGroup(index: number): void {
  const group = groups.value[index]
  if (group !== undefined && window.confirm(t('editor.menu.removeGroupConfirm', { group: groupLabel(group) }))) {
    groups.value.splice(index, 1)
    commit()
  }
}

function onItemKey(event: KeyboardEvent, groupIndex: number, index: number, item: ItemConfig): void {
  if (readonly.value) {
    return
  }
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    moveItem(groupIndex, index, event.key === 'ArrowUp' ? -1 : 1)
  } else if (event.key === 'Enter' && event.target === event.currentTarget) {
    event.preventDefault()
    editItem(groupIndex, index)
  } else if (event.key === 'Delete' && item.type === 'module' && event.target === event.currentTarget) {
    event.preventDefault()
    hide(item.module, itemLabel(item))
  }
}

function onGroupKey(event: KeyboardEvent, index: number): void {
  if (!readonly.value && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.target === event.currentTarget) {
    event.preventDefault()
    moveGroup(index, event.key === 'ArrowUp' ? -1 : 1)
  }
}

// ---- Modules outside the configuration ----
function autoTarget(module: CatalogModule): string {
  const target = groups.value.find((group) => group.source !== undefined && module.apps.includes(group.source.app))
  return target !== undefined ? groupLabel(target) : t('menu.otherGroup')
}

const notPlaced = computed(() => sortedCatalog.value.filter((module) => !mentioned.value.has(module.module) && !hidden.value.includes(module.module) && !module.defaultHidden))
const hiddenModules = computed(() => {
  const list = sortedCatalog.value.filter((module) => hidden.value.includes(module.module) || (module.defaultHidden && !mentioned.value.has(module.module)))
  return list.map((module) => ({ module, explicit: hidden.value.includes(module.module) }))
})
const unknownHidden = computed(() => hidden.value.filter((module) => !catalog.value.has(module)))
const addTarget = ref<Record<string, number>>({})

function addToGroup(module: string): void {
  const index = addTarget.value[module] ?? 0
  const group = groups.value[index]
  if (group === undefined) {
    return
  }
  if (!group.items.some((item) => item.type === 'module' && item.module === module)) {
    group.items.push({ type: 'module', module, label: null, icon: null })
  }
  commit()
  if (hidden.value.includes(module)) {
    show(module)
  }
  status.value = t('editor.menu.added', { item: catalog.value.get(module)?.label ?? module, group: groupLabel(group) })
}

// ---- Dialogs ----
const dialog = ref<{ title: string; value: ItemDialogValue; apply: (value: ItemDialogValue) => void } | null>(null)

function routeIds(): Set<string> {
  const ids = new Set<string>()
  for (const group of groups.value) {
    for (const item of group.items) {
      if (item.type === 'route') {
        ids.add(item.id)
      }
    }
  }
  return ids
}

function editGroup(index: number): void {
  const group = groups.value[index]
  if (group === undefined) {
    return
  }
  const system = group.source !== undefined ? appLabel(group.source.app) : group.id === 'other' ? t('menu.otherGroup') : null
  dialog.value = {
    title: t('editor.menu.editGroup', { group: groupLabel(group) }),
    value: { kind: 'group', label: group.label, icon: group.icon, placeholder: system },
    apply: (value) => {
      if (value.kind === 'group') {
        group.label = value.label
        group.icon = value.icon
        commit()
      }
    },
  }
}

function addGroup(): void {
  dialog.value = {
    title: t('editor.menu.addGroup'),
    value: { kind: 'group', label: null, icon: 'layout-grid', placeholder: null },
    apply: (value) => {
      if (value.kind === 'group') {
        const id = freshId('group', new Set(groups.value.map((group) => group.id)))
        groups.value.push({ id, label: value.label ?? { '*': t('editor.menu.newGroup') }, icon: value.icon, collapsed: false, items: [] })
        commit()
        void focusRow(`group/${id}`)
      }
    },
  }
}

function editItem(groupIndex: number, index: number): void {
  const item = groups.value[groupIndex]?.items[index]
  if (item === undefined) {
    return
  }
  if (item.type === 'module') {
    dialog.value = {
      title: t('editor.menu.editItem', { item: itemLabel(item) }),
      value: { kind: 'module', module: item.module, label: item.label, icon: item.icon, placeholder: catalog.value.get(item.module)?.label ?? item.module },
      apply: (value) => {
        if (value.kind === 'module') {
          item.label = value.label
          item.icon = value.icon
          commit()
        }
      },
    }
    return
  }
  dialog.value = {
    title: t('editor.menu.editItem', { item: itemLabel(item) }),
    value: { kind: 'route', module: item.route.module, view: item.route.view, viewname: item.route.params?.viewname ?? '', label: item.label, icon: item.icon },
    apply: (value) => {
      if (value.kind === 'route' && value.label !== null) {
        item.label = value.label
        item.icon = value.icon
        item.route = { module: value.module, view: value.view, params: value.viewname !== '' ? { ...(item.route.params ?? {}), viewname: value.viewname } : null }
        commit()
      }
    },
  }
}

function addRoute(groupIndex: number): void {
  const first = sortedCatalog.value[0]
  dialog.value = {
    title: t('editor.menu.addRoute'),
    value: { kind: 'route', module: first?.module ?? '', view: 'List', viewname: '', label: null, icon: 'link' },
    apply: (value) => {
      const group = groups.value[groupIndex]
      if (value.kind === 'route' && value.label !== null && group !== undefined) {
        group.items.push({
          type: 'route', id: freshId('link', routeIds()), label: value.label, icon: value.icon,
          route: { module: value.module, view: value.view, params: value.viewname !== '' ? { viewname: value.viewname } : null },
        })
        commit()
      }
    },
  }
}

function applyDialog(value: ItemDialogValue): void {
  dialog.value?.apply(value)
  dialog.value = null
}

// ---- Preview (server, permissions of this administrator) ----
const previewLocale = ref<ThemeLocale>(props.locale)
const preview = ref<{ menu: Pick<Menu, 'groups' | 'favorites' | 'favoritesEnabled' | 'compact'>; unknown: string[] } | null>(null)
const previewError = ref<string | null>(null)
const previewBusy = ref(false)
let timer: number | undefined

function previewValues(): Values {
  const values: Values = {
    'navigation.hidden': hidden.value,
    'navigation.favoritesEnabled': props.editor.effective('navigation.favoritesEnabled') !== false,
    'navigation.compact': props.editor.effective('navigation.compact') === true,
  }
  if (configured.value || props.editor.isRole.value) {
    values['navigation.groups'] = groups.value
  }
  return values
}

async function refreshPreview(): Promise<void> {
  previewBusy.value = true
  try {
    const result = await previewMenu(previewValues(), previewLocale.value)
    preview.value = { menu: result.menu, unknown: result.unknownModules }
    previewError.value = null
  } catch (error) {
    previewError.value = t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`)
  } finally {
    previewBusy.value = false
  }
}

watch([() => JSON.stringify(previewValues()), previewLocale], () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    void refreshPreview()
  }, 500)
}, { immediate: true })

onBeforeUnmount(() => {
  window.clearTimeout(timer)
})

const menuErrors = computed(() => props.problems.filter((problem) => problem.key === 'navigation.groups' || problem.key === 'navigation.hidden'))
</script>

<template>
  <div class="mu-section" data-mu-section="menu">
    <p class="mu-help">{{ t('editor.menu.intro') }}</p>

    <div v-if="editor.isRole.value" class="mu-note">
      <template v-if="ownMenu">
        <span>{{ t('editor.menu.roleOwn') }}</span>
        <button type="button" class="mu-btn" data-mu-action="menu-common" @click="useCommonMenu">{{ t('editor.menu.useCommon') }}</button>
      </template>
      <template v-else>
        <span>{{ t('editor.menu.roleCommon') }}</span>
        <button type="button" class="mu-btn" data-mu-action="menu-own" @click="useOwnMenu">{{ t('editor.menu.useOwn') }}</button>
      </template>
    </div>
    <div v-else class="mu-note">
      <span>{{ configured ? t('editor.menu.configured') : t('editor.menu.crmMenu') }}</span>
      <button v-if="configured" type="button" class="mu-btn" data-mu-action="menu-crm" @click="useCrmMenu">{{ t('editor.menu.useCrm') }}</button>
    </div>

    <p v-for="error in menuErrors" :key="error.path" class="mu-field__error" role="alert">{{ t(`errors.${error.code}`) }} ({{ pathLabel(t, error.path) }})</p>
    <p class="mu-visually-hidden" role="status" aria-live="polite">{{ status }}</p>
    <div v-if="undo !== null" class="mu-note mu-note--info" role="status" data-mu-undo>
      <span>{{ t('editor.menu.hidden', { item: undo.label }) }}</span>
      <button type="button" class="mu-btn" data-mu-action="undo-hide" @click="undoHide">{{ t('editor.menu.undo') }}</button>
    </div>
    <p v-else-if="status !== null" class="mu-help" data-mu-menu-status>{{ status }}</p>

    <div class="mu-menu-editor">
      <div class="mu-menu-editor__tree">
        <p class="mu-help">{{ t('editor.menu.keys') }}</p>
        <VueDraggable v-model="groups" :disabled="readonly" handle=".mu-group__drag" :animation="150" class="mu-groups" @end="commit">
          <section v-for="(group, groupIndex) in groups" :key="group.id" class="mu-group" :data-mu-group="group.id">
            <header class="mu-group__header" tabindex="0" :data-mu-row="`group/${group.id}`" :aria-label="t('editor.menu.groupAria', { group: groupLabel(group), count: group.items.length })" @keydown="onGroupKey($event, groupIndex)">
              <span v-if="!readonly" class="mu-group__drag mu-drag" :title="t('editor.menu.drag')" aria-hidden="true"><GripVertical :size="16" /></span>
              <component :is="ICON_COMPONENTS[groupIcon(group)]" :size="16" aria-hidden="true" />
              <span class="mu-group__label" :title="groupLabel(group)">{{ groupLabel(group) }}</span>
              <span class="mu-badge">{{ t('editor.menu.itemsCount', group.items.length) }}</span>
              <span v-if="!readonly" class="mu-row-actions">
                <button type="button" class="mu-icon-btn" :disabled="groupIndex === 0" :aria-label="t('editor.menu.up', { name: groupLabel(group) })" :title="t('editor.menu.upShort')" @click="moveGroup(groupIndex, -1)"><ArrowUp :size="14" /></button>
                <button type="button" class="mu-icon-btn" :disabled="groupIndex === groups.length - 1" :aria-label="t('editor.menu.down', { name: groupLabel(group) })" :title="t('editor.menu.downShort')" @click="moveGroup(groupIndex, 1)"><ArrowDown :size="14" /></button>
                <button type="button" class="mu-icon-btn" :aria-label="t('editor.menu.editGroup', { group: groupLabel(group) })" :title="t('editor.menu.edit')" data-mu-action="edit-group" @click="editGroup(groupIndex)"><Pencil :size="14" /></button>
                <button type="button" class="mu-icon-btn" :aria-label="t('editor.menu.removeGroup', { group: groupLabel(group) })" :title="t('editor.menu.remove')" @click="removeGroup(groupIndex)"><Trash2 :size="14" /></button>
              </span>
            </header>
            <VueDraggable v-model="group.items" :disabled="readonly" group="mu-menu-items" handle=".mu-item__drag" :animation="150" tag="ul" class="mu-items" @end="afterDrag">
              <li
                v-for="(item, index) in group.items" :key="itemKey(item)" class="mu-item"
                :class="{ 'mu-item--hidden': item.type === 'module' && hidden.includes(item.module), 'mu-item--unknown': item.type === 'module' && !catalog.has(item.module) }"
                tabindex="0" :data-mu-row="`${group.id}/${itemKey(item)}`" :data-mu-item="itemKey(item)"
                :aria-label="t('editor.menu.itemAria', { item: itemLabel(item), position: index + 1, count: group.items.length })"
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Enter Delete" @keydown="onItemKey($event, groupIndex, index, item)"
              >
                <span v-if="!readonly" class="mu-item__drag mu-drag" :title="t('editor.menu.drag')" aria-hidden="true"><GripVertical :size="14" /></span>
                <ModuleIcon :icon="iconFor(item)" :size="15" />
                <span class="mu-item__label" :title="itemLabel(item)">{{ itemLabel(item) }}</span>
                <span v-if="item.type === 'route'" class="mu-badge">{{ t('editor.menu.routeBadge') }}</span>
                <span v-if="item.type === 'module' && !catalog.has(item.module)" class="mu-badge mu-badge--warning">{{ t('editor.menu.notInCrm') }}</span>
                <span v-if="item.type === 'module' && hidden.includes(item.module)" class="mu-badge">{{ t('editor.menu.hiddenBadge') }}</span>
                <span v-if="!readonly" class="mu-row-actions">
                  <button type="button" class="mu-icon-btn" :disabled="index === 0" :aria-label="t('editor.menu.up', { name: itemLabel(item) })" :title="t('editor.menu.upShort')" data-mu-action="item-up" @click="moveItem(groupIndex, index, -1)"><ArrowUp :size="14" /></button>
                  <button type="button" class="mu-icon-btn" :disabled="index === group.items.length - 1" :aria-label="t('editor.menu.down', { name: itemLabel(item) })" :title="t('editor.menu.downShort')" data-mu-action="item-down" @click="moveItem(groupIndex, index, 1)"><ArrowDown :size="14" /></button>
                  <select v-if="groups.length > 1" class="mu-select mu-select--small" :aria-label="t('editor.menu.toGroup', { name: itemLabel(item) })" data-mu-action="item-move" @change="moveItemTo(groupIndex, index, Number(($event.target as HTMLSelectElement).value)); ($event.target as HTMLSelectElement).value = ''">
                    <option value="">{{ t('editor.menu.toGroupShort') }}</option>
                    <option v-for="(target, targetIndex) in groups" :key="target.id" :value="targetIndex" :disabled="targetIndex === groupIndex">{{ groupLabel(target) }}</option>
                  </select>
                  <button type="button" class="mu-icon-btn" :aria-label="t('editor.menu.editItem', { item: itemLabel(item) })" :title="t('editor.menu.edit')" data-mu-action="item-edit" @click="editItem(groupIndex, index)"><Pencil :size="14" /></button>
                  <template v-if="item.type === 'module' && catalog.has(item.module)">
                    <button v-if="hidden.includes(item.module)" type="button" class="mu-icon-btn" :aria-label="t('editor.menu.show', { item: itemLabel(item) })" :title="t('editor.menu.showShort')" data-mu-action="item-show" @click="show(item.module)"><Eye :size="14" /></button>
                    <button v-else type="button" class="mu-icon-btn" :aria-label="t('editor.menu.hide', { item: itemLabel(item) })" :title="t('editor.menu.hideShort')" data-mu-action="item-hide" @click="hide(item.module, itemLabel(item))"><EyeOff :size="14" /></button>
                  </template>
                  <button v-else type="button" class="mu-icon-btn" :aria-label="t('editor.menu.removeItem', { item: itemLabel(item) })" :title="t('editor.menu.remove')" data-mu-action="item-remove" @click="removeItem(groupIndex, index)"><Trash2 :size="14" /></button>
                </span>
              </li>
            </VueDraggable>
            <p v-if="group.items.length === 0" class="mu-help mu-group__empty">{{ t('editor.menu.emptyGroup') }}</p>
            <button v-if="!readonly" type="button" class="mu-link-btn" data-mu-action="add-route" @click="addRoute(groupIndex)"><Plus :size="14" aria-hidden="true" /> {{ t('editor.menu.addRoute') }}</button>
          </section>
        </VueDraggable>
        <button v-if="!readonly" type="button" class="mu-btn" data-mu-action="add-group" :disabled="groups.length >= 30" @click="addGroup"><Plus :size="14" aria-hidden="true" /><span>{{ t('editor.menu.addGroup') }}</span></button>

        <h3 class="mu-section__heading">{{ t('editor.menu.notPlacedTitle') }}</h3>
        <p class="mu-help">{{ t('editor.menu.notPlacedHelp') }}</p>
        <ul v-if="notPlaced.length > 0" class="mu-plain-list" data-mu-list="not-placed">
          <li v-for="module in notPlaced" :key="module.module" :data-mu-module="module.module">
            <ModuleIcon :icon="module.icon" :size="15" />
            <span class="mu-item__label">{{ module.label }}</span>
            <span class="mu-help">{{ t('editor.menu.autoIn', { group: autoTarget(module) }) }}</span>
            <template v-if="!readonly && groups.length > 0">
              <select class="mu-select mu-select--small" :value="addTarget[module.module] ?? 0" :aria-label="t('editor.menu.addTo', { item: module.label })" @change="addTarget[module.module] = Number(($event.target as HTMLSelectElement).value)">
                <option v-for="(group, index) in groups" :key="group.id" :value="index">{{ groupLabel(group) }}</option>
              </select>
              <button type="button" class="mu-btn mu-btn--small" data-mu-action="place" @click="addToGroup(module.module)">{{ t('editor.menu.place') }}</button>
              <button type="button" class="mu-icon-btn" :aria-label="t('editor.menu.hide', { item: module.label })" :title="t('editor.menu.hideShort')" @click="hide(module.module, module.label)"><EyeOff :size="14" /></button>
            </template>
          </li>
        </ul>
        <p v-else class="mu-help">{{ t('editor.menu.allPlaced') }}</p>

        <h3 class="mu-section__heading">{{ t('editor.menu.hiddenTitle') }}</h3>
        <p class="mu-help">{{ t('editor.menu.hiddenHelp') }}</p>
        <ul v-if="hiddenModules.length > 0 || unknownHidden.length > 0" class="mu-plain-list" data-mu-list="hidden">
          <li v-for="entry in hiddenModules" :key="entry.module.module" :data-mu-module="entry.module.module">
            <ModuleIcon :icon="entry.module.icon" :size="15" />
            <span class="mu-item__label">{{ entry.module.label }}</span>
            <span v-if="!entry.explicit" class="mu-help">{{ t('editor.menu.hiddenByCrm') }}</span>
            <template v-if="!readonly">
              <button v-if="entry.explicit && mentioned.has(entry.module.module)" type="button" class="mu-btn mu-btn--small" data-mu-action="unhide" @click="show(entry.module.module)">{{ t('editor.menu.showShort') }}</button>
              <template v-else>
                <select class="mu-select mu-select--small" :value="addTarget[entry.module.module] ?? 0" :aria-label="t('editor.menu.addTo', { item: entry.module.label })" @change="addTarget[entry.module.module] = Number(($event.target as HTMLSelectElement).value)">
                  <option v-for="(group, index) in groups" :key="group.id" :value="index">{{ groupLabel(group) }}</option>
                </select>
                <button type="button" class="mu-btn mu-btn--small" data-mu-action="unhide" @click="addToGroup(entry.module.module)">{{ t('editor.menu.place') }}</button>
              </template>
            </template>
          </li>
          <li v-for="module in unknownHidden" :key="module">
            <span class="mu-item__label">{{ module }}</span>
            <span class="mu-badge mu-badge--warning">{{ t('editor.menu.notInCrm') }}</span>
            <button v-if="!readonly" type="button" class="mu-icon-btn" :aria-label="t('editor.menu.removeItem', { item: module })" @click="show(module)"><Trash2 :size="14" /></button>
          </li>
        </ul>
        <p v-else class="mu-help">{{ t('editor.menu.noHidden') }}</p>

        <h3 class="mu-section__heading">{{ t('editor.menu.favoritesTitle') }}</h3>
        <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="navigation.favoritesEnabled" :problems="problems" :legend="t('fields.navigation_favoritesEnabled')">
          <label class="mu-check"><input type="checkbox" :checked="value !== false" :disabled="disabled" data-mu-field="favorites-enabled" @change="update(($event.target as HTMLInputElement).checked)" /><span>{{ t('fields.navigation_favoritesEnabled') }}</span></label>
        </ScopedField>
        <ScopedField v-slot="{ value, disabled, update }" :editor="editor" field="navigation.compact" :problems="problems" :legend="t('fields.navigation_compact')">
          <label class="mu-check"><input type="checkbox" :checked="value === true" :disabled="disabled" data-mu-field="compact" @change="update(($event.target as HTMLInputElement).checked)" /><span>{{ t('fields.navigation_compact') }}</span></label>
        </ScopedField>
        <p class="mu-help">{{ t('editor.menu.favoritesHelp') }}</p>
      </div>

      <aside class="mu-menu-editor__preview" :aria-label="t('editor.menu.previewTitle')">
        <div class="mu-menu-editor__preview-head">
          <h3 class="mu-section__heading">{{ t('editor.menu.previewTitle') }}</h3>
          <label class="mu-inline-field">
            <span>{{ t('editor.menu.previewLanguage') }}</span>
            <select v-model="previewLocale" class="mu-select mu-select--small" data-mu-field="preview-locale">
              <option v-for="code in THEME_LOCALES" :key="code" :value="code">{{ t(`languages.${code}`) }}</option>
            </select>
          </label>
        </div>
        <p class="mu-help">{{ editor.isRole.value ? t('editor.menu.previewRole') : t('editor.menu.previewHelp') }}</p>
        <p v-if="previewError !== null" class="mu-field__error" role="alert">{{ previewError }}</p>
        <div class="mu-menu-editor__preview-body" :aria-busy="previewBusy" data-mu-preview="menu">
          <MenuPanel v-if="preview !== null" :menu="preview.menu" :preview="true" />
        </div>
        <p v-if="preview !== null && preview.unknown.length > 0" class="mu-help">{{ t('editor.menu.unknownModules', { modules: preview.unknown.join(', ') }) }}</p>
      </aside>
    </div>

    <ItemDialog v-if="dialog !== null" :title="dialog.title" :value="dialog.value" :modules="sortedCatalog" @save="applyDialog" @close="dialog = null" />
  </div>
</template>
