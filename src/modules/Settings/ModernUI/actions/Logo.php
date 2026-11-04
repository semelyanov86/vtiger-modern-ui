<?php
/*
 * POST index.php?module=ModernUI&parent=Settings&action=Logo&mode=upload (multipart, field "logo") — stores a logo
 * of the new interface (administrators only, CSRF-checked). The file is checked, re-encoded as PNG and saved under a
 * name the server chooses (ModernUI_Branding_Model); the answer names the file for branding.logo of the draft. The
 * settings are not changed here: the logo is used once the administrator saves the appearance.
 */

require_once 'modules/ModernUI/models/Branding.php';
require_once 'modules/ModernUI/models/Editor.php';
require_once 'modules/ModernUI/models/Page.php';

class Settings_ModernUI_Logo_Action extends Settings_Vtiger_Basic_Action {

	public function process(Vtiger_Request $request) {
		if ($request->getMode() !== 'upload') {
			ModernUI_Page_Model::json(null, array('code' => 'MU_BAD_REQUEST'), 400);
			return;
		}
		$stored = ModernUI_Branding_Model::storeUpload(isset($_FILES['logo']) ? $_FILES['logo'] : null);
		if (!$stored['ok']) {
			ModernUI_Page_Model::json(null, array('code' => $stored['code']), 400);
			return;
		}
		ModernUI_Branding_Model::cleanup(array_merge(ModernUI_Branding_Model::filesInUse(), array($stored['file'])));
		unset($stored['ok']);
		ModernUI_Page_Model::json($stored);
	}
}
