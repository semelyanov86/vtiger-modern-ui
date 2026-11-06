/**
 * Stage 08 — a custom entity module that ModernUI does not know, installed after ModernUI (clean stand only, project "clean";
 * fixture tests/fixtures/gizmos):
 *
 * - imported through Settings → Module Manager → Import: it appears in the menu of the theme (its app group) and its list and
 *   record open with the theme, as any module;
 * - the menu follows the rights of Vtiger: a restricted user sees the module exactly when v7 lets him open it, also after his
 *   profile changed (Settings → Profiles → Edit);
 * - switched off in the Module Manager: gone from the menu, its URL answers as v7 does, without errors of the theme; switched on:
 *   back;
 * - removed (Vtiger_Module::delete() and its files, as an administrator of 8.4.0 does it): the menu, favorites and pages of the
 *   theme keep working without it.
 *
 * Writes on the clean stand only: the module, one synthetic record MU08, a profile permission, settings of ModernUI (written back).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { deflateRawSync, crc32 } from 'node:zlib'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { adminCredentials, cleanUserCredentials, crmUrl, isClean, repoRoot, target, type CleanUser } from './env'
import { importModuleZip, isolateNetwork, setModuleActive, signIn, waitForShell, watchErrors } from './support'
import { bootstrap, clearPersonal, globalScope, patchGlobal, saveGlobal, savePersonal, type Scope } from './settings-api'
import { deleteSynthetic, token } from './records-support'

test.describe.configure({ mode: 'serial' })
test.skip(!isClean, 'clean stand only (MU_E2E_TARGET=c81|c85)')

const MODULE = 'Gizmos'
const MARK = 'MU08'

interface Session {
  context: BrowserContext
  page: Page
}

async function session(browser: Browser, user: CleanUser | 'admin'): Promise<Session> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const page = await context.newPage()
  await signIn(page, user === 'admin' ? adminCredentials() : cleanUserCredentials(user))
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
  return { context, page }
}

/** A ZIP of the fixture (stored entries with CRC; vtlib's Unzip reads them), written into .local/. */
function fixtureZip(): string {
  const root = resolve(repoRoot, 'tests/fixtures/gizmos')
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else {
        files.push(relative(root, path))
      }
    }
  }
  walk(root)
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = readFileSync(join(root, file))
    const packed = deflateRawSync(data)
    const name = Buffer.from(file.split('\\').join('/'))
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(crc32(data) >>> 0, 14)
    header.writeUInt32LE(packed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, packed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt32LE(crc32(data) >>> 0, 16)
    entry.writeUInt32LE(packed.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += header.length + name.length + packed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  const out = resolve(repoRoot, '.local/clean/Gizmos-1.0.0.zip')
  mkdirSync(resolve(repoRoot, '.local/clean'), { recursive: true })
  writeFileSync(out, Buffer.concat([...local, directory, end]))
  return out
}

/** Vtiger_Module::delete() and the files of the fixture, in the web container of the instance (dev/clean/tools/remove-module.php). */
function removeModule(): string {
  return execFileSync(resolve(repoRoot, 'dev/clean/clean.sh'), ['php', target, '/opt/mu-dev/clean/tools/remove-module.php', '.', MODULE], { stdio: 'pipe' }).toString()
}

/** tabid of the fixture module ('' when it is not registered), read-only query of the clean stand. */
function tabid(): string {
  const out = execFileSync(resolve(repoRoot, 'dev/clean/clean.sh'), ['query', target, `SELECT tabid FROM vtiger_tab WHERE name = '${MODULE}'`], { stdio: 'pipe' }).toString()
  return /(\d+)/.exec(out)?.[1] ?? ''
}

function registered(): boolean {
  return tabid() !== ''
}

interface Menu {
  groups: { app: string | null; items: { module: string }[] }[]
  favorites: { module: string }[]
  modules: string[]
}

async function menu(page: Page): Promise<Menu> {
  return (await bootstrap(page))['menu'] as Menu
}

/** Whether v7 lets the user open the list of the module (safe mode of the session: the CRM without the theme). */
async function v7Opens(page: Page): Promise<boolean> {
  const response = await page.request.get(`index.php?module=${MODULE}&view=List&modernui=off`)
  const body = await response.text()
  await page.request.get('index.php?modernui=on')
  return response.status() === 200 && !body.includes('denied.gif') && body.includes(`module=${MODULE}`)
}

let original: Scope
let admin: Session

test.beforeAll(async ({ browser }) => {
  admin = await session(browser, 'admin')
  original = await globalScope(admin.page)
  // Every user gets the theme for these checks (written back at the end).
  await patchGlobal(admin.page, { 'theme.mode': 'all' })
  if (registered()) {
    removeModule()
  }
})

test.afterAll(async () => {
  if (registered()) {
    removeModule()
  }
  await clearPersonal(admin.page)
  const current = await globalScope(admin.page)
  const saved = await saveGlobal(admin.page, original.values, current.revision)
  expect(saved.ok, saved.text.slice(0, 200)).toBe(true)
  await admin.context.close()
})

test('a module installed after ModernUI: in the menu of its app, its list and record open with the theme', async () => {
  const page = admin.page
  expect(await importModuleZip(page, fixtureZip()), 'Module Manager: a new module').toBe('import')
  const data = await menu(page)
  expect(data.modules, 'modules the administrator may open').toContain(MODULE)
  const group = data.groups.find((entry) => entry.items.some((item) => item.module === MODULE))
  expect(group?.app, 'the group of its app (manifest parent Support)').toBe('SUPPORT')

  const errors = watchErrors(page)
  await page.goto(`index.php?module=${MODULE}&view=List&modernui=on`)
  await waitForShell(page)
  await expect(page.locator('html')).toHaveClass(/mu-shell-ready/)
  // The mega menu finds it by its label.
  await page.locator('[data-mu-trigger="mega-menu"]').click()
  await page.locator('[data-mu-field="menu-search"]').fill('Gizmo')
  await expect(page.locator(`[data-mu-panel="mega-menu"] a[href*="module=${MODULE}"]`).first()).toBeVisible()
  await page.keyboard.press('Escape')

  // A synthetic record through the standard form, opened with the theme.
  await page.goto(`index.php?module=${MODULE}&view=Edit&modernui=on`)
  await page.locator('#EditView input[name="gizmoname"]').fill(`${MARK}-${Date.now().toString(36)} Größe`)
  await Promise.all([page.waitForURL(/view=Detail/), page.locator('#EditView button[type="submit"]').first().click()])
  await waitForShell(page)
  await expect(page.locator('.detailview-header')).toContainText(MARK)
  const record = new URL(page.url()).searchParams.get('record') ?? ''
  expect(record).toMatch(/^\d+$/)
  expect(errors.page, 'no page errors').toEqual([])
  await deleteSynthetic(page, MODULE, record, MARK)
})

test('the menu of a restricted user follows the rights of Vtiger for the new module, also after his profile changed', async ({ browser }) => {
  const limited = await session(browser, 'limited')
  try {
    expect((await menu(limited.page)).modules.includes(MODULE), 'in the menu exactly when v7 opens it').toBe(await v7Opens(limited.page))

    // Settings → Profiles → Edit of his profile: the module unchecked, saved by the form of v7.
    const page = admin.page
    await page.goto('index.php?module=Profiles&parent=Settings&view=List&modernui=on')
    const row = page.locator('tr.listViewEntries', { hasText: 'MU Restricted' }).first()
    const profile = (await row.getAttribute('data-id')) ?? ''
    expect(profile).toMatch(/^\d+$/)
    await page.goto(`index.php?module=Profiles&parent=Settings&view=Edit&record=${profile}&modernui=on`)
    const box = page.locator(`input.modulesCheckBox[data-value="${tabid()}"]`)
    await expect(box).toBeChecked()
    await box.uncheck()
    // The save answers with a redirect to the profile (with the theme and without it the browser is then left on an empty
    // page by this screen of v7): the answer of the save is what counts.
    const saved = page.waitForResponse((response) => response.request().method() === 'POST'
      && (response.request().postData() ?? '').includes('action=Save') && (response.request().postData() ?? '').includes('module=Profiles'))
    await page.locator('button.saveButton').click()
    expect((await saved).status(), 'profile saved').toBe(302)

    // A new session of the user: his privileges are recalculated by the save of the profile.
    await limited.context.close()
    const again = await session(browser, 'limited')
    try {
      expect(await v7Opens(again.page), 'v7 refuses the module now').toBe(false)
      expect((await menu(again.page)).modules, 'not in his menu').not.toContain(MODULE)
      await again.page.goto(`index.php?module=${MODULE}&view=List&modernui=on`)
      await expect(again.page.locator('img[src*="denied.gif"]'), 'the refusal page of v7 with the theme').toHaveCount(1)
    } finally {
      await again.context.close()
    }
  } finally {
    await limited.context.close().catch(() => undefined)
  }
})

test('switched off in the Module Manager: gone from the menu and answered as v7 does; switched on: back', async () => {
  const page = admin.page
  await setModuleActive(page, MODULE, false)
  expect((await menu(page)).modules, 'switched off: not in the menu').not.toContain(MODULE)
  const errors = watchErrors(page)
  const answers: Record<string, { status: number; text: string; theme: boolean }> = {}
  for (const mode of ['off', 'on']) {
    const response = await page.goto(`index.php?module=${MODULE}&view=List&modernui=${mode}`)
    await page.waitForLoadState('load')
    answers[mode] = {
      status: response?.status() ?? 0,
      text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 300),
      theme: (await page.locator('link[href*="modules/ModernUI/resources"]').count()) > 0,
    }
  }
  // v7 answers a module that is switched off with its own message: the same with the theme on (any theme resources on such a
  // page only style it; the message is the one of v7).
  expect(answers['on']?.status, 'status of the answer').toBe(answers['off']?.status)
  expect(answers['on']?.text, 'the message of v7').toContain((answers['off']?.text ?? '').slice(0, 80))
  expect(errors.page, 'no page errors').toEqual([])
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  await setModuleActive(page, MODULE, true)
  expect((await menu(page)).modules, 'switched on: back in the menu').toContain(MODULE)
})

test('removed (Vtiger_Module::delete() and its files): the menu, favorites and pages of the theme keep working without it', async () => {
  const page = admin.page
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  await savePersonal(page, { 'navigation.favorites': [MODULE, 'Contacts'] })
  expect((await menu(page)).favorites.map((item) => item.module)).toContain(MODULE)
  const out = removeModule()
  expect(out).toContain('deleted')
  const errors = watchErrors(page)
  for (const url of ['index.php?module=Home&view=DashBoard', 'index.php?module=Contacts&view=List', 'index.php?module=ModernUI&parent=Settings&view=Index']) {
    await page.goto(`${url}&modernui=on`)
    await waitForShell(page)
    await expect(page.locator('html')).toHaveClass(/mu-shell-ready/)
  }
  const data = await menu(page)
  expect(data.modules, 'not in the menu').not.toContain(MODULE)
  expect(data.favorites.map((item) => item.module), 'favorites keep the other modules').toEqual(['Contacts'])
  expect(errors.page, 'no page errors').toEqual([])
  expect(await token(page)).not.toBe('')
})
