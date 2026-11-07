<script setup lang="ts">
/**
 * Context navigation of a page (docs/design.md §13.7): the entries the v7 module strip offered for this page and the menu
 * of the theme does not — the views of the calendar (calendar, shared calendar, list) and links extensions added to the
 * strip. It sits on the left of the toolbar of the page, as the view switch of the cloud. Ordinary links (new tab,
 * history, reload work as in v7); the entry of the page is marked as current.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarDays, Link as LinkIcon, List, UsersRound } from '@lucide/vue'
import type { ContextEntry } from '../adapters/v7/appMenu'
import type { PageContext } from '../adapters/v7/page'

const props = defineProps<{ entries: readonly ContextEntry[]; page: PageContext }>()

const { t } = useI18n()

/** Icons of the known views of the core; another entry gets the link icon. */
const VIEW_ICONS = { Calendar: CalendarDays, SharedCalendar: UsersRound, List } as const

function icon(entry: ContextEntry) {
  return entry.module === props.page.module && entry.view in VIEW_ICONS ? VIEW_ICONS[entry.view as keyof typeof VIEW_ICONS] : LinkIcon
}

/** v7 marks the entry of the page; without a mark, the entry whose view is the view of the page. */
const currentUrl = computed(() => {
  const marked = props.entries.find((entry) => entry.current)
  const same = props.entries.find((entry) => entry.module === props.page.module && entry.view === props.page.view)
  return (marked ?? same)?.url ?? null
})
</script>

<template>
  <nav class="mu-context" :aria-label="t('context.label')">
    <ul class="mu-context__list">
      <li v-for="entry in entries" :key="entry.url">
        <a
          class="mu-context__tab"
          :href="entry.url"
          :title="entry.label"
          :aria-current="entry.url === currentUrl ? 'page' : undefined"
          :data-mu-item="`${entry.module}:${entry.view}`"
        >
          <component :is="icon(entry)" :size="15" aria-hidden="true" class="mu-context__icon" />
          <span class="mu-context__text">{{ entry.label }}</span>
        </a>
      </li>
    </ul>
  </nav>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

// On the left of the toolbar of the page (the band under the header, skin/_shell.scss), fixed with the header.
.mu-root.mu-context-root {
  position: absolute;
  top: 100%;
  left: 24px;
  display: flex;
  align-items: center;
  max-width: calc(100% - 48px);
  height: 52px;

  @media (max-width: 767px) {
    // Phones: the title heads the toolbar; the views get a row of their own under it (reserved by skin/_shell.scss).
    top: calc(100% + 52px);
    right: 0;
    left: 0;
    max-width: none;
    height: 44px;
    padding: 0 12px;
    overflow-x: auto;
    background: tok(bg);
  }
}

// The view switch of the cloud: a white box (radius 6, 2 px inside), the current view light blue.
.mu-root .mu-context__list {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  margin: 0;
  padding: 2px;
  border-radius: tok(radius-md);
  background: tok(surface);
  list-style: none;
}

.mu-root .mu-context__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  height: 32px;
  padding: 0 12px;
  border-radius: tok(radius-sm);
  color: tok(text-2);
  font-size: fs(13);
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
  @include transition(color, background-color);

  &:hover {
    color: tok(text);
    text-decoration: none;
  }

  &[aria-current='page'] {
    background: tok(primary-soft);
    color: tok(text);
  }

  &:focus-visible {
    outline: none;
    @include focus-ring;
  }
}

.mu-root .mu-context__icon {
  flex: none;
}

.mu-root .mu-context__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
