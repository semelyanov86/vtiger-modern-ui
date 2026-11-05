// @vitest-environment happy-dom
/**
 * Navigation of the shell (stage 06): the section of the current page, the module search, the v7 app menu and module
 * strip compared with the theme menu (links of extensions kept, entries without a link keep the original), CRM links
 * from the v7 menus, the favorites store and the replacement of a v7 original decided at mount time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import type { Bootstrap, MenuGroup, MenuItem } from '../src/api/types'
import { crmLink, pageContext, type PageContext } from '../src/adapters/v7/page'
import { coveredBy, scanMenu } from '../src/adapters/v7/appMenu'
import { currentGroup, isCurrent, moduleItem, normalize, searchMenu } from '../src/shell/nav/model'
import { IslandRuntime, setReplaced } from '../src/boot/runtime'

vi.mock('../src/api/client', () => ({
  savePreferences: vi.fn((_values: Record<string, unknown>, revision?: number) => Promise.resolve((revision ?? 0) + 1)),
}))

function item(module: string, label: string, app: string | null = null, id = `m:${module}`): MenuItem {
  return { id, module, label, url: `index.php?module=${module}&view=List${app !== null ? `&app=${app}` : ''}`, icon: { kind: 'vicon', name: `vicon-${module.toLowerCase()}` } }
}

const groups: MenuGroup[] = [
  { id: 'marketing', label: 'Маркетинг', icon: 'megaphone', app: 'MARKETING', items: [item('Leads', 'Обращения', 'MARKETING'), item('Contacts', 'Контакты', 'MARKETING')] },
  { id: 'sales', label: 'Vertrieb', icon: 'target', app: 'SALES', items: [item('Contacts', 'Контакты', 'SALES'), item('Potentials', 'Größenänderungsübersicht', 'SALES')] },
  { id: 'mine', label: 'Mine', icon: 'star', app: null, items: [item('Calendar', 'Ёлки и встречи'), { ...item('Calendar', 'Мои звонки'), id: 'r:calls', url: 'index.php?module=Calendar&view=Calendar' }] },
]

function page(values: Partial<PageContext>): PageContext {
  return { module: '', view: 'List', parent: '', app: '', ...values }
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-mu-replaced')
  document.documentElement.removeAttribute('data-mu-islands')
  delete window._META
})

describe('section of the page', () => {
  it('prefers the group of the v7 app of the URL that has the module, then any group with it, then the app group', () => {
    expect(currentGroup(groups, page({ module: 'Contacts', app: 'SALES' }))?.id).toBe('sales')
    expect(currentGroup(groups, page({ module: 'Contacts', app: 'MARKETING' }))?.id).toBe('marketing')
    expect(currentGroup(groups, page({ module: 'Contacts' }))?.id).toBe('marketing')
    expect(currentGroup(groups, page({ module: 'Calendar', app: 'SALES' }))?.id).toBe('mine')
    expect(currentGroup(groups, page({ module: 'HiddenModule', app: 'SALES' }))?.id).toBe('sales')
    expect(currentGroup(groups, page({ module: 'HiddenModule' }))).toBeNull()
    expect(currentGroup(groups, page({}))).toBeNull()
  })

  it('marks the current entry: modules by module, view links also by view, never on settings pages', () => {
    const [leads] = groups[0]?.items ?? []
    const calls = groups[2]?.items[1]
    if (leads === undefined || calls === undefined) {
      throw new Error('fixture')
    }
    expect(isCurrent(leads, page({ module: 'Leads', view: 'Detail' }))).toBe(true)
    expect(isCurrent(leads, page({ module: 'Leads', parent: 'Settings' }))).toBe(false)
    expect(isCurrent(calls, page({ module: 'Calendar', view: 'Calendar' }))).toBe(true)
    expect(isCurrent(calls, page({ module: 'Calendar', view: 'List' }))).toBe(false)
  })

  it('reads _META of v7 (the app comes with a leading space) and falls back to the query string', () => {
    window._META = { module: 'Accounts', view: 'List', parent: '', app: ' MARKETING' }
    expect(pageContext({ search: '' })).toEqual({ module: 'Accounts', view: 'List', parent: '', app: 'MARKETING' })
    delete window._META
    expect(pageContext({ search: '?module=Leads&view=Detail&app=sales&record=5' })).toEqual({ module: 'Leads', view: 'Detail', parent: '', app: 'SALES' })
    expect(pageContext({ search: '?module=<x>' }).module).toBe('')
  })

  it('finds the menu entry of a module for the favorites (module entries only, not view links)', () => {
    expect(moduleItem({ groups, favorites: [] }, 'Calendar')?.id).toBe('m:Calendar')
    expect(moduleItem({ groups, favorites: [] }, 'Nope')).toBeNull()
  })
})

describe('module search', () => {
  it('normalises case, ё, ß and umlauts', () => {
    expect(normalize('  Größe  Ёлка ÜBER ')).toBe('grosse елка uber')
  })

  it('matches labels, group labels and system names; each module once; labels starting with the query first', () => {
    expect(searchMenu(groups, '').length).toBe(0)
    expect(searchMenu(groups, 'конт').map((result) => result.group.id)).toEqual(['marketing'])
    expect(searchMenu(groups, 'groessen').length).toBe(0)
    expect(searchMenu(groups, 'grossenanderung').map((result) => result.item.module)).toEqual(['Potentials'])
    expect(searchMenu(groups, 'елки').map((result) => result.item.module)).toEqual(['Calendar'])
    expect(searchMenu(groups, 'vertrieb').map((result) => result.item.module)).toEqual(['Contacts', 'Potentials'])
    expect(searchMenu(groups, 'potentials').map((result) => result.item.label)).toEqual(['Größenänderungsübersicht'])
    expect(searchMenu(groups, 'мои звон').map((result) => result.item.id)).toEqual(['r:calls'])
    expect(searchMenu(groups, 'ко').map((result) => result.item.label)).toEqual(['Контакты'])
    expect(searchMenu(groups, 'встреч').map((result) => result.item.label)).toEqual(['Ёлки и встречи'])
  })
})

describe('CRM links of the v7 menus', () => {
  const base = 'https://crm.example.org/vtigercrm/index.php?module=Home&view=DashBoard'

  it('accepts index.php links of this CRM in any spelling v7 uses, nothing else', () => {
    expect(crmLink('?module=Users&parent=Settings&view=List', base)).toBe('index.php?module=Users&parent=Settings&view=List')
    expect(crmLink('index.php?module=Leads&view=List&app=MARKETING', base)).toBe('index.php?module=Leads&view=List&app=MARKETING')
    expect(crmLink('https://crm.example.org/vtigercrm/index.php?module=X&view=List', base)).toBe('index.php?module=X&view=List')
    expect(crmLink('https://other.example.org/vtigercrm/index.php?module=X', base)).toBeNull()
    expect(crmLink('/elsewhere/index.php?module=X', base)).toBeNull()
    expect(crmLink('javascript:void(0)', base)).toBeNull()
    expect(crmLink('#', base)).toBeNull()
    expect(crmLink(null, base)).toBeNull()
  })
})

/** The app menu of SidebarAppMenu.tpl (8.4.0) with an entry of an extension. */
function appMenu(extra = ''): HTMLElement {
  document.body.innerHTML = `
    <div id="app-menu" class="app-menu hide">
      <div class="app-switcher-container"><div class="app-navigator"><span id="menu-toggle-action" class="app-icon fa fa-bars"></span></div></div>
      <div class="app-list row">
        <div class="menu-item app-item dropdown-toggle" data-default-url="index.php?module=Home&view=DashBoard"><div class="menu-items-wrapper"><span class="app-name"> Dashboard</span></div></div>
        <div class="dropdown app-modules-dropdown-container">
          <div class="menu-item app-item dropdown-toggle app-item-color-MARKETING" data-app-name="MARKETING" data-toggle="dropdown" data-default-url="#"><span class="app-name">Marketing</span></div>
          <ul class="dropdown-menu app-modules-dropdown">
            <li><a href="index.php?module=Leads&view=List&app=MARKETING" title="Leads"><span class="module-name"> Leads</span></a></li>
            <li><a href="index.php?module=Contacts&view=List&app=MARKETING"><span class="module-name">Contacts</span></a></li>
          </ul>
        </div>
        <div class="menu-item app-item app-item-misc" data-default-url="index.php?module=ExtensionStore&parent=Settings&view=ExtensionStore"><span class="app-name"> Extension Store</span></div>
        <div class="dropdown app-modules-dropdown-container dropdown-compact">
          <div class="menu-item app-item dropdown-toggle app-item-misc" data-app-name="TOOLS" data-default-url="#"><span class="app-name">Settings</span></div>
          <ul class="dropdown-menu app-modules-dropdown">
            <li><a href="?module=Vtiger&parent=Settings&view=Index"><span class="module-name">CRM Settings</span></a></li>
            <li><a href="?module=Users&parent=Settings&view=List"><span class="module-name">Manage Users</span></a></li>
          </ul>
        </div>
        ${extra}
      </div>
    </div>`
  const menu = document.getElementById('app-menu')
  if (menu === null) {
    throw new Error('no menu')
  }
  return menu
}

describe('v7 app menu against the theme menu', () => {
  const covered = coveredBy(['Home', 'Leads', 'Contacts'], true)

  it('the stock menu: everything covered except the extension store, no foreign entries', () => {
    const scan = scanMenu(appMenu(), covered)
    expect(scan.foreign).toEqual([])
    expect(scan.extras).toEqual([{ label: 'Extension Store', url: 'index.php?module=ExtensionStore&parent=Settings&view=ExtensionStore' }])
  })

  it('a hidden module stays hidden: links of modules the user may open are covered even when the menu hides them', () => {
    const scan = scanMenu(appMenu(), coveredBy(['Home', 'Leads'], true))
    expect(scan.extras.map((extra) => extra.url)).toContain('index.php?module=Contacts&view=List&app=MARKETING')
    expect(scanMenu(appMenu(), covered).extras.map((extra) => extra.url)).not.toContain('index.php?module=Contacts&view=List&app=MARKETING')
  })

  it('links of extensions become entries with the label v7 shows, once; a button with a handler is foreign', () => {
    const scan = scanMenu(appMenu(`
      <div class="menu-item app-item" data-default-url="index.php?module=MyAddon&view=Board"><span class="app-name">  My   Addon </span></div>
      <a href="index.php?module=MyAddon&view=Board">duplicate</a>
      <button type="button" class="ct-launcher">Launch</button>`), covered)
    expect(scan.extras).toContainEqual({ label: 'My Addon', url: 'index.php?module=MyAddon&view=Board' })
    expect(scan.extras.filter((extra) => extra.url.includes('MyAddon'))).toHaveLength(1)
    expect(scan.foreign).toEqual(['button.ct-launcher'])
  })

  it('settings entries are covered for administrators only', () => {
    const user = scanMenu(appMenu(), coveredBy(['Home', 'Leads', 'Contacts'], false))
    expect(user.extras.map((extra) => extra.url)).toEqual(expect.arrayContaining(['index.php?module=Vtiger&parent=Settings&view=Index', 'index.php?module=Users&parent=Settings&view=List']))
  })
})

describe('favorites store', () => {
  function bootstrap(allowed: string[], favorites: MenuItem[], enabled = true): Bootstrap {
    return {
      menu: { system: [], groups, favorites, favoritesEnabled: enabled, compact: false, modules: [] },
      personal: { values: {}, allowed, revision: 4, inherited: {} },
    } as unknown as Bootstrap
  }

  it('adds and removes with the revision of the page; shown when the user may add favorites', async () => {
    const { createFavorites } = await import('../src/shell/nav/favorites')
    const { savePreferences } = await import('../src/api/client')
    const store = createFavorites(bootstrap(['navigation.favorites'], []))
    expect(store.visible).toBe(true)
    const leads = item('Leads', 'Обращения')
    expect(await store.toggle(leads)).toBe('added')
    expect(savePreferences).toHaveBeenLastCalledWith({ 'navigation.favorites': ['Leads'] }, 4)
    expect(store.has('Leads')).toBe(true)
    expect(await store.toggle(leads)).toBe('removed')
    expect(savePreferences).toHaveBeenLastCalledWith({ 'navigation.favorites': [] }, 5)
    expect(store.items.value).toEqual([])
  })

  it('without the policy: no changes, the bar only when there are favorites; disabled favorites: no bar', async () => {
    const { createFavorites } = await import('../src/shell/nav/favorites')
    expect(createFavorites(bootstrap([], [])).visible).toBe(false)
    const readonly = createFavorites(bootstrap([], [item('Leads', 'Leads')]))
    expect(readonly.visible).toBe(true)
    expect(readonly.canEdit).toBe(false)
    await expect(readonly.toggle(item('Contacts', 'Contacts'))).rejects.toThrow()
    expect(createFavorites(bootstrap(['navigation.favorites'], [item('Leads', 'Leads')], false)).visible).toBe(false)
  })

  it('refuses a 31st favorite', async () => {
    const { createFavorites } = await import('../src/shell/nav/favorites')
    const many = Array.from({ length: 30 }, (_, index) => item(`M${String(index)}`, `M${String(index)}`))
    const store = createFavorites(bootstrap(['navigation.favorites'], many))
    expect(store.full.value).toBe(true)
    await expect(store.toggle(item('Extra', 'Extra'))).rejects.toThrow()
  })
})

describe('replacement decided at mount time', () => {
  function island(id: string, replaces: () => string | null) {
    document.body.innerHTML = '<div id="slot"></div>'
    return {
      id,
      place: () => {
        const slot = document.getElementById('slot')
        return slot === null ? null : { kind: 'insert' as const, parent: slot, before: null, className: id }
      },
      replaces,
      create: () => createApp({ render: () => h('span', id) }),
    }
  }

  it('hides the original only when the check allows it, and setReplaced follows later changes', () => {
    const runtime = new IslandRuntime()
    runtime.register(island('menu', () => 'app-menu'))
    runtime.start({ watch: false })
    expect(document.documentElement.getAttribute('data-mu-replaced')).toBe('app-menu')
    setReplaced('app-menu', false)
    expect(document.documentElement.hasAttribute('data-mu-replaced')).toBe(false)
    setReplaced('app-menu', true)
    runtime.stop()
    expect(document.documentElement.hasAttribute('data-mu-replaced')).toBe(false)

    const keep = new IslandRuntime()
    keep.register(island('menu2', () => null))
    keep.start({ watch: false })
    expect(document.documentElement.getAttribute('data-mu-islands')).toBe('menu2')
    expect(document.documentElement.hasAttribute('data-mu-replaced')).toBe(false)
    keep.stop()
  })
})
