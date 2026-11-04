<?php
/*
 * Shared part of the MySQL tests (tests/php/db/run.sh): PearDatabase over mysqli with the emulated parameter binding
 * of ADOdb (what Vtiger uses) and the few Vtiger functions the ModernUI models call outside the CRM.
 *
 *   require 'harness.php'; mu_connect($host, $port, $database);
 */
error_reporting(E_ALL);
set_error_handler(function ($severity, $message, $file, $line) {
	throw new ErrorException($message, 0, $severity, $file, $line);
});
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
	/** @var Users_Record_Model|null */
	public static $current = null;
	private $data;

	public function __construct(array $data) {
		$this->data = $data;
	}

	public static function getCurrentUserModel() {
		return self::$current;
	}

	public function getId() {
		return $this->data['id'];
	}

	public function get($key) {
		return isset($this->data[$key]) ? $this->data[$key] : null;
	}

	public function isAdminUser() {
		return $this->get('is_admin') === 'on';
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



/**
 * Connects PearDatabase to a database of the test server.
 * @return mysqli
 */
function mu_connect($host, $port, $database) {
	$link = new mysqli($host, 'root', 'test', $database, (int) $port);
	if ($link->connect_errno) {
		fwrite(STDERR, "db: cannot connect: " . $link->connect_error . "\n");
		exit(1);
	}
	$link->set_charset('utf8mb4');
	PearDatabase::$connection = $link;
	return $link;
}

$GLOBALS['mu_failures'] = 0;
$GLOBALS['mu_count'] = 0;
function check($condition, $message) {
	$GLOBALS['mu_count']++;
	if ($condition !== true) {
		$GLOBALS['mu_failures']++;
		fwrite(STDERR, "FAIL {$message}\n");
	}
}

function q($sql) {
	$result = PearDatabase::$connection->query($sql);
	return $result instanceof mysqli_result ? $result->fetch_all(MYSQLI_ASSOC) : array();
}
