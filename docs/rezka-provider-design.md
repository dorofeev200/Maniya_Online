# Дизайн-доклад: Rezka-провайдер для Maniya Online

> Статус: исследование (без кода). Дата: 2026-08-06.
> Авторская рамка: контракты брались из **существующих реализаций** (Lampac C#, два Python-клиента), а не из README-допущений.

---

## 1. Резюме

Основной вывод исследования: **текущий Maniya-клиент Rezka написан против несуществующего JSON-API.**

- `server/src/providers/rezka/RezkaClient.js` вызывает `GET /api/search`, `GET /api/card/{id}`, `GET /api/streams/{id}` и ждёт ответ `{ streams: [...], translations: [...], qualities: [...] }`.
- Поиск по публичным реализациям (Lampac, py-клиенты, GitHub) **не нашёл ни одного** сервиса/клиента с таким эндпоинтом.
- **Реальный HDRezka** — это AJAX-скрейп: HTML-поиск + `POST /ajax/get_cdn_series/` + base64-декодер потоков + cookie-авторизация + анти-бот Anubis. Это подтверждено тремя независимыми имплементациями (см. §3.5).

То есть у Rezka в Maniya **не работает ни `streams()`, ни `videos()`, ни `search()`** — все три построены на фиктивном API. Нужен пересбор клиента и нормализатора под реальный контракт.

---

## 2. Текущий Provider-контракт Maniya (общая модель)

### 2.1 Три слоя и их ответственность

| Слой | Файл | Ответственность |
|---|---|---|
| **Client** | `<provider>/<Provider>Client.js` | Только сеть: сырые запросы к апстриму, заголовки/cookie/таймауты/ретраи. Возвращает **сырые** формы апстрима. Без бизнес-логики, без маппинга в StreamItem. |
| **Normalizer** | `<provider>/<Provider>Normalizer.js` | Чистый маппинг сырых данных → «записи провайдера» (поиск, сезоны, серии) и → StreamItem-подобные объекты через `StreamBuilder/EpisodeBuilder/SeasonBuilder`. Без сети. |
| **Provider** | `<provider>/<Provider>Provider.js` | Оркестрация: клиент + нормализатор, реализует публичный контракт `Provider`, `search()/movie()/serial()/streams()/videos()`. |

Общий HTTP-слой `shared/http/HttpClient.js` даёт таймаут (`timeoutMs`), `RetryPolicy` (статусы 408/429/5xx, экспоненциальная пауза) и `RateLimiter` (интервал + параллельность). `shared/utils/buildHeaders` подмешивает UA. `normalizeQuality`/`normalizeVoice`/`normalizeLanguage` — общие нормализаторы; `shared/quality.js` — `normalizeQuality`+`sortStreamsByQuality` (использует Kodik).

### 2.2 `Provider` (base.js)

```js
class Provider {
  id; title;
  name() -> id
  enabled() -> bool
  search(query, context) -> provider-local records[]
  movie(item) / serial(item)
  streams(item, context) -> StreamItem[]
  streamItem(item) -> frozen StreamItem
}
```

### 2.3 `StreamItem` контракт

Формируется через `createStreamItem()` (строгая валидация, бросает `TypeError` на пустые поля):

```js
{
  provider: 'rezka',        // непустая строка
  id: string,               // локальный id записи
  title: string,
  type: 'movie' | 'serial',
  quality: '1080p' | 'auto', // normalizeQuality
  voice: string,            // имя озвучки (может быть пусто)
  stream: { url: string, headers: {} },
  subtitles: []            // массив
}
```

`/api/lampa/stream?provider=X&...` → `provider.streams(context)` → `JSON` массив таких объектов.

### 2.4 `videos()` контракт (расширенный, пока только у Filmix)

`getVideosForRequest` (`store.js`): если выбран ровно один провайдер с `videos()` → возвращает enriched-payload; иначе — плоский список `search()`-записей; иначе — `videos.json`. Плагин рисует `items` и фильтры `season`/`voice`.

```js
{
  items: [
    {
      method: 'play',                      // или 'call' (плагин дозванивается по item.url и ждёт объект с url)
      title: 'Дублированный' | '1 серия',
      url: '<buildProxyUrl(context, mediaUrl)>',  // готовый прокси-URL; метод 'play' играет сразу
      quality: { '1080p': '<proxyUrl>', '720p': '<proxyUrl>', ... },  // качество -> ссылка
      headers: { Referer: 'https://...' },
      subtitles: [],
      season: 1,                     // только сериал
      episode: 3,                    // только сериал
      voice_name: 'Дублированный',
      type: 'movie' | 'serial'
    }
  ],
  seasons: [{ number: 1, title: '1 сезон' }],
  voices:  [{ name: 'Дублированный', index: 0 }]
}
```

Потребление в плагине (`public/maniya-online.js`):
- `play(item)`: `method==='call'` → `requestJson(item.url)` → `runPlayer(item, json)`; иначе `runPlayer(item, item)` — **играет `item.url` напрямую**.
- `runPlayer`: `{ title, url: stream.url, quality, subtitles, headers, timeline, season, episode, voice_name, isonline: true }` → `Lampa.Player.play/playlist`.
- Смена `season`/`voice` фильтров → повторный `GET /api/lampa/videos?...&season=..&voice=..`.

### 2.5 Поток запросов (request flow), серверная сторона

```
Lampa-плагин
  │  GET /api/lampa/sources            → { sources:[{id:'main', url:'/api/lampa/videos?...'}] }
  │  GET /api/lampa/subscription/check → { active, ... }
  ▼
GET /api/lampa/videos?provider=X&title=&original_title=&year=&season=&voice=&token=
  → requireSubscription (users.json по token/account_email)
  → getVideosForRequest(context)
      • если ровно один enabled-провайдер и у него есть videos(): provider.videos(context)
        → { items, seasons?, voices? } | при провале → ниже
      • иначе: provider.search(context) -> flat records
      • иначе: videos.json по tmdb_id/id
  → sendJson
```

### 1.6 Поток ответов (response flow)

```
provider.videos(context)
  → client.*          (сырые запросы апстрима; ретраи/таймауты)
  → normalizer.*      (маппинг)
  → buildProxyUrl(context, url)  // /api/lampa/proxy?url=...&token=...
  → { items, seasons, voices }
  ▼
route(): /api/lampa/videos → JSON
  ▼
плагин draw/play → nativa's player запрашивает
  ↓
GET /api/lampa/proxy?url=<media>&token=
  → requireSubscription
  → proxyMedia(): SSRF-валидация (host в PROXY_ALLOW_HOSTS), рет. версии HLS/DASH,
    проброс Range; манифест переписывается на наши proxy-ссылки.
```

Ошибки: `HttpError` → `sendJson(status, {error, message, details})`; провайдер в `getVideosForRequest` обёрнут в try/catch → фолбэк на search-записи (не рвём весь запрос).

---

## 2. Что реально представляет собой Rezka (исследование)

Все три независимые реализации сходятся. Контракт — **AJAX + скрейп HTML**, не JSON-API.

### 2.1 Эндпоинты

| Назначение | Запрос | Ключевые поля ответа |
|---|---|---|
| Поиск | `GET {host}/search/?do=search&subaction=search&q={q}` | HTML: блоки `b-content__inline_item`; ссылки `https://{host}/{slug}.html`; год; постер |
| Карточка/embed | `GET {host}/{href}.html` | HTML: фильм → `translators-list` (`data-translator_id` + имя озвучки), `"id":"cdnplayer","streams":"<base64>"`; сериал → `data-season_id=`, `initCDNSeriesEvents({id},{trs})` |
| Сезоны/серии | `POST {host}/ajax/get_cdn_series/?t={ts}{rand}` · `action=get_episodes` · body `id={id}&translatorid={t}` | `{ success, seasons:<html>, episodes:<html> }` |
| Поток серии | `POST .../get_cdn_series/` · `action=get_stream` · body `id&translator_id&season&episode&favs` | `{ success, url:<base64>, subtitle:<html> }` |
| Поток фильма | `POST .../get_cdn_series/` · `action=get_movie` · body `id&translator_id&is_camrip=0&is_ads=0&is_director&favs` | `{ success, url:<base64>, subtitle:<html> }` |
| Авторизация (premium) | `POST {host}/ajax/login/` · `login_name&login_password&login_not_save=0` | Set-Cookie `dle_user_id`, `dle_password`, `PHPSESSID` |

`{ts}` = unix-timestamp + случайное число (например `?t=1700000000123`), Form-UrlEncoded, заголовки `x-requested-with: XMLHttpRequest`, `origin`, `referer`.

### 2.2 Формат потоков (decodeBase64)

Поле `url` — base64 **с мусором** (`#h`, `//_//`, мусорные `trashListBase`/`trashListOld`). После `decodeBase64`:

```
[1080p]https://cdn.hdrezka.me/.../ep1.mp4, or [720p]https://.../ep1.720p.mp4,[480p]https://.../ep1.480p.mp4
```

- `[quality]url` через запятую; ` or ` — резервная ссылка.
- Качества: `2160p, 1440p, 1080p Ultra, 1080p, 720p, 480p, 360p`. Реальный порядок выбора: `2160p`(4K/2K)…→`360p`.
- HLS: Lampac к прямым ссылкам дописывает `:hls:manifest.m3u8`, либо ссылка уже `.m3u8`.
- Subtitle: `[label]url.vtt,[label2]url2.vtt`.

### 2.3 Анти-бот и ограничения

- **Anubis** (`anubis_challenge`): `<div id="anubis_challenge">{json}</div>` с `{challenge:{id, randomData}, rules:{algorithm:"fast", difficulty}}`. Решение — SHA-256 Proof-of-Work: подобрать `nonce`, где `SHA256(randomData+nonce)` имеет `difficulty` старших нулевых бит (полуслов исторические); затем `GET /.within.website/x/cmd/anubis/api/pass-challenge?id=..&response=<hash>&nonce=..&redir=..&elapsedTime=..` + cookie `techaro.lol-anubis-cookie-verification`. Lampac решает это в C# (`AnubisFast`) — на Node это стандартный `crypto`, внешних зависимостей не нужно.
- Гео-блоки: `Ошибка доступа (105)` = IP-блок, `(101)` = аккаунт блокирован, `403`.
- Cloudflare возможен на зеркалах (как у Filmix). Зеркала: `rezka.ag`, `hdrezka.co`, `hdrezka.me`, `kinopub.me` и др.

### Типовые формы данных

**get_episodes → seasons (HTML):**
```html
<ul>
  <li class="b-simple_season__item" data-tab_id="1">1 сезон</li>
  <li class="b-simple_season__item" data-tab_id="2">2 сезон</li>
</ul>
```
**get_episodes → episodes (HTML):**
```html
<li data-season_id="1" data-episode_id="1">1 серия</li>
<li data-season_id="1" data-episode_id="2">2 серия</li>
```
**get_stream/get_movie → json:**
```json
{
  "success": true,
  "url": "#//_//Qj...0KQJS RGV==",
  "subtitle": "[Русские]https://cdn.../subs.ru.vtt,[English]https://.../subs.en.vtt",
  "premium": false
}
```

### 2.5 Источники и надёжность

- **Lampac** — `Modules/OnlinePaid/Rezka/{Controller,Service,Models/DbModel,Models/EmbedModel,RezkaSettings}.cs`, `AnubisFast.cs`. Полный контракт: поиск-HTML, embed-HTML, get_cdn_series, decodeBase64, getStreamLink, Anubis, cookie. (fetch через WebFetch не проходил, кроме policy блокировки — получен curl.)
- **kyemets/HDrezka-api** — `HDrezkaAPI.py` (Python). Подтверждает `get_cdn_series` + `clearTrash`, `[quality]url`-разбор, `getEpisodes` (HTML), `get_episodes`/`get_stream`/`get_movie`.
- **SuperZombi/HdRezkaApi**: API `getStream()/getSeasonStreams`, `getTranslations`, `seriesInfo` — тот же контракт.

Два клиента полностью независимы от Lampac; драйверы совпадают по всем ключевым точкам (эндпоинт, тело, base64-обёртка, формат `[quality]url`).

---

## 3. Неожидание Maniya-клиента Rezka → реальность

| Предположение Maniya | Реальность | Влияние |
|---|---|---|
| `GET /api/search` → `payload.results[].title/..` | `GET /search/?do=search&subaction=search&q=` → HTML | `search()` не вернёт строк |
| `GET /api/card/{id}` | `GET {host}/{slug}.html` → HTML | `card()` 404 на реальном сервисе |
| `GET /api/streams/{id}` → `{streams, translations, qualities}` | `POST /ajax/get_cdn_series/` → base64 `url` | `streams()`/`videos()` не резолвятся |
| Поток = прямой URL в `stream.url` | Поток = `[quality]url` из base64, привязка к `translator_id` | нужен декодер + резерв |

Итого: **`RezkaProvider` никогда не отдавал рабочих потоков** — ни в `streams()`, ни в `videos()` (которых вообще нет).

---

## 4. Что нужно сделать (missing Rezka functionality)

1. **Реalkient**: заменить `/api/search|card|streams` на реальный AJAX-контракт:
   - `searchHtml(query)` — HTML-поиск.
   - `page(href)` — embed/карточка (парсинг `translators-list`, `cdnplayer`-пути, `initSeasonSeriesEvents`).
   - `getEpisodes(id, translatorId)` → `get_episodes`.
   - `getStreamMovie(id, translatorId, {director, favs})` → `get_movie`.
   - `getStreamEpisode(id, translatorId, season, episode, favs)` → `get_stream`.
   - `login(login, passwd)` → cookie (для premium).
   - `decodeBase64` (общий с очисткой мусора).
2. **Решить Anubis**: SHA latent-PoW-солвер + cookie-контейнер в клиенте (Node `crypto` достаточно).
3. **Нормализатор**: 
   - `normalizeSearchItem` — из HTML-блоков поиска.
   - `normalizeTranslations` — из `translators-list` (имя → id).
   - `normalizeSeasons/Episodes` — из HTML `get_episodes`.
   - `decodeStreams(url)` — из base64 `[quality]url` в мапу качеств (с учётом ` or ` резерва, HLS).
   - cache и передать `referer` на плеер/поток.
4. **videos()** — по контракту §1.4 (~Filmix):
   - фильм: items по озвучкам; каждая — мапа качеств;
   - сериал: items по сериям выбранного сезона+озвучки; seasons/voices фильтры полны; конструет `buildProxyUrl`.
5. **Себестоимость резолва**: `videos()` сериала = N вызовов `get_stream` (по серии). Как у Kodik/Alloha — дорого, но нативно: лучше резолвить по одному выбраному сезону+озвучке (как у Filmix `videosFromCard`), лениво.
6. **Прокси allowlist**: добавить CDN-хосты Rezka (`cdn.hdrezka.ag`, `cdn.hdrezka.me`, `hdrezka.info`, ...) в `PROXY_ALLOW_HOSTS` (SSRF-гард иначе 403 на медиа).
7. **Логирование/фолбэк** по образцу Filmix: fast-fail таймауты, `logger.warn` при провале, анонимный путь без Anubis где возможно.
8. **Тесты**: `test/rezka-provider.test.js` с фикстурами (HTML поиска, embed, `get_episodes`, base64 `url`), по образцу `alloha-provider.test.js` + `filmix-provider.test.js`.
9. **Конфиг**: секция `config.rezka` (host, зеркала, enable, premium, hls, reserve), `.env.example`.

---

## 5. Рекомендуемый план реализации (без кода)

Фаза 0 — оценка риска (бlокировка/решение):
- Принять, что **без решения Anubis-челленджа** любой реальный клиент будет частично деградировать (пока App на показуху). Впрочем, Anubis решается стандартным `crypto` (SHA-256 PoW) и cookie — риск средний. **Гео-блок из RU** (ошибки 105/403) — риск высокий; много базируется на прокси/раздельной стране.

Фаза 1 — (фундамент) новый `RezkaClient`:
- `searchHtml()` + `extractSearchItems` (HTML-разбор).
- `embed(href)`.
- `getEpisodes / getStreamMovie / getStreamEpisode` + `decodeBase64`.
- `solveAnubis` (SHA-256 PoW) + cookie-контейнер + ретрай после pass-challenge.
- Фаза закрывается **unit-тестами на фикстурах**, без сети.

Фаза 2 — нормализатор:
- `normalizeSearchItem`, `normalizeTranslations`, `normalizeSeasons/Episodes`, `resolveQualities` (base64).
- Сохранять `referer`/`headers` для потока.

Фаза 3 — `RezkaProvider`:
- `search()`, `streams()`, `videos()`/`streams()` по контракту §2.3–§2.4.
- Wrapper сверху Filmix-стиля: логирование, фолбэк, fast-fail; при недоступности → пусто, не роняясь.
- `config.rezka`, allowlist хостов CDN.

Фаза 4 — live-проверка:
- `test/live-rezka.test.js` по образцу `live-filmix.test.js` (skip по-умолчанию, включается env).

Фаза 5 — регистрация в `registry.js`, деплой.

**Альтернатива (дешевле, если солвер окажется нецелесообразен):** переопределить `RezkaProvider.enabled() = false` и не регистрировать до появления рабочего решения — чтобы не отдавать фиктивные пустые потоки пользователям. Это минимально-рискованное, но фактически удаляет Rezka из списка источников.

---

## 5. Открытые вопросы для решения пользователем

1. **Путь**: полная пересборка Rezka на AJAX+Anubis (рекомендуется) **или** временное отключение провайдера?
2. **Premium**: поддерживать ли подписку (`ajax/login` + cookie) или только бесплатный путь (качество ≤720p/1080p free)?
3. **HLS**: применять ли `:hls:manifest.m3u8`-преобразование или отдавать прямые mp4, как в данный момент.
4. **Гео-отсечка**: под каким окружением/хосте запуск VPS — если не RU, Anubis/блокировка ниже.