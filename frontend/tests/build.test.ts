import { mkdtempSync, readdirSync, utimesSync, writeFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicManifest, manifestFiles } from '../build/atomic-manifest'
import { packageNameOf } from '../build/third-party-licenses'

let dir = ''

afterEach(() => {
  if (dir !== '') {
    rmSync(dir, { recursive: true, force: true })
  }
})

function write(path: string, content: string, minutesAgo = 0): void {
  writeFileSync(join(dir, path), content)
  const time = new Date(Date.now() - minutesAgo * 60_000)
  utimesSync(join(dir, path), time, time)
}

function runWriteBundle(): void {
  const plugin = atomicManifest({ outDir: dir, tempName: '.manifest.tmp.json', finalName: 'manifest.json', keepMinutes: 10 })
  const hook = plugin.writeBundle as { handler: (this: unknown) => void }
  hook.handler.call({ error: (message: string) => { throw new Error(message) } })
}

describe('atomic manifest switch', () => {
  it('renames the manifest last and removes only old files no manifest refers to', () => {
    dir = mkdtempSync(join(tmpdir(), 'mu-manifest-'))
    mkdirSync(join(dir, 'assets'))
    write('assets/shell-old.js', '', 30)
    write('assets/stale.js', '', 30)
    write('assets/young.js', '', 1)
    write('assets/shell-new.js', '')
    write('manifest.json', JSON.stringify({ 'src/shell/main.ts': { file: 'assets/shell-old.js' } }))
    write('.manifest.tmp.json', JSON.stringify({ 'src/shell/main.ts': { file: 'assets/shell-new.js', css: [] } }))
    runWriteBundle()
    expect(existsSync(join(dir, '.manifest.tmp.json'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))).toEqual({ 'src/shell/main.ts': { file: 'assets/shell-new.js', css: [] } })
    expect(readdirSync(join(dir, 'assets')).sort()).toEqual(['shell-new.js', 'shell-old.js', 'young.js'])
  })

  it('keeps the previous build when no new manifest was written', () => {
    dir = mkdtempSync(join(tmpdir(), 'mu-manifest-'))
    write('manifest.json', '{}')
    expect(() => { runWriteBundle() }).toThrow(/previous build stays/)
    expect(readFileSync(join(dir, 'manifest.json'), 'utf8')).toBe('{}')
  })

  it('collects the files of a manifest', () => {
    expect([...manifestFiles({ a: { file: 'assets/a.js', css: ['assets/a.css'], assets: ['assets/f.woff2'] }, b: 1 })].sort())
      .toEqual(['assets/a.css', 'assets/a.js', 'assets/f.woff2'])
  })
})

describe('third-party licences', () => {
  it('finds the package of a module id', () => {
    expect(packageNameOf('/x/frontend/node_modules/vue/dist/vue.js')).toBe('vue')
    expect(packageNameOf('/x/node_modules/@vue/shared/dist/x.js?commonjs')).toBe('@vue/shared')
    expect(packageNameOf('/x/node_modules/a/node_modules/@floating-ui/dom/x.js')).toBe('@floating-ui/dom')
    expect(packageNameOf('\0vite/preload-helper.js')).toBe('vite')
    expect(packageNameOf('\0plugin-vue:export-helper')).toBe('@vitejs/plugin-vue')
    expect(packageNameOf('/x/frontend/src/shell/main.ts')).toBeNull()
  })
})
