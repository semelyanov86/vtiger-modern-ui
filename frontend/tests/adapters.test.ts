// @vitest-environment happy-dom
/**
 * Adapters of extensions on a page (src/boot/adapters.ts): screen rules of the active adapters, client parts that start
 * only where their markup exists, a failing client part that is stopped without touching the others, the cleanup.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActiveAdapter } from '../src/api/types'
import type { ExtensionAdapter } from '../src/adapters/ext/types'
import { adapterScreenLevel, startAdapters } from '../src/boot/adapters'

const page = { module: 'Addon', view: 'Board', parent: '', app: '' }

function active(id: string, screens: ActiveAdapter['screens'] = [], script = true): ActiveAdapter {
  return { id, module: 'Addon', version: '2.1', script, screens }
}

describe('adapter screen rules', () => {
  it('skin and standard by module, view and parent; "*" matches anything; standard wins', () => {
    expect(adapterScreenLevel([active('a', [{ module: 'Addon', view: 'board', parent: '', level: 'skin' }])], page)).toBe('skin')
    expect(adapterScreenLevel([active('a', [{ module: 'Addon', view: 'Designer', parent: '*', level: 'skin' }])], page)).toBeNull()
    expect(adapterScreenLevel([
      active('a', [{ module: '*', view: 'Board', parent: '*', level: 'skin' }]),
      active('b', [{ module: 'Addon', view: '*', parent: '', level: 'standard' }]),
    ], page)).toBe('standard')
    expect(adapterScreenLevel([], page)).toBeNull()
  })
})

describe('client parts of adapters', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-mu-adapters')
    document.body.innerHTML = ''
  })

  it('starts only the adapters whose markup is on the page, releases their listeners on stop', async () => {
    document.body.innerHTML = '<div id="addon-buttons"></div>'
    const clicks: string[] = []
    const present: ExtensionAdapter = {
      id: 'present',
      supports: () => document.getElementById('addon-buttons') !== null,
      start: (scope) => {
        scope.listen(document, 'click', () => clicks.push('present'))
      },
    }
    const absentStart = vi.fn()
    const absent: ExtensionAdapter = { id: 'absent', supports: () => document.getElementById('nothing') !== null, start: absentStart }
    const running = await startAdapters([active('present'), active('absent'), active('styled', [], false)], page, {
      present: () => Promise.resolve(present),
      absent: () => Promise.resolve(absent),
    })
    expect(running.started).toEqual(['present'])
    expect(absentStart).not.toHaveBeenCalled()
    expect(document.documentElement.getAttribute('data-mu-adapters')).toBe('present')
    document.body.click()
    running.stop()
    document.body.click()
    expect(clicks).toEqual(['present'])
    expect(document.documentElement.hasAttribute('data-mu-adapters')).toBe(false)
  })

  it('a client part that throws is stopped and logged; the next one still starts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const timers: string[] = []
    const broken: ExtensionAdapter = {
      id: 'broken',
      supports: () => true,
      start: (scope) => {
        scope.interval(() => timers.push('tick'), 10)
        throw new Error('markup changed')
      },
    }
    const fine: ExtensionAdapter = { id: 'fine', supports: () => true, start: () => undefined }
    const running = await startAdapters([active('broken'), active('missing'), active('fine')], page, {
      broken: () => Promise.resolve(broken),
      missing: () => Promise.reject(new Error('chunk not loaded')),
      fine: () => Promise.resolve(fine),
    })
    expect(running.started).toEqual(['fine'])
    expect(document.documentElement.getAttribute('data-mu-adapters')).toBe('fine')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(timers).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
    running.stop()
    warn.mockRestore()
  })
})
