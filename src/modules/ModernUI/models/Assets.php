<?php
/*
 * Production build of the frontend (docs/architecture.md §5): reads resources/dist/manifest.json written by
 * Vite, gives the build id, the hashed skin file and the tags of an entry for the module's own pages.
 * All URLs are relative to index.php of the CRM, so an installation in a sub-directory works as well.
 */

class ModernUI_Assets_Model {

	const RESOURCES = 'layouts/v7/modules/ModernUI/resources';
	const DIST = 'layouts/v7/modules/ModernUI/resources/dist';
	const LOADER = 'layouts/v7/modules/ModernUI/resources/loader.js';

	const ENTRY_SHELL = 'src/shell/main.ts';
	const ENTRY_SETTINGS = 'src/settings/main.ts';
	const ENTRY_SKIN = 'src/skin/skin.scss';

	/** @var array|null|false false: not read yet, null: missing or invalid */
	private static $manifest = false;
	private static $buildId = null;

	/**
	 * Absolute path of the CRM root (this file is modules/ModernUI/models/Assets.php inside it).
	 * @return string
	 */
	public static function crmRoot() {
		return dirname(__DIR__, 3);
	}

	/**
	 * Parsed manifest, or null when there is no valid production build.
	 * @return array|null
	 */
	public static function manifest() {
		if (self::$manifest === false) {
			self::$manifest = null;
			$file = self::crmRoot() . '/' . self::DIST . '/manifest.json';
			$content = is_file($file) ? @file_get_contents($file) : false;
			if (is_string($content) && $content !== '') {
				$decoded = json_decode($content, true);
				if (is_array($decoded) && self::isValid($decoded)) {
					self::$manifest = $decoded;
					self::$buildId = substr(sha1($content), 0, 12);
				}
			}
		}
		return self::$manifest;
	}

	/**
	 * The manifest has the required entries and every file name stays inside dist/assets.
	 * @param array $manifest
	 * @return bool
	 */
	private static function isValid(array $manifest) {
		foreach (array(self::ENTRY_SHELL, self::ENTRY_SKIN) as $entry) {
			if (!isset($manifest[$entry]['file']) || !is_string($manifest[$entry]['file'])) {
				return false;
			}
		}
		foreach ($manifest as $chunk) {
			if (!is_array($chunk)) {
				return false;
			}
			$files = isset($chunk['css']) && is_array($chunk['css']) ? $chunk['css'] : array();
			if (isset($chunk['file'])) {
				$files[] = $chunk['file'];
			}
			foreach ($files as $file) {
				if (!is_string($file) || !preg_match('#^assets/[A-Za-z0-9._-]+$#', $file)) {
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * Id of the production build (hash of the manifest), or null without a build.
	 * @return string|null
	 */
	public static function buildId() {
		self::manifest();
		return self::$buildId;
	}

	/**
	 * Whether the files the theme needs on every page exist.
	 * @return bool
	 */
	public static function isAvailable() {
		$manifest = self::manifest();
		if ($manifest === null) {
			return false;
		}
		$root = self::crmRoot() . '/' . self::DIST . '/';
		return is_file($root . $manifest[self::ENTRY_SHELL]['file']) && is_file($root . $manifest[self::ENTRY_SKIN]['file'])
			&& is_file(self::crmRoot() . '/' . self::LOADER);
	}

	/**
	 * URL of the skin stylesheet (HEADERCSS), relative to index.php.
	 * @return string|null
	 */
	public static function skinUrl() {
		$manifest = self::manifest();
		return $manifest === null ? null : self::DIST . '/' . $manifest[self::ENTRY_SKIN]['file'];
	}

	/**
	 * Stylesheets and scripts of an entry for the module's own pages.
	 * @param string $entry source path of the entry (ENTRY_* constant)
	 * @return array {css: string[], preload: string[], script: string|null}
	 */
	public static function entryTags($entry) {
		$tags = array('css' => array(), 'preload' => array(), 'script' => null);
		$manifest = self::manifest();
		if ($manifest === null || !isset($manifest[$entry]['file'])) {
			return $tags;
		}
		$seen = array();
		$collect = function ($name, $isEntry) use (&$collect, &$tags, &$seen, $manifest) {
			if (isset($seen[$name]) || !isset($manifest[$name])) {
				return;
			}
			$seen[$name] = true;
			$chunk = $manifest[$name];
			foreach (isset($chunk['css']) ? $chunk['css'] : array() as $css) {
				$url = self::DIST . '/' . $css;
				if (!in_array($url, $tags['css'], true)) {
					$tags['css'][] = $url;
				}
			}
			if (!$isEntry) {
				$tags['preload'][] = self::DIST . '/' . $chunk['file'];
			}
			foreach (isset($chunk['imports']) ? $chunk['imports'] : array() as $import) {
				$collect($import, false);
			}
		};
		$collect($entry, true);
		$tags['script'] = self::DIST . '/' . $manifest[$entry]['file'];
		return $tags;
	}

	/**
	 * Forgets the cached manifest (tests, lifecycle after an update).
	 */
	public static function reset() {
		self::$manifest = false;
		self::$buildId = null;
	}
}
