# ModernUI for Vtiger CRM 8.4

ModernUI is an installable extension module that gives Vtiger CRM Open Source 8.4 a modern
interface: a redesigned header, navigation, list views, record views and forms, a settings page
for the theme and the menu, and personal preferences. The interface texts of the module are
available in English, German and Russian.

The module installs as a regular Vtiger extension ZIP through *Settings → Module Manager →
Import*. It does not patch the Vtiger core, does not replace global libraries (jQuery, Bootstrap,
Select2) and keeps the standard v7 interface available as a fallback.

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
| `task test:e2e` | Playwright scenarios on the instance from `.env` (signs in with `CRM_ADMIN_USER`/`CRM_ADMIN_PASS[_FILE]`) |
| `task test:e2e:clean` | The same plus pilot, restricted users, languages, Module Manager switch, on both clean instances |
| `task test:devcycle` | Proof of the edit → result loop on the linked instance: temporary edits of PHP, Smarty, a dictionary, CSS and Vue, all undone |
| `task test:devrecord -- create` / `-- delete:<id>` | A synthetic record through the standard form with the theme on, then its deletion |
| `task baseline` | Metrics of the CRM screens without the theme (`MU_E2E_TARGET`: `dev`, `c81` or `c85`), into `.local/e2e-reports/` |
| `task shots` | Screenshots of the main screens at 1440/1024/768/412 px with and without the theme (`MU_SHOTS_DIR` is required for `dev`: the images may show customer data; clean stand: `.local/shots/`; `MU_SHOTS_ZOOM=2` for 200 %, `MU_SHOTS_LOCAL_BUILD=1` serves the local build to the browser of the scenario) |
| `task measure` | Cost of the theme against safe mode: FCP/DCL/load, shell ready, CLS, requests and bytes, size of every theme resource, Bootstrap time and 304 (`.local/e2e-reports/<target>/measure-<label>.json`) |
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

## License

No license has been chosen yet.
