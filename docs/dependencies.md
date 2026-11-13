# Зависимости ModernUI

Этап 01, 2026-11-01. Выбор и обоснование; версии закрепляются точно (без `^`/`~`) в
`frontend/package.json` и `frontend/package-lock.json` на этапе 02. Этап 09 пересматривает список,
лицензии и уязвимости.

## 1. Правила

- В ZIP попадает только production-сборка; npm, Node и Vite нужны разработчику. Никаких CDN и
  внешних запросов во время работы.
- Лицензии зависимостей, попавших в сборку, — MIT/ISC/Apache-2.0/OFL-1.1; тексты лицензий собираются в
  `layouts/v7/modules/ModernUI/resources/dist/THIRD_PARTY_LICENSES.txt` (генерируется при сборке).
- Коммерческие и «source-available» пакеты запрещены (в том числе облачный `app.css` Vtiger).
- Глобальные библиотеки хоста (jQuery 2.2.4, Bootstrap 3.4.1 + TODC, Select2 3.4.8, jQuery UI 1.12,
  bootbox, qtip, CKEditor v7) не заменяются, не обновляются и не дублируются. Свой Vue — внутри
  бандла, `window.Vue` не создаётся и не используется (на некоторых страницах расширений уже есть
  глобальный Vue 2).
- Скрипты установки пакетов не выполняются (`npm ci --ignore-scripts`), кроме явно разрешённых
  в документе.

## 2. Библиотека компонентов: Reka UI + собственный набор `Mu*`

Решение: **Reka UI 2.11.0** (headless, MIT) — поведение, клавиатура и ARIA; внешний вид — собственный
небольшой набор компонентов `Mu*` в px по токенам `design.md`. План Б — Element Plus 2.14.7.

### 2.1. Как проверялось

Стенд в отдельном каталоге (вне репозитория): Vite 8.3.5 production-сборки каждого кандидата с одним
набором компонентов (Button, Input, Select с фильтром, Checkbox, Radio, Switch, Tabs, Dialog,
DropdownMenu, Tooltip, Popover, InputNumber, Slider, ColorPicker, Toast, Form с валидацией,
переупорядочиваемый список); страницы «чистая», «с CSS v7» (реальные файлы dev-стенда в порядке
`Header.tpl` + jQuery 2.2.4, Bootstrap 3.4.1 JS, Select2 3.4.8) и «с CSS v7 и HEADERCSS расширений»;
headless Chromium 1243 (Playwright 1.63.0); 29 точек замера вычисленных стилей, включая оверлеи в
`body`; обратный тест — стили элементов хоста (`.btn`, `.form-control`, `label`, `table.table`,
`.modal`, `.dropdown-menu`, `body`, `h1–h3`, `a`) до и после подключения библиотеки.

### 2.2. Сравнение (2026-11-01)

| | Reka UI | Element Plus | Naive UI | PrimeVue |
|---|---|---|---|---|
| Версия (дата) | 2.11.0 (2026-10-05) | 2.14.7 (2026-09-30) | 2.45.3 (2026-08-27) | 5.0.4 (2026-10-22); v4: 4.5.5 (2026-04-08, последняя) |
| Лицензия (файл в tarball) | MIT | MIT | MIT | **5.x — PrimeUI License** (коммерческая, ключ, запрет редистрибуции для разработки); 4.5.5 — MIT, ветка заморожена |
| CSS | нет (свой) | обычный CSS по компонентам, 122 переменные `--el-*` на `:root` | CSS-in-JS в начало `<head>`, глобальное `body{font-size:14px;font-family:…;line-height:1.6}` | CSS-in-JS в конец `<head>`, `*{box-sizing}` |
| Единицы | px (свои) | px | px | **rem** (428 токенов): при `html{font-size:10px}` Bootstrap 3 всё сжимается на 37,5 % |
| Влияние CSS v7 на компоненты (29 точек) | **0** | 11, до 23 % (шрифт, `label`); 3 правила → 0 | 5, до 16 %; 3 правила → 0 | 28, до 38 %; после замены rem на px остаётся 17 |
| Влияние библиотеки на хост | 0 | 0 | 0 при порядке по умолчанию; меняет шрифт **всей** страницы, если её стили окажутся после CSS хоста | 0 |
| Клавиатура/ARIA | лучшее: Select (`aria-activedescendant`), Dialog (ловушка фокуса, возврат), Menu, Tabs (roving, Home/End), Tooltip по фокусу | хорошо; у Tabs нет Home/End, Tooltip не по фокусу | слабо: у Tabs нет ролей и фокуса, у меню нет ARIA, у диалога нет имени | хорошо; фильтр Select с клавиатуры не сработал |
| RU/DE | своих строк почти нет — все тексты наши | `ru`/`de` есть, но 41/54 строк aria остались английскими | почти полные | внешний `primelocale` |
| JS gzip сверх Vue (Vue 24,1 КБ) | **+86,8 КБ** (вместе с DnD 14,4 КБ), CSS 1,8 КБ | +116,6 КБ + CSS 18,2 КБ | +156,0 КБ | +124,1 КБ |

Исключены также: Vuetify 4.3.1 (глобальный reset в `@layer`, все стили в слоях — проигрывают CSS v7;
rem; нужен `v-app`), Quasar 2.35.2 (глобальные `html,body`, это фреймворк, а не библиотека для чужой
страницы), Ant Design Vue 4.2.6 (нет релизов около двух лет).

### 2.3. Почему Reka UI

1. Изоляция без борьбы со специфичностью: 0 расхождений с CSS v7, 0 влияния на хост, 0 совпадений классов.
   Полные типы TypeScript (`dist/index.d.ts`) — подходит для строгого режима (§5).
2. Лучшая доступность среди кандидатов — проверено одинаково на чистой странице и на странице хоста.
3. Вид облачного Vtiger задаётся нашими токенами, а не перекраской чужой темы.
4. Все строки интерфейса — в наших словарях RU/EN/DE (`vue-i18n`), без смешения со словарями
   библиотеки, где остаются английские строки.
5. Наименьший размер.

Источники: <https://reka-ui.com>, <https://github.com/unovue/reka-ui>,
<https://reka-ui.com/docs/overview/accessibility> (WAI-ARIA Authoring Practices; подписи — за разработчиком).

### 2.4. Риски и меры

| Риск | Мера |
|---|---|
| компоненты нужно оформить самим (≈ 15–20) | набор `Mu*` в `frontend/src/components/`, CSS ≈ 7 КБ по прототипу; визуальные тесты этапа 05 |
| молодой API `Form`/`Field` (появились в 2.11.0), частые релизы | точная версия; валидация — своя тонкая обёртка, без нативной валидации (её тексты на языке браузера) |
| порталы в `<body>` вне `.mu-root` | `to="#mu-overlay-root"` у всех `*Portal` (контейнер с классом `mu-root`) |
| модальные слои Reka ставят `body { pointer-events: none; overflow: hidden }` | для меню и выпадающих в шапке — `:modal="false"`; модальность — только у своих диалогов |
| Tooltip закрывается при прокрутке страницы | учитывать в e2e-тестах; критичный текст не только в подсказке |
| Bootstrap-модалка v7 перехватывает фокус у любого оверлея (`enforceFocus`, проверено на всех кандидатах) | адаптер: оверлей, открытый из модалки, телепортируется внутрь её `.modal-content`; если это невозможно — на время открытия снимается `focusin` модалки и восстанавливается при закрытии |
| skin v7 содержит глобальное `*:focus, *:active { outline: none }` | фокус-кольца темы — `box-shadow` на `:focus-visible`, не `outline` |
| `@layer` проигрывает CSS v7 полностью (проверено: цвет основной кнопки `#fff → #333`, кольцо фокуса исчезло) | стили темы и компонентов без cascade layers (`architecture.md` §9) |

### 2.5. План Б: Element Plus 2.14.7

Если собственный набор окажется слишком дорогим на этапе 05: стили по компонентам
(`element-plus/es/components/*/style/css`), `ElConfigProvider` с `locale` и `z-index`, три правила
против влияния v7, `default-first-option` у Select, дополнить английские aria-строки ru/de своими.
Цена: +30 КБ JS, +18 КБ CSS, 122 глобальные переменные `--el-*`, перекраска под облако.

## 3. Список зависимостей

Этап 10 (2026-11-07) добавил `@fontsource/poppins` 5.3.0 и `@fontsource/arimo` 5.3.0 (OFL-1.1, опубликованы 2026-07-19, без
зависимостей и install-скриптов; `npm install --save-exact --ignore-scripts`); их LICENSE попадают в `THIRD_PARTY_LICENSES.txt`
(`extraPackages` плагина сборки), тест пакета проверяет обе записи. В ZIP — только 8 woff2 (Poppins 4 × ≈8 КБ, Arimo 4 × 7–20 КБ).

Состояние этапа 02 (2026-11-01): версии ниже закреплены точно в `frontend/package.json`, дерево — в
`frontend/package-lock.json`; установка — `npm ci --ignore-scripts` (`task fe:install`). Ещё **не
установлен** (появится с использующим его кодом): `axe-core` (проверки доступности, этап 19). Этап 05 (2026-11-04)
установил `vue-draggable-plus` 0.6.1 и `sortablejs` 1.15.7 (MIT; в lockfile три пакета вместе с `@types/sortablejs`
1.15.8 — только типы) — они попадают только в chunk `editor` страниц модуля, shell их не загружает. Добавлены: `@types/node` 24.19.2 (типы конфигурации
сборки, тестов и e2e). `THIRD_PARTY_LICENSES.txt` генерирует плагин сборки по модулям chunk'ов
(+ шрифт и пакет `vue`, чей код приходит через `@vue/*`); лицензия вне списка MIT/ISC/Apache-2.0/OFL-1.1/
BSD-2/3-Clause или пакет без файла лицензии останавливает сборку. В сборку этапа 02 входят: `vue`/`@vue/*`
3.5.44, `vue-i18n`/`@intlify/*` 11.4.x, `reka-ui` 2.11.0 (+ `@floating-ui/*`, `@vueuse/*`, `aria-hidden`,
`defu`), `@lucide/vue` 1.66.0, `@fontsource-variable/inter` 5.3.0 (подмножества latin, latin-ext, cyrillic,
cyrillic-ext). Lint PHP 8.1 — `php:8.1-cli@sha256:76e563191d1ade120313a8736df24154d21da5155c0756f147c0b01bd19d9087`
(PHP 8.1.34). ESLint 10 читает `eslint.config.ts` встроенным в Node 24 удалением типов
(`--flag unstable_native_nodejs_ts_config`), без `jiti`.

### 3.1. Попадают в сборку

| Пакет | Версия | Лицензия | Назначение |
|---|---|---|---|
| `vue` | 3.5.45 | MIT | рантайм островов |
| `reka-ui` | 2.11.0 | MIT | поведение компонентов; транзитивно `@floating-ui/vue` 2.0.1, `@internationalized/date`, `@internationalized/number`, `@vueuse/core` (MIT, через lockfile) |
| `vue-i18n` | 11.4.18 | MIT | переводы; runtime-only, сообщения прекомпилированы (+16,6 КБ gzip с тремя локалями) |
| `vue-draggable-plus` + `sortablejs` | 0.6.1 + 1.15.7 | MIT | перетаскивание в редакторе меню (только мышь/касание; клавиатура — кнопками и `Alt+↑/↓`); установлены на этапе 05, chunk `editor` |
| `@fontsource/poppins` | 5.3.0 | OFL-1.1 | шрифт облачного вида (этап 10, `design.md` §13.4): только начертания облака 400/600, подмножества latin (ä ö ü ß) и latin-ext; официальные файлы Google Fonts / Indian Type Foundry в упаковке Fontsource |
| `@fontsource/arimo` | 5.3.0 | OFL-1.1 | закреплённая кириллица облачного вида: метрически совместим с Arial (облако рисует кириллицу Arial); подключается только при отсутствии системного Arial (`local()` первым), начертания 400/700, подмножества cyrillic и cyrillic-ext |
| `@fontsource/open-sans` | 5.3.0 | OFL-1.1 | шрифт системных настроек (этап 15, `design.md` §13.11): облако рисует настройки (layout v8) Open Sans в одном начертании Regular; в пакете — 400 normal, подмножества latin, latin-ext, cyrillic, cyrillic-ext (4 woff2, ~63 КБ), браузер загружает их только на страницах настроек; официальные файлы Google Fonts в упаковке Fontsource, опубликованы 2026-07-19 |
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | шрифт настройки `appearance.font = inter` (до 0.8.0 — по умолчанию); браузер загружает его только при этом выборе |
| `@lucide/vue` | 1.69.0 | ISC | значки групп меню и элементов темы (tree-shaking, только разрешённый набор) |

### 3.2. Только для разработки

| Пакет | Версия | Лицензия | Назначение |
|---|---|---|---|
| `vite` | 8.3.6 | MIT | сборка (Rolldown); цель CSS — браузеры с `:has()` (§8) |
| `@vitejs/plugin-vue` | 6.0.10 | MIT | SFC |
| `@intlify/unplugin-vue-i18n` | 11.2.8 | MIT | прекомпиляция словарей |
| `typescript` | 6.0.3 | Apache-2.0 | строгая типизация (§5); 7.x (нативный компилятор) не берётся: `typescript-eslint` 8.72.1 требует `typescript >=4.8.4 <6.1.0`, совместимость `vue-tsc` с 7.x не подтверждена |
| `vue-tsc` | 3.3.14 | MIT | проверка типов SFC (`typescript >=5.0.0`) |
| `@vue/tsconfig` | 0.9.1 | MIT | базовый `tsconfig` для Vue |
| `eslint` | 10.14.0 | MIT | линтер |
| `typescript-eslint` | 8.72.1 | MIT | правила `strictTypeChecked` + `stylisticTypeChecked` |
| `eslint-plugin-vue` | 10.12.0 | MIT | правила SFC (`flat/recommended`) |
| `@vue/eslint-config-typescript` | 14.9.0 | MIT | связка Vue + typescript-eslint |
| `sass-embedded` | 1.107.1 | MIT | SCSS для skin |
| `vitest` | 5.1.0 | MIT | unit-тесты (локали, слияние настроек на клиенте, адаптеры) |
| `happy-dom` | 21.0.4 | MIT | DOM для unit-тестов runtime островов (`// @vitest-environment happy-dom`, этап 04); в сборку не попадает |
| `@playwright/test` / `playwright` | 1.63.0 | Apache-2.0 | e2e; 1.63.0 использует Chromium build 1243 (1.64.x требует 1248) |
| `axe-core` | 4.14.0 | MPL-2.0 (только тесты, в ZIP не попадает) | проверки доступности в e2e (`quality`, этап 19) |
| `minimatch` (override) | 11.0.5 | BlueOak-1.0.0 (только инструменты) | транзитивная зависимость ESLint и typescript-eslint; `overrides` закрывает GHSA-g3hv-75wg-m249 (§7) |

PHP: собственных composer-зависимостей у пакета нет (используются только классы ядра Vtiger 8.4).
Lint PHP 8.1 — официальный Docker-образ `php:8.1-cli` с закреплённым digest (см. начало §3).

## 4. i18n

- `vue-i18n` в режиме Composition API (`legacy: false`), runtime-only: в бандле сообщения лежат как AST,
  нет `new Function`/`eval`; проверено под `Content-Security-Policy: script-src 'self'` — 0 нарушений.
- Русское множественное число: собственная функция `pluralRules['ru-RU']` на `Intl.PluralRules('ru')`
  (категории one/few/many → индексы 0/1/2); стандартное правило vue-i18n даёт «1 записи, 21 записей».
  Немецкий — стандартное правило.
- `fallbackLocale: 'en-US'`; `missingWarn`/`fallbackWarn` выключены в production, включены в тестах
  (там отсутствие перевода — ошибка).
- Источник: <https://vue-i18n.intlify.dev/guide/advanced/optimization.html>,
  <https://vue-i18n.intlify.dev/guide/essentials/pluralization.html>.

## 5. TypeScript и строгая типизация (решение мейнтейнера 2026-11-01)

Весь код `frontend/` — TypeScript в строгом режиме; `.js` допускается только для `loader.js` (ES5,
вне сборки, проверяется `tsc --checkJs` с `// @ts-check` и тем же `strict`).

- `tsconfig`: `strict: true` (включает `noImplicitAny`, `strictNullChecks`,
  `useUnknownInCatchVariables` и др.), а также `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`,
  `isolatedModules`; `skipLibCheck` только для `node_modules`.
- SFC — `<script setup lang="ts">`, типизированные `defineProps`/`defineEmits`/`defineModel`,
  `vue-tsc --noEmit` без ошибок.
- ESLint (`typescript-eslint` `strictTypeChecked`): запрещены `any` (явный и неявный),
  небезопасные `as`-приведения к широким типам, `@ts-ignore` (только `@ts-expect-error` с
  объяснением), неиспользуемые переменные, «плавающие» промисы.
- Граница с сервером: ответы PHP (`Bootstrap`, настройки, ошибки `MU_*`) описаны типами в
  `frontend/src/api/types.ts` и проверяются **во время работы** собственными функциями-гардами по
  схеме `settings.md` §7 — данные из сети имеют тип `unknown` до проверки; никаких `as Bootstrap`.
  Несовпадение схемы → ошибка `MU_BAD_RESPONSE`, остров не монтируется, v7 остаётся.
- Глобальные объекты хоста (`window.app`, `jQuery`, `_META`, `_USERMETA`, `csrfMagicToken`) описаны
  минимальными `declare`-типами в `frontend/src/adapters/v7/host.d.ts` и читаются только через
  адаптер с проверками существования.
- Ключи переводов типизированы схемой словаря `en-US` (vue-i18n `DefineLocaleMessage`): опечатка в
  ключе — ошибка компиляции; словари `ru-RU`/`de-DE` обязаны иметь ту же форму.
- `task lint` (этап 02) включает `vue-tsc --noEmit` и `eslint` с нулём предупреждений
  (`--max-warnings 0`); сборка ZIP не выполняется при ошибках типов.

## 6. Отдельные вопросы глобальных библиотек хоста

| Библиотека хоста | Что важно для темы |
|---|---|
| Bootstrap 3 CSS (`html{font-size:10px}`, normalize, `label{font-weight:bold}`) | только px; наследуемые свойства задаются на `.mu-root` |
| Bootstrap 3 JS modal + переопределение `enforceFocus` в `application.js` | адаптер фокуса (§2.4) |
| skin v7 `*:focus,*:active{outline:none}` | кольца через `box-shadow` |
| Select2 3.4.8 (`.select2-drop` z-index 9999), jQuery UI, pnotify (до 10000) | не трогаются; свои оверлеи ниже их, кроме собственных модальных окон, где Select2 не используется |
| jQuery 2.2.4 + migrate 1.4.1 | свой код не использует jQuery, кроме адаптера v7 (подписки `app.event`, события модалок) |
| `JSON.parse('')` → `null` (переопределение v7) | клиент API не полагается на исключение |

### 6.1. Карта глобальных библиотек хоста (этап 19, чистая 8.4.0)

Версии прочитаны из файлов официального архива 8.4.0 (`layouts/v7/lib`, `libraries`). ModernUI их не заменяет, не
обновляет и не подключает повторно; второй экземпляр ни одной из них новым компонентам не нужен (Vue, Reka UI и
значки — внутри собственного бандла, `window.Vue`/`window.$` не создаются). Возможная миграция — отдельный проект
CRM, вне lifecycle модуля: установка, обновление и удаление ModernUI ничего из этого не трогают.

| Библиотека | Версия 8.4.0 | Чем пользуется ModernUI | Что блокирует миграцию CRM |
|---|---|---|---|
| jQuery + jQuery Migrate | 2.2.4 + 1.4.1 | только через адаптер v7: `app.request` (AJAX с csrf-magic), `app.event` (шина событий), запуск `Vtiger_Detail_Js`/`Vtiger_Edit_Js`/`Vtiger_RelatedList_Js` для окна записи | ядро и расширения опираются на удалённые в 3.x API (`.bind/.delegate`, `.size()`, синхронный `ready`, `jQuery.parseJSON`), Migrate 1.x маскирует их; `$.globalEval` исполняет скрипты AJAX-видов (нужен `'unsafe-eval'` в CSP, §8 verification) |
| Bootstrap JS/CSS + TODC | 3.4.1 | модальное окно `#overlayPageContent` ядра (окно записи), `.modal`/`.dropdown` не переопределяются; CSS-изоляция темы — §6 | шаблоны v7 построены на сетке и компонентах BS3 (`panel`, `well`, `data-toggle`, `col-xs-*`); BS5 меняет атрибуты (`data-bs-*`), убирает jQuery-плагины и `html{font-size:10px}` |
| Select2 | 3.4.8 | только оформление (`.select2-*` в skin), поведение и события не трогаются | API 4.x несовместим (`initSelection`, `query`, скрытый `input` вместо `select`), его использует валидатор и все поля ссылок/списков |
| jQuery UI | 1.12.0 (custom) | не используется | `sortable`/`datepicker` в редакторах ядра и расширений; 1.13 — исправления безопасности без смены API |
| jQuery Validation + bootstrap-tooltip | 1.13.1 | ошибки полей только оформляются, валидатор остаётся источником | правила и сообщения ядра (`Vtiger_Validator_Js`) |
| bootbox / pnotify / qtip2 | 2.4.2 / 1.2.0 / 2.2.1 | подтверждения и уведомления ядра только оформляются | глобальные вызовы из сотен мест ядра и расширений |
| CKEditor | 4.3.1 | не стилизуется (этап 08) | 4.x без поддержки поставщика, 5.x — другой API и лицензия; исполняет строки (`'unsafe-eval'`) |
| FullCalendar + moment | 3.1.0 + 2.10.2 | внутренности не меняются (этап 17) | API 5/6 несовместим с `Calendar_Calendar_Js` |
| floatThead, perfect-scrollbar, mCustomScrollbar | 1.2.13, 0.6.5, 3.0.4 | после сбоя оболочки загрузчик посылает `resize`, чтобы они пересчитали геометрию (этап 19) | инициализация из шаблонов списков ядра |
| gridster, jqPlot, handsontable, webui-popover, timepicker | 0.5.6, 1.0.2, 0.15.1, 1.1.3, 1.8.1 | только оформление контейнеров | виджеты панели, отчётов, импорта |
| Vue 2 расширений (на части установок) | у расширения | глобальный Vue не создаётся и не используется | — |

Вывод: новые компоненты ModernUI не требуют замены или второго экземпляра глобальных библиотек. Обновление jQuery,
Bootstrap или Select2 сломало бы ядро и расширения раньше, чем тему; ModernUI зависит только от перечисленных точек
адаптера, и их список — граница будущей миграции.

## 7. Аудит зависимостей этапа 19 (2026-11-12)

Источники: npm registry (`npm view <пакет> time`, `npm outdated`), `npm audit`, GitHub Advisory Database
(`gh api /advisories?ecosystem=npm&affects=<пакет>`), release notes Vite 8.3.6–8.3.8, файлы lucide до и после.

- **Правило обновления:** совместимые версии (тот же major) не моложе 7 дней на дату решения; более свежие — только
  при исправлении безопасности. Major-обновления ради `npm audit` не делаются. Скрипты установки не выполняются.
- **Обновлено:** `vue` 3.5.44 → 3.5.45, `vue-i18n` 11.4.16 → 11.4.18 (`@intlify/*` 11.4.18), `@lucide/vue` 1.66.0 → 1.69.0,
  `vite` 8.3.5 → 8.3.6, `vitest` 5.0.5 → 5.1.0, `@types/sortablejs` 1.15.8 → 1.15.9; добавлен `axe-core` 4.14.0 (dev).
  Геометрия всех значков, которые использует тема, в lucide 1.69 не изменилась (изменены 14 других значков; переименованный
  `circle-alert` сохранён псевдонимом `CircleAlert` с той же геометрией). skin.css после обновления байт-в-байт тот же.
- **Не обновлено, с причиной:** `typescript` 7.x (диапазон `typescript-eslint` < 6.1), `@types/node` 26 (среда — Node 24),
  `@playwright/test` 1.65 (принятые визуальные baseline привязаны к Chromium 1243 из 1.63, смена браузера требует
  пересмотра, `visual-acceptance.md`); моложе 7 дней — `vite` 8.3.7–8.3.8, `vue-i18n` 11.4.19, `@lucide/vue` 1.70–1.72,
  `@vitejs/plugin-vue` 6.0.11, `eslint-plugin-vue` 10.12.1, `typescript-eslint` 8.72.2, `sass-embedded` 1.108.x (исправлений
  безопасности среди них нет; пересмотр — этап 21).
- **Известные уязвимости:** в зависимостях сборки (`npm audit --omit=dev`) — 0. В используемых версиях уже исправлены
  GHSA-8rc2-428q-7ww3 и GHSA-83rm-6c8r-g728 vue-i18n (≥ 11.4.14; тема к тому же не выводит переводы как HTML и не использует
  `escapeParameter`), уязвимости dev-сервера Vite 2026-10 (≥ 8.3.3; dev-сервер в проекте не запускается). В инструментах
  разработки было 9 moderate по одной причине — `minimatch` 10.2.6 (GHSA-g3hv-75wg-m249, DoS шаблонами glob) через
  ESLint/typescript-eslint; исправленной 10.x нет. `overrides` → `minimatch` 11.0.5: ESLint проверяет тот же набор из 137 файлов
  с тем же набором правил, ошибка-проба обнаруживается; `npm audit` — 0.
- **Лицензии:** в ZIP — только MIT/ISC/OFL-1.1 (`THIRD_PARTY_LICENSES.txt`, проверка сборки и теста пакета); MPL-2.0
  (`axe-core`) и BlueOak-1.0.0 (`minimatch`) — только инструменты разработки, в ZIP не попадают.

## 8. Цель сборки CSS (этап 19)

Skin и острова используют `:has()`, поэтому поддерживаемые браузеры начинаются там же: Chrome/Edge 105, Firefox 121,
Safari 15.4. Прежняя цель `es2020` заставляла Lightning CSS дублировать каждое правило с `:is()` как `:-webkit-any()`
(специфичность у них разная: Chromium и WebKit применяли обе копии, Firefox — одну). `cssTarget` теперь равен этому
минимуму: skin 634 → 461 КБ (gzip 42,6 → 38,8 КБ); после переноса двух условий `:has()` в адаптеры (`verification.md` «Этап 19») — 449 КБ. Эквивалентность доказана на чистом PHP 8.1: на 18 состояниях (списки,
окно записи и формы поверх списка, мега-меню, карточки, формы, inventory, календарь, отчёты, настройки, страница
ModernUI, предпочтения, 1440/1024/412) старый и новый skin подменялись на одной загруженной странице — вычисленные стили
всех элементов и `::before/::after` совпали полностью (≈ 23 000 элементов, 0 различий).
