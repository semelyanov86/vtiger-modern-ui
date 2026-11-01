<?php
/*
 * Schema version 1: the meta and settings tables, the global document with the theme switched off.
 * Idempotent: running it again changes nothing.
 */

class ModernUI_Migration_0001 {

	/**
	 * @param PearDatabase $db
	 */
	public function up($db) {
		$charset = 'utf8mb4';
		$collation = 'utf8mb4_general_ci';
		$rows = ModernUI_Db_Model::rows('SELECT @@character_set_database AS cs, @@collation_database AS co');
		if ($rows && preg_match('/^[a-z0-9_]+$/', (string) $rows[0]['cs']) && preg_match('/^[a-z0-9_]+$/', (string) $rows[0]['co'])) {
			// The tables follow the database: a clean 8.4 installation creates utf8, many upgraded ones utf8mb4.
			$charset = (string) $rows[0]['cs'];
			$collation = (string) $rows[0]['co'];
		}
		$suffix = " ENGINE=InnoDB DEFAULT CHARSET={$charset} COLLATE={$collation}";

		ModernUI_Db_Model::mustExecute('CREATE TABLE IF NOT EXISTS vtiger_modernui_meta ('
			. 'name VARCHAR(64) NOT NULL, '
			. 'value TEXT NOT NULL, '
			. 'PRIMARY KEY (name)'
			. ')' . $suffix);

		ModernUI_Db_Model::mustExecute('CREATE TABLE IF NOT EXISTS vtiger_modernui_settings ('
			. 'id INT NOT NULL AUTO_INCREMENT, '
			. 'scope VARCHAR(8) NOT NULL, '
			. 'scope_key VARCHAR(64) NOT NULL DEFAULT \'\', '
			. 'data MEDIUMTEXT NOT NULL, '
			. 'doc_version SMALLINT NOT NULL, '
			. 'revision INT NOT NULL DEFAULT 1, '
			. 'updated_by INT NULL, '
			. 'updated_at DATETIME NOT NULL, '
			. 'PRIMARY KEY (id), '
			. 'UNIQUE KEY uq_scope (scope, scope_key)'
			. ')' . $suffix);

		$exists = ModernUI_Db_Model::value('SELECT COUNT(*) AS n FROM vtiger_modernui_settings WHERE scope = ? AND scope_key = ?', array('global', ''));
		if ((int) $exists === 0) {
			$document = json_encode(array('v' => 1, 'theme' => array('mode' => 'off')), JSON_UNESCAPED_SLASHES);
			ModernUI_Db_Model::mustExecute('INSERT INTO vtiger_modernui_settings (scope, scope_key, data, doc_version, revision, updated_by, updated_at)'
				. ' VALUES (?, ?, ?, ?, 1, NULL, ?)', array('global', '', $document, 1, date('Y-m-d H:i:s')));
		}
	}
}
