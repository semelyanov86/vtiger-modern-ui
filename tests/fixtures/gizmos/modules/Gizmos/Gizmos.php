<?php
/*
 * Test fixture of ModernUI (MIT): a minimal entity module from the vtlib template of Vtiger 8.4.0
 * (vtlib/ModuleDir/6.0.0/ModuleName.php). It exists to show that ModernUI has no list of allowed module names.
 */
include_once 'modules/Vtiger/CRMEntity.php';

class Gizmos extends Vtiger_CRMEntity {
	var $table_name = 'vtiger_gizmos';
	var $table_index = 'gizmosid';
	var $customFieldTable = array('vtiger_gizmoscf', 'gizmosid');
	var $tab_name = array('vtiger_crmentity', 'vtiger_gizmos', 'vtiger_gizmoscf');
	var $tab_name_index = array(
		'vtiger_crmentity' => 'crmid',
		'vtiger_gizmos' => 'gizmosid',
		'vtiger_gizmoscf' => 'gizmosid',
	);
	var $list_fields = array(
		'Gizmo Name' => array('gizmos', 'gizmoname'),
		'Serial Number' => array('gizmos', 'serialno'),
		'Assigned To' => array('crmentity', 'smownerid'),
	);
	var $list_fields_name = array(
		'Gizmo Name' => 'gizmoname',
		'Serial Number' => 'serialno',
		'Assigned To' => 'assigned_user_id',
	);
	var $list_link_field = 'gizmoname';
	var $search_fields = array(
		'Gizmo Name' => array('gizmos', 'gizmoname'),
		'Assigned To' => array('vtiger_crmentity', 'assigned_user_id'),
	);
	var $search_fields_name = array(
		'Gizmo Name' => 'gizmoname',
		'Assigned To' => 'assigned_user_id',
	);
	var $popup_fields = array('gizmoname');
	var $def_basicsearch_col = 'gizmoname';
	var $def_detailview_recname = 'gizmoname';
	var $mandatory_fields = array('gizmoname', 'assigned_user_id');
	var $default_order_by = 'gizmoname';
	var $default_sort_order = 'ASC';

	function vtlib_handler($moduleName, $eventType) {
	}
}
