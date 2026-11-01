<?php
/*
 * POST index.php?module=ModernUI&parent=Settings&action=Recovery — runs the missing migrations of the settings
 * schema again and re-creates the global links and the settings item (after an interrupted update, a failed
 * migration or manual damage). Administrators only, CSRF-checked; works without the frontend.
 */

require_once 'modules/ModernUI/models/Page.php';
require_once 'modules/ModernUI/models/Lifecycle.php';

class Settings_ModernUI_Recovery_Action extends Settings_Vtiger_Basic_Action {

	public function process(Vtiger_Request $request) {
		$report = ModernUI_Lifecycle_Model::migrate();
		if ($report['error'] === null && vtlib_isModuleActive('ModernUI')) {
			ModernUI_Lifecycle_Model::syncLinks();
		}
		ModernUI_Lifecycle_Model::addSettingsItem();
		$result = $report['error'] === null ? 'recovered' : 'error_recovery';
		ModernUI_Page_Model::redirect(ModernUI_Lifecycle_Model::SETTINGS_URL . '&result=' . $result);
	}
}
