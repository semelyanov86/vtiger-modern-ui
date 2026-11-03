<?php
/*
 * Pilot users and roles of Settings → ModernUI: who can be added, labels, deleted entries stay removable.
 */
require_once 'modules/ModernUI/models/Pilot.php';

function mu_pilot_fixture() {
	MU_Fake::answer('FROM vtiger_users ORDER BY', array(
		array('id' => '1', 'user_name' => 'admin', 'first_name' => '', 'last_name' => 'Administrator', 'status' => 'Active', 'deleted' => '0'),
		array('id' => '6', 'user_name' => 'mu.limited', 'first_name' => 'Иван', 'last_name' => 'Петров', 'status' => 'Active', 'deleted' => '0'),
		array('id' => '7', 'user_name' => 'old', 'first_name' => 'Jürgen', 'last_name' => 'Weiß', 'status' => 'Inactive', 'deleted' => '0'),
	));
	MU_Fake::answer('FROM vtiger_role ORDER BY', array(
		array('roleid' => 'H1', 'rolename' => 'Organization'),
		array('roleid' => 'H2', 'rolename' => 'CEO'),
		array('roleid' => 'H6', 'rolename' => 'MU Restricted Sales'),
	));
}

test('pilot: entries with labels, options without listed, inactive users and the root role', function () {
	mu_pilot_fixture();
	$overview = ModernUI_Pilot_Model::overview(array(6, 99), array('H6'));
	assert_same(array(array('id' => 6, 'label' => 'Иван Петров (mu.limited)'), array('id' => 99, 'label' => '#99')), $overview['users'],
		'listed users, a deleted one by id');
	assert_same(array(array('id' => 1, 'label' => 'Administrator (admin)')), $overview['userOptions'], 'only active users not listed yet');
	assert_same(array(array('id' => 'H6', 'label' => 'MU Restricted Sales')), $overview['roles'], 'listed roles');
	assert_same(array(array('id' => 'H2', 'label' => 'CEO')), $overview['roleOptions'], 'roles without H1 and the listed ones');
});

test('pilot: only active users and existing roles can be added', function () {
	MU_Fake::answer("status = 'Active' AND deleted = 0", array(array('id' => '6')));
	assert_true(ModernUI_Pilot_Model::isActiveUser(6), 'active user');
	MU_Fake::reset();
	assert_true(!ModernUI_Pilot_Model::isActiveUser(7), 'unknown or inactive user');
	MU_Fake::answer('SELECT roleid FROM vtiger_role WHERE roleid = ?', array(array('roleid' => 'H6')));
	assert_true(ModernUI_Pilot_Model::roleExists('H6'), 'existing role');
	assert_true(!ModernUI_Pilot_Model::roleExists('H6; DROP'), 'malformed role id is refused before any query');
	$queries = count(MU_Fake::$queries);
	ModernUI_Pilot_Model::roleExists("H'1");
	assert_same($queries, count(MU_Fake::$queries), 'no query for a malformed role id');
});
