<?php
/*
 * Version of the ModernUI settings schema and the runner of its migrations (docs/settings.md §5).
 *
 * Migrations live in modules/ModernUI/migrations/NNNN_<name>.php, one class ModernUI_Migration_NNNN with
 * up(PearDatabase $db) each. They are idempotent, change only vtiger_modernui_* tables and run from the
 * vtlib lifecycle (postinstall, postupdate, enabled) and from the Recovery action of the settings page.
 */

require_once 'modules/ModernUI/models/Db.php';

class ModernUI_Schema_Model {

	/** Schema version this code works with. */
	const VERSION = 1;

	const META_TABLE = 'vtiger_modernui_meta';
	const LOCK = 'modernui_migrate';

	const STATE_CURRENT = 'current';
	const STATE_OUTDATED = 'outdated';
	const STATE_NEWER = 'newer';
	const STATE_MISSING = 'missing';

	/** @var int|null|false schema version of the database for this request; false: not read yet */
	private static $dbVersion = false;
	/** @var array lifecycle markers, loaded with the schema version in the same query */
	private static $recoveryMarkers = array();

	/**
	 * Schema version recorded in the database, or null when the tables do not exist (yet or any more).
	 * Meant for every page: one SELECT, cached for the request; a failure counts as "missing".
	 * @param bool $fresh skip the cache
	 * @return int|null
	 */
	public static function getDbVersion($fresh = false) {
		if ($fresh || self::$dbVersion === false) {
			$meta = array();
			foreach (ModernUI_Db_Model::rows('SELECT name, value FROM ' . self::META_TABLE . ' WHERE name IN (?, ?, ?)',
					array('schema_version', 'update_started_at', 'last_error')) as $row) {
				$meta[$row['name']] = $row['value'];
			}
			$value = $meta['schema_version'] ?? null;
			self::$dbVersion = ($value === null || !preg_match('/^[0-9]+$/', (string) $value)) ? null : (int) $value;
			self::$recoveryMarkers = array_intersect_key($meta, array('update_started_at' => true, 'last_error' => true));
		}
		return self::$dbVersion;
	}

	/**
	 * Forgets the cached schema version (after migrations, in tests).
	 */
	public static function forgetCache() {
		self::$dbVersion = false;
		self::$recoveryMarkers = array();
	}

	/** An unchanged schema version does not prove that an update completed successfully. */
	public static function recoveryRequired() {
		self::getDbVersion();
		return count(self::$recoveryMarkers) > 0;
	}

	/**
	 * @param bool $fresh
	 * @return string one of the STATE_* constants
	 */
	public static function state($fresh = false) {
		$version = self::getDbVersion($fresh);
		if ($version === null) {
			return self::STATE_MISSING;
		}
		if ($version < self::VERSION) {
			return self::STATE_OUTDATED;
		}
		return $version > self::VERSION ? self::STATE_NEWER : self::STATE_CURRENT;
	}

	/**
	 * @param string $name
	 * @return string|null
	 */
	public static function getMeta($name) {
		if (!ModernUI_Db_Model::tableExists(self::META_TABLE)) {
			return null;
		}
		$value = ModernUI_Db_Model::value('SELECT value FROM ' . self::META_TABLE . ' WHERE name = ?', array($name));
		return $value === null ? null : (string) $value;
	}

	/**
	 * @param string $name
	 * @param string|null $value null removes the entry
	 */
	public static function setMeta($name, $value) {
		self::forgetCache();
		if ($value === null) {
			ModernUI_Db_Model::mustExecute('DELETE FROM ' . self::META_TABLE . ' WHERE name = ?', array($name));
			return;
		}
		ModernUI_Db_Model::mustExecute('INSERT INTO ' . self::META_TABLE . ' (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
			array($name, (string) $value, (string) $value));
	}

	/**
	 * Migrations shipped with this code: number => file.
	 * @return array
	 */
	public static function migrations() {
		$migrations = array();
		foreach (glob(dirname(__DIR__) . '/migrations/*.php') ?: array() as $file) {
			if (preg_match('/^([0-9]{4})_[a-z0-9_]+\.php$/', basename($file), $match)) {
				$migrations[(int) $match[1]] = $file;
			}
		}
		ksort($migrations);
		return $migrations;
	}

	/**
	 * Applies the missing migrations up to self::VERSION.
	 * @return array {from: int|null, to: int|null, applied: int[], error: string|null}
	 */
	public static function migrate() {
		$report = array('from' => null, 'to' => null, 'applied' => array(), 'error' => null);
		$db = ModernUI_Db_Model::db();
		$locked = (int) ModernUI_Db_Model::value('SELECT GET_LOCK(?, ?) AS l', array(self::LOCK, 10)) === 1;
		if (!$locked) {
			$report['error'] = 'MU_MIGRATION_LOCKED';
			return $report;
		}
		try {
			$current = ModernUI_Db_Model::tableExists(self::META_TABLE) ? self::getDbVersion(true) : null;
			$report['from'] = $current;
			if ($current !== null && $current > self::VERSION) {
				$report['error'] = 'MU_SCHEMA_NEWER';
				$report['to'] = $current;
				return $report;
			}
			foreach (self::migrations() as $number => $file) {
				if ($number > self::VERSION || ($current !== null && $number <= $current)) {
					continue;
				}
				require_once $file;
				$class = sprintf('ModernUI_Migration_%04d', $number);
				if (!class_exists($class, false)) {
					throw new RuntimeException("ModernUI: migration class {$class} is missing");
				}
				$migration = new $class();
				$migration->up($db);
				self::setMeta('schema_version', (string) $number);
				self::setMeta('last_migration_at', gmdate('Y-m-d\TH:i:s\Z'));
				$report['applied'][] = $number;
				$current = $number;
			}
			$report['to'] = $current;
			if ($current !== self::VERSION) {
				throw new RuntimeException('ModernUI: the migrations end at version ' . var_export($current, true) . ', the code needs ' . self::VERSION);
			}
			self::setMeta('last_error', null);
		} catch (Throwable $e) {
			$report['error'] = $e->getMessage();
			try {
				if (ModernUI_Db_Model::tableExists(self::META_TABLE)) {
					self::setMeta('last_error', gmdate('Y-m-d\TH:i:s\Z') . ' ' . substr($e->getMessage(), 0, 500));
				}
			} catch (Throwable $ignored) {
				// the error is in the report already
			}
		} finally {
			ModernUI_Db_Model::value('SELECT RELEASE_LOCK(?) AS l', array(self::LOCK));
			self::forgetCache();
		}
		return $report;
	}

	/**
	 * Drops the own tables (uninstall with "remove ModernUI data").
	 */
	public static function dropTables() {
		foreach (array('vtiger_modernui_settings', self::META_TABLE) as $table) {
			ModernUI_Db_Model::mustExecute('DROP TABLE IF EXISTS ' . $table);
		}
		self::forgetCache();
	}
}
