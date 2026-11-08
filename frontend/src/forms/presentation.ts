/** Presentation of native Edit/QuickCreate forms. Tables, fields, widgets and submit handlers stay with v7. */
/* eslint-disable vue/one-component-per-file -- Each app mounts only in its own presentation container. */
import { createApp, h, ref, shallowRef } from 'vue'
import { createScope, type IslandScope } from '../boot/runtime'
import { nativeFormErrors, onJQuery } from '../adapters/v7/record'
import FormSections from './FormSections.vue'
import type { Section } from '../record/RecordSections.vue'
import type { MenuItem } from '../api/types'
import ModuleIcon from '../menu/ModuleIcon.vue'

export interface FormTexts {
  readonly sections: string
  readonly search: string
  readonly empty: string
  readonly modules: readonly MenuItem[]
}

const FILTERED = 'mu-form-no-match'

/** Discover forms created by native AJAX as well as the original full page. No business DOM is moved or cloned. */
export function startForms(scope: IslandScope, texts: FormTexts): void {
  const forms = new Map<HTMLFormElement, ReturnType<typeof createScope>>()
  const scan = (): void => {
    for (const [form, own] of forms) {
      if (!form.isConnected) { own.dispose(); forms.delete(form) }
    }
    for (const form of document.querySelectorAll<HTMLFormElement>('form#EditView, form[name="QuickCreate"]')) {
      if (forms.has(form) || form.querySelector('[name="parent"][value="Settings"]') !== null) { continue }
      const quick = form.name === 'QuickCreate'
      if (!quick && form.querySelector('.editViewBody .fieldBlockContainer') === null) { continue }
      const own = createScope('form-presentation')
      forms.set(form, own)
      presentForm(own, form, texts, quick)
    }
  }
  scope.observe(document.body, { childList: true, subtree: true }, scan)
  scope.onDispose(() => { forms.forEach((own) => { own.dispose() }); forms.clear() })
  scan()
}

function presentForm(scope: IslandScope, form: HTMLFormElement, texts: FormTexts, quick: boolean): void {
  const root = form.closest<HTMLElement>('.overlayEdit, .editViewPageDiv') ?? form
  const header = root.querySelector<HTMLElement>('.overlayHeader, .editViewHeader')
  const body = form.querySelector<HTMLElement>('.editViewBody')
  const contents = form.querySelector<HTMLElement>('.editViewContents')
  form.classList.add(quick ? 'mu-quick-form' : 'mu-cloud-form')
  if (!quick) { root.classList.add('mu-form-host') }
  const sections = shallowRef<readonly Section[]>([])
  const active = ref('')
  const ids = new Map<HTMLElement, string>()
  const added: HTMLElement[] = []
  let search: HTMLInputElement | null = null
  let empty: HTMLElement | null = null

  if (quick) {
    const heading = form.querySelector('.modal-header h4')
    const module = form.querySelector<HTMLInputElement>('[name="module"]')?.value ?? ''
    const icon = texts.modules.find((item) => item.module === module)?.icon ?? { kind: 'letters' as const, text: module.slice(0, 2) }
    if (heading !== null) {
      const badge = document.createElement('span')
      badge.className = 'mu-root mu-form-module-icon'
      badge.dataset['muRoot'] = 'form-module-icon'
      heading.prepend(badge)
      const app = createApp(ModuleIcon, { icon, size: 20 })
      app.mount(badge)
      scope.onDispose(() => { app.unmount(); badge.remove() })
    }
  }

  const clearFilter = (): void => {
    if (search !== null) { search.value = '' }
    form.querySelectorAll(`.${FILTERED}`).forEach((node) => { node.classList.remove(FILTERED) })
    if (empty !== null) { empty.hidden = true }
  }
  const blocks = (): HTMLElement[] => Array.from(form.querySelectorAll<HTMLElement>('.editViewContents .fieldBlockContainer'))
  const scanBlocks = (): void => {
    const next: Section[] = []
    for (const [index, block] of blocks().entries()) {
      if (!ids.has(block)) {
        ids.set(block, block.id)
        if (block.id === '') { block.id = `mu-form-section-${String(index)}` }
      }
      // Hidden conditional blocks remain hidden; the presentation never calls show() or changes inline styles.
      if (getComputedStyle(block).display === 'none' && !block.classList.contains(FILTERED)) { continue }
      // Some native forms (the user of the settings) title their blocks with a plain h4.
      const title = block.querySelector('.fieldBlockHeader') ?? block.querySelector(':scope > h4, :scope > div > h4')
      if (title !== null) { next.push({ id: block.id, label: title.textContent.trim() }) }
    }
    if (next.length !== sections.value.length || next.some((item, index) => item.id !== sections.value[index]?.id || item.label !== sections.value[index]?.label)) {
      sections.value = next
      if (!next.some((item) => item.id === active.value)) { active.value = next[0]?.id ?? '' }
    }
  }

  if (!quick && body !== null && contents !== null && header !== null) {
    const nav = document.createElement('div')
    nav.className = 'mu-form-navigation'
    nav.dataset['muRoot'] = 'form-sections'
    body.insertBefore(nav, contents)
    const app = createApp({ render: () => h(FormSections, {
      sections: sections.value, label: texts.sections, active: active.value,
      onSelect: (id: string) => {
        clearFilter()
        active.value = id
        const block = blocks().find((item) => item.id === id)
        if (block !== undefined) {
          // scrollIntoView also scrolls overflow:hidden ancestors and moves the pinned header/footer.
          contents.scrollTo({ top: contents.scrollTop + block.getBoundingClientRect().top - contents.getBoundingClientRect().top - 16, behavior: 'smooth' })
        }
      },
    }) })
    app.mount(nav)
    scope.onDispose(() => { app.unmount(); nav.remove() })
    const tool = document.createElement('div')
    tool.className = 'mu-form-search'
    tool.dataset['muRoot'] = 'form-search'
    search = document.createElement('input')
    search.type = 'search'
    search.placeholder = texts.search
    search.setAttribute('aria-label', texts.search)
    // No name: presentation controls are not part of the CRM payload.
    tool.appendChild(search)
    header.appendChild(tool)
    added.push(tool)
    empty = document.createElement('p')
    empty.className = 'mu-form-empty'
    empty.textContent = texts.empty
    empty.setAttribute('role', 'status')
    empty.hidden = true
    contents.prepend(empty)
    added.push(empty)
    scope.listen(search, 'input', () => {
      const query = search?.value.trim().toLocaleLowerCase() ?? ''
      form.querySelectorAll(`.${FILTERED}`).forEach((node) => { node.classList.remove(FILTERED) })
      let total = 0
      for (const block of blocks()) {
        let matches = 0
        for (const label of block.querySelectorAll<HTMLElement>('td.fieldLabel')) {
          const field = label.nextElementSibling
          const match = query === '' || label.textContent.toLocaleLowerCase().includes(query)
          label.classList.toggle(FILTERED, !match)
          field?.classList.toggle(FILTERED, !match)
          if (match && getComputedStyle(label).display !== 'none' && getComputedStyle(block).display !== 'none') { matches++ }
        }
        block.classList.toggle(FILTERED, matches === 0 && query !== '')
        total += matches
      }
      if (empty !== null) { empty.hidden = query === '' || total !== 0 }
    })
    scope.listen(search, 'keydown', (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape' && search?.value !== '') {
        event.preventDefault(); event.stopPropagation(); clearFilter()
      }
    })
    // jquery.validate ignores :hidden. Restore our temporary search BEFORE native validation runs, including a
    // module's click handler that calls form.submit() without a submit event. Conditional hidden fields stay hidden.
    scope.listen(form, 'click', (event: Event) => {
      if (event.target instanceof Element && event.target.closest('button[type="submit"], input[type="submit"]') !== null) { clearFilter() }
    }, { capture: true })
    scope.listen(form, 'submit', clearFilter, { capture: true })
    scope.listen(contents, 'scroll', () => {
      const top = contents.getBoundingClientRect().top
      // Inventory totals can be a fieldBlockContainer without a heading or navigation entry.
      const visible = blocks().filter((block) => block.getClientRects().length > 0
        && sections.value.some((section) => section.id === block.id))
      const atEnd = contents.scrollTop + contents.clientHeight >= contents.scrollHeight - 2
      const current = atEnd ? visible.at(-1) : visible.find((block) => block.getBoundingClientRect().bottom > top + 70)
      if (current !== undefined) { active.value = current.id }
    })
    scanBlocks()
    scope.observe(contents, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] }, scanBlocks)
  }

  // Persistent inline text mirrors the native validator. Its rules, invalid state and focus choice remain native.
  const errors = new Map<HTMLElement, { note: HTMLElement; described: string | null }>()
  let errorId = 0
  const renderErrors = (focus: boolean): void => {
    const native = nativeFormErrors(form)
    for (const error of native) {
      const cell = error.element.closest('td.fieldValue') ?? error.element.parentElement
      if (cell === null || !form.contains(cell)) { continue }
      let item = errors.get(error.element)
      if (item === undefined) {
        const note = document.createElement('div')
        note.className = 'mu-form-error'
        note.id = `mu-form-error-${String(errorId++)}-${quick ? 'quick' : 'edit'}`
        note.setAttribute('role', 'alert')
        cell.appendChild(note)
        item = { note, described: error.element.getAttribute('aria-describedby') }
        errors.set(error.element, item)
        error.element.setAttribute('aria-describedby', `${item.described ?? ''} ${note.id}`.trim())
      }
      if (item.note.textContent !== error.message) { item.note.textContent = error.message }
    }
    for (const [element, item] of errors) {
      const cell = element.closest('td.fieldValue') ?? element.parentElement
      if (!native.some((error) => error.element === element) && cell?.querySelector('.input-error') == null) {
        item.note.remove()
        if (item.described === null) { element.removeAttribute('aria-describedby') } else { element.setAttribute('aria-describedby', item.described) }
        errors.delete(element)
      }
    }
    if (focus) {
      const first = native[0]?.element
      if (first !== undefined) {
        clearFilter()
        const block = first.closest<HTMLElement>('.fieldBlockContainer')
        if (block !== null) { active.value = block.id }
        const cell = first.closest('td.fieldValue')
        if (contents !== null && cell !== null) {
          const rect = cell.getBoundingClientRect()
          contents.scrollTo({ top: contents.scrollTop + rect.top - contents.getBoundingClientRect().top - (contents.clientHeight - rect.height) / 2 })
        }
      }
    }
  }
  scope.onDispose(onJQuery(form, 'invalid-form.muForm', () => { scope.timeout(() => { renderErrors(true) }, 0) }))
  scope.observe(form, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-invalid'] }, () => { renderErrors(false) })
  scope.onDispose(() => {
    clearFilter()
    for (const [element, item] of errors) {
      item.note.remove()
      if (item.described === null) { element.removeAttribute('aria-describedby') } else { element.setAttribute('aria-describedby', item.described) }
    }
    ids.forEach((id, block) => { block.id = id })
    added.forEach((node) => { node.remove() })
    form.classList.remove('mu-cloud-form', 'mu-quick-form')
    root.classList.remove('mu-form-host')
  })
}
