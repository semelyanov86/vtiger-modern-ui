# Архитектура ModernUI

Этап 01, 2026-11-01. Документ проверен по официальному тегу Vtiger `8.4.0`
(`0bb3774e7df04c40bc2cc81b1f910a6b1ae77be2`) и по коду dev-стенда (Vtiger 8.4.0 с доработками
сторонней сборки). Номера строк ниже — по тегу `8.4.0`. Связанные документы: `settings.md`
(настройки и меню), `design.md`, `dependencies.md`, `compatibility.md`, `environments.md`,
`verification.md` (матрица приёмки), контракты `COMMON.md`, `DEVELOPMENT.md`, `I18N.md`.

**Коррекция 2026-11-06:** документ содержит устройство версии после 08. Для дальнейшей разработки
цель и допустимые изменения компоновки задают `visual-parity.md` и A14 ниже. Сохранение v7 как
источника поведения не означает сохранение его шапки, sidebar и полноэкранной композиции.
**Этап 09 (2026-11-07):** механизм выбран и доказан прототипом — A15, §7.7.

## 1. Решения кратко

| № | Решение | Основание |
|---|---|---|
| A1 | Пакет — vtlib-модуль типа `extension` с именем `ModernUI`, без entity-таблиц, без поля `<parent>` (не появляется в меню приложений) | `PackageImport::import_Module()` (стр. 473–529): `type=extension` → `isentitytype=false` |
| A2 | Два слоя: **skin** через `HEADERCSS`; **shell** — Vue в своих контейнерах через `HEADERSCRIPT`. До 08 DOM/геометрия v7 сохранялись; с 09 компоновка экрана меняется правилами первой отрисовки (таблица токенов, A15) и штатными механизмами v7, которые shell вызывает (overlay записи) | CSS до JS нужен против мигания; границы владения и событий сохраняются, фиксированные координаты v7 — нет |
| A3 | Обе глобальные ссылки регистрируются с `tabid = 0` и обработчиком ссылки `ModernUI_LinkHandler_Model::filter`; обработчик решает per-user и per-screen, подключать ли тему, и добавляет к URL идентификатор сборки | `Vtiger_Link::getAllByType()` вызывает `handler_class::handler()` до вывода ссылки (стр. 229–241); фильтр по разрешённым `tabid` для не-админов не зависит от устаревших файлов привилегий (§3.3) |
| A4 | Ссылки создаются и удаляются кодом lifecycle (`vtlib_handler`), а не секцией `<customlinks>` manifest | В 8.4.0 `import_CustomLinks()` передаёт `handler_*` с числовыми ключами, а `Vtiger_Link::addLink()` читает `path/class/method` — обработчик теряется (стр. 853–873 и `Link.php` 118–123) |
| A5 | Загрузчик — маленький ES5-скрипт `loader.js` (без сборки), он читает `dist/manifest.json` и вставляет `<script type="module">` | `Vtiger_JsScript_Model::DEFAULT_TYPE = 'text/javascript'`, у ссылки нет поля `type`; прототип проверен (§5.3) |
| A6 | Vue монтируется только в собственные `[data-mu-root]`; jQuery-DOM не клонируется и не пересоздаётся. Кнопки/обработчики расширений остаются рабочими и доступными; их прежние координаты не обязательны. Содержимое записи и формы над списком рисуют нативные views и шаблоны 8.4, обработчики — классы v7 | `COMMON.md`, A14, A15 и `visual-parity.md`; совместимость проверяется поведением |
| A7 | Собственные страницы (настройки администратора, личные предпочтения) — обычные vtlib-view со своими Smarty-шаблонами; их Vue-приложения подключаются из PHP по manifest и работают при выключенной теме | Включать тему администратор должен на странице, которая не зависит от включённой темы |
| A8 | Настройки — собственные таблицы `vtiger_modernui_*`, версия схемы и идемпотентные миграции внутри пакета, выполняются lifecycle; при несовпадении версии схемы тема автоматически не подключается | `PackageUpdate::update_Module()`: файлы распаковываются до `module.preupdate`, версия в `vtiger_tab` меняется только перед `module.postupdate` (стр. 136–181) |
| A9 | Безопасный режим: `index.php?…&modernui=off` (на сессию) и личный «Стандартный вид»; обработчик ссылки перестаёт выводить ресурсы темы — восстановление не зависит от JS | §11 |
| A10 | Клиент API — `fetch` с явным `__vtrftk` и `X-Requested-With`; серверные действия — стандартные контроллеры Vtiger с `validateWriteAccess()` | `csrf-magic.js` патчит только `XMLHttpRequest` и `jQuery.ajax`, не `fetch` (§3.9) |
| A11 | Действующие токены пользователя — третья ссылка `HEADERCSS` на `index.php?module=ModernUI&action=Tokens&r=<ключ>` (вариант Б §5.1, этап 04): блокирующая отрисовку таблица стилей, кэш браузера `immutable` по ключу настроек; кэш токенов в `localStorage` у загрузчика убран | замер этапа 04: при промахе кэша значения по умолчанию были видны 100–230 мс после первой отрисовки, промах — после каждого изменения настроек и обновления модуля и на каждой странице при заблокированном `localStorage` (§5.1) |
| A13 | Адаптеры публичных расширений — реестр в пакете (`ModernUI_Adapters_Model`): адаптер действует, только если модуль установлен и активен, версия в проверенном диапазоне, файлы и таблицы на месте и администратор его не выключил; стили — внутри таблицы токенов, клиентская часть — отдельный chunk с проверкой DOM, правила экранов `skin`/`standard`; особенности конкретной CRM — вне пакета | этап 08, §7.6: без расширения от адаптера на странице ничего нет, отсутствие класса/таблицы/поля даёт общий skin, а не ошибку |
| A15 | Карточка поверх списка (09 → 13): Navigation API перехватывает штатный переход строки; `ModernUI_Record_View` собирает нативные Detail-шапку, вкладки и тело в `#overlayPageContent`. Данные, права, метаданные, JS/CSS и handlers — исходного модуля. Vue владеет только оболочкой. Правка — native `OverlayEditView`; тот же `FormData` отправляется в `action=Save`. Ошибка конкретной операции → прямой Detail URL | Механизм и история — §7.7; расширение до полной карточки, lifecycle и связанные записи — §7.10 |
| A12 | Runtime островов (`frontend/src/boot/runtime.ts`): идемпотентный старт, проверка возможностей экрана, область подписок/таймеров острова, перемонтирование после перерисовки v7 по одному `MutationObserver` с проверкой раз в кадр, предел монтирований, `html[data-mu-replaced]` только у смонтированной замены; уровни страницы `islands`/`skin`/стандартный вид | этап 04, §7.3 |

### A14. Целевой каркас после этапа 08 (механизм — A15)

- Навигация, списки, overlay карточки/формы и настройки строятся по облачному эталону.
  Старые §7.1–7.2 и описание 06–08 ниже — исходная реализация, не запрет изменения композиции.
- Права, CSRF, поля, значения, расчёты и обработчики CRM сохраняются. Нельзя клонировать форму,
  собирать вторую через общий CRUD API или копировать ядро/коммерческий bundle в модуль.
- Этап 09 сначала проверяет штатные quick/detail/overlay механизмы и альтернативы CSS/адаптеров
  исходных узлов: делегированные события, родительские селекторы, widget init/dispose, прямые
  URL, history, AJAX и восстановление. Точная реализация выбирается по работающему прототипу,
  не объявляется совместимой заранее.
- Критерии независимы: V — облачный вид и открытие, F — прежнее поведение CRM. Неизменные
  DOM-координаты не являются F; runtime `islands` не является V. Обязательные таблицы/ID/name,
  на которые реально опирается расширение, сохраняются или проверенно адаптируются.
- Выявленная несовместимость имеет узкую область и доказательство. Полный отказ от нового
  каркаса под формулировкой «v7 требует» не закрывает этап.

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
модуля (тот же `delete()`, с предложением экспорта, этап 20). Консоль архива релиза 8.4.0 не подключает
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
| `modules/ModernUI/models/Tokens.php`, `actions/Tokens.php` | токены оформления из действующих настроек (повторная валидация, вычисление `primary-strong`/`hover`/`soft`, плотность), таблица стилей `html:root:not(.mu-off){--mu-…}` для третьей ссылки `HEADERCSS`; та же карта — в `Bootstrap` (`appearance.tokens`) | 04 |
| `modules/ModernUI/models/Page.php` | общие части своих страниц: язык темы, плагин Smarty `{mu_t}`, сообщения форм, JSON-ответ | 02 |
| `modules/ModernUI/actions/Preferences.php`, `views/Preferences.php` | личные настройки (`mode=save|clear`) и страница предпочтений без JS | 02 (редактор — 05) |
| `modules/Settings/ModernUI/views/Index.php` | страница настроек администратора: состояние, включение, восстановление, проверка frontend | 02 (редактор — 05) |
| `modules/Settings/ModernUI/actions/{Toggle,Recovery}.php` | включение для себя/выключение, пилот по пользователю и роли (режимы `pilotAddUser`, `pilotRemoveUser`, `pilotAddRole`, `pilotRemoveRole`), повтор миграций и ссылок (HTML-формы) | 02, пилот — 03 |
| `modules/ModernUI/models/Pilot.php` | кто может войти в пилот (активные пользователи, существующие роли) и подписи для страницы настроек; только чтение таблиц CRM | 03 |
| `modules/Settings/ModernUI/actions/{Data,Save,Logo,Transfer}.php` | данные редактора (GET); сохранение области, предпросмотр меню, удаление профиля роли, сброс личных настроек пользователя; загрузка логотипа; экспорт/предпросмотр/применение JSON (`settings.md` §13) | 05 |
| `modules/Settings/ModernUI/actions/Uninstall.php` | удаление из интерфейса | 10 |
| `modules/ModernUI/models/Menu.php` | итоговое меню пользователя из разрешённых модулей: кандидаты по правам Vtiger, чистая сборка `assemble()`, каталог редактора | 05 |
| `modules/ModernUI/models/Adapters.php` | реестр адаптеров публичных расширений: наличие и активность модуля, проверенный диапазон версии, файлы и таблицы расширения, выключатель администратора; стили активных адаптеров для таблицы токенов, данные для `Bootstrap` и редактора, правила экранов (§7.6) | 08 |
| `modules/ModernUI/models/Editor.php`, `Transfer.php`, `Branding.php` | данные и сохранение редактора (ревизии, проверка пилота и ролей, конфликты); экспорт/импорт без числовых id; логотип (GD → PNG в `test/logo/`) и название | 05 |
| `modules/ModernUI/views/Record.php`, `layouts/v7/modules/ModernUI/Record.tpl` | штатные права и полный Detail текущего entity module в собственной оболочке поверх списка (§7.10); поля и сохранения принадлежат CRM | 13 |

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
| tokens | CSS-переменные действующих цветов, плотности и размера текста пользователя | значения по умолчанию — в skin; действующие — таблица стилей `action=Tokens` (вторая ссылка `HEADERCSS`, в `<head>` вместе со skin) и те же значения inline на `<html>` от shell по ответу `Bootstrap` (см. ниже) | селектор `html:root:not(.mu-off)` |
| shell | Vue-острова: мега-меню, полоса избранного, системные пункты темы, острова на экранах | `HEADERSCRIPT` → `loader.js` → `dist/assets/shell-<hash>.js` (ES module) | класс `mu-shell-ready` на `<html>` после монтирования |
| страницы модуля | приложения настроек и предпочтений | теги из manifest в собственных `.tpl` (PHP `ModernUI_Assets`) | собственная страница |

Слой skin не прячет и не перемещает элементы — только меняет вид, поэтому его работа без JS
безопасна. Всё, что скрывает элементы v7 (например, кнопку меню приложений, заменённую навигацией
темы), действует только под `html.mu-shell-ready`. Сбой загрузки JS оставляет переоформленный, но
полностью рабочий v7.

С этапа 08 та же таблица несёт и стили адаптеров активных публичных расширений (§7.6).

Цвета, плотность и размер текста, заданные администратором/ролью/пользователем (этап 04, решение A11): skin
объявляет все токены `--mu-*` со значениями по умолчанию на `:root:not(.mu-off)`; действующие значения приходят
таблицей стилей `index.php?module=ModernUI&action=Tokens&r=<ключ настроек>&z=` — третьей ссылкой `HEADERCSS` с
тем же обработчиком (проверка `file_exists('index.php')` в `Header.php` проходит). Правило одно:
`html:root:not(.mu-off){--mu-…}` — специфичнее значений skin, поэтому порядок ссылок не важен, а «Стандартный вид»
(`html.mu-off`) выключает и его. Ключ (12 символов sha1 от пользователя, роли, источника ролевых настроек, ревизий
областей, версии схемы и id сборки) меняется при любом сохранении настроек, смене роли или обновлении модуля; при
совпадении ключа ответ `Cache-Control: private, max-age=31536000, immutable`, при несовпадении (старая страница) —
текущие значения с `no-store`; без активной темы — пустая таблица стилей. Заголовки сессии (`Pragma`, `Expires`)
снимаются. Значения проходят повторную валидацию (`ModernUI_Tokens_Model`: только `#rrggbb`, перечисления и
фиксированные строки; иначе — значения по умолчанию), та же карта приходит в `Bootstrap` (`appearance.tokens`), shell
проверяет её по шаблону каждого токена и ставит inline на `<html>` — страница верна и при сбое таблицы стилей
токенов. Для предпросмотра (этап 05) `frontend/src/boot/tokens.ts` вычисляет ту же карту в браузере; совпадение PHP и
TypeScript проверяет общий набор `tests/fixtures/tokens.json`.

Замер, по которому выбран этот вариант (этап 04, dev-стенд и чистый стенд, администратор, список организаций, по 5
загрузок): прежний вариант А (кэш `localStorage` у загрузчика) при промахе кэша показывал значения по умолчанию
10–20 мс после первой отрисовки без задержек сети и 100–230 мс при RTT 100 мс (FCP 156–260 мс, токены — 383–511 мс);
при попадании в кэш токены стояли до первой отрисовки. Промах случается на первой странице после каждого изменения
настроек, после каждого обновления модуля (id сборки в ключе) и на каждой странице при заблокированном
`localStorage`; смена плотности при этом сдвигает макет. Вариант Б стоит один запрос на ключ настроек (дальше — кэш
браузера, `transferSize = 0`, проверено e2e) и не даёт ни мигания, ни сдвига: e2e проверяет, что при
заблокированном shell личные «компактная плотность» и «110 %» уже действуют с первой отрисовки.

### 5.2. Сборка (этап 02)

- `frontend/` — Vite 8 + Vue 3.5, TypeScript в строгом режиме (`dependencies.md` §5), `@vitejs/plugin-vue`; entries: `shell` (`src/shell/main.ts`),
  `settings` (`src/settings/main.ts`), `preferences` (`src/preferences/main.ts`, этап 05), `skin` (`src/skin/skin.scss`).
  Этап 05: код, общий для `settings` и `preferences` (редакторы, их словари `i18n/locales/editor/*`, перетаскивание),
  выделен группой `editor` с приоритетом выше `common`: shell на страницах CRM не загружает ни кода, ни текстов
  редакторов (после разделения `common` — 33 КБ gzip вместо 86 КБ). Код нескольких entries (Vue, vue-i18n, базовые
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

1. `document.currentScript.src` → каталог ресурсов модуля и `b` (id сборки); повторный загрузчик на той же странице
   (`html[data-mu-build]` уже стоит) ничего не делает;
2. если нет поддержки `type=module` или включён `modernui=off` — выход;
3. ставит `html.mu-pending` (резерв высоты полосы избранного, без скрытия элементов v7);
4. `XMLHttpRequest GET dist/manifest.json?b=<b>` (кэшируется браузером по уникальному URL);
5. вставляет `<link rel=stylesheet>` CSS entry `shell` и `<script type="module">` entry;
6. сторожевой таймер 15 с: если entry не сообщил `mu:ready`, снимает `mu-pending`, ставит
   `data-mu-failed`; ошибки — в консоль с префиксом `[ModernUI]`, без `alert`.

Entry `shell` ставит `html[data-mu-runtime]` (вторая копия entry, например `import()` с другим фрагментом URL, не
запускает второй shell), ждёт `jQuery(ready)`, проверяет `Bootstrap`, ставит токены, определяет уровень страницы
(`html[data-mu-level]`: `islands` — узнан макет v7: `#page`, `nav.app-fixed-navbar #navbar`, `_META`, `app`; `skin` —
незнакомая оболочка, только таблицы стилей), на уровне `islands` запускает runtime островов (§7.3) и ставит
`mu-shell-ready`, затем сообщает `mu:ready`. Любое исключение → остановить runtime, размонтировать созданное, снять
маркеры, оставить v7 со skin. Кэша токенов в `localStorage` у загрузчика больше нет (A11), параметр `r` из URL
загрузчика убран.

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
| шапка v7 `nav.app-fixed-navbar`, `#navbar`, `.global-actions`, поиск, заголовок модуля `.module-action-bar` | v7 + расширения | CSS, в том числе новая компоновка тех же узлов (этап 11, §7.8: `display: contents`, порядок, позиционирование); вставка собственного контейнера рядом (не внутрь чужих `ul`); свой атрибут `data-mu-initials` на ссылке пользователя (снимается вместе с темой) |
| меню приложений `#app-menu`, `#appnavigator`, `#modules-menu` | v7 | CSS; скрытие кнопки `#appnavigator` — только под `mu-shell-ready` и только если адаптер не нашёл в меню чужих элементов (§7.1); полоса модулей `#modnavigator` скрыта правилами первой отрисовки, пока shell может работать, и возвращается при элементе без ссылки (§7.8) |
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

Исходное поведение 01–08; ограничения положения/геометрии заменены A14 для этапов 09–21.

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

Исходный CSS-подход до 08. Целевой overlay и компоновка — A14; ниже сохраняется перечень рисков
совместимости, но «только CSS» больше не является запретом проверенных адаптеров.

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

### 7.3. Перерисовка и жизненный цикл островов (реализовано на этапе 04)

`IslandRuntime` (`frontend/src/boot/runtime.ts`), одно на страницу. Определение острова:
`{ id, place(), create(scope), replaces? }`.

- `place()` — проверка возможностей экрана и точка вставки: новый контейнер темы (`insert`, удаляется при
  размонтировании) или контейнер, напечатанный сервером (`existing`, страницы модуля). `null` — экран не даёт
  точки, остров пропускается, экран остаётся таким, как его рисует v7. Исключение в проверке — остров помечается
  сломанным и больше не пробуется.
- Старт идемпотентен: повторный `start()` и повторная регистрация того же `id` ничего не делают; в контейнер, где уже
  есть приложение Vue, второе не монтируется.
- `scope` острова: `listen()` (addEventListener), `onAppEvent()` (`app.event` v7 — подписка и снятие именно этого
  обработчика, никогда `app.event.off(name)`), `timeout()`, `interval()`, `observe()`, `onDispose()`; всё
  освобождается при размонтировании — повторные монтирования не плодят обработчики (unit-тесты и e2e).
- Перерисовка: один `MutationObserver` на `body` (`childList`, `subtree`); его обратный вызов только помечает
  состояние, проверка выполняется не чаще раза в кадр (`requestAnimationFrame`) и смотрит лишь зарегистрированные
  острова: контейнер ушёл из документа → размонтировать; точка вставки появилась → смонтировать. Документ не
  сканируется, таймеров опроса нет. После `pageshow` из bfcache — та же проверка.
- Предел: остров монтируется на странице не больше `MOUNT_LIMIT = 5` раз; контейнер, который кто-то постоянно
  удаляет, перестаёт возвращаться (предупреждение `[ModernUI]` в консоли), v7 продолжает работать.
- Замена элемента v7: `replaces` добавляет токен в `html[data-mu-replaced]` только после успешного монтирования и
  снимает его при размонтировании до удаления контейнера — CSS скрывает оригинал только под этим токеном, поэтому
  момента «нет ни оригинала, ни замены» не бывает (этапы 05–06 используют это для меню приложений).
- Исключение при создании/монтировании острова — остров размонтирован, его контейнер и токены удалены, остальные
  острова и v7 не затронуты. `html[data-mu-islands]` — список смонтированных островов (диагностика и e2e).

Старт shell ждёт очереди `ready` jQuery (после контроллера v7). jQuery 1.x v7 останавливает всю очередь на первом исключении
обработчика страницы (так ведут себя некоторые экраны v7, открытые по прямому адресу, например импорт без оверлея): с этапа 08 shell
стартует и после события `load`, если его обработчик `ready` так и не вызван (`hostReady()`, unit-тест), — острова живут в своих
контейнерах и от контроллера страницы не зависят. Раньше такой экран оставался без оболочки (сторож загрузчика, `data-mu-failed=timeout`).

Проверено на dev-стенде (e2e `modernui`): PJAX-перезагрузка списка поиском v7 (`app.request.pjax`) не трогает острова,
удалённый контейнер возвращается один раз, второй загрузчик и вторая копия entry не дают второго острова, второго
`#mu-overlay-root` и второго меню по одному щелчку.

**Реализовано на этапе 06** (`frontend/src/adapters/v7/appMenu.ts`, `shell/boot.ts`): адаптер собирает из `#app-menu` все
ссылки (`a[href]` и `data-default-url`, кроме `#`) и сравнивает их с меню темы. Покрыты: модули из `menu.modules` (`Bootstrap`:
все модули, которые пользователь может открыть, включая скрытые в меню темы — иначе скрытие возвращалось бы через «Ещё»), для
администратора — «Настройки CRM» и «Пользователи» (системный раздел), страницы ModernUI. Остальные ссылки (магазин расширений
ядра, пункты расширений) — раздел «Ещё» мега-меню с подписью, которую показывает v7. С этапа 08 «покрыта» только ссылка на модуль из меню темы в
его представлении по умолчанию (`List`, `Index`, `DashBoard`, `Calendar` или точный адрес по умолчанию из `Bootstrap.menu.entries`)
без лишних параметров: другие представления того же модуля (общий календарь и список задач в полосе календаря v7, фильтр списка)
темой не покрыты — полоса v7 остаётся (раньше полоса модулей темы заменяла полосу видов календаря, и два вида пропадали).
Интерактивный элемент без ссылки
(`button`, `[onclick]`, `a` с `#`/`javascript:`) кроме разметки приложений v7 — замена не включается (`replaces` острова решает в
момент монтирования, runtime этапа 06), кнопка v7 видима, в консоли — `[ModernUI]`. `MutationObserver` острова на `#app-menu`
пересчитывает это при поздних вставках (`setReplaced()`). Тот же разбор у полосы модулей `#modnavigator`: любой пункт, который
меню темы не покрывает, — полоса v7 остаётся. Пункт «Новый интерфейс» в меню пользователя v7 (п. 5) не вводился: вход в
предпочтения — из системного меню, мега-меню и полосы избранного.

### 7.4. Острова этапа 05

- `navigation` — кнопка «Модули» (`LayoutGrid`) в собственном контейнере `#navbar`, левее системного меню; немодальный
  popover в `#mu-overlay-root` с меню пользователя из `Bootstrap` (`src/menu/MenuPanel.vue`: избранное, в компактном
  режиме только значками с `aria-label`, группы и пункты). Меню приложений v7 не скрывается и не заменяется — это этап
  06 (мега-меню, полоса избранного, поиск модулей); данные и настройки меню те же.
- `brand` — свой логотип и/или название темы внутри ссылки логотипа шапки v7 (после её изображения); `replaces: 'logo'`
  только при своём логотипе — изображение v7 скрывается правилом под `html[data-mu-replaced~="logo"]`. Без своих
  логотипа и названия остров не регистрируется.
- Страницы модуля: редактор настроек (`[data-mu-root="settings-editor"]`) и редактор предпочтений
  (`[data-mu-root="preferences-editor"]`) — существующие контейнеры серверных шаблонов; при монтировании скрывают
  серверные формы с `data-mu-fallback`; оверлеи (диалоги) — в `#mu-overlay-root`, который страница создаёт сама
  (`boot/overlay.ts`), если shell не активен.

### 7.5. Оболочка навигации (этап 06)

Остров `module-rail`, место системного меню в полосе избранного и геометрия шапки 42 + 42 px заменены этапом 11 (§7.8); ниже —
история реализации 06.

Острова shell на экранах v7 (`frontend/src/shell/boot.ts`): `system-menu` (этап 02), `mega-menu`, `favorites`, `module-rail`,
`brand` (этап 05). Остров `navigation` этапа 05 (кнопка «Модули» с popover) заменён мега-меню.

| Остров | Точка вставки (свой контейнер) | Замена v7 (`data-mu-replaced`) |
|---|---|---|
| `mega-menu` | перед `#appnavigator` в его строке шапки; без него — в `#navbar` рядом с системным меню | `app-menu` — скрывает `#appnavigator`, если меню v7 без чужих кнопок |
| `favorites` | первый узел `#page > nav.app-fixed-navbar` | — (своё место, зарезервированное skin) |
| `module-rail` | первый узел `#modnavigator`, классы `hidden-xs hidden-sm` | `module-rail` — скрывает `.mod-switcher-container` v7 |
| `system-menu` | при полосе избранного — последний узел `#page > nav.app-fixed-navbar` (`position: fixed`, правый край полосы); без неё — первый узел `#navbar`, высота 42 px, на 768–991 px скрыт при смонтированном мега-меню (те же пункты в его колонке «Сервис и настройки») | — |

Геометрия полосы избранного (`frontend/src/skin/_shell.scss`, `design.md` §10): переменная `--mu-favorites-bar` приходит
таблицей токенов (`ModernUI_Tokens_Model::layout()`; не входит в карту `appearance.tokens`), skin при
`@media (scripting: enabled)` и без `data-mu-failed`/`data-mu-level=skin`/`mu-off` превращает её в `--mu-shell-bar`:
`padding-top` шапки, блок `#page:has(> nav.app-fixed-navbar)::before`, `top` фиксированных слоёв v7 под шапкой
(`#overlayPage` 86 px, `.overlayPageContent.fade.in` 83 px, `#helpMeNow` 100 px — значения skin v7), `min-height`
`.main-container`. Отступ `#page` v7 (84 px) не переопределяется — сдвиг аддитивный. Те же правила включены в CSS shell.

Контекст страницы — `_META` (`module`, `view`, `parent`, `app`; у `app` бывает ведущий пробел) с запасным разбором URL; раздел
страницы — группа с `app` приложения v7 из URL и модулем, затем любая группа с модулем, затем группа приложения (`Bootstrap`
отдаёт `app` у групп). Все пункты — ссылки `index.php?…` относительно `document.baseURI` (подкаталог установки работает), без
`preventDefault` и без своего роутера: новая вкладка, история, обновление и прямые ссылки — как в v7. При `pagehide` мега-меню
закрывается (страница из bfcache не возвращается с открытой панелью).

Сборка (этап 06): группа chunk'ов `editor` — `includeDependenciesRecursively: false`. Раньше она забирала и зависимости
редакторов (Vue, Reka, значки), `common` импортировал `editor`, и shell на каждой странице CRM грузил код редакторов (85 КБ
gzip лишнего); теперь `shell` импортирует только `common`.

### 7.6. Адаптеры публичных расширений (этап 08)

Адаптер — часть ModernUI, которая знает одно публичное расширение: стили для его собственной разметки, при необходимости клиентская
часть и правила его экранов. Файлы расширения не меняются и не копируются. Особенности конкретной CRM (её модули, поля, роли) —
не адаптеры пакета: они живут в отдельном необязательном профиле этой CRM (настройки ModernUI для роли/экранов, импортируемые как
JSON, либо отдельный пакет), описание — вне репозитория.

**Реестр** — `ModernUI_Adapters_Model::registry()`: `module` (имя в `vtiger_tab`), `title`, `vendor`, `versions` (`min`, `below` —
проверенный диапазон `vtiger_tab.version`), `files`, `tables` и `fields` (`{module, field}` в `vtiger_field`) расширения, на которые адаптер опирается (классы — по их файлам, без загрузки), `style`, `script`,
`screens` (`{module, view, parent, level}`, `level` — `skin` или `standard`). Статус на каждом запросе (кэш на запрос, один
`SELECT name, presence, version FROM vtiger_tab WHERE name IN (…)`):

| Статус | Когда | Что на странице |
|---|---|---|
| `active` | модуль установлен и активен (`presence` 0 или 2, как `vtlib_isModuleActive`), версия в диапазоне, файлы и таблицы на месте, администратор не выключил | стили адаптера, клиентская часть, правила экранов |
| `disabled` | выключен администратором (`adapters.disabled`, `settings.md` §4) | ничего от адаптера, общий skin |
| `notInstalled` / `inactive` / `version` / `incomplete` | модуля нет / выключен в менеджере модулей / версия вне диапазона или нечисловая / нет файла (класса), таблицы или поля | ничего от адаптера, общий skin |
| `error` | исключение при проверке (сбой запроса к базе) | все адаптеры выключены на этот запрос, страница работает |

**Доставка.** Стиль адаптера — отдельная точка входа сборки (`frontend/src/adapters/ext/<id>/style.scss` → `assets/adapter-<id>-*.css`,
ключ в manifest). Сервер дописывает стили активных адаптеров в таблицу стилей токенов (`action=Tokens`, §5.1): она уже
блокирует отрисовку и кэшируется по ключу, поэтому стили расширения действуют с первой отрисовки без лишнего запроса, а без
расширения на страницу не попадают вовсе. Ключ кэша (`ModernUI_Activation_Model::context()`) включает набор активных адаптеров с
версиями — включение, выключение или обновление расширения меняет URL таблицы. Селекторы стиля — по собственной разметке
расширения (неявная проверка DOM): изменившаяся разметка просто не совпадает, остаётся общий skin.

**Клиентская часть** (`frontend/src/adapters/ext/<id>/index.ts`, интерфейс `ExtensionAdapter`: `supports(context)` — проверка
DOM-возможностей страницы, `start(scope, context)`) — отдельный chunk, shell импортирует его, только если `Bootstrap.adapters[]`
перечисляет адаптер с `script: true` (`frontend/src/boot/adapters.ts`, реестр загрузчиков `frontend/src/adapters/ext/index.ts`).
Каждая часть работает в своей области подписок (`createScope`), её исключение останавливает только её (предупреждение в консоли);
`html[data-mu-adapters]` перечисляет запущенные. Teardown «Стандартного вида» и сбой shell останавливают адаптеры.

**Правила экранов.** `standard` — сервер не выводит тему на экране (как исключение экрана администратором, причина
`MU_SCREEN_EXCLUDED`); `skin` — shell не монтирует острова, остаётся стиль (`data-mu-level="skin"`). Правило действует, только пока
адаптер активен.

**Адаптеры версии 0.6.0.** `pdfmaker` — IT-Solutions4You PDF Maker 4.x (`modules/PDFMaker/PDFMaker.php`,
`layouts/v7/modules/PDFMaker/Edit.tpl`, таблица `vtiger_pdfmaker`): в редакторе шаблона восемь вкладок при 14 px темы занимали две
строки — адаптер возвращает им 12 px v7. Прочие публичные расширения dev-стенда работают с общим skin (`compatibility.md` §5, §8);
адаптер добавляется только под найденное проверкой отличие.

### 7.7. Новая компоновка: без постоянной полосы, запись поверх списка (этап 09, решение A15)

Прототип узкий: список **Accounts** при `layout.modules = ["Accounts"]` (ключ общих и ролевых настроек, по умолчанию пусто,
`settings.md` §4). Он — основа этапов 11–14, а не отдельная демонстрация: те же точки интеграции расширяются на остальные модули.

**Проверенные точки интеграции (тег 8.4.0 и dev-стенд).**

| Точка | Где в 8.4.0 | Что важно | Вывод |
|---|---|---|---|
| Шапка/полоса модулей | `ListViewPreProcess.tpl`: `.main-container.main-container-<M>` > `#modnavigator.module-nav` (42 px, `absolute`), `#sidebar-essentials` (`left: 42px`, 240 px), `#listViewContent.listViewPageDiv.content-area` (`padding-left: 283px`, `.full-width` — 42 px) | v7 сам убирает полосу у Documents/Reports (`.main-container-Documents .module-nav { width: 0 }`) | полоса скрывается правилами первой отрисовки по тому же образцу; функции — в мега-меню (§7.5), непокрытые пункты возвращают полосу |
| Фильтр/страница/поиск списка | `List.js`: `loadListViewRecords()` (pjax/`ListAjax`), состояние — в DOM (`#pageNumber`, `#currentSearchParams`) и в сессии `ListViewSession` | страница списка не перезагружается, пока запись открыта | возврат = тот же DOM; после сохранения — `loadListViewRecords()` самого v7 |
| Открытие записи из списка | `List.js:1058` `registerRowClickEvent`: щелчок строки → через 300 мс `window.location.href = data-recordurl` (кроме первого столбца, флажка, выделенного текста, строки в inline-правке); ссылка в строке → через 500 мс `window.location = href`; двойной щелчок — inline-правка строки (`registerRowDoubleClickEvent`, сбрасывает таймеры ссылок) | решение «открывать ли» принимает v7 и его расширения | перехватывается не щелчок, а сама навигация (Navigation API `navigate`, `cancelable`) — условия v7 не дублируются |
| Штатный quick view / overlay | `Detail.php:332` `displayMode=overlay` → `OverlayDetailView.tpl` (заголовок `DetailViewHeaderTitle`, `DetailViewFullContents`, `#recordId`, `related_uimeta`); `Edit.php:168` → `OverlayEditView.tpl` (`form#EditView`, `action=Save`); `Detail.js:2533–2655` (`registerRelatedRowClickEvent`, `showOverlayEditView`), `helper.js:359` `loadPageContentOverlay` (Bootstrap-модалка `#overlayPageContent`) | ядро уже показывает запись связанного списка поверх карточки этим механизмом; quick preview списка (`showQuickPreviewForId`) — боковая сводка без полей и правки | основа записи поверх списка — overlay-виды ядра; на странице списка нет `Vtiger_Detail_Js`/`Vtiger_RelatedList_Js` — shell подключает **те же файлы ядра** по их пути в layout |
| Detail/Edit-обработчики | `Vtiger_Detail_Js.registerBasicEvents()` (inline-правка, блоки, ссылки, зависимости), `registerOverlayEditEvents()` → `Vtiger_Edit_Js.registerEvents(false)` (валидация `vtValidate`, `registerPageLeaveEvents`), событие `post.overLayEditView.loaded` | хвост ядра после сохранения связанной записи (`registerRelatedRecordSave`) перезагружает связанный список родителя и добавляет обработчик шины на каждое открытие | shell вызывает функции ядра в том же порядке, кроме хвоста сохранения: отправку формы, которую пропустили v7/расширения, перехватывает навигация с `formData` и отправляет **тот же `FormData`** в тот же `action=Save` (`app.request.post`) |
| AJAX, CSRF | `app.request` (jQuery.ajax, csrf-magic), для AJAX переписывание формы токеном выключено | расширения пересканируют страницу на `ajaxComplete` | содержимое v7 запрашивается через `app.request` (как v7), к `FormData` добавляется `__vtrftk` |
| Модальные и фокус | Bootstrap 3 `.modal` 1100; `application.js` переопределяет `enforceFocus` и на каждый показ вешает `focusin.modal` на `document` без снятия; `helper.registerModalDismissWithoutSubmit` вешает обработчики на все `.modal .close, .modal .cancelLink` при каждом старте формы | вложенный popup ссылочного поля — отдельная `.modal` поверх | обработчики, добавленные стартом вида ядра к постоянным элементам (шина, overlay, документ, окно, кнопки модалок), и `focusin` показа снимаются при уходе вида; `window.onbeforeunload` формы восстанавливается |
| Делегированные события и teardown | `hidden.bs.modal` вложенной модалки всплывает до `#overlayPageContent` | — | реакция только на событие самого overlay; область подписок (`createScope`) снимается «Стандартным видом» и сбоем shell |

**Сравнённые варианты.**

| Вариант | Результат проверки | Решение |
|---|---|---|
| CSS-перестройка полной страницы карточки (`view=Detail`) «под окно» | список под окном отсутствует — пришлось бы рисовать его копию (изображение подложки) или терять фильтр/страницу/прокрутку; Back перезагружает список | отклонён для открытия из списка; полная страница остаётся прямой ссылкой (V06) и получит ту же внутреннюю компоновку на 13 |
| Адаптер исходных узлов: загрузить полную страницу записи и перенести её узлы в окно | скрипты расширений карточки стартуют по `_META.view == 'Detail'` на `ready` и на странице списка не запустятся; два контроллера v7 на странице | отклонён |
| iframe | csrf-magic frame-breaker уводит страницу наверх (§3.9), запрещён `COMMON.md` | отклонён |
| Своя форма/CRUD | нарушает `COMMON.md` | отклонён |
| **Overlay-виды ядра + перехват навигации** | работает на dev-стенде и чистой 8.4 (PHP 8.1/8.5) из ZIP; обработчики, валидация, сохранение, расширения форм (`post.overLayEditView.loaded`) — ядра | **выбран (A15)** |

**Устройство** (`frontend/src/record/overlay.ts`, `target.ts`, `frontend/src/adapters/v7/record.ts`, правила полосы — до этапа 11 `ModernUI_Tokens_Model::layoutCss()`, с 11 — skin §7.8,
стили окна — `frontend/src/skin/_layout.scss`):

1. (Этап 09.) Таблица токенов печатала для модулей `layout.modules` правила списка без полосы модулей; с этапа 11 полосы нет на
   всех рабочих экранах (§7.8), `layoutCss()` удалён, `layout.modules` определяет только открытие записи поверх списка.
2. `navigate` с `navigationType` push/replace к `index.php?module=<M>&view=Detail&record=<id>` (допустим только `app`), где
   `<id>` — строка текущего списка: `preventDefault()`, сброс таймеров ссылок строки так же, как это делает v7 при двойном
   щелчке, загрузка `Detail.js`/`RelatedList.js` ядра (один раз), `app.request.get(displayMode=overlay)`,
   `app.helper.loadPageContentOverlay(…, {backdrop: 'static', keyboard: false})`, старт `Vtiger_Detail_Js` в overlay-режиме,
   событие `post.overlay.load`. Пока запись грузится, следующая такая навигация гасится (открывается первая).
3. История: открытие — `pushState` с тем же URL и ключом `muRecord`; Back закрывает, Forward открывает снова; при
   `reload`/`back_forward` страницы списка с этим ключом запись открывается опять (контекст восстановлен), обычный переход на
   список — без неё. Адрес страницы не меняется, как в облаке; кнопка ядра «(Просмотр)/Details» ведёт на полную страницу записи.
4. Правка: кнопка ядра `Изменить` → `OverlayEditView` (тот же URL правки + `displayMode=overlay`), `registerOverlayEditEvents()`
   ядра, `post.overLayEditView.loaded`. Валидация, вопрос о несохранённых изменениях, «Отмена» и крестик — v7. Отправка формы
   (событием `submit` или `form.submit()` расширения) — навигация с `formData`: она отменяется, тот же `FormData` (+ CSRF)
   уходит в `action=Save` через native `jQuery.ajax` (с этапа 14 — с чтением фактического URL redirect); успех → индикатор v7 скрыт, запись показана заново, список помечен
   изменённым; ошибка → `post.save.failed`, кнопка «Сохранить» снова доступна. Сохранение поля inline (`PostAjaxSaveEvent`)
   тоже помечает список.
5. Закрытие (Escape без вложенного popup, Back, крестик ядра, «Стандартный вид»): снятие добавленных обработчиков, возврат
   `onbeforeunload`, прокрутка окна и таблицы, фокус на ссылке строки; если список изменён — `loadListViewRecords()` v7
   (та же страница, фильтр, поиск, сортировка).
6. Отказ: нет Navigation API — ничего не перехватывается (v7 открывает полную страницу); ошибка скрипта/запроса/обработчика —
   уведомление RU/EN/DE и полная страница записи; сбой shell или «Стандартный вид» — область подписок снимается.

**Проверено** (`frontend/e2e/layout.spec.ts`, `task test:layout`, dev-стенд DEV и PACKAGE, чистый стенд `c81`/`c85` из ZIP —
`verification.md` §3): полоса скрыта с первой отрисовки и есть у Contacts; запись поверх списка без загрузки страницы,
Escape/Back/Forward/крестик, фокус, тот же список/страница/поиск/прокрутка; две строки подряд — один запрос; двойной щелчок —
inline-правка v7; перезагрузка списка AJAX (страница 2 / сортировка); прямая ссылка: те же действия заголовка с темой и без,
«(Просмотр)» → полная страница, Back → снова запись поверх списка; правка: валидация v7 без запроса, вопрос v7 и отмена,
вложенный popup ссылочного поля поверх окна (если есть в форме), одно сохранение с полями overlay-формы, новое значение в
списке и на сервере; отказ overlay-запроса и отсутствие Navigation API → полная страница; обработчики после трёх циклов не
копятся (на dev-стенде растёт только подписчик расширения на `post.overLayEditView.loaded` — на +1 за каждый AJAX-запрос v7,
как и без темы).

**Ограничения прототипа → этапы.** В заголовке overlay-вида ядра только «(Просмотр)» и «Изменить» — кнопки расширений
(PDF и др.) доступны на полной странице в один щелчок; перенос действий `DETAILVIEWBASIC/DETAILVIEW` в окно — 13. Нет вкладок
Summary/Details/связей (кандидат — `mode=showModuleSummaryView` и связанные вкладки ядра в том же окне) — 13. В overlay-форме
нет скрытого поля `mode` полной формы (значение пустое, `Save` его не читает) и секционной навигации — 14. Скрипты расширений,
стартующие только на `view=Edit`/`Detail` по `ready`, на overlay не действуют — для таких модулей `layout.modules` не включается
(правило экрана, как у адаптеров §7.6). Браузеры без Navigation API получают полную страницу.

### 7.8. Облачная шапка и навигация (этап 11)

Цель — V01/V02 (`design.md` §13.7): одна основная строка 56 px вместо двух строк v7, полоса инструментов страницы, никакой
постоянной полосы модулей. Механизм этапа 09 (правила первой отрисовки + штатные механизмы v7) применён к шапке: **узлы v7 не
переносятся и не клонируются**, их раскладывает CSS skin (`frontend/src/skin/_shell.scss`, `_header.scss`), острова и адаптер
добавляют только своё.

| Часть | Как | Почему так |
|---|---|---|
| Основная строка | `.global-nav > .row` — flex-строка; обёртки без своего вида (`.app-navigator-container`, `#navbar`, `#navbar > ul.nav`) — `display: contents`, их дети — элементы строки; `order`: кнопка меню, поиск, значки v7 и расширений (порядок v7), системное меню, логотип, пользователь | расширения продолжают вставлять в `#navbar ul.nav.navbar-nav` / `.global-nav .navbar-nav` (CTMobile, Umnico, VDWhatsapp `li:eq(0)`, ITS4YouInstaller `prepend`): их элементы сразу попадают в строку; проверок `:visible` этих обёрток в ядре и расширениях стенда нет (поиск по коду) |
| Название модуля | первый столбец `.module-action-content` (хлебные крошки v7) позиционирован в основную строку (x 68); продолжение крошек скрыто вне «Настроек» | заголовок рисует сервер с первой отрисовки; `ListSidebar.js` и `Documents/List.js` продолжают обновлять скрытое имя фильтра |
| Полоса инструментов | `.module-action-bar` — абсолютно под шапкой (52 px, фон страницы), действия `#appnav` справа | `#appnav` остаётся на месте: кнопки расширений (QuotingTool `#appnav ul.nav`) и выпадающее «Изменить» работают; `helper._initNotificationDefaults` читает `.module-action-bar` — уведомления v7 ставятся под полосу правилом skin |
| Резерв места | `#page { padding-top }` = избранное − 2 + 56 + полоса инструментов; полоса — по `:has()` наличия кнопки в заголовке модуля или контекстной навигации; слот системного меню до его монтирования — псевдоэлемент `#navbar::before` | ни строка, ни содержимое не сдвигаются, когда shell монтирует кнопку меню, системное меню и контекстную навигацию (e2e: те же координаты до и после старта shell) |
| Без полосы модулей | `#modnavigator:has(> .mod-switcher-container)` скрыт, отступы v7 под неё обнулены (боковая панель, содержимое списков, записи и формы, `.overlay-container-60`, `.modal-overlay-footer`); `.settingsNav` и меню «Моих настроек» не затрагиваются | модули — в мега-меню и избранном; полоса возвращается (`html[data-mu-keep-rail]`), если в ней элемент без ссылки |
| Контекстная навигация | остров `context-nav` (`ContextNav.vue`) — свой контейнер в фиксированной шапке, слева в полосе инструментов; пункты — `contextEntries()` (`adapters/v7/appMenu.ts`): виды модуля страницы, если их в полосе v7 больше одного (календарь), и ссылки, которых нет в меню темы | обычные ссылки v7 с теми же `href`, текущий вид — по `li.active` v7 |
| Поиск | поле v7 (`.keyword-input`, `#adv-search`) — кнопка 34 px, раскрывается до 500 px при фокусе или тексте; `Escape` снимает фокус (адаптер) | Enter и расширенный поиск — обработчики v7 (тот же запрос `Vtiger/ListAjax/searchAll`, e2e); анимация ширины убрана — во время неё Chrome вставлял символы в начало поля |
| Аватар и меню пользователя | `a.userName` — круг 36 px; инициалы — `data-mu-initials` от `_USERMETA.userlabel` (адаптер `adapters/v7/header.ts`); `.logout-content` — панель облака | ссылки «Мои настройки» и «Выход» — v7 |
| Место названия | адаптер измеряет левую границу действий (`ResizeObserver` строки, `MutationObserver` `#navbar`) и задаёт `--mu-shell-actions`: название кончается раньше значков, в том числе вставленных позже | без JS — 50 % ширины |
| Узкие экраны | < 768: строка v7 в одну линию (кнопка меню, логотип, переключатели `.navbar-toggle` v7), панели переключателей раскрываются под строкой; название — в полосе инструментов | все действия v7 остаются за его же переключателями |

Затвор у всех правил тот же, что у полосы избранного: `@media screen and (scripting: enabled)` и `html:not(.mu-off):not([data-mu-failed])
:not([data-mu-level="skin"])`. Без скриптов, после сбоя shell, на незнакомой странице, в «Стандартном виде» и при печати —
шапка v7 в две строки и полоса модулей (e2e `modernui`: сбой, без JS, стандартный вид). Остров `module-rail` и `ModuleRail.vue`
удалены; системное меню — всегда в `#navbar` (раньше — в правом краю полосы избранного).

### 7.9. Списки в облачной компоновке (этап 12)

`skin/_cloud-lists.scss` раскладывает исходные `#listViewContent`, `#listview-actions`, `#appnav` и
`#sidebar-essentials`. Каркас распознаётся по DOM и доступному загрузчику с первой отрисовки; без JavaScript,
при `mu-off`, ошибке загрузки и уровне `skin` остаётся исходный интерфейс. `adapters/v7/lists.ts` создаёт
только кнопки раскрытия: представление/фильтры, поиск по колонкам и вторую половину «Добавить» для импорта.
Существующие узлы, их предки, обработчики, ID и параметры списка не меняются. Состояние фильтра, сортировки,
поиска, выбранных записей (включая выбор всех страниц), пагинации, колонок и тегов ведёт List.js ядра.

Исходная панель списков становится раскрываемой областью: личные/общие фильтры, их поиск и настройка,
теги и ссылки расширений. Escape закрывает панель и возвращает фокус; исходные несемантические элементы
настройки фильтра, колонок и действий строки получают клавиатурный доступ. Поиск в URL раскрывает строку
поиска после reload/Back. MutationObserver и события списка обновляют подпись и геометрию после AJAX;
IslandScope снимает обработчики, наблюдателей и собственные атрибуты при возврате в стандартный вид.

Дополнительные счётчики до панели действий сохраняются в отдельной области. Узлы с исходной структурой
«ссылка + число» получают общую карточку; их фоновый цвет сохраняется в CSS-переменной для левого акцента.
Тексты, числа, ссылки и цветные строки расширений остаются исходными. Неизвестная структура получает
только оформление внешней области. В коде нет названий собственных модулей, полей или фильтров установки.

Клиентский адаптер `ext/pdfmaker` загружается только при активном серверном контракте PDF Maker 4.x и
найденной штатной ссылке массового экспорта. Кнопка рядом с массовыми действиями вызывает именно эту
ссылку; выбранные ID, шаблоны, язык, доступность экспорта, скачивание/предпросмотр и права обрабатывает
PDFMaker. Его диалог выбора шаблонов получает адаптивную ширину; оригинальная форма и Select2 сохраняются.
При AJAX кнопка подключается к новому контейнеру, при отключении адаптера исчезает. Без расширения нет
пустых кнопок и клиентского запроса к нему. Оригинальное действие в меню остаётся доступным.

### 7.10. Полная карточка в облачном окне (этап 13)

Это развитие §7.7: вместо ограниченного `OverlayDetailView` окно получает композицию **полного
нативного Detail**. `ModernUI_Record_View` проверяет модуль, тип сущности и ID, затем вызывает
`validateRequest`/`checkPermission`, `preProcess` и `process` исходного класса Detail. Собственный
`Record.tpl` содержит только оболочку: шапка, действия, теги и вкладки подключаются исходными
шаблонами модуля, тело возвращает его же view. Копий ядра и отдельного API полей/сохранения нет.
Вывод полного заголовка, который некоторые Inventory overrides печатают даже при `display=false`,
отбрасывается; повторные глобальные библиотеки не попадают в список. Контекст языка, модуля и
legacy `$_REQUEST` действует только на время рендера и восстанавливается в `finally`.

Клиент подключает недостающие native Detail JS/CSS один раз, подготавливает штатную `FIELDS_INFO`,
запускает Detail-класс модуля и `post.overlay.load`. На время окна `app.controller`, `app.view`,
`Vtiger_Detail_Js.detailInstance` и метаданные указывают на карточку. Вызов PJAX внутри переключения
вкладки использует обычный `app.request.get`, сохраняя URL списка. Служебные ID поиска/сортировки/
пагинации фонового списка временно снимаются с его hidden inputs: legacy обработчик связанных
данных иначе берёт фильтр списка. Значения не меняются; ID и контроллер возвращаются до обновления
списка. Повторные подписки и таймеры native uploader освобождаются при закрытии.

`presentation.ts` монтирует Vue только в собственные узлы: закрытие, контекст/действия, overflow
вкладок, навигация секций и поиск. Поиск фильтрует уже разрешённый DOM, не читает новые поля.
Оригинальные действия и вкладки остаются на месте. Список `layout.modules` ограничивает область
при непустом значении; с 0.11.0 пустой список включает карточки всех поддержанных обычных списков.
Ограничения по экранам и безопасный режим продолжают действовать.

История, URL и переход к форме — по §7.7. Прямой Detail URL получает те же стили, действия и поиск
секций. Связанная запись и её правка открываются по нативному URL в отдельной вкладке: у ядра один
`#overlayPageContent`, его вложенная preview иначе уничтожает родителя. Текущая вкладка, состояние
карточки и фоновый список сохраняются. Unlink, создание связи, выбор в popup и quick create остаются
штатными. Полная переработка формы относится к этапу 14.

Сбой запроса, зависимости или стартового обработчика открывает прямую карточку с уведомлением.
Без Navigation API остаётся прямой переход. Это fallback конкретной операции, не переключение
всего приложения на другой режим. Контракты и реальные записи проверяет `test:cloud-records`;
историю/форму/повторные открытия — `test:layout`, документы PDF — проект `records`.

**Жизненный цикл вида в одном документе (этап 19).** Полная страница v7 освобождает всё при переходе; окно поверх списка —
нет, поэтому при уходе вида (закрытие, переход к правке, полная страница) тема: снимает jQuery-обработчики, добавленные
стартом вида на постоянных элементах (`tracked`); снимает подписки `Vtiger_Pagination_Js` (`Post.*.Click<n>`), которые
связанные вкладки добавили на шину `app.event` уже после старта; уничтожает виджеты v7 их собственным `destroy`
(mCustomScrollbar — его цикл обновления каждые 60 мс удерживал закрытую запись и продолжал работать; Select2 — live-регион,
выпадающий список и MutationObserver в `body`; автодополнение jQuery UI — меню в `body`). Back закрывает окно, не трогая
историю; Forward во время его закрытия открывает запись после скрытия (раньше закрытие стирало состояние уже текущей записи
истории). 40 циклов «окно → правка → вкладка → закрытие → Back/Forward → меню» не прибавляют узлов, слушателей DOM и
обработчиков (`test:stability`).

### 7.11. Нативные формы в облачной композиции (этап 14)

`ModernUI/Form` делегирует проверку доступа и генерацию HTML реальному Edit view модуля
с `displayMode=overlay`. Create, Edit и Duplicate получают исходные поля, контекст возврата,
метаданные и зависимости, включая библиотеки из шаблонов uitype. Это отдельное представление,
а не API записи: сохраняет штатный `action=Save`. Quick Create использует исходный `SaveAjax`.

`forms/presentation.ts` добавляет только собственные контейнеры секций, поиска и сообщений.
Исходные таблицы/поля остаются на месте; Vue управляет только навигацией. Поиск не меняет
условную видимость и очищается до штатной валидации, включая click-обработчики расширений.
Сообщения берутся из native validator; переход к ошибке раскрывает область прокрутки.

Navigation API передаёт уже подготовленный ядром `FormData` в тот же Save через jQuery/CSRF.
Пока запрос идёт, повторный Save и закрытие окна блокируются. Ответ проверяется по фактическому
URL XHR: обычный Detail возвращается в карточку, специальный redirect модуля выполняется как
есть. HTTP/JSON-ошибка или неподтверждённый ответ сохраняет поля и возвращает кнопку повтора;
сообщение предлагает проверить результат перед повтором при неопределённом ответе сервера.
Тема не обещает серверную идемпотентность при потере уже успешного сетевого ответа.

Прямой Edit остаётся штатной страницей с теми же блоками и закреплёнными действиями. Явный
`modernui=off` всегда загружает стандартную страницу. При отмене сохраняются штатные проверки
несохранённых изменений; закрытие восстанавливает фокус и контекст списка. `Inventory_Edit_Js`
считает суммы, скидки, налоги и валюту; тема меняет только оформление и область прокрутки.

### 7.12. Системные настройки в компоновке настроек облака (этап 15)

Семейство распознаётся по DOM с первой отрисовки: страница содержит боковую навигацию настроек v7
(`#page > .main-container > #modnavigator.settingsNav`, администратор и «Мои настройки» пользователя).
Затвор тот же, что у шапки (§7.8): скрипты, нет `mu-off`, `data-mu-failed` и уровня `skin`. Без него —
исходные настройки v7 (дерево, «Итог», ярлыки, шапка в две строки).

| Часть | Как | Почему так |
|---|---|---|
| Шапка | `skin/_shell.scss`: строка 53 px, полоса 47 px; избранное и кнопка меню скрыты; остров `settings-back` (`SettingsBack.vue`) — первый в строке | заголовок модуля настроек v7 уже содержит путь и действия страницы — он и есть полоса; перенос узлов не нужен |
| Возврат в CRM | `adapters/v7/settings.ts`: на страницах вне настроек shell запоминает адрес страницы CRM в `sessionStorage` вкладки (только `index.php?…` этой установки); ссылка берёт его, иначе `index.php` | обычная ссылка: новая вкладка, история и клавиатура как везде; адрес из хранилища проверяется `crmLink()` |
| Главная — каталог | `skin/_cloud-settings.scss`: у `#modnavigator`, его обёрток, `.settingsPageDiv` и `.settingsIndexPage` нет своих коробок (`display: contents`), `.main-container` — сетка: сводка → поле поиска → группы аккордеона в CSS-колонках → закреплённые ярлыки | сервер уже печатает в меню именно разрешённые пункты (с переводами, URL и пунктами расширений): каталог не дублируется и не строится по списку эталона; штатный поиск instaFilta скрывает пункты и группы, колонки смыкаются; drag/drop и пины ярлыков v7 остаются на тех же узлах |
| Пустой поиск | `startSettings()` добавляет в `.settingsgroup` собственный узел с переводом RU/EN/DE; CSS показывает его, пока поле непустое и все группы скрыты поиском | instaFilta не сообщает «нет совпадений»; поиск, сопоставление (с синонимами умлаутов) и скрытие — v7 |
| Клавиатура главной | `tabindex="-1"` у ссылок-аккордеонов групп (возвращается при снятии темы) | группы — заголовки каталога: Tab ведёт из поиска к самим настройкам |
| Внутренние страницы | навигация закреплена под полосой (`position: fixed`, 180 px, своя прокрутка), содержимое с отступом 180 px; таблицы, вкладки, кнопки, поля и диалоги — правила семейства внутри `.settingsPageDiv` | шаблоны, обработчики, модальные окна и мастера страниц не меняются; ниже 992 px навигация скрыта, как в v7 |
| Прямые формы настроек | закреплённая оболочка формы этапа 14 (`.editViewPageDiv.mu-form-host`) начинается под полосой и справа от навигации, оставляя место подвалу страницы | иначе форма пользователя/роли уходила под навигацию; заголовки блоков формы пользователя (`h4` без класса) тоже попадают в навигацию секций |
| Собственная страница ModernUI | каркас настроек — да, шрифт Open Sans и оформление содержимого — нет (`.modernui-page`) | редактор перерабатывается на этапе 16; его компоненты проверены основой этапа 10 |

Шрифт и акцент приходят через токены: на страницах настроек `--mu-font-cloud` — стек Open Sans (при
облачном шрифте), `settings-primary`/`settings-link` — значения облака v8 либо насыщенный вариант основного
цвета установки (`ModernUI_Tokens_Model::forAppearance`, `boot/tokens.ts`, `tests/fixtures/tokens.json`).

Отказы: без скриптов, после сбоя shell, в «Стандартном виде» и при печати — исходные настройки v7 (проверено
блокировкой chunk shell, контекстом без JavaScript и `modernui=off`). Незнакомая страница расширения в каркасе
настроек получает только общие правила семейства; её собственная разметка, скрипты и диалоги не меняются.
Проверки: `test:cloud-settings` (каталог, поиск, навигация, внутренние страницы, диалоги, языки, ширины,
восстановление; на чистом стенде — ограниченный пользователь и реальные изменения), `test:screens` (все пункты
меню настроек с темой и без), `visual:pairs/compare` с `dev/visual/settings.json`.

### 7.13. Страница ModernUI в каркасе настроек (этап 16)

| Часть | Как | Почему так |
|---|---|---|
| Заголовок | серверный `h4.modernui-page__title` в `.modernui-page__header`; инструменты шапки (состояние, «Мои предпочтения», язык) редактор выводит через `Teleport` в собственный пустой контейнер шаблона `[data-mu-root="settings-header-tools"]` | один заголовок и без JavaScript; Vue не создаёт второй |
| Обслуживание | серверный блок `[data-mu-server="service"]` (состояние, формы Toggle/Recovery, пилот, проверка браузера) остаётся в шаблоне; смонтированный редактор переносит этот же узел в раздел «Обслуживание» (`ServerPart.vue`: `append` с меткой-комментарием, при размонтировании — обратно) | формы, CSRF и остров проверки работают без изменений; это собственная разметка модуля, не узлы CRM или расширений |
| Шрифты | `skin/_cloud-settings.scss`: Open Sans для всего семейства настроек, теперь и для рамки страницы ModernUI; содержимое `.modernui-page` и `#mu-overlay-root` страницы получают `--mu-font-cloud` = стек Poppins (`settings/editor.scss`) и `--mu-font-family` = токен шрифта темы (`settings/pageFont.ts`: сохранённый, затем черновика) | рамка одинакова на всех страницах настроек; содержимое — рабочее семейство компонентов этапа 10; выбор Inter/системного шрифта сохраняется |
| Черновик вкладки | `sessionStorage` (`state.ts`: `snapshot`/`restore`/`rebase`) | работа не теряется при перезагрузке и конфликте; хранилище вкладки, не кэш настроек |
| Подтверждения | `confirm.ts` + `ConfirmDialog.vue` в `#mu-overlay-root` | `window.confirm` не в языке облака и блокирует страницу |
| Личные предпочтения | `#modernui-preferences-page.content-area` без отступа под боковую панель v7 (283 px), колонка до 1120 px, полный заголовок (v7 обрезает `h4.module-title` до 160 px) — правила только этой страницы | исходная страница имела пустую левую полосу и обрезанное название |

Без JavaScript, при сбое загрузки редактора и с `&editor=off` страница — прежние серверные формы (заголовок, состояние, переключатели,
пилот, восстановление). Новых серверных действий и ключей нет.

### 7.14. Остальные экраны в облачной компоновке (этап 17)

Тот же механизм, что у шапки и списков (§7.8–7.9): правила первой отрисовки над исходными узлами v7, затвор `scripting`, нет
`mu-off`, `data-mu-failed`, уровня `skin` и есть загрузчик (`[data-mu-build]`). Семейство распознаётся по DOM, а не по имени
модуля расширения: `.main-container > #CalendarViewContent` (календарь и общий календарь), `#page > .dashBoardContainer`
(главная), `.reports-content-area .reportsDetailHeader` (результат отчёта), `.editContainer > .row > .breadcrumb` (мастера
отчёта и диаграммы), `#overlayPageContent:has(.fc-overlay-modal)` без `.mu-record-overlay` (импорт, экспорт, массовое
изменение, слияние), `#findDuplicateContents` (дубликаты), `.main-container-MailManager`.

| Часть | Как | Почему так |
|---|---|---|
| Списки ядра со своими шаблонами | контракт этапа 12 (`skin/_cloud-lists.scss`, `adapters/v7/lists.ts`) принимает контейнеры действий `.recordDependentListActions` (корзина) и `.btn-toolbar` (шаблоны писем); у отчётов и корзины таблица лежит внутри `#listview-actions` — в полосу инструментов переносится только строка действий `#listview-actions > .row`, таблица остаётся в потоке страницы; у корзины нет `#view` — признак модуля `.main-container-RecycleBin` | ни один скрипт ядра не меряет `#listview-actions` (поиск по коду тега 8.4.0); расширения с той же вложенной разметкой (как VReports) остаются со своей компоновкой — вариант ограничен двумя модулями ядра |
| Цвет календаря | `adapters/v7/special.ts`: inline `background-color` строки календаря v7 копируется в `--mu-feed-color` её флажка (MutationObserver панели, загруженной AJAX; смена цвета пользователем); строка становится прозрачной | CSS не может прочитать inline-цвет в другое свойство; цвет — данные пользователя и совпадает с цветом его событий, флажок — исходный `input` с теми же data и обработчиками |
| Полоса календаря | обёртки панели FullCalendar 3 `display: contents`, кнопки — `order` | FullCalendar строит панель один раз и далее меняет классы/текст; обработчики остаются на тех же кнопках, высоты слотов (позиции событий) не меняются |
| Главная | полоса вкладок — `position: fixed` в полосе инструментов (z 1094, ниже меню шапки), «Добавить виджет» активной вкладки — правый край; ширину кнопки адаптер меряет в `--mu-dashboard-add` (ResizeObserver, смена вкладки) | вкладки сортирует jQuery UI, панель вкладки грузится AJAX — узлы не переносятся |
| Результат отчёта | `form#detailView` — сетка: строка заголовка (3 колонки v7, порядок CSS) и «Изменить условия» в одной строке 64 px, условия — карточка ниже | обработчики `modify_condition`, `reportActions`, `generateReport` ядра работают с теми же узлами |
| Мастера | шаги `BreadCrumbs.tpl` — шевроны `clip-path`; `.editContainer` — окно, подвал шагов `position: sticky` внутри окна | v7 фиксирует подвал к низу экрана отдельно от формы; кнопки и `window.history.back()` — v7 |
| Окна `fc-overlay-modal` | `#overlayPageContent` само становится окном (по центру, y 28, ≤ 1140 px, высота по содержимому до экрана), шапка и подвал `sticky`; встроенный `margin-bottom: 100%` шага выбора типа файла снят | загрузка, шаги и `cancelLink` — `Vtiger_Import_Js`/`Vtiger_List_Js`; окно записи и форм этапов 13–14 (`.mu-record-overlay`) и страницы настроек (§7.12) не затрагиваются |
| Дубликаты | дерево списков — та же раскрываемая панель, что у списков (кнопка «Списки и теги», Escape, клик вне), разметка кнопок — общий mixin `list-controls` | постоянной колонки фильтров нет ни на одном рабочем экране (D03) |
| Заголовок модуля | `h4.module-title` без ограничения v7 160 px; крошки, обёрнутые в `span` (отчёты, корзина), скрыты как у остальных модулей | облако показывает полное название модуля и не повторяет путь |

Отказы: без скриптов, при сбое shell, в «Стандартном виде», при печати и на уровне `skin` — исходные экраны v7 (сценарий
`special-screens`: страница без JavaScript, `modernui=off`). Узкие экраны — §13.13 `design.md`. Новых серверных действий,
таблиц, ключей настроек и миграций нет.

## 8. Серверные действия

Ответ — `Vtiger_Response` (JSON `{success, result | error}`), ошибки — коды `MU_*` с параметрами, тексты
переводит клиент. Все действия: вход обязателен, `vtlib_isModuleActive('ModernUI')`, версия схемы.

| URL (`index.php?…`) | Метод | Кто | Проверки | Назначение |
|---|---|---|---|---|
| `module=ModernUI&action=Bootstrap` | GET | любой вошедший | Referer, ETag | действующие настройки пользователя, меню, локаль, флаги |
| `module=ModernUI&action=Tokens&r=<ключ>` | GET (`<link rel=stylesheet>`) | любой вошедший | Referer; ключ настроек | таблица стилей токенов (§5.1); `immutable` при совпадении ключа, `no-store` иначе; пустая без активной темы |
| `module=ModernUI&action=Preferences&mode=save` | POST | любой вошедший | CSRF, ревизия, разрешённые ключи | личные настройки |
| `module=ModernUI&action=Preferences&mode=clear` | POST | любой вошедший | CSRF | сброс личных настроек (не `mode=reset`: `WebUI.php` для `mode=reset`, `mode=fromMig` и `action=Login` не подключает csrf-magic — запрос падает на проверке CSRF; найдено на этапе 02, проверяется `tests/php/RoutesTest.php`) |
| `module=ModernUI&view=Preferences` | GET | любой вошедший | — | страница личных предпочтений |
| `module=ModernUI&parent=Settings&view=Index` | GET | админ | `Settings_Vtiger_Index_View` | страница настроек (+ HTML-форма без JS: вкл/выкл темы, безопасный режим) |
| `module=ModernUI&parent=Settings&action=Save` | POST | админ | CSRF, ревизия, валидация | общие и ролевые настройки, меню |
| `…&action=Data` | GET | админ | Referer | данные редактора: документы с ревизиями, роли, пользователи, каталог модулей (этап 05) |
| `…&action=Save&mode=previewMenu|deleteRole|resetUser` | POST | админ | CSRF | предпросмотр меню черновика с правами администратора; удаление профиля роли (ревизия); сброс личных настроек пользователя (этап 05) |
| `…&action=Transfer&mode=export` | GET | админ | Referer | JSON-экспорт (`settings.md` §9, §13) |
| `…&action=Transfer&mode=preview|apply` | POST | админ | CSRF, размер ≤ 256 КБ, схема, `fingerprint` | импорт JSON: отчёт, применение одной транзакцией |
| `…&action=Logo&mode=upload` | POST | админ | CSRF, PNG/JPEG/GIF ≤ 512 КБ, `getimagesize` + перекодирование GD | логотип темы в `test/logo/modernui_<sha1>.png` (удаление неиспользуемых — автоматически, `settings.md` §13.3) |
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
| JS заблокирован / ошибка `loader.js` | skin и таблица токенов работают, v7 полностью рабочий; `mu-pending` не ставится, `mu-shell-ready` тоже (e2e этапа 04 с выключенным JS) |
| нет skin (404) или таблицы токенов (500, HTML вместо CSS) | браузер её не применяет; shell стартует, токены ставятся inline из `Bootstrap`, острова работают (e2e этапа 04) |
| 403/404/500 на manifest или chunk | `data-mu-failed`, снят `mu-pending`, v7 рабочий; повтор на следующей странице |
| исключение при монтировании | остров размонтирован, маркеры сняты |
| 403/500 у `Bootstrap` | shell не монтируется (нет данных меню), skin остаётся |
| сбой оболочки после первой отрисовки (403/500 у `Bootstrap`, нет общего chunk, таймаут) | загрузчик ставит `data-mu-failed`, правила первой отрисовки снимаются и посылается `resize`: floatThead и полосы прокрутки v7 пересчитывают геометрию без резерва темы (этап 19: без этого плавающая шапка списка закрывала первую запись) |
| истёкшая сессия во время работы | запрос окна записи получает страницу входа — показывается вход CRM, пустого или «застрявшего» окна нет (`test:quality`) |
| ошибка в обработчике ссылки | `catch (\Throwable)` → `false`: темы на странице нет, CRM работает |
| несовпадение версии схемы (прерванное обновление) | тема не подключается; страница настроек предлагает `Recovery` |
| некорректные сохранённые настройки | валидация при чтении: неизвестные/битые значения заменяются значениями по умолчанию, предупреждение администратору; нечитаемый общий документ = значения по умолчанию (тема выключена), личный — общие значения; администратор исправляет обычным сохранением на текущей ревизии (этап 19, тест на временной MySQL) |
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
dev/                                   crm-link.sh, crm-mounts.txt, crm-info.php, crm-vtlib.php, crm-links-for.php, crm-menu-for.php, check-private.sh
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
| Q4 | `Vtiger_Package::update()` с ZIP новой версии: миграции в `postupdate`, настройки сохранены, окно «новый код/старая схема» не ломает страницы | 02: dev-стенд 0.1.0 → 0.1.1 — да; 03: «Update Now» менеджера модулей тем же ZIP на чистом стенде и dev-стенде — настройки и регистрация сохранены; новой миграции тогда ещё не было; актуальный update 0.6.0 → кандидат проверяется на этапе 20 |
| Q5 | `vtlib_addSettingsLink` на чистой 8.4.0: блок `LBL_OTHER_SETTINGS` существует, пункт виден и подсвечивается | 03: да (e2e: пункт в «Other Settings», `settingsgroup-menu-color`, блок раскрыт) |
| Q6 | кодировка/collation собственных таблиц совпадает с базой чистого стенда (установщик 8.4.0) и dev-стенда | 02: dev-стенд `utf8mb4_general_ci`; 03: чистая 8.4.0 — база `utf8mb3_general_ci`, таблицы ModernUI — `utf8mb3_general_ci` |
| Q7 | загрузчик на реальной странице 8.4.0: `?b=…&z=?v=8.4.0`, подкаталог `/vtigercrm/`, порядок относительно `app.controller()` | 02: dev-стенд в корне — да; 03: чистая 8.4.0 в корне (PHP 8.1) и в `/vtigercrm/` (PHP 8.5) — да |
| Q8 | skin в `<head>` не даёт мигания v7 при переходах; CLS полосы избранного при `mu-pending` ≤ 0.1 | 04: см. `verification.md` §3 (замер `task measure`); 06: место полосы резервирует таблица токенов с первой отрисовки — e2e `navigation` (shell задержан: высота шапки и верх содержимого до и после монтирования равны), замер `task measure` — `verification.md` §3 |
| Q9 | `Bootstrap` < 50 мс на сервере dev-стенда, ETag/304 | 04: см. `verification.md` §3 (замер `task measure`) |
| Q10 | Vue-оверлей внутри модалки Bootstrap 3 не конфликтует с `enforceFocus` | 07 |
| Q11 | реэкспорт/импорт ролей по имени между чистым и dev-стендом | 05: да — роль по пути имён ниже корня без учёта регистра (MySQL: две базы с разными id и именем корня, `TransferTest.php`); e2e — файл чистого стенда на dev-стенде и наоборот: неизвестные роли и пользователи перечислены в отчёте, применение без числовых id (`verification.md` §3) |
| Q12 | удаление через консоль vtlib и кнопку модуля: нет ссылок, пункта настроек, таблиц (по политике) | 03: консоль на чистом стенде — ссылок и пункта нет, таблицы сохранены, страницы без ошибок; кнопка модуля и `--purge` — 10 |
