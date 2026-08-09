# SKAZ / Lampac — точная архитектура (без «E-Online»)

> Статус: АУДИТ (09.08.2026). Код по этому документу ещё не менялся.
> Источники: `eonline-deob3.js` (независимая нормализация, 1236 строк string-table,
> rotation=458 подтверждён checksum 0xf3481, 3839 decoder call раскрыто),
> `E-ONLINE-REPORT.md`, `E-ONLINE-LIVE.md`, `E-ONLINE-INTEGRATION.md`,
> `SKAZ-REPORT-12.md`, `skaz-scan-20260808161521.json`, живые E2E в прод-конфиге.

---

## 0. Тезис

**«E-Online» — это не сервер.** Это браузерный плагин (клиент), который
сам ходит в skaz-кластер (skaz = Lampac-совместимый REST-бэкенд,
`skaz.tv/lite/*`). Никакого промежуточного «E-Online API» в цепочке нет.

Значит **Maniya без E-Online возможна** — и фактически уже работает:
текущий `EoClient` ходит напрямую в `online3.skaz.tv` / `online8.skaz.tv`
и IP `94.249.239.{63,37,11}` / `77.90.33.109` (конфиг `EO_HOSTS` — это
skaz-кластер, а не «сервис E-Online»).

Что плагин E-Online делает поверх кластера:
1. ротация хостов бэкенда (пул `_0x49c7b8`);
2. discovery через `lite/withsearch`;
3. выбор балансера (`lite/<balancer>?…`) и разбор карточек `data-json`;
4. разворачивание `method:play|call|link` в конечный поток;
5. RCH (WebSocket) для `{"rch":true}`-источников — пропускаем.

---

## 1. Схема запроса (playback)

```
Lampa (Interface) ─▶ Maniya API ─▶ SkazClient (= нынешний EoClient)
                                     │  ротация: online3/8.skaz.tv → IP-пул
                                     │  auth:    account_email + uid (в URL)
                                     │  stream:  Origin: http://lampa.mx (на манифест)
                                     ▼
                    HOST + "lite/withsearch"                 (discover, не обязат.)
                                     │  → JSON-список доступных balancers
                    HOST + "lite/<balancer>?title=&id=&imdb_id=&serial=&year=
                                     │         &source=tmdb&clarification=0&similar=false
                                     │         &account_email=&uid="
                                     ▼
               HTML: <div class="videos__item" data-json='…'>
                                     │
        ┌──────────────┼───────────────────────────┐
   method:play       method:call                method:link
        │              (Rezka/Alloha/…)            (HDVB/Kinopub/Geo…)
        │              │                          │
   url = прямой CDN  url = HOST + "/lite/<bs>/     GET url → новый data-json
   werkecdn.me ─       movie|serial?&id&t&s&e"      ├─ повтор play/call
   cdnsqu.com          │                          │
   api.rstprgapipt.com │ "…m3u8?&play=true" (Origin) │
   dl.yama.scts.tv     ▼ 302 → voidboost.one       └─ до карточки с манифестом
   cdntogo.net       *.stream.voidboost.one/
                        <tok>/…:hls:manifest.m3u8

   ⚠ Если прямое GET с VPS падает → FALLBACK:
      "https://online8.skaz.tv/?url=" + encodeURIComponent(исходный url)
      (деобф: _0xe42cc6 = "https://online8.skaz.tv/?url=")
```

## 2. Карточка → поток (контракт `data-json`, из scan-2026)

| method | url | stream | quality | translate | что делать |
|---|---|---|---|---|---|
| `play` | CDN-прямой: `chache08.werkecdn.me/s/FH…`, `ru-sant-p.werkecdn.me`, `api.rstprgapipt.com/content-router/…`, `dl.yama.scts.tv/…` | — | `2160p/…/480p` | «Дубляж [Rus, 4K/…]» | отдать плей-листу как есть |
| `play` | `HOST/proxy/…` (kinoflix, vkmovie, …) | — | `2160p/…/144p` | перечень | поток через skaz-прокси хоста |
| `play` | `HOST/lite/…torrent…` (pidtor) | — | — | Дубляж, Сербин… | торрент-tr (не манифест!) |
| `call` | `HOST/lite/rezka/movie?…&t&s` | `HOST/lite/rezka/movie.m3u8?…&play=true` | — | «Дубляж» | server-side follow → voidboost |
| `call` | `HOST/lite/alloha/video?t=&token_movie=` | … | — | «Проф. многоголосый» | **динамический token_movie** на карточку |
| `link` | `HOST/lite/hdvb?kinopoisk_id=` · `lite/kinopub?postid=` · `lite/geosaitebi?title=` · `…` | — | — | — | второй шаг: открыть → новые карточки |
| `rch` | ‒ | ‒ | ‒ | ‒ | `{"rch":true}` → только WS; пропуск |

## 3. Авторизация / headers (что точно нужно)

| Параметр / заголовок | обязательно | источник |
|---|---|---|
| `account_email` в URL | **да** (общий пул) | INTEGRATION §1, REPORT §9 |
| `uid` в URL | **да** | INTEGRATION §1 |
| `Origin: http://lampa.mx` на `lite/*` и потоки | **да** для манифестов | INTEGRATION §1, LIVE |
| `X-Kit-AesGcm` (значение `Lampa.Storage.get('aesgcmkey','')`) | **нет**: `lite/*` работает без (проверено E2E). Нужен для `externalids` и доп. эндпоинтов | REPORT §9 |
| `memkey` | нет (не нужен) | REPORT §9 |
| контекст `{api:"lampac", localhost:<хост>, apn:"https://apn.watch/"}` | нет — это client-side интерфейс плагина, беку не передаётся | deob |

Ключевой вывод: `X-Kit-AesGcm`, `memkey` и контекст `api:"lampac"` не являются
условием для `lite/*` — базовый REST работает и без них (проверено живым
E2E). Плагин использует их для `externalids` и интерфейсных вызовов.

## 4. Классификация хостов (пул `_0x49c7b8`)

| Хост | класс* | эмпирика |
|---|---|---|
| `oleg6.skaz.tv` | (A/B) бэкенд-кандидат | в пуле; `.skaz.tv` = тот же кластер; probe |
| `94.249.239.{63,37,11}`  `77.90.33.109` | **(A) бэкенд** | live 200 (REPORT / E2E) |
| `online3.skaz.tv` | **(A) бэкенд** | live 200, основные запросы |
| `online8.skaz.tv` | **(A) бэкенд** + **(E) proxy-fallback** (`?url=`) | live; деоб `_0xe42cc6` |
| `z01.click` | (B/D) blade/сменный CDN — probe | в пуле, не в allowlist |
| `cdn2site.com` | (B/D) CDN — probe | в пуле |
| `laptostack.org`, `sambray.org`, `jeleyka.balelbrus.com`, `ru.mir-kino.pp.ru` | (B/D) CDN-лопасти — probe | в пуле |
| `static.voidboost.org` | **(D) CDN манифестов Rezka** | живые 302 на voidboost.one |
| `188.114.97.11` (Cloudflare) | (B) вход, не основной бэкенд | REPORT |
| `werkecdn.me` | **(D) CDN Filmix** | `chache08.*`, `ru-sant-p.*` |
| `vkvideo.cloud` | **(D) CDN VK-video** | vkmovie/alloha cards |
| `yama.scts.tv` | **(D) CDN Solntse/Yama** | `dl.yama.scts.tv` — прямой m3u8/mp4 |

\* A = бэкенд (кластер, `lite/*`) · B = прослойка/blade · C = RCH-бэкенд
(для нас пока нет) · D = source/CDN · E = proxy-fallback через skaz.

Класс **C (RCH-бэкенд)** определяется не по хостам, а по ответу
`{"rch":true,"ws":"…","nws":"…"}` и обмену через `/rch/<action>?id=` +
`RchRegistry/RchClient/NwsClient` (есть в деобе). Пока не реализуется.

## 5. Что Maniya должна делать, чтобы быть «без E-Online»

1. **Бэкенд-пул**: `SKAZ_HOSTS = online3.skaz.tv, online8.skaz.tv, 94.249.239.{63,37,11},
   77.90.33.109`; ротация при 503/302/timeout → следующий. (уже есть в `eonline`).
2. **auth**: `account_email` + `uid` в каждый lite-URL; `Origin` на манифесты. (уже есть).
3. **discover**: `GET HOST/lite/withsearch` → доступные balancers (fallback — стат. список).
4. **`lite/<balancer>`** с полным набором параметров поиска (incl. `kinopoisk_id`, `id`,
   `imdb_id`, `title`, `original_title`, `year`, `serial`, `source=tmdb`, `clarification=0`,
   `similar=false`).
5. **карточки `data-json`**: `play` / `call` / `link`:
   - `call` — дожать `url` (Rezka: `stream` карточки + `movie.m3u8?play=` → 302 voidboost;
     Alloha: `token_movie` **динамический по карточке**, не один статический);
   - `link` — повторный GET новой страницы до `play`/`call`.
6. **внешний резолв через наш proxy** — конечный CDN обязан быть в allowlist
   (`proxy.allowHosts` / `httpAllowHosts`). Redirect-проверка на каждый шаг.
7. **fallback-поток**: `http://online8.skaz.tv/?url=<enc>` на случай rate/ASN-блокировок
   прямых с VPS; добавить как второй шаг `proxy`, только для легитимных источников.
8. **классификация**: метод карточки → StreamItem (`method:play` — готовый стрим;
   `call`/`link` — резолвить до манифеста). Sources с `rch:true` — в «будущем».

## 6. План по файлам (реализация Skaz-слоя) — НЕ выполнять без ОК

1. `server/src/providers/skaz/SkazClient.js` — из `EoClient`:
   ротация пула + health, `discover()`, `lite/<balancer>`, `link`-follow,
   `call`-resolve (m3u8→voidboost/skaz), optional `X-Kit-AesGcm` и proxy-fallback `?url=`;
   параметры из `config.skaz`.
2. `…/normalizer.js` — card-контракт (`data-json`): method, quality-string→map,
   перевод, ссылки для follow. Не дублировать существующие нормализаторы.
3. `…/SkazProvider` + адаптеры (`filmix`/`alloha`/`rezka`/…) — единый клиент,
   по одному адаптеру на метод карточки; registry тот же, native-дубли не отражаем.
4. `store.js`/`routes` — provider-id `eonline-*` → `skaz-*`; решить twin-логику
   (оставить как политику fallback или удалить за нож).
5. `config.js` — переименовать `eonline` → `skaz` (`hosts/balancers/accountEmail/uid/origin`),
   env-алиас `EO_*` → `SKAZ_*` (secrets только в `/opt/maniya-online/server/.env`).
6. **Tests**: live `skaz.test.js` + unit `skaz-client.test.js`; тест-матрица прод.
7. Docs — переименование E-ONLINE-*> в текст «Skaz-Cluster» (не трогая блоки истории).

### Twin fallback — критерий УСПЕХА Skaz (решение 09.08)
- Успех Skaz = **≥1 валидный source ПОСЛЕ нормализации** (не «HTTP 200» и не «есть HTML/data-json»).
- Для playback-sensitive flow — **≥1 успешно resolved playable stream**.
- Если карточки есть, но все стримы не разрешаются/битые → **native fallback**.
- Никаких дублей: Skaz выиграл → native не показываем; Skaz пуст/бит → native.

Секреты: `account_email`/`uid` не печатать, не логировать, не коммитить —
только `server/.env` (или `SKAZ_ACCOUNT_EMAIL`/`SKAZ_UID`) и в гит «длины».

## 6.5 Происхождение account_email + uid (критический teardown, 09.08)

### Что показала деобфускация
- `_0x49e98d = "dg4x у2tj"`; `Lampa.Storage.set("lampac_unic_id", _0x49e98d)` —
  **uid ЗАХАрдкожен константой в код плагина** (не генерируется, не регистрируется).
- `account_email = "nazarov6@gmail.com"` — единственный email в дампе кода
  (захардкожен; берётся из `Storage.get('account_email','')`, пишется в каждый URL).
- `cub_id = Lampa.Utils.hash(account_email)` — привязка к подписке (cub/lp).

**Что показал живой probe (VPS, один и тот же запрос lite/filmix Интерстеллар):**

| вариант | HTTP | data-json | тело |
|---|---|---|---|
| верная пара | 200 | **4 карточки play** | HTML с 2160p/1440p/1080p/720p |
| только uid | 200 | 0 | `{"accsdb":true,"msg":"Аккаунт не найден"}` |
| только email | 200 | 0 | то же |
| без обоих | 200 | 0 | то же (`withsearch` → «Войдите в аккаунт Настройки — Синхронизация») |
| random email+uid | 200 | 0 | `{"accsdb":true,"msg":"Аккаунт не найден"}` |

**ВЫВОД:** skaz-кластер **проверяет соответствие email↔uid в своей accsdb**
(база аккаунтов/подписок). Это НЕ статистика/клиент-идентификация — без верной
пары источник вообще не отдают (даже отличную форму). Ошибка приходит не HTTP-кодом,
а JSON `{"accsdb":true}` в теле — наш `isUsablePage()` уже пропускает это как null.

**Значит:**
- Эти два значения — **конкретные учётные данные существующего аккаунта** кластера
  (формат Lampac: `unic_id` = id аккаунта/устройства, `account_email` = email аккаунта;
  CUB — подписочная связка внутри Lampac-экосистемы).
- Механически переименовывать `EO_ACCOUNT_EMAIL → SKAZ_ACCOUNT_EMAIL` **можно как имена
  переменных** (значения остаются), а вот полагать «любой email+uid сработает» — НЕТ.
- В коде плагина НЕТ register/create: аккаунт создаётся через вход «Настройки →
  Синхронизация» в Lampa (ввод email/пароль → кластер выдаёт/привязывает unic_id +
  подписку). Для Maniya это внешний шаг получения **своего** аккаунта.

## 6.6 MINIMUM INDEPENDENT SKAZ CONFIG (результат analysis)

| параметр | обяз.? | источник | стат/дин. | Skaz/E-Online | в .env |
|---|---|---|---|---|---|
| `SKAZ_ACCOUNT_EMAIL` (account_email) | **да** | твой аккаунт на кластере (вход через Lampa «Синхронизация») | статич. | **Skaz** | да |
| `SKAZ_UID` (= lampac_unic_id) | **да** | тот же аккаунт (выдаётся при входе/синхронизации) | статич. | **Skaz** | да |
| `SKAZ_HOSTS` (ротация пула) | да | online3/8.skaz.tv + IP | статич. | Skaz | да |
| `SKAZ_BALANCERS` | нет | discover `lite/withsearch` (или статический список) | статич./дин. | Skaz | опц. |
| `Origin: http://lampa.mx` | да (манифесты) | фикс. заголовок | постоян. | Skaz | нет (константа) |
| `X-Kit-AesGcm` / `memkey` | нет | — | — | E-Online only | нет |
| `cub_id` | нет | вычисл. hash(email) | — | Lampac-подписка | нет |

**Минимум: `SKAZ_ACCOUNT_EMAIL` + `SKAZ_UID` + `SKAZ_HOSTS` + Origin — больше ничего
от Maniya не требуется, чтобы жить Maniya → Skaz → sources.**
Проверено: с верной парой — полный HTML (4 карточки, качества 2160p/…/480p);
с неверной/частичной — HTTP 200 но `{"accsdb":true,"msg":"Аккаунт не найден"}` и 0 карточек.

## 6.7 Можно ли получить собственную пару — teardown (09.08)

### A. Что доказано КОДОМ
- `_0x267bd9()` — единая точка вставки auth в любой URL:
  `account_email=nazarov6@gmail.com` (захардкожен как строка `encodeURIComponent("nazarov6@gmail.com")`);
  `uid=Storage.get('lampac_unic_id')` (значение dg4xu2tj записывает `Storage.set` в инициализации).
- В деобе **вовсе нет** `register/create/login/sync/activate/createAccount/аккаунт-UI`
  (grep «register», «login», «sync», «create» отвечают только DOM/map; «activate» — пусто).
- `account_email`/`unic_id`/`profile_id` читаются из `Lampa.Storage`, `nws_id` — из RCH.
- Endpoints в коде: только `lite/events?life=true` и `lite/withsearch` (всё остальное
  `lite/<balancer>` собирается из строки balanceа при каждом запросе).
- `cub_id = Lampa.Utils.hash(account_email)` — подписной маркер (Lampa/кластер CUB).

### B. Что доказано live probe (VPS 09.07, lite/filmix Интерстеллар)
| пара | cards | тело |
|---|---|---|
| **настоящая (email+uid из плагина)** | **4 play** | HTML с качествами |
| только uid / только email / пусто | 0 | `{"accsdb":true,"msg":"Аккаунт не найден"}` |
| random email+uid / формат-валидная чужая | 0 | то же |
| **верный uid + чужой email** | **0** | — |
| **верный email + чужой uid** | **0** | — |
| `lite/withsearch` без auth | — | `{"accsdb":true,"msg":"Войдите в аккаунт Настройки — Синхронизация"}` |

### C. Предположения
- «Настройки — Синхронизация» в сообщении = вход через Lampa/кластер(Yын саб), где аккаунт выдан
  /подписка привязывает. Это внешний путь получения СВОЕЙ пары (в плагине нет UI для ввода).
- `profile_id` / несколько аккаунтов на один кластера-юзер — вероятно, но недоказано.

### D. Чего мы пока не знаем
- Регистрация/создание пары по устойчивому протоколу л**не подтвержд**ено;
- Инструмент создания пары в плагине отсутствует (нет UI, нет endpoint);
- Срок действия пары и привязка к подписке/источникам — не изучены (не тестировали
  изменение через время; аккаунт выглядит статичным).
- Можно ли одной email иметь несколько uid — не установлено.

### Финальный вывод (тип интеграции)
- **Независимое создание Skaz account context по имеющимся материалам НЕ подтверждено.**
  Вариант V**2**: Maniya не зависит от E-Online server/plugin, но для работы требует
  существующий валидный аккаунт-контекст Skaz (правильная пара `account_email` + `uid`,
  зарегистрированная в accsdb кластера).
- Текущая пара (из плагина E-Online) работает и живёт — как «ключ доступа» к кластеру.
  Для полной независимости (свой аккаунт) вход должен осуществляться вне протокола:
  см. «Синхронизация» в Lampa / администратор кластера / бот — вне API.
- Конфиг Maniya обязан принять произвольную пару из env (не завязан на значение),
  документированные параметры — §6.6.

- **twin-логика**: СОХРАНИТЬ как fallback — `chosen = native.items?.length ? native
  : (skaz.items?.length ? skaz : [])`. Двухпутье сохранено сознательно для живучести.
- **X-Kit-AesGcm**: НЕ слать. `lite/*` работает без него; дорабатывается только если
  `lite/withsearch`/`externalids` вернут 403.
- Порядок реализации: SkazClient → normalizer → SkazProvider+адаптеры → store/routes
  (provider-id `eonline-*` → `skaz-*`) → config (`eonline` → `skaz`, env-алиас EO→SKAZ,
  без ломки `/opt/maniya-online/server/.env`) → тесты → деплой → отметка в action-plan.