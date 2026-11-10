<?php
/*
 * vtlib lifecycle of ModernUI (docs/architecture.md §3.4, docs/settings.md §10).
 *
 * Every step is idempotent and changes only what belongs to the module: its two global links (tabid 0,
 * with the link handler), its item in Settings → Other settings and its own vtiger_modernui_* tables.
 * Links are created here and not in manifest.xml: the <customlinks> import of 8.4.0 loses the handler.
 */

include_once 'vtlib/Vtiger/Link.php';
if (!function_exists('vtlib_addSettingsLink')) {
	include_once 'include/utils/VtlibUtils.php';
}
require_once 'modules/ModernUI/models/Db.php';
require_once 'modules/ModernUI/models/Schema.php';
require_once 'modules/ModernUI/models/Settings.php';
require_once 'modules/ModernUI/models/Activation.php';
require_once 'modules/ModernUI/models/LinkHandler.php';

class ModernUI_Lifecycle_Model {

	const SETTINGS_ITEM = 'ModernUI';
	const SETTINGS_URL = 'index.php?module=ModernUI&parent=Settings&view=Index';
	const SETTINGS_BLOCK = 'LBL_OTHER_SETTINGS';

	/** Set before Vtiger_Module::delete() to drop the own tables as well (uninstall with data removal). */
	public static $purgeOnUninstall = false;

	/**
	 * The global links: type, label, registered URL, handler.
	 * @return array
	 */
	public static function links() {
		$handler = array(
			'path' => 'modules/ModernUI/models/LinkHandler.php',
			'class' => 'ModernUI_LinkHandler_Model',
			'method' => 'filter',
		);
		return array(
			array('type' => 'HEADERCSS', 'label' => ModernUI_LinkHandler_Model::LABEL_SKIN,
				// Not an existing file on purpose: only the handler points the link at the hashed skin.
				'url' => ModernUI_Assets_Model::DIST . '/skin.css', 'handler' => $handler),
			array('type' => 'HEADERCSS', 'label' => ModernUI_LinkHandler_Model::LABEL_TOKENS,
				// Not an existing file either: the handler points it at action=Tokens with the settings revision.
				'url' => ModernUI_Assets_Model::DIST . '/tokens.css', 'handler' => $handler),
			array('type' => 'HEADERSCRIPT', 'label' => ModernUI_LinkHandler_Model::LABEL_SHELL,
				'url' => ModernUI_Assets_Model::LOADER, 'handler' => $handler),
		);
	}

	/**
	 * @param string $eventType
	 */
	public static function handle($eventType) {
		switch ($eventType) {
			case 'module.postinstall':
				self::install();
				break;
			case 'module.enabled':
				self::migrate();
				self::syncLinks();
				break;
			case 'module.disabled':
				self::removeLinks();
				break;
			case 'module.preupdate':
				// The new files are unpacked already, the schema is still the old one: change nothing.
				// Until postupdate the link handler sees a schema mismatch and keeps the theme off.
				self::safeMeta('update_started_at', gmdate('Y-m-d\TH:i:s\Z'));
				break;
			case 'module.postupdate':
				self::migrate();
				self::syncLinks();
				self::addSettingsItem();
				self::safeMeta('installed_version', self::moduleVersion());
				self::safeMeta('update_started_at', null);
				break;
			case 'module.preuninstall':
				self::uninstall(self::$purgeOnUninstall);
				break;
		}
	}

	/**
	 * postinstall: schema, default settings (theme off), links, settings item.
	 * A reinstall over kept tables restores the settings but switches the theme off.
	 */
	public static function install() {
		$reinstall = ModernUI_Db_Model::tableExists(ModernUI_Settings_Model::TABLE);
		$report = self::migrate();
		if ($report['error'] === null && $reinstall) {
			ModernUI_Settings_Model::update(ModernUI_Settings_Model::SCOPE_GLOBAL, '', array('theme.mode' => 'off'), null);
			self::safeMeta('notice', 'MU_REINSTALLED_THEME_OFF');
		}
		self::safeMeta('installed_version', self::moduleVersion());
		if (ModernUI_Activation_Model::isSupportedVtiger()) {
			self::syncLinks();
		} else {
			self::removeLinks();
		}
		self::addSettingsItem();
	}

	/**
	 * Runs the migrations; never throws (the result is kept in the meta table and shown on the settings page).
	 * @return array report of ModernUI_Schema_Model::migrate()
	 */
	public static function migrate() {
		try {
			$report = ModernUI_Schema_Model::migrate();
		} catch (Throwable $e) {
			$report = array('from' => null, 'to' => null, 'applied' => array(), 'error' => $e->getMessage());
		}
		self::log('migrations: ' . json_encode($report));
		return $report;
	}

	/**
	 * Creates the global links or brings them to the current definition; removes duplicates.
	 */
	public static function syncLinks() {
		if (!ModernUI_Activation_Model::isSupportedVtiger()) {
			return;
		}
		foreach (self::links() as $link) {
			$rows = ModernUI_Db_Model::rows('SELECT linkid, linkurl, handler_path, handler_class, handler FROM vtiger_links'
				. ' WHERE tabid = 0 AND linktype = ? AND linklabel = ?', array($link['type'], $link['label']));
			$upToDate = count($rows) === 1 && $rows[0]['linkurl'] === $link['url']
				&& $rows[0]['handler_path'] === $link['handler']['path']
				&& $rows[0]['handler_class'] === $link['handler']['class']
				&& $rows[0]['handler'] === $link['handler']['method'];
			if ($upToDate) {
				continue;
			}
			Vtiger_Link::deleteLink(0, $link['type'], $link['label']);
			Vtiger_Link::addLink(0, $link['type'], $link['label'], $link['url'], '', 0, $link['handler']);
		}
	}

	/**
	 * Removes the global links (disable, uninstall).
	 */
	public static function removeLinks() {
		foreach (self::links() as $link) {
			Vtiger_Link::deleteLink(0, $link['type'], $link['label']);
		}
	}

	/**
	 * Settings → Other settings → ModernUI. The item is named after the product, so the settings menu shows
	 * the same text on every page and in every language.
	 */
	public static function addSettingsItem() {
		$existing = ModernUI_Db_Model::rows('SELECT fieldid, linkto FROM vtiger_settings_field WHERE name = ?', array(self::SETTINGS_ITEM));
		foreach ($existing as $row) {
			if ($row['linkto'] !== self::SETTINGS_URL) {
				ModernUI_Db_Model::mustExecute('DELETE FROM vtiger_settings_field WHERE fieldid = ?', array($row['fieldid']));
			}
		}
		vtlib_addSettingsLink(self::SETTINGS_ITEM, self::SETTINGS_URL, self::SETTINGS_BLOCK);
	}

	public static function removeSettingsItem() {
		ModernUI_Db_Model::mustExecute('DELETE FROM vtiger_settings_field WHERE name = ? AND linkto = ?', array(self::SETTINGS_ITEM, self::SETTINGS_URL));
	}

	/**
	 * preuninstall: links and the settings item go; the tables stay unless $purge (docs/settings.md §10).
	 * The core removes vtiger_tab, profiles and links with the module's tabid afterwards.
	 * @param bool $purge
	 */
	public static function uninstall($purge) {
		// Explicitly installed login templates must be restored before the module's files disappear.
		require_once 'modules/ModernUI/models/AuthInstaller.php';
		if (is_file(ModernUI_Assets_Model::crmRoot() . '/' . ModernUI_AuthInstaller_Model::BACKUP)) {
			(new ModernUI_AuthInstaller_Model())->apply(false);
		}
		self::removeLinks();
		self::removeSettingsItem();
		if ($purge) {
			ModernUI_Schema_Model::dropTables();
			require_once 'modules/ModernUI/models/Branding.php';
			ModernUI_Branding_Model::purge();
		}
		self::log('uninstall' . ($purge ? ' with data removal' : ', settings tables kept'));
	}

	/**
	 * Version of the module as registered in vtiger_tab.
	 * @return string
	 */
	public static function moduleVersion() {
		$version = ModernUI_Db_Model::value('SELECT version FROM vtiger_tab WHERE name = ?', array('ModernUI'));
		return $version === null ? '' : (string) $version;
	}

	/**
	 * Writes a meta value if the meta table exists; lifecycle steps must not fail on it.
	 * @param string $name
	 * @param string|null $value
	 */
	private static function safeMeta($name, $value) {
		try {
			if (ModernUI_Db_Model::tableExists(ModernUI_Schema_Model::META_TABLE)) {
				ModernUI_Schema_Model::setMeta($name, $value);
			}
		} catch (Throwable $e) {
			self::log('meta ' . $name . ': ' . $e->getMessage());
		}
	}

	/**
	 * @param string $message
	 */
	private static function log($message) {
		if (class_exists('Vtiger_Utils')) {
			Vtiger_Utils::Log('ModernUI: ' . $message);
		}
	}
}
