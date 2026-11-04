<script setup lang="ts">
/**
 * Icon of a group or an item from the set bundled with the theme, with a search by name; "no icon of its own" keeps
 * the icon of the module.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ICON_COMPONENTS, MENU_ICONS, type MenuIconName } from '../../menu/icons'

const props = defineProps<{ id: string; modelValue: MenuIconName | null; allowNone?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: MenuIconName | null] }>()

const { t } = useI18n()
const query = ref('')
const shown = computed(() => MENU_ICONS.filter((name) => name.includes(query.value.trim().toLowerCase())))
</script>

<template>
  <fieldset class="mu-icon-picker">
    <legend class="mu-field__label">{{ t('editor.icons.title') }}</legend>
    <input :id="id" v-model="query" class="mu-input mu-icon-picker__search" type="search" :placeholder="t('editor.icons.search')" :aria-label="t('editor.icons.search')" />
    <div class="mu-icon-picker__grid" role="group" :aria-label="t('editor.icons.title')">
      <button v-if="allowNone !== false" type="button" class="mu-icon-picker__icon mu-icon-picker__icon--none" :aria-pressed="props.modelValue === null" :title="t('editor.icons.none')" @click="emit('update:modelValue', null)">
        {{ t('editor.icons.noneShort') }}
      </button>
      <button v-for="name in shown" :key="name" type="button" class="mu-icon-picker__icon" :aria-pressed="props.modelValue === name" :aria-label="name" :title="name" :data-mu-icon="name" @click="emit('update:modelValue', name)">
        <component :is="ICON_COMPONENTS[name]" :size="18" aria-hidden="true" />
      </button>
    </div>
    <p v-if="shown.length === 0" class="mu-help">{{ t('editor.icons.nothing') }}</p>
  </fieldset>
</template>
