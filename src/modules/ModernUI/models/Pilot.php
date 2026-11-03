<?php
/*
 * Users and roles of the pilot for Settings → ModernUI (docs/settings.md §3): who may be added, labels of the
 * listed entries. Read-only queries of the CRM's own tables; the lists themselves live in the settings
 * (theme.pilot.users, theme.pilot.roles).
 */

require_once 'modules/ModernUI/models/Db.php';

class ModernUI_Pilot_Model {

	/**
	 * @param int $userId
	 * @return bool an active, not deleted user of the CRM
	 */
	public static function isActiveUser($userId) {
		return ModernUI_Db_Model::value("SELECT id FROM vtiger_users WHERE id = ? AND status = 'Active' AND deleted = 0",
			array((int) $userId)) !== null;
	}

	/**
	 * @param string $roleId
	 * @return bool
	 */
	public static function roleExists($roleId) {
		return is_string($roleId) && preg_match('/^[A-Za-z0-9_]{1,32}$/', $roleId) === 1
			&& ModernUI_Db_Model::value('SELECT roleid FROM vtiger_role WHERE roleid = ?', array($roleId)) !== null;
	}

	/**
	 * Entries of the pilot and the choices for adding.
	 * @param array $userIds theme.pilot.users
	 * @param array $roleIds theme.pilot.roles
	 * @return array {users: [{id, label}], roles: [{id, label}], userOptions: [{id, label}], roleOptions: [{id, label}]}
	 */
	public static function overview(array $userIds, array $roleIds) {
		$users = array();
		foreach (ModernUI_Db_Model::rows('SELECT id, user_name, first_name, last_name, status, deleted FROM vtiger_users ORDER BY user_name') as $row) {
			$users[(int) $row['id']] = $row;
		}
		$roles = array();
		foreach (ModernUI_Db_Model::rows('SELECT roleid, rolename FROM vtiger_role ORDER BY parentrole') as $row) {
			$roles[$row['roleid']] = $row;
		}

		$overview = array('users' => array(), 'roles' => array(), 'userOptions' => array(), 'roleOptions' => array());
		foreach ($userIds as $id) {
			// A deleted user stays listed by id, so it can be removed.
			$overview['users'][] = array('id' => (int) $id, 'label' => isset($users[$id]) ? self::userLabel($users[$id]) : '#' . (int) $id);
		}
		foreach ($users as $id => $row) {
			if ($row['status'] === 'Active' && (int) $row['deleted'] === 0 && !in_array($id, $userIds, true)) {
				$overview['userOptions'][] = array('id' => $id, 'label' => self::userLabel($row));
			}
		}
		foreach ($roleIds as $id) {
			$overview['roles'][] = array('id' => $id, 'label' => isset($roles[$id]) ? $roles[$id]['rolename'] : $id);
		}
		foreach ($roles as $id => $row) {
			// H1 is the root of the hierarchy ("Organization"), not a role users have.
			if ($id !== 'H1' && !in_array($id, $roleIds, true)) {
				$overview['roleOptions'][] = array('id' => $id, 'label' => $row['rolename']);
			}
		}
		return $overview;
	}

	/**
	 * @param array $row vtiger_users row
	 * @return string "First Last (user_name)"
	 */
	private static function userLabel(array $row) {
		$name = trim($row['first_name'] . ' ' . $row['last_name']);
		return $name === '' ? $row['user_name'] : "{$name} ({$row['user_name']})";
	}
}
