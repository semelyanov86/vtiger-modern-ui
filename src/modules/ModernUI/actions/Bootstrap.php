<?php
/*
 * GET index.php?module=ModernUI&action=Bootstrap — settings, locale and system menu of the current user
 * for the Vue islands. Any logged-in user; Referer is checked by the core; answers with an ETag.
 */

require_once 'modules/ModernUI/models/Client.php';
require_once 'modules/ModernUI/models/Page.php';

class ModernUI_Bootstrap_Action extends Vtiger_Action_Controller {

	/**
	 * The module has no record permissions: ModernUI never uses isPermitted('ModernUI', …), the privilege
	 * files of users are not regenerated when an extension module is imported (docs/architecture.md §3.3).
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
		$decision = ModernUI_Activation_Model::evaluate(null, false);
		$blocking = array(
			ModernUI_Activation_Model::MODULE_INACTIVE,
			ModernUI_Activation_Model::UNSUPPORTED_VTIGER,
			ModernUI_Activation_Model::SCHEMA_MISSING,
			ModernUI_Activation_Model::SCHEMA_OUTDATED,
			ModernUI_Activation_Model::SCHEMA_NEWER,
			ModernUI_Activation_Model::RECOVERY_REQUIRED,
		);
		if (in_array($decision['reason'], $blocking, true)) {
			ModernUI_Page_Model::json(null, array('code' => $decision['reason']), 409);
			return;
		}
		$payload = ModernUI_Client_Model::bootstrap($decision);
		$body = json_encode(array('success' => true, 'result' => $payload), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
		$etag = '"' . substr(sha1($body), 0, 20) . '"';
		header('Cache-Control: private, no-cache');
		header('ETag: ' . $etag);
		$ifNoneMatch = isset($_SERVER['HTTP_IF_NONE_MATCH']) ? trim((string) $_SERVER['HTTP_IF_NONE_MATCH']) : '';
		if ($ifNoneMatch === $etag) {
			http_response_code(304);
			return;
		}
		header('Content-Type: application/json; charset=UTF-8');
		echo $body;
	}
}
