/**
 * Runtime checks of the answers of the editor actions (docs/dependencies.md §5): the shape is verified, document
 * values stay unknown and are read per key by the sections.
 */
import { bad, boolean, integer, isRecord, moduleIcon, record, string, stringList } from '../api/guards'
import { parseGroups } from '../menu/config'
import type { CatalogModule, EditorData, ImportReport, Problem, ReportChange, RoleInfo, ScopeData, UserInfo } from './types'

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path)
}

function problems(value: unknown, path: string): Problem[] {
  if (!Array.isArray(value)) {
    return bad(path)
  }
  return value.map((entry, index) => {
    const item = record(entry, `${path}[${String(index)}]`)
    return {
      key: string(item['key'], `${path}[${String(index)}].key`),
      code: string(item['code'], `${path}[${String(index)}].code`, /^MU_[A-Z_]{1,40}$/),
      path: string(item['path'], `${path}[${String(index)}].path`),
    }
  })
}

function scope(value: unknown, path: string): ScopeData {
  const data = record(value, path)
  return {
    values: record(data['values'], `${path}.values`),
    revision: integer(data['revision'], `${path}.revision`),
    updatedAt: nullableString(data['updatedAt'], `${path}.updatedAt`),
    updatedBy: nullableString(data['updatedBy'], `${path}.updatedBy`),
    inherit: boolean(data['inherit'], `${path}.inherit`),
    warnings: problems(data['warnings'], `${path}.warnings`),
  }
}

function role(value: unknown, path: string): RoleInfo {
  const data = record(value, path)
  const profile = data['profile']
  return {
    id: string(data['id'], `${path}.id`, /^[A-Za-z0-9_]{1,32}$/),
    name: string(data['name'], `${path}.name`),
    parent: data['parent'] === null ? null : string(data['parent'], `${path}.parent`),
    path: stringList(data['path'], `${path}.path`),
    depth: integer(data['depth'], `${path}.depth`),
    users: integer(data['users'], `${path}.users`),
    root: boolean(data['root'], `${path}.root`),
    missing: data['missing'] === true,
    profile: profile === null ? null : scope(profile, `${path}.profile`),
  }
}

function user(value: unknown, path: string): UserInfo {
  const data = record(value, path)
  return {
    id: integer(data['id'], `${path}.id`),
    userName: string(data['userName'], `${path}.userName`),
    name: string(data['name'], `${path}.name`),
    active: boolean(data['active'], `${path}.active`),
    isAdmin: boolean(data['isAdmin'], `${path}.isAdmin`),
    role: data['role'] === null ? null : string(data['role'], `${path}.role`),
  }
}

function catalogModule(value: unknown, path: string): CatalogModule {
  const data = record(value, path)
  return {
    module: string(data['module'], `${path}.module`, /^[A-Za-z0-9_]{1,50}$/),
    label: string(data['label'], `${path}.label`),
    apps: stringList(data['apps'], `${path}.apps`),
    icon: moduleIcon(data['icon'], `${path}.icon`),
    defaultHidden: boolean(data['defaultHidden'], `${path}.defaultHidden`),
  }
}

function list<T>(value: unknown, path: string, item: (entry: unknown, path: string) => T): T[] {
  return Array.isArray(value) ? value.map((entry, index) => item(entry, `${path}[${String(index)}]`)) : bad(path)
}

export function parseEditorData(value: unknown): EditorData {
  const data = record(value, 'result')
  if (data['v'] !== 1) {
    return bad('result.v')
  }
  const scopes = record(data['scopes'], 'scopes')
  const catalog = record(data['catalog'], 'catalog')
  const branding = record(data['branding'], 'branding')
  const personal = data['personal']
  return {
    v: 1,
    schema: integer(data['schema'], 'schema'),
    module: string(data['module'], 'module'),
    me: integer(data['me'], 'me'),
    defaults: record(data['defaults'], 'defaults'),
    scopes: Object.fromEntries(Object.entries(scopes).map(([key, entry]) => [key, stringList(entry, `scopes.${key}`)])),
    userOverridable: stringList(data['userOverridable'], 'userOverridable'),
    global: scope(data['global'], 'global'),
    roles: list(data['roles'], 'roles', role),
    users: list(data['users'], 'users', user),
    personal: Array.isArray(personal) ? personal.map((id, index) => integer(id, `personal[${String(index)}]`)) : bad('personal'),
    catalog: {
      modules: list(catalog['modules'], 'catalog.modules', catalogModule),
      defaultGroups: parseGroups(catalog['defaultGroups']) ?? bad('catalog.defaultGroups'),
    },
    branding: {
      companyName: string(branding['companyName'], 'branding.companyName'),
      logoUrl: nullableString(branding['logoUrl'], 'branding.logoUrl'),
    },
  }
}

function changes(value: unknown, path: string): ReportChange[] {
  return list(value, path, (entry, at) => {
    const item = record(entry, at)
    return { key: string(item['key'], `${at}.key`), before: item['before'], after: item['after'] }
  })
}

function strings(value: unknown, path: string): string[] {
  return stringList(value, path)
}

export function parseImportReport(value: unknown): { report: ImportReport; fingerprint: string } {
  const data = record(value, 'result')
  const report = record(data['report'], 'report')
  const source = record(report['source'], 'report.source')
  const optional = (entry: unknown, at: string): string | null => (entry === null ? null : string(entry, at))
  const globalPart = report['global']
  const rolesPart = report['roles']
  const usersPart = report['users']
  return {
    fingerprint: string(data['fingerprint'], 'fingerprint', /^[0-9a-f]{16}$/),
    report: {
      source: {
        module: optional(source['module'], 'report.source.module'),
        vtiger: optional(source['vtiger'], 'report.source.vtiger'),
        exportedAt: optional(source['exportedAt'], 'report.source.exportedAt'),
      },
      global: globalPart === null ? null : (() => {
        const part = record(globalPart, 'report.global')
        const mode = part['modeChange']
        return {
          unresolvedUsers: strings(part['unresolvedUsers'], 'report.global.unresolvedUsers'),
          unresolvedRoles: strings(part['unresolvedRoles'], 'report.global.unresolvedRoles'),
          changes: changes(part['changes'], 'report.global.changes'),
          modeChange: mode === null ? null : (() => {
            const entry = record(mode, 'report.global.modeChange')
            return { before: string(entry['before'], 'modeChange.before'), after: string(entry['after'], 'modeChange.after') }
          })(),
        }
      })(),
      roles: rolesPart === null ? null : (() => {
        const part = record(rolesPart, 'report.roles')
        return {
          matched: list(part['matched'], 'report.roles.matched', (entry, at) => {
            const item = record(entry, at)
            return {
              id: string(item['id'], `${at}.id`),
              name: string(item['name'], `${at}.name`),
              exists: boolean(item['exists'], `${at}.exists`),
              inherit: boolean(item['inherit'], `${at}.inherit`),
              changes: changes(item['changes'], `${at}.changes`),
            }
          }),
          unresolved: strings(part['unresolved'], 'report.roles.unresolved'),
          ambiguous: strings(part['ambiguous'], 'report.roles.ambiguous'),
        }
      })(),
      users: usersPart === null ? null : (() => {
        const part = record(usersPart, 'report.users')
        return {
          matched: integer(part['matched'], 'report.users.matched'),
          changed: integer(part['changed'], 'report.users.changed'),
          unresolved: strings(part['unresolved'], 'report.users.unresolved'),
        }
      })(),
      uploadLogo: boolean(report['uploadLogo'], 'report.uploadLogo'),
      unknownModules: strings(report['unknownModules'], 'report.unknownModules'),
      checkFilters: list(report['checkFilters'], 'report.checkFilters', (entry, at) => {
        const item = record(entry, at)
        return { scope: string(item['scope'], `${at}.scope`), id: string(item['id'], `${at}.id`), label: optional(item['label'], `${at}.label`) }
      }),
      invalid: list(report['invalid'], 'report.invalid', (entry, at) => {
        const item = record(entry, at)
        return { part: string(item['part'], `${at}.part`), scope: string(item['scope'], `${at}.scope`), path: string(item['path'], `${at}.path`), code: string(item['code'], `${at}.code`) }
      }),
    },
  }
}

/** Problems of an MU_INVALID_VALUE answer ({params: {errors: [{key, code, path}]}}). */
export function errorsOf(params: Readonly<Record<string, unknown>>): Problem[] {
  const errors = params['errors']
  if (!Array.isArray(errors)) {
    return []
  }
  const result: Problem[] = []
  for (const entry of errors) {
    if (isRecord(entry) && typeof entry['key'] === 'string' && typeof entry['code'] === 'string' && typeof entry['path'] === 'string') {
      result.push({ key: entry['key'], code: entry['code'], path: entry['path'] })
    }
  }
  return result
}

/** {revision, updatedBy, updatedAt} of an MU_CONFLICT answer. */
export function conflictOf(params: Readonly<Record<string, unknown>>): { revision: number; updatedBy: string | null; updatedAt: string | null } {
  const revision = params['revision']
  const updatedBy = params['updatedBy']
  const updatedAt = params['updatedAt']
  return {
    revision: typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0,
    updatedBy: typeof updatedBy === 'string' ? updatedBy : null,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : null,
  }
}
