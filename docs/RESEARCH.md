# Основания для архитектуры ModernUI

Проверено 2026-10-29. Это исходные наблюдения для проектирования, а не доказательство
готовности будущего модуля. При реализации перепроверь изменяемые детали на стендах.

## Облако и существующий интерфейс

Через Playwriter изучены список Leads, карточка, полная форма, окно быстрого создания
и меню облачного экземпляра Vtiger (адрес — в `PRIVATE.md`). В runtime обнаружены Vue 2.5.16, jQuery 3.7.1,
ресурсы layouts/v9. У облака своя компонентная система; это не готовый skin для v7.

Цвет акцента #3978fe, светлые поверхности, компактные элементы, Poppins. Подключённые
там наборы шрифта не содержали кириллицы: выбор шрифта нового модуля должен покрывать
русский интерфейс. Полезно повторить визуальные пропорции, но не обязательны все
облачные панели/функции, отсутствующие в Open Source.

В облачном `app.css` (`layouts/v9/assets/app/app.css`) указан Vtiger Commercial License 1.1.
Доступность файла браузеру не делает его открытой библиотекой. Новый код строится
по визуальному образцу; открытые зависимости берутся отдельно по своим лицензиям.

На исследованном dev-стенде 8.4: jQuery 2.2.4, Bootstrap 3.4.1, Select2 3.4.8; используются Smarty
и layouts/v7. Bootstrap 3 содержит проверку, запрещающую jQuery 4. В расширениях есть
старые API jQuery и Select2. Менять эти глобальные библиотеки установкой темы нельзя.

## Точки расширения, проверенные и в теге 8.4.0

Эталон исходников — официальный репозиторий Vtiger, `git show 8.4.0:<путь>` (локальный клон —
в `PRIVATE.md`). Не используй только код dev-стенда для выводов о переносимости.

| Место | Что подтверждено | Следствие |
|---|---|---|
| modules/Vtiger/views/Header.php | getHeaderScripts/getHeaderCss читают HEADERSCRIPT/HEADERCSS | Модуль может подключить свои ресурсы без правки Header.tpl |
| vtlib/Vtiger/Link.php | addLink, deleteLink, tabid=0 и handler_path/class/method | Возможны глобальные ссылки и серверная проверка условия подключения |
| modules/Vtiger/models/JsScript.php | DEFAULT_TYPE = text/javascript | Для ES modules нужен корректный способ загрузки, обычный link сам его не задаёт |
| vtlib/Vtiger/ModuleBasic.php, Module.php | События install/update/enable/disable/uninstall, вызов vtlib_handler | Lifecycle реализуется в самом расширении |
| vtlib/Vtiger/PackageImport.php, PackageUpdate.php | extension в manifest, ограниченные пути, преобразование settings/* | ZIP надо строить под реальный импортёр, не просто архивировать рабочий каталог |
| vtlib/Vtiger/PackageExport.php | Поддержаны layouts/v7/modules/<Module> и Settings/<Module> | Собственные шаблоны можно включить в пакет |
| modules/Settings/ModuleManager/models/Module.php | Штатный маршрут импорта и включения/отключения | Установку требуется проверить из интерфейса |

Важные различия: в изменённых установках встречается Header.php, который отсекает ресурсы
отключённых модулей дополнительным методом isLinkOfInactiveModule; в теге 8.4.0 такой защиты нет.
Встречается и Link.php с сортировкой по sequence; в показанных запросах тега 8.4.0 её нет. Поэтому модуль обязан
сам убирать свои ссылки при disable/uninstall, проверять активность и не зависеть от
порядка глобальных ссылок. link handler также должен корректно переживать lifecycle.

Header.php проверяет file_exists для части URL до вопросительного знака. Зарегистрировать
произвольный выдуманный URL загрузчика недостаточно: путь должен пройти штатную проверку.

Viewer.php выбирает один layout; getTemplatePath ищет шаблоны внутри него. Готового
наследования «новая тема → любой отсутствующий шаблон v7» здесь нет. Не копируй весь
layouts/v7 в новый каталог и не меняй DEFAULTLAYOUT в ядре для установки модуля.

## Конкретные зависимости сторонних модулей

| Файл | Зависимость |
|---|---|
| layouts/v7/modules/ListviewColors/resources/ListviewColors.js | #table-content .listview-table tr.listViewEntries, data-id, .fieldValue .value |
| layouts/v7/modules/ControlLayoutFields/resources/ControlLayoutFields.js | #EditView, ближайшие td, Select2 старой версии |
| layouts/v7/modules/AdvancedCustomFields/resources/AdvancedCustomFields.js | tr/td, вставка полей, редакторы и загрузки |
| layouts/v7/modules/RelatedBlocksLists/resources/RelatedBlocksLists.js | .fieldBlockContainer, .fieldBlockHeader, добавление связанных блоков |
| modules/SPDynamicBlocks/resources/SPDynamicBlocks.js | #EditView, .fieldBlockContainer, .inlineAjaxSave, скрытие/блокировка полей |
| layouts/v7/modules/CTMobileSettings/resources/CTMobileSettings.js | Вставка элемента в #navbar ul.nav.navbar-nav |

Пути таблицы — относительно корня CRM dev-стенда; зависимости собственных модулей конкретной
CRM перечислены в `PRIVATE.md`. Эти наблюдения — начало реестра, а не полный список. Исследование
интерфейса не проверяло совместимость ещё не созданной темы. Состав включённых модулей меняется:
используй метаданные стенда и список модулей из `PRIVATE.md`.

## Окружение и проверка

В момент исследования локально были Node.js 24.11.0 и npm 11.6.1. Сборки ModernUI пока нет.
Официальный composer.json тега 8.4.0 требует PHP >=8.1; dev-стенд работает на PHP 8.5.
Один успешный lint под 8.5 не доказывает совместимость нового модуля с нижней границей.

У CRM dev-стенда может быть собственный инструмент приёмки (обходы, CRUD, сравнение данных, PDF,
расчёты) — где он и как запускается, сказано в `PRIVATE.md`. Это инструмент конкретной установки,
а не зависимость распространяемого пакета; его код не меняем. Для чистой 8.4 нужны самостоятельные
сценарии на синтетических данных в `tests/` этого репозитория. Код и дампы CRM в git темы не
копируются; нужные факты фиксируются в собственной документации.

## Уточнение окружения и языков

2026-10-29 планировалось направлять адрес старого стенда (Vtiger 7.1) на отдельный приватный runtime
8.4. 2026-11-01 это отменено: разработка идёт прямо на dev-стенде 8.4 через read-only подключение
исходников (`DEVELOPMENT.md`).

Проверено 2026-11-01 на dev-стенде пробным модулем:

- `checkFileAccessForInclusion()` (`vtlib/Vtiger/Utils.php`, `includes/Loader.php`,
  `includes/runtime/LanguageHandler.php`) сравнивает `realpath()` файла с корнем CRM — симлинки
  на внешний репозиторий отклоняются, bind mount проходит;
- PHP-FPM под systemd работает в собственном mount namespace (`ProtectSystem=full`); bind mount с хоста
  приходит туда writable, `nsenter -t <pid> -m mount -o remount,bind,ro` делает его read-only,
  размонтирование на хосте распространяется в namespace;
- OPcache стенда: `validate_timestamps=On`, `revalidate_freq=2`;
- `vtlib/Vtiger/PackageImport.php` тега 8.4.0 распаковывает `modules/<M>`, `settings/{actions,views,
  models,connectors,libraries,handlers}` → `modules/Settings/<M>/…`, `languages`, `layouts`, `cron` →
  `cron/modules/<M>`, `templates` → `layouts/vlayout/modules/<M>` (устаревший путь — не использовать);
- тег 8.4.0 содержит только `languages/en_us`; установки с языковыми пакетами имеют ru_ru, de_de и др.

PHP/Vue-слои темы должны иметь собственные переводы; полный перевод всех чужих модулей не возникает
автоматически от установки темы. Контракт — `I18N.md`.

## Первичные внешние источники

- [Extension Module](https://community.vtiger.com/help/vtigercrm/developers/extensions/extension-module.html).
- [Module Link и типы HEADERSCRIPT/HEADERCSS](https://community.vtiger.com/help/vtigercrm/developers/vtlib/module-link.html).
- [Консоль vtlib: импорт, обновление, удаление](https://community.vtiger.com/help/vtigercrm/developers/vtlib/console-tool.html).
- [Способы постепенного использования Vue](https://vuejs.org/guide/extras/ways-of-using-vue.html).
- [Сборка Vite для серверного приложения](https://vite.dev/guide/backend-integration.html).
- [Завершение поддержки Vue 2](https://v2.vuejs.org/eol/).
- [Переход на jQuery 4](https://jquery.com/upgrade-guide/4.0/).
- [Изменения Select2 4](https://select2.org/upgrading/new-in-40/).

Документация vtlib содержит старые примеры. Реальные методы, права, порядок вызовов и
пути пакета подтверждай на официальном теге 8.4.0 и в тесте импорта.
