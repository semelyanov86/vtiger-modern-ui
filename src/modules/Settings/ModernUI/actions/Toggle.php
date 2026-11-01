<?php
/*
 * POST index.php?module=ModernUI&parent=Settings&action=Toggle&mode=enableForMe|disableForMe|disableForAll
 *
 * Administrators only, CSRF-checked (Settings_Vtiger_Basic_Action). A plain HTML form posts here, so the theme
 * can be switched without the frontend. "Enable for me" turns an "off" theme into a pilot with the current
 * administrator (docs/settings.md §3): first the administrator, then the others.
 */

require_once 'modules/ModernUI/models/Page.php';

class Settings_ModernUI_Toggle_Action extends Settings_Vtiger_Basic_Action {

	public function process(Vtiger_Request $request) {
		if (ModernUI_Schema_Model::state(true) !== ModernUI_Schema_Model::STATE_CURRENT) {
			$this->back('error_schema');
			return;
		}
		$userId = (int) Users_Record_Model::getCurrentUserModel()->getId();
		$global = ModernUI_Settings_Model::decodeRow(
			ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_GLOBAL, ''), ModernUI_Settings_Model::SCOPE_GLOBAL);
		$values = array_merge(ModernUI_Settings_Model::defaults(), $global['values']);
		$users = $values['theme.pilot.users'];
		$changes = array();
		$result = 'unchanged';

		switch ($request->getMode()) {
			case 'enableForMe':
				if (!ModernUI_Activation_Model::isSupportedVtiger() || !vtlib_isModuleActive('ModernUI')) {
					$this->back('error_bad_request');
					return;
				}
				if ($values['theme.mode'] === 'off') {
					$changes['theme.mode'] = 'pilot';
				}
				if ($values['theme.mode'] !== 'all' && !in_array($userId, $users, true)) {
					$users[] = $userId;
					$changes['theme.pilot.users'] = $users;
				}
				$result = $changes ? 'enabled_for_me' : 'unchanged';
				break;
			case 'disableForMe':
				if (in_array($userId, $users, true)) {
					$changes['theme.pilot.users'] = array_values(array_diff($users, array($userId)));
					$result = 'disabled_for_me';
				}
				break;
			case 'disableForAll':
				if ($values['theme.mode'] !== 'off') {
					$changes['theme.mode'] = 'off';
					$result = 'disabled_for_all';
				}
				break;
			default:
				$this->back('error_bad_request');
				return;
		}

		if ($changes) {
			$checked = ModernUI_Settings_Model::validate(ModernUI_Settings_Model::SCOPE_GLOBAL, $changes);
			if ($checked['errors']) {
				$this->back('error_bad_request');
				return;
			}
			$saved = ModernUI_Settings_Model::save(ModernUI_Settings_Model::SCOPE_GLOBAL, '',
				array_merge($global['values'], $checked['values']), $global['revision'], $userId, $global['meta']);
			if (!$saved['ok']) {
				$this->back('error_conflict');
				return;
			}
			if ($result === 'enabled_for_me') {
				// The administrator has seen the "reinstalled, theme switched off" notice.
				ModernUI_Schema_Model::setMeta('notice', null);
			}
		}
		$this->back($result);
	}

	/**
	 * @param string $result
	 */
	private function back($result) {
		ModernUI_Page_Model::redirect(ModernUI_Lifecycle_Model::SETTINGS_URL . '&result=' . rawurlencode($result));
	}
}
