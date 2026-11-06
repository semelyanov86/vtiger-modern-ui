<?php
/*
 * Removes the test entity module of stage 08 (tests/fixtures/gizmos) from a clean instance the way an administrator of
 * Vtiger 8.4.0 does it — the Module Manager of 8.4.0 has no uninstall: Vtiger_Module::delete() of the core (what
 * vtlib/tools/console.php --remove does: tab, fields, links, profiles, entity data of the module) and then the files of
 * the module. Used by the browser scenarios of stage 08 (frontend/e2e/extensions.spec.ts):
 *
 *   dev/clean/clean.sh php <instance> /opt/mu-dev/clean/tools/remove-module.php . Gizmos
 *
 * Only for the clean stand and only for the fixture modules; prints what it removed.
 */
if (PHP_SAPI !== 'cli') {
	http_response_code(404);
	exit(1);
}
list(, $root, $name) = $argv + array('', '', '');
$fixtures = array('Gizmos');
if ($root === '' || !is_file($root . '/config.inc.php') || !in_array($name, $fixtures, true)) {
	fwrite(STDERR, "usage: php remove-module.php <CRM root> <" . implode('|', $fixtures) . ">\n");
	exit(2);
}
chdir($root);
include_once 'config.php';
require_once 'vendor/autoload.php';
include_once 'vtlib/Vtiger/Module.php';
include_once 'includes/main/WebUI.php';

global $current_user;
$current_user = Users::getActiveAdminUser();
vglobal('current_user', $current_user);

$module = Vtiger_Module::getInstance($name);
if ($module) {
	$module->delete();
	echo "remove-module: {$name} deleted (Vtiger_Module::delete)\n";
} else {
	echo "remove-module: {$name} is not registered\n";
}

$paths = array('modules/' . $name, 'layouts/v7/modules/' . $name);
foreach (glob('languages/*/' . $name . '.php') as $file) {
	$paths[] = $file;
}
foreach ($paths as $path) {
	if (is_dir($path)) {
		$items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
		foreach ($items as $item) {
			$item->isDir() ? rmdir($item->getPathname()) : unlink($item->getPathname());
		}
		rmdir($path);
		echo "remove-module: removed {$path}\n";
	} elseif (is_file($path)) {
		unlink($path);
		echo "remove-module: removed {$path}\n";
	}
}
