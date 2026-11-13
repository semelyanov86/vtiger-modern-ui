<?php
/*
 * Handler of the global links of ModernUI (docs/architecture.md §3.2), called by Vtiger_Link::getAllByType()
 * for every full page: HEADERCSS (skin), HEADERCSS (design tokens of the user) and HEADERSCRIPT (loader of the
 * Vue islands).
 *
 * Returns false (the link is not printed) unless the theme is active for the user and the screen. When it is,
 * the URL of the link is pointed at the current build: the hashed skin file, the tokens stylesheet of the user's
 * settings revision, or the loader with the build id. The registered URLs of the stylesheets name files that do
 * not exist, so if a core version ever passed a copy of the link to the handler, Vtiger's file_exists() check
 * would drop the link: the theme fails safe.
 * Any exception means "no theme on this page" instead of a broken CRM.
 */

require_once 'modules/ModernUI/models/Activation.php';

class ModernUI_LinkHandler_Model {

	const LABEL_SKIN = 'ModernUISkin';
	const LABEL_SHELL = 'ModernUIShell';
	const LABEL_TOKENS = 'ModernUITokens';

	/** Action that prints the tokens stylesheet; index.php exists, so the core prints the link. */
	const TOKENS_URL = 'index.php?module=ModernUI&action=Tokens';

	/** @var array|null decision cached for the request */
	private static $decision = null;

	/**
	 * @param Vtiger_LinkData $linkData
	 * @return bool
	 */
	public static function filter($linkData) {
		try {
			$link = $linkData->getLink();
			if (!is_object($link)) {
				return false;
			}
			if (self::$decision === null) {
				self::$decision = ModernUI_Activation_Model::evaluate();
			}
			if (!self::$decision['active']) {
				return false;
			}
			$build = ModernUI_Assets_Model::buildId();
			if ($link->linktype === 'HEADERCSS' && $link->linklabel === self::LABEL_SKIN) {
				$link->linkurl = ModernUI_Assets_Model::skinUrl(self::skinPreset()) . '?b=' . $build . '&z=';
				return true;
			}
			if ($link->linktype === 'HEADERCSS' && $link->linklabel === self::LABEL_TOKENS) {
				$link->linkurl = self::TOKENS_URL . '&r=' . self::$decision['context']['cacheKey'] . '&z=';
				return true;
			}
			if ($link->linktype === 'HEADERSCRIPT' && $link->linklabel === self::LABEL_SHELL) {
				// The core appends "?v=<version>" to every URL: "&z=" swallows it.
				$link->linkurl = ModernUI_Assets_Model::LOADER . '?b=' . $build . '&z=';
				return true;
			}
			return false;
		} catch (Throwable $e) {
			return false;
		}
	}

	/**
	 * Forgets the cached decision (tests).
	 */
	public static function reset() {
		self::$decision = null;
	}

	/** Initial geometry only; loader.js verifies native DOM capabilities before the host's ready handlers. */
	public static function skinPreset() {
		$module = isset($_REQUEST['module']) && is_string($_REQUEST['module']) ? $_REQUEST['module'] : '';
		$view = isset($_REQUEST['view']) && is_string($_REQUEST['view']) ? $_REQUEST['view'] : '';
		$parent = isset($_REQUEST['parent']) && is_string($_REQUEST['parent']) ? $_REQUEST['parent'] : '';
		if ($parent === 'Settings' || ($module === 'Users' && in_array($view, array('PreferenceDetail', 'PreferenceEdit'), true))) {
			if ($module === 'Vtiger' && $view === 'Index') {
				return 'settings-home';
			}
			return $module === 'ModernUI' ? 'settings-own' : 'settings';
		}
		return $view === 'List' || $module === 'RecycleBin' ? 'list' : 'default';
	}
}
