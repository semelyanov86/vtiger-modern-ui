/**
 * Entry "settings": Settings → ModernUI. The page itself is server-rendered and works without this script (status,
 * switches, pilot forms, recovery; "&editor=off" shows it alone). This entry mounts the settings editor above it and
 * the check of the frontend build below.
 */
// createApp() of imported single-file components, not components defined here.
/* eslint-disable vue/one-component-per-file */
import '../styles/base.scss'
import './editor.scss'
import { createApp } from 'vue'
import { fetchBootstrap } from '../api/client'
import { ApiError } from '../api/guards'
import type { Bootstrap } from '../api/types'
import { createThemeI18n } from '../i18n'
import { editorMessages } from '../i18n/editor'
import { FALLBACK_LOCALE, normalizeLocale, type ThemeLocale } from '../i18n/locale'
import { IslandRuntime } from '../boot/runtime'
import { ensureOverlayRoot } from '../boot/overlay'
import DiagnosticsPanel, { type DiagnosticsResult } from './DiagnosticsPanel.vue'
import EditorLoader from './EditorLoader.vue'
import { setPageFont } from './pageFont'

async function check(): Promise<DiagnosticsResult> {
  try {
    return { ok: true, data: await fetchBootstrap() }
  } catch (error) {
    return { ok: false, code: error instanceof ApiError ? error.code : 'MU_UNKNOWN' }
  }
}

async function start(): Promise<void> {
  const diagnostics = document.querySelector<HTMLElement>('[data-mu-root="settings-diagnostics"]')
  const editor = document.querySelector<HTMLElement>('[data-mu-root="settings-editor"]')
  if (diagnostics === null && editor === null) {
    return
  }
  const pageBuild = (diagnostics ?? editor)?.dataset['muBuild'] ?? ''
  const pageLocale = normalizeLocale((diagnostics ?? editor)?.closest('[lang]')?.getAttribute('lang'))
  const first = await check()
  const locale: ThemeLocale = first.ok ? first.data.locale.effective : pageLocale ?? FALLBACK_LOCALE
  const bootstrap: Bootstrap | null = first.ok ? first.data : null
  const i18n = createThemeI18n(locale, editorMessages)
  const runtime = new IslandRuntime()
  ensureOverlayRoot()
  setPageFont(bootstrap?.theme.active === true ? bootstrap.appearance.tokens['font-family'] : undefined)
  if (editor !== null) {
    editor.classList.add('mu-root')
    runtime.register({
      id: 'settings-editor',
      place: () => ({ kind: 'existing', container: editor }),
      create: () => {
        // The server forms of the pilot are replaced by the editor (still there with "&editor=off" or without JavaScript).
        for (const fallback of document.querySelectorAll<HTMLElement>('[data-mu-fallback="pilot"], [data-mu-fallback="link"]')) {
          fallback.hidden = true
        }
        return createApp(EditorLoader, { bootstrap }).use(i18n)
      },
    })
  }
  if (diagnostics !== null) {
    diagnostics.classList.add('mu-root')
    runtime.register({
      id: 'settings-diagnostics',
      place: () => ({ kind: 'existing', container: diagnostics }),
      create: () => createApp(DiagnosticsPanel, { initial: first, pageBuild, check }).use(i18n),
    })
  }
  // A server-rendered page of the module: nothing re-renders the containers, no watching needed.
  runtime.start({ watch: false })
}

void start()
