/**
 * The menu preview of the editor (action=Save&mode=previewMenu): the same shape as the menu of Bootstrap.
 */
import { parseBootstrapMenu, record, stringList } from '../api/guards'
import type { Menu } from '../api/types'

export function parseMenuPreview(value: unknown): { menu: Menu; unknownModules: string[] } {
  const data = record(value, 'result')
  const menu = record(data['menu'], 'result.menu')
  return {
    menu: parseBootstrapMenu({ ...menu, system: [] }),
    unknownModules: stringList(data['unknownModules'], 'result.unknownModules'),
  }
}
