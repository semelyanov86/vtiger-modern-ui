# ModernUI for Vtiger CRM 8.4

ModernUI is an installable extension module that gives Vtiger CRM Open Source 8.4 a modern
interface: a redesigned header, navigation, list views, record views and forms, a settings page
for the theme and the menu, and personal preferences. The interface texts of the module are
available in English, German and Russian.

The module installs as a regular Vtiger extension ZIP through *Settings → Module Manager →
Import*. Installation leaves the Vtiger core untouched and does not replace global libraries
(jQuery, Bootstrap, Select2). An optional administrator button installs the login and password
recovery design by wrapping two native templates, with backups and a restore button. The standard
v7 interface remains available as a fallback. See [authentication pages](docs/auth-pages.md).

> **Status:** early development, no release yet. The installable foundation is in place: the extension
> module with its lifecycle, versioned settings storage and migrations, the classic loader and the Vue 3
> shell, the settings page (*Settings → Other settings → ModernUI*: switch the new interface on for
> yourself, standard view, safe mode, repair), personal preferences and the RU/EN/DE dictionaries. The
> redesign of the CRM screens comes with the next stages (see `docs/PLAN.md`).

## Goals

- Installs on a clean Vtiger Open Source 8.4 with the standard `v7` layout; no manual core edits.
- The ZIP ships a production build. Servers need neither Node.js nor any build tooling.
- Existing actions, permissions, validations, workflows and third-party extensions keep working.
  Vue components mount only into containers owned by ModernUI; DOM managed by jQuery is left intact.
- *Settings → ModernUI*: colours, density, font size, logo, menu editor (order, groups, labels,
  icons, hidden items, favourites), pilot users and roles, preview, reset, JSON import/export.
- *Appearance*: organization/theme logo and a configurable public notice; *Maintenance → Apply login
  pages*: cloud-style login, recovery and password change. Authentication remains native Vtiger.
  Run `task test:auth-pages` with `MU_E2E_TARGET=dev|c81|c85`; optional `MU_AUTH_MAIL_URL` enables
  the full reset flow against the isolated clean stand's mail trap. Screenshots use `MU_AUTH_SHOTS_DIR`
  (a private directory on the dev instance).
- The menu is always limited by the current user's Vtiger permissions; hiding an item never grants
  or removes access.
- The theme is off after installation; administrators enable it for themselves first. A standard
  view and a recovery path work even if the frontend fails to load.
- Settings survive disable and update; uninstall follows a documented policy.

## Requirements

| | Version |
|---|---|
| Vtiger CRM Open Source | 8.4 (standard `v7` layout) |
| PHP | 8.1 – 8.5 |
| Database | MySQL 8.x (others are not verified yet) |

For development additionally:

- Linux with `sudo` (the development link uses bind mounts and `nsenter`);
- a local Vtiger 8.4 instance served by Apache + PHP-FPM;
- [go-task](https://taskfile.dev/) 3.x, Node.js 24 with npm, Python 3.10+, Docker with Compose v2 (PHP 8.1
  lint, the throwaway MySQL of the tests, the clean Vtiger 8.4.0 stand);
- PHP CLI 8.5 and 8.4 with mysqli (PHP 8.1 runs in Docker);
- Chromium for Playwright 1.63 (`npx playwright install chromium` in `frontend/`) for `task test:e2e`.

## Repository layout

```
src/            module files laid out exactly as they end up in a Vtiger installation:
                modules/ModernUI, modules/Settings/ModernUI, layouts/v7/modules/{,Settings/}ModernUI,
                languages/<lang>/ModernUI.php, languages/<lang>/Settings/ModernUI.php;
                layouts/v7/modules/ModernUI/resources/dist/ is the frontend build (not committed)
frontend/       Vue 3 + Vite + TypeScript sources, dictionaries, build plugins (build/),
                unit tests (tests/, Vitest) and browser tests (e2e/, Playwright)
packaging/      manifest template, allowlist and build-zip.py: the installable ZIP from src/
tests/          PHP tests (php/, php/db/ on a throwaway MySQL), package tests (package/), shared fixtures
dev/            development environment (link to a local CRM, vtlib lifecycle helper, checks);
                dev/clean/ — Docker project of the clean Vtiger 8.4.0 stand (task clean:*)
docs/           design documents, plan and requirements (currently in Russian)
dist/           ZIP, SHA-256 and file list, not committed
VERSION         version of the module written into manifest.xml
```

## Development setup

1. Clone the repository and create local settings:

   ```bash
   cp .env.example .env
   ```

   Point `CRM_ROOT` at the document root of a local Vtiger 8.4 instance (the *dev instance*) and
   `CRM_URL` at its URL; both are required. `CRM_PHP` is a PHP CLI able to load that instance's
   `config.inc.php`. Browser tests log in with `CRM_ADMIN_USER` and `CRM_ADMIN_PASS`, or read the
   password from the dotenv file named in `CRM_ADMIN_PASS_FILE`.

2. Connect the sources to the instance:

   ```bash
   task crm:link
   task crm:status
   ```

3. Build the frontend, register the module in the instance database and switch the theme on for yourself:

   ```bash
   task build
   task crm:install      # once; later task crm:update after changes of links, tables or the schema
   ```

   Open *Settings → Other settings → ModernUI* and press *Enable for me*.

4. Edit files in `src/` and reload the page in the browser; keep `task dev` running for frontend changes.

### Commands

| Command | Purpose |
|---|---|
| `task crm:link` | Connect `src/` to the CRM instance. `task crm:link -- --force` moves a ZIP-installed copy of the module out of the way (to `.local/crm-replaced/`) |
| `task crm:unlink` | Disconnect `src/`; the database of the instance, including the module registration, stays as it is |
| `task crm:status` | Instance version and git commit, state of every linked path, registration of the module in the instance database |
| `task crm:smoke` | Run the instance's own smoke test (only for instances that provide `task smoke`) |
| `task fe:install` | Install the frontend dependencies from the lockfile (`npm ci --ignore-scripts`) |
| `task build` | Production build of the frontend into `src/layouts/v7/modules/ModernUI/resources/dist/` |
| `task dev` | Watch mode: rebuilds on every change of `frontend/`, switches the manifest last; reload the page |
| `task package` | Lint, build, then `dist/ModernUI-<version>.zip` with `.sha256` and `.files.txt` (version from `VERSION` or `MU_VERSION`) |
| `task crm:install` | Register the module in the instance database with the Module Manager code (`Vtiger_Package::import()` of the ZIP), then link `src/` again |
| `task crm:update` | Same through `Vtiger_Package::update()`; runs the settings migrations |
| `task crm:uninstall` | `Vtiger_Module::delete()`; settings tables are kept, `task crm:uninstall -- --purge` drops them |
| `task crm:enable` / `task crm:disable` | Enable or disable the module like the Module Manager does |
| `task lint` | `php -l` under PHP 8.5, 8.4 and 8.1 (Docker), `vue-tsc`, ESLint with zero warnings, ES5 syntax of the loader |
| `task test` | Build, PHP tests (8.5/8.4/8.1), migrations on a throwaway MySQL 8.4 container, Vitest, package tests |
| `task test:e2e` | Playwright scenarios on the instance from `.env` (signs in with `CRM_ADMIN_USER`/`CRM_ADMIN_PASS[_FILE]`): the module (`modernui`), the settings and preferences editors (`settings`) and the navigation shell and list screens (`navigation`: mega menu against the v7 app menu, history and new tabs, favorites bar without layout shift, the stage 11 cloud header — one main row and the page toolbar, the global search with the same request as v7, quick create, the user menu, icons and buttons extensions add later, no module rail on lists, records and forms, the calendar views in the context navigation, the settings menu kept — filter/sort/selection/mass action/search/popup of lists with the same requests and handlers as v7, RU/EN/DE, narrow screens) and the record views and forms (`records`: header actions, tabs, blocks, values and inline edit, create/edit/quick create forms, picklist-driven dynamic fields, line items with discounts, tax mode and moved rows, saving with the same request body and saved values as v7, one request per save, validation, refused and expired inline saves, cancel, RU/EN/DE, narrow screens, PDF of PDFMaker where active — each compared with the same page in safe mode; synthetic records `MU07-…` are created and deleted; `MU_E2E_FORM_MODULES=A,B` adds modules whose forms extensions change, `MU_E2E_LOCAL_BUILD=1` serves the local build to the browser) the stage 09 layout prototype (`layout`, see `task test:layout`) and the special screens and adapters (`special`: only the adapters of active extensions reach the page and an adapter switched off disappears, the adapters table of the settings editor, sign-in/installer/web forms/mobile/portal/web service entry points without the theme, printing without the shell, the same export request and file, CKEditor without theme styles, dashboard handles, draggable calendar events — on the clean stand a synthetic event `MU08-…` is dragged and compared, the core PDF) and the stage 10 visual foundation (`foundation`, see `task test:foundation`); every change of the settings is undone at the end |
| `task test:e2e:clean` | The same plus pilot, restricted users, languages, Module Manager switch, and the settings of users with different permissions (menu by permissions, role profiles, personal keys, role change via `dev/clean/tools/set-role.php`, refused administrator actions, the navigation of a restricted user, hidden and read-only fields of a restricted user in forms, file upload and comments), and an unknown entity module installed after ModernUI (`tests/fixtures/gizmos`: menu by permissions also after a profile change, switched off and on, removed with `dev/clean/tools/remove-module.php`), on both clean instances; the list scenarios also star and unstar synthetic records there |
| `task test:lifecycle` | Stage 20 on both clean instances: real 0.6.0 ZIP → candidate, all settings scopes, disable/enable, interrupted update, migration lock failure, recovery, missing asset, uninstall/reinstall; fields, forms, permissions and screenshots for default, upgraded and new-user profiles; restores settings; see [regression-lifecycle.md](docs/regression-lifecycle.md) |
| `task test:lists` | Stage 12 cloud lists: native filters, column search, sorting, pagination, selection, columns and tags compared with v7; cloud geometry, RU/EN/DE, keyboard, narrow screens and restricted user; `MU_E2E_TARGET=dev|c81|c85`, private screenshots via `MU_LIST_SHOTS_DIR`; included in the e2e suites |
| `task test:cloud-records` | Stage 13 cloud records: native field/action contracts, inline saves and comments, related quick create/select/unlink, pagination and row actions, languages, widths, rights and failure fallback; synthetic MU13 records are deleted and settings restored; `MU_E2E_TARGET=dev|c81|c85`, optional `MU_RECORD_MODULES=A,B` and `MU_RECORD_ORDER_BY='A=number_field&B=number_field'` for a stable native order; included in the e2e suites |
| `task test:cloud-settings` | Stage 15 system settings: the catalog is the native settings menu (same items, URLs, summary), native search with an own empty state, keyboard, Back to CRM, side navigation and breadcrumb, seven inner pages with the same actions, drag and drop and switches as v7, dialogs, RU/EN/DE, widths, recovery; on the clean stand a restricted user and real changes (MU15 role, user, field, picklist value, workflow, deleted again); `MU_E2E_TARGET=dev|c81|c85` |
| `task test:settings-page` | Stage 16 page of ModernUI and personal preferences: one title and the sections in the order of the work, the scope shown before any change, inherited and own values, preview/cancel/reset, switching the scope with a draft, a conflict carried over to the current version, the draft of the tab kept over a reload, the menu editor (search, catalog, drag onto a group, keys, empty and unknown modules) checked in the real mega menu, preferences of the administrator and of a restricted user (clean stand), RU/EN/DE, 1440/1024/768/412 and 200 %, keyboard, no JavaScript; `MU_E2E_TARGET=dev\|c81\|c85` |
| `task test:special-screens` | Stage 17 remaining screens against v7: calendar (each calendar keeps its colour, toolbar, views, the panel switch with the same request), home dashboard (tabs, More, Add widget), reports (folders, Add menu, the result with the same export request, the wizard to step 2 without saving), import up to the duplicate step (cancelled), recycle bin, find duplicates, email templates, mail manager; 1024/768/412 px and 200 % without covered controls, RU/EN/DE, no JavaScript; `MU_E2E_TARGET=dev\|c81\|c85` |
| `task test:quality` | Stage 19 quality: POST + CSRF token + CRM Referer for every changing action of the module, errors without paths/SQL/stack traces, view parameter checks, logo uploads (clean stand), settings import, isolation of two users (clean stand), a strict Content-Security-Policy without `unsafe-eval`, failures and recovery, axe-core against the same CRM without the theme, keyboard, reduced motion, German texts; `MU_E2E_TARGET=dev\|c81\|c85` |
| `task test:stability` | Stage 19: 40 cycles of list → record window → edit → cancel → related tab → close → Back/Forward → mega menu in one document with CDP metrics (heap, nodes, listeners, jQuery handlers, requests); AJAX list reloads against v7; `MU_STABILITY_CYCLES` |
| `task test:browsers` | Stage 19: the core scenarios in Chromium, Firefox and WebKit of the pinned Playwright (run `npx playwright install firefox webkit` once); clean stand |
| `task test:cloud-forms` | Stage 14 native create/edit/Quick Create: validation, pending save, retry, cancel, duplicate, native redirects, custom CRUD, rights and responsive layout; synthetic MU14 records, settings restored; `MU_E2E_TARGET=dev|c81|c85`, `MU_E2E_FORM_MODULES=A,B` on dev |
| `task test:foundation` | Stage 10 visual foundation against the measured cloud reference (`docs/design.md` §13.4, values in `frontend/e2e/foundation-reference.ts`): tokens of the server equal the preview of the settings editor (defaults and changed settings), resetting the font returns to the cloud default, Poppins 400/600 and the pinned Cyrillic face (system Arial or the bundled Arimo) for RU/EN/DE text, fonts only from the CRM; normal/hover/active/focus/disabled/error/loading/empty states of buttons, fields, Select2, check boxes, rows, menus, tabs, dialogs and notifications of v7 and of the settings editor; densities and 200 %; read-only for the CRM; report `.local/e2e-reports/<stand>/foundation.json`; part of `task test:e2e` and `task test:e2e:clean` |
| `task test:layout` | Stage 09 prototype of the cloud layout on Accounts (`docs/architecture.md` A15): no permanent module rail (every module since stage 11), the record and its edit form over the list (core overlay views), history, Escape/focus, double open, AJAX reload, direct link, validation/cancel/one save with the same form fields, failures; switches `layout.modules` on for the run and back, creates and deletes synthetic organizations `MU09-…` (`MU_LAYOUT_CLEANUP=<id,…>` deletes leftovers of an interrupted run); part of `task test:e2e` and `task test:e2e:clean` |
| `task visual:pairs` | Screenshots (1440×1000) and element measurements of ModernUI for the states of `dev/visual/states.json` (override with `MU_VISUAL_STATES=dev/visual/lists.json` for stage 12) into `MU_VISUAL_DIR` (a private directory on `dev`; read-only) |
| `task visual:compare` | Side-by-side pairs and the geometry table against the pinned cloud reference (`MU_VISUAL_REFERENCE`, private) — tolerances in `docs/visual-parity.md` §5.1; `python3 dev/visual/compare.py --noise a.png b.png` measures the noise of repeated reference screenshots; the cloud is never used in CI |
| `task visual:capture` | Capture deterministic regions on a seeded clean PACKAGE instance (`MU_E2E_TARGET=c81` / `c85`, default c81; optional `MU_REGRESSION_DIR`). Does not change accepted images |
| `task visual:regression` | Capture and compare with reviewed synthetic images in `tests/visual/accepted`; missing evidence or unexplained differences fail |
| `task test:visual-tools` | Negative controls for the cloud comparison and accepted-image gates |
| `task test:screens` | Every screen of the instance — special screens of the core, every Settings item, list and first record of every module, dialogs and popups — opened with and without the theme: lost or covered actions, new errors, page scrolling, level of the theme (`full`/`skin`/`standard`); read-only; report in `.local/e2e-reports/<target>/screens-<label>.json`; `MU_E2E_TARGET`, `MU_SCREENS=prefixes`, `MU_SCREENS_EXTRA=<json file of more screens>`, `MU_SCREENS_SHOTS_DIR` (required to be a private directory on `dev`) |
| `task test:devcycle` | Proof of the edit → result loop on the linked instance: temporary edits of PHP, Smarty, a dictionary, CSS and Vue, all undone |
| `task test:devrecord -- create` / `-- delete:<id>` | A synthetic record through the standard form with the theme on, then its deletion |
| `task baseline` | Metrics of the CRM screens without the theme (`MU_E2E_TARGET`: `dev`, `c81` or `c85`), into `.local/e2e-reports/` |
| `task shots` | Screenshots of the main screens at 1440/1024/768/412 px with and without the theme (`MU_SHOTS_DIR` is required for `dev`: the images may show customer data; clean stand: `.local/shots/`; `MU_SHOTS_ZOOM=2` for 200 %, `MU_SHOTS_LOCAL_BUILD=1` serves the local build to the browser of the scenario) |
| `task measure` | Cost of the theme against safe mode: FCP/DCL/load, shell ready, CLS, requests and bytes, size of every theme resource, Bootstrap time and 304 (`.local/e2e-reports/<target>/measure-<label>.json`); transition delays with and without the theme (`transitions-<label>.json`) and the budgets of stage 19 (`docs/DEVELOPMENT.md`) |
| `task privacy` | Check that files to be published contain no installation-specific information (see below) |

`task test:package` unpacks the ZIP with the vtlib importer of the official `8.4.0` tag: set
`VTIGER_SRC_REPO` in `.env` to a git clone of the official Vtiger repository. The tests never write
to the instance database except through the ModernUI settings pages and the lifecycle commands.

### How the development link works

`task crm:link` (`dev/crm-link.sh`) maps every path listed in `dev/crm-mounts.txt` from `src/` to the
same relative path inside `CRM_ROOT`:

- **Directories are bind-mounted read-only.** Symbolic links do not work: Vtiger's
  `checkFileAccessForInclusion()` compares the `realpath()` of included files with the CRM root and
  rejects files outside it. A bind mount keeps the path inside the root.
- **PHP-FPM gets the mount read-only as well.** systemd runs PHP-FPM in its own mount namespace
  (`ProtectSystem`), where a new bind mount shows up writable; the script remounts it read-only in the
  namespace of every running `php*-fpm` service, so the CRM can never write into this repository.
- **Single PHP files (language files) get a stub** that `require`s the real file. A bind mount of a
  single file would keep pointing to the old inode once an editor saves through a rename.
- **The linked paths are excluded from the CRM's git** through a managed block in its
  `.git/info/exclude` (local, never committed). The CRM's tracked files are not modified.
- Compiled Smarty templates of the instance (`test/templates_c/v7`) are cleared whenever links change.
- The state is kept in `.local/crm-link.state`; running `link`/`unlink` again is safe.

Bind mounts do not survive a reboot: run `task crm:link` again after restarting the machine.

### When changes become visible

| Change | Visible |
|---|---|
| PHP of the module or its settings | after a page reload (OPcache re-validates timestamps, typically within 2 s) |
| Smarty templates | after a page reload |
| PHP language files | after a page reload |
| Vue, CSS, frontend dictionaries | after the watch build has rebuilt the assets, then reload |
| `manifest.xml`, links, tables, settings schema | through the module lifecycle (`task crm:update`), not through the link |
| A new path in `dev/crm-mounts.txt` (e.g. a new language) | after `task crm:link` |

Smarty and OPcache compare file times in whole seconds: a second save of the same file within the
second in which a page compiled the first one is not noticed. If an edit does not show up, save the file
again.

### Testing the installable package

The development link is not a proof that the module installs. The ZIP is always verified in a
separate *package* run:

1. on a fresh official Vtiger 8.4.0 instance with a new database and no linked sources — the clean
   stand of `dev/clean/` (below);
2. on the development instance after `task crm:unlink`, importing the ZIP through
   *Settings → Module Manager → Import*, then going back with `task crm:link -- --force`.

Never import the ZIP while the sources are linked: the read-only mounts would make the import fail
halfway.

### Clean Vtiger 8.4.0 stand

`dev/clean/` is a Docker Compose project with images pinned by digest: MySQL 8.4 (`sql_mode` the
installer requires), two Apache + PHP instances built from the official release archive of Vtiger 8.4.0
(SHA-256 checked) — `c81` on PHP 8.1 in the site root and `c85` on PHP 8.5 under `/vtigercrm/` — a mailpit
mail trap and an nginx gateway. The web servers have no route to the internet; only the gateway listens,
on `127.0.0.1` (ports `MU_CLEAN_PORT`, `MU_CLEAN85_PORT`, `MU_CLEAN_MAIL_PORT`, defaults 8481, 8485, 8425).
Passwords are generated into `.local/clean/` on the first run.

| Command | What it does |
|---|---|
| `task clean:up` | Build the images, start, unpack the release archive into new volumes |
| `task clean:install` | Run the standard web installer of each instance (new empty database, `en_us`) |
| `task clean:seed` | Synthetic roles, profiles, users and records; imports the test entity module `Gadgets` through the Module Manager |
| `task clean:import-zip` | Import `dist/ModernUI-<version>.zip` through *Settings → Module Manager → Import* (Playwright) |
| `task clean:uninstall` | vtlib console `--remove=ModernUI`, then the module files (settings tables stay) |
| `task clean:verify` | **Deletes the stand's data**, then the whole package check of a ZIP: install, import, scenarios, update, uninstall, reinstall, file hashes, PHP log |
| `task clean:status` / `clean:logs` | State and registration of each instance / PHP messages grouped, those of ModernUI files listed |
| `task clean:hash -- <label>` / `clean:meta -- <label>` | SHA-256 of the CRM code files / metadata of the database, for before-after comparisons |
| `task clean:down` / `clean:reset` | Stop (data kept) / stop and delete the volumes |

Details: `docs/environments.md`.

## Contribution guidelines

- No core patches, no copies of core or third-party files in the package, no global CSS resets,
  no second global jQuery/Bootstrap/Vue. Styles apply only under the active-theme marker or inside
  ModernUI components.
- Keep IDs, `name` and `data-*` attributes and the events other extensions rely on.
- Every user-facing text of the module exists in English, German and Russian from the start;
  English is the fallback. Business labels come from the CRM's own translations.
- The module never depends on a particular installation: no fixed tab/role/user IDs, custom field
  names, domains or absolute paths.
- Own settings use a versioned schema with idempotent migrations run by the vtlib lifecycle; no
  manual SQL.
- PHP code must run on PHP 8.1 through 8.5 without warnings or deprecations. PHP and Smarty use tabs
  (Vtiger core style); comments and identifiers are in English.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
- Never commit `.env`, credentials, database dumps, screenshots with customer data, `node_modules/`,
  `dist/` or code of commercial extensions.
- Keep tracked files free of installation-specific information: host names, local paths, user names,
  database names, customer or company names, custom modules and fields of a particular CRM.
  Maintainers keep such details in an untracked `PRIVATE.md`; `task privacy` checks every file that
  would be published against the patterns listed there (a fenced `private-patterns` block, one
  case-insensitive extended regular expression per line).

## Documentation

The design documents in `docs/` are currently written in Russian:

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — development and package environments in detail;
- [docs/COMMON.md](docs/COMMON.md) — requirements for architecture, settings, i18n, design, compatibility;
- [docs/I18N.md](docs/I18N.md) — language rules (en-US, de-DE, ru-RU, fallback, menu labels);
- [docs/RESEARCH.md](docs/RESEARCH.md) — verified extension points of Vtiger 8.4;
- [docs/architecture.md](docs/architecture.md) — extension points, call order, asset loading, DOM boundaries,
  lifecycle, package layout;
- [docs/settings.md](docs/settings.md) — settings scopes and precedence, JSON schema, migrations, menu rules,
  import/export, uninstall policy;
- [docs/design.md](docs/design.md) — visual language, tokens, screen acceptance criteria;
- [docs/dependencies.md](docs/dependencies.md) — frontend dependencies, versions, licences;
- [docs/compatibility.md](docs/compatibility.md) — platform matrix, core v7 events, third-party extensions;
- [docs/environments.md](docs/environments.md) — clean Vtiger 8.4 instance and package runs;
- [docs/verification.md](docs/verification.md) — acceptance matrix and results;
- [docs/PLAN.md](docs/PLAN.md) — requirements, decisions, stage status and log.

[AGENTS.md](AGENTS.md) contains the rules for AI coding agents working on this repository.

## Accepted appearance

[Visual acceptance](docs/visual-acceptance.md) records the cloud comparison and its specific limits.
The cloud reference and dev screenshots stay private. GitHub CI is disabled at the maintainer's
request. Push and pull request triggers have been removed, and the workflow is disabled on GitHub.
Do not enable or run it without a new explicit request. Visual regression checks run locally.

Capture candidates with `MU_E2E_TARGET=c81 task visual:capture`; compare both clean instances with
`MU_E2E_TARGET=c81 task visual:regression` and `MU_E2E_TARGET=c85 task visual:regression`.
The comparison never overwrites its baseline. Changes require reviewing the cloud evidence,
geometry, image pairs and the calibration described in the acceptance report.
The screenshot environment also requires Arial and Noto Sans (`ttf-mscorefonts-installer` and
`fonts-noto-core` on Ubuntu 24.04), plus `fonts-dejavu-core`. Capture checks font families and SHA-256
against the accepted manifest. These system fonts are not part of the module package.
The capture browser also uses `dev/visual/fontconfig.conf` to select the accepted Noto Sans Math
fallback for symbols. Its system font inventory is limited to the seven accepted faces, and CDP
checks the fonts actually used for record and calendar arrows. The machine's global configuration is unchanged.

Visual runs save global and personal settings, including favorites, and verify their restoration.
If a process was interrupted, the private recovery file remains. Rerun on the same target with
`MU_VISUAL_RECOVER=1` to restore it before starting another capture; do not delete that file to
silence the check. Other scenarios that change settings must not run concurrently on that instance.

Stage 20 adds opt-in integration profiles: `MU_CONDITIONAL_MODULE`, `MU_CONDITIONAL_FIELD` and
`MU_CONDITIONAL_TITLE_FIELD` for native conditional-field rules in record windows, and
`MU_SIGNATURE_FIELDS` for synthetic signature persistence in SalesOrder forms. Use these only
with the corresponding installed extensions and disabled outgoing integrations; fixture records
are deleted afterwards. See [Development](docs/DEVELOPMENT.md) and the
[regression report](docs/regression-lifecycle.md) for the validation boundaries.

## License

No license has been chosen yet.
