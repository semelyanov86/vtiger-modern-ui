/**
 * Requests of the islands to the CRM (docs/architecture.md §8): fetch with X-Requested-With and an explicit
 * csrf-magic token (csrf-magic patches XMLHttpRequest and jQuery.ajax only, not fetch). jQuery.ajax is not used:
 * many extensions rescan the page on every global ajaxComplete. URLs are relative to the page (index.php).
 */
import { csrfToken } from '../adapters/v7/host'
import { ApiError, errorCodeOf, isRecord, parseBootstrap, parseRevision } from './guards'
import type { Bootstrap } from './types'

function endpoint(params?: Record<string, string>): string {
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
  if (response.status === 401 || response.status === 403) {
    throw new ApiError('MU_SESSION_EXPIRED')
  }
  const type = response.headers.get('Content-Type') ?? ''
  if (!/json/i.test(type)) {
    // An expired session answers 200 with the HTML of the login page; anything else is a server failure.
    const expired = response.ok && /text\/html/i.test(type)
    throw new ApiError(expired ? 'MU_SESSION_EXPIRED' : 'MU_BAD_RESPONSE', `HTTP ${String(response.status)}`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError('MU_BAD_RESPONSE', 'not JSON')
  }
  if (!isRecord(body) || body['success'] !== true) {
    throw new ApiError(errorCodeOf(body))
  }
  return body['result']
}

export async function fetchBootstrap(): Promise<Bootstrap> {
  const result = await send(endpoint({ module: 'ModernUI', action: 'Bootstrap' }), { method: 'GET', cache: 'no-cache' })
  return parseBootstrap(result)
}

/** Saves personal values (dotted keys, null removes a value); returns the new revision. */
export async function savePreferences(values: Readonly<Record<string, unknown>>): Promise<number> {
  const token = csrfToken()
  if (token === null) {
    throw new ApiError('MU_SESSION_EXPIRED', 'no CSRF token on the page')
  }
  const body = new URLSearchParams({ module: 'ModernUI', action: 'Preferences', mode: 'save', values: JSON.stringify(values) })
  body.set(token.name, token.value)
  const result = await send(endpoint(), { method: 'POST', body })
  return parseRevision(result)
}
