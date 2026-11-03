<?php
/*
 * Test fixture of ModernUI (MIT): a minimal entity module from the vtlib template of Vtiger 8.4.0
 * (vtlib/ModuleDir/6.0.0/ModuleName.php). It exists to show that ModernUI has no list of allowed module names.
 */
include_once 'modules/Vtiger/CRMEntity.php';

class Gadgets extends Vtiger_CRMEntity {
	var $table_name = 'vtiger_gadgets';
	var $table_index = 'gadgetsid';
	var $customFieldTable = array('vtiger_gadgetscf', 'gadgetsid');
	var $tab_name = array('vtiger_crmentity', 'vtiger_gadgets', 'vtiger_gadgetscf');
	var $tab_name_index = array(
		'vtiger_crmentity' => 'crmid',
		'vtiger_gadgets' => 'gadgetsid',
		'vtiger_gadgetscf' => 'gadgetsid',
	);
	var $list_fields = array(
		'Gadget Name' => array('gadgets', 'gadgetname'),
		'Serial Number' => array('gadgets', 'serialno'),
		'Assigned To' => array('crmentity', 'smownerid'),
	);
	var $list_fields_name = array(
		'Gadget Name' => 'gadgetname',
		'Serial Number' => 'serialno',
		'Assigned To' => 'assigned_user_id',
	);
	var $list_link_field = 'gadgetname';
	var $search_fields = array(
		'Gadget Name' => array('gadgets', 'gadgetname'),
		'Assigned To' => array('vtiger_crmentity', 'assigned_user_id'),
	);
	var $search_fields_name = array(
		'Gadget Name' => 'gadgetname',
		'Assigned To' => 'assigned_user_id',
	);
	var $popup_fields = array('gadgetname');
	var $def_basicsearch_col = 'gadgetname';
	var $def_detailview_recname = 'gadgetname';
	var $mandatory_fields = array('gadgetname', 'assigned_user_id');
	var $default_order_by = 'gadgetname';
	var $default_sort_order = 'ASC';

	function vtlib_handler($moduleName, $eventType) {
	}
}
