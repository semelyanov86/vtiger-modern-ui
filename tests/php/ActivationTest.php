<?php
require_once 'modules/ModernUI/models/Activation.php';
require_once 'modules/ModernUI/models/LinkHandler.php';
require_once 'modules/ModernUI/models/Lifecycle.php';

/** Settings rows and schema of the fake database for one evaluation. */
function mu_prepare(array $global, array $user = array(), $schema = '1', $parentRole = 'H1::H2::H5') {
	MU_Fake::answer('FROM vtiger_modernui_meta WHERE name', $schema === null ? array() : array(array('name' => 'schema_version', 'value' => $schema)));
	MU_Fake::answer('SELECT parentrole FROM vtiger_role', array(array('parentrole' => $parentRole)));
	$rows = array(array('scope' => 'global', 'scope_key' => '', 'data' => json_encode(ModernUI_Settings_Model::nest($global)),
		'doc_version' => 1, 'revision' => 2, 'updated_by' => null, 'updated_at' => '2026-11-01 10:00:00'));
	if ($user) {
		$rows[] = array('scope' => 'user', 'scope_key' => '5', 'data' => json_encode(ModernUI_Settings_Model::nest($user)),
			'doc_version' => 1, 'revision' => 3, 'updated_by' => 5, 'updated_at' => '2026-11-01 10:00:00');
	}
	MU_Fake::answer('FROM vtiger_modernui_settings WHERE (scope', $rows);
}

test('activation: evaluateSettings() for off, pilot by user, role and parent role, self-enable, standard view, all', function () {
	$base = ModernUI_Settings_Model::defaults();
	$cases = array(
		array(array(), 'MU_THEME_OFF'),
		array(array('theme.mode' => 'pilot'), 'MU_NOT_IN_PILOT'),
		array(array('theme.mode' => 'pilot', 'theme.pilot.users' => array(5)), 'OK'),
		array(array('theme.mode' => 'pilot', 'theme.pilot.roles' => array('H5')), 'OK'),
		array(array('theme.mode' => 'pilot', 'theme.pilot.roles' => array('H2')), 'OK'),
		array(array('theme.mode' => 'pilot', 'theme.pilot.roles' => array('H2'), 'theme.pilot.includeSubordinates' => false), 'MU_NOT_IN_PILOT'),
		array(array('theme.mode' => 'pilot', 'user.selfEnabled' => true), 'MU_NOT_IN_PILOT'),
		array(array('theme.mode' => 'pilot', 'theme.allowSelfEnable' => true, 'user.selfEnabled' => true), 'OK'),
		array(array('theme.mode' => 'all'), 'OK'),
		array(array('theme.mode' => 'all', 'user.standardView' => true), 'MU_STANDARD_VIEW'),
		array(array('theme.mode' => 'all', 'user.standardView' => true, 'theme.allowOptOut' => false), 'OK'),
	);
	foreach ($cases as $case) {
		$values = array_merge($base, $case[0]);
		assert_same($case[1], ModernUI_Activation_Model::evaluateSettings($values, 5, 'H5', array('H2', 'H1')), json_encode($case[0]));
	}
});

test('activation: excluded screens match module/view/parent with * and default to Home', function () {
	$screens = array(
		array('module' => 'Reports', 'view' => '*', 'parent' => '*'),
		array('module' => 'Home', 'view' => 'DashBoard', 'parent' => ''),
	);
	assert_same(true, ModernUI_Activation_Model::isScreenExcluded($screens, array('module' => 'Reports', 'view' => 'Detail')));
	assert_same(true, ModernUI_Activation_Model::isScreenExcluded($screens, array('view' => 'DashBoard')));
	assert_same(false, ModernUI_Activation_Model::isScreenExcluded($screens, array('module' => 'Leads', 'view' => 'List')));
	assert_same(false, ModernUI_Activation_Model::isScreenExcluded($screens, array('module' => 'Home', 'view' => 'DashBoard', 'parent' => 'Settings')));
});

test('activation: only Vtiger 8.4.* is supported', function () {
	foreach (array('8.4.0' => true, '8.4' => true, '8.4.1' => true, '8.40.0' => false, '8.3.0' => false, '9.0.0' => false, '' => false) as $version => $expected) {
		assert_same($expected, ModernUI_Activation_Model::isSupportedVtiger((string) $version), "version {$version}");
	}
});

test('activation: evaluate() stops at module, version, schema and safe mode before reading settings', function () {
	mu_prepare(array('theme.mode' => 'all'));
	MU_Fake::$moduleActive = false;
	assert_same('MU_MODULE_INACTIVE', ModernUI_Activation_Model::evaluate(array())['reason']);
	MU_Fake::reset();
	mu_prepare(array('theme.mode' => 'all'));
	MU_Fake::$vtigerVersion = '7.1.0';
	assert_same('MU_UNSUPPORTED_VTIGER', ModernUI_Activation_Model::evaluate(array())['reason']);
	foreach (array(array(null, 'MU_SCHEMA_MISSING'), array('0', 'MU_SCHEMA_OUTDATED'), array('2', 'MU_SCHEMA_NEWER')) as $schema) {
		MU_Fake::reset();
		mu_prepare(array('theme.mode' => 'all'), array(), $schema[0]);
		assert_same($schema[1], ModernUI_Activation_Model::evaluate(array())['reason'], 'schema ' . var_export($schema[0], true));
	}
	MU_Fake::reset();
	mu_prepare(array('theme.mode' => 'all'));
	$_SESSION = array();
	assert_same('MU_SAFE_MODE', ModernUI_Activation_Model::evaluate(array('modernui' => 'off'))['reason']);
});

test('link handler: active theme rewrites the three links to the current build and settings; inactive theme hides them', function () {
	if (!ModernUI_Assets_Model::isAvailable()) {
		fail_test('no production build in src/: run task build');
	}
	mu_prepare(array('theme.mode' => 'pilot', 'theme.pilot.users' => array(5)));
	$css = new MU_FakeLink('HEADERCSS', 'ModernUISkin', 'layouts/v7/modules/ModernUI/resources/dist/skin.css');
	$tokens = new MU_FakeLink('HEADERCSS', 'ModernUITokens', 'layouts/v7/modules/ModernUI/resources/dist/tokens.css');
	$js = new MU_FakeLink('HEADERSCRIPT', 'ModernUIShell', 'layouts/v7/modules/ModernUI/resources/loader.js');
	assert_same(true, ModernUI_LinkHandler_Model::filter(new Vtiger_LinkData($css)));
	assert_same(true, ModernUI_LinkHandler_Model::filter(new Vtiger_LinkData($tokens)));
	assert_same(true, ModernUI_LinkHandler_Model::filter(new Vtiger_LinkData($js)));
	$build = ModernUI_Assets_Model::buildId();
	$context = ModernUI_Activation_Model::context();
	assert_same('index.php?module=ModernUI&action=Tokens&r=' . $context['cacheKey'] . '&z=', $tokens->linkurl);
	assert_true(preg_match('/^[0-9a-f]{12}$/', $context['cacheKey']) === 1, 'cache key');
	assert_true(preg_match('#^layouts/v7/modules/ModernUI/resources/dist/assets/skin-[A-Za-z0-9_-]+\.css\?b=' . $build . '&z=$#', $css->linkurl) === 1, $css->linkurl);
	assert_true(preg_match('#^layouts/v7/modules/ModernUI/resources/loader\.js\?b=' . $build . '&z=$#', $js->linkurl) === 1, $js->linkurl);
	assert_true(is_file($css->linkurl === '' ? '' : strstr($css->linkurl, '?', true)), 'the skin file exists (Header.php checks file_exists)');

	MU_Fake::reset();
	mu_prepare(array('theme.mode' => 'pilot', 'theme.pilot.users' => array(9)));
	$other = new MU_FakeLink('HEADERSCRIPT', 'ModernUIShell', 'layouts/v7/modules/ModernUI/resources/loader.js');
	assert_same(false, ModernUI_LinkHandler_Model::filter(new Vtiger_LinkData($other)), 'another user is not affected');
	assert_same('layouts/v7/modules/ModernUI/resources/loader.js', $other->linkurl);
});

test('activation: interrupted updates and failed migrations hide every theme link even with the current schema', function () {
	foreach (array('update_started_at', 'last_error') as $marker) {
		MU_Fake::reset();
		mu_prepare(array('theme.mode' => 'all'));
		MU_Fake::answer('FROM vtiger_modernui_meta WHERE name', array(
			array('name' => 'schema_version', 'value' => '1'), array('name' => $marker, 'value' => 'test'),
		));
		assert_same('MU_RECOVERY_REQUIRED', ModernUI_Activation_Model::evaluate(array())['reason'], $marker);
		foreach (ModernUI_Lifecycle_Model::links() as $definition) {
			$link = new MU_FakeLink($definition['type'], $definition['label'], $definition['url']);
			assert_same(false, ModernUI_LinkHandler_Model::filter(new Vtiger_LinkData($link)), $marker . ': ' . $definition['label']);
		}
	}
});

test('link handler: a failure inside the decision means "no theme on this page", never an exception', function () {
	MU_Fake::$user = null;
	MU_Fake::answer('FROM vtiger_modernui_meta WHERE name', array(array('name' => 'schema_version', 'value' => '1')));
	MU_Fake::answer('FROM vtiger_modernui_settings', array(array('scope' => 'global', 'scope_key' => '', 'data' => '{not json',
		'doc_version' => 1, 'revision' => 1, 'updated_by' => null, 'updated_at' => '')));
	$link = new MU_FakeLink('HEADERCSS', 'ModernUISkin', 'x');
	assert_same(false, ModernUI_LinkHandler_Model::filter(new Vtiger_LinkData($link)));
	MU_Fake::reset();
	assert_same(false, ModernUI_LinkHandler_Model::filter(new Vtiger_LinkData(null)), 'no link object');
});

test('lifecycle: links are created with the handler, once, and removed on disable', function () {
	MU_Fake::answer('FROM vtiger_links', array());
	ModernUI_Lifecycle_Model::syncLinks();
	$added = array_values(array_filter(MU_Fake::$links, function ($entry) {
		return $entry[0] === 'add';
	}));
	assert_same(3, count($added));
	foreach ($added as $entry) {
		assert_same(0, $entry[1], 'tabid 0');
		assert_same(array('path' => 'modules/ModernUI/models/LinkHandler.php', 'class' => 'ModernUI_LinkHandler_Model', 'method' => 'filter'), $entry[5]);
	}
	assert_same('layouts/v7/modules/ModernUI/resources/dist/skin.css', $added[0][4]);
	assert_true(!is_file($added[0][4]), 'the registered skin URL names no real file (fails safe without the handler)');
	assert_same(array('HEADERCSS', 'ModernUITokens'), array($added[1][2], $added[1][3]));
	assert_true(!is_file($added[1][4]), 'the registered tokens URL names no real file either');

	MU_Fake::reset();
	MU_Fake::answer('FROM vtiger_links', array(array('linkid' => 1, 'linkurl' => 'layouts/v7/modules/ModernUI/resources/dist/skin.css',
		'handler_path' => 'modules/ModernUI/models/LinkHandler.php', 'handler_class' => 'ModernUI_LinkHandler_Model', 'handler' => 'filter')));
	ModernUI_Lifecycle_Model::syncLinks();
	assert_same(2, count(array_filter(MU_Fake::$links, function ($entry) {
		return $entry[0] === 'add';
	})), 'the up-to-date skin link is kept, the tokens and shell links (different URL in this answer) are replaced');

	MU_Fake::reset();
	ModernUI_Lifecycle_Model::handle('module.disabled');
	assert_same(array(array('delete', 0, 'HEADERCSS', 'ModernUISkin'), array('delete', 0, 'HEADERCSS', 'ModernUITokens'),
		array('delete', 0, 'HEADERSCRIPT', 'ModernUIShell')), MU_Fake::$links);
});
