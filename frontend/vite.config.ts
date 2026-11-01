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
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueI18n from '@intlify/unplugin-vue-i18n/vite'
import { atomicManifest } from './build/atomic-manifest.ts'
import { thirdPartyLicenses } from './build/third-party-licenses.ts'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../src/layouts/v7/modules/ModernUI/resources/dist')
const tempManifest = '.manifest.tmp.json'

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
      extraPackages: ['@fontsource-variable/inter', 'vue'],
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
    cssTarget: 'es2020',
    sourcemap: false,
    // The loader adds <script type="module"> itself; no polyfill is injected into the entries.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    rolldownOptions: {
      input: {
        shell: resolve(here, 'src/shell/main.ts'),
        settings: resolve(here, 'src/settings/main.ts'),
        skin: resolve(here, 'src/skin/skin.scss'),
      },
      output: {
        // Code used by several entries (Vue, vue-i18n, base styles) goes to one "common" chunk: every island
        // of a page imports the same module URL, so there is one Vue instance per page and window.Vue stays
        // untouched.
        codeSplitting: {
          groups: [{ name: 'common', minShareCount: 2 }],
        },
      },
    },
  },
})
