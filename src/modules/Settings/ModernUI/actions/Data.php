<?php
/*
 * GET index.php?module=ModernUI&parent=Settings&action=Data — data of the settings editor (Settings → ModernUI):
 * stored documents with their revisions, roles, users, the module catalog of the menu. Administrators only
 * (Settings_Vtiger_Index_View::checkPermission), Referer checked by the core; nothing is written.
 */

require_once 'modules/ModernUI/models/Editor.php';
require_once 'modules/ModernUI/models/Page.php';

class Settings_ModernUI_Data_Action extends Settings_Vtiger_Basic_Action {

	public function validateRequest(Vtiger_Request $request) {
		return $request->validateReadAccess();
	}

	public function process(Vtiger_Request $request) {
		$state = ModernUI_Schema_Model::state(true);
		if ($state !== ModernUI_Schema_Model::STATE_CURRENT) {
			ModernUI_Page_Model::json(null, array('code' => $state === ModernUI_Schema_Model::STATE_NEWER ? 'MU_SCHEMA_NEWER' : 'MU_SCHEMA_OUTDATED'), 409);
			return;
		}
		ModernUI_Page_Model::json(ModernUI_Editor_Model::data());
	}
}
