import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import { pageContexts, transformSelectors, type Condition } from '../build/page-contexts'

describe('page context CSS', () => {
  it('keeps native gates and the lexicographic specificity of relational arguments', () => {
    const conditions = new Map<string, Condition>()
    const result = transformSelectors(':root:not(.mu-off)[data-mu-build]:has(#view, .a .b .c):not(:has(:where(#ignored) button.active)) .cell', conditions)
    // :has chooses the ID branch (not three classes); :where contributes zero; :not adds one class and one type.
    expect(result).toMatch(/^:root:not\(\.mu-off\)\[data-mu-build\]:is\(:where\(\[data-mu-context-[0-9a-f]{12}\]\),:where\(:not\(\*\)\)#_\._:is\(x\)\) \.cell$/)
    expect([...conditions.values()]).toEqual([expect.objectContaining({
      anchor: ':root', selector: ':root:has(#view, .a .b .c):not(:has(:where(#ignored) button.active))',
    })])
  })

  it('leaves local relational selectors and declarations alone', async () => {
    const input = ':root:not(.mu-off) .toolbar:has(> button:disabled) { display: grid; color: red }'
    const result = await postcss([pageContexts()]).process(input, { from: '/fixture/shell.scss' })
    expect(result.css).toBe(input)
  })

  it('deduplicates predicates while keeping dynamic native attributes in CSS', () => {
    const conditions = new Map<string, Condition>()
    const result = transformSelectors(':root:has(#list)[data-mu-list-search] .a, :root:not(.mu-off):has(#list) .b', conditions)
    expect(conditions.size).toBe(1)
    expect(result).toContain('[data-mu-list-search]')
    expect(result).toContain(':not(.mu-off)')
    expect(result).not.toContain(':has(')
    expect(transformSelectors(':root:has(#list) .c', new Map())).toContain([...conditions.keys()][0])
  })

  it('keeps pointer and focus state predicates in CSS', () => {
    const conditions = new Map<string, Condition>()
    const result = transformSelectors(':root:has(#list):is(:has(input:hover), :has(button:focus)) .tools', conditions)
    expect(conditions.size).toBe(1)
    expect(result).toContain(':is(:has(input:hover), :has(button:focus))')
    expect([...conditions.values()][0]?.predicate).toBe(':has(#list)')
  })

  it('provides only known route hints, then yields to actual predicates before host ready', async () => {
    const input = '@media (scripting: enabled) { :root:not(.mu-off):has(#listViewContent.listViewPageDiv #listview-actions .listViewActionsContainer) .cell { width: 42px } :root:has(.unknown-extension) .cell { color: red } :root:not(:has(.unknown-extension)) .cell { color: blue } }'
    const list = await postcss([pageContexts()]).process(input, { from: '/fixture/skin/skin-list.scss' })
    const other = await postcss([pageContexts()]).process(input, { from: '/fixture/skin/skin.scss' })
    expect(list.css.match(/data-mu-contexts-ready/g)).toHaveLength(1)
    expect(other.css).not.toContain('data-mu-contexts-ready')
    const selectors: string[] = []
    list.root.walkRules((rule) => { selectors.push(rule.selector) })
    expect(selectors.every((selector) => !selector.includes(':has('))).toBe(true)
    const metadata = list.root.nodes.find((node) => node.type === 'atrule' && node.name === 'media' && node.params === 'mu-page-contexts')
    expect(metadata).toBeDefined()
    expect(list.css).toContain('%23listViewContent')
    expect(list.css).toContain('%3Ascope')
  })
})
