<?php
/*
 * POST index.php?module=ModernUI&parent=Settings&action=Save&mode=…   (administrators only, CSRF-checked)
 *
 *   mode=save         scope=global|role, role=<roleid>, values=<JSON flat map: the whole document>,
 *                     baseRevision=<revision of the draft>, inherit=0|1 (role profiles) — optimistic locking:
 *                     another save in between gives MU_CONFLICT with the current revision, its author and time
 *   mode=previewMenu  values=<JSON navigation.* of a draft>, locale=<theme locale> — the menu of the draft with the
 *                     permissions of the current administrator; nothing is saved
 *   mode=deleteRole   role=<roleid>, baseRevision — removes a role profile
 *   mode=resetUser    user=<id> — removes the personal settings of a user
 *
 * Every value is validated by the schema (docs/settings.md §4); unknown keys, markup in labels, colours out of range,
 * routes with foreign parameters are refused with the path of the offending field.
 */

require_once 'modules/ModernUI/models/Editor.php';
require_once 'modules/ModernUI/models/Page.php';

class Settings_ModernUI_Save_Action extends Settings_Vtiger_Basic_Action {

	public function process(Vtiger_Request $request) {
		$state = ModernUI_Schema_Model::state(true);
		if ($state !== ModernUI_Schema_Model::STATE_CURRENT) {
			ModernUI_Page_Model::json(null, array('code' => $state === ModernUI_Schema_Model::STATE_NEWER ? 'MU_SCHEMA_NEWER' : 'MU_SCHEMA_OUTDATED'), 409);
			return;
		}
		$userId = (int) Users_Record_Model::getCurrentUserModel()->getId();
		switch ($request->getMode()) {
			case 'save':
				$values = ModernUI_Page_Model::jsonParam($request, 'values');
				$result = $values === null ? ModernUI_Editor_Model::failure(400, 'MU_BAD_REQUEST')
					: ModernUI_Editor_Model::saveScope((string) $request->get('scope'), (string) $request->get('role'), $values,
						(int) $request->get('baseRevision'), $request->get('inherit') === '1', $userId);
				break;
			case 'previewMenu':
				$values = ModernUI_Page_Model::jsonParam($request, 'values');
				$result = $values === null ? ModernUI_Editor_Model::failure(400, 'MU_BAD_REQUEST')
					: ModernUI_Editor_Model::previewMenu($values, (string) $request->get('locale'));
				break;
			case 'deleteRole':
				$result = ModernUI_Editor_Model::deleteRole((string) $request->get('role'), (int) $request->get('baseRevision'));
				break;
			case 'resetUser':
				$result = ModernUI_Editor_Model::resetUser($request->get('user'));
				break;
			default:
				$result = ModernUI_Editor_Model::failure(400, 'MU_BAD_REQUEST');
		}
		ModernUI_Page_Model::respond($result);
	}
}
