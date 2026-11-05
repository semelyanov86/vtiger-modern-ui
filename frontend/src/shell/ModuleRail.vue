<script setup lang="ts">
/**
 * Module rail of the current section (docs/design.md §5.1): the dark strip on the left of v7 (#modnavigator) shows the
 * modules of the current v7 app; with the theme it shows the modules of the section of the menu settings that has the
 * page, in their order and with their labels — hidden modules stay hidden there too. Same place and size as the v7
 * strip, hidden on narrow screens like it (hidden-xs, hidden-sm). Ordinary links with the label in title and
 * aria-label.
 */
import { useI18n } from 'vue-i18n'
import type { MenuGroup } from '../api/types'
import type { PageContext } from '../adapters/v7/page'
import ModuleIcon from '../menu/ModuleIcon.vue'
import { isCurrent } from './nav/model'

defineProps<{ group: MenuGroup; page: PageContext }>()

const { t } = useI18n()
</script>

<template>
  <nav class="mu-rail" :aria-label="t('rail.label', { group: group.label })" :data-mu-group="group.id">
    <ul class="mu-rail__list">
      <li v-for="item in group.items" :key="item.id + item.url">
        <a
          class="mu-rail__link"
          :href="item.url"
          :title="item.label"
          :aria-label="item.label"
          :aria-current="isCurrent(item, page) ? 'page' : undefined"
          :data-mu-item="item.id"
        >
          <ModuleIcon :icon="item.icon" :size="18" />
        </a>
      </li>
    </ul>
  </nav>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

// The v7 strip is hidden only while this island is mounted (docs/architecture.md §7.3).
html[data-mu-replaced~='module-rail'] #modnavigator > .mod-switcher-container {
  display: none !important;
}

.mu-root.mu-rail-root {
  width: 100%;
  height: 100%;
}

.mu-root .mu-rail {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: none;
}

.mu-root .mu-rail__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mu-root .mu-rail__link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 42px;
  color: tok(nav-dark-text);
  text-decoration: none;
  @include transition(background-color);

  .mu-module-icon {
    color: inherit;
    opacity: 0.85;
  }

  &:hover {
    background: tok(nav-dark-2);
    color: #ffffff;

    .mu-module-icon {
      opacity: 1;
    }
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px tok(nav-dark-text);
  }

  &[aria-current='page'] {
    background: tok(nav-dark-2);
    box-shadow: inset 3px 0 0 tok(primary);

    .mu-module-icon {
      opacity: 1;
    }

    &:focus-visible {
      box-shadow: inset 3px 0 0 tok(primary), inset 0 0 0 2px tok(nav-dark-text);
    }
  }
}
</style>
