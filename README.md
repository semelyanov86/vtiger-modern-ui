# ModernUI for Vtiger CRM 8.4

ModernUI is an installable extension module that gives Vtiger CRM Open Source 8.4 a modern
interface: a redesigned header, navigation, list views, record views and forms, a settings page
for the theme and the menu, and personal preferences. The interface texts of the module are
available in English, German and Russian.

The module installs as a regular Vtiger extension ZIP through *Settings → Module Manager →
Import*. It does not patch the Vtiger core, does not replace global libraries (jQuery, Bootstrap,
Select2) and keeps the standard v7 interface available as a fallback.

> **Status:** early development. The repository currently contains the design documents and the
> development environment; the module itself is not implemented yet and there is no release.

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
- [go-task](https://taskfile.dev/) 3.x, Node.js 24 with npm, Docker (for the clean test instance);
- PHP CLI 8.5 (and 8.4 / 8.1 for compatibility checks).

## Repository layout

```
src/            module files laid out exactly as they end up in a Vtiger installation:
                modules/ModernUI, modules/Settings/ModernUI, layouts/v7/modules/{,Settings/}ModernUI,
                languages/<lang>/ModernUI.php, languages/<lang>/Settings/ModernUI.php
frontend/       Vue 3 + Vite sources and frontend dictionaries
packaging/      builds the installable ZIP from src/ and the frontend build
tests/          automated checks (package, migrations, browser scenarios)
dev/            development environment (link to a local CRM, helper scripts)
docs/           design documents, plan and requirements (currently in Russian)
dist/           build output, not committed
```

`src/`, `frontend/`, `packaging/` and `tests/` appear as the implementation progresses.

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

3. Edit files in `src/` and reload the page in the browser.

### Commands

| Command | Purpose |
|---|---|
| `task crm:link` | Connect `src/` to the CRM instance. `task crm:link -- --force` moves a ZIP-installed copy of the module out of the way (to `.local/crm-replaced/`) |
| `task crm:unlink` | Disconnect `src/`; the database of the instance, including the module registration, stays as it is |
| `task crm:status` | Instance version and git commit, state of every linked path, registration of the module in the instance database |
| `task crm:smoke` | Run the instance's own smoke test (only for instances that provide `task smoke`) |
| `task lint` | `php -l` of all PHP files under PHP 8.5 and 8.4 |
| `task privacy` | Check that files to be published contain no installation-specific information (see below) |

Planned with the first implementation stage: `build` (production frontend build), `dev` (watch
mode), `package` (installable ZIP in `dist/` with SHA-256), `crm:install` / `crm:update` (register
or update the module in the instance database through the standard vtlib package import), a PHP 8.1
lint target and the test suites.

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

### Testing the installable package

The development link is not a proof that the module installs. The ZIP is always verified in a
separate *package* run:

1. on a fresh official Vtiger 8.4 instance with a new database and no linked sources;
2. on the development instance after `task crm:unlink`, importing the ZIP through
   *Settings → Module Manager → Import*, then going back with `task crm:link -- --force`.

Never import the ZIP while the sources are linked: the read-only mounts would make the import fail
halfway.

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
- [docs/PLAN.md](docs/PLAN.md) — requirements, decisions, stage status and log.

[AGENTS.md](AGENTS.md) contains the rules for AI coding agents working on this repository.

## License

No license has been chosen yet.
