import { describe, expect, it } from 'vitest'
import tokenFixture from '../../tests/fixtures/tokens.json'
import { ApiError, errorCodeOf, parseBootstrap } from '../src/api/guards'

/** An answer as ModernUI_Client_Model::bootstrap() builds it. */
function sample(): Record<string, unknown> {
  return {
    v: 1,
    build: '81c488e57615',
    module: '0.1.0',
    user: { isAdmin: true, crmLanguage: 'ru_ru' },
    locale: { effective: 'ru-RU', source: 'crm', default: 'auto' },
    theme: { active: true, reason: 'OK', mode: 'pilot', canOptOut: true, canSelfEnable: false, cacheKey: '9586a976e10a' },
    appearance: {
      primaryColor: '#3978fe', background: '#eff0f2', surface: '#ffffff', density: 'standard', fontScale: 100, font: 'inter',
      tokens: { ...tokenFixture.cases[0]?.tokens },
    },
    menu: {
      system: [
        { id: 'preferences', url: 'index.php?module=ModernUI&view=Preferences' },
        { id: 'standardView', action: 'standardView' },
        { id: 'safeMode', url: 'index.php?modernui=off' },
        { id: 'moduleSettings', url: 'index.php?module=ModernUI&parent=Settings&view=Index' },
      ],
      groups: [
        { id: 'sales', label: 'Продажи', icon: 'target', items: [
          { id: 'm:Leads', module: 'Leads', label: 'Обращения', url: 'index.php?module=Leads&view=List&app=SALES', icon: { kind: 'vicon', name: 'vicon-leads' } },
          { id: 'm:Gadgets', module: 'Gadgets', label: 'Gadgets', url: 'index.php?module=Gadgets&view=List', icon: { kind: 'letters', text: 'Ga' } },
          { id: 'r:my_calls', module: 'Calendar', label: 'Мои звонки', url: 'index.php?module=Calendar&view=List&viewname=12', icon: { kind: 'lucide', name: 'phone' } },
          { id: 'm:Custom', module: 'Custom', label: 'Custom', url: 'index.php?module=Custom&view=List', icon: { kind: 'image', src: 'layouts/v7/modules/Custom/Custom.png' } },
        ] },
      ],
      favorites: [],
      favoritesEnabled: true,
      compact: false,
    },
    branding: { logoUrl: null, title: null },
    personal: { values: {}, allowed: ['locale', 'user.standardView'], revision: 0, inherited: { locale: 'auto' } },
  }
}

/** Changes the first item of the first menu group of a sample. */
function menuItem(data: Record<string, unknown>, change: Record<string, unknown>): void {
  const menu = data['menu'] as { groups: { items: Record<string, unknown>[] }[] }
  const first = menu.groups[0]?.items[0]
  if (first !== undefined) {
    Object.assign(first, change)
  }
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return error instanceof ApiError ? `${error.code} ${error.detail}` : 'other'
  }
  return 'none'
}

describe('runtime checks of the Bootstrap answer', () => {
  it('accept the answer of the server', () => {
    const data = parseBootstrap(sample())
    expect(data.locale.effective).toBe('ru-RU')
    expect(data.menu.system.map((item) => item.kind)).toEqual(['link', 'action', 'link', 'link'])
    expect(data.menu.groups[0]?.items.map((item) => item.icon.kind)).toEqual(['vicon', 'letters', 'lucide', 'image'])
    expect(data.branding).toEqual({ logoUrl: null, title: null, notice: null })
    const custom = sample()
    custom['branding'] = { logoUrl: `public.php?type=logo&key=modernui_${'a'.repeat(40)}.png`, title: 'Fußgängerübergänge' }
    expect(parseBootstrap(custom).branding.title).toBe('Fußgängerübergänge')
  })

  it('reject wrong types, unknown values and unsafe URLs with the path of the field', () => {
    const cases: [string, (data: Record<string, unknown>) => void, string][] = [
      ['version', (d) => { d['v'] = 2 }, 'result.v'],
      ['locale', (d) => { d['locale'] = { effective: 'fr-FR', source: 'crm' } }, 'locale.effective'],
      ['colour', (d) => { d['appearance'] = { ...(d['appearance'] as object), primaryColor: 'red' } }, 'appearance.primaryColor'],
      ['token', (d) => { d['appearance'] = { ...(d['appearance'] as object), tokens: { ...tokenFixture.cases[0]?.tokens, bg: 'url(x)' } } }, 'appearance.tokens.bg'],
      ['no tokens', (d) => { d['appearance'] = { ...(d['appearance'] as object), tokens: undefined } }, 'appearance.tokens'],
      ['script URL', (d) => { d['menu'] = { ...(d['menu'] as object), system: [{ id: 'preferences', url: 'javascript:alert(1)' }] } }, 'menu.system[0].url'],
      ['other origin', (d) => { d['menu'] = { ...(d['menu'] as object), system: [{ id: 'preferences', url: '//example.org/index.php?x=1' }] } }, 'menu.system[0].url'],
      ['unknown item', (d) => { d['menu'] = { ...(d['menu'] as object), system: [{ id: 'logout', url: 'index.php?a=1' }] } }, 'menu.system[0].id'],
      ['flag', (d) => { d['theme'] = { ...(d['theme'] as object), active: 'yes' } }, 'theme.active'],
      ['revision', (d) => { d['personal'] = { values: {}, allowed: [], revision: -1, inherited: {} } }, 'personal.revision'],
      ['menu script URL', (d) => { menuItem(d, { url: 'javascript:alert(1)' }) }, 'menu.groups[0].items[0].url'],
      ['menu other origin', (d) => { menuItem(d, { url: 'https://example.org/index.php?module=Leads' }) }, 'menu.groups[0].items[0].url'],
      ['menu HTML label', (d) => { menuItem(d, { label: '<img src=x onerror=alert(1)>' }) }, 'menu.groups[0].items[0].label'],
      ['menu icon outside layouts', (d) => { menuItem(d, { icon: { kind: 'image', src: 'layouts/../../config.inc.php' } }) }, 'menu.groups[0].items[0].icon.src'],
      ['menu unknown icon', (d) => { menuItem(d, { icon: { kind: 'lucide', name: 'skull' } }) }, 'menu.groups[0].items[0].icon.name'],
      ['menu vicon class', (d) => { menuItem(d, { icon: { kind: 'vicon', name: 'vicon-x" onclick="x' } }) }, 'menu.groups[0].items[0].icon.name'],
      ['logo URL', (d) => { d['branding'] = { logoUrl: 'https://example.org/logo.png', title: null } }, 'branding.logoUrl'],
      ['logo name', (d) => { d['branding'] = { logoUrl: 'public.php?type=logo&key=../config.inc.php', title: null } }, 'branding.logoUrl'],
      ['default locale', (d) => { d['locale'] = { effective: 'ru-RU', source: 'crm', default: 'fr-FR' } }, 'locale.default'],
    ]
    for (const [name, change, path] of cases) {
      const data = sample()
      change(data)
      expect(codeOf(() => parseBootstrap(data)), name).toBe(`MU_BAD_RESPONSE ${path}`)
    }
    expect(codeOf(() => parseBootstrap(null))).toBe('MU_BAD_RESPONSE result')
  })

  it('map error answers to known codes', () => {
    expect(errorCodeOf({ success: false, error: { code: 'MU_CONFLICT' } })).toBe('MU_CONFLICT')
    // A refusal of the core (permission, CSRF, Referer) has a message instead of a MU_ code.
    expect(errorCodeOf({ success: false, error: { code: 'Permission denied', message: 'Permission denied' } })).toBe('MU_REJECTED')
    expect(errorCodeOf({ success: false, error: { code: 'MU_SOMETHING_NEW' } })).toBe('MU_UNKNOWN')
    expect(errorCodeOf('<html>')).toBe('MU_BAD_RESPONSE')
  })
})
