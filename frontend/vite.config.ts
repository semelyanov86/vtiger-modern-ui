/**
 * Production build of the ModernUI frontend (docs/architecture.md §5.2).
 *
 * The output goes straight into the module directory that the dev link mounts into the CRM
 * (src/layouts/v7/modules/ModernUI/resources/dist, ignored by git), so a rebuild is visible on the dev
 * instance after a page reload. `task build` is the one-off build, `task dev` the watch mode. There is no
 * dev server: the islands are loaded by the classic loader.js from HEADERSCRIPT.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueI18n from '@intlify/unplugin-vue-i18n/vite'
import { atomicManifest } from './build/atomic-manifest.ts'
import { thirdPartyLicenses } from './build/third-party-licenses.ts'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../src/layouts/v7/modules/ModernUI/resources/dist')
const tempManifest = '.manifest.tmp.json'

/**
 * Stylesheets of the adapters of public extensions (src/adapters/ext/<id>/style.scss, docs/architecture.md §7.6): one
 * entry each, so the server appends only the stylesheets of the extensions that are active (action=Tokens).
 */
const adapterStyles = Object.fromEntries(readdirSync(resolve(here, 'src/adapters/ext'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(here, 'src/adapters/ext', entry.name, 'style.scss')))
  .map((entry) => [`adapter-${entry.name}`, resolve(here, 'src/adapters/ext', entry.name, 'style.scss')]))

export default defineConfig({
  root: here,
  // Chunks and assets are resolved relative to import.meta.url / the stylesheet: works in the web root
  // and in a sub-directory (/vtigercrm/) without knowing the base URL of the CRM.
  base: './',
  publicDir: false,
  plugins: [
    vue(),
    vueI18n({
      include: resolve(here, 'src/i18n/locales/**'),
      // Messages are precompiled to AST: no message compiler and no new Function() at runtime.
      runtimeOnly: true,
      compositionOnly: true,
      fullInstall: false,
      dropMessageCompiler: true,
      strictMessage: true,
      escapeHtml: false,
    }),
    thirdPartyLicenses({
      nodeModules: resolve(here, 'node_modules'),
      // Fonts come in through CSS; the "vue" package only re-exports @vue/runtime-dom, so its own modules
      // disappear from the chunks, but it is the package the code depends on.
      extraPackages: ['@fontsource/poppins', '@fontsource/arimo', '@fontsource/open-sans', '@fontsource-variable/inter', 'vue'],
      allowed: ['MIT', 'ISC', 'Apache-2.0', 'OFL-1.1', 'BSD-2-Clause', 'BSD-3-Clause'],
      fileName: 'THIRD_PARTY_LICENSES.txt',
    }),
    atomicManifest({ outDir, tempName: tempManifest, finalName: 'manifest.json', keepMinutes: 10 }),
  ],
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    outDir,
    emptyOutDir: false,
    manifest: tempManifest,
    target: 'es2020',
    // The skin and the islands rely on :has(), so the supported browsers start where :has() does (docs/compatibility.md
    // §11). An older CSS target made Lightning CSS repeat every :is() rule as :-webkit-any() (40 % of the skin) whose
    // specificity differs from :is() — Chromium and WebKit applied both copies, Firefox only one (stage 19).
    cssTarget: ['chrome105', 'edge105', 'firefox121', 'safari15.4'],
    sourcemap: false,
    // The loader adds <script type="module"> itself; no polyfill is injected into the entries.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    rolldownOptions: {
      input: {
        shell: resolve(here, 'src/shell/main.ts'),
        settings: resolve(here, 'src/settings/main.ts'),
        preferences: resolve(here, 'src/preferences/main.ts'),
        skin: resolve(here, 'src/skin/skin.scss'),
        auth: resolve(here, 'src/auth/auth.scss'),
        ...adapterStyles,
      },
      output: {
        // Code used by several entries (Vue, vue-i18n, base styles) goes to one "common" chunk: every island
        // of a page imports the same module URL, so there is one Vue instance per page and window.Vue stays
        // untouched.
        // Code of the module's own pages (the editors and their dictionaries, drag and drop) goes to an "editor" chunk:
        // the shell, loaded on every CRM page, never downloads it.
        codeSplitting: {
          groups: [
            {
              name: 'editor',
              test: /[\\/]src[\\/](?:settings|preferences)[\\/]|[\\/]src[\\/]i18n[\\/](?:editor\.ts|locales[\\/]editor[\\/])|[\\/]node_modules[\\/](?:vue-draggable-plus|sortablejs)[\\/]/,
              minShareCount: 2,
              priority: 2,
              // Only the editors themselves: their dependencies (Vue, Reka, icons used by the shell too) stay in
              // "common", otherwise "common" — and with it the shell — would import the editor chunk.
              includeDependenciesRecursively: false,
            },
            { name: 'common', minShareCount: 2, priority: 1 },
          ],
        },
      },
    },
  },
})
