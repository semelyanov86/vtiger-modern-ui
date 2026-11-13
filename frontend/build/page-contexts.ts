/**
 * Cache relational selectors on the three large v7 containers. Browser :has() invalidation on :root/#page restyles
 * thousands of unrelated cells whenever a native widget inserts and measures a node. Small, local :has() stays CSS.
 * The loader evaluates the original predicates once per DOM mutation batch, before the next paint.
 *
 * Each skin entry also reserves its route's initial geometry. These are presentation hints, not capability checks:
 * the synchronous footer loader replaces them with the actual DOM predicates before the native ready handlers run.
 * Failure, safe mode and no-JavaScript guards stay in the selectors/media queries. No native DOM is rewritten.
 */
import { createHash } from 'node:crypto'
import postcss, { type Plugin, type Rule } from 'postcss'
import parser, { type Node, type Selector } from 'postcss-selector-parser'

export type SkinPreset = 'default' | 'list' | 'settings' | 'settings-home' | 'settings-own'
type Predicate = ['query' | 'match', string] | ['all' | 'any' | 'not', ...Predicate[]]
export interface Condition { id: string; anchor: string; selector: string; predicate: string; test: Predicate }

/** Query from the selective descendant instead of running :has's forward traversal over a large ancestor. */
function predicateTest(nodes: Node[]): Predicate {
  const tests: Predicate[] = []
  for (const node of nodes) {
    if (node.type === 'pseudo' && node.value === ':has') {
      // Leading siblings need a different query scope; preserve native matching for that uncommon case.
      if (node.nodes.some((branch) => /^[+~]/.test(branch.toString().trim()))) { tests.push(['match', node.toString()]); continue }
      tests.push(['query', node.nodes.map((branch) => ':scope ' + branch.toString().trim()).join(',')])
    } else if (node.type === 'pseudo' && [':is', ':where', ':not'].includes(node.value)) {
      const choices: Predicate[] = node.nodes.map((branch) => predicateTest(branch.nodes))
      tests.push(node.value === ':not' ? ['not', ['any', ...choices]] : ['any', ...choices])
    } else {
      // Non-relational alternatives (and future complex combinations) keep native selector semantics.
      return ['match', nodes.map((part) => part.toString()).join('')]
    }
  }
  return ['all', ...tests]
}

/** Only established first-paint structures; an unknown condition waits for the actual DOM. */
function initial(condition: Condition, preset: SkinPreset): boolean {
  const settings = preset.startsWith('settings')
  const evaluate = (test: Predicate): boolean | null => {
    if (test[0] === 'query') {
      const q = test[1].replace(/\s+/g, '').replaceAll('"', "'")
      if (q.includes('context-nav') || q.includes(':checked') || q.includes(':disabled') || q.includes('mu-form') || q.includes('mu-quick') || q.includes('mu-cloud-form')) { return false }
      if (q.includes('settingsNav')) { return settings }
      if (q.includes('settingsIndexPage')) { return preset === 'settings-home' }
      if (q.includes('modernui-page')) { return preset === 'settings-own' }
      if (q === ':scope.settingsgroup') { return settings }
      if (q === ':scope>nav.app-fixed-navbar') { return true }
      if (q.includes('mod-switcher-container')) { return !settings }
      if (q.includes('.module-action-content')) { return true }
      if (q.includes("#view[value='List']") || q.includes('#view[value=List]') || q.includes('#listViewContent.listViewPageDiv')) { return preset === 'list' }
      if (q.includes('#listview-actions') && q.includes('#table-content')) { return false }
      if (q.includes('.main-container-Reports') || q.includes('.main-container-RecycleBin')) { return false }
      return null
    }
    if (test[0] === 'match') { return null }
    const children = (test.slice(1) as Predicate[]).map(evaluate)
    if (test[0] === 'not') { return children.includes(null) ? null : !children.some(Boolean) }
    if (test[0] === 'all') { return children.includes(false) ? false : children.includes(null) ? null : true }
    return children.includes(true) ? true : children.includes(null) ? null : false
  }
  return evaluate(condition.test) === true
}

type Weight = [number, number, number]
function weight(nodes: Node[]): Weight {
  const total: Weight = [0, 0, 0]
  for (const node of nodes) {
    if (node.type === 'id') { total[0]++ }
    else if (node.type === 'class' || node.type === 'attribute') { total[1]++ }
    else if (node.type === 'tag') { total[2]++ }
    else if (node.type === 'pseudo') {
      if (node.value === ':where') { continue }
      if ([':is', ':has', ':not'].includes(node.value)) {
        const maximum = node.nodes.map((branch) => weight(branch.nodes)).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0] ?? [0, 0, 0]
        total[0] += maximum[0]; total[1] += maximum[1]; total[2] += maximum[2]
      } else if (node.value.startsWith('::')) { total[2]++ }
      else {
        if (node.nodes.length && node.value.includes(':nth-')) { throw new Error('Review specificity of nth-child in a cached page condition') }
        total[1]++
      }
    }
  }
  return total
}

/** An impossible branch preserves specificity, without repeating long DOM selectors in every compiled rule. */
function specificity(predicate: string): string {
  const [ids, classes, tags] = weight(parser().astSync(predicate).nodes[0]?.nodes ?? [])
  return ':where(:not(*))' + '#_'.repeat(ids) + '._'.repeat(classes) + ':is(x)'.repeat(tags)
}

function groups(selector: Selector): Node[][] {
  const result: Node[][] = []
  let compound: Node[] = []
  for (const node of [...selector.nodes]) {
    if (node.type === 'combinator') {
      if (compound.length) { result.push(compound) }
      compound = []
    } else { compound.push(node) }
  }
  if (compound.length) { result.push(compound) }
  return result
}

function anchorOf(compound: Node[]): Node | undefined {
  return compound.find((node) => (node.type === 'pseudo' && node.value === ':root')
    || (node.type === 'id' && node.value === 'page') || (node.type === 'class' && node.value === 'main-container'))
}

/** Exported for structural/specificity regression tests. */
export function transformSelectors(selector: string, conditions: Map<string, Condition>, preset?: SkinPreset): string {
  return parser((root) => {
    root.each((entry) => {
      let eligible = true
      let changed = false
      for (const compound of groups(entry)) {
        const anchor = anchorOf(compound)
        // Pointer/focus/validation state remains CSS. Checked/indeterminate is sampled before paint as well as on
        // mutations/events: native scripts can use .prop() without firing a change event.
        const state = /:(?:hover|active|focus|focus-within|focus-visible|target|valid|invalid|user-valid|user-invalid|placeholder-shown|autofill|visited|link)\b/
        const relational = compound.filter((node) => node.type === 'pseudo' && node.toString().includes(':has(') && !state.test(node.toString()))
        const first = relational[0]
        if (!anchor || !first) { continue }
        const predicate = relational.map((node) => node.toString().trim()).join('')
        // Parser nodes retain whitespace after a selector-list comma; it is not part of the anchor or cache key.
        const anchorName = anchor.toString().trim()
        const original = anchorName + predicate
        const id = createHash('sha256').update(original).digest('hex').slice(0, 12)
        const condition: Condition = { id, anchor: anchorName, selector: original, predicate, test: predicateTest(relational) }
        conditions.set(id, condition)
        if (preset && !initial(condition, preset)) { eligible = false; break }
        const match = preset ? ':where(*)' : `:where([data-mu-context-${id}])`
        const replacement = parser().astSync(`:is(${match},${specificity(predicate)})`).nodes[0]?.nodes
        if (!replacement) { throw new Error('Invalid page context selector') }
        first.replaceWith(...replacement)
        relational.slice(1).forEach((node) => { node.remove() })
        changed = true
      }
      if (preset) {
        if (!eligible || !changed) { entry.remove(); return }
        // The real predicates replace these hints synchronously, including on AJAX-based page structures.
        const rootNode = entry.nodes.find((node) => node.type === 'pseudo' && node.value === ':root')
        const guard = parser().astSync(':not([data-mu-contexts-ready])').nodes[0]?.nodes[0]
        if (!rootNode || !guard) { throw new Error('Initial page context must have a root theme gate') }
        entry.insertAfter(rootNode, guard)
      }
    })
  }).processSync(selector)
}

export function pageContexts(): Plugin {
  return {
    postcssPlugin: 'modernui-page-contexts',
    Once(root) {
      const file = (root.source?.input.file ?? '').replaceAll('\\', '/').split('?')[0] ?? ''
      const skin = /\/skin\/skin(?:-(list|settings|settings-home|settings-own))?\.scss$/.exec(file)
      const preset = skin ? (skin[1] ?? 'default') as SkinPreset : undefined
      const conditions = new Map<string, Condition>()
      const rules: Rule[] = []
      root.walkRules((rule) => { rules.push(rule) })
      for (const rule of rules) {
        if (!rule.selector.includes(':has(')) { continue }
        if (preset) {
          const early = transformSelectors(rule.selector, conditions, preset)
          if (early.trim()) { rule.cloneBefore({ selector: early }) }
        }
        rule.selector = transformSelectors(rule.selector, conditions)
      }
      if (!conditions.size) { return }
      // An inactive metadata rule avoids another request, inline scripts/styles, eval and CSP exceptions.
      const metadata = postcss.atRule({ name: 'media', params: 'mu-page-contexts' })
      const data = postcss.rule({ selector: ':root' })
      data.append({ prop: '--mu-page-contexts', value: JSON.stringify(encodeURIComponent(JSON.stringify([...conditions.values()].map(({ id, anchor, test }) => [id, anchor, test])))) })
      metadata.append(data)
      const source = root.source
      if (source) {
        metadata.source = source
        metadata.walk((node) => { node.source = source })
      }
      root.append(metadata)
    },
  }
}
