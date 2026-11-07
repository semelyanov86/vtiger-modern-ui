/**
 * Expected computed values of the visual foundation (stage 10, docs/design.md §13.4): the cloud reference v9 measured on
 * 2026-11-07 (Playwriter, 1440×1000, DPR 1, getComputedStyle of the named cloud element and state). Only numbers and colours
 * — no screenshots, addresses or data of the cloud. The keys are roles; foundation.spec.ts measures the element of v7 / of
 * ModernUI that plays the role on a real screen and compares. Exceptions on purpose are marked `exception` (§13.5).
 */
export interface Expectation {
  /** Role and the cloud element it was measured on. */
  readonly role: string
  /** Computed CSS properties → exact value (colours as rgb/rgba strings of getComputedStyle). */
  readonly css: Readonly<Record<string, string>>
  /** Box sizes: height/width ±2 px (docs/visual-parity.md §5.1). */
  readonly size?: Readonly<{ height?: number; width?: number }>
  /** A deliberate difference from the cloud, with the reason (docs/design.md §13.5). */
  readonly exception?: string
}

const PRIMARY = 'rgb(57, 120, 254)'
const PRIMARY_HOVER = 'rgb(49, 93, 255)'
const WHITE = 'rgb(255, 255, 255)'
const SECONDARY = 'rgb(240, 241, 243)'
const TEXT = 'rgb(28, 33, 33)'
const TEXT_BODY = 'rgb(33, 37, 41)'

export const reference: Readonly<Record<string, Expectation>> = {
  'page.background': { role: 'list page (.vds-bodycontents)', css: { 'background-color': 'rgb(239, 240, 242)' } },
  'font.body': { role: 'body text (body, cells, buttons)', css: { 'font-family': 'Poppins', 'font-size': '13px', 'line-height': '19.5px' } },

  'button.primary': {
    role: 'Add <record> of the list (.importDropdown .btn-primary)',
    css: { 'background-color': PRIMARY, 'border-top-color': PRIMARY, color: WHITE, 'border-top-left-radius': '4px', 'font-weight': '400', 'font-size': '13px', 'font-family': 'Poppins' },
    size: { height: 33.5 },
  },
  'button.primary:hover': { role: 'Add <record>, hover', css: { 'background-color': PRIMARY_HOVER, 'border-top-color': PRIMARY_HOVER, color: WHITE } },
  'button.primary:active': { role: 'Add <record>, pressed', css: { 'background-color': PRIMARY, color: WHITE } },
  'button.primary:focus-visible': {
    role: 'Add <record>, keyboard focus',
    css: { 'box-shadow': 'rgba(0, 123, 255, 0.8) 0px 0px 0px 2px' },
    exception: 'the cloud shows no keyboard focus on buttons; the theme adds the ring of its fields (visible only with the keyboard)',
  },
  'button.secondary': {
    role: 'secondary button of the record header (#detailHeader .btn-secondary)',
    css: { 'background-color': SECONDARY, 'border-top-color': SECONDARY, color: TEXT_BODY, 'border-top-left-radius': '4px', 'font-weight': '400' },
  },
  'button.secondary:hover': { role: 'secondary button, hover (no change in the cloud)', css: { 'background-color': SECONDARY, color: TEXT_BODY } },
  'button.save': {
    role: 'Save of the form footer and of quick create (.editViewFooter .btn-primary)',
    css: { 'background-color': PRIMARY, color: WHITE, 'border-top-left-radius': '4px', 'font-weight': '400', 'padding-left': '16px' },
    size: { height: 36.5 },
  },
  'button.cancel': {
    role: 'Cancel of the full form, View full form of quick create (.editViewFooter .btn-secondary)',
    css: { 'background-color': SECONDARY, color: TEXT_BODY, 'border-top-left-radius': '4px', 'padding-left': '16px' },
    size: { height: 36.5 },
  },
  'button.toolbar': { role: 'toolbar button on the grey page (#syncNow); measured on the last button of the mass actions box', css: { 'background-color': WHITE, color: TEXT, 'border-top-right-radius': '4px' } },
  'button.disabled': { role: 'disabled button (page jump of the pager)', css: { opacity: '0.65' } },

  'field.input': {
    role: 'text field of the edit form (.fieldEdit input.form-control)',
    css: { 'border-top-width': '1px', 'border-top-color': 'rgb(223, 225, 230)', 'border-top-left-radius': '4px', color: TEXT, 'background-color': WHITE, 'padding-left': '16px' },
    size: { height: 36 },
  },
  'field.input:focus': { role: 'text field, focus', css: { 'border-top-color': 'rgb(35, 122, 254)', 'box-shadow': 'rgba(0, 123, 255, 0.8) 0px 0px 0px 1.28px' } },
  'field.input:error': { role: 'text field, validation error', css: { 'border-top-color': 'rgba(0, 0, 0, 0)', 'box-shadow': 'rgb(248, 92, 117) 0px 0px 0px 1.28px' } },
  'field.textarea': { role: 'textarea of the edit form', css: { 'border-top-color': 'rgb(223, 225, 230)', 'border-top-left-radius': '4px', 'padding-left': '16px', 'padding-top': '8px', color: TEXT } },
  'field.select2': { role: 'Select2 box (.select2-selection--single)', css: { 'border-top-color': 'rgb(229, 229, 229)', 'border-top-left-radius': '4px', color: 'rgb(68, 68, 68)', 'background-color': WHITE }, size: { height: 35 } },
  'field.select2:open': { role: 'Select2 box, open', css: { 'border-top-color': 'rgb(170, 170, 170)', 'border-bottom-left-radius': '0px' } },
  'field.select2.drop': { role: 'Select2 drop-down', css: { 'border-left-color': 'rgb(170, 170, 170)', 'box-shadow': 'rgba(0, 0, 0, 0.25) 0px 1px 10px 0px', 'border-bottom-left-radius': '4px', 'background-color': WHITE } },
  'field.select2.highlight': { role: 'Select2 highlighted option', css: { 'background-color': 'rgb(88, 151, 251)', color: WHITE } },
  'field.label.form': { role: 'label of the edit form (.deepDiveFieldLbl)', css: { color: TEXT, 'font-size': '13px' } },
  'field.label.detail': { role: 'label of Details (.label)', css: { color: 'rgb(123, 127, 133)', 'font-size': '12px' } },

  'checkbox.list': { role: 'check box of a list row (.checkmark)', css: { 'border-top-color': 'rgb(204, 204, 204)', 'border-top-left-radius': '4px', 'background-color': WHITE }, size: { height: 18, width: 18 } },
  'checkbox.list:hover': { role: 'check box of a list row, hover', css: { 'border-top-color': 'rgb(89, 93, 93)' } },
  'checkbox.list:checked': { role: 'check box of a list row, checked', css: { 'background-color': 'rgb(46, 129, 255)' } },
  'checkbox.form': { role: 'check box of the edit form', css: { 'border-top-color': 'rgb(213, 215, 217)', 'border-top-left-radius': '4px' }, size: { height: 20, width: 20 } },

  'table.head': { role: 'header cell of the list', css: { 'font-size': '13px', 'font-weight': '700', 'text-transform': 'uppercase', color: 'rgb(44, 62, 80)', 'border-bottom-color': SECONDARY } },
  'table.row:hover': { role: 'row of the list, hover', css: { 'background-color': 'rgb(231, 241, 255)' } },
  'table.row:selected': { role: 'row of the list, selected', css: { 'background-color': 'rgb(231, 241, 255)' } },
  'table.link': { role: 'name link of a row', css: { color: TEXT } },

  'menu.panel': { role: 'drop-down menu (.dropdown-menu.show)', css: { 'background-color': WHITE, 'border-top-color': 'rgba(0, 0, 0, 0.15)', 'border-top-left-radius': '4px', 'box-shadow': 'rgba(39, 49, 58, 0.2) 0px 2px 10px 0px', 'padding-top': '0px' } },
  'menu.item': { role: 'item of a drop-down menu', css: { 'padding-left': '16px', 'padding-top': '8px', color: TEXT_BODY } },
  'menu.item:hover': { role: 'item of a drop-down menu, hover', css: { 'background-color': 'rgb(239, 240, 242)', color: TEXT } },

  'tab.active': { role: 'active tab of the record (Summary)', css: { color: TEXT, 'font-weight': '400' } },
  'tab.inactive': { role: 'inactive tab of the record (Details)', css: { color: 'rgb(123, 127, 133)', 'font-weight': '400' } },
  'tab.inactive:hover': { role: 'inactive tab, hover', css: { color: TEXT } },

  'dialog.content': { role: 'quick create window (.modal-content)', css: { 'border-top-left-radius': '12px', 'box-shadow': 'rgba(0, 0, 0, 0.2) 0px 0px 16px 0px', 'background-color': WHITE } },
  'dialog.footer': { role: 'quick create footer', css: { 'background-color': WHITE, 'border-top-color': SECONDARY, 'border-top-width': '1px' } },
  'dialog.backdrop': { role: 'backdrop of dialogs', css: { 'background-color': 'rgb(0, 0, 0)', opacity: '0.5' } },
  'block.form': { role: 'block card of the edit form', css: { 'background-color': WHITE, 'border-top-left-radius': '6px', 'box-shadow': 'rgba(0, 0, 0, 0.075) 0px 2px 4px 0px', 'border-top-width': '0px' } },
  'badge': { role: 'badge (.badge-light)', css: { 'border-top-left-radius': '4px', 'font-weight': '400' } },
}

/** Tokens the server prints for the default appearance (action=Tokens), as measured in the cloud. */
export const defaultTokens: Readonly<Record<string, string>> = {
  primary: '#3978fe',
  'primary-strong': '#3978fe',
  'primary-hover': '#315dff',
  'primary-soft': '#e7f1ff',
  'primary-check': '#2e81ff',
  bg: '#eff0f2',
  surface: '#ffffff',
  'font-family': 'var(--mu-font-cloud)',
}
