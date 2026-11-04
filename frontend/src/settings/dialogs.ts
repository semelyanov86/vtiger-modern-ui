/**
 * Data of the dialogs of the settings editor (kept in a .ts module: types exported from .vue files are not visible to
 * the type-aware lint of other .vue files).
 */
import type { MenuIconName } from '../menu/icons'
import type { Labels } from '../menu/labels'

export interface ConflictInfo {
  revision: number
  updatedBy: string | null
  updatedAt: string | null
  /** Fields the other save changed. */
  theirs: string[]
  /** Fields of this draft. */
  mine: string[]
}

export type ItemDialogValue =
  | { kind: 'group'; label: Labels | null; icon: MenuIconName | null; placeholder: string | null }
  | { kind: 'module'; module: string; label: Labels | null; icon: MenuIconName | null; placeholder: string | null }
  | { kind: 'route'; module: string; view: string; viewname: string; label: Labels | null; icon: MenuIconName | null }
