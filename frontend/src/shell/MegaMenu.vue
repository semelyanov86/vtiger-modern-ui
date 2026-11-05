<script setup lang="ts">
/**
 * Mega menu of the new interface (docs/design.md §5.1, docs/architecture.md §7.1): replaces the app menu of v7
 * (#appnavigator → #app-menu). The button takes the place of the v7 hamburger; the panel opens under the favorites
 * bar with the module search on a dark strip, the sections (groups of the menu settings) on the left, the modules of
 * the section, and the service column (system section, settings, links the theme menu does not cover — the extension
 * store of the core, entries extensions added to the v7 app menu).
 *
 * Every entry is an ordinary link (href of the CRM): opening in a new tab, the history (back/forward), reload and
 * direct links work as with v7 — there is no router. Sections switch on hover (after a short delay), click and
 * keyboard (↑/↓, Home/End; → to the modules); Esc, × and a click outside close it and the focus returns to the
 * button. Narrow screens: the panel takes the whole screen, the sections become an accordion.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  VisuallyHidden,
} from 'reka-ui'
import { ChevronDown, ChevronRight, Link as LinkIcon, Menu as MenuIcon, Search, X } from '@lucide/vue'
import type { Bootstrap, MenuGroup, MenuItem, SystemItem } from '../api/types'
import type { ExtraLink } from '../adapters/v7/appMenu'
import { pageContext } from '../adapters/v7/page'
import { ICON_COMPONENTS } from '../menu/icons'
import ModuleIcon from '../menu/ModuleIcon.vue'
import { currentGroup, isCurrent, searchMenu } from './nav/model'
import type { FavoritesStore } from './nav/favorites'
import { SYSTEM_ICONS, useSystemItems } from './nav/system'

const props = defineProps<{
  bootstrap: Bootstrap
  favorites: FavoritesStore
  extras: Ref<readonly ExtraLink[]>
  onStandardView: () => void
}>()

const FAVORITES_ID = '__favorites'
const HOVER_DELAY = 150
const NARROW = '(max-width: 768px)'

const { t } = useI18n()
const system = useSystemItems(props.bootstrap, () => {
  open.value = false
  props.onStandardView()
})
const page = pageContext()
const open = ref(false)
const query = ref('')
const activeId = ref('')
const expanded = ref<Set<string>>(new Set())
const narrow = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
const tabs = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
let hoverTimer: number | null = null
let media: MediaQueryList | null = null

const groups = computed<MenuGroup[]>(() => {
  const list = [...props.bootstrap.menu.groups]
  if (props.favorites.enabled && props.favorites.items.value.length > 0) {
    list.unshift({ id: FAVORITES_ID, label: t('menu.favorites'), icon: 'star', app: null, items: props.favorites.items.value })
  }
  return list
})
const here = currentGroup(props.bootstrap.menu.groups, page)
const active = computed<MenuGroup | null>(() => groups.value.find((group) => group.id === activeId.value) ?? groups.value[0] ?? null)
const results = computed(() => searchMenu(props.bootstrap.menu.groups, query.value))
const searching = computed(() => query.value.trim() !== '')
const serviceItems = computed(() => [...system.userItems.value, ...system.adminItems.value])

/** Colour of a section icon (--mu-app-* of the design, by position). */
function tone(index: number): string {
  return `mu-mega__tone-${String(index % 6)}`
}

function tabId(group: MenuGroup): string {
  return `mu-mega-tab-${group.id}`
}

function reset(): void {
  query.value = ''
  activeId.value = here?.id ?? groups.value[0]?.id ?? ''
  expanded.value = new Set(here !== null ? [here.id] : [])
}

watch(open, (value) => {
  if (value) {
    reset()
  }
  cancelHover()
})

function activate(group: MenuGroup): void {
  cancelHover()
  activeId.value = group.id
}

function hover(group: MenuGroup, event: PointerEvent): void {
  if (event.pointerType !== 'mouse' || searching.value) {
    return
  }
  cancelHover()
  hoverTimer = window.setTimeout(() => {
    hoverTimer = null
    activeId.value = group.id
  }, HOVER_DELAY)
}

function cancelHover(): void {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer)
    hoverTimer = null
  }
}

function focusTab(index: number): void {
  const list = groups.value
  const target = list[(index + list.length) % list.length]
  if (target === undefined) {
    return
  }
  activate(target)
  void nextTick(() => {
    tabs.value?.querySelector<HTMLElement>(`#${CSS.escape(tabId(target))}`)?.focus()
  })
}

function tabKey(event: KeyboardEvent, index: number): void {
  const keys: Record<string, () => void> = {
    ArrowDown: () => {
      focusTab(index + 1)
    },
    ArrowUp: () => {
      focusTab(index - 1)
    },
    Home: () => {
      focusTab(0)
    },
    End: () => {
      focusTab(groups.value.length - 1)
    },
    ArrowRight: () => {
      panel.value?.querySelector<HTMLElement>('a[href]')?.focus()
    },
  }
  const action = keys[event.key]
  if (action !== undefined) {
    event.preventDefault()
    action()
  }
}

function searchKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    const first = panel.value?.querySelector<HTMLElement>('a[href]')
    if (first) {
      event.preventDefault()
      first.focus()
    }
  } else if (event.key === 'Enter') {
    const first = results.value[0]
    if (first !== undefined) {
      event.preventDefault()
      window.location.assign(new URL(first.item.url, document.baseURI).toString())
    }
  }
}

function toggleSection(group: MenuGroup): void {
  const next = new Set(expanded.value)
  if (next.has(group.id)) {
    next.delete(group.id)
  } else {
    next.add(group.id)
  }
  expanded.value = next
}

function current(item: MenuItem): boolean {
  return isCurrent(item, page)
}

function selectSystem(item: SystemItem): void {
  void system.run(item)
}

function focusSearch(event: Event): void {
  event.preventDefault()
  searchInput.value?.focus()
}

/** Root of the island (our container in the v7 header). */
const anchor = ref<HTMLElement | null>(null)

/**
 * On narrow screens the header of v7 starts left of the window (its rows have negative margins), and the v7 hamburger
 * is cut there; the button of the theme is moved into the window instead.
 */
function keepInWindow(): void {
  const root = anchor.value?.closest<HTMLElement>('.mu-mega-root') ?? null
  if (root === null) {
    return
  }
  root.style.marginLeft = ''
  const left = root.getBoundingClientRect().left
  if (left < 0) {
    root.style.marginLeft = `${String(Math.ceil(-left))}px`
  }
}

const onMedia = (): void => {
  narrow.value = media?.matches ?? false
  keepInWindow()
}
// A page restored from the back/forward cache must not come back with the menu open.
const onPageHide = (): void => {
  open.value = false
}

onMounted(() => {
  media = window.matchMedia(NARROW)
  onMedia()
  media.addEventListener('change', onMedia)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('resize', keepInWindow, { passive: true })
})

onBeforeUnmount(() => {
  cancelHover()
  media?.removeEventListener('change', onMedia)
  window.removeEventListener('pagehide', onPageHide)
  window.removeEventListener('resize', keepInWindow)
})
</script>

<template>
  <span ref="anchor" class="mu-mega__anchor" aria-hidden="true"></span>
  <DialogRoot v-model:open="open">
    <DialogTrigger class="mu-mega__trigger" :aria-label="t('menu.open')" :title="t('menu.open')" data-mu-trigger="mega-menu">
      <MenuIcon :size="18" aria-hidden="true" />
    </DialogTrigger>
    <DialogPortal to="#mu-overlay-root">
      <DialogOverlay class="mu-mega-overlay" />
      <DialogContent class="mu-mega" :class="{ 'mu-mega--narrow': narrow }" data-mu-panel="mega-menu" @open-auto-focus="focusSearch">
        <VisuallyHidden>
          <DialogTitle>{{ t('menu.title') }}</DialogTitle>
          <DialogDescription>{{ t('menu.description') }}</DialogDescription>
        </VisuallyHidden>
        <div class="mu-mega__bar">
          <label class="mu-mega__search">
            <Search :size="16" aria-hidden="true" class="mu-mega__search-icon" />
            <input
              ref="searchInput"
              v-model="query"
              class="mu-mega__search-input"
              type="search"
              autocomplete="off"
              spellcheck="false"
              :placeholder="t('menu.searchPlaceholder')"
              :aria-label="t('menu.search')"
              aria-controls="mu-mega-panel"
              data-mu-field="menu-search"
              @keydown="searchKey"
            />
          </label>
          <DialogClose class="mu-mega__close" :aria-label="t('menu.close')" :title="t('menu.close')">
            <X :size="20" aria-hidden="true" />
          </DialogClose>
        </div>

        <!-- Narrow screens: sections as an accordion, or the search results. -->
        <div v-if="narrow" id="mu-mega-panel" ref="panel" class="mu-mega__accordion">
          <template v-if="searching">
            <p class="mu-mega__status" role="status">{{ results.length > 0 ? t('menu.results', results.length) : t('menu.noResults', { query: query.trim() }) }}</p>
            <ul class="mu-mega__list">
              <li v-for="result in results" :key="result.item.id + result.item.url">
                <a class="mu-mega__link" :href="result.item.url" :aria-current="current(result.item) ? 'page' : undefined" :data-mu-item="result.item.id">
                  <ModuleIcon :icon="result.item.icon" :size="16" />
                  <span class="mu-mega__text">{{ result.item.label }}</span>
                  <span class="mu-mega__hint">{{ result.group.label }}</span>
                </a>
              </li>
            </ul>
          </template>
          <template v-else>
            <section v-for="(group, index) in groups" :key="group.id" class="mu-mega__section" :data-mu-group="group.id">
              <h2 class="mu-mega__section-head">
                <button type="button" class="mu-mega__section-toggle" :aria-expanded="expanded.has(group.id)" :aria-controls="`mu-mega-section-${group.id}`" @click="toggleSection(group)">
                  <component :is="ICON_COMPONENTS[group.icon]" :size="18" aria-hidden="true" class="mu-mega__group-icon" :class="tone(index)" />
                  <span class="mu-mega__text">{{ group.label }}</span>
                  <ChevronDown :size="16" aria-hidden="true" class="mu-mega__chevron" />
                </button>
              </h2>
              <ul v-show="expanded.has(group.id)" :id="`mu-mega-section-${group.id}`" class="mu-mega__list">
                <li v-for="item in group.items" :key="item.id + item.url">
                  <a class="mu-mega__link" :href="item.url" :aria-current="current(item) ? 'page' : undefined" :data-mu-item="item.id">
                    <ModuleIcon :icon="item.icon" :size="16" />
                    <span class="mu-mega__text">{{ item.label }}</span>
                  </a>
                </li>
              </ul>
            </section>
            <section class="mu-mega__service" :aria-label="t('menu.service')">
              <h2 class="mu-mega__heading">{{ t('menu.service') }}</h2>
              <ul class="mu-mega__list">
                <li v-for="item in serviceItems" :key="item.id">
                  <a v-if="item.kind === 'link'" class="mu-mega__link" :href="item.url" :data-mu-item="item.id">
                    <component :is="SYSTEM_ICONS[item.id]" :size="16" aria-hidden="true" class="mu-mega__service-icon" />
                    <span class="mu-mega__text">{{ system.labels.value[item.id] }}</span>
                  </a>
                  <button v-else type="button" class="mu-mega__link" :disabled="system.busy.value" :data-mu-item="item.id" @click="selectSystem(item)">
                    <component :is="SYSTEM_ICONS[item.id]" :size="16" aria-hidden="true" class="mu-mega__service-icon" />
                    <span class="mu-mega__text">{{ system.labels.value[item.id] }}</span>
                  </button>
                </li>
                <li v-for="extra in extras.value" :key="extra.url">
                  <a class="mu-mega__link" :href="extra.url" data-mu-item="extra">
                    <LinkIcon :size="16" aria-hidden="true" class="mu-mega__service-icon" />
                    <span class="mu-mega__text">{{ extra.label }}</span>
                  </a>
                </li>
              </ul>
            </section>
          </template>
        </div>

        <!-- Wide screens: sections | modules | service. -->
        <div v-else class="mu-mega__body">
          <div ref="tabs" class="mu-mega__groups" role="tablist" aria-orientation="vertical" :aria-label="t('menu.sections')" :class="{ 'mu-mega__groups--muted': searching }">
            <button
              v-for="(group, index) in groups"
              :id="tabId(group)"
              :key="group.id"
              type="button"
              role="tab"
              class="mu-mega__group"
              :class="{ 'mu-mega__group--active': !searching && active?.id === group.id, 'mu-mega__group--here': here?.id === group.id }"
              :aria-selected="!searching && active?.id === group.id"
              :tabindex="active?.id === group.id ? 0 : -1"
              aria-controls="mu-mega-panel"
              :title="group.label"
              :data-mu-group="group.id"
              @click="activate(group); query = ''"
              @pointerenter="hover(group, $event)"
              @pointerleave="cancelHover"
              @keydown="tabKey($event, index)"
            >
              <component :is="ICON_COMPONENTS[group.icon]" :size="20" aria-hidden="true" class="mu-mega__group-icon" :class="tone(index)" />
              <span class="mu-mega__group-label">{{ group.label }}</span>
            </button>
          </div>
          <div class="mu-mega__panel">
            <section
              id="mu-mega-panel"
              ref="panel"
              class="mu-mega__modules"
              :role="searching ? 'region' : 'tabpanel'"
              :aria-labelledby="!searching && active !== null ? tabId(active) : undefined"
              :aria-label="searching ? t('menu.searchResults') : undefined"
            >
              <template v-if="searching">
                <h2 class="mu-mega__heading">{{ t('menu.searchResults') }}</h2>
                <p class="mu-mega__status" role="status">{{ results.length > 0 ? t('menu.results', results.length) : t('menu.noResults', { query: query.trim() }) }}</p>
                <ul class="mu-mega__grid">
                  <li v-for="result in results" :key="result.item.id + result.item.url">
                    <a class="mu-mega__link" :href="result.item.url" :aria-current="current(result.item) ? 'page' : undefined" :data-mu-item="result.item.id" :title="result.item.label">
                      <ModuleIcon :icon="result.item.icon" :size="16" />
                      <span class="mu-mega__text">{{ result.item.label }}</span>
                      <span class="mu-mega__hint">{{ result.group.label }}</span>
                    </a>
                  </li>
                </ul>
              </template>
              <template v-else-if="active !== null">
                <h2 class="mu-mega__heading" :title="active.label">{{ active.label }}</h2>
                <ul class="mu-mega__grid">
                  <li v-for="item in active.items" :key="item.id + item.url">
                    <a class="mu-mega__link" :href="item.url" :aria-current="current(item) ? 'page' : undefined" :data-mu-item="item.id" :title="item.label">
                      <ModuleIcon :icon="item.icon" :size="16" />
                      <span class="mu-mega__text">{{ item.label }}</span>
                      <ChevronRight v-if="current(item)" :size="14" aria-hidden="true" class="mu-mega__here" />
                    </a>
                  </li>
                </ul>
              </template>
              <p v-else class="mu-mega__status">{{ t('menu.empty') }}</p>
            </section>
            <section class="mu-mega__service" :aria-label="t('menu.service')">
              <h2 class="mu-mega__heading">{{ t('menu.service') }}</h2>
              <ul class="mu-mega__list">
                <li v-for="item in serviceItems" :key="item.id">
                  <a v-if="item.kind === 'link'" class="mu-mega__link" :href="item.url" :data-mu-item="item.id">
                    <component :is="SYSTEM_ICONS[item.id]" :size="16" aria-hidden="true" class="mu-mega__service-icon" />
                    <span class="mu-mega__text">{{ system.labels.value[item.id] }}</span>
                  </a>
                  <button v-else type="button" class="mu-mega__link" :disabled="system.busy.value" :data-mu-item="item.id" @click="selectSystem(item)">
                    <component :is="SYSTEM_ICONS[item.id]" :size="16" aria-hidden="true" class="mu-mega__service-icon" />
                    <span class="mu-mega__text">{{ system.labels.value[item.id] }}</span>
                  </button>
                </li>
              </ul>
              <template v-if="extras.value.length > 0">
                <h2 class="mu-mega__heading mu-mega__heading--more">{{ t('menu.more') }}</h2>
                <ul class="mu-mega__list">
                  <li v-for="extra in extras.value" :key="extra.url">
                    <a class="mu-mega__link" :href="extra.url" data-mu-item="extra" :title="extra.label">
                      <LinkIcon :size="16" aria-hidden="true" class="mu-mega__service-icon" />
                      <span class="mu-mega__text">{{ extra.label }}</span>
                    </a>
                  </li>
                </ul>
              </template>
            </section>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

// The v7 hamburger (and its app menu) is hidden only while this island is mounted (docs/architecture.md §7.3).
html[data-mu-replaced~='app-menu'] nav.app-fixed-navbar #appnavigator {
  display: none !important;
}

.mu-root .mu-mega__anchor {
  display: none;
}

.mu-root.mu-mega-root {
  position: relative;
  float: left;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
}

.mu-root .mu-mega__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: tok(radius-sm);
  background: tok(primary-strong);
  color: #ffffff;
  cursor: pointer;
  @include transition(background-color, box-shadow);

  &:hover,
  &[data-state='open'] {
    background: tok(primary-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px tok(surface), 0 0 0 4px tok(focus-ring);
  }
}

.mu-root .mu-mega-overlay {
  position: fixed;
  inset: 0;
  background: rgba(28, 33, 33, 0.24);
}

.mu-root .mu-mega {
  position: fixed;
  top: var(--mu-shell-bar, 0px);
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: min(100vw, clamp(720px, 60vw, 1200px));
  background: tok(menu-bg);
  box-shadow: tok(shadow-menu);
  color: tok(text);
  font-size: fs(13);
  outline: none;

  @media (max-width: 1199px) {
    width: calc(100vw - 48px);
  }

  &.mu-mega--narrow {
    top: 0;
    width: 100vw;
  }
}

.mu-root .mu-mega__bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 12px 0 16px;
  background: tok(nav-dark);
}

.mu-root .mu-mega__search {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  max-width: 520px;
  margin: 0;
  font-weight: 400;
}

.mu-root .mu-mega__search-icon {
  position: absolute;
  left: 10px;
  color: tok(text-2);
  pointer-events: none;
}

.mu-root .mu-mega__search-input {
  width: 100%;
  height: 36px;
  padding: 0 12px 0 34px;
  border: 1px solid transparent;
  border-radius: tok(radius-sm);
  background: tok(surface);
  color: tok(text);
  font: inherit;
  font-size: fs(14);

  &::placeholder {
    color: tok(text-muted);
    opacity: 1;
  }

  &:focus {
    outline: none;
    border-color: tok(focus-border);
    box-shadow: 0 0 0 2px tok(focus-ring);
  }
}

.mu-root .mu-mega__close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: tok(radius-sm);
  background: tok(nav-dark-2);
  color: tok(nav-dark-text);
  cursor: pointer;

  &:hover {
    background: #56708b;
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px tok(nav-dark-text);
  }
}

.mu-root .mu-mega__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.mu-root .mu-mega__groups {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 98px;
  overflow-y: auto;
  padding: 8px 0;

  &--muted {
    opacity: 0.6;
  }
}

.mu-root .mu-mega__group {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 62px;
  margin: 0 4px 4px;
  padding: 8px 2px;
  border: 0;
  border-radius: tok(radius-md);
  background: transparent;
  color: tok(text-2);
  font: inherit;
  cursor: pointer;
  @include transition(background-color, box-shadow);

  &:hover {
    background: rgba(255, 255, 255, 0.6);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px tok(focus-ring);
  }

  &--active {
    background: tok(surface);
    color: tok(text);
    box-shadow: 0 2px 10px rgba(16, 30, 54, 0.15), inset 4px 0 0 tok(primary);

    &:focus-visible {
      box-shadow: inset 4px 0 0 tok(primary), 0 0 0 2px tok(focus-ring);
    }
  }
}

.mu-root .mu-mega__group-label {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  font-size: fs(12);
  line-height: 1.3;
  text-align: center;
  hyphens: auto;
  overflow-wrap: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;

  .mu-mega__group--active & {
    font-weight: 600;
  }
}

// Colours of the section icons (--mu-app-* of docs/design.md §3.1); the label next to each names it.
.mu-root .mu-mega__tone-0 { color: #0e9fb3; }
.mu-root .mu-mega__tone-1 { color: #6f62f0; }
.mu-root .mu-mega__tone-2 { color: #e5702a; }
.mu-root .mu-mega__tone-3 { color: #d64fb4; }
.mu-root .mu-mega__tone-4 { color: #00a3a6; }
.mu-root .mu-mega__tone-5 { color: #6c8299; }

.mu-root .mu-mega__panel {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(200px, 35%);
  min-width: 0;
  overflow-y: auto;
  background: tok(surface);

  @media (max-width: 899px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.mu-root .mu-mega__modules {
  min-width: 0;
  padding: 20px 24px;
}

.mu-root .mu-mega__service {
  min-width: 0;
  padding: 20px 24px;
  border-left: 1px solid tok(divider);
  background: tok(surface-subtle);

  @media (max-width: 899px) {
    border-top: 1px solid tok(divider);
    border-left: 0;
  }
}

.mu-root .mu-mega__heading {
  margin: 0 0 10px;
  overflow: hidden;
  color: tok(text-heading);
  font-size: fs(14);
  font-weight: 600;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--more {
    margin-top: 20px;
  }
}

.mu-root .mu-mega__status {
  margin: 0 0 10px;
  color: tok(text-2);
}

.mu-root .mu-mega__grid,
.mu-root .mu-mega__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mu-root .mu-mega__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 2px 12px;
}

.mu-root .mu-mega__link {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 38px;
  padding: 4px 10px;
  border: 0;
  border-radius: tok(radius-sm);
  background: transparent;
  color: tok(text);
  font: inherit;
  font-size: fs(14);
  line-height: 1.3;
  text-align: left;
  text-decoration: none;
  cursor: pointer;

  &:hover {
    background: tok(surface-readonly);
    color: tok(text);
    text-decoration: none;
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px tok(focus-ring);
  }

  &[aria-current='page'] {
    background: tok(primary-soft);
    font-weight: 600;
  }

  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
}

.mu-root .mu-mega__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mu-root .mu-mega__hint {
  flex: none;
  max-width: 40%;
  margin-left: auto;
  overflow: hidden;
  color: tok(text-2);
  font-size: fs(12);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mu-root .mu-mega__here {
  flex: none;
  margin-left: auto;
  color: tok(primary-strong);
}

.mu-root .mu-mega__service-icon {
  flex: none;
  color: tok(text-2);
}

// Entries of the service column wrap instead of being cut: the column is narrow and the texts are long in German.
.mu-root .mu-mega__service .mu-mega__text {
  overflow: visible;
  white-space: normal;
  overflow-wrap: break-word;
}

// Narrow screens: the accordion.
.mu-root .mu-mega__accordion {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 24px;
  background: tok(surface);

  .mu-mega__service {
    margin-top: 12px;
    padding: 12px 0 0;
    border-top: 1px solid tok(divider);
    border-left: 0;
    background: transparent;
  }
}

.mu-root .mu-mega__section {
  border-bottom: 1px solid tok(divider);
}

.mu-root .mu-mega__section-head {
  margin: 0;
  font-size: inherit;
}

.mu-root .mu-mega__section-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: tok(text);
  font: inherit;
  font-size: fs(14);
  font-weight: 600;
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px tok(focus-ring);
  }

  .mu-mega__chevron {
    flex: none;
    margin-left: auto;
    color: tok(text-2);
    @include transition(transform);
  }

  &[aria-expanded='true'] .mu-mega__chevron {
    transform: rotate(180deg);
  }
}

.mu-root .mu-mega__section .mu-mega__list {
  padding: 0 0 8px 8px;
}
</style>
