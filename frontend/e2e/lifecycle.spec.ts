/** Stage 20: real 0.6.0 → candidate ZIP, failure/recovery and uninstall on synthetic clean instances only. */
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { cleanUserCredentials, crmUrl, isClean, repoRoot, reportDir, target } from './env'
import { bootstrap, clearPersonal, editorData, post, saveGlobal, savePersonal } from './settings-api'
import { importModuleZip, isolateNetwork, MODULE_IMPORT, setModuleActive, SETTINGS_FORMS, signIn, themeOnPage, waitForShell } from './support'
import { captureLifecycleProfile } from './lifecycle-profile'
import { deleteSynthetic, token } from './records-support'

test.skip(!isClean, 'lifecycle changes only the synthetic clean stand')

const clean = resolve(repoRoot, 'dev/clean/clean.sh')
const root = target === 'c85' ? '/var/www/html/vtigercrm' : '/var/www/html'
const helper = ['php', target, '/opt/mu-dev/clean/tools/lifecycle.php', root]
const version = readFileSync(resolve(repoRoot, 'VERSION'), 'utf8').trim()
const candidate = resolve(repoRoot, `dist/ModernUI-${version}.zip`)
const previous = resolve(repoRoot, 'dist/ModernUI-0.6.0.zip')
const accounts = 'index.php?module=Accounts&view=List'

interface Snapshot {
  settings: { scope: string; key: string; document: Record<string, unknown> }[]
  meta: Record<string, unknown>
}

function command(args: string[], input?: string): string {
  return execFileSync(clean, args, { cwd: repoRoot, encoding: 'utf8', input, env: { ...process.env, MU_CLEAN_INSTANCES: target }, timeout: 120_000 })
}

function probe(action = 'probe', argument?: string): Record<string, unknown> {
  return JSON.parse(command([...helper, action, ...(argument === undefined ? [] : [argument])])) as Record<string, unknown>
}

function snapshot(): Snapshot {
  return JSON.parse(command([...helper, 'snapshot'])) as Snapshot
}

async function ordinary(page: Page): Promise<void> {
  // Stop requests belonging to the previous document before recording this page's network.
  await page.goto('about:blank')
  const requests: string[] = []
  const capture = (request: { url(): string }): void => { if (request.url().includes('ModernUI')) requests.push(request.url()) }
  page.on('request', capture)
  try {
    await page.goto(accounts)
    await expect(page.locator('#listview-table')).toBeVisible()
    expect(await themeOnPage(page)).toMatchObject({ skin: 0, tokens: 0, loader: 0, ready: false })
    expect(requests, 'no dangling theme endpoints or files').toEqual([])
  } finally {
    page.off('request', capture)
  }
}

async function themed(page: Page): Promise<void> {
  await page.goto(`${accounts}&modernui=on`)
  await waitForShell(page)
  expect(await themeOnPage(page)).toMatchObject({ skin: 1, tokens: 1, loader: 1, ready: true, failed: null })
}

async function recovery(page: Page): Promise<void> {
  await page.goto(SETTINGS_FORMS)
  await Promise.all([page.waitForURL(/result=recovered/), page.locator('button[name="modernui-recovery"]').click()])
}

test('ZIP lifecycle preserves every scope, fails safe and recovers without changing host data', async ({ page, browser }) => {
  test.setTimeout(600_000)
  const context = await browser.newContext({ baseURL: crmUrl(), storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const user = await context.newPage()
  await signIn(user, cleanUserCredentials('limited'))
  const original = snapshot()
  const hostBefore = probe('host-state')
  const evidence: Record<string, unknown> = {
    target, version, sha256: createHash('sha256').update(readFileSync(candidate)).digest('hex'),
    previousSha256: createHash('sha256').update(readFileSync(previous)).digest('hex'), steps: [],
  }
  const steps = evidence['steps'] as string[]
  const state = { installedCandidate: false, hiddenAsset: false, collision: false }
  try {
    await test.step('install the real previous ZIP and enable one user only', async () => {
      command(['uninstall'])
      await ordinary(user)
      probe('collision', 'create')
      state.collision = true
      await page.goto(MODULE_IMPORT)
      const form = page.locator('#importUserModule')
      await form.locator('[name="acceptDisclaimer"]').check()
      await form.locator('[name="moduleZip"]').setInputFiles(previous)
      await Promise.all([page.waitForURL(/\/index\.php$/), form.locator('[name="importFromZip"]').click()])
      await expect(page.locator('#importModules .alert-info')).toBeVisible()
      await expect(page.locator('#importModules [name="module_import_name"]')).toHaveCount(0)
      expect(probe('collision', 'check')['fixture']).toBe('check')
      await page.goto(accounts)
      probe('collision', 'remove')
      state.collision = false
      steps.push('orphan directory: Module Manager warns before installation; preview leaves the sentinel unchanged')
      expect(await importModuleZip(page, previous)).toBe('import')
      expect(probe()['version']).toBe('0.6.0')
      await ordinary(user)
      await page.goto(SETTINGS_FORMS)
      const data = await editorData(page)
      const users = data['users'] as { id: number; userName: string }[]
      // Resolve the fixture by its login; database ids differ between installations.
      const userId = users.find((item) => item.userName === cleanUserCredentials('limited').user)?.id ?? 0
      expect(userId).toBeGreaterThan(0)
      expect(users.length).toBeGreaterThan(1)
      const saved = await saveGlobal(page, {
        'theme.mode': 'pilot', 'theme.pilot.users': [userId], 'appearance.primaryColor': '#2868a5',
        'navigation.groups': [{ id: 'work', label: { 'en-US': 'Work', 'ru-RU': 'Работа', 'de-DE': 'Arbeit' }, icon: 'briefcase',
          collapsed: false, items: [{ type: 'module', module: 'Accounts', label: null, icon: null }] }],
      })
      expect(saved.ok, saved.text).toBe(true)
      await ordinary(page)
      await themed(user)
      const roles = data['roles'] as { id: string; name: string; profile: { revision: number } | null }[]
      const role = roles.find((item) => item.name === 'MU Restricted Sales')
      expect(role).toBeDefined()
      const roleSaved = await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: 'role',
        role: role?.id ?? '', baseRevision: String(role?.profile?.revision ?? 0), inherit: '1',
        values: JSON.stringify({ 'appearance.density': 'compact', 'locale.default': 'ru-RU' }) })
      expect(roleSaved.ok, roleSaved.text).toBe(true)
      expect((await savePersonal(user, { locale: 'de-DE', 'navigation.favorites': ['Accounts', 'Contacts'] })).ok).toBe(true)
      steps.push('previous ZIP installed; one-user pilot; global/role/user documents configured')
    })
    const configured = snapshot().settings
    await test.step('disable and enable through Module Manager', async () => {
      await setModuleActive(page, 'ModernUI', false)
      await ordinary(user)
      expect(probe()['links']).toEqual([])
      await setModuleActive(page, 'ModernUI', true)
      await themed(user)
      expect(snapshot().settings).toEqual(configured)
      steps.push('disable/enable: no theme requests while disabled; all scopes kept')
    })
    await test.step('real ZIP update and idempotent postupdate', async () => {
      expect(await importModuleZip(page, candidate)).toBe('update')
      state.installedCandidate = true
      expect(probe()['version']).toBe(version)
      for (const decision of Object.values(probe('compatibility'))) {
        expect(decision).toMatchObject({ active: false, reason: 'MU_UNSUPPORTED_VTIGER', links: [] })
      }
      expect(snapshot().settings).toEqual(configured)
      probe('event', 'module.postupdate')
      probe('event', 'module.postupdate')
      expect(snapshot().settings).toEqual(configured)
      await themed(user)
      const data = await bootstrap(user)
      expect(data['locale']).toMatchObject({ effective: 'de-DE', source: 'personal' })
      expect((data['menu'] as { favorites: { id: string }[] }).favorites.map((item) => item.id)).toEqual(['m:Accounts', 'm:Contacts'])
      await captureLifecycleProfile(user, 'upgraded-restricted', false)
      steps.push('0.6.0 → candidate: exact scope documents, personal language/favorites/menu kept; registration idempotent')
    })
    await test.step('interruption and real migration lock failure stay in the ordinary UI', async () => {
      expect(probe('event', 'module.preupdate')).toMatchObject({ active: false, reason: 'MU_RECOVERY_REQUIRED', links: [], updating: true })
      await ordinary(user)
      const blocked = await user.request.get('index.php?module=ModernUI&action=Bootstrap')
      expect(blocked.status()).toBe(409)
      expect(await blocked.json()).toMatchObject({ success: false, error: { code: 'MU_RECOVERY_REQUIRED' } })
      await page.goto(SETTINGS_FORMS)
      await expect(page.locator('[role="status"].alert-warning')).toBeVisible()
      // A separate database connection holds the real migration lock beyond its ten-second timeout.
      let ready!: () => void
      const locked = new Promise<void>((resolveReady) => { ready = resolveReady })
      const released = new Promise<void>((resolveDone, reject) => {
        const child = execFile(clean, [...helper, 'hold-lock', '18'], { cwd: repoRoot }, (error) => {
          if (error === null) resolveDone()
          else reject(new Error('Migration lock helper failed', { cause: error }))
        })
        child.stdout?.on('data', (chunk: Buffer) => { if (chunk.toString().includes('locked')) ready() })
        child.on('error', reject)
      })
      await Promise.race([locked, released.then(() => { throw new Error('lock was not acquired') })])
      try {
        expect(probe('event', 'module.postupdate')).toMatchObject({ active: false, reason: 'MU_RECOVERY_REQUIRED', links: [], updating: true, error: 'MU_MIGRATION_LOCKED' })
        await ordinary(user)
      } finally {
        await released
      }
      await recovery(page)
      expect(probe()).toMatchObject({ updating: false, error: null })
      await themed(user)
      expect(snapshot().settings).toEqual(configured)
      steps.push('interrupted update + migration lock timeout: standard UI; administrator recovery clears markers and keeps settings')
    })
    await test.step('missing asset and safe recovery', async () => {
      const moved = probe('asset', 'hide')
      state.hiddenAsset = true
      await ordinary(user)
      expect(probe('asset', 'restore')['sha256']).toBe(moved['sha256'])
      state.hiddenAsset = false
      await themed(user)
      steps.push('missing manifest: no theme requests; byte-identical asset restored')
    })
    await test.step('uninstall and reinstall preserve preferences but turn the theme off', async () => {
      command(['uninstall'])
      state.installedCandidate = false
      await ordinary(user)
      expect(command(['query', target, "SELECT COUNT(*) FROM vtiger_links WHERE linklabel LIKE 'ModernUI%'"]).trim()).toBe('0')
      expect(command(['query', target, "SELECT COUNT(*) FROM vtiger_settings_field WHERE name = 'ModernUI'"]).trim()).toBe('0')
      expect(await importModuleZip(page, candidate)).toBe('import')
      state.installedCandidate = true
      await ordinary(user)
      const expected = structuredClone(configured)
      const global = expected.find((row) => row.scope === 'global')
      ;(global?.document['theme'] as Record<string, unknown>)['mode'] = 'off'
      expect(snapshot().settings).toEqual(expected)
      expect(probe('host-state')).toEqual(hostBefore)
      steps.push('uninstall removes links/endpoints; reinstall keeps all documents with theme off; host records/settings/roles/formats unchanged')
    })
    evidence['passed'] = true
  } finally {
    try {
      if (state.collision) probe('collision', 'remove')
      if (state.hiddenAsset) probe('asset', 'restore')
      if (!state.installedCandidate) await importModuleZip(page, candidate)
      await recovery(page)
      command([...helper, 'restore'], JSON.stringify(original))
      expect(snapshot()).toEqual(original)
      evidence['restored'] = true
    } finally {
      mkdirSync(reportDir(), { recursive: true })
      writeFileSync(resolve(reportDir(), 'lifecycle.json'), `${JSON.stringify(evidence, null, 2)}\n`)
      await context.close()
    }
  }
})

test('default and newly created user profiles preserve native fields, forms and administrative permissions', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const original = snapshot()
  const username = `mu20.${Date.now().toString(36)}`
  const password = cleanUserCredentials('limited').password
  let userId = ''
  let record = ''
  const context = await browser.newContext({ baseURL: crmUrl(), storageState: { cookies: [], origins: [] } })
  try {
    await isolateNetwork(context)
    await page.goto(SETTINGS_FORMS)
    expect((await saveGlobal(page, { 'theme.mode': 'all' })).ok).toBe(true)
    await clearPersonal(page)
    await captureLifecycleProfile(page, 'default-admin', true)
    const data = await editorData(page)
    const roles = data['roles'] as { id: string; name: string }[]
    const role = roles.find((item) => item.name === 'MU Restricted Sales')
    expect(role).toBeDefined()
    await page.goto('index.php?module=Users&parent=Settings&view=Edit&modernui=on')
    await waitForShell(page)
    const form = page.locator('form#EditView')
    await form.locator('[name="user_name"]').fill(username)
    await form.locator('[name="email1"]').fill(`${username}@clean.example.test`)
    await form.locator('[name="last_name"]').fill('MU20 New User')
    await form.locator('[name="user_password"]').fill(password)
    await form.locator('[name="confirm_password"]').fill(password)
    await form.locator('select[name="roleid"]').selectOption(role?.id ?? '')
    await Promise.all([page.waitForURL(/module=Users.*view=Detail.*record=\d+/), form.locator('.saveButton').first().click()])
    userId = new URL(page.url()).searchParams.get('record') ?? ''
    expect(userId).toMatch(/^\d+$/)
    expect(snapshot().settings.some((row) => row.scope === 'user' && row.key === userId)).toBe(false)
    const saved = await page.request.post('index.php', {
      form: { module: 'Accounts', action: 'SaveAjax', accountname: `MU20 ${username}`, assigned_user_id: userId, __vtrftk: await token(page) },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    const result = await saved.json() as { success: boolean; result: { _recordId: number } }
    expect(result.success).toBe(true)
    record = String(result.result._recordId)
    const user = await context.newPage()
    await signIn(user, { user: username, password })
    await captureLifecycleProfile(user, 'new-restricted', false, record)
    expect(snapshot().settings.some((row) => row.scope === 'user' && row.key === userId)).toBe(false)
  } finally {
    await context.close()
    try {
      if (record !== '') await deleteSynthetic(page, 'Accounts', record, 'MU20')
      if (userId !== '') {
        await page.goto('index.php?module=Users&parent=Settings&view=List&modernui=on')
        await waitForShell(page)
        const row = page.locator(`tr.listViewEntries[data-id="${userId}"]`)
        await expect(row).toContainText(username)
        await row.locator('.dropdown-toggle').click()
        await row.locator('.dropdown-menu a').filter({ hasText: /^(?:Delete|Удалить|Löschen)$/ }).click()
        await page.locator('.bootbox [data-bb-handler="confirm"]').click()
        const form = page.locator('form#deleteUser')
        await expect(form.locator('[name="userid"]')).toHaveValue(userId)
        await form.locator('[name="deleteUserPermanent"]').check()
        await form.locator('button[type="submit"]').click()
        await expect(page.locator(`tr.listViewEntries[data-id="${userId}"]`)).toHaveCount(0)
      }
    } finally {
      command([...helper, 'restore'], JSON.stringify(original))
      expect(snapshot()).toEqual(original)
    }
  }
})
