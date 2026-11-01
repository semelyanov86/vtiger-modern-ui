<?php
/* Test stand-in for vtlib/Vtiger/Link.php: records the link changes of the lifecycle. */
class Vtiger_Link {
	const IGNORE_MODULE = -1;

	public static function addLink($tabid, $type, $label, $url, $iconpath = '', $sequence = 0, $handlerInfo = null) {
		MU_Fake::$links[] = array('add', $tabid, $type, $label, $url, $handlerInfo);
	}

	public static function deleteLink($tabid, $type, $label, $url = false) {
		MU_Fake::$links[] = array('delete', $tabid, $type, $label);
	}
}
