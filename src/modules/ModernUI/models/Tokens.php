<?php
/*
 * Design tokens of a user (docs/design.md §13.4, docs/architecture.md §5.1): the effective appearance settings
 * turned into CSS variables. The same map is printed as a render-blocking stylesheet by action=Tokens (second
 * HEADERCSS link, so the first paint already has the user's colours and density) and sent to the islands by
 * action=Bootstrap. frontend/src/boot/tokens.ts computes the same map for the live preview; both sides are
 * checked against tests/fixtures/tokens.json.
 *
 * Every value is validated here again (the settings are validated when read, this is the last line before
 * CSS output): only #rrggbb colours, the allowed enums and fixed strings can reach the stylesheet.
 */

require_once 'modules/ModernUI/models/Settings.php';

class ModernUI_Tokens_Model {

	const DEFAULT_PRIMARY = '#3978fe';
	/**
	 * The cloud reference for the default primary colour (docs/design.md §13.4, measured 2026-11-07): primary buttons are
	 * filled with the colour itself, the hover is #315dff, checked check boxes are #2e81ff, hovered rows #e7f1ff.
	 */
	const DEFAULT_PRIMARY_STRONG = '#3978fe';
	const DEFAULT_PRIMARY_HOVER = '#315dff';
	const DEFAULT_PRIMARY_SOFT = '#e7f1ff';
	const DEFAULT_PRIMARY_CHECK = '#2e81ff';

	/**
	 * A colour of the settings fills the buttons as it is while white text on it reaches the contrast of the reference
	 * (#3978fe: 3.97:1); a lighter colour is darkened until white text reaches WCAG AA (4.5:1) — docs/design.md §13.5.
	 */
	const FILL_CONTRAST = 3.9;
	const STRONG_CONTRAST = 4.5;
	const HOVER_DARKEN = 0.08;
	const SOFT_MIX = 0.12;

	/** @var array density => token => value (docs/design.md §3.3) */
	private static $density = array(
		'compact' => array('row-height' => '32px', 'table-head-height' => '40px', 'input-height' => '30px', 'button-height' => '28px',
			'cell-padding' => '8px', 'menu-item-height' => '30px', 'icon-button' => '32px'),
		'standard' => array('row-height' => '40px', 'table-head-height' => '50px', 'input-height' => '36px', 'button-height' => '34px',
			'cell-padding' => '12px', 'menu-item-height' => '36px', 'icon-button' => '36px'),
		'comfortable' => array('row-height' => '48px', 'table-head-height' => '56px', 'input-height' => '40px', 'button-height' => '38px',
			'cell-padding' => '16px', 'menu-item-height' => '40px', 'icon-button' => '40px'),
	);

	/**
	 * Appearance part of the effective settings, with the defaults of the schema for missing or invalid values.
	 * @param array $values effective settings (flat map)
	 * @return array {primaryColor, background, surface, density, fontScale, font}
	 */
	public static function appearanceOf(array $values) {
		$keys = array(
			'primaryColor' => 'appearance.primaryColor',
			'background' => 'appearance.background',
			'surface' => 'appearance.surface',
			'density' => 'appearance.density',
			'fontScale' => 'appearance.fontScale',
			'font' => 'appearance.font',
		);
		$spec = ModernUI_Settings_Model::spec();
		$appearance = array();
		foreach ($keys as $name => $key) {
			$check = ModernUI_Settings_Model::validate($spec[$key]['scopes'][0], array($key => isset($values[$key]) ? $values[$key] : null));
			$appearance[$name] = isset($check['values'][$key]) ? $check['values'][$key] : $spec[$key]['default'];
		}
		return $appearance;
	}

	/**
	 * CSS variables (name without the leading "--mu-" => value) for an appearance.
	 * @param array $appearance as appearanceOf()
	 * @return array
	 */
	public static function forAppearance(array $appearance) {
		$appearance = self::appearanceOf(array(
			'appearance.primaryColor' => isset($appearance['primaryColor']) ? $appearance['primaryColor'] : null,
			'appearance.background' => isset($appearance['background']) ? $appearance['background'] : null,
			'appearance.surface' => isset($appearance['surface']) ? $appearance['surface'] : null,
			'appearance.density' => isset($appearance['density']) ? $appearance['density'] : null,
			'appearance.fontScale' => isset($appearance['fontScale']) ? $appearance['fontScale'] : null,
			'appearance.font' => isset($appearance['font']) ? $appearance['font'] : null,
		));
		$primary = $appearance['primaryColor'];
		$default = $primary === self::DEFAULT_PRIMARY;
		$strong = $default ? self::DEFAULT_PRIMARY_STRONG : self::strongVariant($primary);
		$fonts = array('cloud' => 'var(--mu-font-cloud)', 'inter' => 'var(--mu-font-inter)', 'system' => 'var(--mu-font-system)');
		$tokens = array(
			'primary' => $primary,
			'primary-strong' => $strong,
			'primary-hover' => $default ? self::DEFAULT_PRIMARY_HOVER : self::darken($strong, self::HOVER_DARKEN),
			'primary-soft' => $default ? self::DEFAULT_PRIMARY_SOFT : self::mixWithWhite($primary, self::SOFT_MIX),
			'primary-check' => $default ? self::DEFAULT_PRIMARY_CHECK : $strong,
			'bg' => $appearance['background'],
			'surface' => $appearance['surface'],
			'font-scale' => self::scale($appearance['fontScale']),
			'font-family' => isset($fonts[$appearance['font']]) ? $fonts[$appearance['font']] : $fonts['cloud'],
		);
		return array_merge($tokens, self::$density[$appearance['density']]);
	}

	/** Height of the favorites bar above the v7 header (docs/design.md §5.1). */
	const FAVORITES_BAR = '42px';

	/**
	 * Layout variables of the shell that the first paint needs (docs/design.md §5.1, docs/architecture.md §7.5): the
	 * space of the favorites bar above the v7 header is reserved by the render-blocking stylesheet, so the header and
	 * the page do not move when the island mounts. The bar is shown when favorites are enabled and the user has
	 * favorites or may add them; the shell sets the same variable inline from the menu it really mounted.
	 * @param array $values effective settings
	 * @return array
	 */
	public static function layout(array $values) {
		$enabled = !isset($values['navigation.favoritesEnabled']) || $values['navigation.favoritesEnabled'];
		$favorites = isset($values['navigation.favorites']) && is_array($values['navigation.favorites']) ? $values['navigation.favorites'] : array();
		$canEdit = in_array('navigation.favorites', ModernUI_Settings_Model::allowedUserKeys($values), true);
		return array('favorites-bar' => $enabled && ($favorites || $canEdit) ? self::FAVORITES_BAR : '0px');
	}

	/**
	 * Modules whose list opens a record over the list (settings key layout.modules, docs/architecture.md A15). The layout of
	 * the screens without the permanent module rail is the same for every module since stage 11 (skin/_shell.scss).
	 * @param array $values effective settings
	 * @return array names, validated again
	 */
	public static function layoutModules(array $values) {
		$modules = isset($values['layout.modules']) && is_array($values['layout.modules']) ? $values['layout.modules'] : array();
		$names = array();
		foreach ($modules as $module) {
			if (is_string($module) && preg_match('/^[A-Za-z0-9_]{1,50}$/', $module) && !in_array($module, $names, true)) {
				$names[] = $module;
			}
		}
		return $names;
	}

	/**
	 * The stylesheet of action=Tokens. Selector html:root:not(.mu-off) is more specific than the defaults of the
	 * skin (:root:not(.mu-off)), so the order of the two HEADERCSS links does not matter, and "standard view"
	 * (html.mu-off) switches both off.
	 * @param array $tokens forAppearance()
	 * @return string
	 */
	public static function css(array $tokens) {
		$declarations = array();
		foreach ($tokens as $name => $value) {
			if (!preg_match('/^[a-z0-9-]{1,40}$/', $name) || !is_string($value) || !preg_match('/^[#a-zA-Z0-9.,%() -]{1,64}$/', $value)) {
				continue;
			}
			$declarations[] = '--mu-' . $name . ':' . $value;
		}
		return "/* ModernUI design tokens */\nhtml:root:not(.mu-off){" . implode(';', $declarations) . "}\n";
	}

	/**
	 * "1", "0.9", "1.1", "1.25" for 100, 90, 110, 125 %.
	 * @param int $percent
	 * @return string
	 */
	private static function scale($percent) {
		$value = rtrim(rtrim(number_format($percent / 100, 2, '.', ''), '0'), '.');
		return $value === '' ? '1' : $value;
	}

	/**
	 * WCAG contrast ratio of two #rrggbb colours.
	 * @param string $a
	 * @param string $b
	 * @return float
	 */
	public static function contrast($a, $b) {
		$la = ModernUI_Settings_Model::luminance($a);
		$lb = ModernUI_Settings_Model::luminance($b);
		return (max($la, $lb) + 0.05) / (min($la, $lb) + 0.05);
	}

	/**
	 * @param string $hex #rrggbb
	 * @param float $amount 0 … 1 towards black
	 * @return string
	 */
	public static function darken($hex, $amount) {
		$keep = 1 - $amount;
		return self::hex(hexdec(substr($hex, 1, 2)) * $keep, hexdec(substr($hex, 3, 2)) * $keep, hexdec(substr($hex, 5, 2)) * $keep);
	}

	/**
	 * @param string $hex #rrggbb
	 * @param float $weight share of the colour (0 … 1), the rest is white
	 * @return string
	 */
	public static function mixWithWhite($hex, $weight) {
		$mix = function ($channel) use ($weight) {
			return $channel * $weight + 255 * (1 - $weight);
		};
		return self::hex($mix(hexdec(substr($hex, 1, 2))), $mix(hexdec(substr($hex, 3, 2))), $mix(hexdec(substr($hex, 5, 2))));
	}

	/**
	 * The colour itself if white text on it reaches the contrast of the reference (FILL_CONTRAST), otherwise the nearest
	 * darker variant on which white text reaches WCAG AA (STRONG_CONTRAST).
	 * @param string $hex
	 * @return string
	 */
	public static function strongVariant($hex) {
		if (self::contrast($hex, '#ffffff') >= self::FILL_CONTRAST) {
			return $hex;
		}
		$candidate = $hex;
		for ($step = 0; $step < 40 && self::contrast($candidate, '#ffffff') < self::STRONG_CONTRAST; $step++) {
			$candidate = self::darken($hex, ($step + 1) * 0.025);
		}
		return $candidate;
	}

	private static function hex($r, $g, $b) {
		$out = '#';
		foreach (array($r, $g, $b) as $channel) {
			$out .= str_pad(dechex((int) max(0, min(255, round($channel)))), 2, '0', STR_PAD_LEFT);
		}
		return $out;
	}
}
