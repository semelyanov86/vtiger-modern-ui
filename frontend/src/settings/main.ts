/**
 * Entry "settings": the frontend check on Settings → ModernUI. The page itself is server-rendered and works
 * without this script; the island only proves that the build loads in this browser and that the Bootstrap
 * answer of the server passes the runtime checks. The full settings editor comes with stage 05.
 */
import '../styles/base.scss'
import { createApp } from 'vue'
import { fetchBootstrap } from '../api/client'
import { ApiError } from '../api/guards'
import { createThemeI18n } from '../i18n'
import { FALLBACK_LOCALE, normalizeLocale, isThemeLocale } from '../i18n/locale'
import { IslandRuntime } from '../boot/runtime'
import DiagnosticsPanel, { type DiagnosticsResult } from './DiagnosticsPanel.vue'

async function check(): Promise<DiagnosticsResult> {
  try {
    return { ok: true, data: await fetchBootstrap() }
  } catch (error) {
    return { ok: false, code: error instanceof ApiError ? error.code : 'MU_UNKNOWN' }
  }
}

async function start(): Promise<void> {
  const container = document.querySelector<HTMLElement>('[data-mu-root="settings-diagnostics"]')
  if (container === null) {
    return
  }
  const pageBuild = container.dataset['muBuild'] ?? ''
  const pageLocale = normalizeLocale(container.closest('[lang]')?.getAttribute('lang'))
  const first = await check()
  const locale = first.ok ? first.data.locale.effective : (pageLocale !== null && isThemeLocale(pageLocale) ? pageLocale : FALLBACK_LOCALE)
  container.classList.add('mu-root')
  const runtime = new IslandRuntime()
  runtime.register({
    id: 'settings-diagnostics',
    place: () => ({ kind: 'existing', container }),
    create: () => createApp(DiagnosticsPanel, { initial: first, pageBuild, check }).use(createThemeI18n(locale)),
  })
  // A server-rendered page of the module: nothing re-renders the container, no watching needed.
  runtime.start({ watch: false })
}

void start()
