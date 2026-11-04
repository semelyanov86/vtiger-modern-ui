<?php
/*
 * GET index.php?module=ModernUI&parent=Settings&view=Index — Settings → Other settings → ModernUI.
 *
 * Administrators only (Settings_Vtiger_Index_View). The status and the switches are a plain server page with
 * HTML forms, so the theme can be switched off and the schema repaired even when the frontend is broken. The
 * settings editor (Vue, frontend/src/settings) mounts above them; "&editor=off" leaves the server page alone.
 * A small Vue island checks the frontend build in the browser.
 */

require_once 'modules/ModernUI/models/Page.php';
require_once 'modules/ModernUI/models/Lifecycle.php';
require_once 'modules/ModernUI/models/Pilot.php';

class Settings_ModernUI_Index_View extends Settings_Vtiger_Index_View {

	private $locale = null;

	/**
	 * @param Vtiger_Request $request
	 * @return Vtiger_Viewer
	 */
	public function getViewer(Vtiger_Request $request) {
		$viewer = parent::getViewer($request);
		if ($this->locale === null) {
			$this->locale = ModernUI_Page_Model::locale();
		}
		ModernUI_Page_Model::registerPlugins($viewer, 'Settings:ModernUI', $this->locale['locale']);
		return $viewer;
	}

	public function getPageTitle(Vtiger_Request $request) {
		return 'ModernUI';
	}

	public function process(Vtiger_Request $request) {
		$viewer = $this->getViewer($request);
		$user = Users_Record_Model::getCurrentUserModel();
		$schemaState = ModernUI_Schema_Model::state(true);
		$moduleActive = vtlib_isModuleActive('ModernUI');
		$vtigerVersion = (string) vglobal('vtiger_current_version');

		$status = array(
			'moduleVersion' => ModernUI_Lifecycle_Model::moduleVersion(),
			'moduleActive' => $moduleActive,
			'vtigerVersion' => $vtigerVersion,
			'vtigerSupported' => ModernUI_Activation_Model::isSupportedVtiger($vtigerVersion),
			'build' => ModernUI_Assets_Model::buildId(),
			'buildAvailable' => ModernUI_Assets_Model::isAvailable(),
			'schemaState' => $schemaState,
			'schemaDb' => ModernUI_Schema_Model::getDbVersion(),
			'schemaCode' => ModernUI_Schema_Model::VERSION,
			'lastError' => ModernUI_Schema_Model::getMeta('last_error'),
			'notice' => ModernUI_Schema_Model::getMeta('notice'),
			'linksOk' => $this->linksRegistered(),
		);
		$viewer->assign('MU_STATUS', $status);
		$viewer->assign('MU_LOCALE', $this->locale['locale']);
		$viewer->assign('MU_CSRF', function_exists('csrf_get_tokens') ? csrf_get_tokens() : '');
		$viewer->assign('MU_SAFE_MODE', ModernUI_Activation_Model::isSafeMode(array()));
		$viewer->assign('MU_MESSAGE', ModernUI_Page_Model::message($request, array(
			'enabled_for_me', 'disabled_for_me', 'disabled_for_all', 'pilot_added', 'pilot_removed', 'recovered', 'unchanged',
			'error_recovery', 'error_schema', 'error_conflict', 'error_bad_request',
		)));

		$ready = $schemaState === ModernUI_Schema_Model::STATE_CURRENT;
		$viewer->assign('MU_READY', $ready);
		if ($ready) {
			$context = ModernUI_Activation_Model::context($user);
			$values = $context['settings']['values'];
			$decision = ModernUI_Activation_Model::evaluate(array(), false);
			$inPilot = in_array((int) $user->getId(), $values['theme.pilot.users'], true);
			$viewer->assign('MU_THEME', array(
				'mode' => $values['theme.mode'],
				'pilotUsers' => count($values['theme.pilot.users']),
				'pilotRoles' => count($values['theme.pilot.roles']),
				'inPilot' => $inPilot,
				'activeForMe' => $decision['active'],
				'reason' => $decision['reason'],
				'standardView' => (bool) $values['user.standardView'] && (bool) $values['theme.allowOptOut'],
			));
			// "Enable for me": from "off" it starts a pilot (keeping the saved pilot lists), in a pilot it adds the
			// administrator (docs/settings.md §3).
			$viewer->assign('MU_CAN_ENABLE_FOR_ME', $moduleActive && $status['vtigerSupported']
				&& ($values['theme.mode'] === 'off' || ($values['theme.mode'] === 'pilot' && !$inPilot)));
			$viewer->assign('MU_CAN_DISABLE_FOR_ME', $values['theme.mode'] === 'pilot' && $inPilot);
			$viewer->assign('MU_CAN_DISABLE_FOR_ALL', $values['theme.mode'] !== 'off');
			$viewer->assign('MU_SETTINGS_WARNINGS', count($context['settings']['errors']));
			// Pilot users and roles (plain forms; the full editor of users and roles comes with the settings editor).
			$viewer->assign('MU_PILOT', $moduleActive && $status['vtigerSupported'] && $values['theme.mode'] !== 'all'
				? ModernUI_Pilot_Model::overview($values['theme.pilot.users'], $values['theme.pilot.roles']) : null);
		}

		// The settings editor (Vue) works while the module is switched off too: an administrator prepares the theme
		// before enabling it. "editor=off" is the page without it (switches, pilot forms, recovery) for a broken frontend.
		$tags = ModernUI_Assets_Model::entryTags(ModernUI_Assets_Model::ENTRY_SETTINGS);
		$editorOff = $request->get('editor') === 'off';
		$viewer->assign('MU_ASSETS', $tags);
		$viewer->assign('MU_EDITOR', $ready && !$editorOff && $tags['script'] !== null);
		$viewer->assign('MU_EDITOR_OFF', $editorOff);
		$viewer->assign('MU_BUILD', (string) ModernUI_Assets_Model::buildId());
		$viewer->view('Index.tpl', $request->getModule(false));
	}

	/**
	 * Both global links exist exactly once (only meaningful while the module is enabled).
	 * @return bool
	 */
	private function linksRegistered() {
		foreach (ModernUI_Lifecycle_Model::links() as $link) {
			$count = ModernUI_Db_Model::value('SELECT COUNT(*) AS n FROM vtiger_links WHERE tabid = 0 AND linktype = ? AND linklabel = ?',
				array($link['type'], $link['label']));
			if ((int) $count !== 1) {
				return false;
			}
		}
		return true;
	}
}
