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
    locale: { effective: 'ru-RU', source: 'crm' },
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
    },
    personal: { values: {}, allowed: ['locale', 'user.standardView'], revision: 0 },
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
  })

  it('reject wrong types, unknown values and unsafe URLs with the path of the field', () => {
    const cases: [string, (data: Record<string, unknown>) => void, string][] = [
      ['version', (d) => { d['v'] = 2 }, 'result.v'],
      ['locale', (d) => { d['locale'] = { effective: 'fr-FR', source: 'crm' } }, 'locale.effective'],
      ['colour', (d) => { d['appearance'] = { ...(d['appearance'] as object), primaryColor: 'red' } }, 'appearance.primaryColor'],
      ['token', (d) => { d['appearance'] = { ...(d['appearance'] as object), tokens: { ...tokenFixture.cases[0]?.tokens, bg: 'url(x)' } } }, 'appearance.tokens.bg'],
      ['no tokens', (d) => { d['appearance'] = { ...(d['appearance'] as object), tokens: undefined } }, 'appearance.tokens'],
      ['script URL', (d) => { d['menu'] = { system: [{ id: 'preferences', url: 'javascript:alert(1)' }] } }, 'menu.system[0].url'],
      ['other origin', (d) => { d['menu'] = { system: [{ id: 'preferences', url: '//example.org/index.php?x=1' }] } }, 'menu.system[0].url'],
      ['unknown item', (d) => { d['menu'] = { system: [{ id: 'logout', url: 'index.php?a=1' }] } }, 'menu.system[0].id'],
      ['flag', (d) => { d['theme'] = { ...(d['theme'] as object), active: 'yes' } }, 'theme.active'],
      ['revision', (d) => { d['personal'] = { values: {}, allowed: [], revision: -1 } }, 'personal.revision'],
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
    expect(errorCodeOf({ success: false, error: { code: 'SOMETHING_ELSE' } })).toBe('MU_UNKNOWN')
    expect(errorCodeOf('<html>')).toBe('MU_BAD_RESPONSE')
  })
})
