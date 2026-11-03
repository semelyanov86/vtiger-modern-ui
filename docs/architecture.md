# Архитектура ModernUI

Этап 01, 2026-11-01. Документ проверен по официальному тегу Vtiger `8.4.0`
(`0bb3774e7df04c40bc2cc81b1f910a6b1ae77be2`) и по коду dev-стенда (Vtiger 8.4.0 с доработками
сторонней сборки). Номера строк ниже — по тегу `8.4.0`. Связанные документы: `settings.md`
(настройки и меню), `design.md`, `dependencies.md`, `compatibility.md`, `environments.md`,
`verification.md` (матрица приёмки), контракты `COMMON.md`, `DEVELOPMENT.md`, `I18N.md`.

## 1. Решения кратко

| № | Решение | Основание |
|---|---|---|
| A1 | Пакет — vtlib-модуль типа `extension` с именем `ModernUI`, без entity-таблиц, без поля `<parent>` (не появляется в меню приложений) | `PackageImport::import_Module()` (стр. 473–529): `type=extension` → `isentitytype=false` |
| A2 | Два слоя оформления: **skin** — чистый CSS поверх неизменённой DOM v7, подключается в `<head>` через `HEADERCSS`; **shell** — Vue-острова в собственных контейнерах, подключаются классическим загрузчиком через `HEADERSCRIPT` | v7 перезагружает страницу при каждом переходе по меню: CSS только из JS давал бы мигание старого вида на каждой странице (§5.1) |
| A3 | Обе глобальные ссылки регистрируются с `tabid = 0` и обработчиком ссылки `ModernUI_LinkHandler_Model::filter`; обработчик решает per-user и per-screen, подключать ли тему, и добавляет к URL идентификатор сборки | `Vtiger_Link::getAllByType()` вызывает `handler_class::handler()` до вывода ссылки (стр. 229–241); фильтр по разрешённым `tabid` для не-админов не зависит от устаревших файлов привилегий (§3.3) |
| A4 | Ссылки создаются и удаляются кодом lifecycle (`vtlib_handler`), а не секцией `<customlinks>` manifest | В 8.4.0 `import_CustomLinks()` передаёт `handler_*` с числовыми ключами, а `Vtiger_Link::addLink()` читает `path/class/method` — обработчик теряется (стр. 853–873 и `Link.php` 118–123) |
| A5 | Загрузчик — маленький ES5-скрипт `loader.js` (без сборки), он читает `dist/manifest.json` и вставляет `<script type="module">` | `Vtiger_JsScript_Model::DEFAULT_TYPE = 'text/javascript'`, у ссылки нет поля `type`; прототип проверен (§5.3) |
| A6 | Vue монтируется только в контейнеры `[data-mu-root]`, созданные ModernUI; v7-DOM не пересоздаётся. Шапка v7 (`nav.app-fixed-navbar`, `#navbar`) **остаётся** и переоформляется CSS — кнопки расширений в ней сохраняются на своих местах | `COMMON.md`, реестр расширений (`compatibility.md`) |
| A7 | Собственные страницы (настройки администратора, личные предпочтения) — обычные vtlib-view со своими Smarty-шаблонами; их Vue-приложения подключаются из PHP по manifest и работают при выключенной теме | Включать тему администратор должен на странице, которая не зависит от включённой темы |
| A8 | Настройки — собственные таблицы `vtiger_modernui_*`, версия схемы и идемпотентные миграции внутри пакета, выполняются lifecycle; при несовпадении версии схемы тема автоматически не подключается | `PackageUpdate::update_Module()`: файлы распаковываются до `module.preupdate`, версия в `vtiger_tab` меняется только перед `module.postupdate` (стр. 136–181) |
| A9 | Безопасный режим: `index.php?…&modernui=off` (на сессию) и личный «Стандартный вид»; обработчик ссылки перестаёт выводить ресурсы темы — восстановление не зависит от JS | §11 |
| A10 | Клиент API — `fetch` с явным `__vtrftk` и `X-Requested-With`; серверные действия — стандартные контроллеры Vtiger с `validateWriteAccess()` | `csrf-magic.js` патчит только `XMLHttpRequest` и `jQuery.ajax`, не `fetch` (§3.9) |

## 2. Что такое модуль

- `vtiger_tab`: `name=ModernUI`, `isentitytype=0`, `customized=1`, `presence` 0/1 — штатное
  включение/выключение менеджером модулей. Entity-таблиц, блоков, полей, фильтров, связей,
  webservice-операций нет.
- Права профилей: `Vtiger_Profile::initForModule()` добавляет `vtiger_profile2tab` с `permissions=0`
  для всех профилей. ModernUI **не** использует `isPermitted('ModernUI', …)`: файлы привилегий
  пользователей не пересоздаются при установке extension-модуля, и проверка по ним дала бы ложный
  отказ ограниченным пользователям (§3.3).
- Собственные таблицы — только настройки темы (`settings.md`): ни записей CRM, ни копий прав.
- Пункт «Настройки → Прочие настройки → ModernUI» (`vtiger_settings_field`) создаёт
  `vtlib_addSettingsLink()` (`include/utils/VtlibUtils.php:955`), удаляет lifecycle при uninstall.

## 3. Точки расширения Vtiger 8.4.0 и фактический порядок вызовов

### 3.1. Глобальные CSS и JS

Цепочка для обычной страницы (`Vtiger_Index_View` и потомки: List, Detail, Edit, Settings):

1. `Vtiger_WebUI::process()` (`includes/main/WebUI.php:94`) → `checkPermission()` →
   `triggerPreProcess()` (только не-AJAX) → `process()` → `triggerPostProcess()`.
2. `Vtiger_View_Controller::preProcess()` (`includes/runtime/Controller.php:268`) присваивает
   `SCRIPTS = getHeaderScripts()` и `STYLES = getHeaderCss()`.
3. `getHeaderScripts()` по иерархии (каждый уровень вызывает `parent::` и сливает):
   - `Vtiger_View_Controller::getHeaderScripts()` (стр. 325): язык валидатора;
   - `Vtiger_Header_View::getHeaderScripts()` (`modules/Vtiger/views/Header.php:163`): дописывает
     все `HEADERSCRIPT` из `Vtiger_Link_Model::getAllByType(IGNORE_MODULE, ['HEADERSCRIPT'])`,
     пропуская ссылки, для которых `file_exists()` части URL до `?` ложно;
   - `Vtiger_Basic_View::getHeaderScripts()` (`Basic.php:120`): `array_merge(свои, родительские)` —
     ядро v7 (Header.js, Edit.js, List.js…) **перед** HEADERSCRIPT;
   - `Vtiger_Index_View` и конкретные view добавляют `Vtiger.js`, `<Module>.js`, `Detail.js`… **после**.
4. `getHeaderCss()`: `Vtiger_Header_View::getHeaderCss()` (стр. 188) — тема пользователя, затем все
   `HEADERCSS` (та же проверка `file_exists`); `Vtiger_Footer_View` добавляет timepicker/lazyYT.
5. Вывод: `Header.tpl` — `<link>` ядра, тема v7 (`V7_THEME_PATH`), затем `STYLES` (HEADERCSS) —
   в разметке внутри `<head>`, после стилей ядра. Фактически (этап 02, тег 8.4.0 и dev-стенд) перед темой v7
   `Header.tpl` выводит `<input type="hidden" id="inventoryModules">`: парсер HTML закрывает `<head>` на нём,
   и тема v7 вместе со всеми HEADERCSS оказывается в начале `<body>` — до любого содержимого страницы,
   поэтому стили по-прежнему блокируют отрисовку контента (замер мигания — Q8, этап 04); `Footer.tpl` → `JSResources.tpl` — библиотеки (jQuery,
   Bootstrap, Select2, `helper.js`, `application.js`, `Vtiger.js`…), затем `SCRIPTS` как
   `<script type="{getType()}" src="{vresource_url(src)}">` — **в конце `<body>`**.
6. `vresource_url()` (`includes/runtime/Viewer.php:255`) дописывает `?v=<версия Vtiger>` к любому
   относительному URL, даже если в нём уже есть `?`. URL ссылок ModernUI поэтому заканчиваются
   служебным параметром `&z=` — хвост `?v=8.4.0` становится его значением.
7. `application.js` (стр. 535) регистрирует `jQuery(function(){ … window.app.controller(); })` раньше
   HEADERSCRIPT. Обработчик готовности, зарегистрированный загрузчиком, выполняется **после**
   `controller.registerEvents()`.

Следствия: HEADERCSS блокирует отрисовку и потому подходит для слоя skin без мигания;
HEADERSCRIPT исполняется после jQuery/Bootstrap/`app`, но до контроллера страницы; тип тега всегда
`text/javascript` (`Vtiger_JsScript_Model::getType()`, `JsScript.php`; `getInstanceFromLinkObject()`
копирует свойства `Vtiger_Link`, поля `type` там нет).

Где HEADERSCRIPT **нет**: страница входа (`Users_Login_View` не наследует `Vtiger_Header_View`),
ответы AJAX (`preProcess` не вызывается), печатные формы и выгрузки. Где **есть**: все
полноэкранные view на базе `Vtiger_Basic_View`, включая Настройки, и полноэкранный Popup.

### 3.2. Обработчик ссылки

`Vtiger_Link::getAllByType()` (`vtlib/Vtiger/Link.php:180`) для каждой строки: если `handler_path`
непуст и `isFileAccessible()` — `checkFileAccessForInclusion()`, `require_once`, затем
`call_user_func([handler_class, handler], new Vtiger_LinkData($link, $current_user))`; ложный
результат — ссылка пропускается. `Vtiger_LinkData` даёт `getLink()` (тот же объект),
`getUser()`, `getModule()`, `getInputParameter()` (по умолчанию `$_REQUEST`).
`Vtiger_Link_Model::getAllByType()` кэширует результат в `Vtiger_Cache` — это кэш в памяти одного
запроса (`includes/runtime/cache/Connector.php`), то есть решение обработчика не утекает к другим
пользователям.

`ModernUI_LinkHandler_Model::filter(Vtiger_LinkData $data)` (`modules/ModernUI/models/LinkHandler.php`):

1. всё тело — в `try { … } catch (\Throwable $e) { return false; }`: исключение в обработчике
   иначе сломало бы каждую страницу CRM;
2. результат кэшируется в статическом поле на время запроса;
3. `false`, если: модуль не активен (`vtlib_isModuleActive`), версия Vtiger не `8.4.*`, версия схемы
   настроек в БД не равна версии кода, тема выключена глобально или для пользователя/роли (пилот),
   пользователь выбрал «Стандартный вид», в сессии включён безопасный режим (`modernui=off`),
   экран исключён (по `module`/`view`/`parent` запроса), нет файла сборки;
4. иначе дописывает к `linkurl` идентификатор сборки `?b=<build>&z=` (skin — путь к файлу с
   хэшем из manifest) и возвращает `true`.

Ограничения: обработчик выполняется на каждой полной странице — только чтение уже загруженных
моделей и одного `SELECT` настроек (кэш на запрос), без записи в БД; запись в сессию — только флаг
безопасного режима. Изменение `linkurl` в обработчике опирается на передачу объекта по ссылке в
8.4.0; если бы ядро стало передавать копию, зарегистрированный URL указывает на несуществующий
файл — тема просто не подключится (безопасный отказ), что проверяется тестом этапа 02.

### 3.3. Права

| Что | Где | Поведение 8.4.0 | Решение ModernUI |
|---|---|---|---|
| Глобальные ссылки | `Link.php:190–201` | для не-админа без глобального просмотра: `tabid IN (getPermittedModuleIdList() ∪ {0})`; у админа фильтра нет | `tabid=0`, решает обработчик (§3.2) |
| Разрешённые модули | `include/utils/UserInfoUtil.php:2165` | `$profileTabsPermission` из `user_privileges_<id>.php`; новые extension-модули туда не попадают до пересоздания файлов (оно есть в `vtlib_toggleModuleAccess`, но не при импорте) | не использовать `isPermitted('ModernUI', …)` |
| View модуля | `Vtiger_Index_View::requiresPermission()` | требует `DetailView` на модуль запроса | свои view переопределяют `requiresPermission()` и проверяют вход + активность модуля |
| Действия | `Vtiger_Action_Controller::validateRequest()` → `validateReadAccess()` (Referer), для записи `validateWriteAccess()` (POST + CSRF) | — | все изменяющие действия: POST + `validateWriteAccess()` |
| Настройки | `Settings_Vtiger_Index_View::checkPermission()` | только `isAdminUser()` | административные view/actions наследуют `Settings_Vtiger_Index_View` / `Settings_Vtiger_Basic_Action` |
| Меню | `Settings_MenuEditor_Module_Model::getAllVisibleModules()` | `isAdminUser() || hasGlobalReadPermission() || hasModulePermission(tabid)` и `presence IN (0,2)` | источник модулей меню (`settings.md` §6) |
| Пользователь | `Users_Record_Model::getCurrentUserModel()` | из сессии | личные настройки адресуются только так, id от клиента игнорируется |

Генерального контроля «модуль активен» в `WebUI::process()` 8.4.0 нет — каждый контроллер ModernUI
проверяет `vtlib_isModuleActive('ModernUI')` сам.

### 3.4. Жизненный цикл vtlib

| Событие | Кто вызывает и когда | Что делает ModernUI в `ModernUI::vtlib_handler()` |
|---|---|---|
| `module.postinstall` | `PackageImport::import_Module()` стр. 525 — после записи `vtiger_tab`, профилей, `<tables>`, `<customlinks>` | миграции схемы до текущей версии; настройки по умолчанию (тема **выключена**); ссылки HEADERCSS/HEADERSCRIPT; пункт настроек |
| `module.enabled` | `vtlib_toggleModuleAccess()` (`VtlibUtils.php:147`) после `UPDATE presence=0`, затем пересоздаются tabdata и привилегии | синхронизировать ссылки (идемпотентно) |
| `module.disabled` | то же, `presence=1` | удалить свои ссылки; настройки и таблицы не трогать |
| `module.preupdate` | `PackageUpdate::update_Module()` стр. 160 — **после** распаковки новых файлов, до миграций manifest и смены версии | ничего не менять; записать в журнал модуля начало обновления |
| `module.postupdate` | стр. 181 — после `__updateVersion()` | миграции схемы; пересинхронизация ссылок и пункта настроек; сохранить настройки |
| `module.preuninstall` | `ModuleBasic::__delete()` стр. 228 — до удаления `vtiger_tab`; затем ядро удаляет профили, **ссылки с tabid модуля**, меню | удалить свои ссылки `tabid=0`, пункт настроек, по политике — таблицы (`settings.md` §9) |

Порядок проверки сценария: install → enable → disable → enable → update → uninstall → reinstall
(`verification.md`). Окно «новый код + старая схема» между распаковкой и `postupdate` закрывается
проверкой версии схемы в обработчике ссылки и в каждом действии: при несовпадении тема не
подключается, действия настроек отвечают кодом `MU_SCHEMA_OUTDATED`, страница настроек предлагает
повторить миграции (`Settings_ModernUI_Recovery_Action`).

Удаление: в менеджере модулей 8.4.0 кнопки удаления нет (только Marketplace для своих расширений).
Штатные пути — `Vtiger_Module::delete()` из консоли vtlib и кнопка «Удалить ModernUI» на странице настроек
модуля (тот же `delete()`, с предложением экспорта, этап 10). Консоль архива релиза 8.4.0 не подключает
`vendor/autoload.php` и молча завершается с кодом 0 («Class "Monolog\Logger" not found»), аргумент — через `=`
(проверено на чистом стенде, этап 03); рабочая команда без правки файлов:
`php -d auto_prepend_file=vendor/autoload.php vtlib/tools/console.php --remove=ModernUI`.
Файлы модуля ядро не удаляет: они остаются без ссылок и не влияют на CRM, но пока есть `modules/ModernUI`,
менеджер модулей предлагает для ZIP только «Обновить», а обновление незарегистрированного модуля падает —
перед повторной установкой каталоги модуля удаляются (`task clean:uninstall`; описание — `release.md`).

Версия Vtiger не проверяется импортом (`vtiger_max_version` только пишется в `vtiger_tab_info`).
Поэтому `postinstall` на версии не `8.4.*` регистрирует модуль, но оставляет тему выключенной без
ссылок, а страница настроек сообщает о неподдерживаемой версии.

### 3.5. Менеджер модулей, manifest и пути распаковки

Импорт из интерфейса: `Settings_ModuleManager_ModuleImport_View::importUserModuleStep2()` (загрузка,
`getModuleNameFromZip()`), затем `Settings_ModuleManager_Basic_Action::importUserModuleStep3()` →
`Vtiger_Package::import()`, или `updateUserModuleStep3()` → `Vtiger_Package::update()` для
существующего модуля. `checkZip()` (стр. 181) требует `manifest.xml`, `type=extension` и
`dependencies/vtiger_version >= 6.0.0rc`. Регулярное выражение `/manifest.xml/` срабатывает на любом
пути, содержащем `manifest?xml`, — в пакете не должно быть других таких имён (манифест Vite —
`manifest.json`).

`initImport()` (стр. 318) и `initUpdate()` распаковывают только пути из списка `include` и
переименовывают каталоги по **первому** совпавшему префиксу (`Vtiger_Unzip::unzipAllEx()`):

| В ZIP | В CRM | Использует ModernUI |
|---|---|---|
| `manifest.xml` | не распаковывается | да |
| `modules/ModernUI/…` | `modules/ModernUI/…` | да |
| `settings/actions/…`, `settings/views/…`, `settings/models/…` | `modules/Settings/ModernUI/{actions,views,models}/…` | да |
| `settings/connectors`, `settings/libraries` | `modules/Settings/ModernUI/…` | нет |
| `settings/handlers` | при import да, при **update нет** (нет в `include` `initUpdate`) | не использовать |
| `settings/<другое>/…`, `settings/<файл>` | `modules/Settings/<другое>` — **вне** каталога модуля | запрещено |
| `layouts/…` | как есть | `layouts/v7/modules/ModernUI/…`, `layouts/v7/modules/Settings/ModernUI/…` |
| `languages/…` | как есть | `languages/{en_us,ru_ru,de_de}/ModernUI.php`, `…/Settings/ModernUI.php` |
| `templates/…`, `settings/templates/…`, `images/…` | `layouts/vlayout/…` (устаревший layout) | нет |
| `cron/…` | `cron/modules/ModernUI/…` | нет |

Обновление перезаписывает файлы и ничего не удаляет: устаревшие файлы прошлых версий остаются.
Код не должен зависеть от отсутствия файлов; сборка frontend использует имена с хэшем.

`manifest.xml` (шаблон в `packaging/`, версия подставляется при сборке):

```xml
<?xml version="1.0"?>
<module>
	<name>ModernUI</name>
	<label>ModernUI</label>
	<parent></parent>
	<type>extension</type>
	<version>X.Y.Z</version>
	<dependencies>
		<vtiger_version>8.4.0</vtiger_version>
		<vtiger_max_version>8.4.*</vtiger_max_version>
	</dependencies>
	<license><inline><![CDATA[…]]></inline></license>
</module>
```

Без `<tables>`, `<customlinks>`, `<crons>`, `<events>`: таблицы создают миграции модуля, ссылки — lifecycle.

### 3.6. Страница настроек

- Пункт: `vtlib_addSettingsLink('ModernUI', 'index.php?module=ModernUI&parent=Settings&view=Index',
  'LBL_OTHER_SETTINGS')` — функция сама проверяет дубликат по `name`, при отсутствии блока создаёт
  `LBL_OTHER_SETTINGS`. Имя пункта — название продукта, а не ключ перевода: боковое меню настроек
  переводит подписи модулем **текущей** страницы (`vtranslate($MENU, $QUALIFIED_MODULE)`), на чужих
  страницах ключ `LBL_*` показался бы как есть (проверено на этапе 02).
- Маршрут: `module=ModernUI&parent=Settings&view=Index` → `Settings_ModernUI_Index_View`
  (`modules/Settings/ModernUI/views/Index.php`), шаблоны — `layouts/v7/modules/Settings/ModernUI/`
  (`Vtiger_Viewer::getTemplatePath()`, стр. 153: поиск `modules/Settings/ModernUI/<tpl>`, затем
  `ModernUI`, затем `Settings/Vtiger`).
- Активный пункт левого меню настроек находит `Settings_Vtiger_Module_Model::getActiveBlockName()`
  по `linkto LIKE '%ModernUI%'` и `parent=Settings`.
- Не-администраторам меню настроек недоступно (`getSettingsMenuListForNonAdmin()` зашит в ядре).
  Личные предпочтения — отдельная страница `index.php?module=ModernUI&view=Preferences`, вход в неё —
  из навигации темы и из пункта, который загрузчик добавляет в меню пользователя v7 (§7.1), если
  администратор разрешил пользователям самостоятельно включать тему.

### 3.7. Языки

- `Vtiger_Language_Handler::getModuleStringsFromFile()` (`includes/runtime/LanguageHandler.php:128`):
  `languages/<lang>/<Module>.php`, затем переопределения `languages/custom/<lang>/<Module>.php`
  (штатная возможность ядра — администратор может поправить текст без правки пакета).
- `getTranslatedString()`: язык пользователя → `$default_language` из `config.inc.php` → ключ.
  Английского fallback в ядре нет — PHP-код ModernUI сам вызывает
  `getLanguageTranslatedString($lang, $key, 'ModernUI')` по цепочке «язык темы → en_us».
- Тег 8.4.0 содержит только `languages/en_us`. Импорт создаст `languages/ru_ru/` и `languages/de_de/`
  с файлами ModernUI; список языков CRM берётся из `vtiger_language`, поэтому это не добавляет языков
  интерфейса ядра. Тексты темы на RU/DE работают и без языковых пакетов ядра (`I18N.md`).

### 3.8. Меню v7

- Глобальное меню приложений — `partials/SidebarAppMenu.tpl` (`#app-menu`, открывается
  `#appnavigator`): `Settings_MenuEditor_Module_Model::getAllVisibleModules()` по приложениям
  `Vtiger_MenuStructure_Model::getAppMenuList()` (MARKETING, SALES, INVENTORY, SUPPORT, PROJECT,
  TOOLS; ANALYTICS пропускается), ссылки `getDefaultUrl()&app=<APP>`, значки `getModuleIcon()`
  (`vicon-*`).
- Модули текущего приложения — `partials/Menubar.tpl` (`#modules-menu`).
- Порядок и состав приложений хранит `vtiger_app2tab` (редактор меню ядра). ModernUI его не меняет:
  собственное меню — это представление поверх тех же разрешённых модулей (`settings.md` §6).

### 3.9. AJAX, PJAX, события, CSRF

- `app.request.get/post` (`layouts/v7/resources/application.js:60–135`) — `jQuery.ajax`;
  `app.request.pjax` — `jQuery.pjax` в `#pjaxContainer` или указанный контейнер (используют список
  отчётов, редактор полей, зависимости списков и др.). Части страницы заменяются без перезагрузки,
  HEADERSCRIPT повторно не выполняется.
- `app.event` — шина на `jQuery({})` (`trigger/on/one/off`); каталог событий ядра — `compatibility.md`.
- `app.controller()` создаётся один раз на странице; модальные окна — Bootstrap 3 (`.myModal`,
  bootbox). Ядро переопределяет `jQuery.fn.modal.Constructor.prototype.enforceFocus` (стр. 544):
  фокус, ушедший из открытой модалки, возвращается в неё (проверено: перехватывает фокус у оверлеев
  всех четырёх кандидатов-библиотек). Vue-оверлеи, открытые из модалки, телепортируются внутрь её
  `.modal-content`; если это невозможно — адаптер на время открытия снимает обработчик `focusin`
  модалки и восстанавливает его при закрытии.
- `JSON.parse('')` в v7 возвращает `null` (переопределение в `application.js:576`).
- CSRF: `csrf-magic` подключается на каждом запросе, кроме входа (`WebUI.php:99`); в полную
  страницу вставляются `csrfMagicToken`/`csrfMagicName` и `csrf-magic.js`, который оборачивает
  `XMLHttpRequest` и `jQuery.ajax`. `fetch` не оборачивается — клиент ModernUI передаёт
  `__vtrftk` явно. Для AJAX (`X-Requested-With` или `X-PJAX`) переписывание ответа выключено
  (`config.security.php`). `Vtiger_Request::validateReferer()` отвергает чужой `Referer`.
- Frame-breaker csrf-magic перенаправляет страницу в iframe наверх — iframe как способ интеграции
  исключён и технически.

### 3.10. Отличия изменённых сборок 8.4 (dev-стенд)

На dev-стенде (сборка на основе SalesPlatform и собственные правки) отличаются в том числе:
`Header.php` (пропускает HEADERSCRIPT/HEADERCSS отключённых модулей — `isLinkOfInactiveModule`),
`vtlib/Vtiger/Link.php` (`ORDER BY sequence`), `PackageImport::import_CustomLinks()` (исправлены
ключи обработчика), `WebUI.php` (проверка `site_URL` по настройке), `JSResources.tpl` (локаль
Select2 для `ru_ru`). ModernUI не опирается ни на одно из этих отличий: обработчик сам проверяет
активность модуля, порядок ссылок не важен, ссылки регистрируются кодом. Полный список —
`compatibility.md` §4.

## 4. Состав PHP

| Класс / файл (`src/…`) | Назначение | Этап |
|---|---|---|
| `modules/ModernUI/ModernUI.php` — `class ModernUI` | `vtlib_handler($moduleName, $eventType)`; вызывает `ModernUI_Lifecycle_Model` | 02 |
| `modules/ModernUI/models/Lifecycle.php` | синхронизация ссылок и пункта настроек, вызов миграций, политика uninstall | 02 |
| `modules/ModernUI/models/LinkHandler.php` — `ModernUI_LinkHandler_Model` | обработчик `HEADERCSS`/`HEADERSCRIPT` (§3.2) | 02 |
| `modules/ModernUI/models/Activation.php` | решение «тема активна для пользователя и экрана» (режим, пилот, личный выбор, безопасный режим, исключения, версия, схема, сборка) | 02 |
| `modules/ModernUI/models/Schema.php`, `migrations/NNNN_*.php` | версия схемы, идемпотентные миграции (`settings.md` §5) | 02 |
| `modules/ModernUI/models/Settings.php` | спецификация ключей, валидация, слияние областей, чтение/запись с ревизиями | 02 (ключи меню/брендинга — 05) |
| `modules/ModernUI/models/Db.php` | обёртка `PearDatabase` с чтением «сырых» значений (`fetch_array` кодирует HTML) | 02 |
| `modules/ModernUI/models/Assets.php` | чтение `dist/manifest.json`, id сборки, URL skin, теги своих страниц | 02 |
| `modules/ModernUI/models/Locale.php` | сопоставление `ru_ru/en_us/de_de` ↔ `ru-RU/en-US/de-DE`, переводы PHP с fallback | 02 |
| `modules/ModernUI/models/Client.php`, `actions/Bootstrap.php` | данные для Vue (§8, `settings.md` §7) | 02 |
| `modules/ModernUI/models/Page.php` | общие части своих страниц: язык темы, плагин Smarty `{mu_t}`, сообщения форм, JSON-ответ | 02 |
| `modules/ModernUI/actions/Preferences.php`, `views/Preferences.php` | личные настройки (`mode=save|clear`) и страница предпочтений без JS | 02 (редактор — 05) |
| `modules/Settings/ModernUI/views/Index.php` | страница настроек администратора: состояние, включение, восстановление, проверка frontend | 02 (редактор — 05) |
| `modules/Settings/ModernUI/actions/{Toggle,Recovery}.php` | включение для себя/выключение, пилот по пользователю и роли (режимы `pilotAddUser`, `pilotRemoveUser`, `pilotAddRole`, `pilotRemoveRole`), повтор миграций и ссылок (HTML-формы) | 02, пилот — 03 |
| `modules/ModernUI/models/Pilot.php` | кто может войти в пилот (активные пользователи, существующие роли) и подписи для страницы настроек; только чтение таблиц CRM | 03 |
| `modules/Settings/ModernUI/actions/{Save,Export,Import,Logo,Reset,Uninstall}.php` | редактор настроек и меню, перенос, логотип, удаление из интерфейса | 05, 10 |
| `modules/ModernUI/models/Menu.php` | итоговое меню пользователя из разрешённых модулей | 05–06 |

Совместимость PHP 8.1–8.5: без `readonly`-классов, `enum` допускаются только если используются
одинаково в 8.1 (8.1 их поддерживает), без синтаксиса 8.2+ (`readonly class`, DNF-типы, константы в
трейтах), без устаревших в 8.4/8.5 конструкций (неявно nullable-параметры, `${}`-интерполяция).
Lint — PHP 8.1 (Docker), 8.4, 8.5.

Шаблоны: Smarty 4.5 (`composer.json` 8.4.0: `smarty/smarty ^4.3`) предупреждает о PHP-функциях,
не зарегистрированных как модификаторы. Шаблоны ModernUI используют только модификаторы, которые
регистрирует `Vtiger_Viewer::__construct()` (`vtranslate`, `vresource_url`, `escape`…), и
собственные плагины, зарегистрированные в своих view; данные готовятся в PHP.

## 5. Ресурсы и загрузка frontend

### 5.1. Слои

| Слой | Что | Как подключается | Признак активности |
|---|---|---|---|
| skin | CSS переоформления DOM v7: типографика, поверхности, кнопки, таблицы, формы, Select2, модалки | `HEADERCSS` → `dist/assets/skin-<hash>.css` в `<head>` | решение обработчика ссылки (файл не выводится, если тема для пользователя/экрана не активна) + все правила внутри `:root:not(.mu-off)` |
| tokens | CSS-переменные действующих цветов, плотности и размера текста пользователя | значения по умолчанию — в skin; действующие ставит загрузчик синхронно из кэша `localStorage` и сверяет с ответом `Bootstrap` (см. ниже) | атрибуты `data-mu-density`, `data-mu-font` на `<html>` |
| shell | Vue-острова: мега-меню, полоса избранного, системные пункты темы, острова на экранах | `HEADERSCRIPT` → `loader.js` → `dist/assets/shell-<hash>.js` (ES module) | класс `mu-shell-ready` на `<html>` после монтирования |
| страницы модуля | приложения настроек и предпочтений | теги из manifest в собственных `.tpl` (PHP `ModernUI_Assets`) | собственная страница |

Слой skin не прячет и не перемещает элементы — только меняет вид, поэтому его работа без JS
безопасна. Всё, что скрывает элементы v7 (например, кнопку меню приложений, заменённую навигацией
темы), действует только под `html.mu-shell-ready`. Сбой загрузки JS оставляет переоформленный, но
полностью рабочий v7.

Цвета, заданные администратором/ролью/пользователем: skin использует CSS-переменные со значениями
по умолчанию. Действующие значения загрузчик ставит в `document.documentElement.style` сразу при
исполнении из кэша `localStorage` (ключ — пользователь + ревизия настроек, ревизию обработчик
передаёт в URL загрузчика `&r=`), затем сверяет с `Bootstrap`. Первая страница после изменения
настроек может кратко показать цвета по умолчанию; это измеряется на этапе 04. Если мигание
заметно, вариант Б — второй `HEADERCSS` на действие `index.php?module=ModernUI&action=Tokens&r=<rev>&z=`
(проверка `file_exists('index.php')` проходит), ответ `text/css` с `Cache-Control: private,
max-age=31536000, immutable`. Решение — на этапе 04 по замеру.

### 5.2. Сборка (этап 02)

- `frontend/` — Vite 8 + Vue 3.5, TypeScript в строгом режиме (`dependencies.md` §5), `@vitejs/plugin-vue`; entries: `shell` (`src/shell/main.ts`),
  `settings` (`src/settings/main.ts`), `skin` (`src/skin/skin.scss`); `preferences` — с редактором этапа 05
  (на этапе 02 страница предпочтений — серверная форма). Код нескольких entries (Vue, vue-i18n, базовые
  стили) — в одном chunk `common` (`codeSplitting.groups`, `minShareCount: 2`); все приложения одной
  страницы получают один экземпляр Vue (один URL модуля), `window.Vue` не создаётся. Загрузчик и PHP
  (`ModernUI_Assets_Model::entryTags`) подключают CSS entry **и всех импортируемых им chunk'ов**
  (контракт backend integration Vite).
- `base: './'`: импорты chunk'ов и предзагрузка зависимостей разрешаются относительно
  `import.meta.url` — работает в корне и подкаталоге без знания базового URL CRM (проверено, §5.3).
- Выход — `src/layouts/v7/modules/ModernUI/resources/dist/` (в `.gitignore`), внутри подключённого
  read-only каталога: dev-стенд видит сборку сразу.
- `build.manifest` пишется во временное имя, плагин после записи всех файлов делает `rename()` в
  `manifest.json` — атомарная смена версии. `emptyOutDir: false`; плагин удаляет файлы, на которые не
  ссылаются два последних manifest и которые старше 10 минут, — открытые страницы не теряют chunk'и.
- Ошибка компиляции не трогает `dist/` (Vite не пишет файлы при ошибке сборки; в watch-режиме
  предыдущий manifest остаётся). Production-сборка не содержит ссылок на dev server.
- `target: es2020` (поддерживаемые браузеры — последние версии Chrome/Edge/Firefox/Safari; браузер без
  ES modules получает v7 со skin).
- `vite build --watch` — режим разработки; HMR не используется: он требует dev server на другом
  origin и модульной загрузки, несовместимой с HEADERSCRIPT. Режим определяется командой сборки.

### 5.3. Загрузчик `loader.js`

Прототип проверен 2026-11-01 (headless Chromium 1243, Vite 8.3.5, Vue 3.5.44; страница с тегом
`<script type="text/javascript" src="layouts/v7/modules/ModernUI/resources/loader.js?b=abc123&z=?v=8.4.0">`
в корне сайта и в подкаталоге `/vtigercrm/`):

| Сценарий | Результат |
|---|---|
| корень и подкаталог | manifest, entry, CSS, lazy-chunk и его CSS загружены по путям внутри каталога ресурсов модуля, Vue смонтирован, кириллица и ä/ü/ß выводятся |
| удалён lazy-chunk | основное приложение работает, отказ динамического импорта перехватывается приложением |
| удалён entry | `onerror` скрипта → маркер ожидания снят, `data-mu-failed="entry-load"`, v7 без изменений |
| удалён manifest | `data-mu-failed="manifest-invalid"`, v7 без изменений |

Алгоритм (ES5, без зависимостей):

1. `document.currentScript.src` → каталог ресурсов модуля и `b` (id сборки), `r` (ревизия настроек);
2. если нет поддержки `type=module` или включён `modernui=off` — выход;
3. ставит `html.mu-pending` (резерв высоты полосы избранного, без скрытия элементов v7);
4. `XMLHttpRequest GET dist/manifest.json?b=<b>` (кэшируется браузером по уникальному URL);
5. вставляет `<link rel=stylesheet>` CSS entry `shell` и `<script type="module">` entry;
6. сторожевой таймер 15 с: если entry не сообщил `mu:ready`, снимает `mu-pending`, ставит
   `data-mu-failed`; ошибки — в консоль с префиксом `[ModernUI]`, без `alert`.

Entry `shell` ждёт `jQuery(ready)`, монтирует острова, затем ставит `mu-shell-ready`. Любое
исключение при монтировании → размонтировать созданное, снять маркеры, оставить v7.

### 5.4. Базовый URL и кэш

- Все URL ModernUI относительные: страницы v7 всегда открываются как `<база>/index.php?…`, поэтому
  `layouts/…` разрешается в каталог установки. Загрузчик и chunks не используют `site_URL`.
- Действия сервера вызываются как `index.php?module=ModernUI&action=…` относительно `document.baseURI`.
- Кэш: hashed-файлы — навсегда (уникальные имена); `loader.js` и `manifest.json` — с `?b=<build>`;
  id сборки — хэш содержимого manifest (читает `ModernUI_Assets`, кэш на запрос).
- Проверки этапа 03: установка чистого стенда в подкаталог `/vtigercrm/` и в корень.

## 6. Границы DOM

| Область | Владелец | Что разрешено ModernUI |
|---|---|---|
| `[data-mu-root]` контейнеры (полоса избранного, кнопка и мега-меню, панели, страницы модуля, оверлеи `#mu-overlay-root`) | ModernUI | Vue монтирует/размонтирует, любые изменения |
| шапка v7 `nav.app-fixed-navbar`, `#navbar`, `.global-actions`, поиск | v7 + расширения | только CSS; вставка собственного контейнера рядом (не внутрь чужих `ul`) |
| меню приложений `#app-menu`, `#appnavigator`, `#modules-menu` | v7 | CSS; скрытие кнопки `#appnavigator` и `#modules-menu` — только под `mu-shell-ready` и только если адаптер не нашёл в них чужих элементов (§7.1) |
| списки, карточки, формы, связанные списки, модалки, Select2, datepicker | v7 + расширения | только CSS (цвета, отступы, шрифты, рамки); никаких перестановок, `innerHTML`, клонирования, смены `id`/`name`/`data-*`, порядка полей и значений формы |
| `body`, `#page`, `.main-container`, `#pjaxContainer`, `.myModal` | v7 | только классы-модификаторы на `<html>` и CSS-переменные; Vue на них не монтируется |

Острова на экранах (этапы 06–08) вставляются как новые соседние узлы с `data-mu-root` в точках,
которые не перерисовываются тем же jQuery-кодом, либо переустанавливаются адаптером после
перерисовки (§7.3).

Слои z-index (исправлено на этапе 02 по CSS skin v7 тега 8.4.0): шапка v7 `.navbar-fixed-top` —
**1095 !important** (не 1030 Bootstrap), `.module-nav` 1093, `#overlayPage` 1099, `.modal` 1100,
qtip 1082, Select2 10000+. Оверлеи темы (выпадающие меню, мега-меню) рендерятся в `#mu-overlay-root`,
у которого `position: relative; z-index: 1097`: обёртки popper'ов — `position: fixed`, то есть
собственные контексты наложения, и без слоя у корня они оказываются под шапкой (проверено e2e:
`elementFromPoint` в подписи меню). Полоса избранного (этап 04) — между шапкой и оверлеями
(1096); внутри модалки оверлей — в её DOM. Select2 3.x и qtip не трогаются.

## 7. Сохранение элементов расширений

### 7.1. Шапка и меню

1. Шапка v7 не заменяется: CTMobile, телефония, уведомления и другие расширения продолжают вставлять
   кнопки в `#navbar ul.nav.navbar-nav` и видны на своих местах, получают свои обработчики событий.
2. Skin переоформляет `#navbar > ul > li` единообразно (размер, интервал, состояние фокуса), не
   меняя порядок и видимость; элементы неизвестной разметки получают нейтральные стили.
3. Навигация темы (Vue) заменяет только меню приложений. Перед скрытием `#appnavigator`/`#app-menu`
   адаптер сравнивает ссылки `#app-menu a[href]` с итоговым меню темы: ссылки, которых нет в меню
   (добавлены расширением), выводятся в разделе «Ещё» мега-меню как обычные ссылки с тем же `href`
   (не невидимые дубликаты, а полноценные пункты); элементы без `href` (кнопки с обработчиками) —
   признак, что кнопку меню v7 скрывать нельзя: она остаётся видимой, событие записывается в
   журнал совместимости в консоли.
4. `MutationObserver` на `#navbar` и `#app-menu` (только `childList`, `subtree`) переоценивает п. 3
   при поздних вставках (расширения, которые добавляют кнопки после `ready`).
5. Пункт «Новый интерфейс» в меню пользователя v7 загрузчик вставляет отдельным `li` с
   `data-mu-root` только при включённой самостоятельной активации (`settings.md` §3).

### 7.2. Формы, списки, карточки

- Только CSS: `#EditView`, `.fieldBlockContainer`, `td.fieldLabel/.fieldValue`, `#lineItemTab`,
  `.listViewEntries`, `.detailview-table` и т. п. сохраняют структуру таблиц и ячеек, на которую
  опираются ControlLayoutFields, AdvancedCustomFields, RelatedBlocksLists, SPDynamicBlocks,
  ListviewColors (`compatibility.md` §3).
- Не перекрашиваются строки и ячейки с inline-стилями расширений (`style="background…"`): правила
  skin для фона строк используют `:where()` с нулевой специфичностью либо пропускают
  `[style*="background"]`.
- Скрытые поля остаются скрытыми: skin не задаёт `display` элементам с `.hide`, `[hidden]`,
  `style="display:none"`.
- Кнопки, добавленные расширениями в панели действий (`.detailViewButtoncontainer`,
  `.listViewActionsContainer`, `.btn-group`), оформляются общими правилами `.btn`.

### 7.3. Перерисовка и жизненный цикл островов

Реестр островов: `{ id, selector точки вставки, mount(), unmount() }`. Адаптер v7:

- первичное монтирование после `jQuery(ready)` (после `app.controller()`);
- `MutationObserver` на корнях, которые v7 перерисовывает (`.main-container`, `#listViewContent`,
  `.related-tabs`, `.myModal`): удалённый корень острова → `app.unmount()` и снятие подписок;
  появившаяся точка вставки → повторное монтирование (идемпотентно, по `data-mu-root`);
- подписки на `app.event` (каталог — `compatibility.md` §2) снимаются в `unmount`;
- каждый остров изолирован: исключение в одном не мешает другим и v7.

## 8. Серверные действия

Ответ — `Vtiger_Response` (JSON `{success, result | error}`), ошибки — коды `MU_*` с параметрами, тексты
переводит клиент. Все действия: вход обязателен, `vtlib_isModuleActive('ModernUI')`, версия схемы.

| URL (`index.php?…`) | Метод | Кто | Проверки | Назначение |
|---|---|---|---|---|
| `module=ModernUI&action=Bootstrap` | GET | любой вошедший | Referer, ETag | действующие настройки пользователя, меню, локаль, флаги |
| `module=ModernUI&action=Preferences&mode=save` | POST | любой вошедший | CSRF, ревизия, разрешённые ключи | личные настройки |
| `module=ModernUI&action=Preferences&mode=clear` | POST | любой вошедший | CSRF | сброс личных настроек (не `mode=reset`: `WebUI.php` для `mode=reset`, `mode=fromMig` и `action=Login` не подключает csrf-magic — запрос падает на проверке CSRF; найдено на этапе 02, проверяется `tests/php/RoutesTest.php`) |
| `module=ModernUI&view=Preferences` | GET | любой вошедший | — | страница личных предпочтений |
| `module=ModernUI&parent=Settings&view=Index` | GET | админ | `Settings_Vtiger_Index_View` | страница настроек (+ HTML-форма без JS: вкл/выкл темы, безопасный режим) |
| `module=ModernUI&parent=Settings&action=Save` | POST | админ | CSRF, ревизия, валидация | общие и ролевые настройки, меню |
| `…&action=Export` | GET | админ | — | JSON-экспорт (`settings.md` §8) |
| `…&action=Import&mode=preview|apply` | POST | админ | CSRF, размер ≤ 256 КБ, схема | импорт JSON |
| `…&action=Logo&mode=upload|delete` | POST | админ | CSRF, PNG/JPEG/GIF ≤ 512 КБ, проверка изображения | логотип темы в `test/logo/` |
| `…&action=Reset` | POST | админ | CSRF | сброс области к значениям по умолчанию |
| `…&action=Toggle` | POST | админ | CSRF | включить/выключить тему (обычная HTML-форма, работает без Vue) |
| `…&action=Recovery` | POST | админ | CSRF | повторить миграции, пересинхронизировать ссылки |
| `…&action=Uninstall` | POST | админ | CSRF, подтверждение | `Vtiger_Module::delete()` по политике `settings.md` §9 |

Клиент API: `fetch(url, {method:'POST', credentials:'same-origin', headers:{'X-Requested-With':
'XMLHttpRequest'}, body: URLSearchParams + __vtrftk=window.csrfMagicToken})`. Ответы проверяют
`success`; 401/истёкшая сессия → сообщение «Сессия истекла» и ссылка на вход. `jQuery.ajax` для
своих запросов не используется: около десятка распространённых расширений висят на глобальном
`ajaxComplete` и пересканируют страницу после каждого jQuery-запроса (`compatibility.md` §3).

## 9. CSS-изоляция

- Нет reset/preflight, правил на `*`, `html`, `body`, `a`, `button`, `input` без ограничения.
  Skin — правила по классам/ID v7 внутри `:root:not(.mu-off)`; компоненты темы — внутри `.mu-root`
  (класс каждого контейнера) и `[data-mu-root]`.
- Каскадные слои (`@layer`) для стилей темы не используются: нерасслоённый CSS ядра v7 побеждает
  любые слоёные правила независимо от специфичности.
- Bootstrap 3 ставит `html { font-size: 10px }` — единицы `rem` внутри темы запрещены (или
  токены библиотеки переопределяются в `px`); проверка — `dependencies.md`.
- Внутри `.mu-root` задаются наследуемые свойства (font, line-height, color, letter-spacing,
  box-sizing для потомков) — чтобы `body` v7 не протекал в компоненты; переопределение глобальных
  правил Bootstrap для элементов (`label{font-weight:bold}`, `button`, `input`, `table`) — точечно
  внутри `.mu-root`.
- Оверлеи библиотеки рендерятся в `#mu-overlay-root.mu-root` (не прямо в `body`); у выпадающих
  элементов шапки — немодальный режим (Reka ставит `body{pointer-events:none}` на время модальных слоёв).
- skin v7 содержит `*:focus, *:active { outline: none }` — кольца фокуса темы делаются `box-shadow` на
  `:focus-visible`.
- Компоненты — Reka UI + собственный набор `Mu*` в px (`dependencies.md` §2): проверено 0 влияний CSS v7
  на компоненты и 0 влияний компонентов на хост.
- Смысловые цвета статусов и строк расширений не меняются; глобальные классы Bootstrap
  (`.btn-success` и т. п.) получают оттенки темы только у кнопок, не у меток данных.

## 10. Мультиязычность

- Карта локалей (`ModernUI_Locale` и `frontend/src/i18n/locale.ts`, одна таблица тестируется на
  обеих сторонах): `ru_ru, ru, ru_RU, ru-RU → ru-RU`; `en_us, en_gb, en, en-US → en-US`;
  `de_de, de, de_DE, de-DE → de-DE`; остальное → общий язык темы по умолчанию → `en-US`.
- Приоритет: личный выбор темы → язык пользователя CRM → общий язык темы → `en-US` (`I18N.md`).
- Vue: `vue-i18n` (Composition API, `legacy: false`), runtime-only сборка, сообщения
  прекомпилируются `@intlify/unplugin-vue-i18n` — без `new Function` во время работы;
  `fallbackLocale: 'en-US'`, своё правило множественного числа для `ru-RU`; HTML в сообщениях
  запрещён (`v-html` с переводами не используется). Словари — `frontend/src/i18n/locales/*.json`.
- PHP/Smarty: `languages/{en_us,ru_ru,de_de}/ModernUI.php` и `…/Settings/ModernUI.php` — только тексты,
  которые выводит сервер (пункт настроек, страницы без JS, сообщения lifecycle). Сервер отдаёт
  клиенту коды ошибок, не тексты, — поэтому общих текстов у PHP и Vue почти нет; тест сверяет
  паритет ключей и плейсхолдеров внутри каждого набора, пустые строки, совпадение de/en
  (список допустимых совпадений — явный).
- Названия модулей/полей — переводы CRM (`vtranslate` на сервере, с языком CRM пользователя). Если
  язык темы отличается от языка CRM, системные названия остаются на языке CRM — это видно в
  приёмке (`I18N.md`).
- Форматы дат/чисел/валют не меняются: тема не форматирует бизнес-значения v7.

## 11. Сбои и восстановление

| Сбой | Поведение |
|---|---|
| JS заблокирован / ошибка `loader.js` | skin работает, v7 полностью рабочий; `mu-shell-ready` не ставится |
| 403/404/500 на manifest или chunk | `data-mu-failed`, снят `mu-pending`, v7 рабочий; повтор на следующей странице |
| исключение при монтировании | остров размонтирован, маркеры сняты |
| 403/500 у `Bootstrap` | shell не монтируется (нет данных меню), skin остаётся |
| ошибка в обработчике ссылки | `catch (\Throwable)` → `false`: темы на странице нет, CRM работает |
| несовпадение версии схемы (прерванное обновление) | тема не подключается; страница настроек предлагает `Recovery` |
| некорректные сохранённые настройки | валидация при чтении: неизвестные/битые значения заменяются значениями по умолчанию, предупреждение администратору |
| плохие настройки темы мешают работе | `index.php?modernui=off` → флаг в сессии, ресурсы темы не выводятся до `modernui=on` или выхода; личный «Стандартный вид»; администратор — HTML-форма `Toggle` на странице настроек без Vue |
| не открывается и страница настроек | менеджер модулей → выключить ModernUI (ссылки удаляются `module.disabled`); крайний случай — консоль vtlib `--remove` |

Безопасный режим не обходит вход, CSRF и права: он только перестаёт выводить ресурсы темы.

## 12. Структура репозитория и пакета

```
src/                                   раскладка путей CRM (dev/crm-mounts.txt, без изменений)
  modules/ModernUI/                    ModernUI.php, actions/, views/, models/, migrations/
  modules/Settings/ModernUI/           actions/, views/ (models/ — по мере надобности) → ZIP settings/{actions,views,models}/
  layouts/v7/modules/ModernUI/         *.tpl, resources/loader.js, resources/dist/ (сборка, .gitignore)
  layouts/v7/modules/Settings/ModernUI/ *.tpl
  languages/{en_us,ru_ru,de_de}/ModernUI.php, Settings/ModernUI.php
frontend/                              package.json, package-lock.json, vite.config.ts, build/ (плагины сборки),
                                       src/{shell,settings,skin,styles,i18n,api,adapters,boot}, tests/ (vitest), e2e/ (Playwright)
packaging/                             manifest.xml.tpl, build-zip.py, allowlist.txt
dev/                                   crm-link.sh, crm-mounts.txt, crm-info.php, crm-vtlib.php, crm-links-for.php, check-private.sh
tests/                                 php/ (модели, i18n, маршруты; db/ — миграции на временной MySQL), package/ (состав ZIP,
                                       распаковка импортёром 8.4.0), fixtures/ (общие для PHP и TypeScript)
dist/                                  ModernUI-X.Y.Z.zip, .zip.sha256, .files.txt (не в git)
VERSION                                версия модуля для manifest.xml (или MU_VERSION при сборке)
```

Unit-тесты TypeScript и e2e лежат в `frontend/`, потому что им нужны `node_modules` и конфигурация TypeScript
этого пакета; общие ожидания (карта локалей, общие тексты PHP/Vue) — в `tests/fixtures/`.

Отображение `src/` → ZIP (`packaging/build-zip.py`), сверено с `initImport()`/`initUpdate()` 8.4.0:

| `src/` | ZIP |
|---|---|
| `modules/ModernUI/**` | `modules/ModernUI/**` |
| `modules/Settings/ModernUI/{actions,views,models}/**` | `settings/{actions,views,models}/**` |
| `layouts/v7/modules/ModernUI/**` (включая `resources/dist/**` из production-сборки) | то же |
| `layouts/v7/modules/Settings/ModernUI/**` | то же |
| `languages/<lang>/ModernUI.php`, `languages/<lang>/Settings/ModernUI.php` | то же |
| `packaging/manifest.xml.tpl` | `manifest.xml` |

Сборка ZIP проверяет: только пути из allowlist, из `dist/assets` — только файлы текущего manifest, нет
`.map`, `node_modules`, dev-URL (`localhost`, `:5173`), абсолютных путей, `*.php` вне `modules/` и
`languages/`, других `manifest?xml`; путь каждого файла после `initImport()`/`initUpdate()` (те же
префиксы и порядок переименования, что в 8.4.0) равен его пути в `src/`; `php -l` под 8.1/8.4/8.5
(`task lint` перед сборкой); SHA-256 и список файлов рядом. Время в ZIP — `SOURCE_DATE_EPOCH` или время
последнего коммита: повторная сборка того же дерева даёт байт-в-байт тот же архив (`task test:package`,
там же распаковка настоящим кодом `PackageImport`/`PackageUpdate`/`Unzip` тега 8.4.0).

`dev/crm-mounts.txt` совпадает со структурой — изменений карты не требуется (проверено
`task crm:status` 2026-11-01).

## 13. Команды этапа 02

| Команда | Что делает |
|---|---|
| `task fe:install` | `npm ci --ignore-scripts` в `frontend/` |
| `task build` | production-сборка frontend в `src/layouts/v7/modules/ModernUI/resources/dist/` |
| `task dev` | `vite build --watch` (тот же выход, атомарная смена manifest) |
| `task package` | `lint` → `build` → `packaging/build-zip.py`: ZIP в `dist/` + SHA-256 + список файлов (версия — `VERSION` или `MU_VERSION`) |
| `task crm:install` | `package` → `crm:unlink` → `dev/crm-vtlib.php import` (тот же `Vtiger_Package::import()`, что менеджер модулей) → `crm:link --force` (распакованные файлы — в `.local/crm-replaced/`) |
| `task crm:update` | то же через `Vtiger_Package::update()` |
| `task crm:uninstall` | `Vtiger_Module::delete()`; таблицы остаются, `-- --purge` — удалить и их; файлы не трогает |
| `task crm:enable` / `task crm:disable` | `vtlib_toggleModuleAccess()` — как переключатель менеджера модулей |
| `task lint` | `php -l` под 8.5, 8.4 и 8.1 (Docker `php:8.1-cli` с закреплённым digest); `vue-tsc`, `eslint --max-warnings 0`, ES5-синтаксис `loader.js` (acorn) |
| `task test` | сборка, PHP-тесты под 8.5/8.4/8.1, миграции на временной MySQL 8.4 (utf8mb4 и utf8), `vitest`, тесты пакета |
| `task test:e2e` | Playwright на dev-стенде (`CRM_URL`, вход из `.env`) |

`dev/crm-links-for.php <CRM root> <user id>` — только чтение: какие ссылки ModernUI ядро выведет данному
пользователю (проверка «другой пользователь не затронут» без входа под ним).

## 14. Неопределённости → проверки этапов 02–03 (статусы на конец этапа 03)

| № | Проверка | Этап |
|---|---|---|
| Q1 | изменение `linkurl` в обработчике действует в `Header.php` чистой 8.4.0 и dev-стенда; при отказе — тема не подключается | 02: dev-стенд — да; 03: чистая 8.4.0 (PHP 8.1 и 8.5) — да (e2e: `skin-<hash>.css?b=…&z=?v=8.4.0`, `loader.js?b=…&r=…&z=…`) |
| Q2 | не-админ с ограниченным профилем получает ссылки `tabid=0` сразу после импорта, без пересоздания привилегий | 03: да — U получает тему через пилот, время файла `user_privileges` U до импорта и после сценария не изменилось (`task clean:verify`); пересоздаёт его первый вход пользователя (UserSetup), не импорт |
| Q3 | `module.disabled`/`enabled` из менеджера модулей удаляет/восстанавливает ссылки; у админа на чистой 8.4.0 тема пропадает сразу после disable | 02: dev-стенд — да (CLI); 03: чистая 8.4.0, переключатель менеджера модулей — да, тема пропадает у A и U со следующей страницы, возвращается с прежними настройками |
| Q4 | `Vtiger_Package::update()` с ZIP новой версии: миграции в `postupdate`, настройки сохранены, окно «новый код/старая схема» не ломает страницы | 02: dev-стенд 0.1.0 → 0.1.1 — да; 03: «Update Now» менеджера модулей тем же ZIP на чистом стенде и dev-стенде — настройки и регистрация сохранены; новой миграции ещё нет — проверка с миграцией на этапе 10 |
| Q5 | `vtlib_addSettingsLink` на чистой 8.4.0: блок `LBL_OTHER_SETTINGS` существует, пункт виден и подсвечивается | 03: да (e2e: пункт в «Other Settings», `settingsgroup-menu-color`, блок раскрыт) |
| Q6 | кодировка/collation собственных таблиц совпадает с базой чистого стенда (установщик 8.4.0) и dev-стенда | 02: dev-стенд `utf8mb4_general_ci`; 03: чистая 8.4.0 — база `utf8mb3_general_ci`, таблицы ModernUI — `utf8mb3_general_ci` |
| Q7 | загрузчик на реальной странице 8.4.0: `?b=…&z=?v=8.4.0`, подкаталог `/vtigercrm/`, порядок относительно `app.controller()` | 02: dev-стенд в корне — да; 03: чистая 8.4.0 в корне (PHP 8.1) и в `/vtigercrm/` (PHP 8.5) — да |
| Q8 | skin в `<head>` не даёт мигания v7 при переходах; CLS полосы избранного при `mu-pending` ≤ 0.1 | 04 |
| Q9 | `Bootstrap` < 50 мс на сервере dev-стенда, ETag/304 | 04 |
| Q10 | Vue-оверлей внутри модалки Bootstrap 3 не конфликтует с `enforceFocus` | 07 |
| Q11 | реэкспорт/импорт ролей по имени между чистым и dev-стендом | 05 |
| Q12 | удаление через консоль vtlib и кнопку модуля: нет ссылок, пункта настроек, таблиц (по политике) | 03: консоль на чистом стенде — ссылок и пункта нет, таблицы сохранены, страницы без ошибок; кнопка модуля и `--purge` — 10 |
