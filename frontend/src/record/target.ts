/**
 * Which navigations of a list page become "the record over the list" (docs/architecture.md A15). Pure functions,
 * covered by unit tests.
 */

const RECORD_ID = /^[1-9][0-9]{0,18}$/

/** Parameters of a record URL that do not change what is shown (v7 adds the app of the menu). */
const NEUTRAL = new Set(['module', 'view', 'record', 'app', 'parenttab'])

export interface RecordTarget {
  readonly module: string
  readonly record: string
}

/**
 * The record a destination URL opens: index.php?module=<module>&view=Detail&record=<id> of this CRM (same origin and
 * path as the page), with no parameters other than the app of the menu. Anything else (a mode, a related tab, another
 * module, another page) stays a normal navigation.
 */
export function recordTarget(destination: string, module: string, base: string = document.baseURI): RecordTarget | null {
  let url: URL
  let root: URL
  try {
    url = new URL(destination, base)
    root = new URL('index.php', base)
  } catch {
    return null
  }
  if (url.origin !== root.origin || url.pathname !== root.pathname || url.hash !== '') {
    return null
  }
  const params = url.searchParams
  const record = params.get('record') ?? ''
  if (params.get('module') !== module || params.get('view') !== 'Detail' || !RECORD_ID.test(record)) {
    return null
  }
  for (const name of params.keys()) {
    if (!NEUTRAL.has(name)) {
      return null
    }
  }
  return { module, record }
}

/** Key of the overlay in history.state (the rest of the state belongs to the page and is kept). */
export const STATE_KEY = 'muRecord'

export function stateRecord(state: unknown, module: string): string | null {
  if (typeof state !== 'object' || state === null) {
    return null
  }
  const entry: unknown = Reflect.get(state, STATE_KEY)
  if (typeof entry !== 'object' || entry === null) {
    return null
  }
  const entryModule: unknown = Reflect.get(entry, 'module')
  const record: unknown = Reflect.get(entry, 'record')
  return entryModule === module && typeof record === 'string' && RECORD_ID.test(record) ? record : null
}

export function withRecord(state: unknown, target: RecordTarget | null): Record<string, unknown> {
  const base: Record<string, unknown> = typeof state === 'object' && state !== null ? { ...(state as Record<string, unknown>) } : {}
  if (target === null) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete base[STATE_KEY]
  } else {
    base[STATE_KEY] = { module: target.module, record: target.record }
  }
  return base
}

/** Full page of the record (the direct link): the same URL v7 builds, without the app parameter. */
export function recordUrl(target: RecordTarget): string {
  return `index.php?module=${encodeURIComponent(target.module)}&view=Detail&record=${target.record}`
}
