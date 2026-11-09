<script setup lang="ts">
/**
 * Whom the settings being edited apply to (docs/design.md §13.12), as the view selector of the cloud list (a white
 * 36 px button with an icon and a caret over a panel): everybody (the common settings), the profile of a role — with
 * a search when the CRM has many roles — and, for the person's own choices, a link to the personal preferences.
 * Choosing only reports the scope; the page asks about an unsaved draft before switching.
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { Check, ChevronDown, Search, User, Users } from '@lucide/vue'
import type { RoleInfo, ScopeRef } from '../types'

const props = defineProps<{ scope: ScopeRef; roles: readonly RoleInfo[] }>()
const emit = defineEmits<{ select: [scope: ScopeRef] }>()

const { t } = useI18n()
const open = ref(false)
const query = ref('')
const search = ref<HTMLInputElement | null>(null)

const choices = computed(() => props.roles.filter((role) => !role.root && !role.missing))
const shown = computed(() => {
  const text = query.value.trim().toLocaleLowerCase()
  return text === '' ? choices.value : choices.value.filter((role) => role.name.toLocaleLowerCase().includes(text))
})
const current = computed(() => {
  const scope = props.scope
  return scope.kind === 'global' ? t('editor.scope.global') : t('editor.scope.role', { name: props.roles.find((role) => role.id === scope.role)?.name ?? scope.role })
})

function choose(scope: ScopeRef): void {
  open.value = false
  query.value = ''
  emit('select', scope)
}

async function opened(value: boolean): Promise<void> {
  open.value = value
  if (value) {
    await nextTick()
    search.value?.focus()
  }
}

function isCurrent(role: string | null): boolean {
  return role === null ? props.scope.kind === 'global' : props.scope.kind === 'role' && props.scope.role === role
}
</script>

<template>
  <PopoverRoot :open="open" @update:open="opened">
    <PopoverTrigger class="mu-scope-button" data-mu-field="scope" :aria-label="t('editor.scope.button', { scope: current })">
      <component :is="scope.kind === 'global' ? Users : User" :size="15" aria-hidden="true" />
      <span class="mu-scope-button__text">{{ current }}</span>
      <ChevronDown :size="14" aria-hidden="true" />
    </PopoverTrigger>
    <PopoverPortal to="#mu-overlay-root">
      <PopoverContent class="mu-popover mu-scope-panel" side="bottom" align="start" :side-offset="4" data-mu-panel="scope">
        <div class="mu-scope-panel__search">
          <Search :size="14" aria-hidden="true" />
          <input ref="search" v-model="query" class="mu-input" type="search" :placeholder="t('editor.scope.search')" :aria-label="t('editor.scope.search')" data-mu-field="scope-search" />
        </div>
        <ul class="mu-scope-panel__list" role="listbox" :aria-label="t('editor.scope.label')">
          <li>
            <button type="button" role="option" class="mu-scope-panel__item" :aria-selected="isCurrent(null)" data-mu-scope="global" @click="choose({ kind: 'global' })">
              <Users :size="15" aria-hidden="true" />
              <span><strong>{{ t('editor.scope.global') }}</strong><small>{{ t('editor.scope.globalHelp') }}</small></span>
              <Check v-if="isCurrent(null)" :size="15" class="mu-scope-panel__check" aria-hidden="true" />
            </button>
          </li>
          <li class="mu-scope-panel__caption">{{ t('editor.scope.rolesCaption') }}</li>
          <li v-for="role in shown" :key="role.id">
            <button
              type="button" role="option" class="mu-scope-panel__item" :aria-selected="isCurrent(role.id)" :data-mu-scope="role.id"
              :style="{ paddingLeft: `${12 + Math.max(0, role.depth - 1) * 12}px` }" @click="choose({ kind: 'role', role: role.id })"
            >
              <span class="mu-scope-panel__role">{{ role.name }}</span>
              <span v-if="role.profile !== null" class="mu-badge mu-badge--info">{{ t('editor.scope.hasProfile') }}</span>
              <Check v-if="isCurrent(role.id)" :size="15" class="mu-scope-panel__check" aria-hidden="true" />
            </button>
          </li>
          <li v-if="shown.length === 0" class="mu-scope-panel__empty">{{ t('editor.scope.noRoles') }}</li>
        </ul>
        <a class="mu-scope-panel__personal" href="index.php?module=ModernUI&amp;view=Preferences" data-mu-scope="personal">
          <User :size="15" aria-hidden="true" />
          <span><strong>{{ t('editor.scope.personal') }}</strong><small>{{ t('editor.scope.personalHelp') }}</small></span>
        </a>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
