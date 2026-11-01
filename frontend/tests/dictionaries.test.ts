import { describe, expect, it } from 'vitest'
import shared from '../../tests/fixtures/shared-messages.json'
import { messages } from '../src/i18n'
import { THEME_LOCALES } from '../src/i18n/locale'

function flatten(node: unknown, prefix = ''): Map<string, string> {
  const result = new Map<string, string>()
  if (typeof node === 'string') {
    result.set(prefix, node)
    return result
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      for (const [path, text] of flatten(value, prefix === '' ? key : `${prefix}.${key}`)) {
        result.set(path, text)
      }
    }
  }
  return result
}

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1] ?? ''))].sort()
}

const english = flatten(messages['en-US'])

describe('Vue dictionaries RU/EN/DE', () => {
  it('have the same keys, placeholders and plural shape as en-US, without empty texts', () => {
    for (const locale of THEME_LOCALES) {
      const dictionary = flatten(messages[locale])
      expect([...dictionary.keys()].sort(), locale).toEqual([...english.keys()].sort())
      for (const [key, text] of dictionary) {
        const source = english.get(key) ?? ''
        expect(text.trim(), `${locale} ${key}`).not.toBe('')
        expect(placeholders(text), `${locale} ${key}`).toEqual(placeholders(source))
        const forms = text.split(' | ').length
        const englishForms = source.split(' | ').length
        if (englishForms > 1) {
          const allowed = locale === 'ru-RU' ? [3, 4] : [englishForms]
          expect(allowed, `${locale} ${key}: ${String(forms)} plural forms`).toContain(forms)
        } else {
          expect(forms, `${locale} ${key}`).toBe(1)
        }
      }
    }
  })

  it('German and Russian are translations, not copies of English', () => {
    const same = new Set(shared.sameInAllLanguages.vue)
    for (const locale of ['de-DE', 'ru-RU'] as const) {
      for (const [key, text] of flatten(messages[locale])) {
        if (!same.has(key)) {
          expect(text, `${locale} ${key}`).not.toBe(english.get(key))
        }
      }
    }
    expect([...flatten(messages['de-DE']).values()].join(' ')).toMatch(/[äöüß]/)
  })

  it('contain no HTML (messages are rendered as text)', () => {
    for (const locale of THEME_LOCALES) {
      for (const [key, text] of flatten(messages[locale])) {
        expect(text, `${locale} ${key}`).not.toMatch(/<[a-z/]/i)
      }
    }
  })
})
