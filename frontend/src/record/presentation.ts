/** Cloud composition over the native nodes. No business field, action or form is recreated or moved. */
/* eslint-disable vue/one-component-per-file -- Each app mounts only in its own presentation container. */
import { createApp, h, ref, shallowRef } from 'vue'
import type { IslandScope } from '../boot/runtime'
import RecordSections from './RecordSections.vue'
import RecordControls from './RecordControls.vue'
import RecordTabs, { type OverflowTab } from './RecordTabs.vue'
import { scrollBehavior } from '../boot/motion'

export interface RecordTexts {
  readonly sections: string
  readonly search: string
  readonly empty: string
  readonly close: string
  readonly open: string
  readonly actions: string
  readonly context: string
  readonly more: string
  readonly noRelated: string
}

export function presentRecord(scope: IslandScope, root: HTMLElement, texts: RecordTexts, close?: () => void): void {
  root.classList.add('mu-cloud-record')
  const added: HTMLElement[] = []
  const header = root.querySelector<HTMLElement>('.detailview-header')
  if (header !== null) {
    const controls = document.createElement('div')
    controls.dataset['muRoot'] = 'record-controls'
    header.appendChild(controls)
    const actionsOpen = ref(false)
    const contextOpen = ref(false)
    const actions = (open: boolean): void => {
      actionsOpen.value = open
      root.classList.toggle('mu-record-actions-open', open)
    }
    const context = (open: boolean): void => {
      contextOpen.value = open
      root.classList.toggle('mu-record-context-open', open)
    }
    const app = createApp({ render: () => h(RecordControls, {
      actions: texts.actions, context: texts.context, actionsOpen: actionsOpen.value, contextOpen: contextOpen.value,
      onActions: actions, onContext: context,
    }) })
    app.mount(controls)
    scope.listen(document, 'pointerdown', (event: Event) => {
      if (event.target instanceof Node && !header.contains(event.target)) { actions(false); context(false) }
    })
    scope.listen(header, 'keydown', (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape' && (actionsOpen.value || contextOpen.value)) {
        event.preventDefault(); event.stopPropagation()
        actions(false); context(false)
        header.querySelector<HTMLElement>('.mu-record-actions-toggle')?.focus()
      }
    })
    scope.onDispose(() => { app.unmount(); controls.remove() })
  }
  if (header !== null && close !== undefined) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mu-record-back'
    button.textContent = '←'
    button.title = texts.close
    button.setAttribute('aria-label', texts.close)
    scope.listen(button, 'click', close)
    header.prepend(button)
    added.push(button)
  }

  const tabs = root.querySelector<HTMLElement>('.related-tabs')
  let updateTabs = (): void => { /* A module may have no related tabs. */ }
  if (tabs !== null) {
    const container = document.createElement('div')
    container.dataset['muRoot'] = 'record-tabs'
    tabs.appendChild(container)
    const overflow = shallowRef<readonly OverflowTab[]>([])
    const app = createApp({ render: () => h(RecordTabs, { label: texts.more, tabs: overflow.value }) })
    app.mount(container)
    updateTabs = (): void => {
      const list = tabs.querySelector<HTMLElement>('.nav-tabs')
      if (list === null) { return }
      const extras: OverflowTab[] = []
      let used = 0
      const available = tabs.clientWidth - 140
      for (const item of list.querySelectorAll<HTMLElement>(':scope > li.tab-item, :scope > li.moreTabElement')) {
        item.classList.remove('mu-tab-overflow')
        const anchor = item.querySelector<HTMLElement>('a')
        if (anchor === null) { continue }
        const label = anchor.getAttribute('displaylabel') ?? anchor.textContent.trim()
        if (anchor.hasAttribute('displaylabel')) { anchor.dataset['muTabLabel'] = label }
        used += item.getBoundingClientRect().width
        if (used > available) { item.classList.add('mu-tab-overflow'); extras.push({ label, element: anchor, active: item.classList.contains('active') }) }
      }
      for (const anchor of list.querySelectorAll<HTMLElement>('.related-tab-more-element li.more-tab a')) {
        extras.push({ label: anchor.getAttribute('displaylabel') ?? anchor.textContent.trim(), element: anchor, active: anchor.closest('li')?.classList.contains('active') ?? false })
      }
      // Child-list mutations caused by Vue must not re-render the same menu indefinitely.
      if (extras.length !== overflow.value.length || extras.some((tab, index) => tab.element !== overflow.value[index]?.element || tab.active !== overflow.value[index]?.active)) {
        overflow.value = extras
      }
    }
    const resize = new ResizeObserver(updateTabs)
    resize.observe(tabs)
    scope.onDispose(() => {
      resize.disconnect(); app.unmount(); container.remove()
      tabs.querySelectorAll('.mu-tab-overflow').forEach((node) => { node.classList.remove('mu-tab-overflow') })
    })
  }
  if (header !== null) {
    const record = root.querySelector<HTMLInputElement>('#recordId')?.value
      ?? document.querySelector<HTMLInputElement>('#recordId')?.value
    const module = root.dataset['muRecordModule'] ?? document.querySelector<HTMLInputElement>('#module')?.value
      ?? new URL(location.href).searchParams.get('module')
    if (record !== undefined && module !== null) {
      const link = document.createElement('a')
      link.className = 'mu-record-open'
      link.href = `index.php?module=${encodeURIComponent(module)}&view=Detail&record=${encodeURIComponent(record)}`
      link.target = '_blank'
      link.rel = 'noopener'
      link.textContent = '↗'
      link.title = texts.open
      link.setAttribute('aria-label', texts.open)
      header.appendChild(link)
      added.push(link)
    }
  }

  let tools: { dispose: () => void; form: HTMLElement } | null = null
  const clearTools = (): void => { tools?.dispose(); tools = null }
  const scan = (): void => {
    updateTabs()
    const related = root.querySelector<HTMLElement>('.relatedContainer:has(.relatedContents)')
    if (related !== null) {
      // Only an unfiltered first page with no real rows is empty. A failed search keeps the native filter controls.
      const filtered = Array.from(related.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.searchRow input:not([type="hidden"]), .searchRow select'))
        .some((input) => input.value.trim() !== '')
      const empty = related.querySelector('#noOfEntries')?.getAttribute('value') === '0'
        && related.querySelector('[name="currentPageNum"]')?.getAttribute('value') === '1'
        && related.querySelector('tr.listViewEntries') === null && !filtered
      related.classList.toggle('mu-related-empty', empty)
      const previous = related.querySelector('.mu-related-empty-note')
      if (empty && previous === null) {
        const note = document.createElement('p')
        note.className = 'mu-related-empty-note'
        note.dataset['muRoot'] = 'related-empty'
        const icon = document.createElement('span')
        icon.className = 'fa fa-folder-open-o'
        icon.setAttribute('aria-hidden', 'true')
        note.append(icon, document.createTextNode(texts.noRelated))
        related.prepend(note)
      } else if (!empty) { previous?.remove() }
    }
    // Native related previews share the parent's singleton overlay. The real record URL opens separately so closing
    // that page leaves both the related tab and list context intact (the full edit form remains native).
    for (const link of root.querySelectorAll<HTMLAnchorElement>('.relatedListEntryValues a[href]')) {
      const url = new URL(link.href, document.baseURI)
      if (close !== undefined && url.origin === location.origin && url.searchParams.get('view') === 'Detail' && url.searchParams.has('record')) {
        link.target = '_blank'; link.rel = 'noopener'
      }
    }
    // The native tab controller replaces only .details after AJAX; the header and our scope survive.
    const form = root.querySelector<HTMLElement>('.details #detailView')
    if (tools?.form === form) { return }
    clearTools()
    for (const tab of root.querySelectorAll<HTMLElement>('.related-tabs a[displaylabel]')) {
      const label = tab.getAttribute('displaylabel')
      if (label !== null) { tab.setAttribute('data-mu-tab-label', label) }
    }
    root.classList.toggle('mu-record-details', form !== null && form.querySelector('.block') !== null)
    if (form?.querySelector('.block') == null) { return }
    const blocks = Array.from(form.querySelectorAll<HTMLElement>('.block')).filter((block) => block.getClientRects().length > 0)
    const originals = new Map(blocks.map((block) => [block, block.id]))
    const sections = blocks.map((block, index) => {
      const id = block.id || `mu-record-section-${String(index)}`
      block.id = id
      return { id, label: block.querySelector('.blockHeader, :scope > div > h4')?.textContent.trim() ?? String(index + 1) }
    })
    const container = document.createElement('div')
    container.className = 'mu-record-tools'
    container.dataset['muRoot'] = 'record-sections'
    form.before(container)
    const app = createApp(RecordSections, {
      sections, label: texts.sections, search: texts.search, empty: texts.empty,
      onSelect: (id: string) => {
        const block = blocks.find((item) => item.id === id)
        block?.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
      },
      filter: (value: string): number => {
        const query = value.trim().toLocaleLowerCase()
        let total = 0
        for (const block of blocks) {
          // A search is a temporary filter of the already authorised fields, never an expansion of hidden fields.
          let matches = 0
          for (const label of block.querySelectorAll<HTMLElement>('td.fieldLabel')) {
            const field = label.nextElementSibling
            const match = query === '' || `${label.textContent} ${field?.textContent ?? ''}`.toLocaleLowerCase().includes(query)
            label.classList.toggle('mu-field-no-match', !match)
            field?.classList.toggle('mu-field-no-match', !match)
            if (match) { matches++ }
          }
          block.classList.toggle('mu-block-no-match', matches === 0 && query !== '')
          total += matches
        }
        return total
      },
    })
    app.mount(container)
    tools = { form, dispose: () => {
      app.unmount()
      container.remove()
      for (const [block, id] of originals) {
        block.id = id
        block.classList.remove('mu-block-no-match')
        for (const cell of block.querySelectorAll('.mu-field-no-match')) { cell.classList.remove('mu-field-no-match') }
      }
    } }
  }
  scope.observe(root, { childList: true, subtree: true }, scan)
  scope.onDispose(() => {
    clearTools()
    added.forEach((node) => { node.remove() })
    root.classList.remove('mu-cloud-record', 'mu-record-details', 'mu-record-actions-open', 'mu-record-context-open')
    root.querySelectorAll('[data-mu-tab-label]').forEach((node) => { node.removeAttribute('data-mu-tab-label') })
    root.querySelectorAll('.mu-related-empty').forEach((node) => { node.classList.remove('mu-related-empty') })
    root.querySelectorAll('.mu-related-empty-note').forEach((node) => { node.remove() })
  })
  scan()
}
