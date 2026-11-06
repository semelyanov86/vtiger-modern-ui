<?php
/*
 * Minimal stand-ins for the Vtiger classes and functions the ModernUI models call. They only record what the
 * models do and answer with prepared data; the real behaviour is checked on a Vtiger instance (task test:e2e,
 * task crm:install) and against a real MySQL (task test:db).
 */

class MU_Fake {
	/** @var array SQL fragment => rows answered by the fake database */
	public static $answers = array();
	/** @var array executed statements: [sql, params] */
	public static $queries = array();
	public static $moduleActive = true;
	public static $vtigerVersion = '8.4.0';
	public static $user = null;
	public static $links = array();
	public static $settingsLinks = array();

	public static function reset() {
		self::$answers = array();
		self::$queries = array();
		self::$moduleActive = true;
		self::$vtigerVersion = '8.4.0';
		self::$user = new Users_Record_Model(array('id' => 5, 'roleid' => 'H5', 'language' => 'ru_ru', 'is_admin' => 'off'));
		self::$links = array();
		self::$settingsLinks = array();
		$_REQUEST = array();
		$_SESSION = array();
		if (class_exists('ModernUI_LinkHandler_Model', false)) {
			ModernUI_LinkHandler_Model::reset();
		}
		if (class_exists('ModernUI_Activation_Model', false)) {
			ModernUI_Activation_Model::reset();
		}
		if (class_exists('ModernUI_Assets_Model', false)) {
			ModernUI_Assets_Model::reset();
		}
		if (class_exists('ModernUI_Adapters_Model', false)) {
			ModernUI_Adapters_Model::setRegistry(null);
		}
		ModernUI_Schema_Model_Cache::forget();
	}

	/** Prepared rows for statements containing $fragment. */
	public static function answer($fragment, array $rows) {
		self::$answers[$fragment] = $rows;
	}
}

/** Resets the request cache of ModernUI_Schema_Model::getDbVersion() between tests. */
class ModernUI_Schema_Model_Cache {
	public static function forget() {
		if (class_exists('ModernUI_Schema_Model', false)) {
			ModernUI_Schema_Model::forgetCache();
		}
	}
}

class MU_FakeResult {
	public $rows;

	public function __construct(array $rows) {
		$this->rows = $rows;
	}
}

class PearDatabase {
	public $dieOnError = false;
	public $database = null;
	private static $instance = null;

	public static function getInstance() {
		if (self::$instance === null) {
			self::$instance = new PearDatabase();
		}
		return self::$instance;
	}

	public function pquery($sql, $params = array()) {
		MU_Fake::$queries[] = array($sql, $params);
		foreach (MU_Fake::$answers as $fragment => $rows) {
			if (strpos($sql, $fragment) !== false) {
				if ($rows === array('__fail__')) {
					return false;
				}
				return new MU_FakeResult($rows);
			}
		}
		return new MU_FakeResult(array());
	}

	public function num_rows($result) {
		return count($result->rows);
	}

	public function raw_query_result_rowdata($result, $row = 0) {
		return isset($result->rows[$row]) ? $result->rows[$row] : null;
	}

	public function getAffectedRowCount($result) {
		return count($result->rows);
	}
}

class Users_Record_Model {
	private $data;

	public function __construct(array $data) {
		$this->data = $data;
	}

	public static function getCurrentUserModel() {
		return MU_Fake::$user;
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

class Vtiger_Language_Handler {
	public static function getModuleStringsFromFile($language, $module) {
		$file = 'languages/' . $language . '/' . str_replace('.', '/', $module) . '.php';
		if (!is_file($file)) {
			return array();
		}
		$languageStrings = array();
		require $file;
		return array('languageStrings' => $languageStrings);
	}
}

class MU_FakeLink {
	public $linktype;
	public $linklabel;
	public $linkurl;

	public function __construct($type, $label, $url) {
		$this->linktype = $type;
		$this->linklabel = $label;
		$this->linkurl = $url;
	}
}

class Vtiger_LinkData {
	private $link;

	public function __construct($link) {
		$this->link = $link;
	}

	public function getLink() {
		return $this->link;
	}
}

function vtlib_isModuleActive($module) {
	return $module === 'ModernUI' ? MU_Fake::$moduleActive : true;
}

function vglobal($name) {
	return $name === 'vtiger_current_version' ? MU_Fake::$vtigerVersion : null;
}

function vtlib_addSettingsLink($name, $url, $block) {
	MU_Fake::$settingsLinks[] = array($name, $url, $block);
	return true;
}
