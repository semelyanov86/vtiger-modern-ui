<script setup lang="ts">
/**
 * Menu (docs/settings.md §6, docs/design.md §13.12): the composition of the "Personalize" editor of the cloud — the
 * groups on the left (order by drag and drop or Alt+↑/↓), the modules of the chosen group as tiles on the right (order,
 * labels in RU/EN/DE, icons, hiding, moving to another group by dragging onto it or by the menu of the tile, Alt+↑/↓,
 * Enter edits, Delete hides with undo), a search over all modules, adding modules of the catalog and links to CRM
 * views, the modules not placed yet (they appear by themselves in the group of their app or in "Other modules") and
 * the hidden ones (also those hidden in the menu editor of the CRM), unknown modules flagged. Hiding only takes an item
 * out of the menu of the theme: permissions and direct links stay as Vtiger has them. The preview is the menu the
 * server builds from the draft with the permissions of this administrator, in a dialog; nothing is saved by it.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import {
  DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger,
} from 'reka-ui'
import {
  ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Link as LinkIcon, MoreHorizontal, Pencil, Plus, Search, Trash2, X,
} from '@lucide/vue'
import type { Menu, ModuleIcon as ModuleIconData } from '../../api/types'
import { ApiError } from '../../api/guards'
import { THEME_LOCALES, type ThemeLocale } from '../../i18n/locale'
import { cloneGroups, freshId, GROUPS_MAX, ITEMS_MAX, itemKey, mentionedModules, parseGroups, type GroupConfig, type ItemConfig } from '../../menu/config'
import { ICON_COMPONENTS, type MenuIconName } from '../../menu/icons'
import { resolveLabel } from '../../menu/labels'
import MenuPanel from '../../menu/MenuPanel.vue'
import ModuleIcon from '../../menu/ModuleIcon.vue'
import { previewMenu } from '../api'
import { ask } from '../confirm'
import { same, type Editor } from '../state'
import type { CatalogModule, Problem, Values } from '../types'
import ItemDialog from '../components/ItemDialog.vue'
import type { ItemDialogValue } from '../dialogs'
import ScopedField from '../components/ScopedField.vue'
import { pathLabel } from '../fields'
import { reorderAnimation } from '../../boot/motion'

const props = defineProps<{ editor: Editor; problems: readonly Problem[]; locale: ThemeLocale }>()

const { t } = useI18n()
const APPS = ['MARKETING', 'SALES', 'INVENTORY', 'SUPPORT', 'PROJECT', 'TOOLS'] as const
/** Default icons of the groups of the v7 apps (ModernUI_Menu_Model::$apps). */
const APP_ICONS: Readonly<Record<string, MenuIconName>> = {
  MARKETING: 'megaphone', SALES: 'target', INVENTORY: 'package', SUPPORT: 'life-buoy', PROJECT: 'briefcase', TOOLS: 'wrench',
}
const UNPLACED = '__unplaced'
const HIDDEN = '__hidden'

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

// ---- The chosen group (or the lists of modules outside the groups) ----
const selected = ref<string>(groups.value[0]?.id ?? UNPLACED)
const selectedIndex = computed(() => groups.value.findIndex((group) => group.id === selected.value))
const selectedGroup = computed(() => groups.value[selectedIndex.value] ?? null)
watch(groups, (list) => {
  if (selected.value !== UNPLACED && selected.value !== HIDDEN && !list.some((group) => group.id === selected.value)) {
    selected.value = list[0]?.id ?? UNPLACED
  }
})

function select(id: string): void {
  selected.value = id
  picker.value = false
  query.value = ''
}

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

const isHidden = (item: ItemConfig): boolean => item.type === 'module' && hidden.value.includes(item.module)
const isUnknown = (item: ItemConfig): boolean => item.type === 'module' && !catalog.value.has(item.module)

// ---- Role profile: own menu or the common one ----
function useOwnMenu(): void {
  props.editor.set('navigation.groups', cloneGroups(groups.value))
  props.editor.set('navigation.hidden', [...hidden.value])
}

function useCommonMenu(): void {
  props.editor.set('navigation.groups', undefined)
  props.editor.set('navigation.hidden', undefined)
}

async function useCrmMenu(): Promise<void> {
  const ok = await ask({ title: t('editor.menu.useCrm'), text: t('editor.menu.crmMenuConfirm'), confirm: t('editor.menu.useCrm'), cancel: t('editor.dialog.cancel') })
  if (ok) {
    props.editor.set('navigation.groups', props.editor.isRole.value ? cloneGroups(props.editor.data.value.catalog.defaultGroups) : undefined)
  }
}

// ---- Moving ----
const status = ref<string | null>(null)

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
  status.value = t('editor.menu.position', { item: itemLabel(item), position: target + 1, count: items.length })
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
    status.value = t('editor.menu.position', { item: groupLabel(group), position: target + 1, count: groups.value.length })
    void focusRow(`group/${group.id}`)
  }
}

/** After drag and drop: a module may be once per group only. */
function afterDrag(): void {
  dragging.value = false
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

// Dropping a tile on a group of the left column: the group item holds an (invisible) list that receives the tile.
const dragging = ref(false)

function receive(group: GroupConfig, list: ItemConfig[]): void {
  for (const item of list) {
    if (!group.items.some((entry) => itemKey(entry) === itemKey(item))) {
      group.items.push(item)
    }
    status.value = t('editor.menu.moved', { item: itemLabel(item), group: groupLabel(group) })
  }
}

// ---- Hiding (with undo), removing ----
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

async function removeGroup(index: number): Promise<void> {
  const group = groups.value[index]
  if (group === undefined) {
    return
  }
  const ok = await ask({
    title: t('editor.menu.removeGroup', { group: groupLabel(group) }), text: t('editor.menu.removeGroupConfirm', { group: groupLabel(group) }),
    confirm: t('editor.menu.remove'), cancel: t('editor.dialog.cancel'), danger: true,
  })
  if (ok) {
    groups.value.splice(index, 1)
    commit()
  }
}

function onItemKey(event: KeyboardEvent, groupIndex: number, index: number, item: ItemConfig): void {
  if (readonly.value || event.target !== event.currentTarget) {
    return
  }
  const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft'
  if (event.altKey && (back || event.key === 'ArrowDown' || event.key === 'ArrowRight')) {
    event.preventDefault()
    moveItem(groupIndex, index, back ? -1 : 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    editItem(groupIndex, index)
  } else if (event.key === 'Delete') {
    event.preventDefault()
    if (item.type === 'module' && catalog.value.has(item.module)) {
      hide(item.module, itemLabel(item))
    } else {
      removeItem(groupIndex, index)
    }
  }
}

function onGroupKey(event: KeyboardEvent, index: number): void {
  if (!readonly.value && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    moveGroup(index, event.key === 'ArrowUp' ? -1 : 1)
  }
}

// ---- Search over all modules ----
const query = ref('')
const normalized = computed(() => query.value.trim().toLocaleLowerCase())
interface Found { readonly key: string; readonly label: string; readonly icon: ModuleIconData; readonly where: string; readonly group: string | null; readonly item: string | null }
const found = computed<Found[]>(() => {
  const text = normalized.value
  if (text === '') {
    return []
  }
  const result: Found[] = []
  const matches = (label: string, module: string): boolean => label.toLocaleLowerCase().includes(text) || module.toLocaleLowerCase().includes(text)
  for (const group of groups.value) {
    for (const item of group.items) {
      const module = item.type === 'module' ? item.module : item.route.module
      if (matches(itemLabel(item), module)) {
        result.push({ key: `${group.id}/${itemKey(item)}`, label: itemLabel(item), icon: iconFor(item), where: groupLabel(group), group: group.id, item: itemKey(item) })
      }
    }
  }
  for (const module of sortedCatalog.value) {
    if (!mentioned.value.has(module.module) && matches(module.label, module.module)) {
      const where = hidden.value.includes(module.module) || module.defaultHidden ? t('editor.menu.hiddenTitle') : t('editor.menu.notPlacedTitle')
      result.push({ key: `free/${module.module}`, label: module.label, icon: module.icon, where, group: hidden.value.includes(module.module) || module.defaultHidden ? HIDDEN : UNPLACED, item: null })
    }
  }
  return result
})

async function reveal(entry: Found): Promise<void> {
  const target = entry.group
  query.value = ''
  if (target !== null) {
    selected.value = target
  }
  if (entry.item !== null && target !== null) {
    await focusRow(`${target}/${entry.item}`)
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

function addToGroup(module: string, index = addTarget.value[module] ?? Math.max(0, selectedIndex.value)): void {
  const group = groups.value[index]
  if (group === undefined) {
    return
  }
  if (!group.items.some((item) => item.type === 'module' && item.module === module) && group.items.length < ITEMS_MAX) {
    group.items.push({ type: 'module', module, label: null, icon: null })
  }
  commit()
  if (hidden.value.includes(module)) {
    show(module)
  }
  status.value = t('editor.menu.added', { item: catalog.value.get(module)?.label ?? module, group: groupLabel(group) })
}

// ---- Adding modules to the chosen group (the "Customize" panel of the cloud) ----
const picker = ref(false)
const pickerQuery = ref('')
const picked = ref<string[]>([])
const pickerChoices = computed(() => {
  const group = selectedGroup.value
  const text = pickerQuery.value.trim().toLocaleLowerCase()
  return sortedCatalog.value.filter((module) => group !== null && !group.items.some((item) => item.type === 'module' && item.module === module.module)
    && (text === '' || module.label.toLocaleLowerCase().includes(text) || module.module.toLocaleLowerCase().includes(text)))
})

function openPicker(): void {
  picker.value = true
  pickerQuery.value = ''
  picked.value = []
  void nextTick(() => document.querySelector<HTMLInputElement>('[data-mu-field="picker-search"]')?.focus())
}

function addPicked(): void {
  for (const module of picked.value) {
    addToGroup(module, selectedIndex.value)
  }
  picker.value = false
  picked.value = []
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
        selected.value = id
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

// ---- Preview (server, permissions of this administrator), in a dialog ----
const previewOpen = ref(false)
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

watch([() => JSON.stringify(previewValues()), previewLocale, previewOpen], () => {
  window.clearTimeout(timer)
  if (!previewOpen.value) {
    return
  }
  timer = window.setTimeout(() => {
    void refreshPreview()
  }, 150)
})

onBeforeUnmount(() => {
  window.clearTimeout(timer)
})

const menuErrors = computed(() => props.problems.filter((problem) => problem.key === 'navigation.groups' || problem.key === 'navigation.hidden'))
const stateText = computed(() => {
  if (props.editor.isRole.value) {
    return ownMenu.value ? t('editor.menu.roleOwn') : t('editor.menu.roleCommon')
  }
  return configured.value ? t('editor.menu.configured') : t('editor.menu.crmMenu')
})
</script>

<template>
  <div class="mu-section" data-mu-section="menu">
    <section class="mu-card mu-menu-card" :class="{ 'mu-menu-card--dragging': dragging }">
      <header class="mu-card__header">
        <div class="mu-card__heading">
          <h3 class="mu-card__title">{{ t('editor.menu.title') }}</h3>
          <p class="mu-card__subtitle" data-mu-menu-state>{{ stateText }}</p>
        </div>
        <div class="mu-card__tools">
          <label class="mu-search">
            <Search :size="14" aria-hidden="true" />
            <input v-model="query" class="mu-input" type="search" :placeholder="t('editor.menu.search')" :aria-label="t('editor.menu.search')" data-mu-field="module-search" />
          </label>
          <button type="button" class="mu-btn" data-mu-action="menu-preview" @click="previewOpen = true"><Eye :size="14" aria-hidden="true" /><span>{{ t('editor.menu.previewOpen') }}</span></button>
          <template v-if="editor.isRole.value">
            <button v-if="ownMenu" type="button" class="mu-btn" data-mu-action="menu-common" @click="useCommonMenu">{{ t('editor.menu.useCommon') }}</button>
            <button v-else type="button" class="mu-btn mu-btn--primary" data-mu-action="menu-own" @click="useOwnMenu">{{ t('editor.menu.useOwn') }}</button>
          </template>
          <button v-else-if="configured" type="button" class="mu-btn" data-mu-action="menu-crm" @click="useCrmMenu">{{ t('editor.menu.useCrm') }}</button>
        </div>
      </header>

      <p v-for="error in menuErrors" :key="error.path" class="mu-field__error mu-menu-card__error" role="alert">{{ t(`errors.${error.code}`) }} ({{ pathLabel(t, error.path) }})</p>
      <p class="mu-visually-hidden" role="status" aria-live="polite">{{ status }}</p>
      <div v-if="undo !== null" class="mu-note mu-note--info mu-menu-card__note" role="status" data-mu-undo>
        <span>{{ t('editor.menu.hidden', { item: undo.label }) }}</span>
        <button type="button" class="mu-btn" data-mu-action="undo-hide" @click="undoHide">{{ t('editor.menu.undo') }}</button>
      </div>

      <p class="mu-help mu-menu-card__intro">{{ t('editor.menu.intro') }}</p>
      <div class="mu-menu-editor">
        <nav class="mu-menu-groups" :aria-label="t('editor.menu.groupsTitle')">
          <p class="mu-menu-groups__caption">{{ t('editor.menu.groupsTitle') }}</p>
          <VueDraggable v-model="groups" :disabled="readonly" handle=".mu-group-item__drag" :animation="reorderAnimation()" tag="ul" class="mu-menu-groups__list" @end="commit">
            <li v-for="(group, groupIndex) in groups" :key="group.id" class="mu-group-item" :class="{ 'mu-group-item--active': selected === group.id }" :data-mu-group-item="group.id">
              <button
                type="button" class="mu-group-item__button" :aria-current="selected === group.id ? 'true' : undefined" :data-mu-row="`group/${group.id}`"
                :aria-label="t('editor.menu.groupAria', { group: groupLabel(group), count: group.items.length })" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                @click="select(group.id)" @keydown="onGroupKey($event, groupIndex)"
              >
                <span v-if="!readonly" class="mu-group-item__drag mu-drag" :title="t('editor.menu.drag')" aria-hidden="true"><GripVertical :size="14" /></span>
                <component :is="ICON_COMPONENTS[groupIcon(group)]" :size="16" class="mu-group-item__icon" aria-hidden="true" />
                <span class="mu-group-item__label">{{ groupLabel(group) }}</span>
                <span class="mu-group-item__count" :class="{ 'mu-group-item__count--empty': group.items.length === 0 }">{{ group.items.length }}</span>
              </button>
              <VueDraggable
                v-if="!readonly" class="mu-group-item__drop" :model-value="[]" :group="{ name: 'mu-menu-items', pull: false, put: true }" tag="ul"
                @update:model-value="(list: ItemConfig[]) => receive(group, list)"
              />
            </li>
          </VueDraggable>
          <button v-if="!readonly" type="button" class="mu-btn mu-btn--block mu-btn--toolbar" data-mu-action="add-group" :disabled="groups.length >= GROUPS_MAX" @click="addGroup"><Plus :size="14" aria-hidden="true" /><span>{{ t('editor.menu.addGroup') }}</span></button>
          <ul class="mu-menu-groups__list mu-menu-groups__list--other">
            <li class="mu-group-item" :class="{ 'mu-group-item--active': selected === UNPLACED }">
              <button type="button" class="mu-group-item__button" :aria-current="selected === UNPLACED ? 'true' : undefined" data-mu-action="show-unplaced" @click="select(UNPLACED)">
                <span class="mu-group-item__label">{{ t('editor.menu.notPlacedTitle') }}</span>
                <span class="mu-group-item__count" :class="{ 'mu-group-item__count--empty': notPlaced.length === 0 }">{{ notPlaced.length }}</span>
              </button>
            </li>
            <li class="mu-group-item" :class="{ 'mu-group-item--active': selected === HIDDEN }">
              <button type="button" class="mu-group-item__button" :aria-current="selected === HIDDEN ? 'true' : undefined" data-mu-action="show-hidden" @click="select(HIDDEN)">
                <span class="mu-group-item__label">{{ t('editor.menu.hiddenTitle') }}</span>
                <span class="mu-group-item__count" :class="{ 'mu-group-item__count--empty': hiddenModules.length + unknownHidden.length === 0 }">{{ hiddenModules.length + unknownHidden.length }}</span>
              </button>
            </li>
          </ul>
        </nav>

        <div class="mu-menu-panel">
          <!-- Search over all modules -->
          <template v-if="normalized !== ''">
            <h4 class="mu-menu-panel__title">{{ t('editor.menu.searchTitle', { query: query.trim() }) }}</h4>
            <ul v-if="found.length > 0" class="mu-tiles" data-mu-list="search">
              <li v-for="entry in found" :key="entry.key" class="mu-item mu-tile">
                <ModuleIcon :icon="entry.icon" :size="15" />
                <span class="mu-tile__label">{{ entry.label }}</span>
                <span class="mu-badge">{{ entry.where }}</span>
                <button type="button" class="mu-link-btn" data-mu-action="reveal" @click="reveal(entry)">{{ t('editor.menu.reveal') }}</button>
              </li>
            </ul>
            <p v-else class="mu-empty" data-mu-empty="search">{{ t('editor.menu.nothingFound') }}</p>
          </template>

          <!-- A group of the menu -->
          <section v-else-if="selectedGroup !== null" class="mu-group" :data-mu-group="selectedGroup.id">
            <header class="mu-menu-panel__head">
              <component :is="ICON_COMPONENTS[groupIcon(selectedGroup)]" :size="18" aria-hidden="true" />
              <h4 class="mu-menu-panel__title">{{ groupLabel(selectedGroup) }}</h4>
              <span class="mu-badge">{{ t('editor.menu.itemsCount', selectedGroup.items.length) }}</span>
              <span v-if="!readonly" class="mu-row-actions mu-row-actions--visible">
                <button type="button" class="mu-icon-btn" :disabled="selectedIndex === 0" :aria-label="t('editor.menu.up', { name: groupLabel(selectedGroup) })" :title="t('editor.menu.upShort')" data-mu-action="group-up" @click="moveGroup(selectedIndex, -1)"><ArrowUp :size="14" /></button>
                <button type="button" class="mu-icon-btn" :disabled="selectedIndex === groups.length - 1" :aria-label="t('editor.menu.down', { name: groupLabel(selectedGroup) })" :title="t('editor.menu.downShort')" data-mu-action="group-down" @click="moveGroup(selectedIndex, 1)"><ArrowDown :size="14" /></button>
                <button type="button" class="mu-icon-btn" :aria-label="t('editor.menu.editGroup', { group: groupLabel(selectedGroup) })" :title="t('editor.menu.edit')" data-mu-action="edit-group" @click="editGroup(selectedIndex)"><Pencil :size="14" /></button>
                <button type="button" class="mu-icon-btn" :aria-label="t('editor.menu.removeGroup', { group: groupLabel(selectedGroup) })" :title="t('editor.menu.remove')" data-mu-action="remove-group" @click="removeGroup(selectedIndex)"><Trash2 :size="14" /></button>
              </span>
            </header>
            <p v-if="!readonly" class="mu-help">{{ t('editor.menu.keys') }}</p>
            <p v-if="selectedGroup.items.length === 0" class="mu-empty" data-mu-empty="group">{{ t('editor.menu.emptyGroup') }}</p>
            <VueDraggable
              v-model="selectedGroup.items" :disabled="readonly" group="mu-menu-items" handle=".mu-tile__drag" :animation="reorderAnimation()" tag="ul" class="mu-tiles"
              @start="dragging = true" @end="afterDrag"
            >
              <li
                v-for="(item, index) in selectedGroup.items" :key="itemKey(item)" class="mu-item mu-tile"
                :class="{ 'mu-item--hidden': isHidden(item), 'mu-item--unknown': isUnknown(item) }"
                tabindex="0" :data-mu-row="`${selectedGroup.id}/${itemKey(item)}`" :data-mu-item="itemKey(item)"
                :aria-label="t('editor.menu.itemAria', { item: itemLabel(item), position: index + 1, count: selectedGroup.items.length })"
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Enter Delete" @keydown="onItemKey($event, selectedIndex, index, item)"
              >
                <span v-if="!readonly" class="mu-tile__drag mu-drag" :title="t('editor.menu.drag')" aria-hidden="true"><GripVertical :size="14" /></span>
                <ModuleIcon :icon="iconFor(item)" :size="15" />
                <span class="mu-tile__label" :title="itemLabel(item)">{{ itemLabel(item) }}</span>
                <span v-if="item.type === 'route'" class="mu-badge" :title="t('editor.menu.routeHelp')"><LinkIcon :size="11" aria-hidden="true" />{{ t('editor.menu.routeBadge') }}</span>
                <span v-if="isUnknown(item)" class="mu-badge mu-badge--warning">{{ t('editor.menu.notInCrm') }}</span>
                <span v-if="isHidden(item)" class="mu-badge">{{ t('editor.menu.hiddenBadge') }}</span>
                <span v-if="!readonly" class="mu-row-actions">
                  <template v-if="item.type === 'module' && catalog.has(item.module)">
                    <button v-if="isHidden(item)" type="button" class="mu-icon-btn" :aria-label="t('editor.menu.show', { item: itemLabel(item) })" :title="t('editor.menu.showShort')" data-mu-action="item-show" @click="show(item.module)"><Eye :size="14" /></button>
                    <button v-else type="button" class="mu-icon-btn" :aria-label="t('editor.menu.hide', { item: itemLabel(item) })" :title="t('editor.menu.hideShort')" data-mu-action="item-hide" @click="hide(item.module, itemLabel(item))"><EyeOff :size="14" /></button>
                  </template>
                  <button v-else type="button" class="mu-icon-btn" :aria-label="t('editor.menu.removeItem', { item: itemLabel(item) })" :title="t('editor.menu.remove')" data-mu-action="item-remove" @click="removeItem(selectedIndex, index)"><Trash2 :size="14" /></button>
                  <button type="button" class="mu-icon-btn" :aria-label="t('editor.menu.editItem', { item: itemLabel(item) })" :title="t('editor.menu.edit')" data-mu-action="item-edit" @click="editItem(selectedIndex, index)"><Pencil :size="14" /></button>
                  <DropdownMenuRoot :modal="false">
                    <DropdownMenuTrigger class="mu-icon-btn" :aria-label="t('editor.menu.more', { item: itemLabel(item) })" :title="t('editor.menu.moreShort')" data-mu-action="item-more"><MoreHorizontal :size="14" /></DropdownMenuTrigger>
                    <DropdownMenuPortal to="#mu-overlay-root">
                      <DropdownMenuContent class="mu-popover mu-menu" align="end" :side-offset="4">
                        <DropdownMenuItem class="mu-menu__item" :disabled="index === 0" data-mu-action="item-up" @select="moveItem(selectedIndex, index, -1)"><ArrowUp :size="14" aria-hidden="true" />{{ t('editor.menu.upShort') }}</DropdownMenuItem>
                        <DropdownMenuItem class="mu-menu__item" :disabled="index === selectedGroup.items.length - 1" data-mu-action="item-down" @select="moveItem(selectedIndex, index, 1)"><ArrowDown :size="14" aria-hidden="true" />{{ t('editor.menu.downShort') }}</DropdownMenuItem>
                        <template v-if="groups.length > 1">
                          <DropdownMenuSeparator class="mu-menu__separator" />
                          <DropdownMenuLabel class="mu-menu__label">{{ t('editor.menu.toGroupShort') }}</DropdownMenuLabel>
                          <DropdownMenuItem
                            v-for="(target, targetIndex) in groups" :key="target.id" class="mu-menu__item" :disabled="targetIndex === selectedIndex"
                            :data-mu-move-to="target.id" @select="moveItemTo(selectedIndex, index, targetIndex)"
                          >
                            <component :is="ICON_COMPONENTS[groupIcon(target)]" :size="14" aria-hidden="true" />{{ groupLabel(target) }}
                          </DropdownMenuItem>
                        </template>
                      </DropdownMenuContent>
                    </DropdownMenuPortal>
                  </DropdownMenuRoot>
                </span>
              </li>
            </VueDraggable>
            <div v-if="!readonly" class="mu-tile-actions">
              <button type="button" class="mu-btn mu-btn--add" data-mu-action="add-modules" :disabled="selectedGroup.items.length >= ITEMS_MAX" @click="openPicker"><Plus :size="14" aria-hidden="true" /><span>{{ t('editor.menu.addModules') }}</span></button>
              <button type="button" class="mu-btn mu-btn--add" data-mu-action="add-route" @click="addRoute(selectedIndex)"><LinkIcon :size="14" aria-hidden="true" /><span>{{ t('editor.menu.addRoute') }}</span></button>
            </div>
            <div v-if="picker" class="mu-picker" data-mu-panel="add-modules">
              <header class="mu-picker__head">
                <span>{{ t('editor.menu.addModulesTo', { group: groupLabel(selectedGroup) }) }}</span>
                <label class="mu-search">
                  <Search :size="14" aria-hidden="true" />
                  <input v-model="pickerQuery" class="mu-input" type="search" :placeholder="t('editor.menu.search')" :aria-label="t('editor.menu.search')" data-mu-field="picker-search" />
                </label>
                <button type="button" class="mu-icon-btn" :aria-label="t('editor.dialog.cancel')" @click="picker = false"><X :size="16" /></button>
              </header>
              <ul v-if="pickerChoices.length > 0" class="mu-picker__list">
                <li v-for="module in pickerChoices" :key="module.module">
                  <label class="mu-check mu-picker__item">
                    <input v-model="picked" type="checkbox" :value="module.module" :data-mu-pick="module.module" />
                    <ModuleIcon :icon="module.icon" :size="15" />
                    <span>{{ module.label }}</span>
                    <span v-if="hidden.includes(module.module) || module.defaultHidden" class="mu-badge">{{ t('editor.menu.hiddenBadge') }}</span>
                  </label>
                </li>
              </ul>
              <p v-else class="mu-empty">{{ t('editor.menu.nothingFound') }}</p>
              <footer class="mu-picker__foot">
                <button type="button" class="mu-btn" @click="picker = false">{{ t('editor.dialog.cancel') }}</button>
                <button type="button" class="mu-btn mu-btn--primary" :disabled="picked.length === 0" data-mu-action="add-picked" @click="addPicked">{{ picked.length === 0 ? t('editor.menu.addModules') : t('editor.menu.addPicked', { n: picked.length }) }}</button>
              </footer>
            </div>
          </section>

          <!-- Not placed: they appear by themselves -->
          <section v-else-if="selected === UNPLACED" class="mu-group-other">
            <h4 class="mu-menu-panel__title">{{ t('editor.menu.notPlacedTitle') }}</h4>
            <p class="mu-help">{{ t('editor.menu.notPlacedHelp') }}</p>
            <ul v-if="notPlaced.length > 0" class="mu-tiles mu-tiles--list" data-mu-list="not-placed">
              <li v-for="module in notPlaced" :key="module.module" class="mu-item mu-tile" :data-mu-module="module.module">
                <ModuleIcon :icon="module.icon" :size="15" />
                <span class="mu-tile__label">{{ module.label }}</span>
                <span class="mu-help">{{ t('editor.menu.autoIn', { group: autoTarget(module) }) }}</span>
                <template v-if="!readonly && groups.length > 0">
                  <select class="mu-select mu-select--small" :value="addTarget[module.module] ?? 0" :aria-label="t('editor.menu.addTo', { item: module.label })" @change="addTarget[module.module] = Number(($event.target as HTMLSelectElement).value)">
                    <option v-for="(group, index) in groups" :key="group.id" :value="index">{{ groupLabel(group) }}</option>
                  </select>
                  <button type="button" class="mu-btn mu-btn--small" data-mu-action="place" @click="addToGroup(module.module, addTarget[module.module] ?? 0)">{{ t('editor.menu.place') }}</button>
                  <button type="button" class="mu-icon-btn" :aria-label="t('editor.menu.hide', { item: module.label })" :title="t('editor.menu.hideShort')" @click="hide(module.module, module.label)"><EyeOff :size="14" /></button>
                </template>
              </li>
            </ul>
            <p v-else class="mu-empty">{{ t('editor.menu.allPlaced') }}</p>
          </section>

          <!-- Hidden -->
          <section v-else class="mu-group-other">
            <h4 class="mu-menu-panel__title">{{ t('editor.menu.hiddenTitle') }}</h4>
            <p class="mu-help">{{ t('editor.menu.hiddenHelp') }}</p>
            <ul v-if="hiddenModules.length > 0 || unknownHidden.length > 0" class="mu-tiles mu-tiles--list" data-mu-list="hidden">
              <li v-for="entry in hiddenModules" :key="entry.module.module" class="mu-item mu-tile" :data-mu-module="entry.module.module">
                <ModuleIcon :icon="entry.module.icon" :size="15" />
                <span class="mu-tile__label">{{ entry.module.label }}</span>
                <span v-if="!entry.explicit" class="mu-help">{{ t('editor.menu.hiddenByCrm') }}</span>
                <template v-if="!readonly">
                  <button v-if="entry.explicit && mentioned.has(entry.module.module)" type="button" class="mu-btn mu-btn--small" data-mu-action="unhide" @click="show(entry.module.module)">{{ t('editor.menu.showShort') }}</button>
                  <template v-else>
                    <select class="mu-select mu-select--small" :value="addTarget[entry.module.module] ?? 0" :aria-label="t('editor.menu.addTo', { item: entry.module.label })" @change="addTarget[entry.module.module] = Number(($event.target as HTMLSelectElement).value)">
                      <option v-for="(group, index) in groups" :key="group.id" :value="index">{{ groupLabel(group) }}</option>
                    </select>
                    <button type="button" class="mu-btn mu-btn--small" data-mu-action="unhide" @click="addToGroup(entry.module.module, addTarget[entry.module.module] ?? 0)">{{ t('editor.menu.place') }}</button>
                  </template>
                </template>
              </li>
              <li v-for="module in unknownHidden" :key="module" class="mu-item mu-tile mu-item--unknown">
                <span class="mu-tile__label">{{ module }}</span>
                <span class="mu-badge mu-badge--warning">{{ t('editor.menu.notInCrm') }}</span>
                <button v-if="!readonly" type="button" class="mu-icon-btn" :aria-label="t('editor.menu.removeItem', { item: module })" @click="show(module)"><Trash2 :size="14" /></button>
              </li>
            </ul>
            <p v-else class="mu-empty">{{ t('editor.menu.noHidden') }}</p>
          </section>
        </div>
      </div>
    </section>

    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.menu.favoritesTitle') }}</h3></header>
      <div class="mu-card__body mu-card__body--rows">
        <ScopedField v-slot="{ value, update }" :editor="editor" field="navigation.favoritesEnabled" :problems="problems" :label="t('editor.menu.favoritesLabel')" label-for="mu-favorites-enabled" :help="t('editor.menu.favoritesHelp')">
          <label class="mu-switch"><input id="mu-favorites-enabled" type="checkbox" role="switch" :checked="value !== false" data-mu-field="favorites-enabled" @change="update(($event.target as HTMLInputElement).checked)" /><span>{{ t('fields.navigation_favoritesEnabled') }}</span></label>
        </ScopedField>
        <ScopedField v-slot="{ value, update }" :editor="editor" field="navigation.compact" :problems="problems" :label="t('editor.menu.compactLabel')" label-for="mu-compact">
          <label class="mu-switch"><input id="mu-compact" type="checkbox" role="switch" :checked="value === true" data-mu-field="compact" @change="update(($event.target as HTMLInputElement).checked)" /><span>{{ t('fields.navigation_compact') }}</span></label>
        </ScopedField>
      </div>
    </section>

    <ItemDialog v-if="dialog !== null" :title="dialog.title" :value="dialog.value" :modules="sortedCatalog" @save="applyDialog" @close="dialog = null" />

    <DialogRoot :open="previewOpen" @update:open="(open: boolean) => { previewOpen = open }">
      <DialogPortal to="#mu-overlay-root">
        <DialogOverlay class="mu-dialog-overlay" />
        <DialogContent class="mu-dialog mu-dialog--preview" data-mu-dialog="menu-preview" :aria-describedby="undefined">
          <header class="mu-dialog__head">
            <DialogTitle class="mu-dialog__title">{{ t('editor.menu.previewTitle') }}</DialogTitle>
            <label class="mu-inline-field">
              <span>{{ t('editor.menu.previewLanguage') }}</span>
              <select v-model="previewLocale" class="mu-select mu-select--small" data-mu-field="preview-locale">
                <option v-for="code in THEME_LOCALES" :key="code" :value="code">{{ t(`languages.${code}`) }}</option>
              </select>
            </label>
            <DialogClose class="mu-icon-btn" :aria-label="t('editor.dialog.close')"><X :size="16" /></DialogClose>
          </header>
          <p class="mu-help">{{ editor.isRole.value ? t('editor.menu.previewRole') : t('editor.menu.previewHelp') }}</p>
          <p v-if="previewError !== null" class="mu-field__error" role="alert">{{ previewError }}</p>
          <div class="mu-dialog__scroll" :aria-busy="previewBusy" data-mu-preview="menu">
            <MenuPanel v-if="preview !== null" :menu="preview.menu" :preview="true" />
          </div>
          <p v-if="preview !== null && preview.unknown.length > 0" class="mu-help">{{ t('editor.menu.unknownModules', { modules: preview.unknown.join(', ') }) }}</p>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
