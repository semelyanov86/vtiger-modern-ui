<?php
/*
 * Moving the theme settings between two CRMs on a real MySQL (tests/php/db/run.sh): CRM "A" (utf8mb4) exports, CRM
 * "B" (utf8, other role and user ids, another name of the root role) analyses and imports. Checks that the file has no
 * numeric ids, no logo and no personal switches; that roles and users are matched by names, unknown ones reported and
 * skipped; that the mode of the theme and the logo of B stay; that a change between preview and apply writes nothing;
 * that invalid files are refused with a code. Also the editor saves: role checks, pilot checks, conflicts.
 *
 *   php tests/php/db/TransferTest.php <host> <port> <database A> <database B>
 */
list(, $host, $port, $databaseA, $databaseB) = $argv + array('', '127.0.0.1', '3306', 'mu_xfer_a', 'mu_xfer_b');
require __DIR__ . '/harness.php';
require_once 'modules/ModernUI/models/Transfer.php';

/** Core tables the editor and the transfer read (minimal columns of Vtiger 8.4). */
function mu_core(array $roles, array $users) {
	q("CREATE TABLE vtiger_tab (tabid INT PRIMARY KEY, name VARCHAR(25), version VARCHAR(10))");
	q("INSERT INTO vtiger_tab VALUES (99, 'ModernUI', '0.3.0')");
	q("CREATE TABLE vtiger_role (roleid VARCHAR(255) PRIMARY KEY, rolename VARCHAR(200), parentrole VARCHAR(255), depth INT)");
	q("CREATE TABLE vtiger_users (id INT PRIMARY KEY, user_name VARCHAR(255), first_name VARCHAR(30), last_name VARCHAR(30), status VARCHAR(25), is_admin VARCHAR(3), deleted INT)");
	q("CREATE TABLE vtiger_user2role (userid INT PRIMARY KEY, roleid VARCHAR(255))");
	foreach ($roles as $role) {
		$link = PearDatabase::$connection;
		q(sprintf("INSERT INTO vtiger_role VALUES ('%s', '%s', '%s', %d)", $role[0], $link->real_escape_string($role[1]), $role[2], substr_count($role[2], '::')));
	}
	foreach ($users as $user) {
		q(sprintf("INSERT INTO vtiger_users VALUES (%d, '%s', 'First', 'Last', 'Active', '%s', %d)", $user[0], $user[1], $user[3] ? 'on' : 'off', $user[4]));
		q(sprintf("INSERT INTO vtiger_user2role VALUES (%d, '%s')", $user[0], $user[2]));
	}
	ModernUI_Schema_Model::forgetCache();
	$report = ModernUI_Schema_Model::migrate();
	check($report['error'] === null, 'migrations: ' . json_encode($report));
}

/** Switches the models to one of the two CRMs. */
function mu_use($link, array $modules, $adminId) {
	PearDatabase::$connection = $link;
	ModernUI_Schema_Model::forgetCache();
	ModernUI_Transfer_Model::reset();
	ModernUI_Activation_Model::reset();
	$list = array();
	foreach ($modules as $name => $apps) {
		$list[$name] = array('module' => $name, 'label' => $name, 'apps' => $apps, 'icon' => array('kind' => 'vicon', 'name' => 'vicon-x'),
			'url' => 'index.php?module=' . $name . '&view=List', 'defaultHidden' => false);
	}
	ModernUI_Menu_Model::prime(array('list' => $list, 'appOrder' => array()));
	Users_Record_Model::$current = new Users_Record_Model(array('id' => $adminId, 'is_admin' => 'on', 'roleid' => 'H2', 'language' => 'en_us'));
}

$a = mu_connect($host, $port, $databaseA);
mu_core(
	array(array('H1', 'Organisation', 'H1'), array('H2', 'CEO', 'H1::H2'), array('H3', 'Vice President', 'H1::H2::H3'),
		array('H5', 'Sales Manager', 'H1::H2::H3::H5')),
	array(array(1, 'admin', 'H2', true, 0), array(5, 'anna', 'H5', false, 0), array(6, 'boris', 'H3', false, 0), array(7, 'gone', 'H5', false, 1))
);
$b = mu_connect($host, $port, $databaseB);
mu_core(
	array(array('H1', 'Organization', 'H1'), array('H2', 'CEO', 'H1::H2'), array('H4', 'vice president', 'H1::H2::H4'),
		array('H9', 'Sales Manager', 'H1::H2::H4::H9'), array('H10', 'Support', 'H1::H2::H10')),
	array(array(1, 'admin', 'H2', true, 0), array(12, 'Anna', 'H9', false, 0))
);

$modulesA = array('Leads' => array('MARKETING'), 'Contacts' => array('SALES'), 'Gadgets' => array());
$modulesB = array('Leads' => array('MARKETING'), 'Contacts' => array('SALES'));
$menu = array(
	array('id' => 'work', 'label' => array('ru-RU' => 'Работа', 'en-US' => 'Work', 'de-DE' => 'Größenänderungsübersicht'), 'icon' => 'briefcase',
		'items' => array(
			array('type' => 'module', 'module' => 'Contacts', 'label' => array('de-DE' => 'Ansprechpartner')),
			array('type' => 'module', 'module' => 'Gadgets'),
			array('type' => 'route', 'id' => 'my_leads', 'label' => array('ru-RU' => 'Мои обращения', 'en-US' => 'My leads'),
				'route' => array('module' => 'Leads', 'view' => 'List', 'params' => array('viewname' => '42'))),
		)),
);

// CRM A: settings of every scope.
mu_use($a, $modulesA, 1);
$saved = ModernUI_Editor_Model::saveScope('global', '', array(
	'theme.mode' => 'pilot', 'theme.pilot.users' => array(5, 6), 'theme.pilot.roles' => array('H5'),
	'appearance.primaryColor' => '#123456', 'branding.title' => array('de-DE' => 'Fußgänger GmbH', 'ru-RU' => 'Окна'),
	'navigation.groups' => $menu, 'navigation.hidden' => array('Leads'), 'branding.logo' => 'modernui_' . str_repeat('a', 40) . '.png',
), 1, false, 1);
check($saved['ok'] === true && $saved['revision'] === 2, 'A: global saved: ' . json_encode($saved));
check(ModernUI_Editor_Model::saveScope('role', 'H5', array('appearance.density' => 'compact', 'navigation.hidden' => array('Contacts')), 0, true, 1)['ok'] === true, 'A: role profile');
ModernUI_Settings_Model::save('user', '5', array('locale' => 'de-DE', 'appearance.density' => 'comfortable', 'user.standardView' => true), 0, 5);
ModernUI_Settings_Model::save('user', '6', array('navigation.favorites' => array('Contacts')), 0, 6);

// Editor checks of CRM A.
$root = ModernUI_Editor_Model::saveScope('role', 'H1', array(), 0, false, 1);
check($root['ok'] === false && $root['error']['code'] === 'MU_UNKNOWN_ROLE', 'no profile for the root role');
$unknownUser = ModernUI_Editor_Model::saveScope('global', '', array('theme.pilot.users' => array(5, 6, 7)), 2, false, 1);
check($unknownUser['ok'] === false && $unknownUser['error']['params']['errors'][0]['path'] === 'theme.pilot.users[2]', 'a deleted user cannot join the pilot: ' . json_encode($unknownUser));
$stale = ModernUI_Editor_Model::saveScope('global', '', array('theme.mode' => 'all'), 1, false, 6);
check($stale['ok'] === false && $stale['status'] === 409 && $stale['error']['params']['revision'] === 2
	&& $stale['error']['params']['updatedBy'] === 'First Last (admin)', 'second session: conflict with author and revision: ' . json_encode($stale));
$deleteStale = ModernUI_Editor_Model::deleteRole('H5', 7);
check($deleteStale['ok'] === false && $deleteStale['error']['code'] === 'MU_CONFLICT', 'deleting a changed role profile is a conflict');

$file = ModernUI_Transfer_Model::export(array('global', 'roles', 'users'));
$json = json_encode($file, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
check($file['format'] === 'modernui.settings' && $file['formatVersion'] === 1, 'format and version');
check(!isset($file['global']['branding']['logo']) && $file['omitted'] === array('branding.logo'), 'no logo in the file');
check($file['global']['theme']['pilot']['users'] === array(array('userName' => 'anna'), array('userName' => 'boris')), 'pilot users by user name: ' . json_encode($file['global']['theme']['pilot']));
check($file['global']['theme']['pilot']['roles'] === array(array('path' => array('Organisation', 'CEO', 'Vice President', 'Sales Manager'))), 'pilot roles by path');
check($file['roles'][0]['role'] === array('path' => array('Organisation', 'CEO', 'Vice President', 'Sales Manager')) && $file['roles'][0]['inherit'] === true, 'role profile by path');
check(count($file['users']) === 2 && !isset($file['users'][0]['settings']['user']), 'personal settings without the personal switches');
check(strpos($json, '"H5"') === false && strpos($json, 'First') === false && strpos($json, '"5"') === false, 'no role ids, names or user ids in the file');
check(strpos($json, 'Größenänderungsübersicht') !== false && strpos($json, 'Мои обращения') !== false, 'labels in every language');

// CRM B: its own settings before the import.
mu_use($b, $modulesB, 1);
ModernUI_Settings_Model::save('global', '', array('theme.mode' => 'off', 'appearance.background' => '#f5f5f5',
	'branding.logo' => 'modernui_' . str_repeat('b', 40) . '.png'), 1, 1);
ModernUI_Settings_Model::save('user', '12', array('user.selfEnabled' => true, 'locale' => 'ru-RU'), 0, 12);

$analysis = ModernUI_Transfer_Model::analyze($json);
check($analysis['ok'] === true, 'B: analysis: ' . json_encode(isset($analysis['error']) ? $analysis['error'] : null));
$report = $analysis['report'];
check($report['global']['unresolvedUsers'] === array('boris'), 'unknown user reported: ' . json_encode($report['global']));
check($report['global']['unresolvedRoles'] === array(), 'role path matched below the differently named root, case-insensitively');
check($report['global']['modeChange'] === array('before' => 'off', 'after' => 'pilot'), 'mode change reported separately');
check($report['uploadLogo'] === true && $report['unknownModules'] === array('Gadgets'), 'logo and unknown module reported: ' . json_encode($report['unknownModules']));
check(count($report['checkFilters']) === 1 && $report['checkFilters'][0]['id'] === 'my_leads', 'route with a filter id reported');
check($report['roles']['matched'][0]['id'] === 'H9' && $report['roles']['matched'][0]['exists'] === false, 'role profile goes to H9 of B');
check($report['users']['matched'] === 1 && $report['users']['unresolved'] === array('boris'), 'users matched by name: ' . json_encode($report['users']));
$keys = array_column($report['global']['changes'], 'key');
check(in_array('appearance.primaryColor', $keys, true) && in_array('appearance.background', $keys, true) && !in_array('theme.mode', $keys, true), 'changes of the global scope: ' . json_encode($keys));

// A change between the preview and the apply: nothing is written.
ModernUI_Settings_Model::save('user', '12', array('user.selfEnabled' => true, 'locale' => 'en-US'), 1, 12);
$late = ModernUI_Transfer_Model::apply($json, array('global', 'roles', 'users'), false, $analysis['fingerprint'], 1);
check($late['ok'] === false && $late['error']['code'] === 'MU_CONFLICT', 'stale preview is refused');
check(ModernUI_Settings_Model::getRow('role', 'H9') === null, 'nothing written after the refusal');

$fresh = ModernUI_Transfer_Model::analyze($json);
$applied = ModernUI_Transfer_Model::apply($json, array('global', 'roles', 'users'), false, $fresh['fingerprint'], 1);
check($applied === array('ok' => true, 'applied' => array('global' => true, 'roles' => 1, 'users' => 1)), 'applied: ' . json_encode($applied));
$global = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('global', ''), 'global')['values'];
check($global['theme.mode'] === 'off', 'mode of B kept without the explicit option');
check($global['branding.logo'] === 'modernui_' . str_repeat('b', 40) . '.png', 'logo of B kept');
check($global['theme.pilot.users'] === array(12) && $global['theme.pilot.roles'] === array('H9'), 'pilot mapped to the ids of B');
check($global['appearance.primaryColor'] === '#123456' && !isset($global['appearance.background']), 'the global document of the file replaces the one of B');
check($global['navigation.groups'][0]['label'] === array('ru-RU' => 'Работа', 'en-US' => 'Work', 'de-DE' => 'Größenänderungsübersicht'), 'labels kept exactly');
check($global['navigation.groups'][0]['items'][1]['module'] === 'Gadgets', 'unknown module kept in the configuration');
$role = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('role', 'H9'), 'role');
check($role['values']['appearance.density'] === 'compact' && $role['meta']['inherit'] === true, 'role profile with inherit');
$anna = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('user', '12'), 'user')['values'];
check($anna['locale'] === 'de-DE' && $anna['appearance.density'] === 'comfortable' && $anna['user.selfEnabled'] === true && !isset($anna['user.standardView']),
	'personal settings of Anna, her own switch kept: ' . json_encode($anna));

// With the mode on request.
$again = ModernUI_Transfer_Model::analyze($json);
ModernUI_Transfer_Model::apply($json, array('global'), true, $again['fingerprint'], 1);
check(ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('global', ''), 'global')['values']['theme.mode'] === 'pilot', 'mode applied when asked');

// Invalid files.
$codes = array(
	'not json' => '{"format":',
	'list' => '[1,2]',
	'foreign' => json_encode(array('format' => 'other', 'formatVersion' => 1)),
	'newer' => json_encode(array('format' => 'modernui.settings', 'formatVersion' => 2)),
	'unknown key' => json_encode(array('format' => 'modernui.settings', 'formatVersion' => 1, 'script' => 'x')),
	'bad global' => json_encode(array('format' => 'modernui.settings', 'formatVersion' => 1, 'global' => array('theme' => array()))),
	'large' => json_encode(array('format' => 'modernui.settings', 'formatVersion' => 1, 'x' => str_repeat('a', 262144))),
);
$expected = array('not json' => 'MU_IMPORT_FORMAT', 'list' => 'MU_IMPORT_FORMAT', 'foreign' => 'MU_IMPORT_FORMAT', 'newer' => 'MU_IMPORT_VERSION',
	'unknown key' => 'MU_IMPORT_FORMAT', 'bad global' => 'MU_IMPORT_FORMAT', 'large' => 'MU_IMPORT_TOO_LARGE');
foreach ($codes as $name => $content) {
	$result = ModernUI_Transfer_Model::analyze($content);
	check($result['ok'] === false && $result['error']['code'] === $expected[$name], "invalid file ({$name}): " . json_encode($result));
}
$dirty = json_encode(array('format' => 'modernui.settings', 'formatVersion' => 1, 'global' => array('v' => 1,
	'appearance' => array('primaryColor' => '#ffffff', 'density' => 'compact'), 'evil' => array('script' => '<script>'))));
$partial = ModernUI_Transfer_Model::analyze($dirty);
$paths = array_column($partial['report']['invalid'], 'path');
check($partial['ok'] === true && in_array('appearance.primaryColor', $paths, true) && in_array('evil.script', $paths, true)
	&& $partial['plan']['global'] === array('appearance.density' => 'compact'), 'invalid values are reported with their path and dropped: ' . json_encode($partial['report']['invalid']));

printf("transfer %s → %s: %d check(s), %d failed\n", $databaseA, $databaseB, $GLOBALS['mu_count'], $GLOBALS['mu_failures']);
exit($GLOBALS['mu_failures'] > 0 ? 1 : 0);
