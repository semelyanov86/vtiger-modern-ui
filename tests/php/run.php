<?php
/*
 * PHP tests of ModernUI without a CRM (task test:php): settings schema and merge, locales, activation rules,
 * link handler, assets of the build, dictionaries. Vtiger classes the models touch are replaced by small fakes
 * (tests/php/fakes.php); any PHP warning, notice or deprecation fails the run.
 *
 *   php tests/php/run.php [filter]
 */
error_reporting(E_ALL);
ini_set('display_errors', 'stderr');
set_error_handler(function ($severity, $message, $file, $line) {
	throw new ErrorException($message, 0, $severity, $file, $line);
});

define('MU_REPO', dirname(__DIR__, 2));
define('MU_SRC', MU_REPO . '/src');
chdir(MU_SRC);
set_include_path(__DIR__ . '/stubs' . PATH_SEPARATOR . get_include_path());

require __DIR__ . '/fakes.php';

$GLOBALS['mu_tests'] = array();

function test($name, callable $body) {
	$GLOBALS['mu_tests'][] = array($name, $body);
}

function fail_test($message) {
	throw new RuntimeException($message);
}

function assert_same($expected, $actual, $message = '') {
	if ($expected !== $actual) {
		fail_test(($message !== '' ? $message . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
	}
}

function assert_true($condition, $message) {
	if ($condition !== true) {
		fail_test($message);
	}
}

$filter = isset($argv[1]) ? $argv[1] : '';
foreach (glob(__DIR__ . '/*Test.php') as $file) {
	require $file;
}

$failed = 0;
$count = 0;
foreach ($GLOBALS['mu_tests'] as $entry) {
	list($name, $body) = $entry;
	if ($filter !== '' && stripos($name, $filter) === false) {
		continue;
	}
	$count++;
	MU_Fake::reset();
	try {
		$body();
	} catch (Throwable $e) {
		$failed++;
		fwrite(STDERR, "FAIL {$name}\n  " . get_class($e) . ': ' . $e->getMessage() . "\n  at " . $e->getFile() . ':' . $e->getLine() . "\n");
	}
}
printf("php %s: %d test(s), %d failed\n", PHP_VERSION, $count, $failed);
exit($failed > 0 ? 1 : 0);
