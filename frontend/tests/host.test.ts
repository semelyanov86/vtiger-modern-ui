// @vitest-environment happy-dom
/**
 * Readiness of the v7 host page (src/adapters/v7/host.ts): the shell waits for the ready queue of jQuery, and still starts
 * after the load event when a ready handler of the page broke that queue (jQuery 1.x stops it at the first exception).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostReady } from '../src/adapters/v7/host'

type Ready = (callback: () => void) => void

function setJQuery(ready: Ready | undefined): void {
  Object.defineProperty(window, 'jQuery', { value: ready, configurable: true, writable: true })
}

describe('hostReady', () => {
  afterEach(() => {
    setJQuery(undefined)
    vi.useRealTimers()
  })

  it('resolves through the ready queue of jQuery', async () => {
    const queue: (() => void)[] = []
    setJQuery((callback) => queue.push(callback))
    let resolved = false
    const ready = hostReady().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    for (const callback of queue) {
      callback()
    }
    await ready
    expect(resolved).toBe(true)
  })

  it('a broken ready queue (the callback never runs): resolves once the page has loaded', async () => {
    vi.useFakeTimers()
    setJQuery(() => undefined)
    let resolved = false
    const ready = hostReady().then(() => {
      resolved = true
    })
    if (document.readyState !== 'complete') {
      window.dispatchEvent(new Event('load'))
    }
    await vi.runAllTimersAsync()
    await ready
    expect(resolved).toBe(true)
  })
})
