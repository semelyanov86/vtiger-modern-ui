/**
 * Adapters of public extensions on a page (docs/architecture.md §7.6): the screen rules of the active adapters and the
 * start of their client parts. Every client part runs in its own scope; a failing one is stopped and logged, the page,
 * the other adapters and the islands are not affected. html[data-mu-adapters] lists the adapters running on the page.
 */
import type { ActiveAdapter, ScreenLevel } from '../api/types'
import type { PageContext } from '../adapters/v7/page'
import type { ExtensionAdapter } from '../adapters/ext/types'
import { createScope, setHtmlToken } from './runtime'

const ATTRIBUTE = 'data-mu-adapters'

/** Level the screen rules of the active adapters give the page (null: no rule matches). "standard" wins over "skin". */
export function adapterScreenLevel(adapters: readonly ActiveAdapter[], page: PageContext): ScreenLevel | null {
  let level: ScreenLevel | null = null
  for (const adapter of adapters) {
    for (const screen of adapter.screens) {
      const match = (rule: string, value: string): boolean => rule === '*' || rule.toLowerCase() === value.toLowerCase()
      if (match(screen.module, page.module) && match(screen.view, page.view) && match(screen.parent, page.parent)) {
        if (level === null || screen.level === 'standard') {
          level = screen.level
        }
      }
    }
  }
  return level
}

export interface RunningAdapters {
  /** Ids of the client parts that started. */
  readonly started: readonly string[]
  stop(): void
}

/**
 * Loads and starts the client parts of the active adapters.
 * @param adapters Bootstrap adapters[]
 * @param loaders client parts by id (src/adapters/ext/index.ts)
 */
export async function startAdapters(
  adapters: readonly ActiveAdapter[],
  page: PageContext,
  loaders: Readonly<Partial<Record<string, () => Promise<ExtensionAdapter>>>>,
): Promise<RunningAdapters> {
  const scopes: { id: string; dispose: () => void }[] = []
  const started: string[] = []
  for (const active of adapters) {
    const load = loaders[active.id]
    if (!active.script || load === undefined) {
      continue
    }
    const context = { page, version: active.version }
    let scope: ReturnType<typeof createScope> | null = null
    try {
      const adapter = await load()
      if (!adapter.supports(context)) {
        continue
      }
      scope = createScope(`adapter:${active.id}`)
      adapter.start(scope, context)
      scopes.push({ id: active.id, dispose: () => { scope?.dispose() } })
      started.push(active.id)
      setHtmlToken(ATTRIBUTE, active.id, true)
    } catch (error) {
      scope?.dispose()
      setHtmlToken(ATTRIBUTE, active.id, false)
      console.warn(`[ModernUI] adapter ${active.id} stopped:`, error)
    }
  }
  return {
    started,
    stop: () => {
      for (const entry of scopes.reverse()) {
        try {
          entry.dispose()
        } finally {
          setHtmlToken(ATTRIBUTE, entry.id, false)
        }
      }
      scopes.length = 0
    },
  }
}
