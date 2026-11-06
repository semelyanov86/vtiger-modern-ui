/**
 * Client part of an adapter of a public extension (docs/architecture.md §7.6). The server decides whether the adapter
 * applies at all (the extension is installed and active, its version is in the checked range, its files and tables
 * exist, the administrator did not switch the adapter off); the client part then checks the page itself.
 */
import type { IslandScope } from '../../boot/runtime'
import type { PageContext } from '../v7/page'

export interface AdapterContext {
  readonly page: PageContext
  /** Version of the extension (vtiger_tab.version). */
  readonly version: string
}

export interface ExtensionAdapter {
  /** Id of the server registry (ModernUI_Adapters_Model). */
  readonly id: string
  /**
   * DOM capabilities the adapter needs on this page (the markup of the extension it works with). false: the page does
   * not have them — the adapter does nothing here and the screen keeps the common skin.
   */
  supports(context: AdapterContext): boolean
  /** Starts the adapter; listeners, observers and timers go through the scope and are released with it. */
  start(scope: IslandScope, context: AdapterContext): void
}
