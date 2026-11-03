/**
 * Edit → result on the dev instance (DEV, task crm:link; task test:devcycle). Real temporary edits of the
 * repository, each undone at the end, with the time from saving the file to the change on a reloaded page:
 *
 * - PHP of the module (title of the settings page), Smarty template, PHP dictionary: through the read-only bind
 *   mounts and the language stubs, no copy and no ZIP;
 * - CSS of the skin and a Vue component: through the watcher (`vite build --watch`, started by the test);
 * - a compile error in the watcher: nothing is written, the page keeps the previous build and keeps working;
 *   fixing the error builds again; undoing every edit gives back the original build id (deterministic build).
 *
 * The test refuses to run on anything but the dev target, and checks at the end that the edited files are byte
 * for byte what they were. Report: .local/e2e-reports/dev/devcycle.json.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { repoRoot, reportDir, target } from './env'
import { HOME, LOADER, SETTINGS, waitForShell } from './support'

test.describe.configure({ mode: 'serial' })
test.skip(target !== 'dev', 'edits the sources linked into the dev instance (MU_E2E_TARGET=dev)')

const marker = `devcycle${Date.now().toString(36)}`
const files = {
  php: resolve(repoRoot, 'src/modules/Settings/ModernUI/views/Index.php'),
  tpl: resolve(repoRoot, 'src/layouts/v7/modules/Settings/ModernUI/Index.tpl'),
  scss: resolve(repoRoot, 'frontend/src/skin/skin.scss'),
  vue: resolve(repoRoot, 'frontend/src/shell/SystemMenu.vue'),
}
const dictionaries: Record<string, string> = {
  'ru-RU': resolve(repoRoot, 'src/languages/ru_ru/Settings/ModernUI.php'),
  'en-US': resolve(repoRoot, 'src/languages/en_us/Settings/ModernUI.php'),
  'de-DE': resolve(repoRoot, 'src/languages/de_de/Settings/ModernUI.php'),
}
const originals = new Map<string, string>()
const results: Record<string, number | string | boolean> = { marker }
let watcher: ChildProcess | null = null
let watcherOutput = ''

function edit(file: string, change: (text: string) => string): void {
  if (!originals.has(file)) {
    originals.set(file, readFileSync(file, 'utf8'))
  }
  const before = readFileSync(file, 'utf8')
  const after = change(before)
  expect(after, `edit of ${file} changes nothing`).not.toBe(before)
  writeFileSync(file, after)
}

function restore(file: string): void {
  const text = originals.get(file)
  if (text !== undefined) {
    writeFileSync(file, text)
  }
}

/**
 * Smarty and OPcache compare file times in whole seconds: a second write of the same file within the second in
 * which the page compiled the first one is not noticed (found on stage 03, docs/DEVELOPMENT.md). Real editing
 * is slower than that; the test waits the same way.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(1100)
}

/** Reloads the page until the condition holds; returns the milliseconds since `start`. */
async function until(page: Page, url: string, start: number, condition: (page: Page) => Promise<boolean>, timeout = 60_000): Promise<number> {
  for (;;) {
    await page.goto(url)
    if (await condition(page)) {
      return Date.now() - start
    }
    if (Date.now() - start > timeout) {
      throw new Error(`no result on ${url} after ${String(timeout)} ms`)
    }
    await page.waitForTimeout(150)
  }
}

async function buildId(page: Page): Promise<string> {
  await page.goto(HOME)
  const src = (await page.locator(LOADER).getAttribute('src')) ?? ''
  return new URL(src, page.url()).searchParams.get('b') ?? ''
}

async function waitForOutput(pattern: RegExp, from: number, timeout = 60_000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const text = watcherOutput.slice(from)
    if (pattern.test(text)) {
      return text
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`watcher output did not match ${String(pattern)}:\n${watcherOutput.slice(from)}`)
}

test.beforeAll(() => {
  watcher = spawn('npx', ['vite', 'build', '--watch'], { cwd: resolve(repoRoot, 'frontend'), stdio: ['ignore', 'pipe', 'pipe'] })
  const collect = (chunk: Buffer): void => {
    watcherOutput += chunk.toString()
  }
  watcher.stdout?.on('data', collect)
  watcher.stderr?.on('data', collect)
})

test.afterAll(() => {
  for (const file of originals.keys()) {
    restore(file)
  }
  watcher?.kill('SIGTERM')
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), 'devcycle.json'), `${JSON.stringify(results, null, 2)}\n`)
  console.log(`[devcycle] ${JSON.stringify(results)}`)
})

test('the theme is on for the administrator and the watcher has built once', async ({ page }) => {
  await waitForOutput(/built in/, 0, 120_000)
  await page.goto(SETTINGS)
  if ((await page.locator('button[name="modernui-enable-for-me"]').count()) > 0) {
    await Promise.all([page.waitForURL(/result=/), page.locator('button[name="modernui-enable-for-me"]').click()])
  }
  await page.goto(HOME)
  await waitForShell(page)
  results['buildBefore'] = await buildId(page)
  expect(results['buildBefore']).toMatch(/^[0-9a-f]{12}$/)
})

test('PHP of the module: visible after a reload', async ({ page }) => {
  const start = Date.now()
  edit(files.php, (text) => text.replace("public function getPageTitle(Vtiger_Request $request) {\n\t\treturn 'ModernUI';",
    `public function getPageTitle(Vtiger_Request $request) {\n\t\treturn 'ModernUI ${marker}';`))
  results['phpMs'] = await until(page, SETTINGS, start, async (p) => (await p.title()).includes(marker))
  await settle(page)
  restore(files.php)
  results['phpRevertMs'] = await until(page, SETTINGS, Date.now(), async (p) => !(await p.title()).includes(marker))
})

test('Smarty template: visible after a reload', async ({ page }) => {
  const start = Date.now()
  edit(files.tpl, (text) => text.replace("<h4 class=\"pull-left\">{mu_t key='LBL_TITLE'}</h4>",
    `<h4 class="pull-left">{mu_t key='LBL_TITLE'}</h4><span data-mu-devcycle="${marker}"></span>`))
  results['smartyMs'] = await until(page, SETTINGS, start, async (p) => (await p.locator(`[data-mu-devcycle="${marker}"]`).count()) === 1)
  await settle(page)
  restore(files.tpl)
  results['smartyRevertMs'] = await until(page, SETTINGS, Date.now(), async (p) => (await p.locator('[data-mu-devcycle]').count()) === 0)
})

test('PHP dictionary: visible after a reload', async ({ page }) => {
  await page.goto(SETTINGS)
  const locale = (await page.locator('.modernui-page').getAttribute('lang')) ?? 'en-US'
  const file = dictionaries[locale] ?? dictionaries['en-US'] ?? ''
  results['dictionaryLocale'] = locale
  const start = Date.now()
  edit(file, (text) => text.replace(/('LBL_SECTION_STATUS' => ')([^']*)'/, `$1$2 ${marker}'`))
  results['translationMs'] = await until(page, SETTINGS, start, async (p) => (await p.locator('h5', { hasText: marker }).count()) === 1)
  await settle(page)
  restore(file)
  results['translationRevertMs'] = await until(page, SETTINGS, Date.now(), async (p) => (await p.locator('h5', { hasText: marker }).count()) === 0)
})

test('CSS of the skin through the watcher: new build, visible after a reload', async ({ page }) => {
  const from = watcherOutput.length
  const start = Date.now()
  edit(files.scss, (text) => `${text}\n:root:not(.mu-off) {\n  --mu-devcycle: '${marker}';\n}\n`)
  await waitForOutput(/built in/, from)
  results['cssRebuildMs'] = Date.now() - start
  results['cssMs'] = await until(page, HOME, start, async (p) =>
    (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mu-devcycle'))).includes(marker))
})

test('Vue component through the watcher: new build, visible after a reload', async ({ page }) => {
  const from = watcherOutput.length
  const start = Date.now()
  edit(files.vue, (text) => text.replace('<DropdownMenuTrigger class="mu-system-menu__trigger"',
    `<DropdownMenuTrigger data-mu-devcycle="${marker}" class="mu-system-menu__trigger"`))
  await waitForOutput(/built in/, from)
  results['vueRebuildMs'] = Date.now() - start
  results['vueMs'] = await until(page, HOME, start, async (p) => {
    await waitForShell(p)
    return (await p.locator(`[data-mu-devcycle="${marker}"]`).count()) === 1
  })
})

test('compile error in the watcher: nothing written, the page keeps the last build; fixing it builds again', async ({ page }) => {
  const good = await buildId(page)
  const from = watcherOutput.length
  edit(files.vue, (text) => text.replace('<script setup lang="ts">', '<script setup lang="ts">\nconst broken = ;\n'))
  await waitForOutput(/error|Error|failed/, from)
  await page.waitForTimeout(1500)
  results['errorKeptBuild'] = (await buildId(page)) === good
  expect(results['errorKeptBuild']).toBe(true)
  await page.goto(HOME)
  await waitForShell(page)
  expect(await page.evaluate(() => document.documentElement.classList.contains('mu-shell-ready'))).toBe(true)
  expect(await page.locator(`[data-mu-devcycle="${marker}"]`).count()).toBe(1)
  // Fix: back to the edited (valid) component.
  const fixFrom = watcherOutput.length
  await settle(page)
  edit(files.vue, (text) => text.replace('<script setup lang="ts">\nconst broken = ;\n', '<script setup lang="ts">'))
  await waitForOutput(/built in/, fixFrom)
  results['recoveredMs'] = await until(page, HOME, Date.now(), async (p) => {
    await waitForShell(p)
    return (await p.locator(`[data-mu-devcycle="${marker}"]`).count()) === 1
  })
})

test('undo every edit: original files and the original build id', async ({ page }) => {
  const from = watcherOutput.length
  await settle(page)
  for (const file of originals.keys()) {
    restore(file)
  }
  await waitForOutput(/built in/, from)
  results['buildAfter'] = ''
  await until(page, HOME, Date.now(), async (p) => {
    results['buildAfter'] = await buildId(p)
    return results['buildAfter'] === results['buildBefore']
  })
  for (const [file, text] of originals) {
    expect(readFileSync(file, 'utf8'), file).toBe(text)
  }
  await page.goto(HOME)
  await waitForShell(page)
  expect(await page.locator('[data-mu-devcycle]').count()).toBe(0)
})
