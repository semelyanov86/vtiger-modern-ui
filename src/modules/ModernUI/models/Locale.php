<?php
/*
 * Languages of ModernUI (docs/I18N.md): ru-RU, en-US, de-DE, English fallback.
 *
 * The same mapping table is used by the frontend (frontend/src/i18n/locale.ts); both are checked against
 * tests/fixtures/locale-map.json.
 */

class ModernUI_Locale_Model {

	const FALLBACK = 'en-US';

	/** Theme locales and the Vtiger language pack that holds their PHP texts. */
	public static $supported = array(
		'ru-RU' => 'ru_ru',
		'en-US' => 'en_us',
		'de-DE' => 'de_de',
	);

	/** Explicit aliases, compared in lower case with "-" turned into "_". */
	private static $aliases = array(
		'ru_ru' => 'ru-RU',
		'ru' => 'ru-RU',
		'en_us' => 'en-US',
		'en_gb' => 'en-US',
		'en' => 'en-US',
		'de_de' => 'de-DE',
		'de' => 'de-DE',
	);

	/**
	 * A Vtiger language code or a locale (ru_ru, ru, ru_RU, ru-RU …) as a theme locale, or null if unknown.
	 * @param mixed $code
	 * @return string|null
	 */
	public static function normalize($code) {
		if (!is_string($code) || $code === '') {
			return null;
		}
		$key = str_replace('-', '_', strtolower(trim($code)));
		return isset(self::$aliases[$key]) ? self::$aliases[$key] : null;
	}

	/**
	 * Effective locale of the theme and where it comes from (docs/I18N.md: personal choice → CRM language of
	 * the user → common default of the theme → en-US).
	 * @param string|null $personal value of the personal "locale" key ("auto" or a locale), null if not allowed
	 * @param string|null $crmLanguage language of the CRM user (ru_ru …)
	 * @param string|null $default "locale.default" of the theme settings ("auto" or a locale)
	 * @return array {locale: string, source: string}
	 */
	public static function effective($personal, $crmLanguage, $default) {
		if (is_string($personal) && isset(self::$supported[$personal])) {
			return array('locale' => $personal, 'source' => 'personal');
		}
		$crm = self::normalize($crmLanguage);
		if ($crm !== null) {
			return array('locale' => $crm, 'source' => 'crm');
		}
		if (is_string($default) && isset(self::$supported[$default])) {
			return array('locale' => $default, 'source' => 'global');
		}
		return array('locale' => self::FALLBACK, 'source' => 'fallback');
	}

	/**
	 * Text of the ModernUI dictionaries: the language of the theme, then English, then the key itself.
	 * Placeholders are written as {name}.
	 * @param string $key
	 * @param string $module ModernUI or Settings:ModernUI
	 * @param string $locale theme locale (ru-RU …)
	 * @param array $params
	 * @return string
	 */
	public static function translate($key, $module, $locale, array $params = array()) {
		$text = null;
		$languages = array();
		if (isset(self::$supported[$locale])) {
			$languages[] = self::$supported[$locale];
		}
		$languages[] = self::$supported[self::FALLBACK];
		foreach (array_unique($languages) as $language) {
			$strings = self::strings($language, $module);
			if (isset($strings[$key]) && is_string($strings[$key]) && $strings[$key] !== '') {
				$text = $strings[$key];
				break;
			}
		}
		if ($text === null) {
			$text = $key;
		}
		if ($params) {
			$replace = array();
			foreach ($params as $name => $value) {
				$replace['{' . $name . '}'] = (string) $value;
			}
			$text = strtr($text, $replace);
		}
		return $text;
	}

	/**
	 * Dictionary of one language pack of a ModernUI module (includes languages/custom overrides of Vtiger).
	 * @param string $language
	 * @param string $module
	 * @return array
	 */
	private static function strings($language, $module) {
		static $cache = array();
		$cacheKey = $language . '|' . $module;
		if (!isset($cache[$cacheKey])) {
			$strings = array();
			if (class_exists('Vtiger_Language_Handler')) {
				$loaded = Vtiger_Language_Handler::getModuleStringsFromFile($language, str_replace(':', '.', $module));
				if (isset($loaded['languageStrings']) && is_array($loaded['languageStrings'])) {
					$strings = $loaded['languageStrings'];
				}
			}
			$cache[$cacheKey] = $strings;
		}
		return $cache[$cacheKey];
	}
}
