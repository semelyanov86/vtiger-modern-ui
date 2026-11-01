/**
 * Settings of the browser checks from the .env of the repository (CRM_URL, CRM_ADMIN_USER, CRM_ADMIN_PASS or
 * CRM_ADMIN_PASS_FILE: a dotenv file with ADMIN_PASS=…). The password is never printed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function parseDotenv(path: string): Map<string, string> {
  const values = new Map<string, string>()
  if (!existsSync(path)) {
    return values
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) {
      continue
    }
    values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'))
  }
  return values
}

const env = parseDotenv(resolve(repoRoot, '.env'))

function setting(name: string): string {
  return process.env[name] ?? env.get(name) ?? ''
}

export function crmUrl(): string {
  const url = setting('CRM_URL')
  if (url === '') {
    throw new Error('CRM_URL is not set (.env)')
  }
  return url.endsWith('/') ? url : `${url}/`
}

export function adminCredentials(): { user: string; password: string } {
  const user = setting('CRM_ADMIN_USER') || 'admin'
  let password = setting('CRM_ADMIN_PASS')
  const file = setting('CRM_ADMIN_PASS_FILE')
  if (password === '' && file !== '') {
    password = parseDotenv(file).get('ADMIN_PASS') ?? ''
  }
  if (password === '') {
    throw new Error('set CRM_ADMIN_PASS or CRM_ADMIN_PASS_FILE in .env')
  }
  return { user, password }
}

export const stateFile = resolve(repoRoot, '.local/e2e-admin-state.json')
