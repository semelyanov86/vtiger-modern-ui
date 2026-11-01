<?php
/*
 * ModernUI: an installable extension module with a modern interface for Vtiger CRM 8.4.
 *
 * vtlib calls vtlib_handler() of this class for the lifecycle events of the module (import, update,
 * enable/disable in the Module Manager, removal). The work is done by ModernUI_Lifecycle_Model so
 * that every step stays idempotent and touches only what belongs to ModernUI.
 */

require_once 'modules/ModernUI/models/Lifecycle.php';

class ModernUI {

	/**
	 * Lifecycle entry point of vtlib (Vtiger_Module::fireEvent()).
	 * @param string $moduleName
	 * @param string $eventType one of the Vtiger_Module::EVENT_MODULE_* values
	 */
	public function vtlib_handler($moduleName, $eventType) {
		if ($moduleName !== 'ModernUI') {
			return;
		}
		ModernUI_Lifecycle_Model::handle((string) $eventType);
	}
}
