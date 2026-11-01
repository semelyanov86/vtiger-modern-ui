/**
 * Atomic switch of the production build (docs/DEVELOPMENT.md, docs/architecture.md §5.2).
 *
 * Vite writes its manifest under a temporary name together with the other files; once every file of the
 * bundle is on disk this plugin renames it to manifest.json in one step. A page therefore never sees a
 * manifest that points at chunks not written yet. Old hashed files stay as long as one of the two last
 * manifests refers to them or they are younger than `keepMinutes`, so open pages do not lose their chunks.
 * A failed build writes nothing, the previous manifest stays.
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

export interface AtomicManifestOptions {
  /** Absolute output directory of the build. */
  outDir: string
  /** Manifest name Vite writes to (relative to outDir), e.g. ".manifest.tmp.json". */
  tempName: string
  /** Final manifest name read by the loader and by PHP. */
  finalName: string
  /** Files referenced by neither of the two last manifests are deleted only when older than this. */
  keepMinutes: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Files ("assets/x.js") a parsed manifest refers to. */
export function manifestFiles(manifest: unknown): Set<string> {
  const files = new Set<string>()
  if (!isRecord(manifest)) {
    return files
  }
  for (const record of Object.values(manifest)) {
    if (!isRecord(record)) {
      continue
    }
    const candidates: unknown[] = [record['file']]
    for (const key of ['css', 'assets']) {
      const list: unknown = record[key]
      if (Array.isArray(list)) {
        candidates.push(...list)
      }
    }
    for (const file of candidates) {
      if (typeof file === 'string') {
        files.add(file)
      }
    }
  }
  return files
}

function readManifest(path: string): unknown {
  if (!existsSync(path)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return parsed
  } catch {
    return null
  }
}

export function atomicManifest(options: AtomicManifestOptions): Plugin {
  return {
    name: 'modernui:atomic-manifest',
    apply: 'build',
    writeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        const tempPath = join(options.outDir, options.tempName)
        const finalPath = join(options.outDir, options.finalName)
        const next = readManifest(tempPath)
        if (next === null) {
          this.error(`ModernUI: ${options.tempName} was not written, the previous build stays in place`)
        }
        const previous = manifestFiles(readManifest(finalPath))
        renameSync(tempPath, finalPath)

        const keep = new Set([...previous, ...manifestFiles(next)])
        const assetsDir = join(options.outDir, 'assets')
        if (!existsSync(assetsDir)) {
          return
        }
        const limit = Date.now() - options.keepMinutes * 60_000
        for (const name of readdirSync(assetsDir)) {
          const file = `assets/${name}`
          const path = join(assetsDir, name)
          if (!keep.has(file) && statSync(path).mtimeMs < limit) {
            unlinkSync(path)
          }
        }
      },
    },
  }
}
