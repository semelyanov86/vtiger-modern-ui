<?php
/*
 * GET index.php?module=ModernUI&action=Tokens&r=<cache key> — the design tokens of the current user as a
 * stylesheet (docs/architecture.md §5.1, variant B chosen on stage 04 by measurement). Printed by the second
 * HEADERCSS link, render-blocking, so the first paint has the user's colours, density and font size — and the
 * stylesheets of the adapters of the extensions that are active (stage 08, docs/architecture.md §7.6).
 *
 * The URL carries the cache key of the user's settings (user, role, revisions, schema, build): when it matches,
 * the answer is cached by the browser for good; any change of the settings gives a new URL. A key that does not
 * match (an old page) gets the current values without caching. Without an active theme the answer is an empty
 * stylesheet: the defaults of the skin apply. Only validated colours and fixed values reach the output.
 */

require_once 'modules/ModernUI/models/Activation.php';
require_once 'modules/ModernUI/models/Tokens.php';
require_once 'modules/ModernUI/models/Adapters.php';

class ModernUI_Tokens_Action extends Vtiger_Action_Controller {

	/**
	 * No record permissions (docs/architecture.md §3.3): only a logged-in user and the module's own checks.
	 * @param Vtiger_Request $request
	 * @return array
	 */
	public function requiresPermission(Vtiger_Request $request) {
		return array();
	}

	public function checkPermission(Vtiger_Request $request) {
		return true;
	}

	public function process(Vtiger_Request $request) {
		$css = "/* ModernUI design tokens: theme not active */\n";
		$cacheable = false;
		try {
			$decision = ModernUI_Activation_Model::evaluate(null, false);
			$context = $decision['context'];
			if ($decision['active'] && $context !== null) {
				$values = $context['settings']['values'];
				$tokens = ModernUI_Tokens_Model::forAppearance(ModernUI_Tokens_Model::appearanceOf($values));
				$css = ModernUI_Tokens_Model::css(array_merge($tokens, ModernUI_Tokens_Model::layout($values)))
					// Layout of the screens with the cloud layout (docs/architecture.md A15).
					. ModernUI_Tokens_Model::layoutCss($values)
					// Stylesheets of the adapters of the active extensions (docs/architecture.md §7.6).
					. ModernUI_Adapters_Model::styles($values);
				$key = $request->get('r');
				$cacheable = is_string($key) && $key !== '' && hash_equals($context['cacheKey'], $key);
			}
		} catch (Throwable $e) {
			$css = "/* ModernUI design tokens: unavailable */\n";
			$cacheable = false;
		}
		// The session start of Vtiger sends no-store headers; replace them for this stylesheet.
		if (function_exists('header_remove')) {
			header_remove('Pragma');
			header_remove('Expires');
		}
		header('Content-Type: text/css; charset=UTF-8');
		header('X-Content-Type-Options: nosniff');
		header($cacheable ? 'Cache-Control: private, max-age=31536000, immutable' : 'Cache-Control: private, no-store');
		echo $css;
	}
}
