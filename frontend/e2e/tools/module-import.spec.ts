/**
 * Imports a module ZIP through Settings → Module Manager → Import Module under the administrator, exactly as an
 * administrator does it (task clean:import-zip, task clean:seed for the Gadgets fixture, PACKAGE run on the dev
 * instance). MU_IMPORT_ZIP — path of the ZIP; MU_IMPORT_EXPECT — import | update | any (default).
 */
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { repoRoot, target } from '../env'
import { importModuleZip, isolateNetwork } from '../support'

test('Module Manager: import the ZIP', async ({ page, context }) => {
  test.setTimeout(10 * 60_000)
  const zip = process.env['MU_IMPORT_ZIP'] ?? ''
  expect(zip, 'MU_IMPORT_ZIP').not.toBe('')
  const expected = process.env['MU_IMPORT_EXPECT'] ?? 'any'
  const blocked = await isolateNetwork(context)
  const kind = await importModuleZip(page, resolve(repoRoot, zip))
  if (expected !== 'any') {
    expect(kind).toBe(expected)
  }
  console.log(`[import ${target}] ${zip}: ${kind} done; blocked external requests: ${JSON.stringify(blocked)}`)
})
