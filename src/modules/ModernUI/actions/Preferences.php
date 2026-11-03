<?php
/*
 * POST index.php?module=ModernUI&action=Preferences&mode=save|clear — personal settings of the current user.
 * (Not mode=reset: WebUI.php of Vtiger skips csrf-magic for mode=reset, the password reset of the login page.)
 *
 * The scope key is always the user of the session; only the keys the administrator allows are accepted
 * (MU_FORBIDDEN_KEY otherwise). Works for the Vue islands (fetch with X-Requested-With, JSON "values")
 * and for the server form of the preferences page (form fields, redirect back).
 */

require_once 'modules/ModernUI/models/Page.php';

class ModernUI_Preferences_Action extends Vtiger_Action_Controller {

	public function requiresPermission(Vtiger_Request $request) {
		return array();
	}

	public function checkPermission(Vtiger_Request $request) {
		return true;
	}

	public function validateRequest(Vtiger_Request $request) {
		return $request->validateWriteAccess();
	}

	public function process(Vtiger_Request $request) {
		$json = ModernUI_Page_Model::wantsJson();
		$error = $this->check();
		if ($error !== null) {
			$this->finish($json, null, array('code' => $error));
			return;
		}
		$user = Users_Record_Model::getCurrentUserModel();
		$userId = (int) $user->getId();
		$mode = $request->getMode();
		if ($mode === 'clear') {
			ModernUI_Settings_Model::reset(ModernUI_Settings_Model::SCOPE_USER, (string) $userId);
			ModernUI_Activation_Model::reset();
			$this->finish($json, array('revision' => 0), null, 'reset');
			return;
		}
		if ($mode !== 'save') {
			$this->finish($json, null, array('code' => 'MU_BAD_REQUEST'));
			return;
		}

		$context = ModernUI_Activation_Model::context($user);
		$allowed = ModernUI_Settings_Model::allowedUserKeys($context['settings']['values']);
		$changes = $json ? $this->changesFromJson($request) : $this->changesFromForm($request, $allowed);
		if ($changes === null) {
			$this->finish($json, null, array('code' => 'MU_BAD_REQUEST'));
			return;
		}
		$checked = ModernUI_Settings_Model::validate(ModernUI_Settings_Model::SCOPE_USER, array_filter($changes, function ($value) {
			return $value !== null;
		}), $allowed);
		foreach ($changes as $key => $value) {
			if ($value === null && !in_array($key, $allowed, true)) {
				$checked['errors'][] = array('key' => $key, 'code' => 'MU_FORBIDDEN_KEY');
			}
		}
		if ($checked['errors']) {
			$first = $checked['errors'][0];
			$this->finish($json, null, array('code' => $first['code'], 'params' => array('key' => $first['key'])));
			return;
		}
		$apply = $checked['values'];
		foreach ($changes as $key => $value) {
			if ($value === null) {
				$apply[$key] = null;
			}
		}
		$result = ModernUI_Settings_Model::update(ModernUI_Settings_Model::SCOPE_USER, (string) $userId, $apply, $userId);
		ModernUI_Activation_Model::reset();
		if (!$result['ok']) {
			$this->finish($json, null, array('code' => 'MU_CONFLICT', 'params' => array('revision' => $result['revision'])));
			return;
		}
		$this->finish($json, array('revision' => $result['revision']), null, 'saved');
	}

	/**
	 * Why the action cannot run, or null.
	 * @return string|null
	 */
	private function check() {
		if (!vtlib_isModuleActive('ModernUI')) {
			return 'MU_MODULE_INACTIVE';
		}
		$state = ModernUI_Schema_Model::state();
		if ($state === ModernUI_Schema_Model::STATE_NEWER) {
			return 'MU_SCHEMA_NEWER';
		}
		return $state === ModernUI_Schema_Model::STATE_CURRENT ? null : 'MU_SCHEMA_OUTDATED';
	}

	/**
	 * "values" as a JSON object of dotted keys; null removes a personal value.
	 * @param Vtiger_Request $request
	 * @return array|null
	 */
	private function changesFromJson(Vtiger_Request $request) {
		$raw = $request->getRaw('values');
		if (!is_string($raw) || strlen($raw) > 16384) {
			return null;
		}
		$values = json_decode($raw, true);
		return is_array($values) && (!$values || array_keys($values) !== range(0, count($values) - 1)) ? $values : null;
	}

	/**
	 * Fields of the server form: locale, density, fontScale, standardView, selfEnabled (only the allowed ones are
	 * on the form). An empty density or text size removes the personal value: the administrator's value applies.
	 * @param Vtiger_Request $request
	 * @param array $allowed
	 * @return array
	 */
	private function changesFromForm(Vtiger_Request $request, array $allowed) {
		$changes = array();
		if (in_array('locale', $allowed, true) && $request->has('locale')) {
			$changes['locale'] = (string) $request->get('locale');
		}
		foreach (array('density' => 'appearance.density', 'fontScale' => 'appearance.fontScale') as $field => $key) {
			if (in_array($key, $allowed, true) && $request->has($field)) {
				$value = (string) $request->get($field);
				$changes[$key] = $value === '' ? null : $value;
			}
		}
		if (in_array('user.standardView', $allowed, true)) {
			$changes['user.standardView'] = $request->get('standardView') === '1';
		}
		if (in_array('user.selfEnabled', $allowed, true)) {
			$changes['user.selfEnabled'] = $request->get('selfEnabled') === '1';
		}
		return $changes;
	}

	/**
	 * @param bool $json
	 * @param array|null $result
	 * @param array|null $error
	 * @param string $resultCode code shown on the preferences page after a form post
	 */
	private function finish($json, $result, $error, $resultCode = '') {
		if ($json) {
			ModernUI_Page_Model::json($result, $error, $error === null ? 200 : 400);
			return;
		}
		$code = $error === null ? $resultCode : 'error_' . strtolower(str_replace('MU_', '', $error['code']));
		ModernUI_Page_Model::redirect('index.php?module=ModernUI&view=Preferences&result=' . rawurlencode($code));
	}
}
