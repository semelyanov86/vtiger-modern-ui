/**
 * Signs the administrator of the target instance in once and keeps the session for the other projects
 * (.local/, not in git).
 */
import { test as setup } from '@playwright/test'
import { adminCredentials, stateFile } from './env'
import { isolateNetwork, signIn } from './support'

setup('sign in as the administrator', async ({ page, context }) => {
  await isolateNetwork(context)
  await signIn(page, adminCredentials())
  await context.storageState({ path: stateFile('admin') })
})
