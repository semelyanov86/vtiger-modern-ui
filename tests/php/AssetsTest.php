<?php
require_once 'modules/ModernUI/models/Assets.php';

test('assets: the production build has the entries, the build id is the hash of the manifest', function () {
	$manifest = ModernUI_Assets_Model::manifest();
	if ($manifest === null) {
		fail_test('no valid manifest in src/' . ModernUI_Assets_Model::DIST . ': run task build');
	}
	assert_same(true, ModernUI_Assets_Model::isAvailable());
	$content = file_get_contents(MU_SRC . '/' . ModernUI_Assets_Model::DIST . '/manifest.json');
	assert_same(substr(sha1($content), 0, 12), ModernUI_Assets_Model::buildId());
	assert_true(is_file(ModernUI_Assets_Model::skinUrl()), 'skin file');
});

test('assets: tags of an own page include the CSS of imported chunks and the module script', function () {
	$tags = ModernUI_Assets_Model::entryTags(ModernUI_Assets_Model::ENTRY_SETTINGS);
	assert_true(is_string($tags['script']) && is_file($tags['script']), 'entry script exists');
	assert_true(count($tags['css']) >= 2, 'entry CSS and the CSS of the common chunk: ' . json_encode($tags['css']));
	foreach (array_merge($tags['css'], $tags['preload']) as $url) {
		assert_true(strpos($url, ModernUI_Assets_Model::DIST . '/assets/') === 0 && is_file($url), "relative URL of an existing file: {$url}");
	}
	assert_same(array('css' => array(), 'preload' => array(), 'script' => null), ModernUI_Assets_Model::entryTags('src/none.ts'));
});
