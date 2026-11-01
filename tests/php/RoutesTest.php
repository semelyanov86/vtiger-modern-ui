<?php
/*
 * Request parameters that Vtiger's WebUI.php treats specially must not be used by ModernUI: for mode=reset and
 * mode=fromMig (password reset, migration) and action=Login it does not load csrf-magic, so a POST of ours with
 * them would fail its CSRF check.
 */
test('routes: no form or action of ModernUI uses mode=reset, mode=fromMig or action=Login', function () {
	$files = array_merge(
		glob('layouts/v7/modules/ModernUI/*.tpl'), glob('layouts/v7/modules/Settings/ModernUI/*.tpl'),
		glob('modules/ModernUI/*/*.php'), glob('modules/Settings/ModernUI/*/*.php'),
		glob(MU_REPO . '/frontend/src/*/*.ts'), glob(MU_REPO . '/frontend/src/*/*.vue')
	);
	assert_true(count($files) > 15, 'sources found');
	foreach ($files as $file) {
		$text = file_get_contents($file);
		foreach (array('/name="mode" value="(reset|fromMig)"/', "/mode\\s*[:=]\\s*'(reset|fromMig)'/", "/=== 'reset'/", '/action=Login/', "/action: 'Login'/") as $pattern) {
			assert_true(preg_match($pattern, $text) !== 1, "{$file} matches {$pattern}");
		}
	}
});
