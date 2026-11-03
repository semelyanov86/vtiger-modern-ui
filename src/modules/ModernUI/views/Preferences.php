<?php
/*
 * GET index.php?module=ModernUI&view=Preferences — personal preferences of the theme for any logged-in user.
 *
 * A plain server form: it works when the frontend is broken or blocked, so a user can always switch the
 * new interface off for themselves (if the administrator allows it). The full editor comes with stage 05.
 */

require_once 'modules/ModernUI/models/Page.php';

class ModernUI_Preferences_View extends Vtiger_Basic_View {

	private $locale = null;

	public function requiresPermission(Vtiger_Request $request) {
		return array();
	}

	public function checkPermission(Vtiger_Request $request) {
		if (!vtlib_isModuleActive('ModernUI')) {
			throw new AppException(vtranslate('LBL_PERMISSION_DENIED'));
		}
		return true;
	}

	/**
	 * @param Vtiger_Request $request
	 * @return Vtiger_Viewer
	 */
	public function getViewer(Vtiger_Request $request) {
		$viewer = parent::getViewer($request);
		if ($this->locale === null) {
			$this->locale = ModernUI_Page_Model::locale();
		}
		ModernUI_Page_Model::registerPlugins($viewer, 'ModernUI', $this->locale['locale']);
		return $viewer;
	}

	public function getPageTitle(Vtiger_Request $request) {
		if ($this->locale === null) {
			$this->locale = ModernUI_Page_Model::locale();
		}
		return ModernUI_Locale_Model::translate('LBL_PREFERENCES_TITLE', 'ModernUI', $this->locale['locale']);
	}

	protected function preProcessTplName(Vtiger_Request $request) {
		return 'PreferencesPreProcess.tpl';
	}

	public function postProcess(Vtiger_Request $request) {
		$viewer = $this->getViewer($request);
		$viewer->view('PreferencesPostProcess.tpl', $request->getModule());
		parent::postProcess($request);
	}

	public function process(Vtiger_Request $request) {
		$viewer = $this->getViewer($request);
		$state = ModernUI_Schema_Model::state();
		$ready = $state === ModernUI_Schema_Model::STATE_CURRENT;
		$viewer->assign('MU_READY', $ready);
		$viewer->assign('MU_LOCALE', $this->locale['locale']);
		$viewer->assign('MU_MESSAGE', ModernUI_Page_Model::message($request, array(
			'saved', 'reset', 'error_forbidden_key', 'error_invalid_value', 'error_conflict', 'error_bad_request',
			'error_schema_outdated', 'error_schema_newer', 'error_module_inactive',
		)));
		$viewer->assign('MU_SAFE_MODE', ModernUI_Activation_Model::isSafeMode(array()));
		$viewer->assign('MU_CSRF', function_exists('csrf_get_tokens') ? csrf_get_tokens() : '');
		if ($ready) {
			$decision = ModernUI_Activation_Model::evaluate(array(), false);
			$context = ModernUI_Activation_Model::context();
			$values = $context['settings']['values'];
			$allowed = ModernUI_Settings_Model::allowedUserKeys($values);
			$viewer->assign('MU_ACTIVE', $decision['active']);
			$viewer->assign('MU_REASON', $decision['reason']);
			$viewer->assign('MU_MODE', $values['theme.mode']);
			$viewer->assign('MU_CAN_LOCALE', in_array('locale', $allowed, true));
			$viewer->assign('MU_CAN_DENSITY', in_array('appearance.density', $allowed, true));
			$viewer->assign('MU_CAN_FONT_SCALE', in_array('appearance.fontScale', $allowed, true));
			$personal = $context['settings']['user']['values'];
			$viewer->assign('MU_CAN_OPT_OUT', in_array('user.standardView', $allowed, true) && $values['theme.mode'] !== 'off');
			$viewer->assign('MU_CAN_SELF_ENABLE', in_array('user.selfEnabled', $allowed, true) && $values['theme.mode'] === 'pilot');
			$viewer->assign('MU_VALUES', array(
				'locale' => $values['locale'],
				'standardView' => (bool) $values['user.standardView'],
				'selfEnabled' => (bool) $values['user.selfEnabled'],
				// Personal choice only ('' = as the administrator set it); the effective value is shown separately.
				'density' => isset($personal['appearance.density']) ? (string) $personal['appearance.density'] : '',
				'fontScale' => isset($personal['appearance.fontScale']) ? (string) $personal['appearance.fontScale'] : '',
			));
			$viewer->assign('MU_DENSITIES', array('compact', 'standard', 'comfortable'));
			$viewer->assign('MU_FONT_SCALES', array('90', '100', '110', '125'));
			$viewer->assign('MU_HAS_PERSONAL', $context['settings']['user']['revision'] > 0);
		}
		$viewer->assign('MU_LOCALES', array('auto', 'ru-RU', 'en-US', 'de-DE'));
		$viewer->view('Preferences.tpl', $request->getModule());
	}
}
