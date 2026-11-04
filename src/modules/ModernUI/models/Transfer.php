<?php
/*
 * Moving the theme settings between CRMs (docs/settings.md §9): export to a versioned JSON file, analysis of a file
 * with a report of what would change, application of the chosen parts in one transaction.
 *
 * No numeric ids leave the CRM: users are referenced by their user name, roles by the path of role names below the
 * root (the root itself is named differently by installations), modules by their name. The file holds settings
 * only: no secrets, no records of the CRM, no names, e-mails or other data of people — the user names of the pilot
 * and of personal settings are the account names needed to map them, and personal settings are a separate part.
 * The custom logo is not exported (the report asks to upload it again); the mode of the theme is applied only when
 * the administrator asks for it.
 */

require_once 'modules/ModernUI/models/Editor.php';

class ModernUI_Transfer_Model {

	const FORMAT = 'modernui.settings';
	const FORMAT_VERSION = 1;
	const MAX_BYTES = 262144;
	const MAX_ROLES = 500;
	const MAX_USERS = 5000;
	const MAX_LISTED = 50;

	const PART_GLOBAL = 'global';
	const PART_ROLES = 'roles';
	const PART_USERS = 'users';

	/** @var array|null role path key => [role ids] */
	private static $roleIndex = null;
	/** @var array|null lower-case user name => id */
	private static $userIndex = null;

	/**
	 * Forgets the indexes (tests).
	 */
	public static function reset() {
		self::$roleIndex = null;
		self::$userIndex = null;
	}

	/**
	 * Key of a role path: names below the root, trimmed, lower case.
	 * @param array $path
	 * @return string|null
	 */
	public static function pathKey($path) {
		if (!is_array($path) || count($path) < 2 || count($path) > 30) {
			return null;
		}
		$parts = array();
		foreach (array_slice(array_values($path), 1) as $name) {
			if (!is_string($name) || $name === '' || strlen($name) > 200) {
				return null;
			}
			$parts[] = mb_strtolower(trim($name), 'UTF-8');
		}
		return implode("\x1f", $parts);
	}

	/**
	 * @param array $path role path from a file
	 * @return array {id: string|null, ambiguous: bool}
	 */
	private static function resolveRole($path) {
		if (self::$roleIndex === null) {
			self::$roleIndex = array();
			foreach (ModernUI_Editor_Model::roles() as $id => $role) {
				$key = self::pathKey($role['path']);
				if ($key !== null) {
					self::$roleIndex[$key][] = $id;
				}
			}
		}
		$key = self::pathKey($path);
		if ($key === null || !isset(self::$roleIndex[$key])) {
			return array('id' => null, 'ambiguous' => false);
		}
		$ids = self::$roleIndex[$key];
		return count($ids) === 1 ? array('id' => $ids[0], 'ambiguous' => false) : array('id' => null, 'ambiguous' => true);
	}

	/**
	 * @param mixed $userName
	 * @return int|null id of a not deleted user
	 */
	private static function resolveUser($userName) {
		if (self::$userIndex === null) {
			self::$userIndex = array();
			foreach (ModernUI_Editor_Model::users() as $id => $user) {
				self::$userIndex[mb_strtolower($user['userName'], 'UTF-8')] = $id;
			}
		}
		if (!is_string($userName) || $userName === '') {
			return null;
		}
		$key = mb_strtolower(trim($userName), 'UTF-8');
		return isset(self::$userIndex[$key]) ? self::$userIndex[$key] : null;
	}

	/**
	 * The export file.
	 * @param array $parts any of global, roles, users
	 * @return array
	 */
	public static function export(array $parts) {
		$roles = ModernUI_Editor_Model::roles();
		$users = ModernUI_Editor_Model::users();
		$file = array(
			'format' => self::FORMAT,
			'formatVersion' => self::FORMAT_VERSION,
			'exportedAt' => gmdate('Y-m-d\TH:i:s\Z'),
			'source' => array(
				'module' => ModernUI_Lifecycle_Model::moduleVersion(),
				'vtiger' => (string) vglobal('vtiger_current_version'),
				'schema' => ModernUI_Schema_Model::VERSION,
			),
		);
		$omitted = array();
		if (in_array(self::PART_GLOBAL, $parts, true)) {
			$global = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_GLOBAL, ''), ModernUI_Settings_Model::SCOPE_GLOBAL);
			$values = $global['values'];
			if (isset($values['branding.logo']) && $values['branding.logo'] !== 'company') {
				$omitted[] = 'branding.logo';
			}
			unset($values['branding.logo']);
			if (isset($values['theme.pilot.users'])) {
				$refs = array();
				foreach ($values['theme.pilot.users'] as $id) {
					if (isset($users[$id])) {
						$refs[] = array('userName' => $users[$id]['userName']);
					}
				}
				$values['theme.pilot.users'] = $refs;
			}
			if (isset($values['theme.pilot.roles'])) {
				$refs = array();
				foreach ($values['theme.pilot.roles'] as $id) {
					if (isset($roles[$id])) {
						$refs[] = array('path' => $roles[$id]['path']);
					}
				}
				$values['theme.pilot.roles'] = $refs;
			}
			$file['global'] = ModernUI_Settings_Model::nest($values);
		}
		if (in_array(self::PART_ROLES, $parts, true)) {
			$file['roles'] = array();
			foreach (ModernUI_Db_Model::rows('SELECT scope, scope_key, data, doc_version, revision, updated_by, updated_at FROM '
					. ModernUI_Settings_Model::TABLE . ' WHERE scope = ? ORDER BY scope_key', array(ModernUI_Settings_Model::SCOPE_ROLE)) as $row) {
				if (!isset($roles[$row['scope_key']])) {
					continue;
				}
				$decoded = ModernUI_Settings_Model::decodeRow($row, ModernUI_Settings_Model::SCOPE_ROLE);
				$file['roles'][] = array(
					'role' => array('path' => $roles[$row['scope_key']]['path']),
					'inherit' => !empty($decoded['meta']['inherit']),
					'settings' => ModernUI_Settings_Model::nest($decoded['values']),
				);
			}
		}
		if (in_array(self::PART_USERS, $parts, true)) {
			$file['users'] = array();
			$overridable = ModernUI_Settings_Model::userOverridableKeys();
			foreach (ModernUI_Db_Model::rows('SELECT scope, scope_key, data, doc_version, revision, updated_by, updated_at FROM '
					. ModernUI_Settings_Model::TABLE . ' WHERE scope = ? ORDER BY scope_key', array(ModernUI_Settings_Model::SCOPE_USER)) as $row) {
				$id = (int) $row['scope_key'];
				if (!isset($users[$id])) {
					continue;
				}
				$decoded = ModernUI_Settings_Model::decodeRow($row, ModernUI_Settings_Model::SCOPE_USER);
				$values = array_intersect_key($decoded['values'], array_flip($overridable));
				if ($values) {
					$file['users'][] = array('user' => array('userName' => $users[$id]['userName']), 'settings' => ModernUI_Settings_Model::nest($values));
				}
			}
		}
		if ($omitted) {
			$file['omitted'] = $omitted;
		}
		return $file;
	}

	/**
	 * A settings document of a file (with "v") as a flat map; null when it is not a document of a known version.
	 * @param mixed $document
	 * @return array|null
	 */
	private static function flatDocument($document) {
		if (!is_array($document) || ModernUI_Settings_Model::isList($document) && $document) {
			return null;
		}
		if (!isset($document['v']) || !is_int($document['v']) || $document['v'] < 1 || $document['v'] > ModernUI_Settings_Model::DOC_VERSION) {
			return null;
		}
		// Documents of an older format would be raised here by the converters of ModernUI_SettingsUpgrade (none yet: v1).
		return ModernUI_Settings_Model::flatten($document);
	}

	/**
	 * A short form of a value for the report: scalars as they are, lists and the menu as counts.
	 * @param string $key
	 * @param mixed $value
	 * @return mixed
	 */
	public static function summarize($key, $value) {
		if ($value === null || is_scalar($value)) {
			return $value;
		}
		if ($key === 'navigation.groups') {
			$items = 0;
			foreach ($value as $group) {
				$items += count($group['items']);
			}
			return array('groups' => count($value), 'items' => $items);
		}
		if (ModernUI_Settings_Model::isList($value)) {
			$scalars = true;
			foreach ($value as $entry) {
				$scalars = $scalars && is_scalar($entry);
			}
			return $scalars && count($value) <= 10 ? $value : array('count' => count($value));
		}
		return $value;
	}

	/**
	 * Keys whose value differs between the current and the planned document.
	 * @param array $before
	 * @param array $after
	 * @return array [{key, before, after}]
	 */
	public static function diff(array $before, array $after) {
		$keys = array_unique(array_merge(array_keys($before), array_keys($after)));
		sort($keys);
		$changes = array();
		foreach ($keys as $key) {
			$old = array_key_exists($key, $before) ? $before[$key] : null;
			$new = array_key_exists($key, $after) ? $after[$key] : null;
			if ($old !== $new) {
				$changes[] = array('key' => $key, 'before' => self::summarize($key, $old), 'after' => self::summarize($key, $new));
			}
		}
		return $changes;
	}

	/**
	 * @param string $part
	 * @param string $scope
	 * @param array $errors validate() errors
	 * @param array $report
	 */
	private static function invalid($part, $scope, array $errors, array &$report) {
		foreach ($errors as $error) {
			if (count($report['invalid']) < self::MAX_LISTED) {
				$report['invalid'][] = array('part' => $part, 'scope' => $scope, 'path' => $error['path'], 'code' => $error['code']);
			}
		}
	}

	/**
	 * Modules of a menu configuration that this CRM does not have, and routes with a filter id (not portable).
	 * @param array $values
	 * @param string $scope label of the scope for the report
	 * @param array $known module => true
	 * @param array $report
	 */
	private static function inspectMenu(array $values, $scope, array $known, array &$report) {
		$modules = isset($values['navigation.hidden']) ? $values['navigation.hidden'] : array();
		foreach (isset($values['navigation.groups']) ? $values['navigation.groups'] : array() as $group) {
			foreach ($group['items'] as $item) {
				if ($item['type'] === 'module') {
					$modules[] = $item['module'];
				} else {
					$modules[] = $item['route']['module'];
					if (isset($item['route']['params']['viewname']) && count($report['checkFilters']) < self::MAX_LISTED) {
						$report['checkFilters'][] = array('scope' => $scope, 'id' => $item['id'],
							'label' => ModernUI_Menu_Model::label($item['label'], 'en-US', null));
					}
				}
			}
		}
		foreach ($modules as $module) {
			if (!isset($known[$module]) && !in_array($module, $report['unknownModules'], true) && count($report['unknownModules']) < self::MAX_LISTED) {
				$report['unknownModules'][] = $module;
			}
		}
	}

	/**
	 * Checks a file and computes what an import would change; nothing is written.
	 * @param mixed $json content of the file
	 * @return array {ok: true, report, plan, fingerprint} or failure
	 */
	public static function analyze($json) {
		if (!is_string($json) || $json === '') {
			return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT');
		}
		if (strlen($json) > self::MAX_BYTES) {
			return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_TOO_LARGE');
		}
		$data = json_decode($json, true, 64);
		if (!is_array($data) || ($data && ModernUI_Settings_Model::isList($data))) {
			return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT');
		}
		foreach (array_keys($data) as $key) {
			if (!in_array($key, array('format', 'formatVersion', 'exportedAt', 'source', 'global', 'roles', 'users', 'omitted'), true)) {
				return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT', array('path' => substr((string) $key, 0, 40)));
			}
		}
		if (!isset($data['format']) || $data['format'] !== self::FORMAT || !isset($data['formatVersion']) || !is_int($data['formatVersion']) || $data['formatVersion'] < 1) {
			return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT', array('path' => 'format'));
		}
		if ($data['formatVersion'] > self::FORMAT_VERSION) {
			return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_VERSION', array('version' => $data['formatVersion']));
		}
		$text = function ($value) {
			return is_string($value) && preg_match('/^[A-Za-z0-9 .:_+-]{1,40}$/', $value) ? $value : null;
		};
		$source = isset($data['source']) && is_array($data['source']) ? $data['source'] : array();
		$report = array(
			'source' => array(
				'module' => $text(isset($source['module']) ? $source['module'] : null),
				'vtiger' => $text(isset($source['vtiger']) ? $source['vtiger'] : null),
				'exportedAt' => $text(isset($data['exportedAt']) ? $data['exportedAt'] : null),
			),
			'global' => null,
			'roles' => null,
			'users' => null,
			'uploadLogo' => isset($data['omitted']) && is_array($data['omitted']) && in_array('branding.logo', $data['omitted'], true),
			'unknownModules' => array(),
			'checkFilters' => array(),
			'invalid' => array(),
		);
		$plan = array('global' => null, 'roles' => array(), 'users' => array());
		$revisions = array();
		$known = array();
		foreach (ModernUI_Menu_Model::candidates()['list'] as $name => $candidate) {
			$known[$name] = true;
		}

		if (array_key_exists('global', $data)) {
			$flat = self::flatDocument($data['global']);
			if ($flat === null) {
				return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT', array('path' => 'global'));
			}
			$part = array('unresolvedUsers' => array(), 'unresolvedRoles' => array(), 'changes' => array(), 'modeChange' => null);
			if (isset($flat['theme.pilot.users'])) {
				$ids = array();
				foreach (ModernUI_Settings_Model::isList($flat['theme.pilot.users']) ? $flat['theme.pilot.users'] : array() as $ref) {
					$name = is_array($ref) && isset($ref['userName']) ? $ref['userName'] : null;
					$id = self::resolveUser($name);
					if ($id !== null) {
						$ids[] = $id;
					} elseif (count($part['unresolvedUsers']) < self::MAX_LISTED) {
						$part['unresolvedUsers'][] = is_string($name) ? mb_substr($name, 0, 100, 'UTF-8') : '?';
					}
				}
				$flat['theme.pilot.users'] = $ids;
			}
			if (isset($flat['theme.pilot.roles'])) {
				$ids = array();
				foreach (ModernUI_Settings_Model::isList($flat['theme.pilot.roles']) ? $flat['theme.pilot.roles'] : array() as $ref) {
					$path = is_array($ref) && isset($ref['path']) ? $ref['path'] : null;
					$role = self::resolveRole($path);
					if ($role['id'] !== null) {
						$ids[] = $role['id'];
					} elseif (count($part['unresolvedRoles']) < self::MAX_LISTED) {
						$part['unresolvedRoles'][] = is_array($path) ? implode(' / ', array_filter($path, 'is_string')) : '?';
					}
				}
				$flat['theme.pilot.roles'] = $ids;
			}
			unset($flat['branding.logo']);
			$checked = ModernUI_Settings_Model::validate(ModernUI_Settings_Model::SCOPE_GLOBAL, $flat);
			self::invalid('global', 'global', $checked['errors'], $report);
			$row = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_GLOBAL, '');
			$current = ModernUI_Settings_Model::decodeRow($row, ModernUI_Settings_Model::SCOPE_GLOBAL);
			$revisions['global'] = $current['revision'];
			$planned = $checked['values'];
			$currentMode = isset($current['values']['theme.mode']) ? $current['values']['theme.mode'] : 'off';
			$fileMode = isset($planned['theme.mode']) ? $planned['theme.mode'] : 'off';
			if ($currentMode !== $fileMode) {
				$part['modeChange'] = array('before' => $currentMode, 'after' => $fileMode);
			}
			$compareBefore = $current['values'];
			$compareAfter = $planned;
			unset($compareBefore['theme.mode'], $compareAfter['theme.mode'], $compareBefore['branding.logo']);
			$part['changes'] = array_slice(self::diff($compareBefore, $compareAfter), 0, 100);
			self::inspectMenu($planned, 'global', $known, $report);
			$report['global'] = $part;
			$plan['global'] = $planned;
		}

		if (array_key_exists('roles', $data)) {
			if (!ModernUI_Settings_Model::isList($data['roles']) || count($data['roles']) > self::MAX_ROLES) {
				return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT', array('path' => 'roles'));
			}
			$part = array('matched' => array(), 'unresolved' => array(), 'ambiguous' => array());
			$roles = ModernUI_Editor_Model::roles();
			foreach ($data['roles'] as $index => $entry) {
				$path = is_array($entry) && isset($entry['role']['path']) ? $entry['role']['path'] : null;
				$flat = is_array($entry) && isset($entry['settings']) ? self::flatDocument($entry['settings']) : null;
				if ($flat === null || !is_array($path) || (isset($entry['inherit']) && !is_bool($entry['inherit']))) {
					return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT', array('path' => 'roles[' . $index . ']'));
				}
				$label = implode(' / ', array_filter($path, 'is_string'));
				$role = self::resolveRole($path);
				if ($role['id'] === null || $role['id'] === ModernUI_Editor_Model::ROOT_ROLE || isset($plan['roles'][$role['id']])) {
					$list = $role['ambiguous'] ? 'ambiguous' : 'unresolved';
					if (count($part[$list]) < self::MAX_LISTED) {
						$part[$list][] = mb_substr($label, 0, 300, 'UTF-8');
					}
					continue;
				}
				$checked = ModernUI_Settings_Model::validate(ModernUI_Settings_Model::SCOPE_ROLE, $flat);
				self::invalid('roles', $role['id'], $checked['errors'], $report);
				$row = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_ROLE, $role['id']);
				$current = ModernUI_Settings_Model::decodeRow($row, ModernUI_Settings_Model::SCOPE_ROLE);
				$revisions['role:' . $role['id']] = $current['revision'];
				$inherit = !empty($entry['inherit']);
				$plan['roles'][$role['id']] = array('values' => $checked['values'], 'inherit' => $inherit);
				self::inspectMenu($checked['values'], $role['id'], $known, $report);
				$part['matched'][] = array(
					'id' => $role['id'],
					'name' => $roles[$role['id']]['name'],
					'exists' => $row !== null,
					'inherit' => $inherit,
					'changes' => array_slice(self::diff($current['values'], $checked['values']), 0, 100),
				);
			}
			$report['roles'] = $part;
		}

		if (array_key_exists('users', $data)) {
			if (!ModernUI_Settings_Model::isList($data['users']) || count($data['users']) > self::MAX_USERS) {
				return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT', array('path' => 'users'));
			}
			$part = array('matched' => 0, 'changed' => 0, 'unresolved' => array());
			$overridable = ModernUI_Settings_Model::userOverridableKeys();
			foreach ($data['users'] as $index => $entry) {
				$name = is_array($entry) && isset($entry['user']['userName']) ? $entry['user']['userName'] : null;
				$flat = is_array($entry) && isset($entry['settings']) ? self::flatDocument($entry['settings']) : null;
				if ($flat === null || !is_string($name)) {
					return ModernUI_Editor_Model::failure(400, 'MU_IMPORT_FORMAT', array('path' => 'users[' . $index . ']'));
				}
				$id = self::resolveUser($name);
				if ($id === null || isset($plan['users'][$id])) {
					if (count($part['unresolved']) < self::MAX_LISTED) {
						$part['unresolved'][] = mb_substr($name, 0, 100, 'UTF-8');
					}
					continue;
				}
				$checked = ModernUI_Settings_Model::validate(ModernUI_Settings_Model::SCOPE_USER, $flat, $overridable);
				self::invalid('users', $name, $checked['errors'], $report);
				$row = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_USER, (string) $id);
				$current = ModernUI_Settings_Model::decodeRow($row, ModernUI_Settings_Model::SCOPE_USER);
				$revisions['user:' . $id] = $current['revision'];
				$plan['users'][$id] = $checked['values'];
				$part['matched']++;
				if (self::diff(array_intersect_key($current['values'], array_flip($overridable)), $checked['values'])) {
					$part['changed']++;
				}
			}
			$report['users'] = $part;
		}
		ksort($revisions);
		return array('ok' => true, 'report' => $report, 'plan' => $plan, 'fingerprint' => substr(sha1(json_encode($revisions)), 0, 16));
	}

	/**
	 * Applies the chosen parts of a file in one transaction. The file is analysed again; if any affected scope changed
	 * after the preview (another fingerprint), nothing is written.
	 * @param mixed $json
	 * @param array $parts
	 * @param bool $includeMode apply theme.mode of the file as well
	 * @param string $fingerprint fingerprint of the preview
	 * @param int $authorId
	 * @return array {ok: true, applied: {global, roles, users}} or failure
	 */
	public static function apply($json, array $parts, $includeMode, $fingerprint, $authorId) {
		$analysis = self::analyze($json);
		if (!$analysis['ok']) {
			return $analysis;
		}
		if (!is_string($fingerprint) || !hash_equals($analysis['fingerprint'], $fingerprint)) {
			return ModernUI_Editor_Model::failure(409, 'MU_CONFLICT', array('revision' => 0, 'updatedBy' => null, 'updatedAt' => null));
		}
		$plan = $analysis['plan'];
		$applied = array('global' => false, 'roles' => 0, 'users' => 0);
		ModernUI_Db_Model::mustExecute('START TRANSACTION');
		try {
			if (in_array(self::PART_GLOBAL, $parts, true) && $plan['global'] !== null) {
				$row = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_GLOBAL, '');
				$current = ModernUI_Settings_Model::decodeRow($row, ModernUI_Settings_Model::SCOPE_GLOBAL);
				$values = $plan['global'];
				if (!$includeMode) {
					unset($values['theme.mode']);
					if (isset($current['values']['theme.mode'])) {
						$values['theme.mode'] = $current['values']['theme.mode'];
					}
				}
				// The logo is not transferred: this CRM keeps its own.
				unset($values['branding.logo']);
				if (isset($current['values']['branding.logo'])) {
					$values['branding.logo'] = $current['values']['branding.logo'];
				}
				self::write(ModernUI_Settings_Model::SCOPE_GLOBAL, '', $values, $row, $authorId, $current['meta']);
				$applied['global'] = true;
			}
			if (in_array(self::PART_ROLES, $parts, true)) {
				foreach ($plan['roles'] as $roleId => $entry) {
					$row = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_ROLE, $roleId);
					self::write(ModernUI_Settings_Model::SCOPE_ROLE, $roleId, $entry['values'], $row, $authorId, array('inherit' => $entry['inherit']));
					$applied['roles']++;
				}
			}
			if (in_array(self::PART_USERS, $parts, true)) {
				foreach ($plan['users'] as $userId => $values) {
					$row = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_USER, (string) $userId);
					$current = ModernUI_Settings_Model::decodeRow($row, ModernUI_Settings_Model::SCOPE_USER);
					// The personal switches (standard view, self-enabled) of the user stay as they are.
					foreach (array('user.standardView', 'user.selfEnabled') as $key) {
						if (isset($current['values'][$key])) {
							$values[$key] = $current['values'][$key];
						}
					}
					self::write(ModernUI_Settings_Model::SCOPE_USER, (string) $userId, $values, $row, $authorId, array());
					$applied['users']++;
				}
			}
			ModernUI_Db_Model::mustExecute('COMMIT');
		} catch (Throwable $e) {
			ModernUI_Db_Model::execute('ROLLBACK');
			if ($e instanceof ModernUI_TransferConflict) {
				return ModernUI_Editor_Model::conflict($e->conflict);
			}
			throw $e;
		}
		ModernUI_Activation_Model::reset();
		return array('ok' => true, 'applied' => $applied);
	}

	/**
	 * @param string $scope
	 * @param string $scopeKey
	 * @param array $values
	 * @param array|null $row
	 * @param int $authorId
	 * @param array $meta
	 * @throws ModernUI_TransferConflict
	 */
	private static function write($scope, $scopeKey, array $values, $row, $authorId, array $meta) {
		$saved = ModernUI_Settings_Model::save($scope, $scopeKey, $values, $row ? (int) $row['revision'] : 0, $authorId, $meta);
		if (!$saved['ok']) {
			throw new ModernUI_TransferConflict($saved['conflict']);
		}
	}
}

/** A scope changed while an import was being written: the transaction is rolled back. */
class ModernUI_TransferConflict extends RuntimeException {
	public $conflict;

	public function __construct(array $conflict) {
		parent::__construct('ModernUI: settings changed during the import');
		$this->conflict = $conflict;
	}
}
