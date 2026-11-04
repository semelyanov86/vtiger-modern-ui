/**
 * Container for overlays of the islands (dropdowns, dialogs): inside .mu-root, never directly in body
 * (docs/architecture.md §6, §9). The shell and the module's own pages share it.
 */
export function ensureOverlayRoot(): HTMLElement {
  const existing = document.getElementById('mu-overlay-root')
  if (existing !== null) {
    return existing
  }
  const root = document.createElement('div')
  root.id = 'mu-overlay-root'
  root.className = 'mu-root mu-overlay-root'
  root.setAttribute('data-mu-root', 'overlay')
  document.body.appendChild(root)
  return root
}
