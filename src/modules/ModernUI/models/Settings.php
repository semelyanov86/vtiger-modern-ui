<?php
/*
 * Settings of ModernUI (docs/settings.md): scopes default → global → role → user, schema version 1.
 *
 * A scope document is stored as JSON in vtiger_modernui_settings ({"v":1,"theme":{"mode":"off"},...}).
 * Internally values are handled as a flat map of dotted keys ("theme.mode" => "off"). Every value is
 * validated when it is read and when it is written: unknown or invalid values are dropped with a warning
 * and never break the merge.
 */

require_once 'modules/ModernUI/models/Db.php';

class ModernUI_Settings_Model {

	const DOC_VERSION = 1;
	const TABLE = 'vtiger_modernui_settings';

	const SCOPE_GLOBAL = 'global';
	const SCOPE_ROLE = 'role';
	const SCOPE_USER = 'user';

	/** Keys a user may change only when policy.userOverrides lists them. */
	private static $userOverridable = array(
		'locale', 'appearance.primaryColor', 'appearance.background', 'appearance.surface',
		'appearance.density', 'appearance.fontScale', 'navigation.compact', 'navigation.favorites',
	);

	/** Locales of custom labels; "*" is the common variant for any other language (docs/settings.md §6.2). */
	const LABEL_LOCALES = array('ru-RU', 'en-US', 'de-DE', '*');
	const LABEL_MAX = 60;
	const MENU_GROUPS_MAX = 30;
	const MENU_ITEMS_MAX = 100;
	/** Parameters a menu route may carry (docs/settings.md §6.1); the URL is always built by the server. */
	const ROUTE_PARAMS = array('app', 'viewname', 'mode', 'parent');

	/**
	 * Specification of the keys of schema version 1 (docs/settings.md §4).
	 * @return array key => {type, default, scopes, …}
	 */
	public static function spec() {
		static $spec = null;
		if ($spec === null) {
			$locales = array('auto', 'ru-RU', 'en-US', 'de-DE');
			$spec = array(
				'theme.mode' => array('type' => 'enum', 'values' => array('off', 'pilot', 'all'), 'default' => 'off', 'scopes' => array('global')),
				'theme.pilot.users' => array('type' => 'ids', 'max' => 500, 'default' => array(), 'scopes' => array('global')),
				'theme.pilot.roles' => array('type' => 'roles', 'max' => 200, 'default' => array(), 'scopes' => array('global')),
				'theme.pilot.includeSubordinates' => array('type' => 'bool', 'default' => true, 'scopes' => array('global')),
				'theme.allowSelfEnable' => array('type' => 'bool', 'default' => false, 'scopes' => array('global')),
				'theme.allowOptOut' => array('type' => 'bool', 'default' => true, 'scopes' => array('global')),
				'theme.excludedScreens' => array('type' => 'screens', 'max' => 100, 'default' => array(), 'scopes' => array('global', 'role'), 'merge' => 'union'),
				'policy.userOverrides' => array('type' => 'keys', 'default' => array('locale', 'appearance.density', 'appearance.fontScale', 'navigation.compact', 'navigation.favorites'), 'scopes' => array('global')),
				'locale.default' => array('type' => 'enum', 'values' => $locales, 'default' => 'auto', 'scopes' => array('global', 'role')),
				'locale' => array('type' => 'enum', 'values' => $locales, 'default' => 'auto', 'scopes' => array('user')),
				'appearance.primaryColor' => array('type' => 'color', 'maxLuminance' => 0.9, 'default' => '#3978fe', 'scopes' => array('global', 'role', 'user')),
				'appearance.background' => array('type' => 'color', 'minLuminance' => 0.85, 'default' => '#eff0f2', 'scopes' => array('global', 'role', 'user')),
				'appearance.surface' => array('type' => 'color', 'minLuminance' => 0.92, 'default' => '#ffffff', 'scopes' => array('global', 'role', 'user')),
				'appearance.density' => array('type' => 'enum', 'values' => array('comfortable', 'standard', 'compact'), 'default' => 'standard', 'scopes' => array('global', 'role', 'user')),
				'appearance.fontScale' => array('type' => 'enum', 'values' => array(90, 100, 110, 125), 'default' => 100, 'scopes' => array('global', 'role', 'user')),
				'appearance.font' => array('type' => 'enum', 'values' => array('inter', 'system'), 'default' => 'inter', 'scopes' => array('global', 'role')),
				'branding.logo' => array('type' => 'logo', 'default' => 'company', 'scopes' => array('global')),
				'branding.title' => array('type' => 'title', 'default' => 'company', 'scopes' => array('global')),
				'navigation.groups' => array('type' => 'menu', 'default' => null, 'scopes' => array('global', 'role')),
				'navigation.hidden' => array('type' => 'modules', 'max' => 500, 'default' => array(), 'scopes' => array('global', 'role')),
				'navigation.favoritesEnabled' => array('type' => 'bool', 'default' => true, 'scopes' => array('global', 'role')),
				'navigation.compact' => array('type' => 'bool', 'default' => false, 'scopes' => array('global', 'role', 'user')),
				'navigation.favorites' => array('type' => 'modules', 'max' => 30, 'default' => array(), 'scopes' => array('user')),
				'user.standardView' => array('type' => 'bool', 'default' => false, 'scopes' => array('user')),
				'user.selfEnabled' => array('type' => 'bool', 'default' => false, 'scopes' => array('user')),
			);
		}
		return $spec;
	}

	/**
	 * Values of the "default" scope.
	 * @return array flat map
	 */
	public static function defaults() {
		$values = array();
		foreach (self::spec() as $key => $definition) {
			$values[$key] = $definition['default'];
		}
		return $values;
	}

	/**
	 * Keys an administrator may open to personal changes (values of policy.userOverrides).
	 * @return array
	 */
	public static function userOverridableKeys() {
		return self::$userOverridable;
	}

	/**
	 * Keys the user may write in the personal scope under the given global/effective policy.
	 * @param array $effective merged values (needs policy.userOverrides, theme.allowOptOut, theme.allowSelfEnable)
	 * @return array
	 */
	public static function allowedUserKeys(array $effective) {
		$allowed = array();
		$overrides = isset($effective['policy.userOverrides']) && is_array($effective['policy.userOverrides'])
			? $effective['policy.userOverrides'] : array();
		foreach (self::$userOverridable as $key) {
			if (in_array($key, $overrides, true)) {
				$allowed[] = $key;
			}
		}
		if (!empty($effective['theme.allowOptOut'])) {
			$allowed[] = 'user.standardView';
		}
		if (!empty($effective['theme.allowSelfEnable'])) {
			$allowed[] = 'user.selfEnabled';
		}
		return $allowed;
	}

	/**
	 * Validates a flat map for a scope.
	 * @param string $scope
	 * @param array $values flat map
	 * @param array|null $allowedKeys extra restriction (user scope: allowedUserKeys())
	 * @return array {values: array, errors: array of {key, code, path}}; path names the offending part of a
	 *         composite value (navigation.groups[2].items[0].label.de-DE), otherwise it equals the key
	 */
	public static function validate($scope, array $values, $allowedKeys = null) {
		$spec = self::spec();
		$clean = array();
		$errors = array();
		foreach ($values as $key => $value) {
			$key = (string) $key;
			if (!isset($spec[$key])) {
				$errors[] = array('key' => substr($key, 0, 80), 'code' => 'MU_UNKNOWN_KEY', 'path' => substr($key, 0, 80));
				continue;
			}
			if (!in_array($scope, $spec[$key]['scopes'], true) || ($allowedKeys !== null && !in_array($key, $allowedKeys, true))) {
				$errors[] = array('key' => $key, 'code' => 'MU_FORBIDDEN_KEY', 'path' => $key);
				continue;
			}
			if ($value === null) {
				continue;
			}
			$path = '';
			$normalized = self::normalizeValue($spec[$key], $value, $path);
			if ($normalized === null) {
				$errors[] = array('key' => $key, 'code' => 'MU_INVALID_VALUE', 'path' => $key . $path);
				continue;
			}
			$clean[$key] = $normalized;
		}
		return array('values' => $clean, 'errors' => $errors);
	}

	/**
	 * Whether a value is a JSON list (and not an object).
	 * @param mixed $value
	 * @return bool
	 */
	public static function isList($value) {
		return is_array($value) && (!$value || array_keys($value) === range(0, count($value) - 1));
	}

	/**
	 * Whether a value is a JSON object: an array with string keys (an empty array counts as an empty object).
	 * @param mixed $value
	 * @return bool
	 */
	private static function isObject($value) {
		return is_array($value) && (!$value || array_keys($value) !== range(0, count($value) - 1));
	}

	/**
	 * A custom label: plain text of 1–60 characters after removing control characters and trimming. Markup and
	 * script URLs are refused (the islands print labels as text anyway; such values are mistakes or attacks).
	 * @param mixed $text
	 * @return string|null '' for an empty text, null when invalid
	 */
	public static function cleanLabel($text) {
		if (!is_string($text) || !preg_match('//u', $text)) {
			return null;
		}
		$text = trim(preg_replace('/[\p{Cc}\p{Zl}\p{Zp}]+/u', ' ', $text), " \u{00a0}\t");
		$text = preg_replace('/\s{2,}/u', ' ', $text);
		if ($text === '') {
			return '';
		}
		if (mb_strlen($text, 'UTF-8') > self::LABEL_MAX || preg_match('/[<>]|(?:java|vb)script\s*:|data\s*:\s*text\/html/iu', $text)) {
			return null;
		}
		return $text;
	}

	/**
	 * Labels by locale ({ru-RU, en-US, de-DE, *}); empty variants are dropped.
	 * @param mixed $value
	 * @param string $path receives the sub-path of the error
	 * @return array|null null when invalid; an empty array when no variant is set
	 */
	public static function normalizeLabels($value, &$path) {
		if (!self::isObject($value) || count($value) > count(self::LABEL_LOCALES)) {
			return null;
		}
		$labels = array();
		foreach (self::LABEL_LOCALES as $locale) {
			if (!array_key_exists($locale, $value) || $value[$locale] === null) {
				continue;
			}
			$text = self::cleanLabel($value[$locale]);
			if ($text === null) {
				$path .= '.' . $locale;
				return null;
			}
			if ($text !== '') {
				$labels[$locale] = $text;
			}
		}
		foreach (array_keys($value) as $locale) {
			if (!in_array($locale, self::LABEL_LOCALES, true)) {
				$path .= '.' . substr((string) $locale, 0, 20);
				return null;
			}
		}
		return $labels;
	}

	/**
	 * Normalized value, or null when invalid.
	 * @param array $definition
	 * @param mixed $value
	 * @param string $path receives the sub-path of the error inside a composite value
	 * @return mixed
	 */
	private static function normalizeValue(array $definition, $value, &$path = '') {
		switch ($definition['type']) {
			case 'logo':
				return is_string($value) && preg_match('/^(company|modernui_[0-9a-f]{40}\.png)$/', $value) ? $value : null;
			case 'title':
				if ($value === 'company') {
					return $value;
				}
				$labels = self::normalizeLabels($value, $path);
				return $labels ? $labels : null;
			case 'menu':
				return self::normalizeMenu($value, $path);
			case 'bool':
				return is_bool($value) ? $value : null;
			case 'enum':
				foreach ($definition['values'] as $allowed) {
					if ($value === $allowed || (is_int($allowed) && is_string($value) && $value === (string) $allowed)) {
						return $allowed;
					}
				}
				return null;
			case 'color':
				if (!is_string($value) || !preg_match('/^#[0-9a-fA-F]{6}$/', $value)) {
					return null;
				}
				$value = strtolower($value);
				$luminance = self::luminance($value);
				if (isset($definition['maxLuminance']) && $luminance > $definition['maxLuminance']) {
					return null;
				}
				if (isset($definition['minLuminance']) && $luminance < $definition['minLuminance']) {
					return null;
				}
				return $value;
			case 'ids':
				return self::normalizeList($value, $definition['max'], function ($item) {
					if (is_int($item) && $item > 0) {
						return $item;
					}
					return (is_string($item) && preg_match('/^[1-9][0-9]{0,9}$/', $item)) ? (int) $item : null;
				}, $path);
			case 'roles':
				return self::normalizeList($value, $definition['max'], function ($item) {
					return (is_string($item) && preg_match('/^[A-Za-z0-9_]{1,32}$/', $item)) ? $item : null;
				}, $path);
			case 'modules':
				return self::normalizeList($value, $definition['max'], function ($item) {
					return (is_string($item) && preg_match('/^[A-Za-z0-9_]{1,50}$/', $item)) ? $item : null;
				}, $path);
			case 'keys':
				$overridable = self::$userOverridable;
				return self::normalizeList($value, count($overridable), function ($item) use ($overridable) {
					return in_array($item, $overridable, true) ? $item : null;
				}, $path);
			case 'screens':
				return self::normalizeList($value, $definition['max'], function ($item) {
					if (!is_array($item)) {
						return null;
					}
					$screen = array();
					foreach (array('module', 'view', 'parent') as $part) {
						$partValue = isset($item[$part]) ? $item[$part] : '';
						if (!is_string($partValue) || !preg_match('/^(\*|[A-Za-z0-9_]{0,50})$/', $partValue)) {
							return null;
						}
						$screen[$part] = $partValue;
					}
					if (count($item) > 3 || $screen['module'] === '') {
						return null;
					}
					return $screen;
				}, $path);
		}
		return null;
	}

	/** Icons of menu groups and items: a subset of Lucide bundled with the frontend (tests/fixtures/menu-icons.json). */
	public static $menuIcons = array(
		'app-window', 'archive', 'banknote', 'bell', 'bookmark', 'box', 'boxes', 'briefcase', 'building', 'calculator',
		'calendar', 'car', 'chart-column', 'clipboard-list', 'clock', 'contact', 'credit-card', 'database', 'door-open',
		'factory', 'file-spreadsheet', 'file-text', 'flag', 'folder', 'globe', 'graduation-cap', 'hammer', 'handshake',
		'headphones', 'heart', 'house', 'inbox', 'kanban', 'landmark', 'layers', 'layout-grid', 'life-buoy', 'link',
		'list-checks', 'mail', 'map-pin', 'megaphone', 'message-square', 'notebook', 'package', 'paint-roller', 'percent',
		'phone', 'presentation', 'receipt', 'ruler', 'settings', 'shield', 'shopping-cart', 'square-pen', 'star', 'store',
		'tag', 'target', 'ticket', 'truck', 'user', 'users', 'wallet', 'wrench', 'zap',
	);

	/**
	 * @param mixed $value
	 * @return bool an icon of the menu set (null means "no icon of its own")
	 */
	private static function isMenuIcon($value) {
		return is_string($value) && in_array($value, self::$menuIcons, true);
	}

	/**
	 * Only the listed keys, all of the required ones.
	 * @param array $object
	 * @param array $allowed
	 * @param array $required
	 * @param string $path receives the unknown or missing key
	 * @return bool
	 */
	private static function hasShape(array $object, array $allowed, array $required, &$path) {
		foreach (array_keys($object) as $key) {
			if (!in_array($key, $allowed, true)) {
				$path .= '.' . substr((string) $key, 0, 40);
				return false;
			}
		}
		foreach ($required as $key) {
			if (!array_key_exists($key, $object)) {
				$path .= '.' . $key;
				return false;
			}
		}
		return true;
	}

	/**
	 * Menu tree of navigation.groups (docs/settings.md §6.1): groups → items, one level, module items and CRM routes.
	 * A route is a module, a view and a few parameters; the server builds index.php?… from them, so external URLs and
	 * script URLs cannot be expressed. Modules are not checked against the CRM here: unknown modules are kept and
	 * skipped when the menu is built (another CRM may have them).
	 * @param mixed $value
	 * @param string $path
	 * @return array|null
	 */
	private static function normalizeMenu($value, &$path) {
		if (!self::isList($value) || count($value) > self::MENU_GROUPS_MAX) {
			return null;
		}
		$name = '/^[A-Za-z0-9_]{1,50}$/';
		$groups = array();
		$groupIds = array();
		$routeIds = array();
		foreach ($value as $g => $group) {
			$at = '[' . $g . ']';
			if (!self::isObject($group) || !self::hasShape($group, array('id', 'source', 'label', 'icon', 'collapsed', 'items'), array('id', 'items'), $at)) {
				$path .= $at;
				return null;
			}
			if (!is_string($group['id']) || !preg_match('/^[a-z0-9_-]{1,32}$/', $group['id']) || in_array($group['id'], $groupIds, true)) {
				$path .= $at . '.id';
				return null;
			}
			$groupIds[] = $group['id'];
			$clean = array('id' => $group['id']);
			if (isset($group['source'])) {
				$sourcePath = $at . '.source';
				if (!self::isObject($group['source']) || !self::hasShape($group['source'], array('app'), array('app'), $sourcePath)
						|| !is_string($group['source']['app']) || !preg_match('/^[A-Z][A-Z_]{0,31}$/', $group['source']['app'])) {
					$path .= $sourcePath;
					return null;
				}
				$clean['source'] = array('app' => $group['source']['app']);
			}
			$labelPath = $at . '.label';
			$labels = isset($group['label']) ? self::normalizeLabels($group['label'], $labelPath) : array();
			if ($labels === null) {
				$path .= $labelPath;
				return null;
			}
			$clean['label'] = $labels ? $labels : null;
			if (isset($group['icon']) && !self::isMenuIcon($group['icon'])) {
				$path .= $at . '.icon';
				return null;
			}
			$clean['icon'] = isset($group['icon']) ? $group['icon'] : null;
			if (isset($group['collapsed']) && !is_bool($group['collapsed'])) {
				$path .= $at . '.collapsed';
				return null;
			}
			$clean['collapsed'] = !empty($group['collapsed']);
			if (!self::isList($group['items']) || count($group['items']) > self::MENU_ITEMS_MAX) {
				$path .= $at . '.items';
				return null;
			}
			$clean['items'] = array();
			$modules = array();
			foreach ($group['items'] as $i => $item) {
				$itemPath = $at . '.items[' . $i . ']';
				$type = is_array($item) && isset($item['type']) ? $item['type'] : null;
				if (!self::isObject($item) || ($type !== 'module' && $type !== 'route')) {
					$path .= $itemPath . (is_array($item) ? '.type' : '');
					return null;
				}
				$entry = $type === 'module'
					? self::normalizeModuleItem($item, $name, $itemPath)
					: self::normalizeRouteItem($item, $name, $itemPath);
				if ($entry === null) {
					$path .= $itemPath;
					return null;
				}
				if ($type === 'module') {
					if (in_array($entry['module'], $modules, true)) {
						$path .= $itemPath . '.module';
						return null;
					}
					$modules[] = $entry['module'];
				} else {
					if (in_array($entry['id'], $routeIds, true)) {
						$path .= $itemPath . '.id';
						return null;
					}
					$routeIds[] = $entry['id'];
				}
				$clean['items'][] = $entry;
			}
			$groups[] = $clean;
		}
		return $groups;
	}

	/**
	 * @param array $item
	 * @param string $name pattern of module names
	 * @param string $path
	 * @return array|null
	 */
	private static function normalizeModuleItem(array $item, $name, &$path) {
		if (!self::hasShape($item, array('type', 'module', 'label', 'icon'), array('type', 'module'), $path)) {
			return null;
		}
		if (!is_string($item['module']) || !preg_match($name, $item['module'])) {
			$path .= '.module';
			return null;
		}
		$labelPath = '.label';
		$labels = isset($item['label']) ? self::normalizeLabels($item['label'], $labelPath) : array();
		if ($labels === null) {
			$path .= $labelPath;
			return null;
		}
		if (isset($item['icon']) && !self::isMenuIcon($item['icon'])) {
			$path .= '.icon';
			return null;
		}
		return array('type' => 'module', 'module' => $item['module'], 'label' => $labels ? $labels : null,
			'icon' => isset($item['icon']) ? $item['icon'] : null);
	}

	/**
	 * @param array $item
	 * @param string $name pattern of module and view names
	 * @param string $path
	 * @return array|null
	 */
	private static function normalizeRouteItem(array $item, $name, &$path) {
		if (!self::hasShape($item, array('type', 'id', 'label', 'icon', 'route'), array('type', 'id', 'label', 'route'), $path)) {
			return null;
		}
		if (!is_string($item['id']) || !preg_match('/^[a-z0-9_-]{1,32}$/', $item['id'])) {
			$path .= '.id';
			return null;
		}
		$labelPath = '.label';
		$labels = self::normalizeLabels($item['label'], $labelPath);
		if (!$labels) {
			$path .= $labelPath;
			return null;
		}
		if (isset($item['icon']) && !self::isMenuIcon($item['icon'])) {
			$path .= '.icon';
			return null;
		}
		$route = $item['route'];
		$routePath = '.route';
		if (!self::isObject($route) || !self::hasShape($route, array('module', 'view', 'params'), array('module', 'view'), $routePath)) {
			$path .= $routePath;
			return null;
		}
		foreach (array('module', 'view') as $part) {
			if (!is_string($route[$part]) || !preg_match($name, $route[$part])) {
				$path .= '.route.' . $part;
				return null;
			}
		}
		$params = array();
		if (isset($route['params'])) {
			if (!self::isObject($route['params'])) {
				$path .= '.route.params';
				return null;
			}
			foreach ($route['params'] as $key => $paramValue) {
				if (!in_array($key, self::ROUTE_PARAMS, true) || !is_string($paramValue) || !preg_match('/^[A-Za-z0-9_:-]{1,64}$/', $paramValue)) {
					$path .= '.route.params.' . substr((string) $key, 0, 20);
					return null;
				}
				$params[$key] = $paramValue;
			}
			ksort($params);
		}
		return array('type' => 'route', 'id' => $item['id'], 'label' => $labels, 'icon' => isset($item['icon']) ? $item['icon'] : null,
			'route' => array('module' => $route['module'], 'view' => $route['view'], 'params' => $params ? $params : null));
	}

	/**
	 * A list without duplicates and invalid items; null if not a list or too long.
	 * @param mixed $value
	 * @param int $max
	 * @param callable $item
	 * @param string $path receives "[index]" of the first invalid item
	 * @return array|null
	 */
	private static function normalizeList($value, $max, $item, &$path = '') {
		if (!self::isList($value) || count($value) > $max) {
			return null;
		}
		$list = array();
		foreach ($value as $index => $entry) {
			$normalized = $item($entry);
			if ($normalized === null) {
				$path .= '[' . $index . ']';
				return null;
			}
			if (!in_array($normalized, $list, true)) {
				$list[] = $normalized;
			}
		}
		return $list;
	}

	/**
	 * WCAG relative luminance of #rrggbb (0 … 1).
	 * @param string $hex
	 * @return float
	 */
	public static function luminance($hex) {
		$channels = array();
		foreach (array(1, 3, 5) as $offset) {
			$c = hexdec(substr($hex, $offset, 2)) / 255;
			$channels[] = $c <= 0.04045 ? $c / 12.92 : pow(($c + 0.055) / 1.055, 2.4);
		}
		return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
	}

	/**
	 * Merges the scopes for one user: default → global → role → user (docs/settings.md §2).
	 * @param array $global flat map (validated)
	 * @param array $role flat map (validated)
	 * @param array $user flat map (validated)
	 * @return array flat map of effective values
	 */
	public static function merge(array $global, array $role, array $user) {
		$spec = self::spec();
		$effective = self::defaults();
		foreach (array(self::SCOPE_GLOBAL => $global, self::SCOPE_ROLE => $role) as $scope => $values) {
			foreach ($values as $key => $value) {
				if (!isset($spec[$key]) || !in_array($scope, $spec[$key]['scopes'], true)) {
					continue;
				}
				if (isset($spec[$key]['merge']) && $spec[$key]['merge'] === 'union' && $scope !== self::SCOPE_GLOBAL) {
					foreach ($value as $item) {
						if (!in_array($item, $effective[$key], true)) {
							$effective[$key][] = $item;
						}
					}
				} else {
					$effective[$key] = $value;
				}
			}
		}
		$allowed = self::allowedUserKeys($effective);
		foreach ($user as $key => $value) {
			if (in_array($key, $allowed, true)) {
				$effective[$key] = $value;
			}
		}
		return $effective;
	}

	/**
	 * Flat map from a stored document ({"v":1,"theme":{"mode":"off"}}); the "v" and "meta" keys are skipped.
	 * @param array $document
	 * @return array
	 */
	public static function flatten(array $document) {
		$flat = array();
		$spec = self::spec();
		$walk = function ($node, $prefix) use (&$walk, &$flat, $spec) {
			foreach ($node as $key => $value) {
				$path = $prefix === '' ? (string) $key : $prefix . '.' . $key;
				if ($prefix === '' && ($key === 'v' || $key === 'meta')) {
					continue;
				}
				// Objects are walked, except the value of a key that holds an object (branding.title: labels by locale).
				// "locale" and "locale.default" live in different scopes, so the object {"default": …} of a global or
				// role document is walked. Scalars and lists are values.
				$objectKey = isset($spec[$path]) && $spec[$path]['type'] === 'title';
				if ($objectKey || !is_array($value) || !$value || array_keys($value) === range(0, count($value) - 1)) {
					$flat[$path] = $value;
				} else {
					$walk($value, $path);
				}
			}
		};
		$walk($document, '');
		return $flat;
	}

	/**
	 * Stored document from a flat map.
	 * @param array $flat
	 * @param array $meta scope meta data (role: {inherit})
	 * @return array
	 */
	public static function nest(array $flat, array $meta = array()) {
		$document = array('v' => self::DOC_VERSION);
		ksort($flat);
		foreach ($flat as $key => $value) {
			$node = &$document;
			$parts = explode('.', $key);
			$last = array_pop($parts);
			foreach ($parts as $part) {
				if (!isset($node[$part]) || !is_array($node[$part])) {
					$node[$part] = array();
				}
				$node = &$node[$part];
			}
			$node[$last] = $value;
			unset($node);
		}
		if ($meta) {
			$document['meta'] = $meta;
		}
		return $document;
	}

	/**
	 * JSON of a document. Unicode is stored escaped (\uXXXX): the document is pure ASCII and does not depend
	 * on the character set of the table (a clean 8.4 installation creates utf8 databases).
	 * @param array $document
	 * @return string
	 */
	public static function encode(array $document) {
		return json_encode($document, JSON_UNESCAPED_SLASHES);
	}

	/**
	 * Rows of the scopes needed for one user.
	 * @param int $userId
	 * @param array $roleIds own role first, then its ancestors from the nearest one
	 * @return array {global: row|null, roles: roleid => row, user: row|null}
	 */
	public static function loadRows($userId, array $roleIds) {
		$params = array(self::SCOPE_GLOBAL, self::SCOPE_USER, (string) $userId);
		$sql = 'SELECT scope, scope_key, data, doc_version, revision, updated_by, updated_at FROM ' . self::TABLE
			. ' WHERE (scope = ? AND scope_key = \'\') OR (scope = ? AND scope_key = ?)';
		if ($roleIds) {
			$sql .= ' OR (scope = ? AND scope_key IN (' . implode(',', array_fill(0, count($roleIds), '?')) . '))';
			$params[] = self::SCOPE_ROLE;
			foreach ($roleIds as $roleId) {
				$params[] = (string) $roleId;
			}
		}
		$loaded = array('global' => null, 'roles' => array(), 'user' => null);
		foreach (ModernUI_Db_Model::rows($sql, $params) as $row) {
			if ($row['scope'] === self::SCOPE_GLOBAL) {
				$loaded['global'] = $row;
			} elseif ($row['scope'] === self::SCOPE_USER) {
				$loaded['user'] = $row;
			} elseif ($row['scope'] === self::SCOPE_ROLE) {
				$loaded['roles'][$row['scope_key']] = $row;
			}
		}
		return $loaded;
	}

	/**
	 * Decoded and validated values of a stored row.
	 * @param array|null $row
	 * @param string $scope
	 * @return array {values, meta, revision, errors}
	 */
	public static function decodeRow($row, $scope) {
		if (!$row) {
			return array('values' => array(), 'meta' => array(), 'revision' => 0, 'errors' => array());
		}
		$document = json_decode((string) $row['data'], true);
		if (!is_array($document)) {
			return array('values' => array(), 'meta' => array(), 'revision' => (int) $row['revision'],
				'errors' => array(array('key' => '', 'code' => 'MU_INVALID_DOCUMENT')));
		}
		$meta = isset($document['meta']) && is_array($document['meta']) ? $document['meta'] : array();
		$checked = self::validate($scope, self::flatten($document));
		return array('values' => $checked['values'], 'meta' => $meta, 'revision' => (int) $row['revision'], 'errors' => $checked['errors']);
	}

	/**
	 * Effective settings of a user.
	 * @param int $userId
	 * @param string $roleId
	 * @param array $ancestorRoleIds from the nearest ancestor to the root
	 * @return array {values, global, role, user, roleSource, revisions, errors}
	 */
	public static function forUser($userId, $roleId, array $ancestorRoleIds) {
		$roleIds = $roleId !== '' ? array_merge(array($roleId), $ancestorRoleIds) : array();
		$rows = self::loadRows($userId, $roleIds);
		$global = self::decodeRow($rows['global'], self::SCOPE_GLOBAL);
		$user = self::decodeRow($rows['user'], self::SCOPE_USER);
		$role = self::decodeRow(null, self::SCOPE_ROLE);
		$roleSource = null;
		if ($roleId !== '' && isset($rows['roles'][$roleId])) {
			$role = self::decodeRow($rows['roles'][$roleId], self::SCOPE_ROLE);
			$roleSource = $roleId;
		} else {
			foreach ($ancestorRoleIds as $ancestor) {
				if (!isset($rows['roles'][$ancestor])) {
					continue;
				}
				$candidate = self::decodeRow($rows['roles'][$ancestor], self::SCOPE_ROLE);
				if (!empty($candidate['meta']['inherit'])) {
					$role = $candidate;
					$roleSource = $ancestor;
				}
				break;
			}
		}
		return array(
			'values' => self::merge($global['values'], $role['values'], $user['values']),
			'global' => $global,
			'role' => $role,
			'user' => $user,
			'roleSource' => $roleSource,
			'revisions' => array('global' => $global['revision'], 'role' => $role['revision'], 'user' => $user['revision']),
			'errors' => array_merge($global['errors'], $role['errors'], $user['errors']),
		);
	}

	/**
	 * Stored row of one scope.
	 * @param string $scope
	 * @param string $scopeKey
	 * @return array|null
	 */
	public static function getRow($scope, $scopeKey) {
		$rows = ModernUI_Db_Model::rows('SELECT scope, scope_key, data, doc_version, revision, updated_by, updated_at FROM ' . self::TABLE
			. ' WHERE scope = ? AND scope_key = ?', array($scope, (string) $scopeKey));
		return $rows ? $rows[0] : null;
	}

	/**
	 * Writes the whole document of a scope with optimistic locking.
	 * @param string $scope
	 * @param string $scopeKey
	 * @param array $values validated flat map
	 * @param int $baseRevision revision the change is based on (0: the scope has no row yet)
	 * @param int|null $userId author
	 * @param array $meta
	 * @return array {ok: bool, revision: int, conflict?: {revision, updatedBy, updatedAt}}
	 */
	public static function save($scope, $scopeKey, array $values, $baseRevision, $userId, array $meta = array()) {
		$data = self::encode(self::nest($values, $meta));
		$now = date('Y-m-d H:i:s');
		$baseRevision = (int) $baseRevision;
		if ($baseRevision > 0) {
			$result = ModernUI_Db_Model::mustExecute('UPDATE ' . self::TABLE . ' SET data = ?, doc_version = ?, revision = revision + 1, updated_by = ?, updated_at = ?'
				. ' WHERE scope = ? AND scope_key = ? AND revision = ?',
				array($data, self::DOC_VERSION, $userId, $now, $scope, (string) $scopeKey, $baseRevision));
			if (ModernUI_Db_Model::affectedRows($result) === 1) {
				return array('ok' => true, 'revision' => $baseRevision + 1);
			}
		} elseif (!self::getRow($scope, $scopeKey)) {
			$result = ModernUI_Db_Model::execute('INSERT INTO ' . self::TABLE . ' (scope, scope_key, data, doc_version, revision, updated_by, updated_at)'
				. ' VALUES (?, ?, ?, ?, 1, ?, ?)', array($scope, (string) $scopeKey, $data, self::DOC_VERSION, $userId, $now));
			if ($result !== false) {
				return array('ok' => true, 'revision' => 1);
			}
		}
		$current = self::getRow($scope, $scopeKey);
		return array(
			'ok' => false,
			'revision' => $current ? (int) $current['revision'] : 0,
			'conflict' => array(
				'revision' => $current ? (int) $current['revision'] : 0,
				'updatedBy' => $current && $current['updated_by'] !== null ? (int) $current['updated_by'] : null,
				'updatedAt' => $current ? (string) $current['updated_at'] : null,
			),
		);
	}

	/**
	 * Changes some keys of a scope (read, change, write with the read revision); retries once on a conflict
	 * caused by a concurrent writer of a different key.
	 * @param string $scope
	 * @param string $scopeKey
	 * @param array $changes flat map, null removes a key
	 * @param int|null $userId
	 * @return array result of save()
	 */
	public static function update($scope, $scopeKey, array $changes, $userId) {
		$result = array('ok' => false, 'revision' => 0);
		for ($attempt = 0; $attempt < 2; $attempt++) {
			$row = self::getRow($scope, $scopeKey);
			$current = self::decodeRow($row, $scope);
			$values = $current['values'];
			foreach ($changes as $key => $value) {
				if ($value === null) {
					unset($values[$key]);
				} else {
					$values[$key] = $value;
				}
			}
			$result = self::save($scope, $scopeKey, $values, $row ? (int) $row['revision'] : 0, $userId, $current['meta']);
			if ($result['ok']) {
				break;
			}
		}
		return $result;
	}

	/**
	 * Removes the document of a scope (return to the previous scope by precedence).
	 * @param string $scope
	 * @param string $scopeKey
	 */
	public static function reset($scope, $scopeKey) {
		ModernUI_Db_Model::mustExecute('DELETE FROM ' . self::TABLE . ' WHERE scope = ? AND scope_key = ?', array($scope, (string) $scopeKey));
	}
}
