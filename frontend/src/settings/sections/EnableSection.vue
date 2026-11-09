<script setup lang="ts">
/**
 * Switching on (docs/settings.md §3): who works in the new interface — nobody, a pilot of users and roles, everybody —
 * and what users may decide themselves. Common settings only; everything is a part of the draft and applies after
 * "Save" (the immediate switches of the server are in "Service"). Nothing here changes the roles, profiles or
 * permissions of the CRM: the pilot only chooses the interface.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, UserPlus, X } from '@lucide/vue'
import type { Editor } from '../state'
import type { Problem } from '../types'
import ScopedField from '../components/ScopedField.vue'

const props = defineProps<{ editor: Editor; problems: readonly Problem[] }>()

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
const meInPilot = computed(() => pilotUsers.value.includes(data.value.me))

function addUser(id?: number): void {
  const user = id ?? newUser.value ?? userChoices.value[0]?.id
  if (user !== undefined && !pilotUsers.value.includes(user)) {
    props.editor.set('theme.pilot.users', [...pilotUsers.value, user])
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

function setMode(value: string): void {
  props.editor.set('theme.mode', value)
}

const modeErrors = computed(() => props.problems.filter((problem) => problem.key === 'theme.mode'))
const pilotErrors = computed(() => props.problems.filter((problem) => problem.key === 'theme.pilot.users' || problem.key === 'theme.pilot.roles'))
</script>

<template>
  <div class="mu-section" data-mu-section="enable">
    <section class="mu-card" data-mu-key="theme.mode">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.enable.modeTitle') }}</h3></header>
      <div class="mu-card__body">
        <div class="mu-options" role="radiogroup" :aria-label="t('fields.theme_mode')">
          <label v-for="option in MODES" :key="option" class="mu-option" :class="{ 'mu-option--checked': mode === option }">
            <input type="radio" name="mu-mode" :value="option" :checked="mode === option" :data-mu-mode="option" @change="setMode(option)" />
            <span class="mu-option__text">
              <strong>{{ t(`editor.access.mode.${option}`) }}</strong>
              <span>{{ t(`editor.access.modeHelp.${option}`) }}</span>
            </span>
          </label>
        </div>
        <p v-for="error in modeErrors" :key="error.path" class="mu-field__error" role="alert">{{ t(`errors.${error.code}`) }}</p>
      </div>
    </section>

    <section v-if="mode !== 'all'" class="mu-card" data-mu-key="theme.pilot">
      <header class="mu-card__header">
        <h3 class="mu-card__title">{{ t('editor.access.pilotTitle') }}</h3>
        <button v-if="!meInPilot" type="button" class="mu-btn" data-mu-action="pilot-add-me" @click="addUser(data.me)">
          <UserPlus :size="14" aria-hidden="true" /><span>{{ t('editor.enable.addMe') }}</span>
        </button>
      </header>
      <div class="mu-card__body">
        <p class="mu-help">{{ mode === 'off' ? t('editor.enable.pilotOff') : t('editor.access.pilotHelp') }}</p>
        <p v-for="error in pilotErrors" :key="error.path" class="mu-field__error" role="alert">{{ t(`errors.${error.code}`) }}</p>
        <div class="mu-columns">
          <div class="mu-column" data-mu-key="theme.pilot.users">
            <h4 class="mu-column__title">{{ t('fields.theme_pilot_users') }}</h4>
            <ul class="mu-chips" data-mu-list="pilot-users">
              <li v-for="id in pilotUsers" :key="id" class="mu-chip" :data-mu-user="id">
                <span class="mu-chip__label">{{ userLabel(id) }}</span>
                <button type="button" class="mu-chip__remove" :aria-label="t('editor.access.removeFromPilot', { name: userLabel(id) })" @click="editor.set('theme.pilot.users', pilotUsers.filter((entry) => entry !== id))"><X :size="13" /></button>
              </li>
              <li v-if="pilotUsers.length === 0" class="mu-help">{{ t('editor.access.noPilotUsers') }}</li>
            </ul>
            <div v-if="userChoices.length > 0" class="mu-inline-field">
              <select v-model.number="newUser" class="mu-select" :aria-label="t('editor.access.chooseUser')" data-mu-field="pilot-user">
                <option :value="null" disabled>{{ t('editor.access.chooseUser') }}</option>
                <option v-for="user in userChoices" :key="user.id" :value="user.id">{{ user.name === '' ? user.userName : `${user.name} (${user.userName})` }}</option>
              </select>
              <button type="button" class="mu-btn" data-mu-action="pilot-add-user" @click="addUser()"><Plus :size="14" aria-hidden="true" /><span>{{ t('editor.access.add') }}</span></button>
            </div>
          </div>
          <div class="mu-column" data-mu-key="theme.pilot.roles">
            <h4 class="mu-column__title">{{ t('fields.theme_pilot_roles') }}</h4>
            <ul class="mu-chips" data-mu-list="pilot-roles">
              <li v-for="id in pilotRoles" :key="id" class="mu-chip" :data-mu-role="id">
                <span class="mu-chip__label">{{ roleLabel(id) }}</span>
                <button type="button" class="mu-chip__remove" :aria-label="t('editor.access.removeFromPilot', { name: roleLabel(id) })" @click="editor.set('theme.pilot.roles', pilotRoles.filter((entry) => entry !== id))"><X :size="13" /></button>
              </li>
              <li v-if="pilotRoles.length === 0" class="mu-help">{{ t('editor.access.noPilotRoles') }}</li>
            </ul>
            <div v-if="roleChoices.length > 0" class="mu-inline-field">
              <select v-model="newRole" class="mu-select" :aria-label="t('editor.access.chooseRole')" data-mu-field="pilot-role">
                <option :value="null" disabled>{{ t('editor.access.chooseRole') }}</option>
                <option v-for="role in roleChoices" :key="role.id" :value="role.id">{{ ' '.repeat(Math.max(0, role.depth - 1)) }}{{ role.name }}</option>
              </select>
              <button type="button" class="mu-btn" data-mu-action="pilot-add-role" @click="addRole"><Plus :size="14" aria-hidden="true" /><span>{{ t('editor.access.add') }}</span></button>
            </div>
            <label class="mu-check">
              <input type="checkbox" :checked="editor.effective('theme.pilot.includeSubordinates') !== false" data-mu-field="include-subordinates" @change="editor.set('theme.pilot.includeSubordinates', ($event.target as HTMLInputElement).checked)" />
              <span>{{ t('fields.theme_pilot_includeSubordinates') }}</span>
            </label>
          </div>
        </div>
      </div>
    </section>

    <section class="mu-card">
      <header class="mu-card__header"><h3 class="mu-card__title">{{ t('editor.access.usersTitle') }}</h3></header>
      <div class="mu-card__body mu-card__body--rows">
        <ScopedField v-slot="{ value, update }" :editor="editor" field="theme.allowOptOut" :problems="problems" :label="t('editor.enable.optOut')" label-for="mu-allow-opt-out">
          <label class="mu-switch">
            <input id="mu-allow-opt-out" type="checkbox" role="switch" :checked="value !== false" data-mu-field="allow-opt-out" @change="update(($event.target as HTMLInputElement).checked)" />
            <span>{{ t('fields.theme_allowOptOut') }}</span>
          </label>
        </ScopedField>
        <ScopedField v-slot="{ value, update }" :editor="editor" field="theme.allowSelfEnable" :problems="problems" :label="t('editor.enable.selfEnable')" label-for="mu-allow-self-enable">
          <label class="mu-switch">
            <input id="mu-allow-self-enable" type="checkbox" role="switch" :checked="value === true" data-mu-field="allow-self-enable" @change="update(($event.target as HTMLInputElement).checked)" />
            <span>{{ t('fields.theme_allowSelfEnable') }}</span>
          </label>
        </ScopedField>
      </div>
    </section>
  </div>
</template>
