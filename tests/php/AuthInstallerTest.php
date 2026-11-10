<?php
require_once 'modules/ModernUI/models/AuthInstaller.php';

/** Fixtures are original synthetic templates, never copies of CRM files. */
function authFixture(callable $body) {
	$root = sys_get_temp_dir() . '/mu-auth-' . bin2hex(random_bytes(6));
	mkdir($root . '/layouts/v7/modules/Users', 0700, true);
	$originals = array();
	foreach (ModernUI_AuthInstaller_Model::FILES as $index => $file) {
		$originals[$file] = "{* original $index *}\n<form><input name=\"username\"></form>\n";
		file_put_contents($root . '/' . $file, $originals[$file]);
	}
	try {
		$body(new ModernUI_AuthInstaller_Model($root), $root, $originals);
	} finally {
		$files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
		foreach ($files as $file) {
			$file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
		}
		rmdir($root);
	}
}

test('auth installer: explicit install, idempotence, byte-for-byte restoration and backup protection', function () {
	authFixture(function ($installer, $root, $originals) {
		assert_same('original', $installer->status());
		$installer->apply(true);
		assert_same('installed', $installer->status());
		$backup = file_get_contents($root . '/' . ModernUI_AuthInstaller_Model::BACKUP);
		assert_true(strpos($backup, '<?php exit; ?>') === 0, 'backup cannot be downloaded as plaintext');
		foreach ($originals as $file => $original) {
			assert_true(strpos(file_get_contents($root . '/' . $file), $original) !== false, 'native fallback retained');
		}
		$installer->apply(true);
		assert_same($backup, file_get_contents($root . '/' . ModernUI_AuthInstaller_Model::BACKUP));
		$installer->apply(false);
		$installer->apply(false);
		assert_same('original', $installer->status());
		foreach ($originals as $file => $original) {
			assert_same($original, file_get_contents($root . '/' . $file));
		}
		assert_true(!file_exists($root . '/' . ModernUI_AuthInstaller_Model::BACKUP), 'backup consumed only after restoration');
	});
});

test('auth installer: external edits block restore and reapply without overwriting either file', function () {
	authFixture(function ($installer, $root) {
		$installer->apply(true);
		$path = $root . '/' . ModernUI_AuthInstaller_Model::FILES[1];
		file_put_contents($path, '<p>Edited by another administrator</p>');
		$before = array_map(function ($file) use ($root) { return file_get_contents($root . '/' . $file); }, ModernUI_AuthInstaller_Model::FILES);
		assert_same('conflict', $installer->status());
		foreach (array(true, false) as $install) {
			try {
				$installer->apply($install);
				fail_test('expected a conflict');
			} catch (RuntimeException $e) {
				assert_same('MU_AUTH_CONFLICT', $e->getMessage());
			}
		}
		assert_same($before, array_map(function ($file) use ($root) { return file_get_contents($root . '/' . $file); }, ModernUI_AuthInstaller_Model::FILES));
	});
});

test('auth installer: partial install is recoverable; missing or damaged backup never becomes a new original', function () {
	authFixture(function ($installer, $root, $originals) {
		$installer->apply(true);
		$file = ModernUI_AuthInstaller_Model::FILES[1];
		file_put_contents($root . '/' . $file, $originals[$file]);
		assert_same('partial', $installer->status());
		$installer->apply(true);
		assert_same('installed', $installer->status());
		$backupPath = $root . '/' . ModernUI_AuthInstaller_Model::BACKUP;
		$backup = file_get_contents($backupPath);
		file_put_contents($backupPath, 'damaged');
		assert_same('conflict', $installer->status());
		unlink($backupPath);
		assert_same('conflict', $installer->status());
		file_put_contents($backupPath, $backup);
		$installer->apply(false);
		assert_same('original', $installer->status());
	});
});

test('auth notice: global only, plain text and translated labels survive document roundtrip', function () {
	$values = array('branding.noticeEnabled' => true, 'branding.notice' => array('ru-RU' => 'Служебная информация', 'en-US' => 'Internal information'));
	ksort($values);
	assert_same($values, ModernUI_Settings_Model::validate('global', $values)['values']);
	assert_same(2, count(ModernUI_Settings_Model::validate('user', $values)['errors']));
	assert_same(2, count(ModernUI_Settings_Model::validate('role', $values)['errors']));
	assert_same($values, ModernUI_Settings_Model::validate('global', ModernUI_Settings_Model::flatten(ModernUI_Settings_Model::nest($values)))['values']);
	assert_same(1, count(ModernUI_Settings_Model::validate('global', array('branding.notice' => array('*' => '<img src=x>')))['errors']));
});
