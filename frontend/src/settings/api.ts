/**
 * Actions of the settings editor (administrators only; the server checks it, docs/architecture.md §8).
 */
import { getJson, postJson, endpoint } from '../api/client'
import { integer, record, string } from '../api/guards'
import type { Menu } from '../api/types'
import type { ThemeLocale } from '../i18n/locale'
import { parseEditorData, parseImportReport } from './guards'
import type { EditorData, ImportReport, Values } from './types'
import { parseMenuPreview } from './preview'

const SETTINGS = { module: 'ModernUI', parent: 'Settings' } as const

export async function loadEditor(): Promise<EditorData> {
  return parseEditorData(await getJson({ ...SETTINGS, action: 'Data' }))
}

/** Saves the whole document of a scope; returns the new revision (MU_CONFLICT / MU_INVALID_VALUE as ApiError). */
export async function saveScope(scope: 'global' | 'role', role: string, values: Values, baseRevision: number, inherit: boolean): Promise<number> {
  const result = record(await postJson({
    ...SETTINGS, action: 'Save', mode: 'save', scope, role, values: JSON.stringify(values),
    baseRevision: String(baseRevision), inherit: inherit ? '1' : '0',
  }), 'result')
  return integer(result['revision'], 'result.revision')
}

export async function previewMenu(values: Values, locale: ThemeLocale): Promise<{ menu: Menu; unknownModules: string[] }> {
  return parseMenuPreview(await postJson({ ...SETTINGS, action: 'Save', mode: 'previewMenu', values: JSON.stringify(values), locale }))
}

export async function deleteRoleProfile(role: string, baseRevision: number): Promise<void> {
  await postJson({ ...SETTINGS, action: 'Save', mode: 'deleteRole', role, baseRevision: String(baseRevision) })
}

export async function resetUserSettings(user: number): Promise<void> {
  await postJson({ ...SETTINGS, action: 'Save', mode: 'resetUser', user: String(user) })
}

export async function uploadLogo(file: File): Promise<{ file: string; url: string }> {
  const result = record(await postJson({ ...SETTINGS, action: 'Logo', mode: 'upload' }, { logo: file }), 'result')
  return {
    file: string(result['file'], 'result.file', /^modernui_[0-9a-f]{40}\.png$/),
    url: string(result['url'], 'result.url', /^public\.php\?type=logo&key=modernui_[0-9a-f]{40}\.png$/),
  }
}

export function exportUrl(parts: readonly string[]): string {
  return endpoint({ ...SETTINGS, action: 'Transfer', mode: 'export', parts: parts.join(',') })
}

export async function previewImport(json: string): Promise<{ report: ImportReport; fingerprint: string }> {
  return parseImportReport(await postJson({ ...SETTINGS, action: 'Transfer', mode: 'preview', json }))
}

export async function applyImport(json: string, parts: readonly string[], includeMode: boolean, fingerprint: string): Promise<void> {
  await postJson({
    ...SETTINGS, action: 'Transfer', mode: 'apply', json, parts: parts.join(','), includeMode: includeMode ? '1' : '0', fingerprint,
  })
}
