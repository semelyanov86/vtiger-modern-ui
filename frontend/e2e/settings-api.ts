/**
 * Direct requests to the actions of ModernUI from a signed-in page (the CSRF token of the page, like the islands
 * send it): the data of the editor, saves, Bootstrap. Used to prepare and check states and to prove what the server
 * refuses (forbidden keys, other users' ids, missing CSRF token, wrong method).
 */
import { expect, type Page } from '@playwright/test'
import { crmUrl } from './env'

export interface ApiAnswer {
  status: number
  ok: boolean
  result: Record<string, unknown>
  error: { code?: unknown; params?: Record<string, unknown> } | null
  text: string
}

async function answer(response: { status(): number; text(): Promise<string> }): Promise<ApiAnswer> {
  const text = await response.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return {
    status: response.status(),
    ok: record['success'] === true,
    result: (record['result'] ?? {}) as Record<string, unknown>,
    error: (record['error'] ?? null),
    text,
  }
}

/** The csrf-magic token of the current page (a full CRM page). */
export async function csrfToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => (window as unknown as { csrfMagicToken?: unknown }).csrfMagicToken)
  expect(typeof token, 'CSRF token on the page').toBe('string')
  return String(token)
}

export async function post(page: Page, form: Record<string, string>, withToken = true): Promise<ApiAnswer> {
  const token = withToken ? await csrfToken(page) : null
  const response = await page.request.post('index.php', {
    form: token === null ? form : { ...form, __vtrftk: token },
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${crmUrl()}index.php` },
  })
  return answer(response)
}

export async function get(page: Page, params: Record<string, string>): Promise<ApiAnswer> {
  const response = await page.request.get(`index.php?${new URLSearchParams(params).toString()}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${crmUrl()}index.php` },
  })
  return answer(response)
}

export interface Scope {
  values: Record<string, unknown>
  revision: number
}

export async function editorData(page: Page): Promise<Record<string, unknown>> {
  const data = await get(page, { module: 'ModernUI', parent: 'Settings', action: 'Data' })
  expect(data.ok, `editor data: ${data.text.slice(0, 200)}`).toBe(true)
  return data.result
}

export async function globalScope(page: Page): Promise<Scope> {
  const data = await editorData(page)
  const global = data['global'] as { values: Record<string, unknown>; revision: number }
  return { values: global.values, revision: global.revision }
}

export async function saveGlobal(page: Page, values: Record<string, unknown>, baseRevision?: number): Promise<ApiAnswer> {
  const revision = baseRevision ?? (await globalScope(page)).revision
  return post(page, {
    module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: 'global', role: '',
    values: JSON.stringify(values), baseRevision: String(revision), inherit: '0',
  })
}

/** Changes some keys of the global document (null removes a key). */
export async function patchGlobal(page: Page, changes: Record<string, unknown>): Promise<void> {
  const current = await globalScope(page)
  const values = { ...current.values }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete values[key]
    } else {
      values[key] = value
    }
  }
  const saved = await saveGlobal(page, values, current.revision)
  expect(saved.ok, `save global: ${saved.text.slice(0, 300)}`).toBe(true)
}

export async function bootstrap(page: Page): Promise<Record<string, unknown>> {
  const data = await get(page, { module: 'ModernUI', action: 'Bootstrap' })
  expect(data.ok, `Bootstrap: ${data.text.slice(0, 200)}`).toBe(true)
  return data.result
}

export async function savePersonal(page: Page, values: Record<string, unknown>, extra: Record<string, string> = {}): Promise<ApiAnswer> {
  return post(page, { module: 'ModernUI', action: 'Preferences', mode: 'save', values: JSON.stringify(values), ...extra })
}

export async function clearPersonal(page: Page): Promise<void> {
  const cleared = await post(page, { module: 'ModernUI', action: 'Preferences', mode: 'clear' })
  expect(cleared.ok, cleared.text.slice(0, 200)).toBe(true)
}

/** Modules of the menu of a Bootstrap answer, group by group. */
export function menuModules(data: Record<string, unknown>): string[] {
  const menu = data['menu'] as { groups: { items: { module: string; id: string }[] }[] }
  return menu.groups.flatMap((group) => group.items.filter((item) => item.id.startsWith('m:')).map((item) => item.module))
}

export function errorPaths(answerData: ApiAnswer): string[] {
  const errors = answerData.error?.params?.['errors']
  return Array.isArray(errors) ? errors.map((entry) => String((entry as { path?: unknown }).path)) : []
}

/** A valid PNG (solid colour) without any image library: IHDR, one deflated IDAT, IEND. */
export async function pngFile(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  const { deflateSync, crc32 } = await import('node:zlib')
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
