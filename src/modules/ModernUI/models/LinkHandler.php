<?php
/*
 * Handler of the two global links of ModernUI (docs/architecture.md §3.2), called by Vtiger_Link::getAllByType()
 * for every full page: HEADERCSS (skin) and HEADERSCRIPT (loader of the Vue islands).
 *
 * Returns false (the link is not printed) unless the theme is active for the user and the screen. When it is,
 * the URL of the link is pointed at the current build: the hashed skin file, or the loader with the build id.
 * The registered URL of the skin names a file that does not exist, so if a core version ever passed a copy of
 * the link to the handler, Vtiger's file_exists() check would drop the link: the theme fails safe.
 * Any exception means "no theme on this page" instead of a broken CRM.
 */

require_once 'modules/ModernUI/models/Activation.php';

class ModernUI_LinkHandler_Model {

	const LABEL_SKIN = 'ModernUISkin';
	const LABEL_SHELL = 'ModernUIShell';

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
				$link->linkurl = ModernUI_Assets_Model::skinUrl() . '?b=' . $build . '&z=';
				return true;
			}
			if ($link->linktype === 'HEADERSCRIPT' && $link->linklabel === self::LABEL_SHELL) {
				// The core appends "?v=<version>" to every URL: "&z=" swallows it.
				$link->linkurl = ModernUI_Assets_Model::LOADER . '?b=' . $build . '&r=' . self::$decision['context']['cacheKey'] . '&z=';
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
}
