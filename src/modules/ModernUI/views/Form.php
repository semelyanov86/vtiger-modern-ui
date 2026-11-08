<?php
/** Compose the module's real Edit view in its native overlay mode, including its permissions and dependencies. */
class ModernUI_Form_View extends Vtiger_Basic_View {
	private $native;
	private $edit;

	public function checkPermission(Vtiger_Request $request) {
		$module = $request->get('formModule');
		if (!vtlib_isModuleActive('ModernUI') || !is_string($module)
			|| !preg_match('/^[A-Za-z][A-Za-z0-9_]*$/D', $module)) {
			throw new AppException(vtranslate('LBL_PERMISSION_DENIED'));
		}
		$model = Vtiger_Module_Model::getInstance($module);
		if (!$model || !$model->isEntityModule() || !vtlib_isModuleActive($module)) {
			throw new AppException(vtranslate('LBL_PERMISSION_DENIED'));
		}
		$params = $request->getAll();
		unset($params['formModule'], $params['action'], $params['parent']);
		$params['module'] = $module;
		$params['view'] = 'Edit';
		$params['displayMode'] = 'overlay';
		$this->native = new Vtiger_Request($params);
		$class = Vtiger_Loader::getComponentClassName('View', 'Edit', $module);
		$this->edit = new $class();
		$this->edit->validateRequest($this->native);
		$this->edit->checkPermission($this->native);
		return true;
	}

	public function preProcess(Vtiger_Request $request, $display = true) {}
	public function postProcess(Vtiger_Request $request) {}

	public function process(Vtiger_Request $request) {
		global $currentModule, $mod_strings;
		$previousModule = $currentModule;
		$previousStrings = $mod_strings;
		$previousRequest = $_REQUEST;
		$currentModule = $this->native->getModule();
		$_REQUEST = array_merge($_REQUEST, $this->native->getAll());
		$strings = Vtiger_Language_Handler::getModuleStringsFromFile(Vtiger_Language_Handler::getLanguage(), $currentModule);
		$mod_strings = isset($strings['languageStrings']) ? $strings['languageStrings'] : array();
		try {
			// Native overrides may echo the full header even with $display=false. Retain their setup only.
			ob_start();
			try {
				$this->edit->preProcess($this->native, false);
			} finally {
				ob_end_clean();
			}
			ob_start();
			try {
				$returned = $this->edit->process($this->native);
				$body = ob_get_contents();
				if (is_string($returned)) {
					$body .= $returned;
				}
			} finally {
				ob_end_clean();
			}
			$viewer = $this->edit->getViewer($this->native);
			$label = vtranslate('SINGLE_'.$currentModule, $currentModule);
			$title = (!$this->native->get('record') || $this->native->get('isDuplicate'))
				? vtranslate('LBL_CREATING_NEW', $currentModule).' '.$label
				: vtranslate('LBL_EDITING', $currentModule).' '.$label;
			$viewer->assign('MU_FORM_TITLE', $title);
			$scripts = array();
			foreach ($this->edit->getHeaderScripts($this->native) as $script) {
				$scripts[] = $script->getSrc();
			}
			$styles = array();
			foreach ($this->edit->getHeaderCss($this->native) as $style) {
				$styles[] = $style->getHref();
			}
			$viewer->assign('MU_RECORD_SCRIPTS', Vtiger_Functions::jsonEncode($scripts));
			$viewer->assign('MU_RECORD_STYLES', Vtiger_Functions::jsonEncode($styles));
			$viewer->assign('MU_FORM_BODY', $body);
			$viewer->view('Form.tpl', 'ModernUI');
		} finally {
			$currentModule = $previousModule;
			$mod_strings = $previousStrings;
			$_REQUEST = $previousRequest;
		}
	}
}
