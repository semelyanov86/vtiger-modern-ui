<?php
/*
 * Data of the current user for the Vue islands (action=Bootstrap, docs/settings.md §7).
 * Only data of the current user; the user id itself is not sent. Texts are not sent either: the islands
 * translate codes and ids with their own dictionaries.
 */

require_once 'modules/ModernUI/models/Activation.php';
require_once 'modules/ModernUI/models/Lifecycle.php';
require_once 'modules/ModernUI/models/Tokens.php';
require_once 'modules/ModernUI/models/Menu.php';
require_once 'modules/ModernUI/models/Branding.php';
require_once 'modules/ModernUI/models/Adapters.php';

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
		$appearance = ModernUI_Tokens_Model::appearanceOf($values);
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
			// The settings entries of the v7 app menu (CRM settings, users) stay reachable when the theme replaces it.
			$system[] = array('id' => 'moduleSettings', 'url' => ModernUI_Lifecycle_Model::SETTINGS_URL);
			$system[] = array('id' => 'crmSettings', 'url' => 'index.php?module=Vtiger&parent=Settings&view=Index');
			$system[] = array('id' => 'users', 'url' => 'index.php?module=Users&parent=Settings&view=List');
		}

		return array(
			'v' => self::FORMAT,
			'build' => (string) ModernUI_Assets_Model::buildId(),
			'module' => ModernUI_Lifecycle_Model::moduleVersion(),
			'user' => array(
				'isAdmin' => (bool) $context['isAdmin'],
				'crmLanguage' => $context['crmLanguage'],
			),
			'locale' => array('effective' => $locale['locale'], 'source' => $locale['source'], 'default' => $values['locale.default']),
			'theme' => array(
				'active' => (bool) $decision['active'],
				'reason' => $decision['reason'],
				'mode' => $values['theme.mode'],
				'canOptOut' => (bool) $values['theme.allowOptOut'],
				'canSelfEnable' => (bool) $values['theme.allowSelfEnable'] && $values['theme.mode'] === 'pilot',
				'cacheKey' => $context['cacheKey'],
			),
			// The settings values and the CSS variables computed from them (the same map as action=Tokens).
			'appearance' => array_merge($appearance, array('tokens' => (object) ModernUI_Tokens_Model::forAppearance($appearance))),
			'branding' => ModernUI_Branding_Model::forClient($values, $locale['locale']),
			'menu' => array_merge(array('system' => $system), self::menu($values, $locale['locale'], (bool) $context['isAdmin'])),
			// Adapters of the active extensions (docs/architecture.md §7.6): client parts and screen rules.
			'adapters' => ModernUI_Adapters_Model::forClient($values),
			// Screens with the cloud layout (docs/architecture.md A15): the shell opens records of these modules over the list.
			'layout' => array('modules' => ModernUI_Tokens_Model::layoutModules($values)),
			'personal' => array(
				'values' => (object) $personal,
				'allowed' => $allowed,
				'revision' => $context['settings']['user']['revision'],
				// What applies without a personal value ("as the administrator set it"), for the allowed keys.
				'inherited' => (object) self::inherited($context['settings'], $allowed),
			),
		);
	}

	/**
	 * Effective values without the personal scope, for the keys the user may change.
	 * @param array $settings ModernUI_Settings_Model::forUser()
	 * @param array $allowed
	 * @return array
	 */
	private static function inherited(array $settings, array $allowed) {
		$values = ModernUI_Settings_Model::merge($settings['global']['values'], $settings['role']['values'], array());
		$inherited = array();
		foreach ($allowed as $key) {
			if (array_key_exists($key, $values) && strpos($key, 'user.') !== 0) {
				$inherited[$key] = $values[$key];
			}
		}
		return $inherited;
	}

	/**
	 * Menu of the user; a failure while reading the modules of the CRM leaves an empty menu (the system section,
	 * the way back to the standard view and to the settings, is always there).
	 * @param array $values
	 * @param string $locale
	 * @param bool $isAdmin
	 * @return array
	 */
	private static function menu(array $values, $locale, $isAdmin) {
		try {
			return array_merge(ModernUI_Menu_Model::build($values, $locale, $isAdmin), array(
				'modules' => ModernUI_Menu_Model::modules(),
				'entries' => ModernUI_Menu_Model::entries(),
			));
		} catch (Throwable $e) {
			if (class_exists('Vtiger_Utils')) {
				Vtiger_Utils::Log('ModernUI: menu: ' . $e->getMessage());
			}
			return array('groups' => array(), 'favorites' => array(), 'favoritesEnabled' => false, 'compact' => false, 'modules' => array(), 'entries' => array());
		}
	}
}
