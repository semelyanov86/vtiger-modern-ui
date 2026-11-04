<?php
/*
 * Helpers for the module's own server pages (settings, personal preferences): the theme locale of the user,
 * the {mu_t} Smarty function for the ModernUI dictionaries, the tags of a frontend entry, result messages.
 */

require_once 'modules/ModernUI/models/Activation.php';

class ModernUI_Page_Model {

	/**
	 * Theme locale of the current user (works when the schema is not usable: falls back to the CRM language).
	 * @return array {locale, source}
	 */
	public static function locale() {
		$user = Users_Record_Model::getCurrentUserModel();
		$crmLanguage = $user ? (string) $user->get('language') : '';
		$personal = null;
		$default = null;
		if (ModernUI_Schema_Model::state() === ModernUI_Schema_Model::STATE_CURRENT) {
			$context = ModernUI_Activation_Model::context($user);
			if ($context !== null) {
				$values = $context['settings']['values'];
				$allowed = ModernUI_Settings_Model::allowedUserKeys($values);
				$personal = in_array('locale', $allowed, true) ? $values['locale'] : null;
				$default = $values['locale.default'];
			}
		}
		return ModernUI_Locale_Model::effective($personal, $crmLanguage, $default);
	}

	/**
	 * Registers {mu_t key="…" [name=value …]} for a dictionary module (ModernUI or Settings:ModernUI).
	 * The text is HTML-escaped; parameters replace {name} placeholders.
	 * @param Vtiger_Viewer $viewer
	 * @param string $module
	 * @param string $locale
	 */
	public static function registerPlugins($viewer, $module, $locale) {
		if (isset($viewer->registered_plugins['function']['mu_t'])) {
			return;
		}
		$viewer->registerPlugin('function', 'mu_t', function ($params) use ($module, $locale) {
			$key = isset($params['key']) ? (string) $params['key'] : '';
			$dictionary = isset($params['module']) ? (string) $params['module'] : $module;
			unset($params['key'], $params['module']);
			$text = ModernUI_Locale_Model::translate($key, $dictionary, $locale, $params);
			return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
		});
	}

	/**
	 * Message for the result code of the query string (after a form post), only for expected codes.
	 * @param Vtiger_Request $request
	 * @param array $allowed codes; "error_*" codes are shown as errors
	 * @return array|null {kind: success|danger, key: dictionary key}
	 */
	public static function message($request, array $allowed) {
		$code = (string) $request->get('result');
		if ($code === '' || !in_array($code, $allowed, true)) {
			return null;
		}
		return array(
			'kind' => strpos($code, 'error_') === 0 ? 'danger' : 'success',
			'key' => 'LBL_RESULT_' . strtoupper($code),
		);
	}

	/**
	 * Redirects back to a page of the module after a form post (POST → redirect → GET).
	 * @param string $url relative URL inside the CRM
	 */
	public static function redirect($url) {
		header('Location: ' . $url, true, 303);
	}

	/**
	 * Whether the request expects a JSON answer (fetch of the Vue islands) instead of a redirect.
	 * @return bool
	 */
	public static function wantsJson() {
		return !empty($_SERVER['HTTP_X_REQUESTED_WITH']);
	}

	/**
	 * Writes a JSON answer in the format of Vtiger_Response ({success, result | error}).
	 * @param array|null $result
	 * @param array|null $error {code, params?}
	 * @param int $status HTTP status
	 */
	public static function json($result, $error = null, $status = 200) {
		http_response_code($status);
		header('Content-Type: application/json; charset=UTF-8');
		header('Cache-Control: private, no-cache');
		$body = $error === null ? array('success' => true, 'result' => $result) : array('success' => false, 'error' => $error);
		echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
	}

	/**
	 * A JSON object parameter of a request, read raw (Vtiger_Request::get() decodes JSON and purifies the text, which
	 * would change custom labels).
	 * @param Vtiger_Request $request
	 * @param string $name
	 * @param int $maxBytes
	 * @return array|null
	 */
	public static function jsonParam($request, $name, $maxBytes = 1048576) {
		$raw = $request->getRaw($name);
		if (!is_string($raw) || $raw === '' || strlen($raw) > $maxBytes) {
			return null;
		}
		$value = json_decode($raw, true, 64);
		return is_array($value) && (!$value || array_keys($value) !== range(0, count($value) - 1)) ? $value : null;
	}

	/**
	 * Answers with the result of a model call: {ok: true, …} → success with the rest, otherwise {status, error}.
	 * @param array $result
	 */
	public static function respond(array $result) {
		if (empty($result['ok'])) {
			self::json(null, $result['error'], isset($result['status']) ? $result['status'] : 400);
			return;
		}
		unset($result['ok']);
		self::json($result);
	}
}
