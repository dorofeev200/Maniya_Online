# VKMOVIE-INTEGRATION-001 — ИМПЛЕМЕНТАЦИЯ

**Дата:** 2026-08-16 · **Режим:** изменение кода + тестов; НЕ commit/push/deploy (по требованию)
**База:** аудит `docs/vkmovie-integration-audit-001-report.md` (принят как доказательный, повторного аудита не делалось)
**Задача:** подключить Skaz-балансер `vkmovie` через СУЩЕСТВУЮЩИЕ SkazProvider + SkazClient на существующей архитектуре; display name = `RUmovie-1` (только presentation); rutubemovie не трогать; RUS-1/RUS-2 не использовать как identity.

---

## 1. Что сделано

1. **config.js** — `'vkmovie'` добавлен в оба дефолтных списка `skaz.balancers` / `eonline.balancers` (рядом с `rutubemovie`). Никаких новых хостов/env: creds и hosts те же.
2. **registry.js** — `EO_TITLES.vkmovie: 'Maniya · VKMovie'` → `'Maniya · RUmovie-1'` (display-титул источника).
3. **meta.js** — `vkmovie: { name: 'RUmovie-1', icon: '▶️', qualityLabel: 'Full HD' }` (presentation name; icon/quality прежние).
4. **Новый тест** `test/vkmovie-integration.test.js` (5 тестов):
   - vkmovie в дефолтном списке; rutubemovie на месте; `vk`/`rutube`/`RUmovie-1` в balancers НЕ используются (identity = `vkmovie`).
   - `providerById('skaz-vkmovie')` — SkazProvider, `show:true`, `enabled()`, title `Maniya · RUmovie-1`; id = `skaz-vkmovie` (НЕ RUmovie-1).
   - `twinFor('vkmovie') === null` (нет native-дубля → vkmovie видимый источник); `buildResolveUrl` несёт `provider=skaz-vkmovie` и не содержит `RUmovie-1` (внутренние маршруты — чистый identity).
   - **rutubemovie без изменений:** `skaz-rutubemovie` остаётся СКРЫТЫМ twin (`twinFor('rutubemovie').id==='skaz-rutubemovie'`, в registeredProviders отсутствует).
   - meta: `providerMeta('vkmovie').name === 'RUmovie-1'`; `providerMeta('rutubemovie').name === 'Rutube'`; легаси `vk`→RUS-1, `rutube`→RUS-2 не тронуты.

Отдельного VKMovie-клиента/провайдера НЕ создавалось — работает существующий контур SkazProvider+SkazClient+SkazNormalizer (карточки play/streamquality уже поддерживались; см. аудит §12.G-§12.I).

---

## 2. Изменённые файлы (список)

| Файл | Изменение |
|---|---|
| `server/src/config.js` | +`'vkmovie'` в дефолтные `balancers` (2 места: eonline + skaz) |
| `server/src/providers/registry.js` | `EO_TITLES.vkmovie` = `'Maniya · RUmovie-1'` |
| `server/src/providers/meta.js` | `vkmovie.name` = `'RUmovie-1'` |
| `server/test/vkmovie-integration.test.js` | НОВЫЙ, 5 тестов |

`server/src/providers/skaz/*`, `proxy.js`, `availability.js`, `hostOrder.js`, конфигурация hosts/env — **НЕ менялись**. rutubemovie/filmix/alloha/rezka/kodik и прочие providers — **НЕ менялись**.

## Дiff (выдержка)

```diff
--- a/server/src/config.js
@@ balancers (eonline + skaz)
- ['alloha', 'videoseed', 'kinopub', 'kinoflix', 'veoveo', 'pidtor', 'solntse', 'filmix', 'rezka', 'hdvb', 'rutubemovie', 'kodik', 'geosaitebi', 'rhsprem']
+ ['alloha', 'videoseed', 'kinopub', 'kinoflix', 'veoveo', 'pidtor', 'solntse', 'filmix', 'rezka', 'hdvb', 'rutubemovie', 'vkmovie', 'kodik', 'geosaitebi', 'rhsprem']
```

```diff
--- a/server/src/providers/registry.js
-  vkmovie: 'Maniya · VKMovie',
+  vkmovie: 'Maniya · RUmovie-1',
```

```diff
--- a/server/src/providers/meta.js
-  vkmovie: { name: 'VKMovie', icon: '▶️', qualityLabel: 'Full HD' }
+  vkmovie: { name: 'RUmovie-1', icon: '▶️', qualityLabel: 'Full HD' }
```

---

## 3. Тесты

Полный suite (локально): **`NODE_ENV=test node --test` → 619 тестов, 613 pass, 0 fail, 6 skipped** (skip = предсуществующие live/платформенные гейты). Регрессионные тесты rutubemovie (`rutube-provider.test.js`), filmix (`filmix-*.test.js`), alloha (`alloha-provider.test.js`), veoveo (`skaz-normalizer/eolive`), rezka (`rezka-*`), kinopub (`skaz-provider/availability*`), kodik (`kodik-*`) — все зелёные. Новые `VKMOVIE-001` — 5/5.

---

## 4. Live-проверки (временная копия кода на VPS, temp-сервер :3299, creds из prod .env; тестовый токен подписки)

### `/api/lampa/sources`
HTTP 200, 16 источников; `skaz-vkmovie` присутствует: `{name:"RUmovie-1", icon:"▶️", show:true, url = /api/lampa/videos?...&provider=skaz-vkmovie}`.

### `/api/lampa/sources/card` (availability per-card, проверка на кластер)
- Матрица (1999): `skaz-vkmovie show:true` (elapsed 12.0s, 16 источников)
- Аватар (2009): `skaz-vkmovie show:true` (elapsed 12.0s)

→ W1-модель (CONTENT с любой живой ноды) работает; vkmovie = CONTENT в реальном проде-вычислении.

### `/api/lampa/videos` (provider=skaz-vkmovie) + resolution + playback (через наш /api/lampa/proxy)

| Фильм | items | Качества | Range 0-1023 | Content-Range/-Length | head | Deep Range 1MiB |
|---|---|---|---|---|---|---|
| Матрица (1999) | 21 | 2160p…144p | 206 | bytes 0-1023/6765863524 | `ftypisom` | 206 |
| Аватар (2009) | 20 | 2160p…144p | 206 | bytes 0-1023/11647104960 | `ftypisom` | 206 |
| Дюна: Часть вторая (2024) | 11 | 2160p…144p | 206 | bytes 0-1023/3820854223 | `ftypisom` | 206 |
| Интерстеллар (2014) | 21 | 2160p…144p | 206 | bytes 0-1023/6054139929 | `ftypisom` | 206 |
| Властелин колец: Братство (2001) | 17 | 2160p…144p | 206 | bytes 0-1023/8460961602 | `ftypisom` | 206 |

Content-Type `video/mp4`, Content-Length полного файла, подпись MP4 `\0\0\0 ftypisom`. Прокси-путь: `/videos` (buildProxyUrl) → наш `/api/lampa/proxy` → `{node}/proxy/{opaque}` кластера. Play-флоу полный chain: `lite/vkmovie → /videos → /proxy → 206`.

### Serial (movie-only подтверждено через наш слой)
«Игра престолов» (2011), `serial=1`, provider=skaz-vkmovie → **items 0** (как зафиксировано аудитом: весь кластер 503 + модуль `serial==1→OnError`). Искусственно сериалы НЕ добавлялись.

### resolve
`/api/lampa/video?provider=skaz-vkmovie&…` → HTTP **404 `video_not_found`** (штатно: все 21 карточки vkmovie — `method:"play"`, call-канала ленивого резолва нет; Play берёт URL play-элемента напрямую). Не 403/500, маршрут корректен. Контроль twin: тот же запрос для `skaz-rutubemovie` → тоже 404 (не сломан).

---

## 5. Вывод

- `vkmovie` подключён в существующей Skaz-архитектуре минимальной правкой конфигурации + presentation-меты; читаемый источник «RUmovie-1» (identity — `vkmovie`, provider id — `skaz-vkmovie`).
- **Playability 5/5 фильмов, Range 206, MP4 2160p…144p через собственный прокси.** Availability per-card = CONTENT. Serial = movie-only (не добавлялся).
- **Регрессий нет:** полный suite 613 pass / 0 fail (включая rutubemovie/filmix/alloha/veoveo/rezka/kinopub/kodik); rutubemovie-twin и легаси-мета не тронуты.
- **Security:** proxy.js/allowlist не менялись; плей-путь vkmovie покрыт существующими записями (аудит §9).
- Временная копия и tar на VPS удалены; локальный tar удалён; пользовательские/сервисные секреты в отчёт не попали.

**НО НЕ выполнено по требованию:** commit / push / deploy — НЕ делались. Код готов к деплою существующим пайплайном (`scripts/deploy.sh`), но запуск на проде — отдельное решение.

**RUTUBE HD — НЕ трогался** (отдельный следующий аудит).