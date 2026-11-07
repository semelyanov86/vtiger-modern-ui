<?php
/*
 * Registry of the adapters of public extensions (docs/compatibility.md §6, docs/architecture.md §7.6).
 *
 * An adapter is the part of ModernUI that knows one public extension: a stylesheet for the extension's own markup,
 * an optional client part (frontend/src/adapters/ext/<id>/) and rules for its screens. It never changes the files of the
 * extension. An adapter applies only when all of these hold, checked on every request (cached for the request):
 *
 * - the extension's module is installed and active (vtlib_isModuleActive semantics: presence 0 or 2);
 * - its version (vtiger_tab.version) is inside the range the adapter was checked with;
 * - the files and tables the adapter relies on exist;
 * - the administrator has not switched the adapter off (settings key adapters.disabled);
 * - on the page, the client part finds the markup it expects (supports() of the client part).
 *
 * Anything missing means "no adapter": the extension's screens get the common skin, or the standard view where a rule
 * says so — never an error. A failure while checking switches every adapter off for the request.
 *
 * Specific adaptations of one CRM (its own modules, fields, roles) do not belong here: they live in a separate optional
 * package of that CRM (docs/compatibility.md §6).
 */

require_once 'modules/ModernUI/models/Db.php';
require_once 'modules/ModernUI/models/Assets.php';

class ModernUI_Adapters_Model {

	const ID_PATTERN = '/^[a-z0-9][a-z0-9-]{0,39}$/';

	const ACTIVE = 'active';
	/** Switched off by the administrator (adapters.disabled). */
	const DISABLED = 'disabled';
	/** The extension is not installed. */
	const NOT_INSTALLED = 'notInstalled';
	/** The extension is installed but disabled in the Module Manager. */
	const INACTIVE = 'inactive';
	/** The version of the extension is outside the range the adapter was checked with. */
	const VERSION = 'version';
	/** Files or tables of the extension the adapter relies on are missing. */
	const INCOMPLETE = 'incomplete';
	const ERROR = 'error';

	/** Levels a screen rule of an adapter may give a screen (docs/compatibility.md §8). */
	const LEVEL_SKIN = 'skin';
	const LEVEL_STANDARD = 'standard';

	/** @var array|null per-request cache: status of every adapter for the last disabled list */
	private static $cache = null;
	private static $cacheKey = null;

	/** @var array|null replaces the registry in tests */
	private static $registryOverride = null;

	/**
	 * Adapters known to this version of ModernUI.
	 *
	 * id => {
	 *   module: name of the extension's module (vtiger_tab.name),
	 *   title: product name for the administrator (a product name, not translated),
	 *   vendor: vendor of the extension,
	 *   versions: {min, below} — checked range of vtiger_tab.version (version_compare; null: no bound),
	 *   files: files of the extension the adapter relies on (relative to the CRM root) — its classes are checked by their
	 *          files, never loaded for the check,
	 *   tables: tables of the extension the adapter relies on,
	 *   fields: [{module, field}] fields (vtiger_field) the adapter relies on (optional),
	 *   style: the adapter has a stylesheet (frontend/src/adapters/ext/<id>/style.scss),
	 *   script: the adapter has a client part (frontend/src/adapters/ext/<id>/index.ts),
	 *   screens: [{module, view, parent, level}] — screens of the extension that get only the skin or the standard view,
	 * }
	 * @return array
	 */
	public static function registry() {
		if (self::$registryOverride !== null) {
			return self::$registryOverride;
		}
		return array(
			'pdfmaker' => array(
				'module' => 'PDFMaker',
				'title' => 'PDF Maker',
				'vendor' => 'IT-Solutions4You',
				'versions' => array('min' => '4.0', 'below' => '5'),
				'files' => array('modules/PDFMaker/PDFMaker.php', 'layouts/v7/modules/PDFMaker/Edit.tpl'),
				'tables' => array('vtiger_pdfmaker'),
				'style' => true,
				'script' => true,
				'screens' => array(),
			),
		);
	}

	/**
	 * Replaces the registry (unit tests); null restores it.
	 * @param array|null $registry
	 */
	public static function setRegistry($registry) {
		self::$registryOverride = $registry;
		self::reset();
	}

	/**
	 * Forgets the cached statuses (after a module was switched in the same request, tests).
	 */
	public static function reset() {
		self::$cache = null;
		self::$cacheKey = null;
	}

	/**
	 * Status of every adapter for the effective settings.
	 * @param array $values effective settings (adapters.disabled)
	 * @return array id => {status, version}
	 */
	public static function statuses(array $values) {
		$disabled = isset($values['adapters.disabled']) && is_array($values['adapters.disabled']) ? $values['adapters.disabled'] : array();
		$key = json_encode($disabled);
		if (self::$cache !== null && self::$cacheKey === $key) {
			return self::$cache;
		}
		$registry = self::registry();
		$statuses = array();
		try {
			$modules = self::modules($registry);
			foreach ($registry as $id => $adapter) {
				$statuses[$id] = self::evaluate($adapter, isset($modules[$adapter['module']]) ? $modules[$adapter['module']] : null, in_array($id, $disabled, true));
			}
		} catch (Throwable $e) {
			if (class_exists('Vtiger_Utils')) {
				Vtiger_Utils::Log('ModernUI: adapters: ' . $e->getMessage());
			}
			$statuses = array();
			foreach ($registry as $id => $adapter) {
				$statuses[$id] = array('status' => self::ERROR, 'version' => '');
			}
		}
		self::$cache = $statuses;
		self::$cacheKey = $key;
		return $statuses;
	}

	/**
	 * Presence and version of the modules of the registry, one query.
	 * @param array $registry
	 * @return array name => {presence, version}
	 */
	private static function modules(array $registry) {
		$names = array();
		foreach ($registry as $adapter) {
			$names[$adapter['module']] = true;
		}
		if (!$names) {
			return array();
		}
		$names = array_keys($names);
		$rows = ModernUI_Db_Model::mustRows('SELECT name, presence, version FROM vtiger_tab WHERE name IN ('
			. implode(',', array_fill(0, count($names), '?')) . ')', $names);
		$modules = array();
		foreach ($rows as $row) {
			$modules[(string) $row['name']] = array('presence' => (int) $row['presence'], 'version' => (string) $row['version']);
		}
		return $modules;
	}

	/**
	 * Status of one adapter.
	 * @param array $adapter definition
	 * @param array|null $module {presence, version} or null when not installed
	 * @param bool $switchedOff the administrator switched the adapter off
	 * @return array {status, version}
	 */
	public static function evaluate(array $adapter, $module, $switchedOff) {
		if ($module === null) {
			return array('status' => self::NOT_INSTALLED, 'version' => '');
		}
		$version = $module['version'];
		// vtlib_isModuleActive(): presence 0 (active) and 2 (hidden, still usable) count as active.
		if (!in_array($module['presence'], array(0, 2), true)) {
			return array('status' => self::INACTIVE, 'version' => $version);
		}
		if (!self::versionInRange($version, $adapter['versions'])) {
			return array('status' => self::VERSION, 'version' => $version);
		}
		$root = ModernUI_Assets_Model::crmRoot();
		foreach ($adapter['files'] as $file) {
			if (!is_file($root . '/' . $file)) {
				return array('status' => self::INCOMPLETE, 'version' => $version);
			}
		}
		foreach ($adapter['tables'] as $table) {
			if (!ModernUI_Db_Model::tableExists($table)) {
				return array('status' => self::INCOMPLETE, 'version' => $version);
			}
		}
		foreach (isset($adapter['fields']) ? $adapter['fields'] : array() as $field) {
			$found = ModernUI_Db_Model::mustRows('SELECT f.fieldid FROM vtiger_field f INNER JOIN vtiger_tab t ON t.tabid = f.tabid'
				. ' WHERE t.name = ? AND f.fieldname = ? AND f.presence IN (0, 2)', array($field['module'], $field['field']));
			if (!$found) {
				return array('status' => self::INCOMPLETE, 'version' => $version);
			}
		}
		if ($switchedOff) {
			return array('status' => self::DISABLED, 'version' => $version);
		}
		return array('status' => self::ACTIVE, 'version' => $version);
	}

	/**
	 * @param string $version vtiger_tab.version
	 * @param array $range {min, below}
	 * @return bool
	 */
	public static function versionInRange($version, array $range) {
		$min = isset($range['min']) ? $range['min'] : null;
		$below = isset($range['below']) ? $range['below'] : null;
		if ($min === null && $below === null) {
			return true;
		}
		if (!is_string($version) || !preg_match('/^\d+(\.\d+)*$/', $version)) {
			return false;
		}
		if ($min !== null && version_compare($version, $min, '<')) {
			return false;
		}
		if ($below !== null && version_compare($version, $below, '>=')) {
			return false;
		}
		return true;
	}

	/**
	 * Active adapters with their definitions.
	 * @param array $values effective settings
	 * @return array id => definition + {version}
	 */
	public static function active(array $values) {
		$active = array();
		$registry = self::registry();
		foreach (self::statuses($values) as $id => $status) {
			if ($status['status'] === self::ACTIVE) {
				$active[$id] = array_merge($registry[$id], array('version' => $status['version']));
			}
		}
		return $active;
	}

	/**
	 * Changes with the set of active adapters and their versions (part of the cache key of the tokens stylesheet).
	 * @param array $values
	 * @return string
	 */
	public static function fingerprint(array $values) {
		$parts = array();
		foreach (self::active($values) as $id => $adapter) {
			$parts[] = $id . '@' . $adapter['version'];
		}
		return implode(',', $parts);
	}

	/**
	 * Level a screen rule of an active adapter gives the request, or null.
	 * @param array $values
	 * @param array $request module, view, parent
	 * @return string|null self::LEVEL_*
	 */
	public static function screenLevel(array $values, array $request) {
		$current = array();
		foreach (array('module', 'view', 'parent') as $part) {
			$current[$part] = isset($request[$part]) && is_string($request[$part]) ? $request[$part] : '';
		}
		$level = null;
		foreach (self::active($values) as $adapter) {
			foreach ($adapter['screens'] as $screen) {
				$match = true;
				foreach ($current as $part => $value) {
					if ($screen[$part] !== '*' && strcasecmp($screen[$part], $value) !== 0) {
						$match = false;
						break;
					}
				}
				if ($match && ($level === null || $screen['level'] === self::LEVEL_STANDARD)) {
					$level = $screen['level'];
				}
			}
		}
		return $level;
	}

	/**
	 * Active adapters for the shell (action=Bootstrap).
	 * @param array $values
	 * @return array [{id, module, version, script, screens: [{module, view, parent, level}]}]
	 */
	public static function forClient(array $values) {
		$list = array();
		foreach (self::active($values) as $id => $adapter) {
			$list[] = array(
				'id' => $id,
				'module' => $adapter['module'],
				'version' => $adapter['version'],
				'script' => (bool) $adapter['script'],
				'screens' => array_values($adapter['screens']),
			);
		}
		return $list;
	}

	/**
	 * Every adapter with its status, for the settings editor.
	 * @param array $values effective global settings
	 * @return array [{id, module, title, vendor, versions, status, version}]
	 */
	public static function catalog(array $values) {
		$list = array();
		$registry = self::registry();
		foreach (self::statuses($values) as $id => $status) {
			$adapter = $registry[$id];
			$list[] = array(
				'id' => $id,
				'module' => $adapter['module'],
				'title' => $adapter['title'],
				'vendor' => $adapter['vendor'],
				'versions' => array(
					'min' => isset($adapter['versions']['min']) ? $adapter['versions']['min'] : null,
					'below' => isset($adapter['versions']['below']) ? $adapter['versions']['below'] : null,
				),
				'status' => $status['status'],
				'version' => $status['version'],
			);
		}
		return $list;
	}

	/**
	 * Stylesheets of the active adapters, appended to the tokens stylesheet of the user (render-blocking, so the first
	 * paint already has them; nothing of an adapter reaches a CRM without its extension). The CSS comes from the
	 * production build of the package only.
	 * @param array $values
	 * @return string
	 */
	public static function styles(array $values) {
		$css = '';
		$manifest = ModernUI_Assets_Model::manifest();
		if ($manifest === null) {
			return $css;
		}
		$dist = ModernUI_Assets_Model::crmRoot() . '/' . ModernUI_Assets_Model::DIST . '/';
		foreach (self::active($values) as $id => $adapter) {
			if (empty($adapter['style'])) {
				continue;
			}
			$entry = 'src/adapters/ext/' . $id . '/style.scss';
			$file = isset($manifest[$entry]['file']) ? $manifest[$entry]['file'] : null;
			if (!is_string($file) || !preg_match('#^assets/[A-Za-z0-9._-]+\.css$#', $file) || !is_file($dist . $file)) {
				continue;
			}
			$content = @file_get_contents($dist . $file);
			if (is_string($content) && $content !== '') {
				$css .= '/* ModernUI adapter ' . $id . ' */' . "\n" . preg_replace('/^@charset "[^"]*";\s*/', '', $content) . "\n";
			}
		}
		return $css;
	}
}
