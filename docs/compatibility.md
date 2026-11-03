# Совместимость ModernUI

Этап 01, 2026-11-01. Статус по умолчанию — **не проверено**. Отметка меняется только по реальной
проверке с датой, стендом (чистый / dev) и ссылкой на запись в `verification.md`. Частные модули и
доработки конкретной CRM, входящие в обязательную матрицу dev-стенда, описаны в `PRIVATE.md`.

## 1. Платформа

| Цель | Статус | Примечание |
|---|---|---|
| Vtiger Open Source 8.4.0, layout v7, чистая установка | этап 03: архив релиза, штатный установщик — импорт ZIP менеджером модулей, включение, пилот, disable/enable, update, удаление консолью, повторная установка — проверено (`verification.md` §3) | экраны v7 под темой — этапы 04–10 |
| Vtiger 8.4 с модифицированным ядром (dev-стенд) | этап 02: регистрация, ссылки, загрузчик, shell, настройки — проверено (`verification.md` §3) | этапы 03–10 — экраны и расширения; отличия ядра — §4 |
| Vtiger 7.x, 8.0–8.3, 9.x, облако | не поддерживается | `postinstall` оставляет тему выключенной на версии не 8.4.* |
| PHP 8.1 | этап 03: чистая 8.4.0 на PHP 8.1.34 (Apache + mod_php) — проверено; lint и unit-тесты — этап 02 | нижняя граница composer.json 8.4.0 |
| PHP 8.4 | lint и unit-тесты моделей — проверено (8.4.27), этап 02 | в CRM — этап 03 (если вариант будет) |
| PHP 8.5 | dev-стенд (PHP-FPM 8.5) — этап 02; чистая 8.4.0 на PHP 8.5.12 (`imap` из PECL) — проверено, этап 03 | ядро 8.4.0 на 8.5 пишет предупреждения и deprecated (§3, особенности этапа 03); от файлов ModernUI — нет |
| MySQL 8.0 | не проверено | чистый стенд (вариант) |
| MySQL 8.4 | dev-стенд (utf8mb4) и чистый стенд 8.4.13 (база установщика `utf8mb3_general_ci`) — проверено, этапы 02–03 | |
| MariaDB | не проверено, не заявлено | |
| Smarty 4.5 (`composer.json` 8.4.0: `^4.3`) | dev-стенд (4.5.8) — страницы ModernUI без предупреждений, этап 02 | в шаблонах только модификаторы из списка `Vtiger_Viewer` тега 8.4.0 (`escape`, `vtemplate_path`) и собственная функция `{mu_t}` |
| Установка в корень сайта | проверено: dev-стенд (этап 02), чистый `c81` (этап 03) | |
| Установка в подкаталог (`/vtigercrm/`) | проверено: чистый `c85` (этап 03) — загрузчик, shell, настройки, пилот | |
| Браузеры: последние Chrome/Edge, Firefox, Safari | Chromium — прототип загрузчика; остальные не проверено | этап 09 |
| Браузер без ES modules / JS выключен | не проверено | ожидается v7 со skin без shell |

## 2. Языки, роли, экраны

| Измерение | Варианты | Статус |
|---|---|---|
| Язык CRM пользователя | `en_us` (чистый стенд), `ru_ru`, `de_de` (при наличии пакета) | `en_us` — этап 03 (чистый стенд); `ru_ru` — dev-стенд, этап 02 |
| Язык темы | ru-RU, en-US, de-DE, «как в CRM», fallback en-US | тексты модуля на трёх языках при CRM только с `en_us`, «как в CRM» → en-US — этап 03 (чистый стенд, пользователь U); экраны темы — этапы 04–05 |
| Роли | администратор; пользователь с полным просмотром; пользователь с ограниченным профилем; пользователь без доступа к части модулей | включение темы (пилот по пользователю и роли), отказ U на страницах администратора ModernUI, сохранённые запреты профиля под темой — этап 03 (чистый стенд, A, A2, U, G) |
| Типы экранов | вход (тема не применяется); главная/панели; список; карточка (сводка, детали, связанные); полная форма; быстрое создание; overlay-редактирование; popup выбора записи; импорт/экспорт; отчёты; календарь; почта; документы; Настройки CRM; страницы расширений со своей оболочкой | этап 04 (skin, чистый стенд и dev-стенд): главная, список, карточка (сводка, детали, связанные вкладки), полная форма с Select2/календарём/ошибкой валидатора, быстрое создание, выпадающие меню, уведомления, отчёты, календарь, Настройки и менеджер модулей — без ошибок и регрессий относительно вида без темы (`verification.md` §3); полнота списков — этап 06, карточек и форм — 07, остальных экранов — 08 |
| Ширина/масштаб | 1440, 1024, 768, 412; масштаб 200 % | этап 04: снимки всех четырёх ширин и 200 % с темой и без, горизонтальной прокрутки тема не добавляет; на 768 px панель действий модуля v7 раскрыта поверх заголовка карточки и без темы (поведение v7) |

## 3. Каталог событий ядра v7 (тег 8.4.0)

`app.event` — шина `jQuery({})` (`layouts/v7/resources/application.js:146–161`), не привязана к DOM:
перерисовка DOM не теряет подписчиков, но события перестают приходить, если перестают вызываться
функции контроллеров v7. Вторая группа — jQuery-события на элементах, они всплывают и требуют
прежних контейнеров. Опечатки в именах — часть API (`Vtiget.Dashboard.PostLoad`,
`Vtiger.Referece.Popup.Pre`, `…Messsage`).

| Область | События (место вызова в 8.4.0) |
|---|---|
| шапка, меню, быстрое создание | `Vtiger.Post.MenuToggle` (`Vtiger.js:341,657`), `post.QuickCreateForm.show` (`Vtiger.js:509`), `post.QuickCreateForm.save` (`Vtiger.js:611`), `post.save.failed`, `post.overlayPageContent.hide` (`helper.js:74`) |
| popup выбора | `post.Popup.Load` (`Popup.js:414`), `post.popupSelection.click` или `eventToTrigger` вызывающего (`Popup.js:390–397`), `pre.popupSelect.click` |
| пагинация | `Post.NextPage.Click<rnd>`, `Post.PrevPage.Click<rnd>`, `Post.PageJump.Click<rnd>`, `Post.TotalRecords.Click<rnd>` (`Pagination.js:28–120`) |
| форма | `Pre.Record.Save` (`Edit.js:141`, `Detail.js:302`), `post.editView.load` (`Edit.js:359`), `post.lineItem.New` (`Inventory/…/Edit.js:1646`), `Vtiger.Reference.Selection`, `Vtiger.PostReference.Selection`, `Vtiger.Reference.Deselection`, `Vtiger.Referece.Popup.Pre`, `Vtiger.MultiReference.Selection`, `Vtiger.PostReference.QuickCreateSave` (ищет поле через окружающий `td`), сообщения валидации `Vtiger.Validation.Show/Hide.Messsage` |
| карточка | `PreAjaxSaveEvent`, `PostAjaxSaveEvent` (`Detail.js:1310,1389`), `post.relatedListLoad.click` (`Detail.js:410,659`, `RelatedList.js:133`), `pre.relatedListLoad.click`, `post.summarywidget.load`, `post.overlay.load` (`Detail.js:2570`), `post.overLayEditView.loaded` (`Detail.js:2634`), `post.RecordList.click`, `post.mail.sent`, `Request.AllTag.show`, `post.MassTag.save`, `post.documents.save` |
| список | `post.listViewFilter.click` (`List.js:464`, `SearchList.js:89`), `post.listViewMassEdit.click/loaded`, `post.listViewMassAction.loaded`, `post.listViewInlineEdit.click`, `post.listViewMassEditSave`, `Post.ListRow.Checked/UnChecked` (на `tr.listViewEntries`), `Post.ListSelectAll/DeSelectAll`, события фильтров боковой панели |
| панели | `post.DashBoardTab.load`, `Vtiget.Dashboard.PostLoad`, `Vtiger.Dashboard.PostRefresh`, `Vtiger.DashboardWidget.PostResize`, `Calendar.Viewtypes.PostLoad.Event` |
| совместимость v6 | `app.notifyPostAjaxReady()` → `postajaxready` (ядро 8.4 его не вызывает), `jQuery.triggerParentEvent()` (`v7_client_compat.js:74–104`) |

Правила ModernUI:

1. Сохранение, загрузка, фильтрация, пагинация, inline-правка остаются в контроллерах v7
   (`Vtiger_List_Js`, `Vtiger_Detail_Js`, `Vtiger_Edit_Js`, `Inventory_Edit_Js`, `Vtiger_Index_Js`) —
   события выше возникают только там. ModernUI не переписывает эти потоки на Vue.
2. Контейнеры всплывающих событий сохраняются: `tr.listViewEntries[data-id]` внутри страницы списка,
   `.sourceField` внутри `td` поля, контейнеры виджетов, `li` фильтров.
3. Острова ModernUI подписываются на `app.event` только через адаптер (снятие подписок в `unmount`) и
   никогда не вызывают `app.event.off(name)` без своего обработчика.
4. Свои запросы ModernUI делает через `fetch`, а не `jQuery.ajax`: многие расширения висят на
   глобальном `ajaxComplete` и пересканируют страницу после каждого jQuery-запроса.

Особенности ядра 8.4.0, найденные на этапе 02 (влияют на любое расширение):

- `WebUI.php` не подключает csrf-magic для `mode=reset`, `mode=fromMig` и `action=Login`; POST
  расширения с такими параметрами падает на `validateWriteAccess()` (`csrf_check` не определена).
  ModernUI их не использует (`tests/php/RoutesTest.php`).
- `Header.tpl` выводит `<input id="inventoryModules">` внутри `<head>`: тема v7 и все HEADERCSS
  оказываются в начале `<body>` (до содержимого страницы).
- Скин v7 задаёт `.navbar-fixed-top { z-index: 1095 !important }`, `.modal` — 1100, `#overlayPage` — 1099:
  выпадающим элементам расширений нужен слой между 1095 и 1099.
- Подпись пункта «Настройки → Прочие» переводится модулем текущей страницы настроек: имя пункта лучше
  делать читаемым без перевода.
- `PearDatabase::fetch_array()`/`query_result()` HTML-кодируют значения; JSON из базы читается через
  `raw_query_result_rowdata()`.

Особенности чистой 8.4.0, найденные на этапе 03 (архив релиза, PHP 8.1 и 8.5; ModernUI их не исправляет —
обходит или учитывает):

- Git-тег `8.4.0` не содержит `vendor/`: установка из тега отвечает «Please install composer dependencies.»;
  архив релиза — тот же код с `vendor/` и более новым `composer.lock` (Smarty 4.5.5).
- CLI-скрипты должны подключать `vendor/autoload.php` (как `index.php`): иначе логгер падает на
  `Monolog\Logger`. `vtlib/tools/console.php` этого не делает и молча выходит с кодом 0 — обход
  `php -d auto_prepend_file=vendor/autoload.php …`; аргумент — `--remove=<Модуль>`.
- `config.php` для веб-запросов оставляет `error_reporting(E_ERROR…)`: предупреждения и deprecated видны только
  со штатным `config_override.dev.php` (копия в `config_override.php`, журнал `logs/phperr.log`).
- `vtws_create()` документов с товарными строками (SalesOrder и др.) падает «Id specified is incorrect»: события
  перед сохранением требуют id записи; ключ строк — `LineItems`. Форма редактирования работает.
- Первый вход администратора — мастер SystemSetup (выбор функций), первый вход каждого пользователя — UserSetup;
  его сохранение пересоздаёт файлы привилегий пользователя.
- После удаления модуля его файлы остаются, и менеджер модулей предлагает для ZIP только «Update Now», которое
  для незарегистрированного модуля падает («ZIP File is corrupted or empty»).
- В базе после установки есть `HEADERSCRIPT` на отсутствующие файлы (`ExtensionStore.js`, `ModCommentsCommon.js`,
  `SMSNotifierCommon.js`) — `Header.php` их пропускает; `bootstrap-legacy` ссылается на отсутствующий
  `glyphicons-halflings.png` (404).
- Исходные предупреждения ядра на экранах baseline: `modules/Inventory/models/Record.php` (форма заказа),
  `LineItemsDetail.tpl` (`subprod_names`), `modules/Calendar/actions/Feed.php`, `include/utils/UserInfoUtil.php`;
  на PHP 8.5 дополнительно «Cannot use string as array» в `Settings_Vtiger_Module_Model::getInstance()` на каждой
  странице настроек (включая страницу ModernUI — она наследует `Settings_Vtiger_Index_View`), deprecated в
  `ExtensionStore/libraries/RestClient.php`, `GuardedArray.php`, `Services.php`, `VtigerLineItemOperation.php`.
- Установщик отправляет регистрацию на сервер вендора и показывает пиксель статистики; на чистом стенде сеть
  закрыта, запрос браузера блокируется.

## 4. Отличия модифицированных сборок 8.4

На dev-стенде ядро v7 не стоковое (сборка на основе SalesPlatform и правки установки). Из
обнаруженного важно для темы:

- `Header.php` может пропускать ресурсы отключённых модулей; `Link.php` сортирует ссылки по
  `sequence`; `PackageImport::import_CustomLinks()` исправлен. ModernUI ни на что из этого не опирается.
- Шаблоны v7 изменены: сетка `ModuleHeader.tpl`, меню «Ещё» в `DetailViewActions.tpl` заменено
  встроенной группой кнопок, `Pagination.tpl`, `Topbar.tpl` (дополнительная разметка с inline-стилями
  у логотипа), `SidebarEssentials.tpl`, скрытое поле `input[name=locale]` в `Header.tpl` и
  дополнительные библиотеки (pnotify, visibility, inputmask) в `JSResources.tpl`/`Basic.php`.
- JS ядра изменён: `Vtiger.js`, `Detail.js`, `Edit.js` (второй путь сохранения с теми же событиями
  `PreAjaxSaveEvent`/`PostAjaxSaveEvent`/`post.save.failed`, собственные оверлеи на `body`),
  `Popup.js` (оконные popup v6), `Utils.js`, `validation.js`.
- Модули Inventory и некоторые другие используют собственные копии `ListViewContents.tpl` эпохи 7.x.

Следствие: skin пишется по устойчивым классам (`.listViewEntries`, `.fieldLabel`, `.fieldValue`,
`.detailview-header`, `.btn`, `.modal`) с нейтральной обработкой незнакомой разметки, а не по
точной DOM стоковых шаблонов; тема не переопределяет шаблоны ядра (`Viewer` и не позволил бы
сделать это без копий). Конкретный список изменённых файлов dev-стенда — `PRIVATE.md`.

## 5. Реестр публичных расширений

Наблюдения по коду расширений, установленных на dev-стенде (версии — на 2026-11-01). Риск —
для темы, которая переоформляет экран CSS и добавляет собственные острова (`architecture.md` §6).
Статус совместимости — «не проверено» до сценариев этапов 06–10.

### 5.1. Шапка и меню

| Расширение | Зависимость | Риск | Правило ModernUI |
|---|---|---|---|
| CRMTiger CTMobileSettings | на каждой странице (для админов) вставляет `li.dropdown` с inline-стилями в начало первого `#navbar ul.nav.navbar-nav` | высокий при замене шапки | шапка v7 остаётся (A6); skin выравнивает `li` без смены порядка |
| CRMTiger CT*-модули (настройки) | собственные копии JS меню приложений (`.app-menu` в `#page`, `.app-item[data-default-url]`) | средний | не скрывать `#app-menu` на их страницах, если адаптер видит чужие обработчики; проверить двойное меню |
| GeoTools (Libertus) | собственная копия оболочки страницы (Topbar, `.app-nav`, `#modnavigator`, `#sidebar-essentials`), переопределяет `app.getModuleName/getViewName/getPageController` | высокий для шапки/меню | экран по умолчанию исключать из shell, только skin; проверить |
| ITS4You PDFMaker, Installer; VTExperts VReports | копии оболочки списка/карточки/настроек (`*PreProcess.tpl`) | средний | CSS доходит, шаблонные изменения — нет; skin по классам |
| WhatsApp-интеграции на базе CRMTiger | вставка в `#navbar li:eq(0)`, глобальный CSS `.dropdown-menu`, `ul`, `.navbar-nav>li>a` | высокий при включении | проверить отдельно при включении |
| Сторонние сервисы со своим Vue 2 | глобальный `window.Vue` 2.x на своих страницах | средний | ModernUI использует свой Vue из бандла, не `window.Vue`, не создаёт глобальных имён |

### 5.2. Карточка

| Расширение | Зависимость | Риск | Правило |
|---|---|---|---|
| ITS4You PDFMaker | после загрузки дописывает группу кнопок `#PDFMakerContentDiv` в `.detailview-header` | высокий при переименовании/асинхронной отрисовке заголовка | `.detailview-header` не переименовывается и не перерисовывается; кнопки получают общий стиль `.btn` |
| ITS4You EMAIL Maker (ITS4YouEmails) | на карточке письма переписывает первые две вкладки `.nav.nav-tabs li:nth-child(1/2)` по позиции, `.module-breadcrumb a`, заменяет `#Emails_detailView_fieldValue_description` на iframe; слушает `post.relatedListLoad.click`, `post.listViewFilter.click`, `post.overlay.load` | средний | порядок вкладок не менять |
| VTExperts Comments (Advanced) | глобальный `ajaxComplete`, вставки в блок комментариев | средний | проверить блок комментариев |
| SalesPlatform SPSocialConnector | JS в каждом списке и карточке, кнопки `DETAILVIEWBASIC` с `javascript:`-URL | низкий/средний | кнопки действий выводятся как есть |

### 5.3. Формы и поля

| Расширение | Зависимость | Риск | Правило |
|---|---|---|---|
| VTExperts Conditional Layouts (ControlLayoutFields) | на каждой странице: `td.fieldValue` → `.prev()` (подпись) → `tr`; переставляет `td` в строках `div.fieldBlockContainer table` (4 ячейки в строке); id `<Module>_editView_fieldName_<f>`; Select2 3.x; слушает `post.overLayEditView.loaded` на каждом `ajaxComplete` | высокий при переводе форм на div/grid | структура таблиц формы неприкосновенна (только CSS) |
| VTExperts Related Blocks & Lists | вставляет псевдоблоки после `.fieldBlockHeader` с нужным текстом, использует `.fieldBlockContainer`, `.blockContainer`, `.detailview-table`, `.listViewEntriesTable`, считает первую `<form>` страницы формой `#EditView`; обнуляет `window.onbeforeunload`, горячая клавиша Alt+A, блокирует `button[type=submit]` до ответа; слушает `post.relatedListLoad.click`, `post.Popup.Load` | высокий | никаких своих `<form>` перед `#EditView`; не перехватывать `beforeunload` для форм v7; не назначать Alt+A |
| VTExperts Advanced Custom Fields | `tr/td` полей, вставка редакторов и загрузок, глобальный `ajaxComplete`, подгружает CKEditor на каждой странице | средний | только CSS |
| VTExperts Field Autofill (если включён) | снимает обработчики `Vtiger.Reference.Selection`, слушает `post.QuickCreateForm.show` | средний | не трогать события ссылочных полей |
| SalesPlatform SPDynamicBlocks | после загрузки карточки/overlay/вкладки делает `.show()` всем `#detailView .block`; при изменении `select.inputElement` в `#EditView` — `.show()` всем `.fieldBlockContainer`; inline `min-height` у `.editViewPageDiv .content-area` | высокий для свёртки/вкладок блоков через `display` | не скрывать блоки через `display:none`; свёртку делать штатным механизмом v7 |
| SalesPlatform SPKladr, SPTips; EEAddressAutocomplete | подключаются один раз на `ready` при `_META.view == 'Edit'` по `[name=…]` и id полей внутри `.editViewPageDiv`/`#EditView`; выпадающие списки jQuery UI / `.pac-container` | средний | полная форма остаётся полной страницей; z-index выпадающих выше закреплённой шапки |
| vtigress vtDigiSign | глобальный `ajaxComplete`: `span.value[data-field-type]` → `closest('td').attr('id')`, скрывает `.editAction`; подпись инициализируется на `ready`; глобальный CSS `.signature`, `html.touch #content` | высокий при div-ячейках/скрытых блоках | только CSS, блоки не скрывать |
| Инвентарные товарные строки (ядро + расширения) | `#lineItemTab`, `.lineItemRow`, `post.lineItem.New`, popup `post.LineItemPopupSelection.click` | высокий | только CSS |

### 5.4. Списки

| Расширение | Зависимость | Риск | Правило |
|---|---|---|---|
| VTExperts Listview Colors; VGS Listview Colors | красит `#table-content .listview-table tr.listViewEntries[data-id]` inline (`background-color`, `color`), перекрашивает по `post.listViewFilter.click` | средне-высокий | skin не задаёт фон строкам с inline-фоном, без `!important` на фон/цвет строк; hover — через `box-shadow`/outline, не через `background` |
| SalesPlatform SPPayments, инвентарные модули | собственные копии `ListViewContents.tpl` 7.x | средний | skin по классам, проверить отдельно |
| crm-now «Search» (глобальный поиск), crmtogo | собственный поиск/мобильный клиент | низкий | проверить поиск в шапке |

### 5.5. Глобальные стили расширений

VTExperts Module & Link Creator (`.alert-warning`), VTExperts Customer Feedback (`.bold`,
`.margin-bottom-20`, `.fa-star:hover`), vtDigiSign (`.signature`), CT* (inline `<style>` для
`.nav-tabs`) переопределяют общие классы глобально. Skin не воюет с ними `!important`; специфичность
skin выше за счёт `:root:not(.mu-off)`, поэтому визуальный результат на экранах с такими модулями
проверяется отдельно.

### 5.6. Общие наблюдения

- Скрипты расширений читают `_META` (`Header.tpl`) через `app.getModuleName()/getViewName()` и
  `app.getRecordId()` (`#EditView [name=record]`, `#recordId`). Тема не меняет `_META`, `#recordId`,
  `#EditView`, `#detailView`.
- HEADERSCRIPT расширений грузятся после базовых скриптов v7 и до `Vtiger.js`/скриптов view; порядок
  подключения тема не меняет.
- Некоторые расширения устанавливают свои копии шаблонов в каталоги ядра (`Users/Login.tpl`,
  `Vtiger/uitypes/*`) — тема не переопределяет шаблоны, поэтому конфликтов файлов нет.
- `MutationObserver` и `DOMNodeInserted` расширения не используют; пересканирование по
  `ajaxComplete` — частое.

## 6. Адаптеры: переносимые и специфичные

| Вид | Где живёт | Пример |
|---|---|---|
| Базовое поведение для ядра v7 | ZIP, `frontend/src/adapters/v7/` | шапка, меню приложений, модалки, Select2, списки, формы |
| Переносимый адаптер публичного расширения | ZIP, `frontend/src/adapters/ext/<Расширение>/`, включается при `vtlib_isModuleActive(<модуль>)` (список приходит в `Bootstrap`) | выравнивание кнопок PDFMaker в заголовке карточки; правило для строк Listview Colors |
| Специфичный адаптер конкретной CRM | вне базового ZIP: отдельный необязательный профиль (этап 08), описание — `PRIVATE.md` | собственные модули и поля заказчика |

Адаптер — это CSS и наблюдатели, не правка чужого кода и не копия чужих файлов. Адаптер
расширения не включается, если модуль не активен.

## 7. Известные ограничения (на 2026-11-01)

- Экраны расширений со своей копией оболочки получают только skin; shell (навигация темы) на них
  может не появиться — допустимо, функционал сохраняется.
- Немецкий/русский интерфейс ядра и расширений появляется только при установленных языковых пакетах
  CRM; тексты самой темы переводятся всегда (`I18N.md`).
- Вход в CRM (`Users_Login_View`) не получает HEADERSCRIPT/HEADERCSS — страница входа не оформляется.
- Модальные окна v7 (быстрое создание и др.) сохраняют геометрию v7 (поля 30 px, шапка ≈ 51 px): v7 рассчитывает
  высоту тела окна под свои размеры. На сборках, где у тела быстрого создания есть `max-height` без
  mCustomScrollbar, тема добавляет телу прокрутку, иначе длинная форма перекрывала подвал (этап 04).
- Связанные вкладки карточки v7 имеют фиксированную ширину (90 px): тема оставляет их шрифт 13 px, длинные подписи
  соседних вкладок могут соприкасаться так же, как без темы.
