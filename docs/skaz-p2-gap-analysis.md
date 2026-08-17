# SKAZ P2 — Reference Gap Analysis

**Дата**: 2026-08-12
**Reference**: E-Online (Lampac `plugin.js` v1.8.0 + `OnlineApi.cs`)
**Сравниваемый**: Maniya `SkazProvider.js` + `SkazClient.js` + `SkazNormalizer.js` + `proxy.js`
**Credentials**: `<REDACTED: working account, GRANTED — в git не хранится, SECURITY-001>`

---

## Сводная таблица

| Область | E-Online | Maniya | Разница | Класс | Нужно менять? |
|---|---|---|---|---|---|
| Balancer selection | Серверный `lite/withsearch` → `lite/events` → `checkOnlineSearch` pre-check → user choice cached | Статический `SKAZ_BALANCERS` + twin-provider pattern + host rotation | Maniya без server-side discovery и без UI-выбора | IMPORTANT | Нет сейчас (UI потом) |
| play-карточки | `data-json` regex → `method:"play"` → прямой URL | Идентично: `SkazNormalizer.cards()` → `method:"play"` → прокси URL | Нет разницы | — | Нет |
| call-карточки | `data-json` regex → `method:"call"` → GET URL → Lampac-сервер → JSON video | Идентично: → `resolveVideoJson()` → JSON video | Нет разницы | — | Нет |
| Quality parsing | `setDefaultQuality`: берёт `video_quality_default`, остальные игнорирует. `or` → **оставляет только primary** | `cleanedQualityMap`: все quality в мапе, `or` → **оба URL проксированы** | Maniya полнее: reserve не теряется | IMPORTANT | Нет (Maniya лучше) |
| Main URL reserve | `orUrlReserve`: primary → `url`, reserve → `url_reserve` (отдельное поле) | `splitOrUrl` → `primary or reserve` в одной строке URL | Разный формат поля; Lampa понимает оба | OPTIONAL | Нет |
| Quality reserve | **Дискардится** (`.split(' or ')[0]`) | **Сохраняется** (прокси оба → ` or `) | Maniya даёт reserve для каждого качества | IMPORTANT | Нет (Maniya лучше) |
| Subtitles | Из JSON, прямые CDN URL | Из JSON, каждый URL → прокси Maniya | Maniya proxирует субтитры | OPTIONAL | Нет |
| Segments.skip | Из JSON → `item.segments` → плеер | Из JSON → `item.segments` → плеер | Нет разницы | — | Нет |
| `hls_manifest_timeout` | Из JSON → плеер | Из JSON → плеер | Нет разницы | — | Нет |
| Headers | `X-Kit-AesGcm` (если ключ есть), иначе пусто. Origin добавляет Lampac-сервер | `Origin: http://lampa.mx` (потоки), `User-Agent` (proxy), `Referer` (опционально) | Разные наборы — оба валидны | E-ONLINE-SPECIFIC | Нет |
| Proxy | Прямые CDN URL (без прокси) | Все media URL → `/api/lampa/proxy` (SSRF, HLS rewrite) | Архитектурное решение | ARCHITECTURAL | Нет |
| Redirects | `redirect: 'follow'` в Lampac-сервере | `redirect: 'follow'` в `fetchResolved()` + proxy `maxRedirects: 4` | Оба follow redirects | — | Нет |
| `accsdb` | Показывается пользователю: «аккаунт не grant», retry 10s | `isAccsdbPayload()` → `null` → пользователь видит «видео не найдено» | Maniya маскирует причину отказа | IMPORTANT | Да — различать accsdb |
| `rch` | WebSocket-фолбэк (`rchRun`) | `isRchPayload()` → `null` | Maniya не умеет WS | E-ONLINE-SPECIFIC | Нет (Maniya без WS) |
| 404/403/429 | `empty()` + retry через `doesNotAnswer` | `fetchHosts` → следующий хост | Оба перебирают | — | Нет |
| 500/502/503 | `fetchHosts` с перебором хостов (в Lampac) | `fetchHosts` с перебором хостов | Идентичная стратегия | — | Нет |
| Timeout | `network.timeout(3000)` + `REQUEST_TIMEOUT=10000` | `timeoutMs=15000` | Maniya ждёт дольше | OPTIONAL | Нет |
| Empty response | `empty()` → «ничего не найдено» | `[]` → «видео не найдено» | Идентично | — | Нет |
| Malformed JSON | `try/catch` → `null` | `try/catch` → `null` | Идентично | — | Нет |
| Malformed HTML | `try/catch` → `[]` | `isUsablePage()` → `null` | Maniya чуть строже | — | Нет |

---

## Детальный анализ по областям

### P2-1. Balancer selection

**E-Online**: Серверная сторона (Lampac/OnlineApi.cs):
1. `lite/withsearch` — discovery: возвращает JSON-список доступных балансеров
2. `lite/events` — собирает все модули + `EventListener.OnlineChannels` → `send()` для каждого → список `(name, url, plugin, index)`
3. `checkOnlineSearch` — pre-check каждого балансера: параллельный GET с `checksearch=true` → ищет `data-json=` или `"rch":true` → помечает `work`/`rch`
4. Клиент (`plugin.js`): `createSource()` → `lifeSource()` → список с `show`/`rch` → пользователь выбирает через filter UI → выбор кэшируется в `online_last_balanser`

**Maniya**:
1. Статический `SKAZ_BALANCERS` из конфига (дефолт: 14 балансеров)
2. Twin-provider pattern: skaz-близнец native-провайдера скрыт, но доступен как fallback
3. Host rotation: `SkazClient.fetchHosts()` перебирает пул хостов при 5xx/сетевых ошибках
4. Без UI-выбора, без pre-check, без discovery

**Разница**: Maniya не имеет:
- Динамического discovery (`lite/withsearch`)
- Pre-check balancing (проверка доступности до того как показать источник)
- UI выбора балансера пользователем

**Класс**: **IMPORTANT** — но требует UI (запланировано позже). Discovery может быть добавлен в `SkazClient.discover()` (уже написан, но не интегрирован в registry).

**Менять?** Нет сейчас. Не блокирует playback.

---

### P2-2. Карточки play и call

**Обе реализации идентичны**:
- Парсинг: `data-json='{...}'` regex (посимвольно одинаковый)
- Типизация: `method:"play"` vs `method:"call"` + проверка `s`/`e` для серий
- `play`: URL проксируется → готов к воспроизведению
- `call`: URL → `resolveVideoJson()` → JSON `{method:'play', url, quality, subtitles, segments}`

**Класс**: Нет разницы.

---

### P2-3. Quality parsing (P1-B закрыт)

**E-Online** (`plugin.js:638-647`):
```js
this.setDefaultQuality = function (data) {
  if (Lampa.Arrays.getKeys(data.quality).length) {
    for (var q in data.quality) {
      if (parseInt(q) == Lampa.Storage.field('video_quality_default')) {
        data.url = data.quality[q];           // default quality → main URL
        this.orUrlReserve(data);              // split ' or ' → url_reserve
      }
      if (data.quality[q].indexOf(' or ') !== -1)
        data.quality[q] = data.quality[q].split(' or ')[0];  // DISCARD RESERVE
    }
  }
};
```

**Maniya** (`SkazProvider.js:576-584`):
```js
export function cleanedQualityMap(map, proxy) {
  const out = {};
  for (const [label, urlEntry] of Object.entries(map || {})) {
    if (!urlEntry || typeof urlEntry !== 'string') continue;
    const parts = splitOrUrl(urlEntry);
    out[label] = parts.length > 1
      ? parts.map((u) => proxy(u)).join(' or ')   // KEEP BOTH
      : proxy(urlEntry);
  }
  return out;
}
```

**Разница**: E-Online **дискардит** reserve в quality map. Maniya **сохраняет** оба URL.

**Класс**: **IMPORTANT** — Maniya лучше. Плеер получает fallback для каждого качества.

**Менять?** Нет. P1-B уже закрыл.

---

### P2-4. Reserve/fallback

**E-Online**:
- Main URL: `orUrlReserve(data)` → `data.url = urls[0]`, `data.url_reserve = urls[1]`
- Quality: `.split(' or ')[0]` — только primary
- Lampa-плеер сам решает когда переключиться на `url_reserve`

**Maniya**:
- Main URL: `` `${streamProxy(primary)} or ${streamProxy(pair[1])}` ``
- Quality: `parts.map(u => proxy(u)).join(' or ')`
- Рендер получает ` or ` в URL и сам парсит

**Разница**: Разный формат reserve. E-Online использует отдельное поле `url_reserve`; Maniya — строку `primary or reserve`. Оба формата понимаются Lampa-плеером.

**Класс**: **OPTIONAL**. Функционально эквивалентны.

---

### P2-5. Subtitles

**E-Online**: Субтитры из JSON video → прямые CDN URL → плеер.
```js
first.subtitles = json.subtitles;
```

**Maniya**: Субтитры из JSON video → каждый URL проксируется через Maniya.
```js
subtitles: normalizeSubtitles(json.subtitles, streamProxy)
```

**Разница**: Maniya проксирует субтитры (CORS + безопасность). Добавляет latency на загрузку .srt/.vtt, но это o(100ms) и только один раз при старте.

**Класс**: **OPTIONAL**. Не влияет на воспроизведение.

---

### P2-6. Segments / skip

**Обе реализации**: `json.segments` → `item.segments` → плеер. Без изменений.

```js
// E-Online:
first.segments = json_call.segments || item.segments;

// Maniya:
segments: json.segments && typeof json.segments === 'object' ? json.segments : undefined,
```

Поле `hls_manifest_timeout` тоже пробрасывается одинаково.

**Класс**: Нет разницы.

---

### P2-7. Headers

**E-Online** (клиентский JS):
```js
function addHeaders() {
  var aesgcmkey = Lampa.Storage.get('aesgcmkey', '');
  if (aesgcmkey) return { 'X-Kit-AesGcm': Lampa.Storage.get('aesgcmkey', '') };
  return {};  // ← ЧАЩЕ ВСЕГО ПУСТО
}
```
Origin добавляется **серверной стороной** Lampac при резолве потока (НЕ клиентом).

**Maniya** (серверная сторона):
```js
// SkazClient.resolveVideoJson():
headers: { Origin: this.origin }  // 'http://lampa.mx'

// proxy.js proxyMedia():
headers: { 'User-Agent': defaultUserAgent(), 'Accept': '*/*' }
+ 'Referer' опционально
+ 'Range' для сегментов
```

**Разница**: 
- `X-Kit-AesGcm` — E-ONLINE-SPECIFIC (Lampac-шифрование kit-конфига)
- Origin — оба передают (`http://lampa.mx`), обязательно для CDN (voidboost/vkvideo)
- User-Agent — Maniya добавляет, E-Online нет
- Referer — Maniya опционально, E-Online нет

**Класс**: **E-ONLINE-SPECIFIC** для X-Kit-AesGcm. Остальное — REQUIRED для работы CDN.

---

### P2-8. Proxy

**E-Online**: Клиент получает прямые CDN URL. Без прокси. CORS решается через Lampa-клиент (нативный плеер).

**Maniya**: Все media URL → `/api/lampa/proxy`:
- SSRF-allowlist
- HLS manifest rewriting (сегменты → через прокси)
- Range passthrough
- CORS-заголовки
- Content-Type passthrough
- Redirect following (max 4)

**Разница**: Архитектурное. Maniya добавляет слой прокси для безопасности и обхода CORS. E-Online полагается на Lampa-клиент.

**Класс**: **ARCHITECTURAL**. Менять не нужно.

---

### P2-9. Error handling

**E-Online** (клиент):
```js
// accsdb — показывается пользователю:
if (json.accsdb) return reject(json);
// ...
er && er.accsdb → html.find('.online-empty__title').html(er.msg);
var tic = er && er.accsdb ? 10 : 5;  // retry: 10s для accsdb, 5s для остального

// rch — WebSocket fallback:
if (json.rch) { this.rch(json, callback); }

// Сетевые ошибки:
function () { call(false, {}); }  // → empty()
```

**Maniya** (сервер):
```js
// SkazClient:
isAccsdbPayload(text) → true → возвращается как null (HTML не прошёл isUsablePage)
isRchPayload(text) → true → null
STATUS_REST.has(response.status) → false для 5xx → null

// SkazProvider:
catch { return null / { items: [], seasons: [], voices: [] } }
```

**Разница**:
1. **`accsdb`**: E-Online показывает пользователю конкретную причину («аккаунт не grant»). Maniya возвращает пустой результат — пользователь видит «видео не найдено» без объяснения причины. **IMPORTANT**.
2. **`rch`**: E-Online fallback на WebSocket. Maniya не поддерживает WS-источники. **E-ONLINE-SPECIFIC** (Maniya не использует WS).
3. **Retry**: E-Online retry с экспоненциальной задержкой (5-10s). Maniya перебирает хосты, но не делает повторных запросов к тому же хосту. **OPTIONAL**.
4. **500/502/503**: Оба перебирают хосты пула — идентично.
5. **Timeout**: Maniya 15s vs E-Online 3s+10s. Maniya ждёт дольше. **OPTIONAL**.

**Класс**: 
- `accsdb` → **IMPORTANT** (нужно различать, но без изменения кода сейчас)
- Остальное → без изменений

---

### P2-10. Старые credentials

| Файл | Credentials | Байт | Используется? | Класс |
|---|---|---|---|---|
| `/tmp/migrated.env` | `<REDACTED: old account, SECURITY-001>` | 995 | Нет (не открыт ни одним процессом) | temp |
| `/tmp/baseline/server/.env` | `<REDACTED: old account, SECURITY-001>` | 995 | Нет | temp |
| `/tmp/baseline/server/.env.bak-eo` | `<REDACTED: old account, SECURITY-001>` | 989 | Нет | temp |
| `/tmp/baseline/` (весь каталог) | Содержит старый слепок кода | — | Нет | temp |
| `docs/action-plan.md:14,387` | Упоминания в контексте диагностики | — | Документация | docs |
| `docs/skaz-architecture.md:166,216-217` | Архитектурный разбор upstream | — | Документация | docs |
| `docs/regression-20260811-hidden-twin.md:38` | Постмортем регрессии | — | Документация | docs |
| `scripts/provider-matrix.mjs:111` | Диагностический скрипт сравнения | — | Не production | temp/diag |

**В production-коде (`server/src/`)** — **ноль** упоминаний.

**Текущий prod `.env`**: `<REDACTED: working account, SECURITY-001>` ✓

**Рекомендация**: 
- `/tmp` файлы — безопасно удалить (после подтверждения)
- Документация — оставить как историю
- `provider-matrix.mjs` — можно выпилить старые креды при рефакторинге

---

## Итог

### REQUIRED
*Нет срочных исправлений.* P1-B закрывает основную функциональность quality-or.

### IMPORTANT

| # | Описание | Действие |
|---|---|---|
| I1 | **`accsdb` не различается** — пользователь не видит разницу между «аккаунт не grant» и «нет источника» | Добавить `accsdb` в ответ API (metadata/error), не меняя production код сейчас |
| I2 | **Quality сохраняет reserve** — Maniya лучше E-Online (не дискардит) | Оставить как есть |
| I3 | **Balancer discovery статический** — нет динамического списка | Интегрировать `SkazClient.discover()` позже, с UI |

### OPTIONAL

| # | Описание |
|---|---|
| O1 | Reserve формат: E-Online — `url_reserve`, Maniya — ` or ` в строке. Оба работают |
| O2 | Subtitles через прокси — добавляет latency, но безопаснее |
| O3 | Timeout 15s vs E-Online 3-10s — можно уменьшить |
| O4 | Retry логика: E-Online делает повторные запросы, Maniya только перебирает хосты |

### E-ONLINE-SPECIFIC
- `X-Kit-AesGcm` header (Lampac kit encryption)
- `rch`/WebSocket fallback (Maniya без WS)
- `nws_id` параметр (WebSocket notice ID)
- `token` параметр Lampac-сервера
- `lifeevents` polling
- `checkOnlineSearch` pre-check
- UI выбора балансера (будет своё)
- `balanser` choice caching

### Уже закрыто
- **P1-B**: Quality `or` splitting, reserve сохранение, subtitles проксирование

---

## Credentials cleanup (ожидает разрешения)

| Путь | Содержит | Размер | Статус |
|---|---|---|---|
| `/tmp/migrated.env` | `<REDACTED: old account, SECURITY-001>` | 995 B | Ждёт подтверждения на удаление |
| `/tmp/baseline/server/.env` | `<REDACTED: old account, SECURITY-001>` | 995 B | Ждёт подтверждения на удаление |
| `/tmp/baseline/server/.env.bak-eo` | `<REDACTED: old account, SECURITY-001>` | 989 B | Ждёт подтверждения на удаление |
| `/tmp/baseline/` (весь) | Старый слепок кода | — | Ждёт подтверждения на удаление |

**Ни один из этих файлов не используется текущими процессами.**
