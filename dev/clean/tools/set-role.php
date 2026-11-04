<?php
/*
 * Moves a synthetic user of the clean stand to another role, as Settings → Users → Edit does it (Users record model:
 * the role and the privilege files of the user are rebuilt by the core). Used by the browser scenarios of stage 05
 * (a role change must apply to the theme at once, without stale caches):
 *
 *   dev/clean/clean.sh php <instance> /opt/mu-dev/clean/tools/set-role.php . <user name> <role name>
 *
 * Only for the clean stand; prints the old and the new role id.
 */
if (PHP_SAPI !== 'cli') {
	http_response_code(404);
	exit(1);
}
list(, $root, $userName, $roleName) = $argv + array('', '', '', '');
if ($root === '' || !is_file($root . '/config.inc.php') || $userName === '' || $roleName === '') {
	fwrite(STDERR, "usage: php set-role.php <CRM root> <user name> <role name>\n");
	exit(2);
}
chdir($root);
include_once 'config.php';
require_once 'vendor/autoload.php';
include_once 'vtlib/Vtiger/Module.php';
include_once 'includes/main/WebUI.php';

global $current_user, $adb;
$current_user = Users::getActiveAdminUser();
vglobal('current_user', $current_user);

$found = $adb->pquery('SELECT id FROM vtiger_users WHERE user_name = ? AND deleted = 0', array($userName));
$role = Settings_Roles_Record_Model::getInstanceByName($roleName);
if (!$adb->num_rows($found) || !$role) {
	fwrite(STDERR, "set-role: unknown user or role\n");
	exit(1);
}
$id = (int) $adb->query_result($found, 0, 'id');
$user = Users_Record_Model::getInstanceById($id, 'Users');
$before = (string) $user->get('roleid');
if ($before !== $role->getId()) {
	$user->set('mode', 'edit');
	$user->set('id', $id);
	$user->set('roleid', $role->getId());
	$user->save();
}
echo "set-role: {$userName} {$before} -> {$role->getId()}\n";
