<?php
/*
 * Whether the theme is active for the current user on the current screen (docs/settings.md §3).
 *
 * Used by the link handler on every full page, by the Bootstrap action and by the settings pages.
 * Reads only loaded models and the settings rows (cached for the request); writes nothing except the
 * safe-mode flag of the session.
 */

require_once 'modules/ModernUI/models/Db.php';
require_once 'modules/ModernUI/models/Schema.php';
require_once 'modules/ModernUI/models/Settings.php';
require_once 'modules/ModernUI/models/Assets.php';
require_once 'modules/ModernUI/models/Locale.php';
require_once 'modules/ModernUI/models/Adapters.php';

class ModernUI_Activation_Model {

	const MODULE = 'ModernUI';
	const SAFE_MODE_KEY = 'modernui_safe_mode';

	const OK = 'OK';
	const MODULE_INACTIVE = 'MU_MODULE_INACTIVE';
	const UNSUPPORTED_VTIGER = 'MU_UNSUPPORTED_VTIGER';
	const SCHEMA_MISSING = 'MU_SCHEMA_MISSING';
	const SCHEMA_OUTDATED = 'MU_SCHEMA_OUTDATED';
	const SCHEMA_NEWER = 'MU_SCHEMA_NEWER';
	const RECOVERY_REQUIRED = 'MU_RECOVERY_REQUIRED';
	const NO_BUILD = 'MU_NO_BUILD';
	const SAFE_MODE = 'MU_SAFE_MODE';
	const THEME_OFF = 'MU_THEME_OFF';
	const NOT_IN_PILOT = 'MU_NOT_IN_PILOT';
	const STANDARD_VIEW = 'MU_STANDARD_VIEW';
	const SCREEN_EXCLUDED = 'MU_SCREEN_EXCLUDED';

	/** @var array per-request cache of the user context */
	private static $contexts = array();

	/**
	 * Vtiger version this module supports.
	 * @param string|null $version
	 * @return bool
	 */
	public static function isSupportedVtiger($version = null) {
		if ($version === null) {
			$version = function_exists('vglobal') ? vglobal('vtiger_current_version') : null;
		}
		return is_string($version) && preg_match('/^8\.4(\.|$)/', $version) === 1;
	}

	/**
	 * Applies ?modernui=off / ?modernui=on of the request to the session and tells whether safe mode is on.
	 * Safe mode never bypasses login, CSRF or permissions: it only stops sending the theme resources.
	 * @param array|null $request request parameters (defaults to $_REQUEST)
	 * @return bool
	 */
	public static function isSafeMode($request = null) {
		$request = $request === null ? $_REQUEST : $request;
		$switch = isset($request['modernui']) && is_string($request['modernui']) ? strtolower($request['modernui']) : '';
		$sessionActive = session_status() === PHP_SESSION_ACTIVE;
		if ($sessionActive && $switch === 'off') {
			$_SESSION[self::SAFE_MODE_KEY] = 1;
		} elseif ($sessionActive && $switch === 'on') {
			unset($_SESSION[self::SAFE_MODE_KEY]);
		}
		if ($switch === 'off') {
			return true;
		}
		return $sessionActive && !empty($_SESSION[self::SAFE_MODE_KEY]);
	}

	/**
	 * Role and its ancestors of a user (from the nearest ancestor to the root).
	 * @param string $roleId
	 * @return array
	 */
	public static function ancestorRoles($roleId) {
		if ($roleId === '') {
			return array();
		}
		$path = ModernUI_Db_Model::value('SELECT parentrole FROM vtiger_role WHERE roleid = ?', array($roleId));
		if (!is_string($path) || $path === '') {
			return array();
		}
		$parts = array_values(array_filter(explode('::', $path), 'strlen'));
		$ancestors = array();
		foreach (array_reverse($parts) as $part) {
			if ($part !== $roleId) {
				$ancestors[] = $part;
			}
		}
		return $ancestors;
	}

	/**
	 * Settings context of a user: role, effective settings, revisions.
	 * @param Users_Record_Model|null $user defaults to the current user
	 * @return array|null null without a user
	 */
	public static function context($user = null) {
		if ($user === null) {
			$user = Users_Record_Model::getCurrentUserModel();
		}
		if (!$user || !$user->getId()) {
			return null;
		}
		$userId = (int) $user->getId();
		if (!isset(self::$contexts[$userId])) {
			$roleId = (string) $user->get('roleid');
			$ancestors = self::ancestorRoles($roleId);
			$settings = ModernUI_Settings_Model::forUser($userId, $roleId, $ancestors);
			self::$contexts[$userId] = array(
				'userId' => $userId,
				'isAdmin' => $user->isAdminUser(),
				'roleId' => $roleId,
				'ancestors' => $ancestors,
				'crmLanguage' => (string) $user->get('language'),
				'settings' => $settings,
				// Changes with every saved settings document of the user, the role whose settings apply, the schema, the
				// build and the active adapters of extensions (their stylesheets are part of the tokens stylesheet): the URL
				// of the tokens stylesheet (cached for good by the browser) and the ETag rely on it.
				'cacheKey' => substr(sha1($userId . '|' . $roleId . '|' . (string) $settings['roleSource'] . '|' . json_encode($settings['revisions'])
					. '|' . ModernUI_Schema_Model::VERSION . '|' . ModernUI_Assets_Model::buildId()
					. '|' . ModernUI_Adapters_Model::fingerprint($settings['values'])), 0, 12),
			);
		}
		return self::$contexts[$userId];
	}

	/**
	 * Forgets cached contexts (after saving settings in the same request).
	 */
	public static function reset() {
		self::$contexts = array();
	}

	/**
	 * Whether the theme applies to a user by the settings only (mode, pilot, personal choice).
	 * @param array $values effective settings
	 * @param int $userId
	 * @param string $roleId
	 * @param array $ancestors
	 * @return string self::OK or the reason
	 */
	public static function evaluateSettings(array $values, $userId, $roleId, array $ancestors) {
		$mode = $values['theme.mode'];
		if ($mode === 'off') {
			return self::THEME_OFF;
		}
		if ($mode === 'pilot') {
			$member = in_array((int) $userId, $values['theme.pilot.users'], true)
				|| ($roleId !== '' && in_array($roleId, $values['theme.pilot.roles'], true));
			if (!$member && $values['theme.pilot.includeSubordinates']) {
				foreach ($ancestors as $ancestor) {
					if (in_array($ancestor, $values['theme.pilot.roles'], true)) {
						$member = true;
						break;
					}
				}
			}
			if (!$member && !($values['theme.allowSelfEnable'] && $values['user.selfEnabled'])) {
				return self::NOT_IN_PILOT;
			}
		}
		if ($values['theme.allowOptOut'] && $values['user.standardView']) {
			return self::STANDARD_VIEW;
		}
		return self::OK;
	}

	/**
	 * Whether a screen of the request matches the excluded screens.
	 * @param array $screens list of {module, view, parent}
	 * @param array $request
	 * @return bool
	 */
	public static function isScreenExcluded(array $screens, array $request) {
		$current = array();
		foreach (array('module', 'view', 'parent') as $part) {
			$current[$part] = isset($request[$part]) && is_string($request[$part]) ? $request[$part] : '';
		}
		if ($current['module'] === '') {
			$current['module'] = 'Home';
		}
		foreach ($screens as $screen) {
			$match = true;
			foreach ($current as $part => $value) {
				if ($screen[$part] !== '*' && strcasecmp($screen[$part], $value) !== 0) {
					$match = false;
					break;
				}
			}
			if ($match) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Full decision for the current user and request.
	 * @param array|null $request request parameters (defaults to $_REQUEST); null screen check when false
	 * @param bool $checkScreen
	 * @return array {active: bool, reason: string, context: array|null}
	 */
	public static function evaluate($request = null, $checkScreen = true) {
		$request = $request === null ? $_REQUEST : $request;
		$decision = array('active' => false, 'reason' => self::OK, 'context' => null);
		if (!vtlib_isModuleActive(self::MODULE)) {
			$decision['reason'] = self::MODULE_INACTIVE;
			return $decision;
		}
		if (!self::isSupportedVtiger()) {
			$decision['reason'] = self::UNSUPPORTED_VTIGER;
			return $decision;
		}
		$state = ModernUI_Schema_Model::state();
		if ($state !== ModernUI_Schema_Model::STATE_CURRENT) {
			$reasons = array(
				ModernUI_Schema_Model::STATE_MISSING => self::SCHEMA_MISSING,
				ModernUI_Schema_Model::STATE_OUTDATED => self::SCHEMA_OUTDATED,
				ModernUI_Schema_Model::STATE_NEWER => self::SCHEMA_NEWER,
			);
			$decision['reason'] = $reasons[$state];
			return $decision;
		}
		if (ModernUI_Schema_Model::recoveryRequired()) {
			$decision['reason'] = self::RECOVERY_REQUIRED;
			return $decision;
		}
		if (self::isSafeMode($request)) {
			$decision['reason'] = self::SAFE_MODE;
			return $decision;
		}
		$context = self::context();
		if ($context === null) {
			$decision['reason'] = self::THEME_OFF;
			return $decision;
		}
		$decision['context'] = $context;
		$values = $context['settings']['values'];
		$reason = self::evaluateSettings($values, $context['userId'], $context['roleId'], $context['ancestors']);
		if ($reason === self::OK && $checkScreen && (self::isScreenExcluded($values['theme.excludedScreens'], $request)
				|| ModernUI_Adapters_Model::screenLevel($values, $request) === ModernUI_Adapters_Model::LEVEL_STANDARD)) {
			// Excluded by the administrator, or a screen of an extension that its adapter keeps in the standard view.
			$reason = self::SCREEN_EXCLUDED;
		}
		if ($reason === self::OK && !ModernUI_Assets_Model::isAvailable()) {
			$reason = self::NO_BUILD;
		}
		$decision['reason'] = $reason;
		$decision['active'] = $reason === self::OK;
		return $decision;
	}
}
