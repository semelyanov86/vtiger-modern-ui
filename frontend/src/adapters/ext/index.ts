/**
 * Client parts of the adapters of public extensions (docs/architecture.md §7.6), each its own chunk: the shell imports
 * one only when the server lists the adapter for this user (Bootstrap adapters[]: the extension is active).
 */
import type { ExtensionAdapter } from './types'

export const CLIENT_ADAPTERS: Readonly<Partial<Record<string, () => Promise<ExtensionAdapter>>>> = {
  pdfmaker: async () => (await import('./pdfmaker')).pdfmaker,
  controllayoutfields: async () => (await import('./controllayoutfields')).controllayoutfields,
}
