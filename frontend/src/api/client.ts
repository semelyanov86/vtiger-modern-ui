/**
 * Requests of the islands to the CRM (docs/architecture.md §8): fetch with X-Requested-With and an explicit
 * csrf-magic token (csrf-magic patches XMLHttpRequest and jQuery.ajax only, not fetch). jQuery.ajax is not used:
 * many extensions rescan the page on every global ajaxComplete. URLs are relative to the page (index.php).
 */
import { csrfToken } from '../adapters/v7/host'
import { ApiError, errorCodeOf, errorParamsOf, isRecord, parseBootstrap, parseRevision } from './guards'
import type { Bootstrap } from './types'

export function endpoint(params?: Record<string, string>): string {
  const url = new URL('index.php', document.baseURI)
  if (params !== undefined) {
    url.search = new URLSearchParams(params).toString()
  }
  return url.toString()
}

async function send(url: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    })
  } catch {
    throw new ApiError('MU_NETWORK')
  }
  if (response.status === 401) {
    throw new ApiError('MU_SESSION_EXPIRED')
  }
  const type = response.headers.get('Content-Type') ?? ''
  if (!/json/i.test(type)) {
    // An expired session answers 200 with the HTML of the login page; anything else is a server failure.
    // 403 without JSON: csrf-magic or the web server refused the request.
    const expired = response.ok && /text\/html/i.test(type)
    const code = response.status === 403 ? 'MU_REJECTED' : expired ? 'MU_SESSION_EXPIRED' : 'MU_BAD_RESPONSE'
    throw new ApiError(code, `HTTP ${String(response.status)}`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError('MU_BAD_RESPONSE', 'not JSON')
  }
  if (!isRecord(body) || body['success'] !== true) {
    throw new ApiError(errorCodeOf(body), `HTTP ${String(response.status)}`, errorParamsOf(body))
  }
  return body['result']
}

/** GET index.php?… of the CRM; the result is unchecked (callers parse it). */
export async function getJson(params: Record<string, string>): Promise<unknown> {
  return send(endpoint(params), { method: 'GET', cache: 'no-cache' })
}

/**
 * POST index.php with the CSRF token of the page. A FormData body (file uploads) is sent as multipart, anything
 * else as application/x-www-form-urlencoded.
 */
export async function postJson(fields: Record<string, string>, files?: Record<string, Blob>): Promise<unknown> {
  const token = csrfToken()
  if (token === null) {
    throw new ApiError('MU_SESSION_EXPIRED', 'no CSRF token on the page')
  }
  let body: URLSearchParams | FormData
  if (files === undefined) {
    body = new URLSearchParams(fields)
    body.set(token.name, token.value)
  } else {
    const form = new FormData()
    for (const [name, value] of Object.entries(fields)) {
      form.set(name, value)
    }
    for (const [name, file] of Object.entries(files)) {
      form.set(name, file)
    }
    form.set(token.name, token.value)
    body = form
  }
  return send(endpoint(), { method: 'POST', body })
}

export async function fetchBootstrap(): Promise<Bootstrap> {
  return parseBootstrap(await getJson({ module: 'ModernUI', action: 'Bootstrap' }))
}

/**
 * Saves personal values (dotted keys, null removes a value); returns the new revision. With baseRevision the save
 * fails with MU_CONFLICT when the personal settings changed in another tab or session since.
 */
export async function savePreferences(values: Readonly<Record<string, unknown>>, baseRevision?: number): Promise<number> {
  const fields: Record<string, string> = { module: 'ModernUI', action: 'Preferences', mode: 'save', values: JSON.stringify(values) }
  if (baseRevision !== undefined) {
    fields['baseRevision'] = String(baseRevision)
  }
  return parseRevision(await postJson(fields))
}

/** Removes every personal value of the current user. */
export async function clearPreferences(): Promise<void> {
  await postJson({ module: 'ModernUI', action: 'Preferences', mode: 'clear' })
}
