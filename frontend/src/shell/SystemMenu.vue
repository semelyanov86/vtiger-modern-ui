<script setup lang="ts">
/**
 * System menu of the new interface in the v7 header (docs/settings.md §6.2 item 7): preferences, standard view, safe
 * mode, and for administrators the ModernUI and CRM settings and the users. It cannot be hidden by the menu settings,
 * so the way back to the standard view and to the settings always stays. Non-modal dropdown: it must not block the v7
 * header (Reka sets pointer-events:none on body for modal layers).
 */
import { useI18n } from 'vue-i18n'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import type { Bootstrap, SystemItem } from '../api/types'
import { SYSTEM_BUTTON_ICON, SYSTEM_ICONS, useSystemItems } from './nav/system'

const props = defineProps<{
  bootstrap: Bootstrap
  onStandardView: () => void
}>()

const { t } = useI18n()
const { labels, userItems, adminItems, busy, run } = useSystemItems(props.bootstrap, props.onStandardView)
const icons = SYSTEM_ICONS

function select(item: SystemItem, event: Event): void {
  if (item.kind === 'action') {
    event.preventDefault()
    void run(item)
  }
}
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger class="mu-system-menu__trigger" :aria-label="t('system.button')" :title="t('system.button')">
      <component :is="SYSTEM_BUTTON_ICON" :size="18" aria-hidden="true" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal to="#mu-overlay-root">
      <DropdownMenuContent class="mu-menu" align="end" :side-offset="6" :collision-padding="8">
        <DropdownMenuLabel class="mu-menu__label">{{ t('system.title') }}</DropdownMenuLabel>
        <template v-for="item in userItems" :key="item.id">
          <DropdownMenuItem v-if="item.kind === 'link'" as-child class="mu-menu__item">
            <a :href="item.url" :data-mu-item="item.id">
              <component :is="icons[item.id]" :size="15" aria-hidden="true" class="mu-menu__icon" />
              <span>{{ labels[item.id] }}</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem v-else class="mu-menu__item" :disabled="busy" :data-mu-item="item.id" @select="select(item, $event)">
            <component :is="icons[item.id]" :size="15" aria-hidden="true" class="mu-menu__icon" />
            <span>{{ labels[item.id] }}</span>
          </DropdownMenuItem>
        </template>
        <template v-if="adminItems.length > 0">
          <DropdownMenuSeparator class="mu-menu__separator" />
          <template v-for="item in adminItems" :key="item.id">
            <DropdownMenuItem v-if="item.kind === 'link'" as-child class="mu-menu__item">
              <a :href="item.url" :data-mu-item="item.id">
                <component :is="icons[item.id]" :size="15" aria-hidden="true" class="mu-menu__icon" />
                <span>{{ labels[item.id] }}</span>
              </a>
            </DropdownMenuItem>
          </template>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style lang="scss">
@use '../styles/tokens' as *;

.mu-root.mu-system-menu {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  // An icon of the main row of the header (56 px), like the action icons of the CRM next to it.
  height: 100%;
  min-width: 36px;
  color: tok(text-heading);
}

.mu-root .mu-system-menu__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: tok(radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  @include transition(color);

  &:hover,
  &[data-state='open'] {
    color: tok(link);
  }

  &:focus-visible {
    outline: none;
    @include focus-ring;
  }
}

.mu-root .mu-menu {
  min-width: 240px;
  max-width: 320px;
  padding: 4px 0;
  border: 1px solid tok(divider);
  border-radius: 4px;
  background: tok(surface);
  color: tok(text);
  box-shadow: 0 4px 16px rgba(28, 33, 33, 0.16);
}

.mu-root .mu-menu__label {
  padding: 8px 16px 4px;
  color: tok(text-label);
  font-size: calc(12px * #{tok(font-scale)});
  font-weight: 600;
}

.mu-root .mu-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: tok(menu-item-height);
  padding: 0 16px;
  color: tok(text);
  font-size: calc(13px * #{tok(font-scale)});
  line-height: 1.4;
  text-decoration: none;
  cursor: pointer;
  outline: none;
  user-select: none;

  &[data-highlighted] {
    background: tok(primary-soft);
    color: tok(text);
    text-decoration: none;
  }

  &[data-disabled] {
    opacity: 0.55;
    cursor: default;
  }
}

.mu-root .mu-menu__icon {
  flex: none;
  color: tok(text-2);
}

.mu-root .mu-menu__separator {
  height: 1px;
  margin: 4px 0;
  background: tok(divider);
}
</style>
