/**
 * Target of the browser checks and its settings. MU_E2E_TARGET selects the instance:
 *
 * - `dev` (default) — the dev instance of .env: CRM_URL, CRM_ADMIN_USER, CRM_ADMIN_PASS or CRM_ADMIN_PASS_FILE
 *   (a dotenv file with ADMIN_PASS=…);
 * - `c81`, `c85` — the clean Vtiger 8.4.0 instances of dev/clean (task clean:up): URL and passwords come from
 *   .local/clean/<target>.env written by dev/clean/clean.sh (generated secrets, never in git).
 *
 * Passwords are never printed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export type Target = 'dev' | 'c81' | 'c85'

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

function readTarget(): Target {
  const value = process.env['MU_E2E_TARGET'] ?? 'dev'
  if (value === 'dev' || value === 'c81' || value === 'c85') {
    return value
  }
  throw new Error(`MU_E2E_TARGET must be dev, c81 or c85, not "${value}"`)
}

export const target: Target = readTarget()
export const isClean = target !== 'dev'

const repoEnv = parseDotenv(resolve(repoRoot, '.env'))
const cleanEnv = isClean ? parseDotenv(resolve(repoRoot, `.local/clean/${target}.env`)) : new Map<string, string>()

function setting(name: string): string {
  if (isClean) {
    return cleanEnv.get(name) ?? ''
  }
  return process.env[name] ?? repoEnv.get(name) ?? ''
}

export function crmUrl(): string {
  const url = setting('CRM_URL')
  if (url === '') {
    throw new Error(isClean ? `no .local/clean/${target}.env — run task clean:up` : 'CRM_URL is not set (.env)')
  }
  return url.endsWith('/') ? url : `${url}/`
}

export interface Credentials {
  user: string
  password: string
}

export function adminCredentials(): Credentials {
  const user = setting('CRM_ADMIN_USER') || 'admin'
  let password = setting('CRM_ADMIN_PASS')
  const file = setting('CRM_ADMIN_PASS_FILE')
  if (password === '' && file !== '') {
    password = parseDotenv(file).get('ADMIN_PASS') ?? ''
  }
  if (password === '') {
    throw new Error(isClean ? `no admin password in .local/clean/${target}.env` : 'set CRM_ADMIN_PASS or CRM_ADMIN_PASS_FILE in .env')
  }
  return { user, password }
}

/**
 * Synthetic users of the clean stand (dev/clean/tools/seed.php): A2 — second administrator, U — restricted
 * profile, G — view-all profile. They share one generated password.
 */
export const cleanUsers = {
  admin2: 'mu.admin2',
  limited: 'mu.limited',
  viewer: 'mu.viewer',
} as const

export type CleanUser = keyof typeof cleanUsers

export function cleanUserCredentials(user: CleanUser): Credentials {
  if (!isClean) {
    throw new Error('synthetic users exist on the clean stand only')
  }
  const password = setting('MU_USERS_PASS')
  if (password === '') {
    throw new Error(`no MU_USERS_PASS in .local/clean/${target}.env`)
  }
  return { user: cleanUsers[user], password }
}

/** Database password of the clean stand, for the installer only (passed by dev/clean/clean.sh). */
export function cleanDbPassword(): string {
  const password = process.env['MU_CLEAN_DB_PASSWORD'] ?? ''
  if (password === '') {
    throw new Error('MU_CLEAN_DB_PASSWORD is passed by dev/clean/clean.sh install')
  }
  return password
}

export function stateFile(user = 'admin'): string {
  // The dev administrator keeps the file name of stage 02.
  return target === 'dev' && user === 'admin'
    ? resolve(repoRoot, '.local/e2e-admin-state.json')
    : resolve(repoRoot, `.local/e2e-${target}-${user}-state.json`)
}

/** Where the scenario reports go (metrics only, no page content): .local/e2e-reports/<target>/. */
export function reportDir(): string {
  return resolve(repoRoot, `.local/e2e-reports/${target}`)
}
