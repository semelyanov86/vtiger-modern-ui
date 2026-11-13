<?php
/*
 * Lifecycle evidence on a synthetic clean instance. Mutations use the module's models and vtlib;
 * SQL is read-only (including MySQL's connection-scoped advisory lock). Never install this tool.
 *
 * php lifecycle.php <CRM root> snapshot|restore|probe|event|hold-lock|host-state|asset|collision|compatibility [argument]
 * restore reads a snapshot from stdin and restores documents, not their audit revisions.
 */
if (PHP_SAPI !== 'cli') {
	http_response_code(404);
	exit(1);
}
$root = $argv[1] ?? '';
$command = $argv[2] ?? '';
if (!is_file($root . '/config.inc.php') || !in_array($command, array('snapshot', 'restore', 'probe', 'event', 'hold-lock', 'host-state', 'asset', 'collision', 'compatibility'), true)) {
	fwrite(STDERR, "usage: lifecycle.php <CRM root> snapshot|restore|probe|event|hold-lock|host-state|asset|collision|compatibility [argument]\n");
	exit(2);
}
chdir($root);
require_once 'config.php';
require_once 'vendor/autoload.php';
require_once 'includes/main/WebUI.php';
require_once 'vtlib/Vtiger/Module.php';
global $current_user;
$current_user = Users::getActiveAdminUser();
vglobal('current_user', $current_user);

// An orphan directory fixture, only after the real module was uninstalled. Never remove an unknown existing file.
if ($command === 'collision') {
	if (Vtiger_Module::getInstance('ModernUI')) {
		throw new RuntimeException('Uninstall the test module before creating a name collision');
	}
	$directory = 'modules/ModernUI';
	$sentinel = $directory . '/lifecycle-sentinel.txt';
	$content = "ModernUI lifecycle name collision\n";
	$operation = $argv[3] ?? '';
	if ($operation === 'create') {
		if (file_exists($directory) || !mkdir($directory) || file_put_contents($sentinel, $content) === false) {
			throw new RuntimeException('Cannot create the isolated name collision fixture');
		}
	} elseif (!is_file($sentinel) || file_get_contents($sentinel) !== $content || count(scandir($directory)) !== 3) {
		throw new RuntimeException('Name collision fixture changed unexpectedly');
	}
	if ($operation === 'remove') {
		if (!unlink($sentinel) || !rmdir($directory)) {
			throw new RuntimeException('Cannot remove the own name collision fixture');
		}
	} elseif (!in_array($operation, array('create', 'check'), true)) {
		throw new RuntimeException('collision expects create|check|remove');
	}
	echo json_encode(array('fixture' => $operation, 'sha256' => hash('sha256', $content))), "\n";
	exit;
}
require_once 'modules/ModernUI/models/Lifecycle.php';

function mu_lifecycle_snapshot() {
	$settings = array();
	foreach (ModernUI_Db_Model::rows('SELECT scope, scope_key, data FROM vtiger_modernui_settings ORDER BY scope, scope_key') as $row) {
		$settings[] = array('scope' => $row['scope'], 'key' => (string) $row['scope_key'], 'document' => json_decode($row['data'], true));
	}
	$meta = array();
	foreach (array('notice', 'last_error', 'update_started_at') as $key) {
		$meta[$key] = ModernUI_Schema_Model::getMeta($key);
	}
	return array('settings' => $settings, 'meta' => $meta);
}

function mu_lifecycle_probe($userId) {
	global $current_user;
	$current_user = new Users();
	$current_user->retrieveCurrentUserInfoFromFile($userId);
	vglobal('current_user', $current_user);
	ModernUI_Activation_Model::reset();
	ModernUI_Schema_Model::forgetCache();
	$_REQUEST = array('module' => 'Accounts', 'view' => 'List');
	$decision = ModernUI_Activation_Model::evaluate($_REQUEST);
	$links = array();
	foreach (Vtiger_Link_Model::getAllByType(Vtiger_Link::IGNORE_MODULE, array('HEADERSCRIPT', 'HEADERCSS')) as $items) {
		foreach ($items as $link) {
			if (strpos($link->linkurl, 'ModernUI') !== false) {
				$links[] = $link->linklabel;
			}
		}
	}
	return array('active' => $decision['active'], 'reason' => $decision['reason'], 'links' => $links,
		'schema' => ModernUI_Schema_Model::getDbVersion(), 'version' => ModernUI_Lifecycle_Model::moduleVersion(),
		'updating' => ModernUI_Schema_Model::getMeta('update_started_at') !== null,
		'error' => ModernUI_Schema_Model::getMeta('last_error'));
}

$result = null;
switch ($command) {
	case 'compatibility':
		// Simulate the request's version value, not an installation on an unsupported host. No host file or DB write.
		$version = vglobal('vtiger_current_version');
		$result = array();
		try {
			foreach (array('8.3.0', '8.40.0', '9.0.0') as $unsupported) {
				vglobal('vtiger_current_version', $unsupported);
				$result[$unsupported] = mu_lifecycle_probe((int) $current_user->id);
			}
		} finally {
			vglobal('vtiger_current_version', $version);
		}
		break;
	case 'host-state':
		$result = array();
		foreach (array(
			'links' => "SELECT tabid, linktype, linklabel, linkurl FROM vtiger_links WHERE linklabel NOT LIKE 'ModernUI%' ORDER BY linkid",
			'settings' => "SELECT name, linkto FROM vtiger_settings_field WHERE name <> 'ModernUI' ORDER BY fieldid",
			'roles' => 'SELECT roleid, rolename, parentrole FROM vtiger_role ORDER BY roleid',
			'users' => 'SELECT id, user_name, language, date_format, hour_format, currency_id, currency_grouping_separator, currency_decimal_separator FROM vtiger_users ORDER BY id',
			'records' => 'SELECT crmid, setype, deleted, modifiedtime FROM vtiger_crmentity ORDER BY crmid',
		) as $key => $sql) {
			$result[$key] = hash('sha256', json_encode(ModernUI_Db_Model::rows($sql)));
		}
		break;
	case 'asset':
		$manifest = ModernUI_Assets_Model::DIST . '/manifest.json';
		$backup = $manifest . '.lifecycle-backup';
		$hide = ($argv[3] ?? '') === 'hide';
		if (!$hide && ($argv[3] ?? '') !== 'restore') {
			throw new RuntimeException('asset expects hide|restore');
		}
		$from = $hide ? $manifest : $backup;
		$to = $hide ? $backup : $manifest;
		if (!is_file($from) || file_exists($to) || !rename($from, $to)) {
			throw new RuntimeException('Cannot move the own manifest');
		}
		$result = array('hidden' => $hide, 'sha256' => hash_file('sha256', $to));
		break;
	case 'snapshot':
		$result = mu_lifecycle_snapshot();
		break;
	case 'restore':
		$before = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
		if (!isset($before['settings'], $before['meta'])) {
			throw new RuntimeException('Invalid settings snapshot');
		}
		$keys = array();
		foreach ($before['settings'] as $saved) {
			$keys[$saved['scope'] . ':' . $saved['key']] = true;
			$row = ModernUI_Settings_Model::getRow($saved['scope'], $saved['key']);
			if ($row && json_decode($row['data'], true) === $saved['document']) {
				continue;
			}
			$document = $saved['document'];
			$written = ModernUI_Settings_Model::save($saved['scope'], $saved['key'], ModernUI_Settings_Model::flatten($document),
				$row ? (int) $row['revision'] : 0, $current_user->id, $document['meta'] ?? array());
			if (!$written['ok']) {
				throw new RuntimeException('Settings restore conflict');
			}
		}
		foreach (mu_lifecycle_snapshot()['settings'] as $row) {
			if (!isset($keys[$row['scope'] . ':' . $row['key']])) {
				ModernUI_Settings_Model::reset($row['scope'], $row['key']);
			}
		}
		foreach (array('notice', 'last_error', 'update_started_at') as $key) {
			ModernUI_Schema_Model::setMeta($key, $before['meta'][$key] ?? null);
		}
		if (mu_lifecycle_snapshot() !== $before) {
			throw new RuntimeException('Settings snapshot was not restored');
		}
		$result = array('restored' => true, 'scopes' => count($before['settings']));
		break;
	case 'probe':
		$result = mu_lifecycle_probe((int) ($argv[3] ?? $current_user->id));
		break;
	case 'event':
		$event = $argv[3] ?? '';
		if (!in_array($event, array('module.preupdate', 'module.postupdate', 'module.enabled', 'module.disabled'), true)) {
			throw new RuntimeException('Unsupported lifecycle event');
		}
		Vtiger_Module::fireEvent('ModernUI', $event);
		$result = mu_lifecycle_probe((int) $current_user->id);
		break;
	case 'hold-lock':
		$seconds = (int) ($argv[3] ?? 20);
		if ($seconds < 1 || $seconds > 60) {
			throw new RuntimeException('Lock duration must be 1..60 seconds');
		}
		if ((int) ModernUI_Db_Model::value('SELECT GET_LOCK(?, 0)', array(ModernUI_Schema_Model::LOCK)) !== 1) {
			throw new RuntimeException('Cannot acquire the migration lock');
		}
		echo "locked\n";
		flush();
		try {
			sleep($seconds);
		} finally {
			ModernUI_Db_Model::value('SELECT RELEASE_LOCK(?)', array(ModernUI_Schema_Model::LOCK));
		}
		$result = array('released' => true);
		break;
}
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
