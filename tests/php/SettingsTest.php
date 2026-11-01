<?php
require_once 'modules/ModernUI/models/Settings.php';

test('settings: defaults of schema 1 switch the theme off and allow the documented personal keys', function () {
	$defaults = ModernUI_Settings_Model::defaults();
	assert_same('off', $defaults['theme.mode']);
	assert_same(true, $defaults['theme.allowOptOut']);
	assert_same(false, $defaults['theme.allowSelfEnable']);
	assert_same(array('locale', 'appearance.density', 'appearance.fontScale', 'navigation.compact', 'navigation.favorites'),
		$defaults['policy.userOverrides']);
	assert_same(array('locale', 'appearance.density', 'appearance.fontScale', 'navigation.compact', 'navigation.favorites', 'user.standardView'),
		ModernUI_Settings_Model::allowedUserKeys($defaults));
});

test('settings: validate() accepts valid values and reports invalid, unknown and forbidden keys', function () {
	$result = ModernUI_Settings_Model::validate('global', array(
		'theme.mode' => 'pilot',
		'theme.pilot.users' => array(1, '7', 7),
		'theme.pilot.roles' => array('H2', 'H5'),
		'appearance.primaryColor' => '#3978FE',
		'appearance.fontScale' => '110',
		'theme.excludedScreens' => array(array('module' => 'Reports', 'view' => '*', 'parent' => '')),
	));
	assert_same(array(), $result['errors'], 'valid document');
	assert_same(array(1, 7), $result['values']['theme.pilot.users'], 'ids are integers, duplicates removed');
	assert_same('#3978fe', $result['values']['appearance.primaryColor'], 'colours are lower case');
	assert_same(110, $result['values']['appearance.fontScale'], 'font scale is an integer');

	$bad = ModernUI_Settings_Model::validate('global', array(
		'theme.mode' => 'everyone',
		'theme.pilot.users' => array(0),
		'appearance.primaryColor' => '#ffffff',
		'appearance.background' => '#333333',
		'theme.excludedScreens' => array(array('module' => '<script>', 'view' => '*', 'parent' => '')),
		'navigation.groups' => array(),
		'locale' => 'de-DE',
	));
	$codes = array();
	foreach ($bad['errors'] as $error) {
		$codes[$error['key']] = $error['code'];
	}
	assert_same(array(
		'theme.mode' => 'MU_INVALID_VALUE',
		'theme.pilot.users' => 'MU_INVALID_VALUE',
		'appearance.primaryColor' => 'MU_INVALID_VALUE',
		'appearance.background' => 'MU_INVALID_VALUE',
		'theme.excludedScreens' => 'MU_INVALID_VALUE',
		'navigation.groups' => 'MU_UNKNOWN_KEY',
		'locale' => 'MU_FORBIDDEN_KEY',
	), $codes);
	assert_same(array(), $bad['values'], 'nothing invalid is kept');
});

test('settings: a user can write only the keys the administrator allows', function () {
	$allowed = ModernUI_Settings_Model::allowedUserKeys(array_merge(ModernUI_Settings_Model::defaults(), array(
		'policy.userOverrides' => array('locale'), 'theme.allowOptOut' => false, 'theme.allowSelfEnable' => true,
	)));
	assert_same(array('locale', 'user.selfEnabled'), $allowed);
	$result = ModernUI_Settings_Model::validate('user', array('locale' => 'de-DE', 'user.standardView' => true, 'appearance.density' => 'compact'), $allowed);
	assert_same(array('locale' => 'de-DE'), $result['values']);
	assert_same(2, count($result['errors']));
});

test('settings: colour limits use WCAG luminance (primary ≤ 0.9, background ≥ 0.85, surface ≥ 0.92)', function () {
	assert_true(ModernUI_Settings_Model::luminance('#ffffff') > 0.99, 'white');
	assert_true(abs(ModernUI_Settings_Model::luminance('#3978fe') - 0.215) < 0.01, 'default primary');
	$ok = ModernUI_Settings_Model::validate('global', array('appearance.background' => '#eff0f2', 'appearance.surface' => '#f9f9fa'));
	assert_same(array(), $ok['errors'], 'defaults of the design are valid');
	$dim = ModernUI_Settings_Model::validate('global', array('appearance.surface' => '#e0e0e0'));
	assert_same(1, count($dim['errors']), 'a grey surface is rejected');
});

test('settings: flatten() and nest() round-trip; documents are ASCII JSON', function () {
	$flat = array(
		'theme.mode' => 'pilot',
		'theme.pilot.users' => array(1),
		'theme.pilot.includeSubordinates' => false,
		'theme.excludedScreens' => array(array('module' => 'Reports', 'view' => '*', 'parent' => '')),
		'locale.default' => 'de-DE',
	);
	$document = ModernUI_Settings_Model::nest($flat, array('inherit' => true));
	assert_same(1, $document['v']);
	assert_same(array('inherit' => true), $document['meta']);
	$back = ModernUI_Settings_Model::flatten($document);
	ksort($flat);
	ksort($back);
	assert_same($flat, $back);
	$json = ModernUI_Settings_Model::encode(array('v' => 1, 'title' => 'Größe и ß'));
	assert_true(preg_match('/^[\x20-\x7e]+$/', $json) === 1, 'unicode is escaped: ' . $json);
});

test('settings: merge() applies default → global → role → user with the documented exceptions', function () {
	$global = array('appearance.density' => 'compact', 'appearance.primaryColor' => '#123456',
		'theme.excludedScreens' => array(array('module' => 'Reports', 'view' => '*', 'parent' => '')),
		'policy.userOverrides' => array('appearance.density'));
	$role = array('appearance.primaryColor' => '#654321',
		'theme.excludedScreens' => array(array('module' => 'Calendar', 'view' => '*', 'parent' => '')));
	$user = array('appearance.density' => 'comfortable', 'appearance.primaryColor' => '#111111', 'locale' => 'de-DE');
	$effective = ModernUI_Settings_Model::merge($global, $role, $user);
	assert_same('comfortable', $effective['appearance.density'], 'allowed personal key wins');
	assert_same('#654321', $effective['appearance.primaryColor'], 'role wins over global, personal colour not allowed');
	assert_same('auto', $effective['locale'], 'locale is not in the overrides of this policy');
	assert_same(2, count($effective['theme.excludedScreens']), 'excluded screens are a union of global and role');
	assert_same('off', $effective['theme.mode'], 'default mode');
});

test('settings: save() uses optimistic locking and reports a conflict with the current revision', function () {
	MU_Fake::answer('UPDATE vtiger_modernui_settings', array());
	MU_Fake::answer('SELECT scope, scope_key, data', array(array('scope' => 'global', 'scope_key' => '', 'data' => '{"v":1}',
		'doc_version' => 1, 'revision' => 4, 'updated_by' => 1, 'updated_at' => '2026-11-01 10:00:00')));
	$result = ModernUI_Settings_Model::save('global', '', array('theme.mode' => 'pilot'), 3, 1);
	assert_same(false, $result['ok']);
	assert_same(4, $result['conflict']['revision']);
	$update = MU_Fake::$queries[0];
	assert_true(strpos($update[0], 'revision = revision + 1') !== false && strpos($update[0], 'AND revision = ?') !== false, 'UPDATE … WHERE revision = base');
	assert_same(3, end($update[1]), 'base revision is the last parameter');

	MU_Fake::reset();
	MU_Fake::answer('UPDATE vtiger_modernui_settings', array(array('changed' => 1)));
	$saved = ModernUI_Settings_Model::save('global', '', array('theme.mode' => 'pilot'), 3, 1);
	assert_same(array('ok' => true, 'revision' => 4), $saved);
});
