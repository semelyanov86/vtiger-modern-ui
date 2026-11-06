<?php
require_once 'modules/ModernUI/models/Adapters.php';
require_once 'modules/ModernUI/models/Settings.php';

/** A registry of two adapters for the tests; files are paths inside src/ (the CRM root of the tests). */
function mu_adapter_registry(array $override = array()) {
	$base = array(
		'module' => 'Addon', 'title' => 'Addon', 'vendor' => 'Vendor',
		'versions' => array('min' => '2.0', 'below' => '3'),
		'files' => array('modules/ModernUI/ModernUI.php'), 'tables' => array(),
		'style' => true, 'script' => true,
		'screens' => array(
			array('module' => 'Addon', 'view' => 'Board', 'parent' => '', 'level' => 'skin'),
			array('module' => 'Addon', 'view' => 'Designer', 'parent' => '*', 'level' => 'standard'),
		),
	);
	return array(
		'addon' => array_merge($base, $override),
		'other' => array_merge($base, array('module' => 'Other', 'title' => 'Other', 'screens' => array())),
	);
}

test('adapter versions: inside the checked range only', function () {
	$range = array('min' => '4.0', 'below' => '5');
	assert_same(true, ModernUI_Adapters_Model::versionInRange('4.60', $range), '4.60');
	assert_same(true, ModernUI_Adapters_Model::versionInRange('4.0', $range), '4.0');
	assert_same(false, ModernUI_Adapters_Model::versionInRange('3.9.9', $range), 'older');
	assert_same(false, ModernUI_Adapters_Model::versionInRange('5.0', $range), 'newer major');
	assert_same(false, ModernUI_Adapters_Model::versionInRange('', $range), 'empty version');
	assert_same(false, ModernUI_Adapters_Model::versionInRange('4.6-beta', $range), 'not a version');
	assert_same(true, ModernUI_Adapters_Model::versionInRange('', array('min' => null, 'below' => null)), 'no bounds');
});

test('adapter status: not installed, inactive, version, missing file, table or field, switched off, active', function () {
	$adapter = mu_adapter_registry()['addon'];
	assert_same(ModernUI_Adapters_Model::NOT_INSTALLED, ModernUI_Adapters_Model::evaluate($adapter, null, false)['status'], 'not installed');
	assert_same(ModernUI_Adapters_Model::INACTIVE, ModernUI_Adapters_Model::evaluate($adapter, array('presence' => 1, 'version' => '2.1'), false)['status'], 'disabled module');
	assert_same(ModernUI_Adapters_Model::VERSION, ModernUI_Adapters_Model::evaluate($adapter, array('presence' => 0, 'version' => '3.0'), false)['status'], 'version');
	$missing = array_merge($adapter, array('files' => array('modules/NoSuchExtension/NoSuch.php')));
	assert_same(ModernUI_Adapters_Model::INCOMPLETE, ModernUI_Adapters_Model::evaluate($missing, array('presence' => 0, 'version' => '2.1'), false)['status'], 'missing file');
	MU_Fake::answer('information_schema.tables', array(array('n' => 0)));
	$table = array_merge($adapter, array('tables' => array('vtiger_nosuchtable')));
	assert_same(ModernUI_Adapters_Model::INCOMPLETE, ModernUI_Adapters_Model::evaluate($table, array('presence' => 0, 'version' => '2.1'), false)['status'], 'missing table');
	MU_Fake::answer('information_schema.tables', array(array('n' => 1)));
	MU_Fake::answer('FROM vtiger_field f', array());
	$field = array_merge($adapter, array('fields' => array(array('module' => 'Addon', 'field' => 'cf_addon_signature'))));
	assert_same(ModernUI_Adapters_Model::INCOMPLETE, ModernUI_Adapters_Model::evaluate($field, array('presence' => 0, 'version' => '2.1'), false)['status'], 'missing field');
	MU_Fake::answer('FROM vtiger_field f', array(array('fieldid' => 7)));
	assert_same(ModernUI_Adapters_Model::ACTIVE, ModernUI_Adapters_Model::evaluate($field, array('presence' => 0, 'version' => '2.1'), false)['status'], 'field present');
	assert_same(ModernUI_Adapters_Model::DISABLED, ModernUI_Adapters_Model::evaluate($adapter, array('presence' => 0, 'version' => '2.1'), true)['status'], 'switched off');
	assert_same(ModernUI_Adapters_Model::ACTIVE, ModernUI_Adapters_Model::evaluate($adapter, array('presence' => 2, 'version' => '2.1'), false)['status'], 'hidden module is active');
});

test('active adapters: from vtiger_tab, the switch of the administrator, the fingerprint', function () {
	ModernUI_Adapters_Model::setRegistry(mu_adapter_registry());
	MU_Fake::answer('FROM vtiger_tab WHERE name IN', array(array('name' => 'Addon', 'presence' => '0', 'version' => '2.4')));
	$values = ModernUI_Settings_Model::defaults();
	assert_same(array('addon'), array_keys(ModernUI_Adapters_Model::active($values)), 'Other is not installed');
	assert_same('addon@2.4', ModernUI_Adapters_Model::fingerprint($values), 'fingerprint');
	$client = ModernUI_Adapters_Model::forClient($values);
	assert_same('addon', $client[0]['id'], 'client id');
	assert_same(true, $client[0]['script'], 'client part');
	$values['adapters.disabled'] = array('addon');
	assert_same(array(), ModernUI_Adapters_Model::active($values), 'switched off');
	assert_same('', ModernUI_Adapters_Model::fingerprint($values), 'empty fingerprint');
	$catalog = ModernUI_Adapters_Model::catalog($values);
	assert_same(array('disabled', 'notInstalled'), array($catalog[0]['status'], $catalog[1]['status']), 'catalog statuses');
});

test('adapter screen rules: standard wins over skin, only for active adapters', function () {
	ModernUI_Adapters_Model::setRegistry(mu_adapter_registry());
	MU_Fake::answer('FROM vtiger_tab WHERE name IN', array(array('name' => 'Addon', 'presence' => '0', 'version' => '2.4')));
	$values = ModernUI_Settings_Model::defaults();
	assert_same('skin', ModernUI_Adapters_Model::screenLevel($values, array('module' => 'Addon', 'view' => 'Board')), 'board');
	assert_same('standard', ModernUI_Adapters_Model::screenLevel($values, array('module' => 'addon', 'view' => 'designer', 'parent' => 'Settings')), 'designer');
	assert_same(null, ModernUI_Adapters_Model::screenLevel($values, array('module' => 'Addon', 'view' => 'List')), 'list');
	$values['adapters.disabled'] = array('addon');
	assert_same(null, ModernUI_Adapters_Model::screenLevel($values, array('module' => 'Addon', 'view' => 'Designer')), 'switched off');
});

test('adapters: a failing check switches every adapter off instead of breaking the page', function () {
	ModernUI_Adapters_Model::setRegistry(mu_adapter_registry());
	MU_Fake::answer('FROM vtiger_tab WHERE name IN', array('__fail__'));
	$values = ModernUI_Settings_Model::defaults();
	assert_same(array(), ModernUI_Adapters_Model::active($values), 'nothing active');
	assert_same('error', ModernUI_Adapters_Model::catalog($values)[0]['status'], 'status error');
});

test('settings: adapters.disabled — global only, ids of adapters', function () {
	$checked = ModernUI_Settings_Model::validate('global', array('adapters.disabled' => array('pdfmaker', 'future-adapter')));
	assert_same(array('pdfmaker', 'future-adapter'), $checked['values']['adapters.disabled'], 'valid ids kept');
	$bad = ModernUI_Settings_Model::validate('global', array('adapters.disabled' => array('PDF Maker')));
	assert_true(count($bad['errors']) > 0, 'invalid id refused');
	$role = ModernUI_Settings_Model::validate('role', array('adapters.disabled' => array('pdfmaker')));
	assert_true(count($role['errors']) > 0, 'not a role key');
});
