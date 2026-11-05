/**
 * Favorites of the current user (navigation.favorites, docs/settings.md §4): shared by the favorites bar and the mega
 * menu. Adding and removing a module saves the personal setting with the revision of the page (a change in another
 * tab answers MU_CONFLICT instead of overwriting it). Only modules of the menu can be added: the server checks the
 * permissions again and refuses anything else.
 */
import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue'
import type { Bootstrap, MenuItem } from '../../api/types'
import { savePreferences } from '../../api/client'

/** Same limit as the schema (docs/settings.md §4). */
export const FAVORITES_LIMIT = 30

export interface FavoritesStore {
  readonly enabled: boolean
  /** The policy lets the user change the favorites (policy.userOverrides). */
  readonly canEdit: boolean
  readonly compact: boolean
  /** The bar is shown (also empty, when the user may add favorites). Fixed for the page: it is part of the layout. */
  readonly visible: boolean
  readonly items: Ref<readonly MenuItem[]>
  readonly busy: Ref<boolean>
  readonly full: ComputedRef<boolean>
  has(module: string): boolean
  /** Adds or removes the module; rejects with ApiError (the caller shows it). */
  toggle(item: MenuItem): Promise<'added' | 'removed'>
}

export function createFavorites(data: Bootstrap): FavoritesStore {
  const enabled = data.menu.favoritesEnabled
  const canEdit = enabled && data.personal.allowed.includes('navigation.favorites')
  const items = shallowRef<readonly MenuItem[]>(enabled ? data.menu.favorites : [])
  const busy = ref(false)
  let revision = data.personal.revision

  const has = (module: string): boolean => items.value.some((item) => item.module === module)

  async function toggle(item: MenuItem): Promise<'added' | 'removed'> {
    if (!canEdit || busy.value) {
      throw new Error('favorites are not editable now')
    }
    const removing = has(item.module)
    const next = removing ? items.value.filter((entry) => entry.module !== item.module) : [...items.value, item]
    if (!removing && next.length > FAVORITES_LIMIT) {
      throw new Error('favorites are full')
    }
    busy.value = true
    try {
      revision = await savePreferences({ 'navigation.favorites': next.map((entry) => entry.module) }, revision)
      items.value = next
      return removing ? 'removed' : 'added'
    } finally {
      busy.value = false
    }
  }

  return {
    enabled,
    canEdit,
    compact: data.menu.compact,
    visible: enabled && (items.value.length > 0 || canEdit),
    items,
    busy,
    full: computed(() => items.value.length >= FAVORITES_LIMIT),
    has,
    toggle,
  }
}
