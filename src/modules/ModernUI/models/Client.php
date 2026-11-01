<?php
/*
 * Data of the current user for the Vue islands (action=Bootstrap, docs/settings.md §7).
 * Only data of the current user; the user id itself is not sent. Texts are not sent either: the islands
 * translate codes and ids with their own dictionaries.
 */

require_once 'modules/ModernUI/models/Activation.php';
require_once 'modules/ModernUI/models/Lifecycle.php';

class ModernUI_Client_Model {

	const FORMAT = 1;

	/**
	 * @param array $decision ModernUI_Activation_Model::evaluate() for the current user
	 * @return array
	 */
	public static function bootstrap(array $decision) {
		$context = $decision['context'];
		if ($context === null) {
			$context = ModernUI_Activation_Model::context();
		}
		$values = $context['settings']['values'];
		$allowed = ModernUI_Settings_Model::allowedUserKeys($values);
		$personalLocale = in_array('locale', $allowed, true) ? $values['locale'] : null;
		$locale = ModernUI_Locale_Model::effective($personalLocale, $context['crmLanguage'], $values['locale.default']);

		$personal = array();
		foreach ($context['settings']['user']['values'] as $key => $value) {
			if (in_array($key, $allowed, true)) {
				$personal[$key] = $value;
			}
		}

		$system = array(
			array('id' => 'preferences', 'url' => 'index.php?module=ModernUI&view=Preferences'),
		);
		if (in_array('user.standardView', $allowed, true)) {
			$system[] = array('id' => 'standardView', 'action' => 'standardView');
		}
		$system[] = array('id' => 'safeMode', 'url' => 'index.php?modernui=off');
		if ($context['isAdmin']) {
			$system[] = array('id' => 'moduleSettings', 'url' => ModernUI_Lifecycle_Model::SETTINGS_URL);
			$system[] = array('id' => 'crmSettings', 'url' => 'index.php?module=Vtiger&parent=Settings&view=Index');
		}

		return array(
			'v' => self::FORMAT,
			'build' => (string) ModernUI_Assets_Model::buildId(),
			'module' => ModernUI_Lifecycle_Model::moduleVersion(),
			'user' => array(
				'isAdmin' => (bool) $context['isAdmin'],
				'crmLanguage' => $context['crmLanguage'],
			),
			'locale' => array('effective' => $locale['locale'], 'source' => $locale['source']),
			'theme' => array(
				'active' => (bool) $decision['active'],
				'reason' => $decision['reason'],
				'mode' => $values['theme.mode'],
				'canOptOut' => (bool) $values['theme.allowOptOut'],
				'canSelfEnable' => (bool) $values['theme.allowSelfEnable'] && $values['theme.mode'] === 'pilot',
				'cacheKey' => $context['cacheKey'],
			),
			'appearance' => array(
				'primaryColor' => $values['appearance.primaryColor'],
				'background' => $values['appearance.background'],
				'surface' => $values['appearance.surface'],
				'density' => $values['appearance.density'],
				'fontScale' => $values['appearance.fontScale'],
				'font' => $values['appearance.font'],
			),
			'menu' => array('system' => $system),
			'personal' => array(
				'values' => (object) $personal,
				'allowed' => $allowed,
				'revision' => $context['settings']['user']['revision'],
			),
		);
	}
}
