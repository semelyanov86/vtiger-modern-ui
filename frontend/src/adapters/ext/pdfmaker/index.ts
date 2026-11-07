/** The native PDF Maker list action, reachable next to the selected-record actions. */
import type { ExtensionAdapter } from '../types'

const ACTION = '.listViewActionsContainer a[onclick*="PDFMaker_Actions_Js.getPDFListViewPopup2"]'

export const pdfmaker: ExtensionAdapter = {
  id: 'pdfmaker',
  supports: ({ page }) => page.view === 'List',
  start: (scope) => {
    // PDF Maker's own ready callback only sees the list on the initial page load. Its public controller renders the
    // authorised templates and registers the native download/signature actions when a record opens later.
    scope.onAppEvent('post.overlay.load', () => {
      const header = document.querySelector('.mu-cloud-record .detailview-header')
      const constructor: unknown = Reflect.get(window, 'PDFMaker_Actions_Js')
      if (header?.querySelector('#PDFMakerContentDiv') !== null || typeof constructor !== 'function') return
      const instance: unknown = Reflect.construct(constructor, [])
      if (typeof instance !== 'object' || instance === null) return
      const register: unknown = Reflect.get(instance, 'registerEvents')
      if (typeof register === 'function') Reflect.apply(register, instance, [])
    })
    const content = document.getElementById('listViewContent')
    if (content?.querySelector(ACTION) == null) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn-default mu-pdfmaker-export'
    button.setAttribute('data-mu-root', 'pdfmaker-list')
    const icon = document.createElement('span')
    icon.className = 'fa fa-file-pdf-o'
    icon.setAttribute('aria-hidden', 'true')
    const label = document.createTextNode('')
    button.append(icon, label)
    const refresh = (): void => {
      const action = content.querySelector<HTMLAnchorElement>(ACTION)
      const parent = action?.closest('.listViewActionsContainer')
      if (parent !== null && parent !== undefined && button.parentElement !== parent) parent.appendChild(button)
      // The extension/core own availability, including select-all, permissions and AJAX replacements.
      button.hidden = action?.closest('.hide, .disabled, [hidden]') !== null
      const text = action?.textContent.trim() ?? ''
      if (label.textContent !== ` ${text}`) label.textContent = ` ${text}`
    }
    scope.listen(button, 'click', () => {
      const action = content.querySelector<HTMLAnchorElement>(ACTION)
      if (action !== null && action.closest('.hide, .disabled, [hidden]') === null) action.click()
    })
    scope.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, refresh)
    scope.onDispose(() => { button.remove() })
    refresh()
  },
}
