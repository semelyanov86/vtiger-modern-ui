<?php
/*
 * Dictionaries of the PHP side (docs/I18N.md): same keys and placeholders in en_us, ru_ru and de_de, no empty
 * texts, German and Russian really translated, every key used by the templates and views exists, texts shared
 * with the Vue dictionaries are identical.
 */

function mu_dictionary($language, $module) {
	$languageStrings = array();
	require MU_SRC . "/languages/{$language}/{$module}.php";
	return $languageStrings;
}

function mu_placeholders($text) {
	preg_match_all('/\{([a-z][A-Za-z0-9_]*)\}/', $text, $matches);
	$names = $matches[1];
	sort($names);
	return $names;
}

$GLOBALS['mu_i18n_modules'] = array('ModernUI', 'Settings/ModernUI');

test('i18n: en_us, ru_ru and de_de have the same keys and placeholders, no empty texts', function () {
	foreach ($GLOBALS['mu_i18n_modules'] as $module) {
		$english = mu_dictionary('en_us', $module);
		foreach (array('ru_ru', 'de_de') as $language) {
			$other = mu_dictionary($language, $module);
			assert_same(array(), array_values(array_diff(array_keys($english), array_keys($other))), "{$language}/{$module}: missing keys");
			assert_same(array(), array_values(array_diff(array_keys($other), array_keys($english))), "{$language}/{$module}: extra keys");
			foreach ($english as $key => $text) {
				assert_true(is_string($other[$key]) && trim($other[$key]) !== '', "{$language}/{$module}: empty {$key}");
				assert_same(mu_placeholders($text), mu_placeholders($other[$key]), "{$language}/{$module}: placeholders of {$key}");
			}
		}
	}
});

test('i18n: German and Russian texts differ from English except the declared names', function () {
	$fixture = json_decode(file_get_contents(MU_REPO . '/tests/fixtures/shared-messages.json'), true);
	$same = $fixture['sameInAllLanguages']['php'];
	foreach ($GLOBALS['mu_i18n_modules'] as $module) {
		$english = mu_dictionary('en_us', $module);
		foreach (array('ru_ru', 'de_de') as $language) {
			foreach (mu_dictionary($language, $module) as $key => $text) {
				if (in_array("{$module}.{$key}", $same, true)) {
					continue;
				}
				assert_true($text !== $english[$key], "{$language}/{$module}: {$key} is a copy of the English text");
			}
		}
	}
	$german = implode(' ', mu_dictionary('de_de', 'Settings/ModernUI'));
	assert_true(preg_match('/[äöüß]/u', $german) === 1, 'German texts use umlauts and ß');
});

test('i18n: keys used by the templates and the views exist in the dictionaries', function () {
	$dictionaries = array(
		'ModernUI' => mu_dictionary('en_us', 'ModernUI'),
		'Settings:ModernUI' => mu_dictionary('en_us', 'Settings/ModernUI'),
	);
	$templates = array(
		'layouts/v7/modules/ModernUI/Preferences.tpl' => 'ModernUI',
		'layouts/v7/modules/ModernUI/PreferencesPreProcess.tpl' => 'ModernUI',
		'layouts/v7/modules/Settings/ModernUI/Index.tpl' => 'Settings:ModernUI',
	);
	foreach ($templates as $template => $module) {
		preg_match_all("/\\{mu_t key='([A-Z0-9_]+)'/", file_get_contents(MU_SRC . '/' . $template), $matches);
		foreach ($matches[1] as $key) {
			assert_true(isset($dictionaries[$module][$key]), "{$template}: {$key} is missing in {$module}");
		}
	}
	// Keys built from codes: reasons, schema states, modes, results of the forms.
	$reflection = new ReflectionClass('ModernUI_Activation_Model');
	foreach ($reflection->getConstants() as $name => $value) {
		if (is_string($value) && ($value === 'OK' || strpos($value, 'MU_') === 0) && $name !== 'MODULE' && $name !== 'SAFE_MODE_KEY') {
			assert_true(isset($dictionaries['ModernUI']["LBL_REASON_{$value}"]), "reason {$value}");
		}
	}
	foreach (array('current', 'outdated', 'newer', 'missing') as $state) {
		assert_true(isset($dictionaries['Settings:ModernUI']["LBL_SCHEMA_STATE_{$state}"]), "schema state {$state}");
	}
	foreach (array('off', 'pilot', 'all') as $mode) {
		assert_true(isset($dictionaries['Settings:ModernUI']["LBL_MODE_{$mode}"]), "mode {$mode}");
	}
	foreach (array('modules/ModernUI/views/Preferences.php' => 'ModernUI', 'modules/Settings/ModernUI/views/Index.php' => 'Settings:ModernUI') as $view => $module) {
		preg_match("/message\\(\\\$request, array\\((.*?)\\)\\)/s", file_get_contents(MU_SRC . '/' . $view), $match);
		preg_match_all("/'([a-z_]+)'/", isset($match[1]) ? $match[1] : '', $codes);
		assert_true(count($codes[1]) > 3, "{$view}: result codes found");
		foreach ($codes[1] as $code) {
			assert_true(isset($dictionaries[$module]['LBL_RESULT_' . strtoupper($code)]), "{$view}: result {$code}");
		}
	}
	foreach (array('auto', 'ru-RU', 'en-US', 'de-DE') as $locale) {
		assert_true(isset($dictionaries['ModernUI']["LBL_LOCALE_{$locale}"]), "locale {$locale}");
	}
});

test('i18n: texts shared with the Vue dictionaries are identical in every language', function () {
	$fixture = json_decode(file_get_contents(MU_REPO . '/tests/fixtures/shared-messages.json'), true);
	$languages = array('en_us' => 'en-US', 'ru_ru' => 'ru-RU', 'de_de' => 'de-DE');
	foreach ($languages as $language => $locale) {
		$vue = json_decode(file_get_contents(MU_REPO . "/frontend/src/i18n/locales/{$locale}.json"), true);
		foreach ($fixture['pairs'] as $pair) {
			$node = $vue;
			foreach (explode('.', $pair['vue']) as $part) {
				$node = isset($node[$part]) ? $node[$part] : null;
			}
			$php = mu_dictionary($language, str_replace(':', '/', $pair['php'][0]));
			assert_same($node, isset($php[$pair['php'][1]]) ? $php[$pair['php'][1]] : null, "{$locale}: {$pair['vue']} = {$pair['php'][1]}");
		}
	}
});
