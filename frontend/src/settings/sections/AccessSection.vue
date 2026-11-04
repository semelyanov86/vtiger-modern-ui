<script setup lang="ts">
/**
 * Users and roles (docs/settings.md §1–§4): who gets the new interface (off, pilot users and roles, everybody), what
 * users may change themselves, the profiles of roles, personal settings of users. Common settings only: role profiles
 * are edited in the appearance, menu and compatibility sections with the scope of a role. Nothing here changes the
 * roles, profiles or permissions of the CRM.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2 } from '@lucide/vue'
import { ApiError } from '../../api/guards'
import { deleteRoleProfile, resetUserSettings } from '../api'
import type { Editor } from '../state'
import type { Problem, RoleInfo } from '../types'
import ScopedField from '../components/ScopedField.vue'

const props = defineProps<{ editor: Editor; problems: readonly Problem[] }>()
const emit = defineEmits<{ 'open-role': [role: string]; changed: [] }>()

const { t } = useI18n()
const MODES = ['off', 'pilot', 'all'] as const

const data = computed(() => props.editor.data.value)
const mode = computed(() => {
  const value = props.editor.effective('theme.mode')
  return typeof value === 'string' ? value : 'off'
})
const ids = (key: string): number[] => {
  const value = props.editor.effective(key)
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : []
}
const strings = (key: string): string[] => {
  const value = props.editor.effective(key)
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
const pilotUsers = computed(() => ids('theme.pilot.users'))
const pilotRoles = computed(() => strings('theme.pilot.roles'))
const overrides = computed(() => strings('policy.userOverrides'))

const usersById = computed(() => new Map(data.value.users.map((user) => [user.id, user])))
const rolesById = computed(() => new Map(data.value.roles.map((role) => [role.id, role])))
const userLabel = (id: number): string => {
  const user = usersById.value.get(id)
  if (user === undefined) {
    return t('editor.access.deletedUser', { id })
  }
  return user.name === '' ? user.userName : `${user.name} (${user.userName})`
}
const roleLabel = (id: string): string => rolesById.value.get(id)?.name ?? id

const userChoices = computed(() => data.value.users.filter((user) => user.active && !pilotUsers.value.includes(user.id)))
const roleChoices = computed(() => data.value.roles.filter((role) => !role.root && !role.missing && !pilotRoles.value.includes(role.id)))
const newUser = ref<number | null>(null)
const newRole = ref<string | null>(null)

function addUser(): void {
  const id = newUser.value ?? userChoices.value[0]?.id
  if (id !== undefined) {
    props.editor.set('theme.pilot.users', [...pilotUsers.value, id])
    newUser.value = null
  }
}

function addRole(): void {
  const id = newRole.value ?? roleChoices.value[0]?.id
  if (id !== undefined) {
    props.editor.set('theme.pilot.roles', [...pilotRoles.value, id])
    newRole.value = null
  }
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
  if (role.profile === null || !window.confirm(t('editor.access.removeProfileConfirm', { role: role.name }))) {
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
  if (!window.confirm(t('editor.access.resetPersonalConfirm', { user: label }))) {
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

const pilotErrors = computed(() => props.problems.filter((problem) => problem.key === 'theme.pilot.users' || problem.key === 'theme.pilot.roles'))
</script>

<template>
  <div class="mu-section" data-mu-section="access">
    <p v-if="editor.isRole.value" class="mu-note">{{ t('editor.access.commonOnly') }}</p>
    <template v-else>
      <ScopedField v-slot="{ value, update }" :editor="editor" field="theme.mode" :problems="problems" :legend="t('fields.theme_mode')">
        <fieldset class="mu-choice">
          <legend class="mu-field__label">{{ t('fields.theme_mode') }}</legend>
          <label v-for="option in MODES" :key="option" class="mu-check mu-check--block">
            <input type="radio" name="mu-mode" :value="option" :checked="value === option" :data-mu-mode="option" @change="update(option)" />
            <span><strong>{{ t(`editor.access.mode.${option}`) }}</strong> — {{ t(`editor.access.modeHelp.${option}`) }}</span>
          </label>
        </fieldset>
      </ScopedField>

      <section v-if="mode !== 'all'" class="mu-subsection" data-mu-key="theme.pilot">
        <h3 class="mu-section__heading">{{ t('editor.access.pilotTitle') }}</h3>
        <p class="mu-help">{{ t('editor.access.pilotHelp') }}</p>
        <p v-for="error in pilotErrors" :key="error.path" class="mu-field__error" role="alert">{{ t(`errors.${error.code}`) }}</p>
        <div class="mu-grid">
          <div>
            <h4 class="mu-field__label">{{ t('fields.theme_pilot_users') }}</h4>
            <ul class="mu-plain-list" data-mu-list="pilot-users">
              <li v-for="id in pilotUsers" :key="id" :data-mu-user="id">
                <span class="mu-item__label">{{ userLabel(id) }}</span>
                <button type="button" class="mu-icon-btn" :aria-label="t('editor.access.removeFromPilot', { name: userLabel(id) })" @click="editor.set('theme.pilot.users', pilotUsers.filter((entry) => entry !== id))"><Trash2 :size="14" /></button>
              </li>
              <li v-if="pilotUsers.length === 0" class="mu-help">{{ t('editor.access.noPilotUsers') }}</li>
            </ul>
            <div v-if="userChoices.length > 0" class="mu-inline-field">
              <select v-model.number="newUser" class="mu-select" :aria-label="t('editor.access.chooseUser')" data-mu-field="pilot-user">
                <option :value="null" disabled>{{ t('editor.access.chooseUser') }}</option>
                <option v-for="user in userChoices" :key="user.id" :value="user.id">{{ user.name === '' ? user.userName : `${user.name} (${user.userName})` }}</option>
              </select>
              <button type="button" class="mu-btn" data-mu-action="pilot-add-user" @click="addUser"><Plus :size="14" aria-hidden="true" /><span>{{ t('editor.access.add') }}</span></button>
            </div>
          </div>
          <div>
            <h4 class="mu-field__label">{{ t('fields.theme_pilot_roles') }}</h4>
            <ul class="mu-plain-list" data-mu-list="pilot-roles">
              <li v-for="id in pilotRoles" :key="id" :data-mu-role="id">
                <span class="mu-item__label">{{ roleLabel(id) }}</span>
                <button type="button" class="mu-icon-btn" :aria-label="t('editor.access.removeFromPilot', { name: roleLabel(id) })" @click="editor.set('theme.pilot.roles', pilotRoles.filter((entry) => entry !== id))"><Trash2 :size="14" /></button>
              </li>
              <li v-if="pilotRoles.length === 0" class="mu-help">{{ t('editor.access.noPilotRoles') }}</li>
            </ul>
            <div v-if="roleChoices.length > 0" class="mu-inline-field">
              <select v-model="newRole" class="mu-select" :aria-label="t('editor.access.chooseRole')" data-mu-field="pilot-role">
                <option :value="null" disabled>{{ t('editor.access.chooseRole') }}</option>
                <option v-for="role in roleChoices" :key="role.id" :value="role.id">{{ ' '.repeat(Math.max(0, role.depth - 1)) }}{{ role.name }}</option>
              </select>
              <button type="button" class="mu-btn" data-mu-action="pilot-add-role" @click="addRole"><Plus :size="14" aria-hidden="true" /><span>{{ t('editor.access.add') }}</span></button>
            </div>
            <label class="mu-check">
              <input type="checkbox" :checked="editor.effective('theme.pilot.includeSubordinates') !== false" @change="editor.set('theme.pilot.includeSubordinates', ($event.target as HTMLInputElement).checked)" />
              <span>{{ t('fields.theme_pilot_includeSubordinates') }}</span>
            </label>
          </div>
        </div>
      </section>

      <section class="mu-subsection">
        <h3 class="mu-section__heading">{{ t('editor.access.usersTitle') }}</h3>
        <label class="mu-check">
          <input type="checkbox" :checked="editor.effective('theme.allowOptOut') !== false" data-mu-field="allow-opt-out" @change="editor.set('theme.allowOptOut', ($event.target as HTMLInputElement).checked)" />
          <span>{{ t('fields.theme_allowOptOut') }}</span>
        </label>
        <label class="mu-check">
          <input type="checkbox" :checked="editor.effective('theme.allowSelfEnable') === true" data-mu-field="allow-self-enable" @change="editor.set('theme.allowSelfEnable', ($event.target as HTMLInputElement).checked)" />
          <span>{{ t('fields.theme_allowSelfEnable') }}</span>
        </label>
        <fieldset class="mu-choice" data-mu-key="policy.userOverrides">
          <legend class="mu-field__label">{{ t('fields.policy_userOverrides') }}</legend>
          <label v-for="key in editor.data.value.userOverridable" :key="key" class="mu-check">
            <input type="checkbox" :checked="overrides.includes(key)" :data-mu-override="key" @change="toggleOverride(key, ($event.target as HTMLInputElement).checked)" />
            <span>{{ t(`fields.${key.replace(/\./g, '_')}`) }}</span>
          </label>
        </fieldset>
      </section>

      <p v-if="message !== null" :class="`mu-text-${message.kind}`" role="status">{{ message.text }}</p>

      <section class="mu-subsection">
        <h3 class="mu-section__heading">{{ t('editor.access.rolesTitle') }}</h3>
        <p class="mu-help">{{ t('editor.access.rolesHelp') }}</p>
        <div class="mu-table-scroll">
          <table class="mu-table" data-mu-table="roles">
            <thead>
              <tr><th scope="col">{{ t('editor.access.role') }}</th><th scope="col">{{ t('editor.access.usersCount') }}</th><th scope="col">{{ t('editor.access.profile') }}</th><th scope="col"><span class="mu-visually-hidden">{{ t('editor.access.actions') }}</span></th></tr>
            </thead>
            <tbody>
              <tr v-for="role in editor.data.value.roles.filter((entry) => !entry.root)" :key="role.id" :data-mu-role-row="role.id">
                <td :style="{ paddingLeft: `${8 + Math.max(0, role.depth - 1) * 16}px` }">{{ role.name }}<span v-if="role.missing" class="mu-badge mu-badge--warning">{{ t('editor.access.roleMissing') }}</span></td>
                <td>{{ t('editor.access.users', role.users) }}</td>
                <td>{{ profileState(role) }}</td>
                <td class="mu-table__actions">
                  <button v-if="!role.missing" type="button" class="mu-btn mu-btn--small" data-mu-action="open-role" @click="emit('open-role', role.id)">{{ role.profile !== null ? t('editor.access.editProfile') : t('editor.access.createProfile') }}</button>
                  <button v-if="role.profile !== null" type="button" class="mu-icon-btn" :aria-label="t('editor.access.removeProfile', { role: role.name })" data-mu-action="remove-profile" @click="removeProfile(role)"><Trash2 :size="14" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mu-subsection">
        <h3 class="mu-section__heading">{{ t('editor.access.personalTitle') }}</h3>
        <p class="mu-help">{{ t('editor.access.personalHelp', personalUsers.length) }}</p>
        <ul class="mu-plain-list" data-mu-list="personal">
          <li v-for="user in personalUsers" :key="user.id">
            <span class="mu-item__label">{{ user.label }}</span>
            <button type="button" class="mu-btn mu-btn--small" @click="resetPersonal(user.id, user.label)">{{ t('editor.access.resetPersonal') }}</button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
