// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { withLiveResponse } from '../src/adapters/ext/controllayoutfields'

describe('native conditional-layout responses', () => {
  it('keeps the native transport and delivers a live response unchanged', () => {
    let respond: (...values: unknown[]) => unknown = () => undefined
    const post = vi.fn(() => ({ then: (callback: typeof respond) => { respond = callback } }))
    const requests = { post }
    const callback = vi.fn()
    withLiveResponse(requests, () => true, () => { requests.post().then(callback) })
    expect(requests.post).toBe(post)
    const result = { record_info: {}, clf_info: [] }
    respond(null, result)
    expect(callback).toHaveBeenCalledExactlyOnceWith(null, result)
    expect(post).toHaveBeenCalledOnce()
  })

  it('ignores a delayed response after the card was closed or its tab replaced', () => {
    let live = true
    let respond: (...values: unknown[]) => unknown = () => undefined
    const requests = { post: () => ({ then: (callback: typeof respond) => { respond = callback } }) }
    const callback = vi.fn()
    withLiveResponse(requests, () => live, () => { requests.post().then(callback) })
    live = false
    respond(null, { record_info: {} })
    expect(callback).not.toHaveBeenCalled()
  })

  it('restores the original transport when the native initializer throws', () => {
    const post = vi.fn()
    const requests = { post }
    expect(() => { withLiveResponse(requests, () => true, () => { throw new Error('native failure') }) }).toThrow('native failure')
    expect(requests.post).toBe(post)
  })
})
