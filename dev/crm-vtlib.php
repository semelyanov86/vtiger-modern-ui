<?php
/*
 * Registers ModernUI in the database of the dev instance with the same code the Module Manager runs
 * (task crm:install / crm:update / crm:uninstall). No SQL of its own: Vtiger_Package::import(),
 * Vtiger_Package::update() and Vtiger_Module::delete() of the instance do the work and fire the vtlib
 * lifecycle events of the module.
 *
 *   php dev/crm-vtlib.php <CRM root> import <zip>
 *   php dev/crm-vtlib.php <CRM root> update <zip>
 *   php dev/crm-vtlib.php <CRM root> remove [--purge]     (--purge: drop the ModernUI settings tables too)
 *   php dev/crm-vtlib.php <CRM root> toggle on|off        (enable/disable as the Module Manager does)
 *
 * The files of the ZIP are unpacked into the CRM like the Module Manager does; task crm:install moves them to
 * .local/crm-replaced/ afterwards and links src/ again (task crm:link -- --force).
 */
if (PHP_SAPI !== 'cli') {
	http_response_code(404);
	exit(1);
}

$root = isset($argv[1]) ? rtrim($argv[1], '/') : '';
$command = isset($argv[2]) ? $argv[2] : '';
$argument = isset($argv[3]) ? $argv[3] : '';
if ($root === '' || !is_file($root . '/config.inc.php') || !in_array($command, array('import', 'update', 'remove', 'toggle'), true)) {
	fwrite(STDERR, "usage: php dev/crm-vtlib.php <CRM root> import|update <zip> | remove [--purge] | toggle on|off\n");
	exit(2);
}
$zip = '';
if ($command === 'import' || $command === 'update') {
	$zip = realpath($argument);
	if ($zip === false || !is_file($zip)) {
		fwrite(STDERR, "crm-vtlib: no such ZIP: {$argument}\n");
		exit(2);
	}
}

chdir($root);
// Bootstrap of index.php of Vtiger 8.4.0: the logger needs the composer autoloader (vendor/ of the release).
include_once 'config.php';
if (is_file('vendor/autoload.php')) {
	require_once 'vendor/autoload.php';
}
// The same bootstrap as vtlib/tools/console.php of the instance.
include_once 'vtlib/Vtiger/Module.php';
include_once 'vtlib/Vtiger/Package.php';
include_once 'includes/main/WebUI.php';
include_once 'include/Webservices/Utils.php';

global $current_user, $adb;
// The Module Manager runs as an administrator; lifecycle code may rely on it.
$current_user = Users::getActiveAdminUser();
vglobal('current_user', $current_user);

$module = 'ModernUI';
$instance = Vtiger_Module::getInstance($module);

switch ($command) {
	case 'import':
		$package = new Vtiger_Package();
		$name = $package->getModuleNameFromZip($zip);
		if ($name !== $module) {
			fwrite(STDERR, "crm-vtlib: {$zip} is not a valid {$module} package (checkZip: " . var_export($name, true) . ")\n");
			exit(1);
		}
		if ($instance) {
			fwrite(STDERR, "crm-vtlib: {$module} is registered already (tabid {$instance->id}), use task crm:update\n");
			exit(1);
		}
		$package->import($zip);
		break;
	case 'update':
		if (!$instance) {
			fwrite(STDERR, "crm-vtlib: {$module} is not registered, use task crm:install\n");
			exit(1);
		}
		$package = new Vtiger_Package();
		$package->update($instance, $zip);
		break;
	case 'remove':
		if (!$instance) {
			fwrite(STDERR, "crm-vtlib: {$module} is not registered\n");
			exit(1);
		}
		if ($argument === '--purge') {
			require_once 'modules/ModernUI/models/Lifecycle.php';
			ModernUI_Lifecycle_Model::$purgeOnUninstall = true;
		}
		$instance->delete();
		break;
	case 'toggle':
		if (!$instance || !in_array($argument, array('on', 'off'), true)) {
			fwrite(STDERR, "crm-vtlib: toggle on|off needs a registered {$module}\n");
			exit(1);
		}
		vtlib_toggleModuleAccess($module, $argument === 'on');
		break;
}

Vtiger_Module::getInstance($module);
$after = $adb->pquery('SELECT tabid, presence, version FROM vtiger_tab WHERE name = ?', array($module));
if ($after && $adb->num_rows($after)) {
	$row = $adb->raw_query_result_rowdata($after, 0);
	echo "crm-vtlib: {$command} done — {$module} tabid {$row['tabid']}, presence {$row['presence']}, version {$row['version']}\n";
} else {
	echo "crm-vtlib: {$command} done — {$module} is not registered\n";
}
