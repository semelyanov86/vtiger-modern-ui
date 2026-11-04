<?php
require_once 'modules/ModernUI/models/Menu.php';

/**
 * Candidates as ModernUI_Menu_Model::candidates() gives them for a user: Contacts in two apps, Leads only in
 * MARKETING, a custom module without an app, a module the administrator removed from the v7 menu.
 */
function mu_candidates($only = null) {
	$candidate = function ($module, array $apps, $defaultHidden = false) {
		return array('module' => $module, 'label' => $module . ' (CRM)', 'apps' => $apps,
			'icon' => array('kind' => 'vicon', 'name' => 'vicon-' . strtolower($module)),
			'url' => 'index.php?module=' . $module . '&view=List', 'defaultHidden' => $defaultHidden);
	};
	$list = array(
		'Leads' => $candidate('Leads', array('MARKETING')),
		'Contacts' => $candidate('Contacts', array('MARKETING', 'SALES')),
		'Potentials' => $candidate('Potentials', array('SALES')),
		'Home' => $candidate('Home', array()),
		'Gadgets' => $candidate('Gadgets', array()),
		'Hidden' => $candidate('Hidden', array(), true),
	);
	if ($only !== null) {
		$list = array_intersect_key($list, array_flip($only));
	}
	$appOrder = array();
	foreach ($list as $name => $entry) {
		foreach ($entry['apps'] as $app) {
			$appOrder[$app][] = $name;
		}
	}
	return array('list' => $list, 'appOrder' => $appOrder);
}

function mu_translate($key) {
	return array('LBL_MENU_APP_MARKETING' => 'Marketing (theme)', 'LBL_MENU_APP_SALES' => 'Sales (theme)',
		'LBL_MENU_GROUP_OTHER' => 'Other modules (theme)')[$key] ?? $key;
}

function mu_menu_ids(array $menu) {
	$ids = array();
	foreach ($menu['groups'] as $group) {
		$ids[$group['id']] = array_map(function ($item) {
			return $item['id'];
		}, $group['items']);
	}
	return $ids;
}

test('menu: without a configuration the menu repeats the v7 apps, then "Other modules"; hidden by v7 stays hidden', function () {
	$menu = ModernUI_Menu_Model::assemble(ModernUI_Settings_Model::defaults(), 'en-US', false, mu_candidates(), 'mu_translate');
	assert_same(array(
		'marketing' => array('m:Leads', 'm:Contacts'),
		'sales' => array('m:Contacts', 'm:Potentials'),
		'other' => array('m:Home', 'm:Gadgets'),
	), mu_menu_ids($menu));
	assert_same('Marketing (theme)', $menu['groups'][0]['label']);
	assert_same('megaphone', $menu['groups'][0]['icon']);
	assert_same('index.php?module=Contacts&view=List&app=SALES', $menu['groups'][1]['items'][0]['url'], 'URL of the group app');
	assert_same('Other modules (theme)', $menu['groups'][2]['label']);
});

test('menu: modules the user may not open never appear, whatever the configuration says', function () {
	$values = array_merge(ModernUI_Settings_Model::defaults(), array(
		'navigation.groups' => array(array('id' => 'mine', 'label' => array('en-US' => 'Mine'), 'icon' => 'star', 'collapsed' => false, 'items' => array(
			array('type' => 'module', 'module' => 'Leads', 'label' => null, 'icon' => null),
			array('type' => 'module', 'module' => 'Accounts', 'label' => null, 'icon' => null),
			array('type' => 'route', 'id' => 'calls', 'label' => array('en-US' => 'Calls'), 'icon' => 'phone',
				'route' => array('module' => 'Accounts', 'view' => 'List', 'params' => null)),
			array('type' => 'route', 'id' => 'workflows', 'label' => array('en-US' => 'Workflows'), 'icon' => null,
				'route' => array('module' => 'Leads', 'view' => 'List', 'params' => array('parent' => 'Settings'))),
		))),
		'navigation.favorites' => array('Accounts', 'Potentials'),
	));
	// The restricted user has no Accounts and no Leads.
	$menu = ModernUI_Menu_Model::assemble($values, 'en-US', false, mu_candidates(array('Contacts', 'Potentials', 'Home')), 'mu_translate');
	$ids = mu_menu_ids($menu);
	assert_true(!isset($ids['mine']), 'a group with only forbidden modules is not shown');
	foreach ($ids as $items) {
		assert_true(!in_array('m:Accounts', $items, true) && !in_array('m:Leads', $items, true), 'forbidden modules are absent');
	}
	assert_same(array('m:Potentials'), array_map(function ($item) {
		return $item['id'];
	}, $menu['favorites']), 'favorites are filtered by the permissions');

	// An administrator with Leads sees the route to Settings, a user with Leads does not.
	$admin = ModernUI_Menu_Model::assemble($values, 'en-US', true, mu_candidates(), 'mu_translate');
	$user = ModernUI_Menu_Model::assemble($values, 'en-US', false, mu_candidates(), 'mu_translate');
	assert_true(in_array('r:workflows', mu_menu_ids($admin)['mine'], true), 'route to Settings for an administrator');
	assert_true(!in_array('r:workflows', mu_menu_ids($user)['mine'], true), 'no route to Settings for a user');
});

test('menu: new modules appear in the group of their app or in "Other modules"; hidden modules stay out', function () {
	$values = array_merge(ModernUI_Settings_Model::defaults(), array(
		'navigation.groups' => array(
			array('id' => 'crm', 'source' => array('app' => 'SALES'), 'label' => array('ru-RU' => 'CRM'), 'icon' => null, 'collapsed' => false, 'items' => array(
				array('type' => 'module', 'module' => 'Potentials', 'label' => array('en-US' => 'Deals', 'de-DE' => 'Geschäfte'), 'icon' => 'handshake'),
				array('type' => 'module', 'module' => 'Removed', 'label' => null, 'icon' => null),
			)),
		),
		'navigation.hidden' => array('Leads'),
	));
	$menu = ModernUI_Menu_Model::assemble($values, 'de-DE', false, mu_candidates(), 'mu_translate');
	assert_same(array(
		'crm' => array('m:Potentials', 'm:Contacts'),
		'other' => array('m:Home', 'm:Gadgets'),
	), mu_menu_ids($menu), 'Contacts (SALES) joins the SALES group, the rest goes to "Other modules", Leads is hidden');
	assert_same('Sales (theme)', $menu['groups'][0]['label'], 'no de-DE/* label: the system label of the app');
	assert_same('Geschäfte', $menu['groups'][0]['items'][0]['label']);
	assert_same(array('kind' => 'lucide', 'name' => 'handshake'), $menu['groups'][0]['items'][0]['icon']);
	assert_same('Contacts (CRM)', $menu['groups'][0]['items'][1]['label'], 'module label of the CRM');
});

test('menu: labels follow locale → * → system → en-US → first (shared fixture)', function () {
	$fixture = json_decode(file_get_contents(MU_REPO . '/tests/fixtures/menu-labels.json'), true);
	foreach ($fixture['cases'] as $index => $case) {
		assert_same($case['expected'], ModernUI_Menu_Model::label($case['labels'], $case['locale'], $case['system']), "case {$index}");
	}
});

test('menu: icons of the schema equal the shared fixture', function () {
	$fixture = json_decode(file_get_contents(MU_REPO . '/tests/fixtures/menu-icons.json'), true);
	assert_same($fixture['icons'], ModernUI_Settings_Model::$menuIcons);
});

test('menu: compact and favorites switches, favorites off hides them', function () {
	$values = array_merge(ModernUI_Settings_Model::defaults(), array('navigation.favorites' => array('Leads'), 'navigation.compact' => true,
		'navigation.favoritesEnabled' => false));
	$menu = ModernUI_Menu_Model::assemble($values, 'en-US', false, mu_candidates(), 'mu_translate');
	assert_same(array(), $menu['favorites']);
	assert_same(false, $menu['favoritesEnabled']);
	assert_same(true, $menu['compact']);
});
