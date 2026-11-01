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

	/**
	 * Specification of the keys of schema version 1 that this version of the module handles.
	 * Navigation, branding and the menu editor keys are added together with their editor (stage 05).
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
	 * @return array {values: array, errors: array of {key, code}}
	 */
	public static function validate($scope, array $values, $allowedKeys = null) {
		$spec = self::spec();
		$clean = array();
		$errors = array();
		foreach ($values as $key => $value) {
			if (!isset($spec[$key])) {
				$errors[] = array('key' => (string) $key, 'code' => 'MU_UNKNOWN_KEY');
				continue;
			}
			if (!in_array($scope, $spec[$key]['scopes'], true) || ($allowedKeys !== null && !in_array($key, $allowedKeys, true))) {
				$errors[] = array('key' => $key, 'code' => 'MU_FORBIDDEN_KEY');
				continue;
			}
			if ($value === null) {
				continue;
			}
			$normalized = self::normalizeValue($spec[$key], $value);
			if ($normalized === null) {
				$errors[] = array('key' => $key, 'code' => 'MU_INVALID_VALUE');
				continue;
			}
			$clean[$key] = $normalized;
		}
		return array('values' => $clean, 'errors' => $errors);
	}

	/**
	 * Normalized value, or null when invalid.
	 * @param array $definition
	 * @param mixed $value
	 * @return mixed
	 */
	private static function normalizeValue(array $definition, $value) {
		switch ($definition['type']) {
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
				});
			case 'roles':
				return self::normalizeList($value, $definition['max'], function ($item) {
					return (is_string($item) && preg_match('/^[A-Za-z0-9_]{1,32}$/', $item)) ? $item : null;
				});
			case 'modules':
				return self::normalizeList($value, $definition['max'], function ($item) {
					return (is_string($item) && preg_match('/^[A-Za-z0-9_]{1,50}$/', $item)) ? $item : null;
				});
			case 'keys':
				$overridable = self::$userOverridable;
				return self::normalizeList($value, count($overridable), function ($item) use ($overridable) {
					return in_array($item, $overridable, true) ? $item : null;
				});
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
				});
		}
		return null;
	}

	/**
	 * A list without duplicates and invalid items; null if not a list or too long.
	 * @param mixed $value
	 * @param int $max
	 * @param callable $item
	 * @return array|null
	 */
	private static function normalizeList($value, $max, $item) {
		if (!is_array($value) || ($value && array_keys($value) !== range(0, count($value) - 1)) || count($value) > $max) {
			return null;
		}
		$list = array();
		foreach ($value as $entry) {
			$normalized = $item($entry);
			if ($normalized === null) {
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
		$walk = function ($node, $prefix) use (&$walk, &$flat) {
			foreach ($node as $key => $value) {
				$path = $prefix === '' ? (string) $key : $prefix . '.' . $key;
				if ($prefix === '' && ($key === 'v' || $key === 'meta')) {
					continue;
				}
				// Objects are always walked (no key of the schema holds an object, "locale" and "locale.default"
				// live in different scopes); scalars and lists are values.
				if (!is_array($value) || !$value || array_keys($value) === range(0, count($value) - 1)) {
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
