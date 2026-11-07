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
import { ChevronDown, ChevronsRight, Link as LinkIcon, Menu as MenuIcon, Puzzle, Search, X } from '@lucide/vue'
import type { Bootstrap, MenuGroup, MenuItem, SystemItem } from '../api/types'
import type { ExtraLink } from '../adapters/v7/appMenu'
import { linkTarget, pageContext } from '../adapters/v7/page'
import { ICON_COMPONENTS } from '../menu/icons'
import ModuleIcon from '../menu/ModuleIcon.vue'
import { currentGroup, isCurrent, normalize, searchMenu } from './nav/model'
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
/** The entry of the footer (the cloud: Settings): the CRM settings for an administrator, the preferences otherwise. */
const footerItem = computed<SystemItem | null>(() => serviceItems.value.find((item) => item.id === 'crmSettings')
  ?? serviceItems.value.find((item) => item.id === 'preferences') ?? null)
/** "Personalize" of the cloud: the personal preferences of the interface (favorites, language), when the user has them. */
const personalize = computed(() => {
  const item = props.bootstrap.menu.system.find((entry) => entry.id === 'preferences')
  return item?.kind === 'link' ? item.url : null
})
/** The extension store of the core (the add-ons of the cloud) gets a button in the footer, the other links stay under "More". */
const storeLink = computed(() => props.extras.value.find((extra) => linkTarget(extra.url).module === 'ExtensionStore') ?? null)
const moreLinks = computed(() => props.extras.value.filter((extra) => extra !== storeLink.value))
/** While searching, the configuration column shows the entries whose label matches. */
const serviceMatches = computed(() => {
  const words = normalize(query.value).split(' ').filter((word) => word !== '')
  const matches = (label: string): boolean => words.every((word) => normalize(label).includes(word))
  return {
    items: serviceItems.value.filter((item) => matches(system.labels.value[item.id])),
    extras: props.extras.value.filter((extra) => matches(extra.label)),
  }
})

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
        <!-- The dark strip of the cloud in place of the header row: close, search, personalize. -->
        <div class="mu-mega__bar">
          <DialogClose class="mu-mega__close" :aria-label="t('menu.close')" :title="t('menu.close')">
            <X :size="20" aria-hidden="true" />
          </DialogClose>
          <label class="mu-mega__search">
            <Search :size="15" aria-hidden="true" class="mu-mega__search-icon" />
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
          <a v-if="personalize !== null && !narrow" class="mu-mega__personalize" :href="personalize" data-mu-item="personalize">
            <span>{{ t('menu.personalize') }}</span>
            <ChevronsRight :size="14" aria-hidden="true" />
          </a>
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
              <h2 class="mu-mega__subhead">{{ t('menu.service') }}</h2>
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

        <!-- Wide screens: apps (sections) | modules | configuration, the footer below. -->
        <template v-else>
          <div class="mu-mega__body">
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
                <h2 class="mu-mega__heading">{{ t('menu.modules') }}</h2>
                <div class="mu-mega__columns" :class="{ 'mu-mega__columns--results': searching }">
                  <template v-if="searching">
                    <p v-if="results.length === 0" class="mu-mega__empty" role="status">{{ t('menu.noResults', { query: query.trim() }) }}</p>
                    <template v-else>
                      <h3 class="mu-mega__subhead">{{ t('menu.searchResults') }}</h3>
                      <p class="mu-mega__visually-hidden" role="status">{{ t('menu.results', results.length) }}</p>
                      <a
                        v-for="result in results"
                        :key="result.item.id + result.item.url"
                        class="mu-mega__link"
                        :href="result.item.url"
                        :aria-current="current(result.item) ? 'page' : undefined"
                        :data-mu-item="result.item.id"
                        :title="`${result.item.label} — ${result.group.label}`"
                      >
                        <ModuleIcon :icon="result.item.icon" :size="14" />
                        <span class="mu-mega__text">{{ result.item.label }}</span>
                        <span class="mu-mega__hint">{{ result.group.label }}</span>
                      </a>
                    </template>
                  </template>
                  <template v-else-if="active !== null">
                    <h3 class="mu-mega__subhead" :title="active.label">{{ active.label }}</h3>
                    <a
                      v-for="item in active.items"
                      :key="item.id + item.url"
                      class="mu-mega__link"
                      :href="item.url"
                      :aria-current="current(item) ? 'page' : undefined"
                      :data-mu-item="item.id"
                      :title="item.label"
                    >
                      <ModuleIcon :icon="item.icon" :size="14" />
                      <span class="mu-mega__text">{{ item.label }}</span>
                    </a>
                  </template>
                  <p v-else class="mu-mega__empty">{{ t('menu.empty') }}</p>
                </div>
              </section>
              <section class="mu-mega__service" :aria-label="t('menu.configuration')">
                <h2 class="mu-mega__heading mu-mega__heading--service">{{ t('menu.configuration') }}</h2>
                <div class="mu-mega__service-body">
                  <template v-if="!searching || serviceMatches.items.length > 0">
                    <h3 class="mu-mega__subhead mu-mega__subhead--service">{{ t('menu.service') }}</h3>
                    <ul class="mu-mega__list">
                      <li v-for="item in searching ? serviceMatches.items : serviceItems" :key="item.id">
                        <a v-if="item.kind === 'link'" class="mu-mega__link" :href="item.url" :data-mu-item="item.id">
                          <component :is="SYSTEM_ICONS[item.id]" :size="14" aria-hidden="true" class="mu-mega__service-icon" />
                          <span class="mu-mega__text">{{ system.labels.value[item.id] }}</span>
                        </a>
                        <button v-else type="button" class="mu-mega__link" :disabled="system.busy.value" :data-mu-item="item.id" @click="selectSystem(item)">
                          <component :is="SYSTEM_ICONS[item.id]" :size="14" aria-hidden="true" class="mu-mega__service-icon" />
                          <span class="mu-mega__text">{{ system.labels.value[item.id] }}</span>
                        </button>
                      </li>
                    </ul>
                  </template>
                  <template v-if="searching ? serviceMatches.extras.length > 0 : moreLinks.length > 0">
                    <h3 class="mu-mega__subhead mu-mega__subhead--service">{{ t('menu.more') }}</h3>
                    <ul class="mu-mega__list">
                      <li v-for="extra in searching ? serviceMatches.extras : moreLinks" :key="extra.url">
                        <a class="mu-mega__link" :href="extra.url" data-mu-item="extra" :title="extra.label">
                          <LinkIcon :size="14" aria-hidden="true" class="mu-mega__service-icon" />
                          <span class="mu-mega__text">{{ extra.label }}</span>
                        </a>
                      </li>
                    </ul>
                  </template>
                </div>
              </section>
            </div>
          </div>
          <div class="mu-mega__footer" :aria-label="t('menu.footer')" role="group">
            <a v-if="storeLink !== null" class="mu-mega__footer-button" :href="storeLink.url" data-mu-item="store">
              <Puzzle :size="13" aria-hidden="true" />
              <span>{{ storeLink.label }}</span>
            </a>
            <a v-if="footerItem !== null && footerItem.kind === 'link'" class="mu-mega__footer-button" :href="footerItem.url" :data-mu-item="`footer-${footerItem.id}`">
              <component :is="SYSTEM_ICONS[footerItem.id]" :size="13" aria-hidden="true" />
              <span>{{ system.labels.value[footerItem.id] }}</span>
            </a>
          </div>
        </template>
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

// The menu button of the cloud: 36 × 36, primary, white icon, at the left edge of the main row of the header.
.mu-root.mu-mega-root {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
}

.mu-root .mu-mega__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid tok(primary-strong);
  border-radius: tok(radius-sm);
  background: tok(primary-strong);
  color: #ffffff;
  cursor: pointer;
  @include transition(background-color, box-shadow);

  &:hover,
  &[data-state='open'] {
    border-color: tok(primary-hover);
    background: tok(primary-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px tok(surface), 0 0 0 4px tok(focus-ring);
  }
}

// The cloud does not dim the page under its menu; the layer only closes the menu on a click outside. The favorites bar
// above the menu stays usable.
.mu-root .mu-mega-overlay {
  position: fixed;
  inset: 0;
  top: var(--mu-shell-bar, 0px);
  background: transparent;
}

// The panel (V02): from the top of the main row of the header to the bottom of the window, #f1f3f6, shadow 0 0 16 / 14 %;
// 60 % of the window from 1200 px (864 px at 1440, 1152 at 1920), 75 % below (768 px at 1024) — the widths of the cloud.
.mu-root .mu-mega {
  position: fixed;
  top: calc(var(--mu-shell-bar, 0px) - var(--mu-shell-overlap, 0px));
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  width: 60vw;
  border-radius: 0 tok(radius-sm) tok(radius-sm) 0;
  background: tok(menu-bg);
  box-shadow: tok(shadow-menu);
  color: tok(text-body);
  font-size: fs(13);
  line-height: 1.5;
  outline: none;

  @media (max-width: 1199px) {
    width: 75vw;
  }

  &.mu-mega--narrow {
    top: 0;
    width: 100vw;
    border-radius: 0;
  }
}

// Dark strip, 56 px: close (36 × 36) at the left edge, the search (459 × 36), "Personalize" at the right.
.mu-root .mu-mega__bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 24px;
  height: 56px;
  padding: 0 16px 0 24px;
  background: tok(nav-dark);

  .mu-mega--narrow & {
    gap: 12px;
    padding: 0 12px;
  }
}

.mu-root .mu-mega__close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: tok(radius-sm);
  background: tok(nav-dark-2);
  color: #ffffff;
  cursor: pointer;

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px tok(nav-dark-text);
  }
}

.mu-root .mu-mega__search {
  position: relative;
  display: flex;
  flex: 0 1 459px;
  align-items: center;
  min-width: 0;
  margin: 0;
  font-weight: 400;

  .mu-mega--narrow & {
    flex: 1 1 auto;
  }
}

.mu-root .mu-mega__search-icon {
  position: absolute;
  left: 12px;
  color: tok(text);
  pointer-events: none;
}

.mu-root .mu-mega__search-input {
  width: 100%;
  height: 36px;
  padding: 6px 12px 6px 32px;
  border: 0;
  border-radius: tok(radius-sm);
  background: tok(surface);
  color: tok(text);
  font: inherit;
  font-size: fs(13);

  &::placeholder {
    color: tok(text-muted);
    opacity: 1;
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 1.92px tok(focus-ring);
  }
}

.mu-root .mu-mega__personalize {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 16px 0;
  color: tok(nav-dark-text);
  font-size: fs(14);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;

  &:hover,
  &:focus {
    color: #ffffff;
    text-decoration: underline;
  }

  &:focus-visible {
    border-radius: tok(radius-sm);
    outline: none;
    box-shadow: 0 0 0 2px tok(nav-dark-text);
  }
}

.mu-root .mu-mega__body {
  display: flex;
  flex: 1;
  min-height: 0;
  border-top: 1px solid tok(divider);
}

// Apps: 86 px column on the grey of the panel, entries 62 px (icon 20 in its colour, label 12 px); the active one white
// with a 4 px bar of the accent and a shadow, label bold.
.mu-root .mu-mega__groups {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 86px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 0 16px;

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
  gap: 8px;
  min-height: 62px;
  margin: 0 0 2px;
  padding: 8px 4px 8px 0;
  border: 0;
  border-left: 4px solid transparent;
  border-radius: 0;
  background: transparent;
  color: tok(text-2);
  font: inherit;
  cursor: pointer;
  @include transition(background-color, box-shadow);

  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px tok(focus-ring);
  }

  &--active {
    border-left-color: tok(primary);
    background: tok(surface);
    color: tok(text);
    box-shadow: 0 2px 10px rgba(16, 30, 54, 0.15);

    &:focus-visible {
      box-shadow: 0 2px 10px rgba(16, 30, 54, 0.15), inset 0 0 0 2px tok(focus-ring);
    }
  }
}

.mu-root .mu-mega__group-label {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  font-size: fs(12);
  line-height: 1.5;
  text-align: center;
  hyphens: auto;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;

  .mu-mega__group--active & {
    font-weight: 600;
  }
}

// Colours of the app icons (the cloud colours each app; the label next to it names it).
.mu-root .mu-mega__tone-0 { color: #00b3c8; }
.mu-root .mu-mega__tone-1 { color: #877cff; }
.mu-root .mu-mega__tone-2 { color: #f5822a; }
.mu-root .mu-mega__tone-3 { color: #f15c80; }
.mu-root .mu-mega__tone-4 { color: #1fbdac; }
.mu-root .mu-mega__tone-5 { color: #3d9bf4; }

// White panel: MODULES (65 %) | CONFIGURATION (35 %).
.mu-root .mu-mega__panel {
  display: flex;
  flex: 1;
  min-width: 0;
  padding-left: 8px;
  background: tok(surface);
}

.mu-root .mu-mega__modules {
  display: flex;
  flex: 0 0 65%;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid tok(divider);
}

.mu-root .mu-mega__service {
  display: flex;
  flex: 1 1 35%;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
}

// Column headers: 14 / 700 capitals, 38 px, a line under them.
.mu-root .mu-mega__heading {
  flex: none;
  margin: 0;
  padding: 8px 0 8px 20px;
  border-bottom: 1px solid tok(divider);
  color: tok(text);
  font-size: fs(14);
  font-weight: 600;
  line-height: 21px;
  text-transform: uppercase;

  &--service {
    padding-left: 27px;
  }
}

// The modules flow in columns of 216 px (the height of the panel), then the panel scrolls sideways — as the cloud does.
.mu-root .mu-mega__columns {
  display: flex;
  flex: 1;
  flex-direction: column;
  flex-wrap: wrap;
  align-content: flex-start;
  column-gap: 40px;
  min-height: 0;
  padding: 16px 16px 16px 8px;
  overflow-x: auto;
  overflow-y: hidden;

  > .mu-mega__link {
    width: 216px;
  }

  // Results of the search: one column with the section of each module (the cloud lists them the same way).
  &--results {
    flex-wrap: nowrap;
    overflow-x: hidden;
    overflow-y: auto;

    > .mu-mega__link,
    > .mu-mega__subhead {
      width: min(100%, 460px);
    }
  }
}

.mu-root .mu-mega__subhead {
  flex: none;
  width: 216px;
  margin: 0 0 4px;
  padding-left: 12px;
  overflow: hidden;
  color: tok(text);
  font-size: fs(14);
  font-weight: 600;
  line-height: 21px;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--service {
    width: auto;
    margin-top: 0;
    padding-left: 16px;
    font-size: fs(15);
    line-height: 22.5px;
    white-space: normal;
  }
}

.mu-root .mu-mega__service-body {
  padding: 16px 16px 16px 8px;

  .mu-mega__list + .mu-mega__subhead {
    margin-top: 16px;
  }
}

.mu-root .mu-mega__empty {
  width: 100%;
  margin: 24px 0 0;
  color: tok(text-2);
  font-size: fs(18);
  text-align: center;
}

.mu-root .mu-mega__status {
  margin: 0 0 10px;
  color: tok(text-2);
}

.mu-root .mu-mega__visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.mu-root .mu-mega__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

// A module: 38 px, icon 14 and label 13 px #1c2121, radius 4; the module of the page light blue.
.mu-root .mu-mega__link {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 38px;
  margin: 0 0 4px;
  padding: 8px 12px;
  border: 0;
  border-radius: tok(radius-sm);
  background: transparent;
  color: tok(text);
  font: inherit;
  font-size: fs(13);
  line-height: 1.5;
  text-align: left;
  text-decoration: none;
  cursor: pointer;

  .mu-module-icon,
  .mu-mega__service-icon {
    color: tok(text);
  }

  &:hover {
    color: tok(text);
    text-decoration: none;
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px tok(focus-ring);
  }

  &[aria-current='page'] {
    background: tok(primary-soft);
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
  color: tok(text-label);
  font-size: fs(12);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mu-root .mu-mega__service-icon {
  flex: none;
}

// Entries of the configuration column wrap instead of being cut: the column is narrow and the texts are long in German.
.mu-root .mu-mega__service .mu-mega__text {
  overflow: visible;
  white-space: normal;
  overflow-wrap: break-word;
}

// Footer, 50 px: the settings of the cloud (secondary buttons 35 px).
.mu-root .mu-mega__footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 50px;
  padding: 0 16px 0 20px;
  border-top: 1px solid tok(divider);
  background: tok(surface);
}

.mu-root .mu-mega__footer-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 35px;
  padding: 6px 12px;
  border: 1px solid tok(btn-secondary);
  border-radius: tok(radius-sm);
  background: tok(btn-secondary);
  color: tok(text-body);
  font-size: fs(14);
  line-height: 1.5;
  text-decoration: none;
  white-space: nowrap;

  &:hover,
  &:focus {
    color: tok(text-body);
    text-decoration: none;
  }

  &:focus-visible {
    outline: none;
    @include focus-ring;
  }
}

// Narrow screens: the accordion.
.mu-root .mu-mega__accordion {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 24px;
  background: tok(surface);

  .mu-mega__link {
    margin: 0;
  }

  .mu-mega__service {
    display: block;
    margin-top: 12px;
    padding: 12px 0 0;
    border-top: 1px solid tok(divider);
    overflow: visible;

    .mu-mega__subhead {
      width: auto;
      padding-left: 8px;
    }
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
