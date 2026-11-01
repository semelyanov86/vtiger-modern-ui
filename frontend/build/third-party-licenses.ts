/**
 * THIRD_PARTY_LICENSES.txt of the production build (docs/dependencies.md §1): the name, version, licence
 * and licence text of every npm package whose code ends up in the bundle, plus packages that reach it in
 * another way (fonts referenced from CSS, helpers injected by build plugins). The build fails on a licence
 * outside the allowed list, so a copyleft or commercial package cannot slip into the ZIP.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { Plugin } from 'vite'

export interface ThirdPartyLicensesOptions {
  /** node_modules directory of the frontend. */
  nodeModules: string
  /** Packages that are part of the build without being modules of a chunk. */
  extraPackages: string[]
  /** SPDX identifiers that may be shipped. */
  allowed: string[]
  /** Output file name inside the build directory. */
  fileName: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface PackageInfo {
  name: string
  version: string
  license: string
  text: string
}

/** Helper modules injected by build plugins, with the package their code comes from. */
const VIRTUAL_MODULES: readonly (readonly [RegExp, string])[] = [
  [/^\0vite\//, 'vite'],
  [/^\0plugin-vue:/, '@vitejs/plugin-vue'],
]

/** Package name ("vue", "@vue/shared") of a module id inside node_modules, or null. */
export function packageNameOf(id: string): string | null {
  for (const [pattern, name] of VIRTUAL_MODULES) {
    if (pattern.test(id)) {
      return name
    }
  }
  const clean = (id.replace(/^\0/, '').split('?')[0] ?? '').split(sep).join('/')
  const marker = '/node_modules/'
  const index = clean.lastIndexOf(marker)
  if (index < 0) {
    return null
  }
  const parts = clean.slice(index + marker.length).split('/')
  const first = parts[0]
  if (first === undefined || first === '') {
    return null
  }
  if (first.startsWith('@')) {
    const second = parts[1]
    return second === undefined || second === '' ? null : `${first}/${second}`
  }
  return first
}

function readPackage(nodeModules: string, name: string): PackageInfo {
  const dir = join(nodeModules, ...name.split('/'))
  const manifest: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const version = isRecord(manifest) && typeof manifest['version'] === 'string' ? manifest['version'] : '?'
  const license = isRecord(manifest) && typeof manifest['license'] === 'string' ? manifest['license'] : 'UNKNOWN'
  const licenseFile = existsSync(dir)
    ? readdirSync(dir).find((file) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(file))
    : undefined
  const text = licenseFile === undefined ? '' : readFileSync(join(dir, licenseFile), 'utf8').trim()
  return { name, version, license, text }
}

export function thirdPartyLicenses(options: ThirdPartyLicensesOptions): Plugin {
  return {
    name: 'modernui:third-party-licenses',
    apply: 'build',
    generateBundle(_outputOptions, bundle) {
      const names = new Set<string>(options.extraPackages)
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') {
          continue
        }
        for (const id of item.moduleIds) {
          const name = packageNameOf(id)
          if (name !== null) {
            names.add(name)
          }
        }
      }
      const packages = [...names].sort().map((name) => readPackage(options.nodeModules, name))
      const rejected = packages.filter((pkg) => !options.allowed.includes(pkg.license))
      if (rejected.length > 0) {
        this.error(`ModernUI: licence not allowed in the build: ${rejected.map((pkg) => `${pkg.name} (${pkg.license})`).join(', ')}`)
      }
      const missingText = packages.filter((pkg) => pkg.text === '')
      if (missingText.length > 0) {
        this.error(`ModernUI: no licence file in ${missingText.map((pkg) => pkg.name).join(', ')}`)
      }
      const header = [
        'Third-party software in the ModernUI frontend build',
        '',
        'The files of this directory contain code of the following packages, distributed under their licences.',
        '',
      ]
      const body = packages.map((pkg) => ['='.repeat(72), `${pkg.name} ${pkg.version} — ${pkg.license}`, '='.repeat(72), '', pkg.text, ''].join('\n'))
      this.emitFile({ type: 'asset', fileName: options.fileName, source: `${header.join('\n')}\n${body.join('\n')}` })
    },
  }
}
