<?php
/*
 * Settings editor of administrators (Settings → ModernUI, docs/settings.md §8): data of the editor, saving of the
 * global document and of role profiles with optimistic locking, deleting a role profile, resetting the personal
 * settings of a user, the menu preview. Every method is called by Settings_ModernUI_* actions only, which check
 * that the current user is an administrator (Settings_Vtiger_Index_View::checkPermission) and the CSRF token of
 * writes. User ids, role ids and modules from the request are checked against the CRM; nothing here changes
 * profiles, roles, sharing rules or the v7 menu of the CRM.
 */

require_once 'modules/ModernUI/models/Activation.php';
require_once 'modules/ModernUI/models/Lifecycle.php';
require_once 'modules/ModernUI/models/Menu.php';
require_once 'modules/ModernUI/models/Branding.php';
require_once 'modules/ModernUI/models/Pilot.php';

class ModernUI_Editor_Model {

	/** Root of the role hierarchy ("Organization"): no user has it, so it has no profile. */
	const ROOT_ROLE = 'H1';
	const MAX_ERRORS = 20;

	/**
	 * Keys of the schema an administrator edits in a scope.
	 * @param string $scope global | role
	 * @return array
	 */
	public static function scopeKeys($scope) {
		$keys = array();
		foreach (ModernUI_Settings_Model::spec() as $key => $definition) {
			if (in_array($scope, $definition['scopes'], true)) {
				$keys[] = $key;
			}
		}
		return $keys;
	}

	/**
	 * Roles of the CRM with their path of names from the root.
	 * @return array roleid => {id, name, parent, path: [names], depth}
	 */
	public static function roles() {
		$rows = ModernUI_Db_Model::rows('SELECT roleid, rolename, parentrole, depth FROM vtiger_role ORDER BY parentrole');
		$names = array();
		foreach ($rows as $row) {
			$names[$row['roleid']] = html_entity_decode((string) $row['rolename'], ENT_QUOTES, 'UTF-8');
		}
		$roles = array();
		foreach ($rows as $row) {
			$chain = array_values(array_filter(explode('::', (string) $row['parentrole']), 'strlen'));
			$path = array();
			foreach ($chain as $id) {
				$path[] = isset($names[$id]) ? $names[$id] : $id;
			}
			$roles[$row['roleid']] = array(
				'id' => (string) $row['roleid'],
				'name' => $names[$row['roleid']],
				'parent' => count($chain) > 1 ? $chain[count($chain) - 2] : null,
				'path' => $path,
				'depth' => (int) $row['depth'],
			);
		}
		return $roles;
	}

	/**
	 * Users of the CRM (not deleted) with their role.
	 * @return array id => {id, userName, name, active, isAdmin, role}
	 */
	public static function users() {
		$rows = ModernUI_Db_Model::rows('SELECT u.id, u.user_name, u.first_name, u.last_name, u.status, u.is_admin, r.roleid'
			. ' FROM vtiger_users u LEFT JOIN vtiger_user2role r ON r.userid = u.id WHERE u.deleted = 0 ORDER BY u.user_name');
		$users = array();
		foreach ($rows as $row) {
			$name = trim(html_entity_decode($row['first_name'] . ' ' . $row['last_name'], ENT_QUOTES, 'UTF-8'));
			$users[(int) $row['id']] = array(
				'id' => (int) $row['id'],
				'userName' => html_entity_decode((string) $row['user_name'], ENT_QUOTES, 'UTF-8'),
				'name' => $name,
				'active' => $row['status'] === 'Active',
				'isAdmin' => $row['is_admin'] === 'on',
				'role' => $row['roleid'] !== null ? (string) $row['roleid'] : null,
			);
		}
		return $users;
	}

	/**
	 * Label of the author of a change (conflict messages): name and user name, or #id.
	 * @param mixed $userId
	 * @return string|null
	 */
	public static function authorLabel($userId) {
		if ($userId === null || $userId === '') {
			return null;
		}
		$row = ModernUI_Db_Model::rows('SELECT user_name, first_name, last_name FROM vtiger_users WHERE id = ?', array((int) $userId));
		if (!$row) {
			return '#' . (int) $userId;
		}
		$name = trim(html_entity_decode($row[0]['first_name'] . ' ' . $row[0]['last_name'], ENT_QUOTES, 'UTF-8'));
		$login = html_entity_decode((string) $row[0]['user_name'], ENT_QUOTES, 'UTF-8');
		return $name === '' ? $login : $name . ' (' . $login . ')';
	}

	/**
	 * A stored scope for the editor.
	 * @param array|null $row
	 * @param string $scope
	 * @return array {values, revision, updatedAt, updatedBy, inherit, warnings}
	 */
	private static function scopeData($row, $scope) {
		$decoded = ModernUI_Settings_Model::decodeRow($row, $scope);
		return array(
			'values' => (object) $decoded['values'],
			'revision' => $decoded['revision'],
			'updatedAt' => $row ? (string) $row['updated_at'] : null,
			'updatedBy' => $row ? self::authorLabel($row['updated_by']) : null,
			'inherit' => !empty($decoded['meta']['inherit']),
			'warnings' => $decoded['errors'],
		);
	}

	/**
	 * Everything the editor needs, for the current administrator.
	 * @return array
	 */
	public static function data() {
		$spec = ModernUI_Settings_Model::spec();
		$defaults = array();
		$scopes = array();
		foreach ($spec as $key => $definition) {
			$defaults[$key] = $definition['default'];
			$scopes[$key] = $definition['scopes'];
		}
		$roleRows = array();
		$personal = array();
		foreach (ModernUI_Db_Model::rows('SELECT scope, scope_key, data, doc_version, revision, updated_by, updated_at FROM '
				. ModernUI_Settings_Model::TABLE . ' WHERE scope IN (?, ?)', array(ModernUI_Settings_Model::SCOPE_ROLE, ModernUI_Settings_Model::SCOPE_USER)) as $row) {
			if ($row['scope'] === ModernUI_Settings_Model::SCOPE_ROLE) {
				$roleRows[$row['scope_key']] = $row;
			} else {
				$personal[] = (int) $row['scope_key'];
			}
		}
		$users = self::users();
		$roles = array();
		foreach (self::roles() as $id => $role) {
			$role['users'] = 0;
			foreach ($users as $user) {
				if ($user['role'] === $id) {
					$role['users']++;
				}
			}
			$role['profile'] = isset($roleRows[$id]) ? self::scopeData($roleRows[$id], ModernUI_Settings_Model::SCOPE_ROLE) : null;
			$role['root'] = $id === self::ROOT_ROLE;
			$roles[] = $role;
		}
		// Profiles of roles that no longer exist stay visible, so they can be removed.
		foreach ($roleRows as $id => $row) {
			$known = false;
			foreach ($roles as $role) {
				$known = $known || $role['id'] === (string) $id;
			}
			if (!$known) {
				$roles[] = array('id' => (string) $id, 'name' => (string) $id, 'parent' => null, 'path' => array(), 'depth' => 0,
					'users' => 0, 'root' => false, 'missing' => true, 'profile' => self::scopeData($row, ModernUI_Settings_Model::SCOPE_ROLE));
			}
		}
		$global = self::scopeData(ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_GLOBAL, ''), ModernUI_Settings_Model::SCOPE_GLOBAL);
		$logo = isset($global['values']->{'branding.logo'}) ? $global['values']->{'branding.logo'} : 'company';
		$user = Users_Record_Model::getCurrentUserModel();
		return array(
			'v' => 1,
			'schema' => ModernUI_Schema_Model::VERSION,
			'module' => ModernUI_Lifecycle_Model::moduleVersion(),
			'me' => (int) $user->getId(),
			'defaults' => (object) $defaults,
			'scopes' => (object) $scopes,
			'userOverridable' => ModernUI_Settings_Model::userOverridableKeys(),
			'global' => $global,
			'roles' => $roles,
			'users' => array_values($users),
			'personal' => $personal,
			'catalog' => ModernUI_Menu_Model::catalog(),
			// Adapters of public extensions with the status on this CRM (adapters.disabled of the stored global document).
			'adapters' => ModernUI_Adapters_Model::catalog(ModernUI_Settings_Model::merge((array) $global['values'], array(), array())),
			'branding' => array(
				'companyName' => ModernUI_Branding_Model::companyName(),
				'logoUrl' => $logo === 'company' ? null : ModernUI_Branding_Model::logoUrl($logo),
			),
		);
	}

	/**
	 * Saves the whole document of the global scope or of a role profile.
	 * @param string $scope global | role
	 * @param string $roleId role of a role profile
	 * @param mixed $values flat map from the request
	 * @param int $baseRevision revision the draft is based on (0: the scope has no document yet)
	 * @param bool $inherit role profile applies to subordinate roles without a profile
	 * @param int $authorId
	 * @return array {ok: true, revision} or {ok: false, status, error: {code, params}}
	 */
	public static function saveScope($scope, $roleId, $values, $baseRevision, $inherit, $authorId) {
		if (!is_array($values) || ($values && ModernUI_Settings_Model::isList($values))) {
			return self::failure(400, 'MU_BAD_REQUEST');
		}
		$scopeKey = '';
		$meta = array();
		$current = null;
		if ($scope === ModernUI_Settings_Model::SCOPE_ROLE) {
			$roles = self::roles();
			if (!is_string($roleId) || !isset($roles[$roleId]) || $roleId === self::ROOT_ROLE) {
				return self::failure(400, 'MU_UNKNOWN_ROLE');
			}
			$scopeKey = $roleId;
			$meta = array('inherit' => (bool) $inherit);
		} elseif ($scope !== ModernUI_Settings_Model::SCOPE_GLOBAL) {
			return self::failure(400, 'MU_BAD_REQUEST');
		}
		$checked = ModernUI_Settings_Model::validate($scope, $values);
		$row = ModernUI_Settings_Model::getRow($scope, $scopeKey);
		$current = ModernUI_Settings_Model::decodeRow($row, $scope);
		if ($scope === ModernUI_Settings_Model::SCOPE_GLOBAL) {
			$meta = $current['meta'];
			$checked['errors'] = array_merge($checked['errors'], self::checkPilot($checked['values'], $current['values']));
		}
		if ($checked['errors']) {
			return self::failure(400, 'MU_INVALID_VALUE', array('errors' => array_slice($checked['errors'], 0, self::MAX_ERRORS)));
		}
		$saved = ModernUI_Settings_Model::save($scope, $scopeKey, $checked['values'], (int) $baseRevision, $authorId, $meta);
		ModernUI_Activation_Model::reset();
		if (!$saved['ok']) {
			return self::conflict($saved['conflict']);
		}
		if ($scope === ModernUI_Settings_Model::SCOPE_GLOBAL) {
			ModernUI_Branding_Model::cleanup(ModernUI_Branding_Model::filesInUse());
			if (isset($checked['values']['theme.mode']) && $checked['values']['theme.mode'] !== 'off') {
				ModernUI_Schema_Model::setMeta('notice', null);
			}
		}
		return array('ok' => true, 'revision' => $saved['revision']);
	}

	/**
	 * Pilot users and roles that are new in the document must exist (active users, roles of the CRM). Entries that
	 * were saved before stay accepted (a deleted user is listed by id until an administrator removes it).
	 * @param array $values validated new values
	 * @param array $before stored values
	 * @return array errors
	 */
	private static function checkPilot(array $values, array $before) {
		$errors = array();
		$oldUsers = isset($before['theme.pilot.users']) ? $before['theme.pilot.users'] : array();
		foreach (isset($values['theme.pilot.users']) ? $values['theme.pilot.users'] : array() as $index => $id) {
			if (!in_array($id, $oldUsers, true) && !ModernUI_Pilot_Model::isActiveUser($id)) {
				$errors[] = array('key' => 'theme.pilot.users', 'code' => 'MU_UNKNOWN_USER', 'path' => 'theme.pilot.users[' . $index . ']');
			}
		}
		$oldRoles = isset($before['theme.pilot.roles']) ? $before['theme.pilot.roles'] : array();
		foreach (isset($values['theme.pilot.roles']) ? $values['theme.pilot.roles'] : array() as $index => $id) {
			if (!in_array($id, $oldRoles, true) && (!ModernUI_Pilot_Model::roleExists($id) || $id === self::ROOT_ROLE)) {
				$errors[] = array('key' => 'theme.pilot.roles', 'code' => 'MU_UNKNOWN_ROLE', 'path' => 'theme.pilot.roles[' . $index . ']');
			}
		}
		return $errors;
	}

	/**
	 * Deletes a role profile (the role falls back to an inheriting ancestor or to the global settings).
	 * @param string $roleId
	 * @param int $baseRevision
	 * @return array {ok: true} or failure
	 */
	public static function deleteRole($roleId, $baseRevision) {
		if (!is_string($roleId) || !preg_match('/^[A-Za-z0-9_]{1,32}$/', $roleId)) {
			return self::failure(400, 'MU_UNKNOWN_ROLE');
		}
		$row = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_ROLE, $roleId);
		if (!$row) {
			return array('ok' => true);
		}
		$result = ModernUI_Db_Model::mustExecute('DELETE FROM ' . ModernUI_Settings_Model::TABLE . ' WHERE scope = ? AND scope_key = ? AND revision = ?',
			array(ModernUI_Settings_Model::SCOPE_ROLE, $roleId, (int) $baseRevision));
		ModernUI_Activation_Model::reset();
		if (ModernUI_Db_Model::affectedRows($result) !== 1) {
			$current = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_ROLE, $roleId);
			return self::conflict(array(
				'revision' => $current ? (int) $current['revision'] : 0,
				'updatedBy' => $current ? $current['updated_by'] : null,
				'updatedAt' => $current ? (string) $current['updated_at'] : null,
			));
		}
		return array('ok' => true);
	}

	/**
	 * Removes the personal settings of a user (an administrator may only reset them, docs/settings.md §1).
	 * @param mixed $userId
	 * @return array
	 */
	public static function resetUser($userId) {
		if (!is_numeric($userId) || (int) $userId <= 0) {
			return self::failure(400, 'MU_UNKNOWN_USER');
		}
		ModernUI_Settings_Model::reset(ModernUI_Settings_Model::SCOPE_USER, (string) (int) $userId);
		ModernUI_Activation_Model::reset();
		return array('ok' => true);
	}

	/**
	 * Menu of a draft built with the permissions of the current administrator (nothing is saved, nobody else is
	 * impersonated). Modules of the draft that this CRM does not have are listed.
	 * @param mixed $values flat map with navigation.* keys of the draft
	 * @param string $locale theme locale of the preview
	 * @return array {ok: true, menu, unknownModules} or failure
	 */
	public static function previewMenu($values, $locale) {
		if (!is_array($values) || ($values && ModernUI_Settings_Model::isList($values))) {
			return self::failure(400, 'MU_BAD_REQUEST');
		}
		$navigation = array();
		foreach ($values as $key => $value) {
			if (!in_array($key, array('navigation.groups', 'navigation.hidden', 'navigation.favoritesEnabled', 'navigation.compact'), true)) {
				return self::failure(400, 'MU_FORBIDDEN_KEY', array('errors' => array(array('key' => (string) $key, 'code' => 'MU_FORBIDDEN_KEY', 'path' => (string) $key))));
			}
			$navigation[$key] = $value;
		}
		$checked = ModernUI_Settings_Model::validate(ModernUI_Settings_Model::SCOPE_GLOBAL, $navigation);
		if ($checked['errors']) {
			return self::failure(400, 'MU_INVALID_VALUE', array('errors' => array_slice($checked['errors'], 0, self::MAX_ERRORS)));
		}
		if (!isset(ModernUI_Locale_Model::$supported[$locale])) {
			$locale = ModernUI_Locale_Model::FALLBACK;
		}
		$context = ModernUI_Activation_Model::context();
		$effective = array_merge(ModernUI_Settings_Model::defaults(), array('navigation.favorites' => $context['settings']['values']['navigation.favorites']), $checked['values']);
		$menu = ModernUI_Menu_Model::build($effective, $locale, true);
		$known = ModernUI_Menu_Model::candidates();
		$unknown = array();
		foreach (isset($checked['values']['navigation.groups']) ? $checked['values']['navigation.groups'] : array() as $group) {
			foreach ($group['items'] as $item) {
				$module = $item['type'] === 'module' ? $item['module'] : $item['route']['module'];
				if (!isset($known['list'][$module]) && !in_array($module, $unknown, true)) {
					$unknown[] = $module;
				}
			}
		}
		return array('ok' => true, 'menu' => $menu, 'unknownModules' => $unknown);
	}

	/**
	 * @param array $conflict {revision, updatedBy (id), updatedAt}
	 * @return array failure MU_CONFLICT with the current revision, its author and time
	 */
	public static function conflict(array $conflict) {
		return self::failure(409, 'MU_CONFLICT', array(
			'revision' => (int) $conflict['revision'],
			'updatedBy' => self::authorLabel($conflict['updatedBy']),
			'updatedAt' => $conflict['updatedAt'],
		));
	}

	/**
	 * @param int $status
	 * @param string $code
	 * @param array $params
	 * @return array
	 */
	public static function failure($status, $code, array $params = array()) {
		$error = array('code' => $code);
		if ($params) {
			$error['params'] = $params;
		}
		return array('ok' => false, 'status' => $status, 'error' => $error);
	}
}
