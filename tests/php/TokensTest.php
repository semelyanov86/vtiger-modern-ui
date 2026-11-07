<?php
require_once 'modules/ModernUI/models/Tokens.php';

function mu_token_cases() {
	$fixture = json_decode(file_get_contents(MU_REPO . '/tests/fixtures/tokens.json'), true);
	if (!is_array($fixture) || !isset($fixture['cases'])) {
		fail_test('tests/fixtures/tokens.json is not valid');
	}
	return $fixture['cases'];
}

test('tokens: the shared fixture (same map as frontend/src/boot/tokens.ts)', function () {
	foreach (mu_token_cases() as $case) {
		assert_same($case['tokens'], ModernUI_Tokens_Model::forAppearance($case['appearance']), $case['name']);
	}
});

test('tokens: the fill keeps the colour while white text is as readable as on the reference, else reaches 4.5:1', function () {
	foreach (mu_token_cases() as $case) {
		$tokens = $case['tokens'];
		$fill = ModernUI_Tokens_Model::contrast($tokens['primary-strong'], '#ffffff');
		if ($tokens['primary-strong'] === $tokens['primary']) {
			assert_true($fill >= ModernUI_Tokens_Model::FILL_CONTRAST, $case['name'] . ': kept fill ' . $tokens['primary-strong']);
		} else {
			assert_true($fill >= 4.5, $case['name'] . ': darkened fill ' . $tokens['primary-strong']);
			assert_true(ModernUI_Tokens_Model::contrast($tokens['primary'], '#ffffff') < ModernUI_Tokens_Model::FILL_CONTRAST, $case['name'] . ': darkened only when needed');
		}
		assert_true(ModernUI_Tokens_Model::contrast($tokens['primary-hover'], '#ffffff') >= ModernUI_Tokens_Model::FILL_CONTRAST, $case['name'] . ' hover');
	}
	// The measured cloud pair of the default (docs/design.md §13.4): fill #3978fe, hover #315dff, check box #2e81ff.
	$default = ModernUI_Tokens_Model::forAppearance(array());
	assert_same('#3978fe', $default['primary']);
	assert_same('#3978fe', $default['primary-strong']);
	assert_same('#315dff', $default['primary-hover']);
	assert_same('#2e81ff', $default['primary-check']);
	assert_same('#e7f1ff', $default['primary-soft']);
	assert_same('var(--mu-font-cloud)', $default['font-family'], 'the cloud font is the default');
	assert_same('40px', $default['row-height']);
	assert_same('1', $default['font-scale']);
	assert_same('#1d3557', ModernUI_Tokens_Model::strongVariant('#1d3557'), 'a dark colour is kept');
});

test('tokens: values that could break out of the stylesheet never reach it', function () {
	$hostile = array(
		'primaryColor' => '#000;}body{display:none}',
		'background' => 'url(javascript:alert(1))',
		'surface' => '#fff</style>',
		'density' => 'standard;x',
		'fontScale' => '100}',
		'font' => 'cloud"',
	);
	$tokens = ModernUI_Tokens_Model::forAppearance($hostile);
	assert_same(ModernUI_Tokens_Model::forAppearance(array()), $tokens, 'everything falls back to the defaults');
	$css = ModernUI_Tokens_Model::css(array('primary' => '#000;}body{', 'ok' => '#123456', 'bad name;' => '#000000'));
	assert_same("/* ModernUI design tokens */\nhtml:root:not(.mu-off){--mu-ok:#123456}\n", $css);
});

test('tokens: the stylesheet has one rule under html:root:not(.mu-off) with every token', function () {
	$tokens = ModernUI_Tokens_Model::forAppearance(array('density' => 'compact', 'fontScale' => 110));
	$css = ModernUI_Tokens_Model::css($tokens);
	assert_same(1, preg_match_all('/\{/', $css));
	assert_true(strpos($css, 'html:root:not(.mu-off){') !== false, 'selector');
	foreach ($tokens as $name => $value) {
		assert_true(strpos($css, '--mu-' . $name . ':' . $value) !== false, $name);
	}
	assert_true(strpos($css, '--mu-row-height:32px') !== false && strpos($css, '--mu-font-scale:1.1') !== false, 'density and scale');
});

test('tokens: appearance of the effective settings, invalid stored values replaced by the defaults', function () {
	$appearance = ModernUI_Tokens_Model::appearanceOf(array(
		'appearance.primaryColor' => '#2E9A5E',
		'appearance.background' => '#000000',
		'appearance.density' => 'comfortable',
		'appearance.fontScale' => 125,
	));
	assert_same(array('primaryColor' => '#2e9a5e', 'background' => '#eff0f2', 'surface' => '#ffffff', 'density' => 'comfortable',
		'fontScale' => 125, 'font' => 'cloud'), $appearance);
});

test('tokens: the favorites bar is reserved when favorites are on and the user has some or may add them', function () {
	$defaults = ModernUI_Settings_Model::defaults();
	assert_same(array('favorites-bar' => '42px'), ModernUI_Tokens_Model::layout($defaults), 'default policy lets users add favorites');
	$noPolicy = array_merge($defaults, array('policy.userOverrides' => array('locale')));
	assert_same(array('favorites-bar' => '0px'), ModernUI_Tokens_Model::layout($noPolicy), 'nothing to show, nothing to add');
	assert_same(array('favorites-bar' => '42px'), ModernUI_Tokens_Model::layout(array_merge($noPolicy, array('navigation.favorites' => array('Leads')))));
	assert_same(array('favorites-bar' => '0px'), ModernUI_Tokens_Model::layout(array_merge($defaults, array('navigation.favoritesEnabled' => false,
		'navigation.favorites' => array('Leads')))), 'favorites off');
	$css = ModernUI_Tokens_Model::css(array_merge(ModernUI_Tokens_Model::forAppearance(array()), ModernUI_Tokens_Model::layout($defaults)));
	assert_true(strpos($css, '--mu-favorites-bar:42px') !== false, 'in the stylesheet');
});

test('layout.modules (stage 09): names validated again, unique; no layout rules in the tokens stylesheet since stage 11', function () {
	$values = array('layout.modules' => array('Accounts', 'Bad Name', '../x', 'Accounts', 'Contacts'));
	assert_same(array('Accounts', 'Contacts'), ModernUI_Tokens_Model::layoutModules($values), 'validated again, unique');
	assert_same(array(), ModernUI_Tokens_Model::layoutModules(array()), 'none by default');
	assert_true(!method_exists('ModernUI_Tokens_Model', 'layoutCss'), 'the rail is gone for every module in the skin, not per module');
});