<script setup lang="ts">
/**
 * Favorites bar above the v7 header (docs/design.md §5.1): the star with the actions (add or remove the module of the
 * current page, edit the favorites in the preferences), then the favorite modules as tabs — ordinary links, the
 * module of the page marked as current. navigation.compact shows the icons only (the label stays in title and
 * aria-label). Overflowing tabs scroll horizontally (narrow screens). Its space is reserved by the tokens stylesheet
 * from the first paint, so the header does not move when it mounts.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import { Settings2, Star, StarOff } from '@lucide/vue'
import type { Bootstrap } from '../api/types'
import { ApiError } from '../api/guards'
import { notify } from '../adapters/v7/host'
import { pageContext } from '../adapters/v7/page'
import ModuleIcon from '../menu/ModuleIcon.vue'
import type { FavoritesStore } from './nav/favorites'
import { isCurrent, moduleItem } from './nav/model'

const props = defineProps<{ bootstrap: Bootstrap; favorites: FavoritesStore }>()

const { t } = useI18n()
const page = pageContext()
const items = props.favorites.items
const busy = props.favorites.busy
const full = props.favorites.full
/** The module of this page as a menu entry, when the menu has it (only such modules can be favorites). */
const here = moduleItem(props.bootstrap.menu, page.module)
const isFavorite = computed(() => here !== null && items.value.some((item) => item.module === here.module))
const preferencesUrl = props.bootstrap.menu.system.find((item) => item.id === 'preferences' && item.kind === 'link')

async function toggle(): Promise<void> {
  if (here === null) {
    return
  }
  try {
    const result = await props.favorites.toggle(here)
    notify('success', t(result === 'added' ? 'favorites.added' : 'favorites.removed', { module: here.label }))
  } catch (error) {
    const code = error instanceof ApiError ? error.code : 'MU_UNKNOWN'
    notify('error', t('notify.actionFailed', { reason: t(`errors.${code}`) }))
  }
}

function select(event: Event): void {
  event.preventDefault()
  void toggle()
}
</script>

<template>
  <nav class="mu-favbar" :class="{ 'mu-favbar--compact': favorites.compact }" :aria-label="t('favorites.label')">
    <DropdownMenuRoot v-if="favorites.canEdit" :modal="false">
      <DropdownMenuTrigger class="mu-favbar__star" :aria-label="t('favorites.actions')" :title="t('favorites.actions')" data-mu-trigger="favorites">
        <Star :size="15" aria-hidden="true" fill="currentColor" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal to="#mu-overlay-root">
        <DropdownMenuContent class="mu-menu" align="start" :side-offset="4" :collision-padding="8">
          <DropdownMenuItem v-if="here !== null" class="mu-menu__item" :disabled="busy || (!isFavorite && full)" data-mu-item="favorite-toggle" @select="select">
            <component :is="isFavorite ? StarOff : Star" :size="15" aria-hidden="true" class="mu-menu__icon" />
            <span>{{ isFavorite ? t('favorites.remove', { module: here.label }) : full ? t('favorites.full') : t('favorites.add', { module: here.label }) }}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="here !== null && preferencesUrl !== undefined" class="mu-menu__separator" />
          <DropdownMenuItem v-if="preferencesUrl !== undefined && preferencesUrl.kind === 'link'" as-child class="mu-menu__item">
            <a :href="preferencesUrl.url" data-mu-item="favorites-edit">
              <Settings2 :size="15" aria-hidden="true" class="mu-menu__icon" />
              <span>{{ t('favorites.edit') }}</span>
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
    <span v-else class="mu-favbar__star mu-favbar__star--static" aria-hidden="true">
      <Star :size="15" fill="currentColor" />
    </span>
    <ul v-if="items.length > 0" class="mu-favbar__list">
      <li v-for="item in items" :key="item.id">
        <a
          class="mu-favbar__tab"
          :href="item.url"
          :title="item.label"
          :aria-label="favorites.compact ? item.label : undefined"
          :aria-current="isCurrent(item, page) ? 'page' : undefined"
          :data-mu-item="item.id"
        >
          <ModuleIcon v-if="favorites.compact" :icon="item.icon" :size="15" />
          <span v-else class="mu-favbar__text">{{ item.label }}</span>
        </a>
      </li>
    </ul>
    <p v-else class="mu-favbar__empty">{{ t('favorites.empty') }}</p>
  </nav>
</template>

<style lang="scss">
@use '../styles/tokens' as *;
// The geometry of the shell comes with the skin (render-blocking, first paint) and again with the shell: when the
// skin stylesheet failed to load, the bar still gets its space instead of covering the header.
@use '../skin/shell';

// Fixed to the viewport (not to the v7 header: on narrow screens the header of v7 starts 20 px left of the window). Under
// the main row of the header (z-index 0 in its stacking context): the row covers the last 2 px of the bar, as in the cloud.
.mu-root.mu-favorites-root {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 0;
  height: 42px;
}

// The favorites of the cloud (V01): 42 px on #f9f9fa, the star and then the modules as text links with a 1 px divider
// after each, 14 px #595d5d, at most 160 px each; the module of the page in the accent.
.mu-root .mu-favbar {
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 24px 0 25px;
  border-bottom: 1px solid tok(border);
  background: tok(surface-subtle);
  color: tok(text-2);
  font-size: fs(14);

  @media (max-width: 767px) {
    padding: 0 12px 0 6px;
  }
}

.mu-root .mu-favbar__star {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: 4px;
  padding: 0;
  border: 0;
  border-radius: tok(radius-sm);
  background: transparent;
  color: #ff8e4b;
  cursor: pointer;

  &:hover,
  &[data-state='open'] {
    background: tok(surface-readonly);
  }

  &:focus-visible {
    outline: none;
    @include focus-ring;
  }

  &--static {
    cursor: default;

    &:hover {
      background: transparent;
    }
  }
}

// Too many favorites for the width: each one gives up room down to a few letters (ellipsis, the whole label in the
// tooltip), then the row scrolls.
.mu-root .mu-favbar__list {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow-x: auto;
  overflow-y: hidden;
  list-style: none;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  > li {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    min-width: 56px;
    height: 100%;
  }
}

.mu-root .mu-favbar__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 160px;
  height: 21px;
  padding: 0 16px 0 9px;
  border-right: 1px solid #ebebee;
  color: tok(text-2);
  line-height: 21px;
  text-decoration: none;
  @include transition(color);

  .mu-module-icon {
    color: inherit;
  }

  &:hover {
    color: tok(link);
    text-decoration: none;
  }

  &[aria-current='page'] {
    color: tok(primary);
  }

  &:focus-visible {
    border-radius: tok(radius-sm);
    outline: none;
    @include focus-ring;
  }

  .mu-favbar--compact & {
    justify-content: center;
    padding: 0 12px;
  }
}

.mu-root .mu-favbar__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mu-root .mu-favbar__empty {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: tok(text-2);
  font-size: fs(13);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
