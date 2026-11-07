<?php
/**
 * Presentation of the native record inside the page overlay. All data, permissions, links and templates belong to
 * the module's Detail view. There is no record API here: subsequent tabs and saves use the original CRM routes.
 */
class ModernUI_Record_View extends Vtiger_Basic_View {
	private $detailView;
	private $detailRequest;

	public function checkPermission(Vtiger_Request $request) {
		$module = $request->get('sourceModule');
		$record = $request->get('record');
		if (!vtlib_isModuleActive('ModernUI') || !is_string($module)
			|| !preg_match('/^[A-Za-z][A-Za-z0-9_]*$/D', $module)
			|| !preg_match('/^[1-9][0-9]*$/D', (string) $record)) {
			throw new AppException(vtranslate('LBL_PERMISSION_DENIED'));
		}
		$model = Vtiger_Module_Model::getInstance($module);
		if (!$model || !$model->isEntityModule() || !vtlib_isModuleActive($module)) {
			throw new AppException(vtranslate('LBL_PERMISSION_DENIED'));
		}
		$this->detailRequest = new Vtiger_Request(array(
			'module' => $module, 'view' => 'Detail', 'record' => $record, 'app' => $request->get('app'),
		));
		$class = Vtiger_Loader::getComponentClassName('View', 'Detail', $module);
		$this->detailView = new $class();
		$this->detailView->validateRequest($this->detailRequest);
		$this->detailView->checkPermission($this->detailRequest);
		return true;
	}

	public function preProcess(Vtiger_Request $request, $display = true) {}
	public function postProcess(Vtiger_Request $request) {}

	public function process(Vtiger_Request $request) {
		global $currentModule, $mod_strings;
		$previousModule = $currentModule;
		$previousStrings = $mod_strings;
		$previousRequest = $_REQUEST;
		$currentModule = $this->detailRequest->getModule();
		// Legacy helpers such as CustomView still consult the request globals for navigation and permissions.
		$_REQUEST['module'] = $currentModule;
		$_REQUEST['view'] = 'Detail';
		$strings = Vtiger_Language_Handler::getModuleStringsFromFile(Vtiger_Language_Handler::getLanguage(), $currentModule);
		$mod_strings = isset($strings['languageStrings']) ? $strings['languageStrings'] : array();
		try {
			$this->renderRecord();
		} finally {
			$currentModule = $previousModule;
			$mod_strings = $previousStrings;
			$_REQUEST = $previousRequest;
		}
	}

	private function renderRecord() {
		$native = $this->detailRequest;
		// Some native overrides (Inventory) ignore $display=false and emit the entire page header. Keep their setup,
		// but never inject another document or reload global libraries into the list.
		ob_start();
		try {
			$this->detailView->preProcess($native, false);
		} finally {
			ob_end_clean();
		}
		$viewer = $this->detailView->getViewer($native);
		// The native view may echo, return, or combine both (module overrides do all three).
		ob_start();
		try {
			$returned = $this->detailView->process($native);
			$body = ob_get_contents();
			if (is_string($returned)) {
				$body .= $returned;
			}
		} finally {
			ob_end_clean();
		}
		$scripts = array();
		foreach ($this->detailView->getHeaderScripts($native) as $script) {
			$scripts[] = $script->getSrc();
		}
		$viewer->assign('MU_RECORD_SCRIPTS', Vtiger_Functions::jsonEncode($scripts));
		$styles = array();
		foreach ($this->detailView->getHeaderCss($native) as $style) {
			$styles[] = $style->getHref();
		}
		$viewer->assign('MU_RECORD_STYLES', Vtiger_Functions::jsonEncode($styles));
		$viewer->assign('MU_RECORD_BODY', $body);
		$viewer->view('Record.tpl', 'ModernUI');
	}
}
