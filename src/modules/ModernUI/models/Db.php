<?php
/*
 * Thin helpers over PearDatabase used by ModernUI.
 *
 * Values are read with raw_query_result_rowdata(): fetch_array() and query_result() of PearDatabase
 * HTML-encode every value, which would corrupt the JSON documents of the settings.
 */

class ModernUI_Db_Model {

	/**
	 * @return PearDatabase
	 */
	public static function db() {
		return PearDatabase::getInstance();
	}

	/**
	 * Runs a statement; returns the result or false when it failed (the error is logged by PearDatabase).
	 * @param string $sql
	 * @param array $params
	 * @return mixed
	 */
	public static function execute($sql, array $params = array()) {
		$db = self::db();
		$dieOnError = $db->dieOnError;
		$db->dieOnError = false;
		try {
			return $db->pquery($sql, $params);
		} finally {
			$db->dieOnError = $dieOnError;
		}
	}

	/**
	 * Runs a statement that must succeed (migrations, writes); throws otherwise.
	 * @param string $sql
	 * @param array $params
	 * @return mixed
	 */
	public static function mustExecute($sql, array $params = array()) {
		$result = self::execute($sql, $params);
		if ($result === false) {
			$db = self::db();
			$message = ($db->database && method_exists($db->database, 'ErrorMsg')) ? $db->database->ErrorMsg() : 'unknown error';
			throw new RuntimeException('ModernUI: query failed: ' . $message);
		}
		return $result;
	}

	/**
	 * All rows of a SELECT as arrays with raw (not HTML-encoded) values.
	 * @param string $sql
	 * @param array $params
	 * @return array
	 */
	public static function rows($sql, array $params = array()) {
		$result = self::execute($sql, $params);
		if ($result === false || !is_object($result)) {
			return array();
		}
		$db = self::db();
		$rows = array();
		$count = $db->num_rows($result);
		for ($i = 0; $i < $count; $i++) {
			$row = $db->raw_query_result_rowdata($result, $i);
			if (is_array($row)) {
				$rows[] = $row;
			}
		}
		return $rows;
	}

	/**
	 * First column of the first row, or null.
	 * @param string $sql
	 * @param array $params
	 * @return mixed
	 */
	public static function value($sql, array $params = array()) {
		$rows = self::rows($sql, $params);
		if (!$rows) {
			return null;
		}
		$first = $rows[0];
		return reset($first);
	}

	/**
	 * @param string $table
	 * @return bool
	 */
	public static function tableExists($table) {
		$found = self::value('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', array($table));
		return (int) $found > 0;
	}

	/**
	 * Number of rows changed by the last statement.
	 * @param mixed $result
	 * @return int
	 */
	public static function affectedRows($result) {
		return (int) self::db()->getAffectedRowCount($result);
	}
}
