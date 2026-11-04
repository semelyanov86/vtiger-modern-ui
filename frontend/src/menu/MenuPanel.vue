<script setup lang="ts">
/**
 * The menu of a user as the server built it (docs/settings.md §6.2): favorites first, then the groups with their
 * modules. Used by the menu of the new interface and by the preview of the settings editor (preview: entries are not
 * links). Labels are text (never HTML); long labels end with an ellipsis and keep the full text in title.
 */
import { useI18n } from 'vue-i18n'
import type { Menu } from '../api/types'
import { ICON_COMPONENTS } from './icons'
import ModuleIcon from './ModuleIcon.vue'

withDefaults(defineProps<{ menu: Pick<Menu, 'groups' | 'favorites' | 'favoritesEnabled' | 'compact'>; preview?: boolean }>(), { preview: false })

const { t } = useI18n()
</script>

<template>
  <div class="mu-menu-panel">
    <section v-if="menu.favoritesEnabled && menu.favorites.length > 0" class="mu-menu-panel__favorites" :class="{ 'mu-menu-panel__favorites--compact': menu.compact }" :aria-label="t('menu.favorites')">
      <h3 class="mu-menu-panel__heading">{{ t('menu.favorites') }}</h3>
      <ul class="mu-menu-panel__chips">
        <li v-for="item in menu.favorites" :key="item.id">
          <component :is="preview ? 'span' : 'a'" class="mu-menu-panel__chip" :href="preview ? undefined : item.url" :title="item.label" :aria-label="menu.compact ? item.label : undefined">
            <ModuleIcon :icon="item.icon" :size="15" />
            <span v-if="!menu.compact" class="mu-menu-panel__text">{{ item.label }}</span>
          </component>
        </li>
      </ul>
    </section>
    <div v-if="menu.groups.length > 0" class="mu-menu-panel__groups">
      <section v-for="group in menu.groups" :key="group.id" class="mu-menu-panel__group" :aria-label="group.label" :data-mu-group="group.id">
        <h3 class="mu-menu-panel__heading">
          <component :is="ICON_COMPONENTS[group.icon]" :size="15" aria-hidden="true" />
          <span class="mu-menu-panel__text" :title="group.label">{{ group.label }}</span>
        </h3>
        <ul class="mu-menu-panel__items">
          <li v-for="item in group.items" :key="item.id">
            <component :is="preview ? 'span' : 'a'" class="mu-menu-panel__item" :href="preview ? undefined : item.url" :title="item.label" :data-mu-item="item.id">
              <ModuleIcon :icon="item.icon" :size="15" />
              <span class="mu-menu-panel__text">{{ item.label }}</span>
            </component>
          </li>
        </ul>
      </section>
    </div>
    <p v-else class="mu-menu-panel__empty">{{ t('menu.empty') }}</p>
  </div>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

.mu-root .mu-menu-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: tok(text);
}

.mu-root .mu-menu-panel__heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0 0 4px;
  color: tok(text-heading);
  font-size: calc(13px * #{tok(font-scale)});
  font-weight: 600;
  line-height: 1.4;
}

.mu-root .mu-menu-panel__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mu-root .mu-menu-panel__chips,
.mu-root .mu-menu-panel__items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mu-root .mu-menu-panel__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.mu-root .mu-menu-panel__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid tok(border);
  border-radius: 15px;
  background: tok(surface);
  color: tok(text);
  text-decoration: none;
}

.mu-root .mu-menu-panel__favorites--compact .mu-menu-panel__chip {
  width: 32px;
  padding: 0;
  justify-content: center;
}

.mu-root .mu-menu-panel__groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px 20px;
}

.mu-root .mu-menu-panel__group {
  min-width: 0;
}

.mu-root .mu-menu-panel__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: calc(32px * #{tok(font-scale)});
  padding: 0 8px;
  border-radius: 4px;
  color: tok(text);
  font-size: calc(13px * #{tok(font-scale)});
  text-decoration: none;
}

.mu-root a.mu-menu-panel__item,
.mu-root a.mu-menu-panel__chip {
  &:hover {
    background: tok(surface-readonly);
    color: tok(text);
    text-decoration: none;
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px tok(focus-ring);
  }
}

.mu-root .mu-menu-panel__empty {
  margin: 0;
  color: tok(text-2);
}
</style>
