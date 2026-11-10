<?php
/*
 * Logo and title of the new interface (docs/settings.md §4, branding.*). By default the theme keeps the branding of
 * the CRM (Settings → Company details): the v7 header shows the company logo and nothing is replaced. A logo of
 * the theme is shown in its header and the opt-in public authentication pages; the company logo of the CRM, its documents and
 * PDF templates are never touched.
 *
 * Upload: PNG, JPEG or GIF of at most 512 KB, checked with getimagesize() and decoded by GD, then re-encoded as PNG
 * (any foreign content of the file is dropped) and scaled to fit 600×200. The server names the file
 * modernui_<sha1>.png and stores it in test/logo/ — the standard directory of the CRM logos, served by public.php
 * (type=logo) like the company logo. Nothing of the client's file name or path is used.
 */

require_once 'modules/ModernUI/models/Assets.php';
require_once 'modules/ModernUI/models/Menu.php';

class ModernUI_Branding_Model {

	const LOGO_DIR = 'test/logo';
	const MAX_BYTES = 524288;
	const MIN_SIDE = 16;
	const MAX_SIDE = 4096;
	const FIT_WIDTH = 600;
	const FIT_HEIGHT = 200;
	const FILE_PATTERN = '/^modernui_[0-9a-f]{40}\.png$/';

	/** Seconds an unused uploaded logo is kept (another administrator may be editing a draft with it). */
	const KEEP_UNUSED = 86400;

	/** @var bool tests replace is_uploaded_file() */
	public static $checkUploaded = true;

	/**
	 * @param string $file stored file name
	 * @return string|null URL relative to index.php, or null when the file is missing
	 */
	public static function logoUrl($file) {
		if (!is_string($file) || !preg_match(self::FILE_PATTERN, $file) || !is_file(self::dir() . '/' . $file)) {
			return null;
		}
		return 'public.php?type=logo&key=' . $file;
	}

	/**
	 * Branding for the islands: null values mean "as in the CRM" (the v7 header stays as it is).
	 * @param array $values effective settings
	 * @param string $locale theme locale
	 * @return array {logoUrl: string|null, title: string|null, notice: string|null}
	 */
	public static function forClient(array $values, $locale) {
		$logo = isset($values['branding.logo']) ? $values['branding.logo'] : 'company';
		$title = isset($values['branding.title']) ? $values['branding.title'] : 'company';
		return array(
			'logoUrl' => $logo === 'company' ? null : self::logoUrl($logo),
			'title' => is_array($title) ? ModernUI_Menu_Model::label($title, $locale, null) : null,
			'notice' => !empty($values['branding.noticeEnabled']) && isset($values['branding.notice']) && is_array($values['branding.notice'])
				? ModernUI_Menu_Model::label($values['branding.notice'], $locale, null) : null,
		);
	}

	/**
	 * Name of the organisation of the CRM (Settings → Company details), shown by the editor as the default title.
	 * @return string
	 */
	public static function companyName() {
		$name = ModernUI_Db_Model::value('SELECT organizationname FROM vtiger_organizationdetails ORDER BY organization_id LIMIT 1');
		return is_string($name) ? html_entity_decode($name, ENT_QUOTES, 'UTF-8') : '';
	}

	/**
	 * @return string absolute path of test/logo
	 */
	public static function dir() {
		return ModernUI_Assets_Model::crmRoot() . '/' . self::LOGO_DIR;
	}

	/**
	 * Checks, re-encodes and stores an uploaded logo.
	 * @param mixed $upload entry of $_FILES
	 * @return array {ok: true, file, url, width, height} or {ok: false, code}
	 */
	public static function storeUpload($upload) {
		if (!is_array($upload) || !isset($upload['tmp_name'], $upload['error'], $upload['size']) || !is_string($upload['tmp_name'])) {
			return array('ok' => false, 'code' => 'MU_LOGO_INVALID');
		}
		if ((int) $upload['error'] === UPLOAD_ERR_INI_SIZE || (int) $upload['error'] === UPLOAD_ERR_FORM_SIZE) {
			return array('ok' => false, 'code' => 'MU_LOGO_TOO_LARGE');
		}
		$tmp = $upload['tmp_name'];
		if ((int) $upload['error'] !== UPLOAD_ERR_OK || (self::$checkUploaded && !is_uploaded_file($tmp)) || !is_file($tmp)) {
			return array('ok' => false, 'code' => 'MU_LOGO_INVALID');
		}
		$size = filesize($tmp);
		if ($size === false || $size > self::MAX_BYTES) {
			return array('ok' => false, 'code' => 'MU_LOGO_TOO_LARGE');
		}
		$info = @getimagesize($tmp);
		if (!is_array($info) || !in_array($info[2], array(IMAGETYPE_PNG, IMAGETYPE_JPEG, IMAGETYPE_GIF), true)) {
			return array('ok' => false, 'code' => 'MU_LOGO_FORMAT');
		}
		list($width, $height) = $info;
		if ($width < self::MIN_SIDE || $height < self::MIN_SIDE || $width > self::MAX_SIDE || $height > self::MAX_SIDE) {
			return array('ok' => false, 'code' => 'MU_LOGO_DIMENSIONS');
		}
		if (!function_exists('imagecreatefromstring') || !function_exists('imagepng')) {
			return array('ok' => false, 'code' => 'MU_LOGO_UNSUPPORTED');
		}
		$source = @imagecreatefromstring((string) file_get_contents($tmp));
		if ($source === false) {
			return array('ok' => false, 'code' => 'MU_LOGO_FORMAT');
		}
		$scale = min(1, self::FIT_WIDTH / $width, self::FIT_HEIGHT / $height);
		$targetWidth = max(1, (int) round($width * $scale));
		$targetHeight = max(1, (int) round($height * $scale));
		$target = imagecreatetruecolor($targetWidth, $targetHeight);
		imagealphablending($target, false);
		imagesavealpha($target, true);
		imagefill($target, 0, 0, imagecolorallocatealpha($target, 0, 0, 0, 127));
		imagecopyresampled($target, $source, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);
		ob_start();
		imagepng($target, null, 9);
		$png = (string) ob_get_clean();
		// GD images are objects since PHP 8.0 and are freed with them (imagedestroy() is deprecated in 8.5).
		unset($source, $target);
		if ($png === '') {
			return array('ok' => false, 'code' => 'MU_LOGO_FORMAT');
		}

		$dir = self::dir();
		if (!is_dir($dir) || !is_writable($dir)) {
			return array('ok' => false, 'code' => 'MU_LOGO_STORAGE');
		}
		$file = 'modernui_' . sha1($png) . '.png';
		$path = $dir . '/' . $file;
		if (!is_file($path)) {
			$temporary = $dir . '/.modernui_upload_' . bin2hex(random_bytes(6));
			if (file_put_contents($temporary, $png) !== strlen($png) || !rename($temporary, $path)) {
				@unlink($temporary);
				return array('ok' => false, 'code' => 'MU_LOGO_STORAGE');
			}
			@chmod($path, 0644);
		} else {
			@touch($path);
		}
		return array('ok' => true, 'file' => $file, 'url' => 'public.php?type=logo&key=' . $file, 'width' => $targetWidth, 'height' => $targetHeight);
	}

	/**
	 * Removes uploaded logos of the theme that no settings document uses and that are older than KEEP_UNUSED.
	 * Only files named modernui_<sha1>.png are ever touched.
	 * @param array $keep file names in use
	 * @return int removed files
	 */
	public static function cleanup(array $keep) {
		$removed = 0;
		foreach (glob(self::dir() . '/modernui_*.png') ?: array() as $path) {
			$file = basename($path);
			if (!preg_match(self::FILE_PATTERN, $file) || in_array($file, $keep, true)) {
				continue;
			}
			$mtime = @filemtime($path);
			if ($mtime !== false && time() - $mtime > self::KEEP_UNUSED && @unlink($path)) {
				$removed++;
			}
		}
		return $removed;
	}

	/**
	 * Logo files referenced by stored settings (the global document is the only scope with branding.logo).
	 * @return array
	 */
	public static function filesInUse() {
		$row = ModernUI_Settings_Model::getRow(ModernUI_Settings_Model::SCOPE_GLOBAL, '');
		$values = ModernUI_Settings_Model::decodeRow($row, ModernUI_Settings_Model::SCOPE_GLOBAL);
		$logo = isset($values['values']['branding.logo']) ? $values['values']['branding.logo'] : 'company';
		return $logo === 'company' ? array() : array($logo);
	}

	/**
	 * Removes every logo of the theme (uninstall with data removal).
	 */
	public static function purge() {
		foreach (glob(self::dir() . '/modernui_*.png') ?: array() as $path) {
			if (preg_match(self::FILE_PATTERN, basename($path))) {
				@unlink($path);
			}
		}
	}
}
