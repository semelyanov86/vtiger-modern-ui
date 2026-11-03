# Стенды ModernUI

Этап 01 спроектировал стенды, этап 03 (2026-11-01) их развернул; документ описывает фактическое устройство.
DEV и подключение исходников — также `DEVELOPMENT.md`. Конкретные адреса, пути и учётные записи dev-стенда —
только в `PRIVATE.md`/`.env`.

## 1. Виды стендов и режимы

| Стенд | Режим | Назначение | Источник CRM | Исходники темы | База |
|---|---|---|---|---|---|
| dev-стенд | DEV | ежедневная разработка | локальная Vtiger 8.4 из `.env` | подключены read-only (`task crm:link`) | своя база стенда, регистрация — `task crm:install/update` |
| dev-стенд | PACKAGE | установка ZIP на реальную CRM | то же | **отключены** (`task crm:unlink`), ZIP через менеджер модулей | та же |
| чистый стенд `c81` | PACKAGE | переносимость: свежая официальная 8.4.0, PHP 8.1, корень сайта | официальный архив релиза 8.4.0 | нет, только ZIP через менеджер модулей | новая, синтетические данные |
| чистый стенд `c85` | PACKAGE | то же на PHP 8.5, установка в подкаталог `/vtigercrm/` | тот же архив | нет | новая, синтетические данные |

Чистый стенд не получает патчи, миграции и дамп dev-стенда; файлы CRM на нём не правятся (§2.6).

## 2. Чистый стенд (`dev/clean/`)

### 2.1. Состав

Docker Compose, проект `modernui-clean`, все образы закреплены digest (`dev/clean/compose.yaml`):

| Сервис | Образ | Что внутри |
|---|---|---|
| `db` | `mysql:8.4.13@sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69` | `--sql-mode=NO_ENGINE_SUBSTITUTION` (установщик требует без `STRICT_TRANS_TABLES`, `ONLY_FULL_GROUP_BY`, `NO_ZERO_*`); учётная запись `vtiger` с правом создавать базы `vtiger_*`; том `db` |
| `web81` | сборка `dev/clean/Dockerfile` от `php:8.1-apache-bookworm@sha256:a935f4a5717427519337269d5d1c89968cc27ab84d1c8d5d7b5363672d800cd5` | PHP 8.1.34, Apache + mod_php, `mod_rewrite`; расширения `mysqli`, `imap` (встроенное), `gd`, `zip`, `intl` + штатные `curl`, `mbstring`, `xml`, `simplexml`, `openssl`, `zlib`, OPcache; CRM в томе `crm81` → `/var/www/html` |
| `web85` | то же от `php:8.5-apache-bookworm@sha256:6b401f1bfa88fc9d2ae5c3ff2558f18d0c17c9801718ded725095ea29131f34b` | PHP 8.5.12; `imap` из PECL 1.0.3 (в PHP ≥ 8.4 его нет в ядре); CRM в томе `crm85` → `/var/www/html/vtigercrm` |
| `mail` | `axllent/mailpit:v1.31.6@sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387` | почтовая ловушка; SMTP `mail:1025` для обеих CRM |
| `gateway` | `nginx:alpine@sha256:1d13701a5f9f3fb01aaa88cef2344d65b6b5bf6b7d9fa4cf0dca557a8d7702ba` (1.29.5) | единственный опубликованный вход, только `127.0.0.1` |

Debian bookworm, а не trixie: расширению `imap` нужен `libc-client`, которого в trixie нет. `php.ini`
(`dev/clean/php.ini`): `display_errors=Off`, `log_errors=On`, `error_reporting=E_ALL`, `max_execution_time=0`,
`memory_limit=512M`, `output_buffering=4096` — рекомендации установщика 8.4.0.

Адреса (порты — `.env`: `MU_CLEAN_PORT`, `MU_CLEAN85_PORT`, `MU_CLEAN_MAIL_PORT`; по умолчанию 8481, 8485, 8425):

- `c81`: `http://127.0.0.1:${MU_CLEAN_PORT}/` — CRM в корне сайта, своя база `vtiger_c81`;
- `c85`: `http://127.0.0.1:${MU_CLEAN85_PORT}/vtigercrm/` — CRM в подкаталоге, своя база `vtiger_c85`;
- почта: `http://127.0.0.1:${MU_CLEAN_MAIL_PORT}/`.

`site_URL` каждой CRM записывает установщик по фактическому адресу (заголовок `Host` проходит через шлюз).

Сеть: веб-серверы, база и почта — во внутренней сети `stand` (Docker `internal: true`) без выхода в интернет;
наружу смотрит только шлюз. Это закрывает исходящие запросы ядра 8.4.0 (регистрация установщика на сервере
вендора, магазин расширений в настройках). Браузерные сценарии вдобавок обрывают любые запросы не к адресу CRM
и проверяют, что таких запросов не было (пиксель статистики установщика — единственный, он заблокирован).

### 2.2. Источник Vtiger 8.4.0

Официальный архив релиза — ссылка загрузки vtiger.com, файл на SourceForge
`vtiger CRM 8.4.0/Core Product/vtigercrm8.4.0.tar.gz`:

| | |
|---|---|
| размер | 61 169 856 байт |
| SHA-256 (закреплён в `dev/clean/clean.sh`) | `9f903946e5fe9befa8b91ff96c51518117ca0850b788dee0713b8661d4c500b3` |
| SHA-1 / MD5 | `f2aaef54f56c23ab0d6b13b90a52804ab541166f` / `360f394f5f7ffabc89eaca05b18523f9` — совпадают с опубликованными SourceForge |

Сверка с тегом `8.4.0` официального git (`0bb3774e7df04c40bc2cc81b1f910a6b1ae77be2`, `task clean:verify-source`):
файлы совпадают, кроме `vendor/` (есть только в архиве), `composer.lock` (в архиве новее: Smarty 4.5.5,
HTMLPurifier 4.18, Guzzle 7.9.3 и др.) и `install-composer-deps.sh` (только в теге). В теге нет `vendor/`: CRM
из `git archive` отвечает «Please install composer dependencies.» — допущение этапа 01 «vendor/ входит в тег»
неверно, поэтому чистый стенд ставится из архива релиза. Архив кэшируется в `.local/clean/`
(`MU_CLEAN_TARBALL` — путь к своей копии; SHA-256 проверяется всегда).

### 2.3. Установка CRM и синтетические данные

1. `task clean:up` — сборка образов, запуск, распаковка архива в пустые тома (`www-data`), генерация паролей в
   `.local/clean/secrets.env` (в git не попадает) и настроек сценариев `.local/clean/<экземпляр>.env`.
2. `task clean:install` — штатный веб-установщик (`module=Install`, шаги 1–7) проходит Playwright
   (`frontend/e2e/tools/install.spec.ts`): язык `en_us`, «Create new database» (базу создаёт сам установщик:
   `CREATE DATABASE … utf8` → `utf8mb3`/`utf8mb3_general_ci`), валюта и формат по умолчанию. Первый вход
   администратора показывает мастер «What would you like to use Vtiger CRM for?» (SystemSetup → UserSetup) —
   его проходит вход сценариев (все функции, `en_us`, UTC). Затем включается строгий журнал PHP: штатный
   `config_override.dev.php` дистрибутива копируется в `config_override.php` (E_ALL → `logs/phperr.log`); без
   него `config.php` 8.4.0 оставляет в веб-запросах только `E_ERROR`.
3. `task clean:seed` — `dev/clean/tools/seed.php` внутри контейнера, только штатные API (модели общего доступа,
   профилей, ролей, пользователей, исходящей почты; webservice `vtws_create`), без своего SQL:
   - общий доступ: Accounts (с ним Contacts), Leads, Potentials, HelpDesk — Private;
   - профиль «MU Restricted» (копия Sales Profile: без Leads и Campaigns; у Accounts скрыто «Annual Revenue»,
     «Phone» только чтение; у Contacts скрыто «Mobile»), профиль «MU View All» (просмотр всего);
   - роли «MU Restricted Sales» (под Sales Manager) и «MU Viewer» (под CEO);
   - пользователи: `mu.admin2` — второй администратор (A2), `mu.limited` — ограниченный (U), `mu.viewer` —
     полный просмотр (G); общий сгенерированный пароль;
   - исходящая почта → `mail:1025` (сохранение шлёт тестовое письмо — оно приходит в mailpit);
   - записи с кириллицей и умляутами: 5 организаций (2 у U, 2 у администратора, 1 у G), 4 контакта, 2 лида,
     2 сделки, 3 товара, услуга, заказ `Bestellung Ä-001` с двумя товарными строками (через модель записи,
     как форма: `vtws_create` для документов с позициями в 8.4.0 падает), обращение, событие, задача;
   - тестовый entity-модуль **Gadgets** (`tests/fixtures/gadgets/`, пакет vtlib по шаблону ядра) импортируется
     через «Настройки → Менеджер модулей → Импорт» и получает 2 записи — модуль, о котором ModernUI ничего не
     знает (доказательство отсутствия списка разрешённых имён).
4. `task clean:hash -- <метка>` / `task clean:meta -- <метка>` — SHA-256 файлов кода CRM (без `cache`, `storage`,
   `logs`, `test`, `user_privileges`, `tabdata.php`, `parent_tabdata.php`, `config.inc.php`, `config_override.php`)
   и метаданные базы (таблицы и collation, `vtiger_tab`, глобальные ссылки, пункты настроек, роли, пользователи,
   число записей) для сравнения до/после.

Языки: архив 8.4.0 содержит только `en_us`. Тексты темы RU/EN/DE проверяются личным выбором языка темы;
языковые пакеты ядра не ставятся.

### 2.4. Установка ModernUI на чистый стенд

Только штатные пути, без ручных правок файлов и базы:

| Действие | Команда | Как |
|---|---|---|
| установка | `task clean:import-zip` | «Settings → Module Manager → Import Module»: согласие, загрузка ZIP, лицензия, «Import Now» (Playwright, `frontend/e2e/tools/module-import.spec.ts`) |
| обновление | `task clean:import-zip` при зарегистрированном модуле | тот же экран, «Update Now» |
| выключение/включение | переключатель модуля в «Module Manager» | сценарий `clean.spec.ts` |
| удаление | `task clean:uninstall` | `php -d auto_prepend_file=vendor/autoload.php vtlib/tools/console.php --remove=ModernUI`, затем каталоги и файлы модуля по карте `dev/crm-mounts.txt`; таблицы настроек остаются (`settings.md` §10) |
| повторная установка | `task clean:import-zip` | после удаления файлов — снова «Import Now»; тема выключена, уведомление администратору, настройки восстановлены |
| полная проверка ZIP | `task clean:verify [-- путь.zip]` | **удаляет данные стенда**, затем: up → install → seed → хэши → импорт → Q2 → сценарии → обновление → удаление → повторная установка → хэши и журнал PHP; отчёт `.local/clean/verify-<время>.txt` |

Особенности ядра 8.4.0, выявленные при этом (не исправляются, обходятся штатно):

- `vtlib/tools/console.php` не подключает `vendor/autoload.php`: любая команда молча завершается с кодом 0
  (фатальная ошибка «Class "Monolog\Logger" not found» не выводится). Обход без правки файлов —
  `php -d auto_prepend_file=vendor/autoload.php vtlib/tools/console.php …`. Синтаксис — `--remove=ModernUI`
  (аргумент делится по `=`), а не `--remove ModernUI`.
- Ядро не удаляет файлы модуля; пока есть `modules/ModernUI`, менеджер модулей предлагает только «Update Now»,
  а обновление незарегистрированного модуля падает («ZIP File is corrupted or empty»). Перед повторной установкой
  каталоги модуля удаляются (так делает `task clean:uninstall`).
- Менеджер модулей предлагает «Update Now» и для той же версии: обновление ZIP той же версии допустимо.

`task clean:status` показывает регистрацию (`dev/crm-info.php` в контейнере), ссылки, пункт настроек, таблицы и
число файлов модуля; `task clean:logs` — сообщения PHP по типам и файлам, отдельно — в файлах ModernUI.

### 2.5. Проверки чистого стенда (минимум этапа 03, все выполнены — `verification.md` §3)

- импорт ZIP, тема выключена у всех; включение для администратора; страница настроек и пункт меню настроек;
- пользователь с ограниченным профилем получает тему через пилот без пересоздания привилегий (Q2);
- пилот по роли; другие пользователи не затронуты; disable/enable в менеджере модулей; update ZIP; удаление;
  повторная установка;
- RU/EN/DE текстов темы при `en_us` у CRM; «Как в CRM» → английский;
- корень и подкаталог; PHP 8.1 и 8.5; журнал PHP без сообщений из файлов ModernUI;
- хэши файлов ядра до и после — без изменений, добавлены только файлы ModernUI;
- отсутствие dev-URL, внешних адресов и путей репозитория в сетевых запросах.

### 2.6. Что считается вмешательством в чистый стенд

Разрешено: штатные экраны и API CRM (установщик, менеджер модулей, настройки, webservice), консоль vtlib,
удаление файлов модуля при удалении, `config_override.php` из штатного `config_override.dev.php` (журнал).
Запрещено: правка файлов ядра, ручной SQL, подключение `src/`, watcher, Vite dev server.

## 3. PACKAGE-прогон на dev-стенде

| Шаг | Команда / действие | Контроль |
|---|---|---|
| 1 | `task package` | ZIP, `.sha256`, `.files.txt` в `dist/`, проверки состава пройдены |
| 2 | `git -C "$CRM_ROOT" status --porcelain > .local/…/git-before.txt` | исходное состояние git CRM |
| 3 | `task crm:import-zip` | отключает исходники (`crm:unlink`) и импортирует тот же ZIP через «Настройки → Менеджер модулей → Импорт» (для зарегистрированного модуля — «Обновить»); `task crm:status`: все пути `INSTALLED` (реальные файлы), версия = версии ZIP |
| 4 | сверка файлов CRM с ZIP, поиск заглушек, путей репозитория и dev-URL | 43 файла совпадают с ZIP, заглушек нет |
| 5 | `task test:e2e` (включая проверку сети), `MU_BASELINE_LABEL=… task baseline` | сценарии зелёные; ошибок JS, неудачных запросов и новых строк журнала PHP нет |
| 6 | `git -C "$CRM_ROOT" status --porcelain` | совпадает с шагом 2 (пути ModernUI исключены блоком `.git/info/exclude`) |
| 7 | `task crm:link -- --force` | установленная копия перенесена в `.local/crm-replaced/<время>/`, подключение восстановлено, каталоги `ro` |
| 8 | `task crm:update`, если версия схемы в рабочей копии новее | регистрация соответствует исходникам |

Никогда не импортировать ZIP поверх подключённых исходников: read-only mount сорвёт распаковку на середине.

## 4. DEV на dev-стенде

Карта подключения (`dev/crm-mounts.txt`, тот же относительный путь в `src/` и в корне CRM):

| Путь | Способ | В ZIP |
|---|---|---|
| `modules/ModernUI/` | bind mount, read-only (и в namespace каждого `php*-fpm`) | `modules/ModernUI/` |
| `modules/Settings/ModernUI/` | bind mount, read-only | `settings/{actions,views,models}/` |
| `layouts/v7/modules/ModernUI/` (с `resources/dist/` сборки) | bind mount, read-only | то же |
| `layouts/v7/modules/Settings/ModernUI/` | bind mount, read-only | то же |
| `languages/<lang>/ModernUI.php`, `languages/<lang>/Settings/ModernUI.php` | PHP-заглушка с `require` файла из `src/` | то же |

Цикл: `task crm:link` → `task build` / `task dev` → правка в `src/`/`frontend/` → перезагрузка страницы.
Доказательство и замеры — `task test:devcycle` (`verification.md` §3): PHP ≈ 1,2 с (OPcache), Smarty и словари
PHP — со следующей перезагрузки, CSS и Vue — ≈ 0,2–0,3 с пересборки watcher'ом + перезагрузка; ошибка
компиляции ничего не пишет. Регистрация и миграции — `task crm:install` / `task crm:update`. Подробно —
`DEVELOPMENT.md`.

## 5. Браузерные сценарии

Лежат в `frontend/e2e/` (им нужны `node_modules` frontend, `architecture.md` §12). Стенд — переменная
`MU_E2E_TARGET`: `dev` (адрес и вход из `.env`), `c81`, `c85` (адрес и сгенерированные пароли из
`.local/clean/<экземпляр>.env`). Пароли в git не попадают; снимков, трасс и видео сценарии не пишут.

| Проект | Стенды | Что проверяет | Команда |
|---|---|---|---|
| `install` | c81, c85 | веб-установщик | `task clean:install` |
| `import` | все | импорт/обновление ZIP через менеджер модулей | `task clean:import-zip`, `task crm:import-zip` |
| `modernui` | все | настройки, «включить для меня», загрузчик и shell, системное меню, RU/EN/DE, безопасный режим, сбои frontend, стандартный вид, сеть | `task test:e2e`, `task test:e2e:clean` |
| `clean` | c81, c85 | тема выключена после импорта, пункт настроек, пилот по пользователю и роли, A2/U/G, модуль Gadgets, RU/EN/DE и fallback, запреты U, переключатель менеджера модулей, стандартный вид и безопасный режим U, сеть | `task test:e2e:clean` |
| `baseline` | все | исходное поведение экранов (метрики) | `task baseline` |
| `devcycle` | dev | правка → результат, ошибка watcher'а | `task test:devcycle` |
| `devrecord` | dev | синтетическая запись через форму с темой и её удаление | `task test:devrecord -- create`, `-- delete:<id>` |
