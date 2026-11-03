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

test('tokens: white text on the strong primary colour reaches 4.5:1, the default keeps the measured pair', function () {
	foreach (mu_token_cases() as $case) {
		$tokens = $case['tokens'];
		assert_true(ModernUI_Tokens_Model::contrast($tokens['primary-strong'], '#ffffff') >= 4.5, $case['name'] . ': ' . $tokens['primary-strong']);
		assert_true(ModernUI_Tokens_Model::contrast($tokens['primary-hover'], '#ffffff') >= 4.5, $case['name'] . ' hover');
	}
	$default = ModernUI_Tokens_Model::forAppearance(array());
	assert_same('#3978fe', $default['primary']);
	assert_same('#315dff', $default['primary-strong']);
	assert_same('#e7f1ff', $default['primary-soft']);
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
		'font' => 'inter"',
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
		'fontScale' => 125, 'font' => 'inter'), $appearance);
});
