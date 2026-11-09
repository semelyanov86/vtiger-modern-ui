/**
 * Font of the content of the module's own pages (docs/design.md §13.12). In the frame of the settings the theme draws
 * the cloud font as Open Sans (the family of the system settings); the content of the page of ModernUI is the working
 * family, so the page and the overlays of its editor get the font token of the theme (the saved one, then the one of
 * the draft): "var(--mu-font-cloud)" resolves there to the Poppins stack (settings/editor.scss), Inter and the system
 * font stay what they are.
 */
const FONT_TOKEN = /^var\(--mu-font-(cloud|inter|system)\)$/

export function setPageFont(token: string | undefined): void {
  const value = token !== undefined && FONT_TOKEN.test(token) ? token : 'var(--mu-font-cloud)'
  for (const element of document.querySelectorAll<HTMLElement>('.modernui-page, #mu-overlay-root')) {
    element.style.setProperty('--mu-font-family', value)
  }
}
