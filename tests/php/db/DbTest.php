<?php
/*
 * ModernUI settings storage against a real MySQL (tests/php/db/run.sh starts a throwaway container):
 * migrations create the tables with the character set of the database and are idempotent, the lock prevents
 * parallel runs, optimistic locking of save(), reinstall over kept tables, removal of the data.
 * PearDatabase is replaced by a mysqli adapter with the emulated parameter binding of ADOdb (what Vtiger uses).
 *
 *   php tests/php/db/DbTest.php <host> <port> <database>
 */
list(, $host, $port, $database) = $argv + array('', '127.0.0.1', '3306', 'mu_test');
require __DIR__ . '/harness.php';
mu_connect($host, $port, $database);

require_once 'modules/ModernUI/models/Lifecycle.php';


$expectedCollation = q('SELECT @@collation_database AS c')[0]['c'];

// 1. Fresh install: tables, collation of the database, global document with the theme off.
$report = ModernUI_Schema_Model::migrate();
check($report['error'] === null && $report['applied'] === array(1) && $report['to'] === 1, 'first migration applies 0001: ' . json_encode($report));
$tables = q("SELECT table_name AS t, table_collation AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE 'vtiger_modernui_%' ORDER BY 1");
check(count($tables) === 2, 'two own tables');
foreach ($tables as $table) {
	check($table['c'] === $expectedCollation, "{$table['t']} uses the collation of the database ({$table['c']} = {$expectedCollation})");
}
$global = q("SELECT data, revision FROM vtiger_modernui_settings WHERE scope = 'global'");
check(count($global) === 1 && json_decode($global[0]['data'], true) === array('v' => 1, 'theme' => array('mode' => 'off')), 'global document: theme off');
check(ModernUI_Schema_Model::state(true) === 'current', 'schema is current');

// 2. Idempotent: running again changes nothing.
$again = ModernUI_Schema_Model::migrate();
check($again['error'] === null && $again['applied'] === array() && $again['from'] === 1, 'second run applies nothing: ' . json_encode($again));
check((int) q("SELECT COUNT(*) AS n FROM vtiger_modernui_settings")[0]['n'] === 1, 'no duplicate rows');

// 3. A second migration runner waits for the lock instead of running in parallel.
$other = new mysqli($host, 'root', 'test', $database, (int) $port);
$other->query("SELECT GET_LOCK('modernui_migrate', 0)");
$started = microtime(true);
$locked = ModernUI_Schema_Model::migrate();
check($locked['error'] === 'MU_MIGRATION_LOCKED' && microtime(true) - $started >= 9, 'a held lock stops the migration after the timeout');
$other->query("SELECT RELEASE_LOCK('modernui_migrate')");

// 4. Settings: save with the right revision, conflict with a stale one, Unicode stored as ASCII and read back.
$saved = ModernUI_Settings_Model::save('global', '', array('theme.mode' => 'pilot', 'theme.pilot.users' => array(1)), 1, 1);
check($saved === array('ok' => true, 'revision' => 2), 'save with the current revision: ' . json_encode($saved));
$stale = ModernUI_Settings_Model::save('global', '', array('theme.mode' => 'all'), 1, 7);
check($stale['ok'] === false && $stale['conflict']['revision'] === 2 && $stale['conflict']['updatedBy'] === 1, 'stale revision is a conflict: ' . json_encode($stale));
$role = ModernUI_Settings_Model::save('role', 'H5', array('theme.excludedScreens' => array(array('module' => 'Reports', 'view' => '*', 'parent' => ''))), 0, 1, array('inherit' => true, 'note' => 'Größe и ß'));
check($role['ok'] === true && $role['revision'] === 1, 'new role scope');
$raw = q("SELECT data FROM vtiger_modernui_settings WHERE scope = 'role'")[0]['data'];
check(preg_match('/^[\x20-\x7e]+$/', $raw) === 1, 'stored JSON is ASCII');
$decoded = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('role', 'H5'), 'role');
check($decoded['meta']['note'] === 'Größe и ß', 'Unicode survives the round trip');
$duplicate = ModernUI_Settings_Model::save('role', 'H5', array(), 0, 1);
check($duplicate['ok'] === false && $duplicate['revision'] === 1, 'inserting an existing scope is a conflict');
$updated = ModernUI_Settings_Model::update('user', '5', array('locale' => 'de-DE', 'user.standardView' => true), 5);
$updated = ModernUI_Settings_Model::update('user', '5', array('user.standardView' => null), 5);
$user = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('user', '5'), 'user');
check($updated['ok'] && $user['values'] === array('locale' => 'de-DE') && $user['revision'] === 2, 'update() merges keys, null removes one: ' . json_encode($user));
$context = ModernUI_Settings_Model::forUser(5, 'H7', array('H5', 'H2', 'H1'));
check($context['roleSource'] === 'H5' && count($context['values']['theme.excludedScreens']) === 1, 'role with inherit applies to subordinate roles');
ModernUI_Settings_Model::reset('user', '5');
check(ModernUI_Settings_Model::getRow('user', '5') === null, 'reset removes the personal scope');

// 4a. Damaged documents (stage 19): a broken global document means the defaults — the theme is off for everybody,
// the standard interface stays — and the administrator repairs it with a normal save on the current revision.
// Invalid values inside a readable document are dropped one by one; the valid ones keep working.
$globalRevision = (int) q("SELECT revision FROM vtiger_modernui_settings WHERE scope = 'global'")[0]['revision'];
q("UPDATE vtiger_modernui_settings SET data = '{\"v\":1,\"theme\":{\"mode\":' WHERE scope = 'global'");
$broken = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('global', ''), 'global');
check($broken['values'] === array() && $broken['errors'][0]['code'] === 'MU_INVALID_DOCUMENT' && $broken['revision'] === $globalRevision,
	'a broken global document reads as no values with MU_INVALID_DOCUMENT: ' . json_encode($broken));
$brokenUser = ModernUI_Settings_Model::forUser(5, 'H7', array('H5', 'H2', 'H1'));
check($brokenUser['values']['theme.mode'] === 'off', 'broken global document: the theme is off (defaults), nothing else breaks');
$repaired = ModernUI_Settings_Model::save('global', '', array('theme.mode' => 'pilot', 'theme.pilot.users' => array(1)), $globalRevision, 1);
check($repaired['ok'] === true && $repaired['revision'] === $globalRevision + 1, 'a normal save on the current revision repairs it: ' . json_encode($repaired));
q("UPDATE vtiger_modernui_settings SET data = '{\"v\":1,\"theme\":{\"mode\":\"pilot\",\"pilot\":{\"users\":[1]},\"customCss\":\"body{display:none}\"},"
	. "\"appearance\":{\"primaryColor\":\"javascript:alert(1)\",\"density\":\"compact\"},\"branding\":{\"logo\":\"../../config.inc.php\"}}' WHERE scope = 'global'");
$mixed = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('global', ''), 'global');
$mixedKeys = array_column($mixed['errors'], 'key');
sort($mixedKeys);
check($mixed['values'] === array('theme.mode' => 'pilot', 'theme.pilot.users' => array(1), 'appearance.density' => 'compact')
	&& $mixedKeys === array('appearance.primaryColor', 'branding.logo', 'theme.customCss'),
	'invalid stored values are dropped key by key, the valid ones stay: ' . json_encode($mixed));
foreach (array('5' => '[1,2,3]', '6' => 'null') as $brokenUserId => $brokenData) {
	q("INSERT INTO vtiger_modernui_settings (scope, scope_key, data, doc_version, revision, updated_by, updated_at) VALUES ('user', '{$brokenUserId}', '{$brokenData}', 1, 1, {$brokenUserId}, NOW())");
	$brokenPersonal = ModernUI_Settings_Model::forUser((int) $brokenUserId, 'H7', array('H5', 'H2', 'H1'));
	check($brokenPersonal['values']['theme.mode'] === 'pilot' && $brokenPersonal['values']['appearance.density'] === 'compact',
		"a broken personal document ({$brokenData}) falls back to the global values: " . json_encode($brokenPersonal['errors']));
	ModernUI_Settings_Model::reset('user', $brokenUserId);
}
$restore = ModernUI_Settings_Model::save('global', '', array('theme.mode' => 'pilot', 'theme.pilot.users' => array(1)), $mixed['revision'], 1);
check($restore['ok'] === true, 'the damaged global document is replaced by a valid one');

// Core tables the lifecycle reads or changes (minimal columns of Vtiger 8.4).
q("CREATE TABLE vtiger_tab (tabid INT PRIMARY KEY, name VARCHAR(25), version VARCHAR(10))");
q("INSERT INTO vtiger_tab VALUES (99, 'ModernUI', '0.1.0')");
q("CREATE TABLE vtiger_settings_field (fieldid INT PRIMARY KEY, name VARCHAR(250), linkto TEXT)");
q("INSERT INTO vtiger_settings_field VALUES (1, 'LBL_USERS', 'index.php?module=Users&parent=Settings&view=List')");
q("CREATE TABLE vtiger_links (linkid INT PRIMARY KEY, tabid INT, linktype VARCHAR(50), linklabel VARCHAR(50), linkurl VARCHAR(255), handler_path VARCHAR(128), handler_class VARCHAR(50), handler VARCHAR(50))");

// 5. Reinstall over the kept tables: settings stay, the theme is switched off, the administrator is told.
ModernUI_Lifecycle_Model::install();
$after = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('global', ''), 'global');
check($after['values']['theme.mode'] === 'off' && $after['values']['theme.pilot.users'] === array(1), 'reinstall: pilot kept, theme off');
check(ModernUI_Schema_Model::getMeta('notice') === 'MU_REINSTALLED_THEME_OFF', 'reinstall notice');
check(ModernUI_Schema_Model::getMeta('installed_version') === '0.1.0', 'installed version from vtiger_tab');
// Three global links (skin, tokens, loader): each is deleted and added again.
check(count(MU_Fake::$links) === 6 && count(MU_Fake::$settingsLinks) === 1, 'reinstall: links and the settings item are created again');

// 6. A schema newer than the code is never migrated down.
ModernUI_Schema_Model::setMeta('schema_version', '9');
$newer = ModernUI_Schema_Model::migrate();
check($newer['error'] === 'MU_SCHEMA_NEWER' && ModernUI_Schema_Model::state(true) === 'newer', 'newer schema is reported');
ModernUI_Schema_Model::setMeta('schema_version', '1');

// 7. Uninstall with data removal drops only the own tables.
q("CREATE TABLE IF NOT EXISTS vtiger_other (id INT)");
ModernUI_Lifecycle_Model::uninstall(true);
$left = q("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY 1");
check(array_column($left, 't') === array('vtiger_links', 'vtiger_other', 'vtiger_settings_field', 'vtiger_tab'), 'only vtiger_modernui_* tables are dropped: ' . json_encode($left));
check((int) q("SELECT COUNT(*) AS n FROM vtiger_settings_field")[0]['n'] === 1, 'settings items of other modules stay');
check(ModernUI_Schema_Model::state(true) === 'missing', 'schema missing after the removal');

printf("db %s (%s): %d check(s), %d failed\n", $database, $expectedCollation, $GLOBALS['mu_count'], $GLOBALS['mu_failures']);
exit($GLOBALS['mu_failures'] > 0 ? 1 : 0);
