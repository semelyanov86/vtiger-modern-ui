<script setup lang="ts">
/**
 * Users and roles (docs/settings.md §1–§4): what users may change in their own preferences, the profiles of roles
 * (where a role takes its settings from, edited with the scope of the role) and the personal settings of users (an
 * administrator can only reset them). Common settings only. Nothing here changes the roles, profiles or permissions
 * of the CRM.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil, RotateCcw, Trash2 } from '@lucide/vue'
import { ApiError } from '../../api/guards'
import { deleteRoleProfile, resetUserSettings } from '../api'
import { ask } from '../confirm'
import type { Editor } from '../state'
import type { Problem, RoleInfo } from '../types'
import ScopedField from '../components/ScopedField.vue'

const props = defineProps<{ editor: Editor; problems: readonly Problem[] }>()
const emit = defineEmits<{ 'open-role': [role: string]; changed: [] }>()

const { t } = useI18n()

const data = computed(() => props.editor.data.value)
const overrides = computed(() => {
  const value = props.editor.effective('policy.userOverrides')
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
})

const usersById = computed(() => new Map(data.value.users.map((user) => [user.id, user])))
const rolesById = computed(() => new Map(data.value.roles.map((role) => [role.id, role])))
const userLabel = (id: number): string => {
  const user = usersById.value.get(id)
  if (user === undefined) {
    return t('editor.access.deletedUser', { id })
  }
  return user.name === '' ? user.userName : `${user.name} (${user.userName})`
}

function toggleOverride(key: string, checked: boolean): void {
  const next = checked ? [...overrides.value, key] : overrides.value.filter((entry) => entry !== key)
  props.editor.set('policy.userOverrides', props.editor.data.value.userOverridable.filter((entry) => next.includes(entry)))
}

// ---- Role profiles ----
function profileState(role: RoleInfo): string {
  if (role.profile !== null) {
    return role.profile.inherit ? t('editor.access.profileOwnInherit') : t('editor.access.profileOwn')
  }
  let parent = role.parent
  while (parent !== null) {
    const ancestor = rolesById.value.get(parent)
    if (ancestor === undefined) {
      break
    }
    if (ancestor.profile !== null) {
      return ancestor.profile.inherit ? t('editor.access.profileInherited', { role: ancestor.name }) : t('editor.access.profileCommon')
    }
    parent = ancestor.parent
  }
  return t('editor.access.profileCommon')
}

const message = ref<{ kind: 'success' | 'error'; text: string } | null>(null)

async function removeProfile(role: RoleInfo): Promise<void> {
  if (role.profile === null) {
    return
  }
  const ok = await ask({
    title: t('editor.access.removeProfile', { role: role.name }), text: t('editor.access.removeProfileConfirm', { role: role.name }),
    confirm: t('editor.access.removeProfileShort'), cancel: t('editor.dialog.cancel'), danger: true,
  })
  if (!ok) {
    return
  }
  try {
    await deleteRoleProfile(role.id, role.profile.revision)
    message.value = { kind: 'success', text: t('editor.access.profileRemoved', { role: role.name }) }
    emit('changed')
  } catch (error) {
    message.value = { kind: 'error', text: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }
  }
}

const personalUsers = computed(() => data.value.personal.map((id) => ({ id, label: userLabel(id) })))

async function resetPersonal(id: number, label: string): Promise<void> {
  const ok = await ask({
    title: t('editor.access.resetPersonalTitle'), text: t('editor.access.resetPersonalConfirm', { user: label }),
    confirm: t('editor.access.resetPersonal'), cancel: t('editor.dialog.cancel'), danger: true,
  })
  if (!ok) {
    return
  }
  try {
    await resetUserSettings(id)
    message.value = { kind: 'success', text: t('editor.access.personalReset', { user: label }) }
    emit('changed')
  } catch (error) {
    message.value = { kind: 'error', text: t(`errors.${error instanceof ApiError ? error.code : 'MU_UNKNOWN'}`) }
  }
}
</script>

<template>
  <div class="mu-section" data-mu-section="access">
    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.access.overridesTitle') }}</h3></header>
      <div class="mu-card__body mu-card__body--rows">
        <ScopedField v-slot="{ labelId }" :editor="editor" field="policy.userOverrides" :problems="problems" :label="t('fields.policy_userOverrides')" :help="t('editor.access.overridesHelp')">
          <div class="mu-check-grid" role="group" :aria-labelledby="labelId" data-mu-key="policy.userOverrides">
            <label v-for="key in editor.data.value.userOverridable" :key="key" class="mu-check">
              <input type="checkbox" :checked="overrides.includes(key)" :data-mu-override="key" @change="toggleOverride(key, ($event.target as HTMLInputElement).checked)" />
              <span>{{ t(`fields.${key.replace(/\./g, '_')}`) }}</span>
            </label>
          </div>
        </ScopedField>
      </div>
    </section>

    <p v-if="message !== null" :class="`mu-note mu-note--${message.kind === 'success' ? 'info' : 'warning'}`" role="status" data-mu-access-message>{{ message.text }}</p>

    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.access.rolesTitle') }}</h3></header>
      <div class="mu-card__body">
        <p class="mu-help">{{ t('editor.access.rolesHelp') }}</p>
        <div class="mu-table-scroll">
          <table class="mu-table" data-mu-table="roles">
            <thead>
              <tr><th scope="col">{{ t('editor.access.role') }}</th><th scope="col">{{ t('editor.access.usersCount') }}</th><th scope="col">{{ t('editor.access.profile') }}</th><th scope="col"><span class="mu-visually-hidden">{{ t('editor.access.actions') }}</span></th></tr>
            </thead>
            <tbody>
              <tr v-for="role in editor.data.value.roles.filter((entry) => !entry.root)" :key="role.id" :data-mu-role-row="role.id">
                <td :style="{ paddingLeft: `${12 + Math.max(0, role.depth - 1) * 16}px` }">{{ role.name }}<span v-if="role.missing" class="mu-badge mu-badge--warning">{{ t('editor.access.roleMissing') }}</span></td>
                <td>{{ t('editor.access.users', role.users) }}</td>
                <td><span :class="role.profile !== null ? 'mu-badge mu-badge--info' : 'mu-text-muted'">{{ profileState(role) }}</span></td>
                <td class="mu-table__actions">
                  <button v-if="!role.missing" type="button" class="mu-btn mu-btn--small" data-mu-action="open-role" @click="emit('open-role', role.id)">
                    <Pencil :size="13" aria-hidden="true" /><span>{{ role.profile !== null ? t('editor.access.editProfile') : t('editor.access.createProfile') }}</span>
                  </button>
                  <button v-if="role.profile !== null" type="button" class="mu-icon-btn" :aria-label="t('editor.access.removeProfile', { role: role.name })" :title="t('editor.access.removeProfile', { role: role.name })" data-mu-action="remove-profile" @click="removeProfile(role)"><Trash2 :size="14" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.access.personalTitle') }}</h3></header>
      <div class="mu-card__body">
        <p class="mu-help">{{ t('editor.access.personalHelp', personalUsers.length) }}</p>
        <ul class="mu-list" data-mu-list="personal">
          <li v-for="user in personalUsers" :key="user.id" class="mu-list__row">
            <span class="mu-item__label">{{ user.label }}</span>
            <button type="button" class="mu-btn mu-btn--small" data-mu-action="reset-personal" @click="resetPersonal(user.id, user.label)"><RotateCcw :size="13" aria-hidden="true" /><span>{{ t('editor.access.resetPersonal') }}</span></button>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
