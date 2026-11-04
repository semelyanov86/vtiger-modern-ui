<?php
/*
 * Export and import of the theme settings (docs/settings.md §9), administrators only.
 *
 *   GET  …&action=Transfer&mode=export&parts=global,roles,users — the JSON file (download)
 *   POST …&action=Transfer&mode=preview, json=<file content ≤ 256 KB> — report of what would change, nothing written
 *   POST …&action=Transfer&mode=apply, json, parts, includeMode=0|1, fingerprint=<of the preview> — applies the chosen
 *        parts in one transaction; if any affected scope changed after the preview, nothing is written (MU_CONFLICT)
 */

require_once 'modules/ModernUI/models/Transfer.php';
require_once 'modules/ModernUI/models/Page.php';

class Settings_ModernUI_Transfer_Action extends Settings_Vtiger_Basic_Action {

	public function validateRequest(Vtiger_Request $request) {
		if ($request->getMode() === 'export') {
			return $request->validateReadAccess();
		}
		return $request->validateWriteAccess();
	}

	public function process(Vtiger_Request $request) {
		$state = ModernUI_Schema_Model::state(true);
		if ($state !== ModernUI_Schema_Model::STATE_CURRENT) {
			ModernUI_Page_Model::json(null, array('code' => $state === ModernUI_Schema_Model::STATE_NEWER ? 'MU_SCHEMA_NEWER' : 'MU_SCHEMA_OUTDATED'), 409);
			return;
		}
		$parts = self::parts($request);
		switch ($request->getMode()) {
			case 'export':
				if (!$parts) {
					ModernUI_Page_Model::json(null, array('code' => 'MU_BAD_REQUEST'), 400);
					return;
				}
				$json = json_encode(ModernUI_Transfer_Model::export($parts), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
				header('Content-Type: application/json; charset=UTF-8');
				header('Content-Disposition: attachment; filename="modernui-settings-' . gmdate('Ymd-His') . '.json"');
				header('Cache-Control: private, no-store');
				header('X-Content-Type-Options: nosniff');
				echo $json;
				return;
			case 'preview':
				$analysis = ModernUI_Transfer_Model::analyze($request->getRaw('json'));
				ModernUI_Page_Model::respond($analysis['ok']
					? array('ok' => true, 'report' => $analysis['report'], 'fingerprint' => $analysis['fingerprint'])
					: $analysis);
				return;
			case 'apply':
				if (!$parts) {
					ModernUI_Page_Model::json(null, array('code' => 'MU_BAD_REQUEST'), 400);
					return;
				}
				$userId = (int) Users_Record_Model::getCurrentUserModel()->getId();
				ModernUI_Page_Model::respond(ModernUI_Transfer_Model::apply($request->getRaw('json'), $parts,
					$request->get('includeMode') === '1', (string) $request->get('fingerprint'), $userId));
				return;
		}
		ModernUI_Page_Model::json(null, array('code' => 'MU_BAD_REQUEST'), 400);
	}

	/**
	 * @param Vtiger_Request $request
	 * @return array known parts of the "parts" parameter
	 */
	private static function parts(Vtiger_Request $request) {
		$parts = array();
		foreach (explode(',', (string) $request->getRaw('parts')) as $part) {
			if (in_array($part, array('global', 'roles', 'users'), true) && !in_array($part, $parts, true)) {
				$parts[] = $part;
			}
		}
		return $parts;
	}
}
