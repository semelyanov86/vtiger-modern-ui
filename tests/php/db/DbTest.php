<?php
/*
 * ModernUI settings storage against a real MySQL (tests/php/db/run.sh starts a throwaway container):
 * migrations create the tables with the character set of the database and are idempotent, the lock prevents
 * parallel runs, optimistic locking of save(), reinstall over kept tables, removal of the data.
 * PearDatabase is replaced by a mysqli adapter with the emulated parameter binding of ADOdb (what Vtiger uses).
 *
 *   php tests/php/db/DbTest.php <host> <port> <database>
 */
error_reporting(E_ALL);
set_error_handler(function ($severity, $message, $file, $line) {
	throw new ErrorException($message, 0, $severity, $file, $line);
});
list(, $host, $port, $database) = $argv + array('', '127.0.0.1', '3306', 'mu_test');

define('MU_REPO', dirname(__DIR__, 3));
chdir(MU_REPO . '/src');
set_include_path(MU_REPO . '/tests/php/stubs' . PATH_SEPARATOR . get_include_path());
mysqli_report(MYSQLI_REPORT_OFF);

class MU_Fake {
	public static $links = array();
	public static $settingsLinks = array();
}

class MU_DbResult {
	public $rows;

	public function __construct(array $rows) {
		$this->rows = $rows;
	}
}

/** PearDatabase over mysqli; "?" are replaced like ADOdb does without native binding. */
class PearDatabase {
	public $dieOnError = false;
	public $database;
	public static $connection;
	private static $instance = null;
	private $affected = 0;

	public static function getInstance() {
		if (self::$instance === null) {
			self::$instance = new PearDatabase();
			self::$instance->database = new MU_DbErrors();
		}
		return self::$instance;
	}

	public function pquery($sql, $params = array()) {
		$link = self::$connection;
		$parts = explode('?', $sql);
		$built = array_shift($parts);
		foreach ($parts as $index => $part) {
			$value = $params[$index];
			if ($value === null) {
				$built .= 'NULL';
			} elseif (is_int($value) || is_float($value)) {
				$built .= $value;
			} elseif (is_bool($value)) {
				$built .= $value ? '1' : '0';
			} else {
				$built .= "'" . $link->real_escape_string((string) $value) . "'";
			}
			$built .= $part;
		}
		$result = $link->query($built);
		if ($result === false) {
			return false;
		}
		$this->affected = $link->affected_rows;
		return new MU_DbResult($result === true ? array() : $result->fetch_all(MYSQLI_ASSOC));
	}

	public function num_rows($result) {
		return count($result->rows);
	}

	public function raw_query_result_rowdata($result, $row = 0) {
		return isset($result->rows[$row]) ? $result->rows[$row] : null;
	}

	public function getAffectedRowCount($result) {
		return $this->affected;
	}
}

class MU_DbErrors {
	public function ErrorMsg() {
		return PearDatabase::$connection->error;
	}
}

class Users_Record_Model {
	public static function getCurrentUserModel() {
		return null;
	}
}

function vtlib_isModuleActive($module) {
	return true;
}

function vglobal($name) {
	return $name === 'vtiger_current_version' ? '8.4.0' : null;
}

function vtlib_addSettingsLink($name, $url, $block) {
	MU_Fake::$settingsLinks[] = array($name, $url, $block);
	return true;
}

PearDatabase::$connection = new mysqli($host, 'root', 'test', $database, (int) $port);
if (PearDatabase::$connection->connect_errno) {
	fwrite(STDERR, "db: cannot connect: " . PearDatabase::$connection->connect_error . "\n");
	exit(1);
}
PearDatabase::$connection->set_charset('utf8mb4');

require_once 'modules/ModernUI/models/Lifecycle.php';

$failures = 0;
$count = 0;
function check($condition, $message) {
	global $failures, $count;
	$count++;
	if ($condition !== true) {
		$failures++;
		fwrite(STDERR, "FAIL {$message}\n");
	}
}

function q($sql) {
	$result = PearDatabase::$connection->query($sql);
	return $result instanceof mysqli_result ? $result->fetch_all(MYSQLI_ASSOC) : array();
}

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
check(count(MU_Fake::$links) === 4 && count(MU_Fake::$settingsLinks) === 1, 'reinstall: links and the settings item are created again');

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

printf("db %s (%s): %d check(s), %d failed\n", $database, $expectedCollation, $count, $failures);
exit($failures > 0 ? 1 : 0);
