<?php
// Read-only state of the module registration in a Vtiger stand (part of `task crm:status`).
// Usage: php8.5 dev/crm-info.php <CRM root> [module]
// Reads the DB settings from the stand's own config.inc.php; never prints credentials, runs only SELECT.
if (PHP_SAPI !== 'cli') {
	http_response_code(404);
	exit(1);
}
$root = isset($argv[1]) ? rtrim($argv[1], '/') : '';
$module = isset($argv[2]) ? $argv[2] : 'ModernUI';
if ($root === '' || !is_file($root . '/config.inc.php')) {
	fwrite(STDERR, "usage: php dev/crm-info.php <CRM root> [module]\n");
	exit(2);
}

chdir($root);
error_reporting(E_ERROR | E_PARSE);
$dbconfig = array();
require $root . '/config.inc.php';

mysqli_report(MYSQLI_REPORT_OFF);
$port = (int) ltrim((string) (isset($dbconfig['db_port']) ? $dbconfig['db_port'] : ''), ':');
$db = @new mysqli($dbconfig['db_server'], $dbconfig['db_username'], $dbconfig['db_password'], $dbconfig['db_name'], $port > 0 ? $port : 3306);
$where = $dbconfig['db_name'] . '@' . $dbconfig['db_server'] . ($port > 0 ? ':' . $port : '');
if ($db->connect_errno) {
	echo "  DB {$where}: unreachable ({$db->connect_error})\n";
	exit(0);
}
$db->set_charset('utf8mb4');

function rows(mysqli $db, $sql, array $params)
{
	$statement = $db->prepare($sql);
	if ($statement === false) {
		return array();
	}
	if ($params) {
		$statement->bind_param(str_repeat('s', count($params)), ...$params);
	}
	$statement->execute();
	$result = $statement->get_result();

	return $result ? $result->fetch_all(MYSQLI_ASSOC) : array();
}

echo "  DB {$where}\n";
$like = '%' . $module . '%';
$tab = rows($db, 'SELECT tabid, presence, version, isentitytype FROM vtiger_tab WHERE name = ?', array($module));
if (!$tab) {
	echo "  {$module} is not registered (vtiger_tab)\n";
} else {
	$tab = $tab[0];
	$state = (int) $tab['presence'] === 0 ? 'enabled' : 'disabled';
	echo "  {$module}: tabid {$tab['tabid']}, {$state}, version {$tab['version']}, entity {$tab['isentitytype']}\n";
}
$tabid = $tab ? (string) $tab['tabid'] : '-1';
$links = rows($db, 'SELECT linktype, linklabel, linkurl, COUNT(*) AS n FROM vtiger_links WHERE tabid = ? OR linkurl LIKE ?'
	. ' GROUP BY linktype, linklabel, linkurl ORDER BY MIN(linkid)', array($tabid, $like));
foreach ($links as $link) {
	$times = (int) $link['n'] > 1 ? " (x{$link['n']})" : '';
	echo "  link {$link['linktype']} {$link['linklabel']}{$times}: {$link['linkurl']}\n";
}
foreach (rows($db, 'SELECT name, linkto, active FROM vtiger_settings_field WHERE name LIKE ? OR linkto LIKE ?', array($like, $like)) as $field) {
	$state = (int) $field['active'] === 0 ? 'active' : 'inactive';
	echo "  settings item {$field['name']} ({$state}): {$field['linkto']}\n";
}
$tables = rows($db, 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE ?', array(strtolower($like)));
if ($tables) {
	echo '  own tables: ' . implode(', ', array_column($tables, 'name')) . "\n";
}
