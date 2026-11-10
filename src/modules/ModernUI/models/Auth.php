<?php
/* Public authentication presentation. Only public branding is read; native Users actions own authentication. */
require_once 'modules/ModernUI/models/Activation.php';
require_once 'modules/ModernUI/models/Branding.php';
require_once 'modules/ModernUI/models/Locale.php';

class ModernUI_Auth_Model {

	/** A null result makes the installed template render its original content, including without JavaScript. */
	public static function page($changePassword = false) {
		try {
			if (!vtlib_isModuleActive('ModernUI') || !ModernUI_Activation_Model::isSupportedVtiger()
				|| ModernUI_Activation_Model::isSafeMode() || ModernUI_Schema_Model::state() !== ModernUI_Schema_Model::STATE_CURRENT) {
				return null;
			}
			$manifest = ModernUI_Assets_Model::manifest();
			$entry = 'src/auth/auth.scss';
			if (!isset($manifest[$entry]['file']) || !is_file(ModernUI_Assets_Model::crmRoot() . '/' . ModernUI_Assets_Model::DIST . '/' . $manifest[$entry]['file'])) {
				return null;
			}
			$global = ModernUI_Settings_Model::decodeRow(ModernUI_Settings_Model::getRow('global', ''), 'global');
			$values = array_merge(ModernUI_Settings_Model::defaults(), $global['values']);
			$requested = isset($_GET['authlang']) ? ModernUI_Locale_Model::normalize($_GET['authlang']) : null;
			if (session_status() === PHP_SESSION_ACTIVE) {
				if ($requested !== null) {
					$_SESSION['modernui_auth_locale'] = $requested;
				} else {
					$requested = ModernUI_Locale_Model::normalize(isset($_SESSION['modernui_auth_locale']) ? $_SESSION['modernui_auth_locale'] : null);
				}
			}
			$locale = $requested ?: ModernUI_Locale_Model::effective(null, vglobal('default_language'), $values['locale.default'])['locale'];
			if ($requested === null && $values['locale.default'] !== 'auto') {
				$locale = $values['locale.default'];
			}
			$branding = ModernUI_Branding_Model::forClient($values, $locale);
			$company = Vtiger_CompanyDetails_Model::getInstanceById();
			$logo = $company->getLogo();
			$logoUrl = $branding['logoUrl'];
			// Encode the filename ourselves: native URL generation differs between installations.
			$name = $logo->get('imagename');
			if (!$logoUrl && is_string($name) && $name !== '' && !preg_match('#[/\\\\\x00]#', $name)
				&& is_file(ModernUI_Branding_Model::dir() . '/' . $name)) {
				$logoUrl = 'public.php?type=logo&key=' . rawurlencode($name);
			}
			$logoUrl = $logoUrl ?: 'layouts/v7/resources/Images/vtiger.png';
			$text = array();
			foreach (array('username', 'password', 'email', 'signIn', 'forgot', 'resetTitle', 'proceed', 'help', 'back', 'newPassword',
				'confirmPassword', 'savePassword', 'expired', 'invalidLogin', 'invalidRecovery', 'mailError', 'mailSent', 'mismatch', 'language') as $key) {
				$text[$key] = ModernUI_Locale_Model::translate('LBL_AUTH_' . $key, 'ModernUI', $locale);
			}
			$error = isset($_GET['error']) && is_string($_GET['error']) ? $_GET['error'] : '';
			$errors = array('login' => 'invalidLogin', 'fpError' => 'invalidRecovery', 'statusError' => 'mailError');
			$recovery = (isset($_GET['screen']) && $_GET['screen'] === 'recovery') || in_array($error, array('fpError', 'statusError'), true);
			$sent = isset($_GET['mailStatus']) && $_GET['mailStatus'] === 'success';
			$base = 'index.php?module=Users&view=Login&authlang=' . rawurlencode($locale);
			return array(
				'locale' => $locale, 'text' => $text, 'mode' => $changePassword ? 'change' : ($recovery ? 'recovery' : 'login'),
				'css' => ModernUI_Assets_Model::DIST . '/' . $manifest[$entry]['file'],
				'js' => ModernUI_Assets_Model::RESOURCES . '/auth.js?b=' . ModernUI_Assets_Model::buildId(),
				'logo' => $logoUrl, 'title' => $branding['title'] ?: (string) $company->get('organizationname'),
				'notice' => $branding['notice'], 'loginUrl' => $base, 'recoveryUrl' => $base . '&screen=recovery',
				'message' => isset($errors[$error]) ? $text[$errors[$error]] : ($sent ? $text['mailSent'] : ''),
				'success' => $sent && !isset($errors[$error]),
			);
		} catch (Throwable $e) {
			return null;
		}
	}
}
