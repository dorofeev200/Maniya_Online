# TMDB-ACCESS-AUDIT-001 — Возможен ли безопасный серверный TMDB relay через Maniya?

- **Тип**: аудит, READ-ONLY. Код/тесты НЕ менялись, push/deploy НЕ делались.
- **Дата**: 2026-08-18.
- **Проблема**: Lampa без VPN не получает TMDB (api.themoviedb.org заблокирован на клиентской сети; с VPN работает).
- **Вне scope (не исследовалось)**: Skaz, Collaps, Rutube, VKMovie и остальные providers.

---

## TL;DR (ответ на главный вопрос)

**A. Можно ли решить через Maniya — ДА, безопасно и штатно.**

Lampac (эталон, local `Temp/Lampac`) решает ТОЧНО эту задачу модулем **`Modules/Proxy/TmdbProxy`**:
`GET /tmdb/api/…` → прокси на `api.themoviedb.org`, `GET /tmdb/img/…` → прокси на `image.tmdb.org`,
плюс маленький клиентский плагин **`tmdbproxy.js`**, который в Lampa подменяет только две функции.
Maniya может повторить эту же схему на своём домене — новый endpoint поверх уже существующего
SSRF-гарда `/api/lampa/proxy`. Ничего произвольного вводить не требуется.

---

## 1. Где Maniya/Lampa получает TMDB данные

**Сервер Maniya НЕ запрашивает TMDB вообще.** Весь TMDB-контакт — на стороне клиента Lampa:

| Слой | Что делает |
|------|-----------|
| Lampa-каталог/поиск/карточка | `api.themoviedb.org/3/…` (родной TMDB-модуль Lampa, свой api_key) — **ломается без VPN** |
| Постер/бэкдроп в плагине | `Lampa.TMDB.image('t/p/w300'+path)` — `public/maniya-online.js:220-229` (см. §8) |
| Названия серий в рендере | `Lampa.Api.sources.tmdb.get('tv/{tmdb_id}/season/{n}')` — `public/maniya-online.js:683-702`, `action-plan.md:66-69` («свой слой Lampa = кэш + api_key») |

**Плагин Maniya не ходит в TMDB сам**: `requestJson` → `/sources`, `/videos` — шлёт только
identity-поля с карточки Lampa: `id`, `tmdb_id`, `imdb_id`, `kinopoisk_id`, `title`, `source='tmdb'`
(`maniya-online.js:141-162`). Серверные упоминания `tmdb` в кодовой базе — **только константы**
(`source:'tmdb'`, `query.tmdb_id` в availability/store/eo/skaz/rezka-файлах): Maniya — потребитель
внешних TMDB-id, а не поставщик TMDB-данных.

## 2. Какие конкретно TMDB endpoints используются

**Клиент (Lampa, вне репозитория — выведено из кода Maniya + эталона Lampac):**
- API: `https://api.themoviedb.org/3/{search|movie|tv|...}` (query: `api_key`, `language`, `query`, `page`)
- Images: `https://image.tmdb.org/t/p/{w183|w342|w500|w780|original|...}{poster_path|backdrop_path}`

**Сервер Maniya:** прямых TMDB endpoints нет.

## 3. Используется ли api.themoviedb.org напрямую

Сервером — **нет** (grep по `server/src` и `.env.example`: нулевые вхождения).
Клиентом Lampa — **да**, и именно этот хоп без VPN недоступен (диагноз TASK-NETWORK-SOURCES-010:
TMDB-сеть даёт 000 на без-VPN сети, 200 с VPN).

## 4. Используется ли image.tmdb.org / TMDB CDN

Клиентом Lampa — да, но **без хардкода в плагине**: `moviePoster()` вызывает `Lampa.TMDB.image()`
(`maniya-online.js:220-229`). Прямой `image.tmdb.org` в коде плагина запрещён guard-тестом
`plugin-contract.test.js:111-112`. Плагин полагается на то, что у Lampa есть **настроенный
image-CDN** (см. §13).

## 5. Где хранится/передаётся TMDB API key/token

- **Сервер Maniya (config.js/.env.example): TMDB-ключа в коде НЕТ.** Хранятся только подписки-
  пользователи (`data/users.json`) и используются в auth.
- **Lampa-клиент: свой `api_key` внутри TMDB-модуля** — плагин им не владеет (см. §8).
- Эталон Lampac TmdbProxy: реальный TMDB-ключ — в конфиге Lampac, но **прокси-путь его НЕ трогает**:
  входящий `api_key` из query Lampa просто копируется в апстрим-URL (`RequestUri(...)`,
  `Controller.cs:226-258`, с skip `CoreInit.SkipQueryKeys`).

## 6. Есть ли уже proxy/relay, который можно использовать

**Да — `/api/lampa/proxy`** (`index.js:150-159`, `proxy.js`):
- SSRF-локлист **по хостам** (`validateProxyTarget` → `isHostAllowed`): `https` + суффикс-матчинг
  хоста; `http` — только loopback или явный `httpAllowHosts` (`config.js:251-260`, env `PROXY_ALLOW_HOSTS`).
- Дефолтный `allowHosts` НЕ содержит tmdb-хостов (сейчас: filmix/kodik/rutube/vk/kinotochka-CDN и др.).
- Redirect с повторной валидацией нового хоста; таймауты; HLS/DASH-манифесты реврайтятся
  (`rewriteManifest`) на наш же прокси; `Content-Length/Content-Range` пробрасываются
  (`passthroughHeaders:231-253`, `corsStreamHeaders:244-252`), `Access-Control-Allow-Origin: *`.
- Байтовый лимит `MANIFEST_MAX_BYTES=4MB` применяется ТОЛЬКО к манифестам; JSON/картинки пайпятся
  без лимита → **для JSON/images-релея `/proxy` подходит как есть** (JSON маленький, картинки —
  пайпом).
- **Нюанс-локлиста**: сейчас `allowHosts` матчится и по корню, и по поддоменам
  (`proxy.js:18-26`). Для TMDB нужны ТОЛЬКО ТОЧНЫЕ хосты `api.themoviedb.org` и `image.tmdb.org`
  (без unrestricted-входа `themoviedb.org`), см. §8.
- Второй кандидат — `/api/lampa/stream` (`index.js:259-270`): это НЕ прокси, а passthrough-резолв
  URL. Для TMDB-релея не подходит.

## 7. Какие существующие endpoints безопасно расширить

- **`/api/lampa/proxy`** — ЕДИНСТВЕННЫЙ кандидат: достаточно добавить `api.themoviedb.org` +
  `image.tmdb.org` в `config.proxy.allowHosts` (env `PROXY_ALLOW_HOSTS`) — HTTP-логика уже готова.
  Схема вызова: `url` = абсолютный закодированный URI; token — из query или Bearer; referer/origin —
  опциональные сервисные параметры (`buildProxyUrl`).
- Типизированная альтернатива (безопаснее для SSRF-модели, §8/§14): отдельные маршруты
  `/api/lampa/tmdb/api/3/{…}` и `/api/lampa/tmdb/img/t/p/{…}` с жёстко зашитым хостом.

## 8. Allowlist только для TMDB, без произвольного URL-прокси

**Минимально безопасный список** (`PROXY_ALLOW_HOSTS`):
```
api.themoviedb.org
image.tmdb.org
```
- Никаких `themoviedb.org` / других суффиксов: сейчас suffix-матчинг (`proxy.js:18-26`) сделал бы
  unrestricted `*.themoviedb.org`. Записи `api.themoviedb.org` и `image.tmdb.org` тоже суффиксные,
  но их «поддомены» контролируются самой TMDB.
- В новом маршруте (`/tmdb/api/…`) хост НЕ брать из ввода вообще — читать путь/query, строить
  апстрим к константам `api.themoviedb.org` / `image.tmdb.org` (как `tmdbApiHost`/`tmdbImgHost`
  в эталоне `Controller.cs:29-30`). Тогда SSRF невозможен даже при ошибке парсинга.
- Redirect переходит через ту же валидацию локлиста (`proxy.js:200-205`): TLS + хосты TMDB only.

## 9. Какие CORS/headers/query параметры нужны Lampa

- **Lampa каллит** (эталон `tmdbproxy.js:29-37`): `Lampa.TMDB.api(url)`
  → `https://api.themoviedb.org/3/{url}`; если `Lampa.Storage.field('proxy_tmdb')` — то
  `{host}/tmdb/api/3/{url}`. `Lampa.TMDB.image(...)` — аналогично `{host}/tmdb/img/{url}`.
  account-параметры (email/uid/token) подмешиваются тем же макаром, что `addAccountParams`
  плагина Maniya (`maniya-online.js:115-139`) — их релею трогать не нужно, прокси их просто
  пробрасывает.
- **Query**: api (json) — `api_key`, `language`, `query`; img — `{wXX}{path}`.
- **Headers**: JSON `application/json`; изображения — `Accept: image/jpeg,image/png,image/*;q=0.8`
  + старый UA для форсирования jpeg (эталон `Controller.cs:32-37`).
- Релею достаточно этих двух + макс. пайп-без-буферизации и отсутствия rate-limit на img.

## 10. Как не создать SSRF

1. **Не открывать произвольный `url`**: расширять только allowlist-позвол, без wildcard.
2. **В новом маршруте `/api/lampa/tmdb/api/{…}`** хост жёстко задан конструкцией
   `https://api.themoviedb.org` (не из ввода); пути — закодированные, не допускать `//host`
   (нормализация в эталоне `RequestPath`, `Controller.cs:211-224`); query — kопируется как есть.
3. **Redirect** в новом маршруте не нужен (TMDB API не редиректит; изображения — no redirects),
   предел `maxRedirects` сохраняется и при переиспользовании `/proxy`.
4. Апстрим — только `https` (`validateProxyTarget` уже запрещает http вне loopback/`httpAllowHosts`).
5. Никакой передачи hostname в query-релей: параметры Lampa не становятся компонентами URL-хоста.

## 11. Какие изменения потребуются концептуально

**Сервер (минимум — 1 строка конфига + опционально файл):**
- `config.proxy.allowHosts` += `api.themoviedb.org`, `image.tmdb.org`;

**Опционально новый endpoint (эталон TmdbProxy):**
- `GET /api/lampa/tmdb/api/3/{…}` → `api.themoviedb.org/3/{…}` (query: api_key/language/query/page);
- `GET /api/lampa/tmdb/img/t/p/{…}` → `image.tmdb.org/t/p/{…}` (image-CDN);
- кэш-слой in-memory (очищаемый), ключ = путь+query, отдельный TTL для api и img — по желанию,
  никаких внешних зависимостей.

**Клиент (маленький плагин, не трогая ядро Lampa):**
- новый `public/tmdbproxy.js`: подмена `Lampa.TMDB.api` и `Lampa.TMDB.image` при
  `Lampa.Storage.field('proxy_tmdb')` (эталон `tmdbproxy.js:29-37`). Существующий
  `public/maniya-online.js` (`moviePoster`) остаётся как есть (он и так идёт через `Lampa.TMDB.image`).

## 12. Как Lampa будет обращаться к Maniya вместо TMDB

1. На плане пользователя включается `proxy_tmdb` (Lampa-фича, встроенная; `lampainit.js` её
   включает для RU через `Lampa.Storage.set('proxy_tmdb', …)` — см. также
   `disable_features.install_proxy = false // cub tmdb proxy`).
2. Lampa подключает `tmdbproxy.js`: переиспользовать существующий механизм плагинов Maniya
   (`/x/<install>_<key>.js`, `/p/<opaque>.js` — `index.js:94-142`) — никакого нового транспорта.
3. Когда `Lampa.TMDB.api`/`image` смотрят на наш домен, все циклы identity/карточка/постеры
   (включая `Lampa.Api.sources.tmdb` для названий серий) идут через Maniya. Сервер никак не
   меняет провайдеры: они по-прежнему получают `tmdb_id`/агностицизм.

## 13. Что будет с TMDB images

- **По умолчанию (`proxy_tmdb` выключен)** — как сейчас: `Lampa.TMDB.image()` с настроенным
  клиентским image-CDN. Если у клиента дефолтный `image.tmdb.org`, тот без VPN блокируется →
  чёрные постеры (текущее поведение).
- **С включённым `proxy_tmdb`** — `Lampa.TMDB.image` указывает на `{host}/tmdb/img/`, все постеры
  идут через Maniya (с `Accept: image/*` и тем же старым UA). Сам CDN остаётся TMDB, но доступ —
  через наш хост.

## 14. SSRF-модель (итог)

Безопасно и без «произвольного» прокси: релей использует изолированный хостмап
(`api.themoviedb.org` + `image.tmdb.org`) на существующем `validateProxyTarget`/`isHostAllowed`,
redirect ограничен тем же списком; в типизированном маршруте апстрим-хост вообще не берётся
из ввода — клиент шлёт параметры, не URL. Новых SSRF-точек не появляется.

## 15. Файлы, которые потребуется изменить (при реализации)

| Файл | Изменение |
|------|-----------|
| `server/src/config.js` (+ `.env.example`) | `proxy.allowHosts` += `api.themoviedb.org`, `image.tmdb.org` |
| `server/src/proxy.js` | (опц.) хост релея для типизированного TMDB-пути; байт-кап для img-пипа |
| `server/src/index.js` | маршруты `/api/lampa/tmdb/api/…` и `/api/lampa/tmdb/img/…` |
| `public/tmdbproxy.js` (новый) | подмена `Lampa.TMDB.api`/`Lampa.TMDB.image` при `proxy_tmdb` |
| `public/maniya-online.js` | (опц.) подмешивание `tmdbproxy.js` к установке плагина |
| `scripts/deploy.sh` / `docs/action-plan.md` | регистрация маршрута и клиентского плагина |

Тесты (при утверждении): маршрут `tmdb/api` и `tmdb/img` — body == апстрим; переданный hostname
в query игнорируется (жёсткий хост); на «каталог Lampa с `proxy_tmdb`» — identity связка
не ломается.

---

## Выводы

- **A — можно ли решить через Maniya: ДА.** Опирается на уже существующий `/api/lampa/proxy` +
  суффикс-allowlist; быстрый выигрыш — 2 хоста в `PROXY_ALLOW_HOSTS` (прокси-поведение уже работает);
  полный клиентский цикл — маленький `tmdbproxy.js`-плагин по эталону Lampac.
- **B — точный список hosts/endpoints: `api.themoviedb.org/3/…` (JSON) + `image.tmdb.org/t/p/…`
  (изображения); без `themoviedb.org`-wildcard.**
- **C — безопасный endpoint: `GET /api/lampa/tmdb/api/3/{…}` (JSON), `GET /api/lampa/tmdb/img/t/p/{…}`
  (img)** — типизированные маршруты поверх прокси-механизма.
- **D — как Lampa будет ходить**: плагин `tmdbproxy.js`, подмена `Lampa.TMDB.api`/`Lampa.TMDB.image`
  при `Lampa.Storage.field('proxy_tmdb')=true`; каталог/карточка/постеры/названия серий переходят
  автоматически.
- **E — images**: пока клиентский image-CDN работает — потерь нет; с `proxy_tmdb` — постеры через
  наш `/tmdb/img`, апстрим остаётся TMDB.
- **F — SSRF**: изолированный разрешённый хостмап + существующая валидация; произвольного URL-прокси
  не создаётся.
- **G — какие файлы изменить**: `config.js`/`.env.example`, `index.js`, `public/tmdbproxy.js` (новый),
  опционально `proxy.js` (типизированный апстрим). `errors.js`, `availability.js`, providers —
  не трогаются.

### Ограничения
- Аудит выполнен по существующему коду Maniya + эталону Lampac; TMDB-клиент Lampa находится вне
  репозитория (его поведение выведено из кода Maniya и эталона; финальная проверка — live после
  утверждения).
- TMDB-ключа у Maniya нет; релей ретранслирует `api_key` клиента Lampa (как TmdbProxy Lampac).
- Добавление TMDB-хостов в proxy-локлист — чувствительная операция; diff минимальный, под live-тест
  на temp-VPS.
- READ-ONLY соблюдён: код/тесты не менялись, ничего не реализовано и не развёрнуто.