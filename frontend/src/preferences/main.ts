/**
 * Entry "preferences": the editor of the personal preferences above the server form of
 * index.php?module=ModernUI&view=Preferences (the form stays for "&editor=off" and without JavaScript).
 */
import '../styles/base.scss'
import '../settings/editor.scss'
import { createApp } from 'vue'
import { fetchBootstrap } from '../api/client'
import { createThemeI18n } from '../i18n'
import { editorMessages } from '../i18n/editor'
import type { Bootstrap } from '../api/types'
import { IslandRuntime } from '../boot/runtime'
import { ensureOverlayRoot } from '../boot/overlay'
import PreferencesEditor from './PreferencesEditor.vue'

async function start(): Promise<void> {
  const container = document.querySelector<HTMLElement>('[data-mu-root="preferences-editor"]')
  if (container === null) {
    return
  }
  let bootstrap: Bootstrap
  try {
    bootstrap = await fetchBootstrap()
  } catch (error) {
    // The server form below stays in place and works.
    console.warn('[ModernUI] preferences editor:', error)
    container.hidden = true
    return
  }
  const i18n = createThemeI18n(bootstrap.locale.effective, editorMessages)
  ensureOverlayRoot()
  container.classList.add('mu-root')
  const runtime = new IslandRuntime()
  runtime.register({
    id: 'preferences-editor',
    place: () => ({ kind: 'existing', container }),
    create: () => {
      for (const fallback of document.querySelectorAll<HTMLElement>('[data-mu-fallback="preferences"]')) {
        fallback.hidden = true
      }
      return createApp(PreferencesEditor, { bootstrap }).use(i18n)
    },
  })
  runtime.start({ watch: false })
}

void start()
