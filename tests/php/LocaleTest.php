<?php
require_once 'modules/ModernUI/models/Locale.php';

test('locale: normalize() follows the shared map of tests/fixtures/locale-map.json', function () {
	$fixture = json_decode(file_get_contents(MU_REPO . '/tests/fixtures/locale-map.json'), true);
	foreach ($fixture['map'] as $code => $expected) {
		assert_same($expected, ModernUI_Locale_Model::normalize((string) $code), "normalize({$code})");
	}
	assert_same(null, ModernUI_Locale_Model::normalize(null), 'normalize(null)');
	assert_same(null, ModernUI_Locale_Model::normalize(array('ru')), 'normalize(array)');
});

test('locale: effective() order is personal, CRM language, common default, en-US', function () {
	$fixture = json_decode(file_get_contents(MU_REPO . '/tests/fixtures/locale-map.json'), true);
	foreach ($fixture['effective'] as $case) {
		$result = ModernUI_Locale_Model::effective($case['personal'], $case['crm'], $case['default']);
		assert_same($case['expect'], array($result['locale'], $result['source']), json_encode($case));
	}
});

test('locale: translate() uses the theme language, then English, then the key; fills {placeholders}', function () {
	assert_same('Сохранить', ModernUI_Locale_Model::translate('LBL_SAVE', 'ModernUI', 'ru-RU'));
	assert_same('Speichern', ModernUI_Locale_Model::translate('LBL_SAVE', 'ModernUI', 'de-DE'));
	assert_same('Save', ModernUI_Locale_Model::translate('LBL_SAVE', 'ModernUI', 'xx-XX'));
	assert_same('LBL_DOES_NOT_EXIST', ModernUI_Locale_Model::translate('LBL_DOES_NOT_EXIST', 'ModernUI', 'de-DE'));
	assert_same('Benutzer: 3, Rollen: 1', ModernUI_Locale_Model::translate('LBL_PILOT_COUNTS', 'Settings:ModernUI', 'de-DE', array('users' => 3, 'roles' => 1)));
});
