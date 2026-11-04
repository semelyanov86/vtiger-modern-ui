<?php
/*
 * Read-only check of the settings and the menu of ModernUI for one user of the dev instance, without signing in as
 * that user: the role and its source of role settings, the effective appearance, and the menu the server builds from
 * the permissions of the user (ModernUI_Menu_Model, the same code as action=Bootstrap). Every module of the menu is
 * checked against the permissions of Vtiger for that user (isAdminUser() || hasGlobalReadPermission() ||
 * hasModulePermission()). Prints module names and counts only, no personal data; writes nothing.
 *
 *   php dev/crm-menu-for.php <CRM root> <user id> [locale]
 */
if (PHP_SAPI !== 'cli') {
	http_response_code(404);
	exit(1);
}
$root = isset($argv[1]) ? rtrim($argv[1], '/') : '';
$userId = isset($argv[2]) ? (int) $argv[2] : 0;
$locale = isset($argv[3]) ? $argv[3] : 'en-US';
if ($root === '' || !is_file($root . '/config.inc.php') || $userId <= 0) {
	fwrite(STDERR, "usage: php dev/crm-menu-for.php <CRM root> <user id> [locale]\n");
	exit(2);
}
chdir($root);
include_once 'config.php';
if (is_file('vendor/autoload.php')) {
	require_once 'vendor/autoload.php';
}
include_once 'includes/main/WebUI.php';

$user = new Users();
$user->retrieveCurrentUserInfoFromFile($userId);
global $current_user;
$current_user = $user;
vglobal('current_user', $user);

require_once 'modules/ModernUI/models/Activation.php';
require_once 'modules/ModernUI/models/Menu.php';
require_once 'modules/ModernUI/models/Tokens.php';
$model = Users_Record_Model::getCurrentUserModel();
$context = ModernUI_Activation_Model::context($model);
$values = $context['settings']['values'];
$menu = ModernUI_Menu_Model::build($values, $locale, (bool) $context['isAdmin']);

$privileges = Users_Privileges_Model::getCurrentUserPrivilegesModel();
$modules = array();
$refused = array();
foreach ($menu['groups'] as $group) {
	foreach ($group['items'] as $item) {
		$modules[$item['module']] = true;
		$name = $item['module'] === 'Home' ? 'Dashboard' : $item['module'];
		$tabId = getTabid($name);
		if (!($privileges->isAdminUser() || $privileges->hasGlobalReadPermission() || ($tabId && $privileges->hasModulePermission($tabId)))) {
			$refused[] = $item['module'];
		}
	}
}
$appearance = ModernUI_Tokens_Model::appearanceOf($values);
printf("user %d (%s), role %s, role settings from %s\n", $userId, $context['isAdmin'] ? 'admin' : 'not admin', $context['roleId'],
	$context['settings']['roleSource'] === null ? 'common settings' : $context['settings']['roleSource']);
printf("  appearance: %s %s %s%%; cache key %s\n", $appearance['primaryColor'], $appearance['density'], $appearance['fontScale'], $context['cacheKey']);
printf("  menu: %d group(s), %d module(s), favorites %d\n", count($menu['groups']), count($modules), count($menu['favorites']));
foreach ($menu['groups'] as $group) {
	printf("    %s: %s\n", $group['id'], implode(', ', array_map(function ($item) {
		return $item['module'];
	}, $group['items'])));
}
echo $refused ? '  NOT PERMITTED IN THE MENU: ' . implode(', ', $refused) . "\n" : "  every module of the menu is permitted to the user\n";
exit($refused ? 1 : 0);
