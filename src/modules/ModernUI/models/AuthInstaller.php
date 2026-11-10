<?php
/* Explicit administrator opt-in: wrap two native templates, retaining their original contents as a fallback.
 * Backups are outside the module, protected by a PHP exit, and survive a package update. No request supplies paths.
 */
require_once 'modules/ModernUI/models/Assets.php';

class ModernUI_AuthInstaller_Model {

	const FILES = array('layouts/v7/modules/Users/Login.tpl', 'layouts/v7/modules/Users/ForgotPassword.tpl');
	const BACKUP = 'test/modernui-auth/state.php';
	const PREFIX = "<?php exit; ?>\n";
	const MARKER = '{* ModernUI managed authentication v1 *}';
	private $root;

	/** An explicit root is used by isolated filesystem tests only. */
	public function __construct($root = null) {
		$this->root = $root === null ? ModernUI_Assets_Model::crmRoot() : $root;
	}

	private function readState() {
		$path = $this->root . '/' . self::BACKUP;
		if (is_link($path) || is_link(dirname($path))) {
			throw new RuntimeException('MU_AUTH_BACKUP');
		}
		if (!is_file($path)) {
			return null;
		}
		$content = file_get_contents($path);
		if (strpos($content, self::PREFIX) !== 0) {
			throw new RuntimeException('MU_AUTH_BACKUP');
		}
		$state = json_decode(substr($content, strlen(self::PREFIX)), true);
		if (!is_array($state) || array_keys($state) !== self::FILES) {
			throw new RuntimeException('MU_AUTH_BACKUP');
		}
		foreach ($state as $entry) {
			if (!is_array($entry) || !isset($entry['original'], $entry['hash'], $entry['installed'], $entry['mode'])
				|| !is_string($entry['original']) || base64_decode($entry['original'], true) === false
				|| !is_string($entry['hash']) || !is_string($entry['installed']) || !preg_match('/^[a-f0-9]{64}$/D', $entry['installed'])
				|| !is_int($entry['mode']) || $entry['mode'] < 0 || $entry['mode'] > 0777
				|| !hash_equals($entry['hash'], hash('sha256', base64_decode($entry['original'], true)))) {
				throw new RuntimeException('MU_AUTH_BACKUP');
			}
		}
		return $state;
	}

	public function status() {
		try {
			$state = $this->readState();
			$installed = 0;
			foreach (self::FILES as $file) {
				$path = $this->root . '/' . $file;
				if (!is_file($path) || is_link($path)) {
					return 'conflict';
				}
				$hash = hash_file('sha256', $path);
				if ($state !== null && $hash === $state[$file]['installed']) {
					$installed++;
				} elseif ($state !== null && $hash !== $state[$file]['hash']) {
					return 'conflict';
				} elseif ($state === null && strpos(file_get_contents($path), self::MARKER) !== false) {
					return 'conflict';
				}
			}
			return $installed === count(self::FILES) ? 'installed' : ($state === null ? 'original' : 'partial');
		} catch (Throwable $e) {
			return 'conflict';
		}
	}

	private function wrapped($original, $change) {
		return self::MARKER . "\n{assign var=MU_AUTH value=null}\n"
			// Vtiger registers method_exists; Smarty supports a class variable without compile-time registration.
			// The class name is a literal supplied by this installer, never by a request or a settings document.
			. "{assign var=MU_AUTH_MODEL value='ModernUI_Auth_Model'}\n"
			. "{if 'ModernUI'|vtlib_isModuleActive && method_exists(\$MU_AUTH_MODEL, 'page')}\n"
			. '{assign var=MU_AUTH value=$MU_AUTH_MODEL::page(' . ($change ? 'true' : 'false') . ")}\n{/if}\n"
			. '{if $MU_AUTH}{include file="modules/ModernUI/' . ($change ? 'AuthDocument.tpl' : 'Auth.tpl') . '"}{else}'
			. "\n" . $original . "\n{/if}\n";
	}

	/** Atomic rename keeps concurrent login requests from seeing a half-written template. */
	private function write($relative, $content, $mode) {
		$path = $this->root . '/' . $relative;
		if (is_link($path) || !is_writable(dirname($path))) {
			throw new RuntimeException('MU_AUTH_WRITE');
		}
		$temp = tempnam(dirname($path), '.mu-auth-');
		if ($temp === false) {
			throw new RuntimeException('MU_AUTH_WRITE');
		}
		try {
			if (file_put_contents($temp, $content) !== strlen($content) || !chmod($temp, $mode) || !rename($temp, $path)) {
				throw new RuntimeException('MU_AUTH_WRITE');
			}
			clearstatcache(true, $path);
		} finally {
			if (is_file($temp)) {
				unlink($temp);
			}
		}
	}

	/** Must only be called from the CSRF-protected administrator action or module removal. */
	public function apply($install) {
		$directory = $this->root . '/test/modernui-auth';
		if (is_link(dirname($directory)) || is_link($directory) || is_link($directory . '/.lock')
			|| (!is_dir($directory) && !mkdir($directory, 0700, true))) {
			throw new RuntimeException('MU_AUTH_WRITE');
		}
		$lock = fopen($directory . '/.lock', 'c');
		if (!$lock || !flock($lock, LOCK_EX)) {
			throw new RuntimeException('MU_AUTH_WRITE');
		}
		try {
			$status = $this->status();
			if ($status === 'conflict') {
				throw new RuntimeException('MU_AUTH_CONFLICT');
			}
			if (($install && $status === 'installed') || (!$install && $status === 'original')) {
				return;
			}
			$state = $this->readState();
			if ($install && $state === null) {
				$state = array();
				foreach (self::FILES as $index => $file) {
					$path = $this->root . '/' . $file;
					$original = file_get_contents($path);
					$state[$file] = array('original' => base64_encode($original), 'hash' => hash('sha256', $original),
						'installed' => hash('sha256', $this->wrapped($original, $index === 1)), 'mode' => fileperms($path) & 0777);
				}
				$this->write(self::BACKUP, self::PREFIX . json_encode($state, JSON_UNESCAPED_SLASHES), 0600);
			}
			foreach (self::FILES as $file) {
				if (!is_writable(dirname($this->root . '/' . $file))) {
					throw new RuntimeException('MU_AUTH_WRITE');
				}
			}
			foreach (self::FILES as $index => $file) {
				$entry = $state[$file];
				// Check again immediately before a write; refuse to overwrite work performed since preflight.
				$hash = hash_file('sha256', $this->root . '/' . $file);
				if ($hash !== $entry['hash'] && $hash !== $entry['installed']) {
					throw new RuntimeException('MU_AUTH_CONFLICT');
				}
				$original = base64_decode($entry['original'], true);
				$this->write($file, $install ? $this->wrapped($original, $index === 1) : $original, $entry['mode']);
			}
			// Smarty compares file times to the second. Clear only compiled templates, never source templates.
			if (class_exists('Vtiger_Viewer')) {
				Vtiger_Viewer::getInstance()->clearCompiledTemplate();
			}
			if (!$install) {
				unlink($this->root . '/' . self::BACKUP);
			}
		} finally {
			flock($lock, LOCK_UN);
			fclose($lock);
		}
	}
}
