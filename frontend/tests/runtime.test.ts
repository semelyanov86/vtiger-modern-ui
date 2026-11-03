// @vitest-environment happy-dom
/* eslint-disable vue/one-component-per-file -- tiny render-function apps stand in for the islands */
/**
 * Island runtime (src/boot/runtime.ts) on a DOM: idempotent start, capability checks, cleanup of listeners,
 * app.event subscriptions and timers on unmount, remount after v7 re-renders a part of the page, the mount
 * limit, html[data-mu-replaced] only while the replacing island is mounted, isolation of a failing island.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'
import { IslandRuntime, MOUNT_LIMIT, type IslandDefinition, type IslandScope } from '../src/boot/runtime'

/** Minimal app.event of v7: a bus with on/off/trigger like jQuery({}). */
function installEventBus(): { handlers: Map<string, ((...args: unknown[]) => void)[]>; trigger: (name: string, ...args: unknown[]) => void } {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  const bus = {
    on(name: string, handler: (...args: unknown[]) => void) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
    off(name: string, handler: (...args: unknown[]) => void) {
      handlers.set(name, (handlers.get(name) ?? []).filter((item) => item !== handler))
    },
  }
  window.app = { event: bus }
  return {
    handlers,
    trigger: (name, ...args) => {
      for (const handler of handlers.get(name) ?? []) {
        handler({ type: name }, ...args)
      }
    },
  }
}

function header(): HTMLElement {
  document.body.innerHTML = '<div id="page"><nav class="app-fixed-navbar"><div id="navbar"><ul class="nav navbar-nav"><li>v7</li></ul></div></nav></div>'
  const navbar = document.getElementById('navbar')
  if (navbar === null) {
    throw new Error('no navbar')
  }
  return navbar
}

function island(id: string, extra: { replaces?: string; setup?: (scope: IslandScope) => void } = {}): IslandDefinition {
  return {
    id,
    ...(extra.replaces === undefined ? {} : { replaces: extra.replaces }),
    place: () => {
      const navbar = document.getElementById('navbar')
      return navbar === null ? null : { kind: 'insert' as const, parent: navbar, before: navbar.firstChild, className: `mu-${id}` }
    },
    create: (scope: IslandScope) => {
      extra.setup?.(scope)
      return createApp({ render: () => h('button', { class: 'mu-test' }, id) })
    },
  }
}

/** Lets the MutationObserver deliver and the animation frame run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => requestAnimationFrame(() => {
    resolve(undefined)
  }))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

let runtime: IslandRuntime

beforeEach(() => {
  runtime = new IslandRuntime()
  document.documentElement.removeAttribute('data-mu-replaced')
  document.documentElement.removeAttribute('data-mu-islands')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  runtime.stop()
  vi.restoreAllMocks()
  delete window.app
})

describe('island runtime', () => {
  it('mounts once into its own container, a second start or registration changes nothing', () => {
    const navbar = header()
    runtime.register(island('menu'))
    runtime.start()
    runtime.start()
    runtime.register(island('menu'))
    runtime.check()
    expect(navbar.querySelectorAll('[data-mu-root="menu"]')).toHaveLength(1)
    expect(navbar.querySelector('ul > [data-mu-root]')).toBeNull()
    expect(runtime.mountCount).toBe(1)
    expect(document.documentElement.getAttribute('data-mu-islands')).toBe('menu')
  })

  it('skips an island whose insertion point the screen does not offer', () => {
    document.body.innerHTML = '<div id="page"><div class="other-shell"></div></div>'
    runtime.register(island('menu'))
    runtime.start()
    expect(runtime.mountedIds()).toEqual([])
    expect(document.querySelector('[data-mu-root]')).toBeNull()
  })

  it('releases listeners, app.event subscriptions and timers on unmount', () => {
    header()
    const bus = installEventBus()
    const onClick = vi.fn()
    const onEvent = vi.fn()
    const onTimer = vi.fn()
    runtime.register(island('menu', {
      setup: (scope) => {
        scope.listen(document, 'click', onClick)
        scope.onAppEvent('post.listViewFilter.click', onEvent)
        scope.interval(onTimer, 10)
      },
    }))
    runtime.start()
    document.dispatchEvent(new Event('click'))
    bus.trigger('post.listViewFilter.click', 'x')
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith('x')
    runtime.stop()
    document.dispatchEvent(new Event('click'))
    bus.trigger('post.listViewFilter.click', 'y')
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(bus.handlers.get('post.listViewFilter.click')).toEqual([])
    expect(document.querySelector('[data-mu-root]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-mu-islands')).toBe(false)
  })

  it('mounts again after v7 re-rendered the part of the page, without duplicating handlers', async () => {
    header()
    const bus = installEventBus()
    runtime.register(island('menu', {
      setup: (scope) => {
        scope.onAppEvent('Vtiger.Post.MenuToggle', () => undefined)
      },
    }))
    runtime.start()
    // v7 (or an extension) replaces the whole header, our container goes with it.
    header()
    await settle()
    expect(document.querySelectorAll('[data-mu-root="menu"]')).toHaveLength(1)
    expect(runtime.mountCount).toBe(2)
    expect(bus.handlers.get('Vtiger.Post.MenuToggle')).toHaveLength(1)
    // Unrelated mutations do not mount again.
    document.body.appendChild(document.createElement('div'))
    await settle()
    expect(runtime.mountCount).toBe(2)
  })

  it('stops mounting an island whose container keeps disappearing', async () => {
    header()
    runtime.register(island('menu'))
    runtime.start()
    for (let round = 0; round < MOUNT_LIMIT + 3; round++) {
      document.querySelector('[data-mu-root="menu"]')?.remove()
      await settle()
    }
    expect(runtime.mountCount).toBe(MOUNT_LIMIT)
    expect(document.querySelector('[data-mu-root="menu"]')).toBeNull()
  })

  it('marks the replaced v7 element only while the replacing island is mounted', () => {
    header()
    const side = document.createElement('div')
    side.id = 'side'
    document.body.appendChild(side)
    runtime.register(island('nav', { replaces: 'app-menu' }))
    runtime.register({
      id: 'other',
      replaces: 'favorites',
      place: () => ({ kind: 'insert', parent: side, before: null, className: 'mu-other' }),
      create: () => createApp({ render: () => h('span', 'other') }),
    })
    runtime.start({ watch: false })
    expect(document.documentElement.getAttribute('data-mu-replaced')).toBe('app-menu favorites')
    // The header with the anchor of "nav" is gone: the original must come back, "nav" is not mounted again.
    document.querySelector('#page')?.remove()
    runtime.check()
    expect(runtime.mountedIds()).toEqual(['other'])
    expect(document.documentElement.getAttribute('data-mu-replaced')).toBe('favorites')
    runtime.stop()
    expect(document.documentElement.hasAttribute('data-mu-replaced')).toBe(false)
  })

  it('a failing island leaves nothing behind and does not stop the others', () => {
    const navbar = header()
    runtime.register({
      id: 'broken',
      replaces: 'app-menu',
      place: () => ({ kind: 'insert', parent: navbar, before: null, className: 'mu-broken' }),
      create: () => {
        throw new Error('boom')
      },
    })
    runtime.register(island('menu'))
    runtime.start()
    runtime.check()
    expect(runtime.mountedIds()).toEqual(['menu'])
    expect(document.querySelector('[data-mu-root="broken"]')).toBeNull()
    expect(document.documentElement.getAttribute('data-mu-replaced')).toBeNull()
  })

  it('never mounts a second Vue app into a server container that already has one', () => {
    document.body.innerHTML = '<div data-mu-root="diag" class="mu-root"></div>'
    const container = document.querySelector<HTMLElement>('[data-mu-root="diag"]')
    if (container === null) {
      throw new Error('no container')
    }
    const definition = { id: 'diag', place: () => ({ kind: 'existing' as const, container }), create: () => createApp({ render: () => h('p', 'x') }) }
    runtime.register(definition)
    runtime.start({ watch: false })
    const second = new IslandRuntime()
    second.register(definition)
    second.start({ watch: false })
    expect(second.mountedIds()).toEqual([])
    expect(container.querySelectorAll('p')).toHaveLength(1)
    second.stop()
  })
})
