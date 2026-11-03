<?php
/*
 * Read-only check of the theme decision for one user of the dev instance: which ModernUI links the core would
 * print on a full page for that user (the same Vtiger_Link_Model::getAllByType() call as the Header view, with
 * the link handler of the module). Prints no personal data, writes nothing.
 *
 *   php dev/crm-links-for.php <CRM root> <user id> [module [view]]
 */
if (PHP_SAPI !== 'cli') {
	http_response_code(404);
	exit(1);
}
$root = isset($argv[1]) ? rtrim($argv[1], '/') : '';
$userId = isset($argv[2]) ? (int) $argv[2] : 0;
if ($root === '' || !is_file($root . '/config.inc.php') || $userId <= 0) {
	fwrite(STDERR, "usage: php dev/crm-links-for.php <CRM root> <user id> [module [view]]\n");
	exit(2);
}
chdir($root);
// Bootstrap of index.php of Vtiger 8.4.0: the logger needs the composer autoloader (vendor/ of the release).
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
$_REQUEST = array('module' => isset($argv[3]) ? $argv[3] : 'Home', 'view' => isset($argv[4]) ? $argv[4] : 'DashBoard');

$links = Vtiger_Link_Model::getAllByType(Vtiger_Link::IGNORE_MODULE, array('HEADERSCRIPT', 'HEADERCSS'));
$found = array();
foreach ($links as $type => $list) {
	foreach ($list as $link) {
		if (strpos($link->linkurl, 'modules/ModernUI/') !== false) {
			$found[] = "{$type} {$link->linkurl}";
		}
	}
}
require_once 'modules/ModernUI/models/Activation.php';
ModernUI_Activation_Model::reset();
$decision = ModernUI_Activation_Model::evaluate($_REQUEST);
printf("user %d (%s): theme %s (%s)\n", $userId, $user->is_admin === 'on' ? 'admin' : 'not admin',
	$decision['active'] ? 'active' : 'inactive', $decision['reason']);
echo $found ? '  ' . implode("\n  ", $found) . "\n" : "  no ModernUI links on the page\n";
