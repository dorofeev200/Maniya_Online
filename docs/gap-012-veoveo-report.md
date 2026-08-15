# GAP-012 — VeoVeo «виден, но мёртв»: ROOT-CAUSE ANALYSIS + FIX

Дата: 2026-08-15
Ветка: `gap-012-veoveo` → `dccad9c` (закоммичено + push `backup/feature/alloha-provider`)
Статус: **ЗАКОММИЧЕНО (`dccad9c`) + ЗАДЕПЛОЕНО + PROD-VERIFIED 17/17** (см. §17)

---

## 1. Executive summary

VeoVeo-источник показывается в `/api/lampa/sources/card` и выдаёт play-элементы, но
воспроизведение всегда падало с `403`. Root cause — **не контент**: контент живой
(206 HLS, TS-сегменты 0x47), а **SSRF-гард прокси блокирует redirect-цель** CDN.

- Провайдер `skaz-veoveo` отдаёт URL вида `https://api.rstprgapipt.com/content-router/…`.
- `api.rstprgapipt.com` — **routing-нода**: ВСЕГДА отвечает `307` на CDN-хост
  `*.mvapspdmpg.com` (`vn50007` / `deovi` / `vn50003` / `vn50006` / `old`).
- Наш серверный прокси (`proxyMedia`) следует 307 и **валидирует каждую redirect-цель**
  через `validateProxyTarget`. Поддомены `*.mvapspdmpg.com` **отсутствовали** в
  `PROXY_ALLOW_HOSTS` → 403 `proxy_host_forbidden` ДО соединения с CDN.
- **Фикс: один суффикс `mvapspdmpg.com` в allowlist** (суффиксное сравнение
  `isHostAllowed` покрывает все поддомены). Никаких изменений в логике показа/скрытия,
  availability, балансировке — veoveo был и остаётся «честно видимым», теперь играбельным.

Доказательство: LIVE SHADOW на проде (12 тайтлов, GET-only): **12/12 `FIXED`**
(OLD 403 → NEW 206 HLS), **0 FP, 0 FN, 0 регрессий**, полная playback-цепочка
(master → variant → TS 0x47) через прокси. Полный тестовый прогон: 555 тестов,
547 pass, 2 fail (pre-existing «дня/дней», НЕ регрессия), 6 skip.

---

## 2. Original problem

Из `docs/project-readiness-002-audit.md`: `skaz-veoveo` светится в live-матрице как
видимый источник, но resolve/playback возвращает HTTP 403. Цель GAP-012 — НЕ просто
спрятать veoveo, а установить **точную причину** и понять, может ли Maniya
достоверно определять доступность ДО показа источника.

---

## 3. Architecture trace (как запрос доходит до 403)

```
/apia/lampa/sources/card
  └─ registry → skaz-veoveo (видимый источник)
     └─ availability.checkBalancer(checksearch=true)
        └─ кластер skaz отвечает play-карточками → show:true  ← ПРАВИЛЬНО (контент есть)
  └─ /api/lampa/videos?provider=skaz-veoveo
     └─ movieVideos → items[].method='play'
        └─ url = streamProxy(card.url) = /api/lampa/proxy?url=https://api.rstprgapipt.com/…
  └─ плеер → /api/lampa/proxy?url=…
     └─ proxyMedia: validateProxyTarget(начальный URL)  → https + api.rstprgapipt.com ∈ allowlist → OK
        └─ requestOnce → routing-нода отвечает 307 Location: https://vn50003.mvapspdmpg.com/…
           └─ redirect-цикл (proxy.js:195-199):
              current = validateProxyTarget(new URL(location, current), allowHosts, httpAllowHosts)
              → https + vn50003.mvapspdmpg.com ∉ allowHosts → **403 proxy_host_forbidden** ← ПОЛОМКА
```

Точка отказа — **redirect-валидация**, а не начальный URL. В allowlist был только
`rstprgapipt.com` (routing-нода), но НЕ CDN-хост, на который она пересылает.

---

## 4. Root cause

**Категория D (playback/proxy).** SSRF-гард `validateProxyTarget` валидирует каждую
redirect-цель против `allowHosts`. `api.rstprgapipt.com` — маршрутизирующая нода,
которая **всегда** отвечает `307` на `*.mvapspdmpg.com`. Поддомены CDN не были в
`PROXY_ALLOW_HOSTS` → 403 до соединения с CDN.

Ключевые факты:
- **Контент жив**: напрямую `vn50003.mvapspdmpg.com` → 200 HLS; сегменты → 206 TS (0x47).
- **403 детерминирован**: 15/15 тайтлов, forrest ×3 = стабильно. Это НЕ флап upstream.
- **Никакой конфиг-нестыковки не было**: прод `.env` не содержит `PROXY_ALLOW_HOSTS`
  (используются дефолты config.js), а сам `rstprgapipt.com` был в дефолтах. Ложное
  впечатление «хост разрешён, но 403» объясняется именно redirect-цепочкой.

---

## 5. Live evidence (ЭТАП 2, READ-ONLY против прода)

`docs/gap012-veoveo-trace-live.jsonl` — 17 строк / 15 тайтлов (+ forrest ×3).

- **card**: `show:true` для всех 15 (кластер реально имеет контент).
- **videos**: play-элементы присутствуют (1 для фильмов, 8–10 для сериалов).
- **proxy-probe**: **403 our-json** (`proxy_host_forbidden`) для 100% проб — стабильно.
- **upstream**: `api.rstprgapipt.com` → 307 → `vn50003.mvapspdmpg.com` → 200 HLS.
  Цепочка сегментов: `vn50007 → 301 → old.mvapspdmpg.com → 206 TS (0x47)` — контент цел.
- **Детерминизм**: forrest ×3 → 403 ×3 (без флапа).

---

## 6. Matrix: 10+ тайтлов (требования GAP-012)

| Кейс (требование)            | Тайтлы                                   | card.show | OLD proxy | NEW proxy |
|------------------------------|------------------------------------------|-----------|-----------|-----------|
| Работающий фильм (эталон)    | matrix, interstellar, dune2, avatar      | true      | 403       | 206 HLS   |
| «show, но resolve=403»       | odyssey, last_house                      | true      | 403       | 206 HLS   |
| «show, но playback=403»      | forrest, dune1, spiderman_nwh, titanic, joker | true | 403    | 206 HLS   |
| Сериал                      | hotd, oa, silo, tlou                     | true      | 403       | 206 HLS   |
| Повтор ×3 (стабильность)     | forrest ×3                               | true      | 403×3     | 206×3     |

Вывод: паттерн **единый** для всех категорий — veoveo честно показывает (контент
есть), ломается исключительно прокси на redirect-цели. Нет категории «veoveo, который
работал и без фикса» — т.е. маскировки проблемы скрытием не требовалось.

---

## 7. E-Online / Lampac сравнение (ЭТАП 3)

E-Online **не является абсолютной истиной**, но сравнение на уровне кода объясняет
расхождение:

- Lampac `VeoVeo/ModInit.cs:88`:
  `stream_access = "apk,cors,web"` — включает режим **`cors`** (маска `cors=2`,
  `BaseSettings.cs`). В режиме `cors` Lampac отдаёт клиенту **прямой CDN-URL**, и
  Lampa ходит на CDN через клиентский CORS-proxy (редиректы follow'ятся клиентом,
  серверного allowlist нет).
- Maniya оборачивает **все** play-URL в серверный `/api/lampa/proxy`
  (`SkazProvider.movieVideos:130 streamProxy(...)`) → наш SSRF-гард должен знать CDN-хост.
- Значит E-Online «работает» по архитектурной причине (cors-режим), а не потому что
  его прокси умнее. Для Maniya правильный фикс — добавить суффикс CDN в allowlist,
  а не менять поток на cors (это было бы массовым изменением вне GAP-012).

(Живой Lampac-докер на VPS :9118 не ответил curl — сравнение сделано на уровне кода.)

---

## 8. OLD vs NEW (shadow)

`docs/gap012-veoveo-shadow-live.jsonl` — 12 тайтлов, GET-only, оба инстанса на одном
VPS: OLD = прод :3000 (без фикса), NEW = shadow :3100 (фикс через
`PROXY_ALLOW_HOSTS` + `mvapspdmpg.com`).

- **12/12 FIXED**: OLD 403 `proxy_host_forbidden` → NEW 206 `application/vnd.apple.mpegurl`.
- **0 FP** (нет тайтла, где NEW 403, а контент живой),
  **0 FN** (нет тайтла, где NEW 200, а контента нет),
  **0 REGRESSION** (нет тайтла, где OLD 200, а NEW 403).
- Ошибка первого прогона shadow (все «STILL_403») — артефакт скрипта: `item.url`
  содержит абсолютный public-base (`https://plugin.maniya-kvn.online/api/lampa/proxy`),
  probe шёл в ПРОД, а не в shadow. Исправлено `rewriteProxyUrl` (host → base инстанса);
  повторный прогон — 12/12 FIXED. Прод при этом не менялся.

---

## 9. Fix

`server/src/config.js` — одна строка, суффикс CDN-корня добавлен в дефолты
`PROXY_ALLOW_HOSTS`:

```diff
- allowHosts: list('PROXY_ALLOW_HOSTS', [ '…', 'cdntogo.net', 'rstprgapipt.com']),
+ allowHosts: list('PROXY_ALLOW_HOSTS', [ '…', 'cdntogo.net', 'rstprgapipt.com', 'mvapspdmpg.com']),
```

`isHostAllowed` использует суффиксное сравнение (`clean === root || clean.endsWith('.' + root)`),
поэтому **один корень покрывает все поддомены** (`vn50007`/`deovi`/`vn50003`/`vn50006`/`old`).
Изолированная валидация на проде (фикс в память, прод не тронут): MASTER 206 HLS
(переписан), VARIANT 200 HLS, SEGMENT 206 firstByte 0x47.

---

## 10. Tests

`server/test/proxy.test.js` — **3 новых теста GAP-012** (все зелёные):

1. `isHostAllowed: mvapspdmpg.com покрывает все поддомены veoveo-CDN` — суффикс
   покрывает 4 CDN-поддомена; `evil.mvapspdmpg.com.evil.com` / `mvapspdmpg.com.evil.com`
   отклоняются; без суффикса CDN-поддомен блокируется.
2. `validateProxyTarget: veoveo redirect-цель *.mvapspdmpg.com` — с суффиксом все
   redirect-цели проходят; без него — 403 `proxy_host_forbidden` (точный исходный код
   ошибки).
3. `proxyMedia: следует 307 и переписывает манифест` + `proxyMedia: 403 на
   redirect-цель` — интеграция redirect-цикла: loopback-сервер имитирует routing-ноду,
   403-тест редиректит на `https://vn50007.mvapspdmpg.com` (не в allowlist) →
   `validateProxyTarget` бросает 403 синхронно на redirect-цели; success-тест —
   редирект на разрешённый loopback-CDN → манифест переписывается на прокси.

Полный прогон: `NODE_ENV=test node --test` → **555 tests, 547 pass, 2 fail, 6 skip**.
2 падения — pre-existing `api.test.js` «Осталось N дн…» (склонение «дня/дней»), файл не
тронут → **НЕ регрессия**. Новых падений: 0.

---

## 11. Shadow (детали + playback)

- Инстанс NEW: копия прода на VPS, `/tmp/maniya-shadow`, порт 3100, данные изолированы
  (`USERS_FILE`/`VIDEOS_FILE` → копии в shadow; прод-данные не тронуты).
- Фикс применён через env `PROXY_ALLOW_HOSTS` (прод `.env` переопределён не был;
  `loadDotEnv` не перетирает заданные env).
- Playback-цепочка через NEW прокси (`docs/gap012-veoveo-playback.jsonl`):
  - odyssey (фильм): master 206 HLS (переписан, `masterHasProxySegments:true`) →
    variant 206 HLS → сегмент 206 TS (0x47). **OK**
  - hotd (сериал): та же цепочка → 206/206/206 TS 0x47. **OK**
- После проверки shadow остановлен, `/tmp`-артефакты удалены, порт 3100 освобождён.

---

## 12. Regression analysis

- **Прокси-allowlist расширен на один суффикс** — риска для других источников нет:
  `isHostAllowed` блокирует только точный корень и его поддомены; `mvapspdmpg.com`
  не конфликтует ни с одним существующим хостом.
- **Проверено в shadow**: filmix, kodik, rezka и остальные источники НЕ трогались
  (фикс — только allowlist, не логика выбора/показа). Полный suite без новых падений.
- **Никакой логики availability/балансировки не изменено** — BALANCER-STABILITY-002/003,
  online8-политика, GAP-005/GAP-002 не затронуты.
- Производительность: фикс не добавляет задержки к запросам (403 раньше кидался без
  соединения; NEW добавляет 2 upstream-хопа — routing 307 + CDN fetch, что является
  архитектурой veoveo, а не следствием фикса).

---

## 13. Performance / latency

Через NEW-прокси (shadow, тот же VPS/кластер):
- master-манифест: ~113–328 ms (206 HLS, переписан).
- variant: ~94–204 ms (206 HLS).
- сегмент: ~387–397 ms (206 TS, 0x47).

Это время уже включает redirect-хоп routing-ноды и загрузку с CDN; накладные расходы
проксирования в пределах нормы. 403-ветка OLD была «быстрее» только потому, что
обрывалась без соединения — это не выигрыш, а сама поломка.

---

## 14. Risks

- **Suicide-риск почти нулевой**: один суффикс, суффиксное сравнение, no conflict.
- **Зависимость от upstream-архитектуры**: если veoveo сменит CDN-домен, снова будет
  403 — но тот же механизм (307 + allowlist) уже диагностируется скриптами
  `scripts/gap012-veoveo-trace.mjs`. Лечится добавлением нового корня.
- **SSRF-поверхность**: `mvapspdmpg.com` — CDN-домен, разрешён только для https и
  только через прокси, никаких схем/портов наружу. Допустимый риск (аналогично
  `filmix.my`, `kodikres.com` и т.д.).
- **Прод сегодня**: veoveo по-прежнему 403 до деплоя — это pre-existing поведение, не
  ухудшенное отчётом. Прод за время работы был перезапущен systemd (`Restart=always`,
  код и `.env` не менялись) — поведение идентично.

---

## 15. Recommendation

**Применить фикс** (1 строка в `server/src/config.js` + 3 теста). Это минимальное
изменение, доказанное живым shadow 12/12 и playback-цепочкой. Не рекомендую
какие-либо дополнительные изменения: veoveo «честно видим» (кластер имеет контент),
и после деплоя он станет играбельным — маскировать его не нужно.

Отдельно (вне GAP-012, на будущее): если цель — снизить число «видимых, но битых»
источников в принципе, можно добавить на shadow/прод периодический probe redirect-цели
и не показывать источник при неразрешённом CDN-хосте; но это решение большего масштаба
и не входит в данный GAP.

---

## 16. Acceptance checklist

| Критерий | Статус |
|---|---|
| Root cause доказан (не скрытие) | ✅ 403 — SSRF redirect-валидация, контент живой |
| LIVE TRACE ≥10 тайтлов, включая повтор ×3 | ✅ 15 тайтлов / 17 строк, forrest ×3 |
| «рабочий фильм» / «show→403» / «сериал» в матрице | ✅ §6 |
| E-Online сравнение на уровне кода | ✅ §7 (cors-режим Lampac) |
| Классификация ровно одна категория D | ✅ §4 |
| Запрещённые приёмы НЕ использованы | ✅ нет `if source===veoveo show=false`, нет «403=hide» |
| Минимальный фикс + тесты | ✅ 1 строка config.js + 3 теста |
| Shadow OLD vs NEW на VPS, ≥10 тайтлов | ✅ 12/12 FIXED, 0 FP / 0 FN / 0 регрессий |
| Playback через NEW | ✅ master→variant→TS 0x47, PLAYBACK_OK |
| Полный тестовый прогон, новых падений 0 | ✅ 547 pass / 2 pre-existing fail / 6 skip |
| Отчёт без реальных кредов | ✅ (маскированные фингерпринты, токены не выводятся) |
| **STOP: без commit/push/deploy** | ✅ выполнено в первоначальном цикле; затем юзер разрешил → `dccad9c` + backup + deploy + prod-verify (§17) |

---

## 17. Production verification (2026-08-15, после деплоя)

Коммит `dccad9c` → push `backup/feature/alloha-provider` → `scripts/deploy.sh` → live-проверка.

- **Health**: `https://plugin.maniya-kvn.online/health` → `{"ok":true}`.
- **Целостность деплоя**: md5 `server/src/config.js` локальный == VPS
  (`520aa444a0d88cc4f214fbe8ee28b5f4`), `mvapspdmpg` на VPS = 1 вхождение,
  systemd `active`, NRestarts=0.
- **veoveo live-trace (все 15 тайтлов + forrest×3 = 17 строк, скрипт
  `scripts/gap012-veoveo-trace.mjs` против `127.0.0.1:3000`)**: **17/17 probe=206**
  (было 403), `cardShow:true` на всех, videos 1 (фильмы) / 8–10 (сериалы).
  0 сломанных.
- **Playback-цепочка через прод-прокси** (`gap012-prod-playback.mjs`):
  odyssey master 206 HLS (272ms) → variant 206 HLS (219ms) → сегмент 206 TS 0x47
  (383ms); hotd master 206 (241ms) → variant 206 (121ms) → сегмент 206 TS 0x47
  (73ms); `masterHasProxySegments:true` → `PLAYBACK_OK`.
- **veoveo через публичный HTTPS** (путь реального плеера, Range probe):
  206 `application/vnd.apple.mpegurl`, `#EXTM3U`.
- **Регрессии**:
  - filmix (Форрест Гамп, trusted): 206 `video/mp4` (ftyp isom, 2160p), стабильно ×2.
  - skaz-alloha (Интерстеллар 8 items / Матрица 7 items), rezka (Матрица 18 items) — OK.
  - kodik: 0 items на проверенных тайтлах — **подтверждено upstream-данные**
    (прямой `kodik-api.com` с прод-токеном: `total:0` по kinopoisk_id/imdb_id Матрицы,
    но `title="matrix"` → 2 результата — токен жив; код kodik и KODIK_TOKEN не менялись,
    allowlist не участвует в API-пути kodik). НЕ регрессия.
- **Latency** (прод): master 241–272ms, variant 121–219ms, сегмент 73–383ms —
  включает redirect-хоп routing-ноды veoveo.
