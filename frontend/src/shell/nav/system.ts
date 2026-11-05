/**
 * System section of the new interface (docs/settings.md §6.2 item 7): preferences, standard view, safe mode, and for
 * administrators the ModernUI and CRM settings and the users. Shared by the system menu in the header and the
 * service column of the mega menu; it cannot be hidden by the menu settings, so the way back to the standard view
 * and to the settings always stays.
 */
import { computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { MonitorCog, Palette, Settings, ShieldCheck, SlidersHorizontal, Undo2, Users } from '@lucide/vue'
import type { Bootstrap, SystemItem, SystemItemId } from '../../api/types'
import { savePreferences } from '../../api/client'
import { ApiError } from '../../api/guards'
import { notify } from '../../adapters/v7/host'

export const SYSTEM_ICONS: Readonly<Record<SystemItemId, Component>> = {
  preferences: SlidersHorizontal,
  standardView: Undo2,
  safeMode: ShieldCheck,
  moduleSettings: Palette,
  crmSettings: Settings,
  users: Users,
}

export const SYSTEM_BUTTON_ICON = MonitorCog

const ADMIN_ITEMS: readonly SystemItemId[] = ['moduleSettings', 'crmSettings', 'users']

export function useSystemItems(bootstrap: Bootstrap, onStandardView: () => void) {
  const { t } = useI18n()
  const busy = ref(false)

  const labels = computed<Readonly<Record<SystemItemId, string>>>(() => ({
    preferences: t('system.preferences'),
    standardView: t('system.standardView'),
    safeMode: t('system.safeMode'),
    moduleSettings: t('system.moduleSettings'),
    crmSettings: t('system.crmSettings'),
    users: t('system.users'),
  }))

  const userItems = computed(() => bootstrap.menu.system.filter((item) => !ADMIN_ITEMS.includes(item.id)))
  const adminItems = computed(() => bootstrap.menu.system.filter((item) => ADMIN_ITEMS.includes(item.id)))

  /** Runs an action item (the standard view): saves the personal choice and removes the theme from this page. */
  async function run(item: SystemItem): Promise<void> {
    if (item.kind !== 'action' || busy.value) {
      return
    }
    busy.value = true
    try {
      await savePreferences({ 'user.standardView': true })
      onStandardView()
      notify('success', t('notify.standardViewOn'))
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'MU_UNKNOWN'
      notify('error', t('notify.actionFailed', { reason: t(`errors.${code}`) }))
    } finally {
      busy.value = false
    }
  }

  return { labels, userItems, adminItems, busy, run }
}
