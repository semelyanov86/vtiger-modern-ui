<?php
/**
 * Native related-record counts are read-only and may be slow. Release the session after native permission checks so
 * closing the record does not queue the next navigation behind these counts. The host computes and emits the result.
 */
class ModernUI_RecordCounts_Action extends Vtiger_Action_Controller {
	private $native;
	private $handler;

	public function requiresPermission(Vtiger_Request $request) {
		return array();
	}

	public function checkPermission(Vtiger_Request $request) {
		$module = $request->get('sourceModule');
		$record = $request->get('record');
		if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET' || !vtlib_isModuleActive('ModernUI')
			|| !is_string($module) || !preg_match('/^[A-Za-z][A-Za-z0-9_]*$/D', $module)
			|| !is_scalar($record) || !preg_match('/^[1-9][0-9]*$/D', (string) $record)) {
			throw new AppException(vtranslate('LBL_PERMISSION_DENIED'));
		}
		$model = Vtiger_Module_Model::getInstance($module);
		if (!$model || !$model->isEntityModule() || !vtlib_isModuleActive($module)) {
			throw new AppException(vtranslate('LBL_PERMISSION_DENIED'));
		}
		$this->native = new Vtiger_Request(array(
			'module' => $module, 'action' => 'RelatedRecordsAjax', 'mode' => 'getRelatedRecordsCount', 'recordId' => $record,
		));
		$class = Vtiger_Loader::getComponentClassName('Action', 'RelatedRecordsAjax', $module);
		$this->handler = new $class();
		$this->handler->validateRequest($this->native);
		$this->handler->checkPermission($this->native);
		return true;
	}

	public function process(Vtiger_Request $request) {
		global $currentModule;
		$previousModule = $currentModule;
		$previousRequest = $_REQUEST;
		$currentModule = $this->native->getModule();
		$_REQUEST = array(
			'module' => $currentModule, 'action' => 'RelatedRecordsAjax', 'mode' => 'getRelatedRecordsCount',
			'recordId' => $this->native->get('recordId'),
		);
		try {
			// Only the native read implementation has this contract. A module override retains its normal session lifetime.
			if (get_class($this->handler) === 'Vtiger_RelatedRecordsAjax_Action' && session_status() === PHP_SESSION_ACTIVE) {
				session_write_close();
			}
			$this->handler->process($this->native);
		} finally {
			$currentModule = $previousModule;
			$_REQUEST = $previousRequest;
		}
	}
}
