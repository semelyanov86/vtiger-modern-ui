<?php
/*
 * Synthetic data of the clean Vtiger 8.4.0 stand (task clean:seed). Runs inside the web container as www-data:
 *
 *   php /opt/mu-dev/clean/tools/seed.php <CRM root>      (MU_USERS_PASSWORD — password of the synthetic users)
 *
 * Uses only the APIs the standard screens use: Settings_SharingAccess/Profiles/Roles models (as Settings →
 * Sharing Access / Profiles / Roles save them), Users record model (Settings → Users), the webservice API
 * vtws_create (records, line items) and the outgoing server model (Settings → Outgoing Server, sends its test
 * mail to the mail trap). No SQL writes of its own. Idempotent: existing roles, users and records are kept.
 *
 * Users: mu.admin2 — second administrator (A2); mu.limited — role "MU Restricted Sales" under Sales Manager with
 * the profile "MU Restricted" (no Leads and Campaigns, Accounts "Annual Revenue" hidden, "Phone" read-only,
 * Contacts "Mobile" hidden; Accounts, Contacts, Leads, Potentials and HelpDesk are private — U sees own records
 * only) (U); mu.viewer — role "MU Viewer" with the profile "MU View All" (view all records) (G).
 * Records: invented names with Cyrillic and German umlauts, a sales order with line items, a test entity module
 * "Gadgets" (imported through the Module Manager before) gets records when it is installed.
 */
if (PHP_SAPI !== 'cli') {
	http_response_code(404);
	exit(1);
}
$root = isset($argv[1]) ? rtrim($argv[1], '/') : '';
$password = (string) getenv('MU_USERS_PASSWORD');
if ($root === '' || !is_file($root . '/config.inc.php') || $password === '') {
	fwrite(STDERR, "usage: MU_USERS_PASSWORD=… php seed.php <CRM root>\n");
	exit(2);
}
chdir($root);
// The bootstrap of index.php of 8.4.0 (the composer autoloader is needed by the logger).
include_once 'config.php';
require_once 'vendor/autoload.php';
include_once 'include/Webservices/Relation.php';
include_once 'vtlib/Vtiger/Module.php';
include_once 'includes/main/WebUI.php';
include_once 'include/Webservices/Utils.php';
include_once 'include/Webservices/Create.php';
include_once 'include/Webservices/Query.php';

global $current_user, $adb;
$current_user = Users::getActiveAdminUser();
vglobal('current_user', $current_user);
$adminId = (int) $current_user->id;

function say($message) {
	echo "seed: {$message}\n";
}

function wsId($module, $id) {
	return vtws_getWebserviceEntityId($module, $id);
}

/** Id of a record found by its label field, or 0. */
function findRecord($module, $field, $value) {
	global $current_user;
	$rows = vtws_query(sprintf("SELECT id FROM %s WHERE %s = '%s';", $module, $field, addslashes($value)), $current_user);
	return $rows ? $rows[0]['id'] : '';
}

function ensureRecord($module, $field, array $values) {
	global $current_user;
	$existing = findRecord($module, $field, $values[$field]);
	if ($existing !== '') {
		return $existing;
	}
	$created = vtws_create($module, $values, $current_user);
	say("{$module} \"{$values[$field]}\" created");
	return $created['id'];
}

// 1. Sharing access: private records for the modules U is checked against (Settings → Sharing Access).
$private = array('Accounts', 'Leads', 'Potentials', 'HelpDesk');
$changed = false;
foreach ($private as $moduleName) {
	$module = Settings_SharingAccess_Module_Model::getInstance($moduleName);
	if ((int) $module->get('permission') !== Settings_SharingAccess_Module_Model::SHARING_ACCESS_PRIVATE) {
		$module->set('permission', Settings_SharingAccess_Module_Model::SHARING_ACCESS_PRIVATE);
		$module->save();
		$changed = true;
	}
}
if ($changed) {
	Settings_SharingAccess_Module_Model::recalculateSharingRules();
	say('sharing access: ' . implode(', ', $private) . ' (and Contacts with Accounts) private');
}

// 2. Profiles, built the way the profile edit form submits them: a copy of "Sales Profile" with changes.
function profilePermissions(Settings_Profiles_Record_Model $base) {
	$permissions = array();
	$actions = Vtiger_Action_Model::getAll(true);
	foreach ($base->getModulePermissions() as $tabId => $module) {
		$entry = array();
		if ($base->hasModulePermission($module)) {
			$entry['is_permitted'] = 'on';
		}
		$entry['actions'] = array();
		foreach ($actions as $action) {
			if ($action->isModuleEnabled($module) && $base->hasModuleActionPermission($module, $action)) {
				$entry['actions'][$action->getId()] = 'on';
			}
		}
		$entry['fields'] = array();
		foreach ($module->getFields() as $field) {
			$entry['fields'][$field->getId()] = $base->getModuleFieldPermissionValue($module, $field);
		}
		$permissions[$tabId] = $entry;
	}
	return $permissions;
}

function ensureProfile($name, $description, $viewAll, callable $change) {
	$profile = Settings_Profiles_Record_Model::getInstanceByName($name);
	if ($profile) {
		return $profile->getId();
	}
	$base = Settings_Profiles_Record_Model::getInstanceByName('Sales Profile');
	$permissions = $change(profilePermissions($base));
	$profile = new Settings_Profiles_Record_Model();
	$profile->set('profilename', $name);
	$profile->set('description', $description);
	$profile->set('viewall', $viewAll ? 'on' : null);
	$profile->set('editall', null);
	$profile->set('profile_permissions', $permissions);
	$id = $profile->save();
	say("profile \"{$name}\" created");
	return $id;
}

$restrictedProfile = ensureProfile('MU Restricted', 'ModernUI checks: restricted modules and fields', false, function ($permissions) {
	foreach (array('Leads', 'Campaigns') as $moduleName) {
		unset($permissions[getTabid($moduleName)]['is_permitted']);
	}
	$fields = array('Accounts' => array('annual_revenue' => Settings_Profiles_Record_Model::PROFILE_FIELD_INACTIVE,
		'phone' => Settings_Profiles_Record_Model::PROFILE_FIELD_READONLY),
		'Contacts' => array('mobile' => Settings_Profiles_Record_Model::PROFILE_FIELD_INACTIVE));
	foreach ($fields as $moduleName => $list) {
		$module = Vtiger_Module_Model::getInstance($moduleName);
		foreach ($list as $fieldName => $value) {
			$permissions[$module->getId()]['fields'][Vtiger_Field_Model::getInstance($fieldName, $module)->getId()] = $value;
		}
	}
	return $permissions;
});
$viewAllProfile = ensureProfile('MU View All', 'ModernUI checks: view all records', true, function ($permissions) {
	return $permissions;
});

// 3. Roles (Settings → Roles → Add): parent role, then profiles recalculated as the save action does.
function ensureRole($name, $parentName, $profileId) {
	$role = Settings_Roles_Record_Model::getInstanceByName($name);
	if ($role) {
		return $role->getId();
	}
	$parent = Settings_Roles_Record_Model::getInstanceByName($parentName);
	$role = new Settings_Roles_Record_Model();
	$role->set('rolename', $name);
	$role->set('profileIds', array($profileId));
	$role->set('allowassignedrecordsto', 1);
	$parent->addChildRole($role);
	// addChildRole() does not put the new id into the model: read the role back by its name.
	$roleId = Settings_Roles_Record_Model::getInstanceByName($name)->getId();
	Settings_Profiles_Record_Model::getInstanceById($profileId)->recalculate(array($roleId));
	say("role \"{$name}\" ({$roleId}) under \"{$parentName}\" created");
	return $roleId;
}

$restrictedRole = ensureRole('MU Restricted Sales', 'Sales Manager', $restrictedProfile);
$viewerRole = ensureRole('MU Viewer', 'CEO', $viewAllProfile);
$ceoRole = Settings_Roles_Record_Model::getInstanceByName('CEO')->getId();

// 4. Users (Settings → Users → Add): preferences copied from the administrator.
function ensureUser($userName, $first, $last, $roleId, $isAdmin, $password) {
	global $adb;
	$found = $adb->pquery('SELECT id FROM vtiger_users WHERE user_name = ?', array($userName));
	if ($adb->num_rows($found)) {
		$id = (int) $adb->query_result($found, 0, 'id');
		$user = Users_Record_Model::getInstanceById($id, 'Users');
		if ($user->get('roleid') !== $roleId) {
			// Settings → Users → Edit: the role of an existing synthetic user.
			$user->set('mode', 'edit');
			$user->set('id', $id);
			$user->set('roleid', $roleId);
			$user->save();
			say("user {$userName}: role {$roleId}");
		}
		return $id;
	}
	$admin = Users_Record_Model::getInstanceById(Users::getActiveAdminId(), 'Users');
	$user = Vtiger_Record_Model::getCleanInstance('Users');
	foreach (array('currency_id', 'date_format', 'time_zone', 'hour_format', 'start_hour', 'end_hour', 'language',
		'activity_view', 'callduration', 'othereventduration', 'defaulteventstatus', 'defaultactivitytype',
		'reminder_interval', 'dayoftheweek', 'currency_decimal_separator', 'currency_grouping_separator',
		'currency_symbol_placement', 'currency_grouping_pattern', 'no_of_currency_decimals', 'truncate_trailing_zeros',
		'rowheight', 'defaultlandingpage', 'default_record_view', 'leftpanelhide', 'theme') as $field) {
		$user->set($field, $admin->get($field));
	}
	$user->set('mode', '');
	$user->set('user_name', $userName);
	$user->set('user_password', $password);
	$user->set('confirm_password', $password);
	$user->set('first_name', $first);
	$user->set('last_name', $last);
	$user->set('email1', $userName . '@clean.example.test');
	$user->set('roleid', $roleId);
	$user->set('is_admin', $isAdmin ? 'on' : 'off');
	$user->set('status', 'Active');
	$user->save();
	say("user {$userName} created (" . ($isAdmin ? 'administrator' : $roleId) . ')');
	return (int) $user->getId();
}

$admin2 = ensureUser('mu.admin2', 'Anna', 'Müller', $ceoRole, true, $password);
$limited = ensureUser('mu.limited', 'Иван', 'Петров', $restrictedRole, false, $password);
$viewer = ensureUser('mu.viewer', 'Jürgen', 'Weiß', $viewerRole, false, $password);

// 5. Outgoing mail → the mail trap of the stand (Settings → Outgoing Server; saving sends a test mail).
$mail = Settings_Vtiger_Systems_Model::getInstanceFromServerType('email', 'OutgoingServer');
if ($mail->get('server') !== 'mail:1025') {
	// The same request as the form of Settings → Outgoing Server (send_mail() reads the server from it).
	$form = array('module' => 'Settings', 'server_type' => 'email', 'server' => 'mail:1025', 'server_username' => '', 'server_password' => '',
		'from_email_field' => 'crm@clean.example.test');
	$savedRequest = $_REQUEST;
	$_REQUEST = array_merge($_REQUEST, $form);
	$request = new Vtiger_Request($form, $form);
	$mail->setData($request->getAll());
	try {
		$mail->save($request);
		say('outgoing mail server: mail trap of the stand');
	} catch (Exception $e) {
		say('outgoing mail server: ' . $e->getMessage());
	}
	$_REQUEST = $savedRequest;
}

// 6. Records (webservice API, as the administrator). Owners decide what U may see.
$u = wsId('Users', $limited);
$a = wsId('Users', $adminId);
$g = wsId('Users', $viewer);
$accounts = array(
	array('Müller & Söhne GmbH', $u, 'Düsseldorf', 'Königsallee 12'),
	array('Acme Widgets Ltd', $u, 'Leeds', '1 Market Street'),
	array('ООО «Ромашка»', $a, 'Москва', 'ул. Лесная, 5'),
	array('Weißbier Großhandel AG', $a, 'München', 'Straßberger Straße 3'),
	array('Northwind Traders', $g, 'Seattle', '42 Pine Street'),
);
$accountIds = array();
foreach ($accounts as $account) {
	$accountIds[$account[0]] = ensureRecord('Accounts', 'accountname', array('accountname' => $account[0], 'assigned_user_id' => $account[1],
		'bill_city' => $account[2], 'bill_street' => $account[3], 'ship_city' => $account[2], 'ship_street' => $account[3],
		'phone' => '+49 211 555 01 ' . strlen($account[0]), 'annual_revenue' => 125000 + 1000 * strlen($account[0]),
		'industry' => 'Manufacturing', 'accounttype' => 'Customer'));
}
$contacts = array(
	array('Jörg', 'Schäfer', 'Müller & Söhne GmbH', $u),
	array('Emily', 'Clarke', 'Acme Widgets Ltd', $u),
	array('Мария', 'Иванова', 'ООО «Ромашка»', $a),
	array('Lena', 'Groß', 'Weißbier Großhandel AG', $a),
);
foreach ($contacts as $contact) {
	ensureRecord('Contacts', 'lastname', array('firstname' => $contact[0], 'lastname' => $contact[1], 'account_id' => $accountIds[$contact[2]],
		'assigned_user_id' => $contact[3], 'email' => strtolower(preg_replace('/[^A-Za-z]/', '', iconv('UTF-8', 'ASCII//TRANSLIT', $contact[1]))) . '@example.test',
		'mobile' => '+49 170 555 0' . strlen($contact[1]), 'mailingcity' => 'Berlin'));
}
foreach (array(array('Ölmühle', 'Krämer', $u), array('Сергей', 'Кузнецов', $a)) as $lead) {
	ensureRecord('Leads', 'lastname', array('firstname' => $lead[0], 'lastname' => $lead[1], 'company' => 'Lead ' . $lead[1],
		'assigned_user_id' => $lead[2], 'leadstatus' => 'Not Contacted'));
}
foreach (array(array('Fensterwartung 2027', 'Müller & Söhne GmbH', $u), array('Поставка окон', 'ООО «Ромашка»', $a)) as $deal) {
	ensureRecord('Potentials', 'potentialname', array('potentialname' => $deal[0], 'related_to' => $accountIds[$deal[1]],
		'assigned_user_id' => $deal[2], 'closingdate' => date('Y-m-d', strtotime('+30 days')), 'sales_stage' => 'Prospecting', 'amount' => 4800));
}
$products = array();
foreach (array(array('Fenster Typ Ä', 240), array('Окно ПВХ 1200×1400', 180), array('Widget Pro', 35.5)) as $product) {
	$products[$product[0]] = ensureRecord('Products', 'productname', array('productname' => $product[0], 'unit_price' => $product[1],
		'discontinued' => 1, 'assigned_user_id' => $a, 'qtyinstock' => 100));
}
$service = ensureRecord('Services', 'servicename', array('servicename' => 'Montage / Монтаж', 'unit_price' => 60, 'discontinued' => 1,
	'assigned_user_id' => $a));
if (findRecord('SalesOrder', 'subject', 'Bestellung Ä-001') === '') {
	// vtws_create() of inventory records fails in 8.4.0 ("Id specified is incorrect": the before-save events need a
	// record id). The order is saved like its edit form does it: the record model with the line items in the request.
	$crmId = function ($wsId) {
		$parts = explode('x', $wsId);
		return (int) $parts[1];
	};
	$lines = array(
		array($crmId($products['Fenster Typ Ä']), 'Products', 3, 240, 'Weiß, 3-fach Verglasung'),
		array($crmId($service), 'Services', 2, 60, 'Монтаж и вывоз'),
	);
	$subtotal = 3 * 240 + 2 * 60;
	$form = array('module' => 'SalesOrder', 'action' => 'Save', 'totalProductCount' => count($lines), 'taxtype' => 'group',
		'subtotal' => $subtotal, 'pre_tax_total' => $subtotal, 'discount_type_final' => 'zero', 'shipping_handling_charge' => 0,
		's_h_percent' => 0, 'adjustmentType' => '+', 'adjustment' => 0, 'total' => $subtotal);
	foreach ($lines as $index => $line) {
		$n = $index + 1;
		$form += array("hdnProductId{$n}" => $line[0], "lineItemType{$n}" => $line[1], "qty{$n}" => $line[2], "listPrice{$n}" => $line[3],
			"comment{$n}" => $line[4], "discount_type{$n}" => 'zero', "deleted{$n}" => 0, "productDescription{$n}" => '',
			"purchaseCost{$n}" => 0, "margin{$n}" => $line[2] * $line[3]);
	}
	$savedRequest = $_REQUEST;
	$_REQUEST = $form;
	$order = Vtiger_Record_Model::getCleanInstance('SalesOrder');
	foreach (array('subject' => 'Bestellung Ä-001', 'account_id' => $crmId($accountIds['Müller & Söhne GmbH']), 'assigned_user_id' => $limited,
		'sostatus' => 'Created', 'invoicestatus' => 'AutoCreated', 'bill_street' => 'Königsallee 12', 'ship_street' => 'Königsallee 12',
		'bill_city' => 'Düsseldorf', 'ship_city' => 'Düsseldorf', 'currency_id' => 1, 'conversion_rate' => 1, 'hdnTaxType' => 'group') as $field => $value) {
		$order->set($field, $value);
	}
	$order->set('mode', '');
	$order->save();
	$_REQUEST = $savedRequest;
	say('SalesOrder "Bestellung Ä-001" with 2 line items created');
}
ensureRecord('HelpDesk', 'ticket_title', array('ticket_title' => 'Fenster klemmt / окно заедает', 'ticketstatus' => 'Open',
	'ticketpriorities' => 'Normal', 'parent_id' => $accountIds['Müller & Söhne GmbH'], 'assigned_user_id' => $u));
ensureRecord('Events', 'subject', array('subject' => 'Aufmaß vor Ort', 'activitytype' => 'Meeting', 'eventstatus' => 'Planned',
	'date_start' => date('Y-m-d', strtotime('+2 days')), 'time_start' => '10:00:00', 'due_date' => date('Y-m-d', strtotime('+2 days')),
	'time_end' => '11:00:00', 'duration_hours' => 1, 'assigned_user_id' => $u, 'visibility' => 'Public'));
ensureRecord('Calendar', 'subject', array('subject' => 'Позвонить клиенту', 'activitytype' => 'Task', 'taskstatus' => 'Not Started',
	'date_start' => date('Y-m-d', strtotime('+1 day')), 'due_date' => date('Y-m-d', strtotime('+1 day')), 'time_start' => '09:00:00',
	'assigned_user_id' => $u));

// 7. The test entity module (Module Manager import of tests/fixtures/gadgets, task clean:seed imports it first).
if (Vtiger_Module::getInstance('Gadgets')) {
	foreach (array(array('Messgerät Ü-7', $u), array('Сканер-тестер', $a)) as $gadget) {
		ensureRecord('Gadgets', 'gadgetname', array('gadgetname' => $gadget[0], 'serialno' => 'SN-' . strlen($gadget[0]) . '-2026',
			'assigned_user_id' => $gadget[1]));
	}
} else {
	say('module Gadgets is not installed yet — no Gadgets records');
}
say("done: users mu.admin2={$admin2}, mu.limited={$limited}, mu.viewer={$viewer}");
