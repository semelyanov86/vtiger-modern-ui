<?php
/*
 * Unpacks a ModernUI ZIP with the real importer of the official Vtiger 8.4.0 sources and lists the files it
 * wrote: Vtiger_PackageImport::initImport() (Module Manager import) or Vtiger_PackageUpdate::initUpdate()
 * (update), run in an empty directory. No database is used: initImport/initUpdate only check the ZIP and unpack.
 *
 *   php tests/package/vtlib-unzip.php <official 8.4.0 sources> <zip> <empty target dir> import|update
 */
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
list(, $vtiger, $zip, $target, $mode) = $argv + array('', '', '', '', 'import');
if (!is_file("{$vtiger}/vtlib/Vtiger/PackageImport.php") || !is_file($zip) || !is_dir($target)) {
	fwrite(STDERR, "usage: php vtlib-unzip.php <vtiger 8.4.0 sources> <zip> <empty dir> import|update\n");
	exit(2);
}
$zip = realpath($zip);
set_include_path($vtiger . PATH_SEPARATOR . get_include_path());
chdir($target);
mkdir('test/vtlib', 0777, true);

// Helpers of include/utils/VtlibUtils.php that the importer calls; the rest of that file needs a database.
function vtlib_array($data = null) {
	return is_array($data) ? $data : array();
}

function php7_count($value) {
	return is_array($value) || $value instanceof Countable ? count($value) : 0;
}

/*
 * The official PackageImport.php and PackageUpdate.php are loaded as they are, without their include lines:
 * their parent Vtiger_PackageExport (and through it the whole CRM bootstrap with config.php and a database) is
 * replaced by the two members initImport()/initUpdate() use. Unzip.php and dUnzip2 are the original files.
 */
class Vtiger_PackageExport {
	var $_export_tmpdir = 'test/vtlib';
	var $_export_modulexml_filename = null;

	function __construct() {
	}

	function __getManifestFilePath() {
		if (empty($this->_export_modulexml_filename)) {
			$this->_export_modulexml_filename = 'manifest-' . time() . '.xml';
		}
		return "$this->_export_tmpdir/$this->_export_modulexml_filename";
	}

	static function log($message, $delimit = true) {
	}
}

require_once 'vtlib/Vtiger/Unzip.php';
foreach (array('PackageImport', 'PackageUpdate') as $class) {
	$source = file_get_contents("{$vtiger}/vtlib/Vtiger/{$class}.php");
	$source = preg_replace('/^\s*include_once\s*\(?[^;]*\)?\s*;\s*$/m', '', $source);
	$copy = getcwd() . "/test/vtlib/{$class}.php";
	file_put_contents($copy, $source);
	require_once $copy;
	unlink($copy);
}

if ($mode === 'update') {
	$package = new Vtiger_PackageUpdate();
	$module = new stdClass();
	$module->name = 'ModernUI';
	$name = $package->initUpdate($module, $zip, true);
} else {
	$package = new Vtiger_PackageImport();
	$name = $package->initImport($zip, true);
}
if ($name !== 'ModernUI') {
	fwrite(STDERR, 'vtlib-unzip: checkZip did not accept the package: ' . var_export($name, true) . "\n");
	exit(1);
}
$files = array();
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator('.', FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) {
	$path = substr($file->getPathname(), 2);
	if (strpos($path, 'test/vtlib/') !== 0) {
		$files[] = $path;
	}
}
sort($files);
echo implode("\n", $files), "\n";
