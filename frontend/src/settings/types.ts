/**
 * Data of the settings editor (index.php?module=ModernUI&parent=Settings&action=Data, ModernUI_Editor_Model::data()).
 * Values of the documents stay `unknown` maps: every section reads the keys it edits with its own checks.
 */
import type { ModuleIcon } from '../api/types'
import type { GroupConfig } from '../menu/config'

export type Values = Record<string, unknown>

export interface Problem {
  readonly key: string
  readonly code: string
  readonly path: string
}

export interface ScopeData {
  readonly values: Values
  readonly revision: number
  readonly updatedAt: string | null
  readonly updatedBy: string | null
  readonly inherit: boolean
  readonly warnings: readonly Problem[]
}

export interface RoleInfo {
  readonly id: string
  readonly name: string
  readonly parent: string | null
  readonly path: readonly string[]
  readonly depth: number
  readonly users: number
  readonly root: boolean
  readonly missing: boolean
  readonly profile: ScopeData | null
}

export interface UserInfo {
  readonly id: number
  readonly userName: string
  readonly name: string
  readonly active: boolean
  readonly isAdmin: boolean
  readonly role: string | null
}

export interface CatalogModule {
  readonly module: string
  readonly label: string
  readonly apps: readonly string[]
  readonly icon: ModuleIcon
  readonly defaultHidden: boolean
}

export interface EditorData {
  readonly v: 1
  readonly schema: number
  readonly module: string
  readonly me: number
  readonly defaults: Values
  readonly scopes: Readonly<Record<string, readonly string[]>>
  readonly userOverridable: readonly string[]
  readonly global: ScopeData
  readonly roles: readonly RoleInfo[]
  readonly users: readonly UserInfo[]
  readonly personal: readonly number[]
  readonly catalog: { readonly modules: readonly CatalogModule[]; readonly defaultGroups: readonly GroupConfig[] }
  readonly branding: { readonly companyName: string; readonly logoUrl: string | null }
}

/** The scope the editor works on: the common settings or the profile of one role. */
export type ScopeRef = { readonly kind: 'global' } | { readonly kind: 'role'; readonly role: string }

/** Value of a changed key in an import report: a scalar, a short list or a summary of a composite value. */
export interface ReportChange {
  readonly key: string
  readonly before: unknown
  readonly after: unknown
}

export interface ImportReport {
  readonly source: { readonly module: string | null; readonly vtiger: string | null; readonly exportedAt: string | null }
  readonly global: {
    readonly unresolvedUsers: readonly string[]
    readonly unresolvedRoles: readonly string[]
    readonly changes: readonly ReportChange[]
    readonly modeChange: { readonly before: string; readonly after: string } | null
  } | null
  readonly roles: {
    readonly matched: readonly { readonly id: string; readonly name: string; readonly exists: boolean; readonly inherit: boolean; readonly changes: readonly ReportChange[] }[]
    readonly unresolved: readonly string[]
    readonly ambiguous: readonly string[]
  } | null
  readonly users: { readonly matched: number; readonly changed: number; readonly unresolved: readonly string[] } | null
  readonly uploadLogo: boolean
  readonly unknownModules: readonly string[]
  readonly checkFilters: readonly { readonly scope: string; readonly id: string; readonly label: string | null }[]
  readonly invalid: readonly { readonly part: string; readonly scope: string; readonly path: string; readonly code: string }[]
}
