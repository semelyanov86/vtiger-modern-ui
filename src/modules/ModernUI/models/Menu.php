<?php
/*
 * The menu of the new interface for the current user (docs/settings.md §6.2) and the module catalog of the menu
 * editor.
 *
 * Candidates are the modules the user may open by the rules of Vtiger: the modules of the v7 app menu
 * (Settings_MenuEditor_Module_Model::getAllVisibleModules(): presence 0/2 and isAdminUser() || hasGlobalReadPermission()
 * || hasModulePermission()) and a few modules with a screen of their own outside the apps (dashboard, calendar,
 * documents, mail, reports, entity modules installed without an app), checked the same way. The configuration only
 * orders, groups, labels and hides candidates: a module the user cannot open never appears, whatever the settings
 * or an imported file say, and hiding a module changes nothing in the permissions (a direct URL still works).
 *
 * assemble() is pure (no CRM calls) so the rules are unit-tested; candidates() reads the CRM for the current user.
 */

require_once 'modules/ModernUI/models/Settings.php';
require_once 'modules/ModernUI/models/Locale.php';

class ModernUI_Menu_Model {

	/** System group for candidates without a group of their app; created at the end when needed. */
	const OTHER_GROUP = 'other';
	const URL_PATTERN = '/^index\.php\?[A-Za-z0-9_=&%.:-]{1,300}$/';

	/** Apps of the v7 menu (Vtiger_MenuStructure_Model::getAppMenuList()) with the default icon of their group. */
	public static $apps = array(
		'MARKETING' => 'megaphone',
		'SALES' => 'target',
		'INVENTORY' => 'package',
		'SUPPORT' => 'life-buoy',
		'PROJECT' => 'briefcase',
		'TOOLS' => 'wrench',
	);

	/** Apps that are not menu groups: the settings have the system section of the menu. */
	private static $ignoredApps = array('SETTINGS', 'ANALYTICS');

	/** Modules outside the apps with a screen of their own; first in "Other modules", in this order. */
	private static $extras = array('Home', 'Calendar', 'Documents', 'MailManager', 'Reports');

	/** Entity modules whose records live inside other screens (no list of their own in the menu). */
	private static $notNavigable = array('Emails', 'Events', 'ModComments', 'Webmails', 'Users', 'Dashboard', 'ModernUI');

	/** @var array|null candidates of the current request: {list: name => candidate, appOrder: app => names} */
	private static $cache = null;

	/**
	 * Candidate modules of the current user.
	 * @return array {list: name => {module, label, apps, icon, url, defaultHidden}, appOrder: app => [names]}
	 */
	public static function candidates() {
		if (self::$cache !== null) {
			return self::$cache;
		}
		$privileges = Users_Privileges_Model::getCurrentUserPrivilegesModel();
		$list = array();
		$appOrder = array();
		$byApp = Settings_MenuEditor_Module_Model::getAllVisibleModules();
		foreach ($byApp as $app => $models) {
			// Only the apps of the v7 menu (getAppMenuList()). Rows of other apps — SETTINGS, ANALYTICS, the empty app
			// some extension installers write — are not shown by the v7 menu: such modules are handled below like modules
			// outside the apps (hidden until the menu settings place them).
			if (!isset(self::$apps[$app]) || in_array($app, self::$ignoredApps, true)) {
				continue;
			}
			foreach ($models as $name => $model) {
				if (!isset($list[$name])) {
					$list[$name] = self::describe($model, $name, false);
				}
				$list[$name]['apps'][] = $app;
				$appOrder[$app][] = $name;
			}
		}

		// Modules outside the visible apps of the v7 menu. A module with app rows that are invisible or belong to an app the
		// v7 menu does not show (removed by the administrator in Settings → Menu Editor, or written so by an installer) is
		// not in the v7 menu: it stays available but hidden until the menu settings place it.
		$rows = ModernUI_Db_Model::rows('SELECT t.tabid, t.name, t.isentitytype,'
			. ' (SELECT COUNT(*) FROM vtiger_app2tab a WHERE a.tabid = t.tabid) AS app_rows'
			. ' FROM vtiger_tab t WHERE t.presence IN (0, 2) ORDER BY t.tabid');
		$dashboardId = null;
		foreach ($rows as $row) {
			if ($row['name'] === 'Dashboard') {
				$dashboardId = (int) $row['tabid'];
			}
		}
		$extras = array();
		foreach ($rows as $row) {
			$name = (string) $row['name'];
			if (isset($list[$name])) {
				continue;
			}
			$known = in_array($name, self::$extras, true);
			if (!$known && ((int) $row['isentitytype'] !== 1 || in_array($name, self::$notNavigable, true))) {
				continue;
			}
			// The dashboard is the module Home; v7 checks the permission of the module Dashboard for it (SidebarAppMenu.tpl).
			$tabId = $name === 'Home' && $dashboardId !== null ? $dashboardId : (int) $row['tabid'];
			if (!($privileges->isAdminUser() || $privileges->hasGlobalReadPermission() || $privileges->hasModulePermission($tabId))) {
				continue;
			}
			$model = Vtiger_Module_Model::getInstance($name);
			if (!$model) {
				continue;
			}
			$extras[$name] = self::describe($model, $name, (int) $row['app_rows'] > 0 && !$known);
		}
		// Known screens first in their order, then the others by label.
		$ordered = array();
		foreach (self::$extras as $name) {
			if (isset($extras[$name])) {
				$ordered[$name] = $extras[$name];
				unset($extras[$name]);
			}
		}
		uasort($extras, function ($a, $b) {
			return strcasecmp($a['label'], $b['label']);
		});
		self::$cache = array('list' => array_merge($list, $ordered, $extras), 'appOrder' => $appOrder);
		return self::$cache;
	}

	/**
	 * Forgets the candidates of this request (tests, CLI for several users).
	 */
	public static function reset() {
		self::$cache = null;
	}

	/**
	 * Sets the candidates of this request (tests of the models that read them).
	 * @param array $candidates {list, appOrder} as candidates()
	 */
	public static function prime(array $candidates) {
		self::$cache = $candidates;
	}

	/**
	 * A candidate from a module model: CRM label (language of the CRM user), icon like Vtiger_Module_Model::getModuleIcon()
	 * without HTML, default URL of the module.
	 * @param Vtiger_Module_Model $model
	 * @param string $name
	 * @param bool $defaultHidden
	 * @return array
	 */
	private static function describe($model, $name, $defaultHidden) {
		$label = $name === 'Home' ? vtranslate('LBL_DASHBOARD', 'Vtiger') : vtranslate($model->get('label'), $name);
		$label = html_entity_decode((string) $label, ENT_QUOTES, 'UTF-8');
		if ($label === '') {
			$label = $name;
		}
		$icon = array('kind' => 'vicon', 'name' => 'vicon-' . strtolower($name));
		$image = 'layouts/' . Vtiger_Viewer::getLayoutName() . '/modules/' . $name . '/' . $name . '.png';
		if (file_exists($image)) {
			$icon = array('kind' => 'image', 'src' => $image);
		} elseif (isset($model->source) && $model->source === 'custom') {
			$icon = array('kind' => 'letters', 'text' => mb_substr(trim($label), 0, 2, 'UTF-8'));
		}
		$url = $name === 'Home' ? 'index.php?module=Home&view=DashBoard' : (string) $model->getDefaultUrl();
		if (!preg_match(self::URL_PATTERN, $url)) {
			$url = 'index.php?module=' . $name . '&view=List';
		}
		return array('module' => $name, 'label' => $label, 'apps' => array(), 'icon' => $icon, 'url' => $url, 'defaultHidden' => $defaultHidden);
	}

	/**
	 * Configuration of the v7 menu: a group per app in the order of the v7 menu with the modules in the order of
	 * vtiger_app2tab, then "Other modules" (docs/settings.md §6.2, "groups = null").
	 * @param array $candidates candidates()
	 * @return array navigation.groups
	 */
	public static function defaultGroups(array $candidates) {
		$groups = array();
		foreach (array_keys(self::$apps) as $app) {
			$items = array();
			$names = isset($candidates['appOrder'][$app]) ? $candidates['appOrder'][$app] : array();
			foreach ($names as $name) {
				$items[] = array('type' => 'module', 'module' => $name, 'label' => null, 'icon' => null);
			}
			if ($items) {
				$groups[] = array('id' => strtolower($app), 'source' => array('app' => $app), 'label' => null, 'icon' => null,
					'collapsed' => false, 'items' => $items);
			}
		}
		$other = array();
		foreach ($candidates['list'] as $name => $candidate) {
			if (!$candidate['apps'] && !$candidate['defaultHidden']) {
				$other[] = array('type' => 'module', 'module' => $name, 'label' => null, 'icon' => null);
			}
		}
		if ($other) {
			$groups[] = array('id' => self::OTHER_GROUP, 'label' => null, 'icon' => null, 'collapsed' => false, 'items' => $other);
		}
		return $groups;
	}

	/**
	 * Label of a custom label map in a theme locale (docs/settings.md §6.2 item 8): the locale → "*" → the system label
	 * → en-US → the first variant. Never empty when anything is set.
	 * @param array|null $labels
	 * @param string $locale
	 * @param string|null $system
	 * @return string|null
	 */
	public static function label($labels, $locale, $system) {
		$labels = is_array($labels) ? $labels : array();
		foreach (array($locale, '*') as $key) {
			if (isset($labels[$key]) && $labels[$key] !== '') {
				return $labels[$key];
			}
		}
		if ($system !== null && $system !== '') {
			return $system;
		}
		if (isset($labels['en-US']) && $labels['en-US'] !== '') {
			return $labels['en-US'];
		}
		foreach ($labels as $text) {
			if (is_string($text) && $text !== '') {
				return $text;
			}
		}
		return null;
	}

	/**
	 * System label of a group: the app in the theme dictionaries, "Other modules", or the CRM label of an unknown app.
	 * @param array $group
	 * @param string $locale
	 * @param callable $translate key → text of the theme dictionary
	 * @param callable|null $crmApp app → CRM label
	 * @return string|null
	 */
	private static function groupSystemLabel(array $group, $locale, $translate, $crmApp) {
		$app = isset($group['source']['app']) ? $group['source']['app'] : null;
		if ($app !== null && isset(self::$apps[$app])) {
			return $translate('LBL_MENU_APP_' . $app);
		}
		if ($app !== null) {
			return $crmApp !== null ? $crmApp($app) : $app;
		}
		return $group['id'] === self::OTHER_GROUP ? $translate('LBL_MENU_GROUP_OTHER') : null;
	}

	/**
	 * The menu of a user from effective settings and candidates (pure).
	 * @param array $values effective settings (navigation.*)
	 * @param string $locale theme locale
	 * @param bool $isAdmin routes to Settings only for administrators
	 * @param array $candidates candidates()
	 * @param callable $translate key → text of the theme dictionary in $locale
	 * @param callable|null $crmApp app → CRM label of an unknown app
	 * @return array {groups: [{id, label, icon, app, items}], favorites: [item], favoritesEnabled, compact}
	 */
	public static function assemble(array $values, $locale, $isAdmin, array $candidates, $translate, $crmApp = null) {
		$list = $candidates['list'];
		$config = isset($values['navigation.groups']) && is_array($values['navigation.groups'])
			? $values['navigation.groups'] : self::defaultGroups($candidates);
		$hidden = array();
		foreach (isset($values['navigation.hidden']) ? $values['navigation.hidden'] : array() as $name) {
			$hidden[$name] = true;
		}
		$mentioned = array();
		foreach ($config as $group) {
			foreach ($group['items'] as $item) {
				if ($item['type'] === 'module') {
					$mentioned[$item['module']] = true;
				}
			}
		}
		foreach ($list as $name => $candidate) {
			if ($candidate['defaultHidden'] && !isset($mentioned[$name])) {
				$hidden[$name] = true;
			}
		}

		$groups = array();
		foreach ($config as $group) {
			$app = isset($group['source']['app']) ? $group['source']['app'] : null;
			$out = array(
				'id' => $group['id'],
				'label' => self::label($group['label'], $locale, self::groupSystemLabel($group, $locale, $translate, $crmApp)),
				'icon' => $group['icon'] !== null ? $group['icon'] : ($app !== null && isset(self::$apps[$app]) ? self::$apps[$app] : 'layout-grid'),
				'app' => $app,
				'items' => array(),
			);
			if ($out['label'] === null) {
				$out['label'] = $group['id'];
			}
			foreach ($group['items'] as $item) {
				if ($item['type'] === 'module') {
					if (isset($list[$item['module']]) && !isset($hidden[$item['module']])) {
						$out['items'][] = self::moduleItem($list[$item['module']], $item, $app, $locale);
					}
					continue;
				}
				$route = $item['route'];
				$params = is_array($route['params']) ? $route['params'] : array();
				if (!isset($list[$route['module']]) || (isset($params['parent']) && $params['parent'] === 'Settings' && !$isAdmin)) {
					continue;
				}
				$url = 'index.php?module=' . $route['module'] . '&view=' . $route['view'];
				foreach ($params as $key => $value) {
					$url .= '&' . $key . '=' . rawurlencode($value);
				}
				if (!preg_match(self::URL_PATTERN, $url)) {
					continue;
				}
				$out['items'][] = array('id' => 'r:' . $item['id'], 'module' => $route['module'],
					'label' => self::label($item['label'], $locale, null), 'url' => $url,
					'icon' => array('kind' => 'lucide', 'name' => $item['icon'] !== null ? $item['icon'] : 'link'));
			}
			$groups[] = $out;
		}

		// New modules appear by themselves: in the groups of their apps, otherwise in "Other modules".
		foreach ($list as $name => $candidate) {
			if (isset($mentioned[$name]) || isset($hidden[$name])) {
				continue;
			}
			$placed = false;
			foreach ($groups as $index => $group) {
				if ($group['app'] !== null && in_array($group['app'], $candidate['apps'], true)) {
					$groups[$index]['items'][] = self::moduleItem($candidate, null, $group['app'], $locale);
					$placed = true;
				}
			}
			if (!$placed) {
				$other = null;
				foreach ($groups as $index => $group) {
					if ($group['id'] === self::OTHER_GROUP) {
						$other = $index;
					}
				}
				if ($other === null) {
					$groups[] = array('id' => self::OTHER_GROUP, 'label' => $translate('LBL_MENU_GROUP_OTHER'), 'icon' => 'layout-grid',
						'app' => null, 'items' => array());
					$other = count($groups) - 1;
				}
				$groups[$other]['items'][] = self::moduleItem($candidate, null, null, $locale);
			}
		}

		// Empty groups are not shown. The app of the v7 menu stays with the group: the shell uses it to find the section
		// of the current page (the app=… of the v7 URLs) for the module rail and the open group of the mega menu.
		$result = array();
		foreach ($groups as $group) {
			if ($group['items']) {
				$result[] = $group;
			}
		}

		$favoritesEnabled = !isset($values['navigation.favoritesEnabled']) || $values['navigation.favoritesEnabled'];
		$favorites = array();
		if ($favoritesEnabled) {
			foreach (isset($values['navigation.favorites']) ? $values['navigation.favorites'] : array() as $name) {
				if (isset($list[$name])) {
					$favorites[] = self::moduleItem($list[$name], null, null, $locale);
				}
			}
		}
		return array(
			'groups' => $result,
			'favorites' => $favorites,
			'favoritesEnabled' => (bool) $favoritesEnabled,
			'compact' => !empty($values['navigation.compact']),
		);
	}

	/**
	 * @param array $candidate
	 * @param array|null $item configured item (label, icon) or null
	 * @param string|null $app app of the group (added to the URL like the v7 menu does)
	 * @param string $locale
	 * @return array
	 */
	private static function moduleItem(array $candidate, $item, $app, $locale) {
		if ($app === null && $candidate['apps']) {
			$app = $candidate['apps'][0];
		}
		$url = $candidate['url'];
		if ($app !== null && in_array($app, $candidate['apps'], true)) {
			$url .= '&app=' . $app;
		}
		$icon = $candidate['icon'];
		if ($item !== null && $item['icon'] !== null) {
			$icon = array('kind' => 'lucide', 'name' => $item['icon']);
		}
		return array(
			'id' => 'm:' . $candidate['module'],
			'module' => $candidate['module'],
			'label' => self::label($item !== null ? $item['label'] : null, $locale, $candidate['label']),
			'url' => $url,
			'icon' => $icon,
		);
	}

	/**
	 * The menu of the current user.
	 * @param array $values effective settings
	 * @param string $locale theme locale
	 * @param bool $isAdmin
	 * @return array assemble()
	 */
	public static function build(array $values, $locale, $isAdmin) {
		return self::assemble($values, $locale, $isAdmin, self::candidates(), function ($key) use ($locale) {
			return ModernUI_Locale_Model::translate($key, 'ModernUI', $locale);
		}, function ($app) {
			return html_entity_decode((string) vtranslate('LBL_' . $app), ENT_QUOTES, 'UTF-8');
		});
	}

	/**
	 * Names of every module the current user may open by the rules of Vtiger (the candidates, hidden ones included).
	 * The shell compares the links of the v7 app menu with them: a link to one of these modules is already covered by
	 * the menu of the theme (or hidden on purpose), any other link was added by an extension and is kept.
	 * @return array
	 */
	public static function modules() {
		$candidates = self::candidates();
		return array_keys($candidates['list']);
	}

	/**
	 * Default URLs (Vtiger_Module_Model::getDefaultUrl()) of every module the user may open, hidden ones included: the
	 * shell compares the entries of the v7 menus with them, so a module whose default view is not a list is recognised
	 * as covered by the theme menu (docs/architecture.md §7.1).
	 * @return array
	 */
	public static function entries() {
		$candidates = self::candidates();
		$urls = array();
		foreach ($candidates['list'] as $candidate) {
			$urls[] = $candidate['url'];
		}
		return array_values(array_unique($urls));
	}

	/**
	 * Module catalog of the menu editor: the candidates of the current administrator (every active module with a
	 * screen), with apps and the default configuration.
	 * @return array {modules: [{module, label, apps, icon, defaultHidden}], defaultGroups}
	 */
	public static function catalog() {
		$candidates = self::candidates();
		$modules = array();
		foreach ($candidates['list'] as $candidate) {
			$modules[] = array(
				'module' => $candidate['module'],
				'label' => $candidate['label'],
				'apps' => $candidate['apps'],
				'icon' => $candidate['icon'],
				'defaultHidden' => $candidate['defaultHidden'],
			);
		}
		return array('modules' => $modules, 'defaultGroups' => self::defaultGroups($candidates));
	}
}
