# GAP-002 — Collaps: visible-but-dead. Root cause = egress-блок embed-хоста (HTTP 422)

**Тип:** READ-ONLY исследование (код НЕ менялся, ни одного коммита/пуша/деплоя).
**Дата прогона:** 2026-08-15.
**Целевой прод:** `https://plugin.maniya-kvn.online` (VPS 95.85.241.121, Стокгольм, datacenter).
**Эталон для сравнения:** skaz-кластер `online3.skaz.tv` (E-Online) + Lampac `Modules/OnlineRUS/Collaps`.
**Скрипты (временные, вне репо):** `Temp/gap002-collaps-matrix.mjs`, `Temp/collaps-trace.mjs`,
`Temp/collaps-card-local.mjs`, `Temp/collaps-videos-local.mjs`, `Temp/collaps-videos-prod.mjs`,
`Temp/card-raw.mjs`, `Temp/eo-collaps-probe.mjs`. Токен COLLAPS в `Temp/collaps-token.txt` (удалён в конце прогона).
**Верификатор:** токены пользователей из `Temp/prod-verify-users.json` (не публикуются).

---

## 1. Executive Summary

**Collaps показан на каждой карточке (`/sources/card` → `show:true`), но `/videos` всегда возвращает `items:[]`** — источник-призрак в UI. Причина — НЕ «playback сломан» и НЕ «провайдер не портирован», а **инфраструктурный блок на уровне egress-IP**:

- Collaps использует два API-хоста: **search** (`api.bhcesh.me` — Cloudflare, работает с VPS) и **embed** (`api.ortified.ws` / `api.luxembd.ws` — оба за `89.42.231.152`, nginx).
- Маршрут `/embed/*` на embed-хосте **детерминированно отвечает HTTP 422 (пустое тело) с datacenter-IP** VPS, но **200 с полным HTML плеера (17–18 КБ) с домашнего (резидентного) IP**. Проверено curl/Node-fetch, всеми вариантами заголовков/UA/HTTP-версий — с VPS всегда 422.
- Провайдер **корректен**: с резидентного IP `nativeProbe` находит контент (authoritative `found`), `videos()` отдаёт play-items (Форрест 1, Матрица 1, Интерстеллар 1, Дом Дракона 10 items/3 сезона/9 озвучек), стрим-CDN (`interkh.com`) **доступен с VPS** (master 200). Играть было бы чему — мешает только 422 на embed.
- Следствие архитектуры: `nativeProbe` на любую ошибку embed → `inconclusive` → `show:true` (показ на безопасной стороне); `/videos` глотает ту же ошибку в `items:[]` (200, без `provider_error`). Итог: **FP 10/10** — источник виден, но контента из этого деплоя получить нельзя.
- Эталон (E-Online/skaz): **модуль collaps выключен** (`lite/collaps` → 403 `disable`, в events нет) — эталон тоже не обслуживает collaps. Maniya архитектурно честнее (провайдер жив), но операционно хуже (виден «мёртвый» источник).

**Правильное решение — НЕ «спрятать, потому что не играет»**, а:
1. **(код, минимально)** детерминированный отказ хоста (HTTP 403/422/451, «жёсткий отказ» еgress) считать **authoritative «нет»** в `nativeProbe` (а не inconclusive-показ), с существующим гейтом OLD∩NEW (повторная проба с backoff) и self-heal HIDE_TTL — источник перестанет светиться, пока egress заблокирован, и вернётся, когда доступ восстановится;
2. **(опционально, UX)** `/videos` поверх такого отказа отдавать `provider_error` вместо тихого `items:[]` — клиент покажет «источник недоступен (блок сети)», а не «видео не найдено»;
3. **(корневое, операционное)** восстановить egress к embed-хосту (прокси/разрешённый IP) — тогда collaps реально заработает, и пункт 1 сам себя вылечит.

См. §11 (минимальный фикс), §12 (альтернативы), §17 (рекомендация).

---

## 2. Текущее поведение в проде

| Точка | Наблюдение (2026-08-15) |
|-------|--------------------------|
| `/api/lampa/sources` | collaps **всегда в реестре** (native-провайдер, `enabled()=true` — токен задан). |
| `/api/lampa/sources/card` | collaps `show:true` **на всех 10 проверенных карточках**; `elapsed_ms` в норме (8851 на холодной 16-источниковой карте). Клиент получает `{id:'collaps', show:true}` (диагностические поля роут срезает). |
| `/api/lampa/videos?provider=collaps` | **200, `items:[]`, `seasons:[]`, `voices:[]`, без `provider_error`**, 440–1000 мс. |
| Playback | недостижимо: items нет → резолвить нечего. |
| UI (`applyCardAvailability`) | `row.show !== false` → collaps отображается; клик → «видео не найдено». |

Все 10 тайтлов матрицы (5 фильмов + 5 сериалов) ведут себя одинаково (§5).

---

## 3. Архитектурный путь (куда упирается сигнал)

```
/sources/card ──► computeCard ──► nativeProbe(collaps)
                                   └─ NATIVE_PROBES.collaps.present()
                                        └─ recordByKeys → embed() → GET api.ortified.ws/embed/{kp|imdb|movie}/{id}
                                             └─ с VPS: HTTP 422 (пусто) → HttpError(422)
                                                  └─ catch в nativeProbe → {show:true, inconclusive, reason:'error'}
                                                       └─ row.show=true (не «нет») → НЕ попадает в OLD∩NEW-гейт
                                                            └─ кэш 5 мин, hasInconclusive (self-heal по TTL/force)

/videos?provider=collaps ──► store.js single-provider path ──► CollapsProvider.videos()
                                   └─ embed() → с VPS: HTTP 422 → throw
                                        └─ catch → {items:[], seasons:[], voices:[]}
                                             └─ store.js: items пусто → fallback search() → записи БЕЗ url/stream
                                                  └─ фильтр «играбельных» отсекает → {items:[]}
```

Ключевое: **и карточка, и /videos бьются в одну и ту же точку (embed) и получают одну и ту же 422** — но трактуют её по-разному: карточка на безопасной стороне **показывает** (error→inconclusive→show), /videos **молча глотает** (catch→items:[]). Поэтому источник «светится», но никогда не отдаёт видео.

---

## 4. Доказательства

### 4.1 Embed-хост блокирует datacenter-IP (422), с резидентного IP отдаёт контент

Один и тот же URL `https://api.ortified.ws/embed/imdb/tt0109830` (Форрест Гамп), идентичные заголовки `Origin/Referer: kinokrad.my`:

| Источник запроса | Результат |
|------------------|-----------|
| Локально (домашний IP) | **200**, 17 094–18 146 байт, HTML плеера c `makePlayer`, `hls: "https://…/master.m3u8…"` |
| VPS (95.85.241.121, Стокгольм) curl/HTTP1.1 | **422**, 0 байт |
| VPS curl/HTTP2 | **422**, 0 байт |
| VPS Node 22 fetch (undici — боевой клиент) | **422**, 0 байт |
| VPS с браузерными UA + sec-fetch-заголовками | **422**, 0 байт |
| VPS без Origin/Referer | **422**, 0 байт |

Заголовки 422: `Server: nginx`, `Content-Length: 0`, `Vary: *`, `Access-Control-Allow-Origin: https://kinokrad.my`. Плюс: `api.ortified.ws` и `api.luxembd.ws` резолвятся в **один IP 89.42.231.152** (ideacom.ws), оба дают 422 с VPS. Cloudflare-хост `api.bhcesh.me` (search) с VPS работает (200), но `/embed/*` там **404 «Invalid Route»** (embed переехал на ortified). Вывод: 422 — **маршрутный geo/IP-гейт `/embed/*` для не-резидентных IP**, стабильный во всём окне прогона (многократные пробы), а не транзиентная ошибка.

### 4.2 Провайдер корректен, когда embed доступен (с резидентного IP)

| Тайтл | nativeProbe (card) | videos() |
|-------|--------------------|----------|
| Форрест Гамп | `show:true authoritative:true reason=found` | **1 play-item** (auto, субтитры, озвучка «По умолчанию») |
| Матрица | `show:true reason=found` | **1 play-item** |
| Интерстеллар | `show:true reason=found` | **1 play-item** |
| Дом Дракона (serial) | `show:true reason=found` | **10 items / 3 сезона / 9 озвучек** |

Все items — `method:'play'` через прод-прокси, `headers: {Referer: kinokrad}`. То есть **parser/normalizer/videos/streams работают**; единственный сбой — fetch embed с боевого egress.

### 4.3 Стрим-CDN доступен с VPS (playback был бы рабочим)

`master.m3u8` из embed (`https://hye1eaipby4w.interkh.com/…/master.m3u8?fckz2=…`) с VPS → **200, 18 749 байт**, реальные variant-URL (index-v1/v2). Значит после восстановления embed доступ к стримам прокси-плейбек отдаст.

### 4.4 Search-API работает с VPS (контент ВВЕРХ по потоку есть)

`GET https://api.bhcesh.me/list?token=…&name=<title>` с VPS → 200, `results` найдены **для всех 10 тайтлов матрицы** (Форрест id=164, Интерстеллар id=180 и т.д.). Каталог collaps содержит эти тайтлы — «нет контента» это не про каталог, а про недоступный embed.

---

## 5. Матрица из 10 тайтлов (прод, 2026-08-15)

Каждый тайтл: collaps search с VPS (контент вверх по потоку) → `/sources/card` вердикт → `/videos` items.

| # | Тайтл | id (tmdb) | serial | search (VPS) | card collaps | /videos status | items | provider_error |
|---|-------|-----------|--------|--------------|--------------|----------------|-------|----------------|
| 1 | Форрест Гамп | 13 | 0 | search-ok | show=true | 200 / 488 мс | **0** | — |
| 2 | Матрица | 603 | 0 | search-ok | show=true | 200 / 485 мс | **0** | — |
| 3 | Интерстеллар | 157336 | 0 | search-ok | show=true | 200 / 483 мс | **0** | — |
| 4 | Одиссея 2026 | 1368337 | 0 | search-ok | show=true | 200 / 456 мс | **0** | — |
| 5 | Последний дом 2026 | 1284041 | 0 | search-ok | show=true | 200 / 788 мс | **0** | — |
| 6 | Дом Дракона | 94997 | 1 | search-ok | show=true | 200 / 1001 мс | **0** | — |
| 7 | The OA | 71712 | 1 | search-ok | show=true | 200 / 466 мс | **0** | — |
| 8 | Укрытие (Silo) | 125988 | 1 | search-ok | show=true | 200 / 443 мс | **0** | — |
| 9 | Во все тяжкие | 1396 | 1 | search-ok | show=true | 200 / 440 мс | **0** | — |
| 10 | Шерлок | 1622 | 1 | search-ok | show=true | 200 / 412 мс | **0** | — |

**Итог матрицы:** search-ok 10/10, card show 10/10, videos items 0/10. Колонка «items» для collaps всегда 0 **независимо** от того, есть ли контент в каталоге — детерминированный след еgress-блока embed, а не «контента нет».

---

## 6. Сравнение со Skaz (исходный / эталонный кластер)

| Аспект | Skaz / E-Online (online3.skaz.tv) | Maniya (native collaps) |
|--------|-----------------------------------|-------------------------|
| Наличие модуля | `lite/collaps` → **403 `disable`** (7 байт, то же, что у online8-легаси) | провайдер включён (токен задан) |
| В списке `lite/events` | **collaps отсутствует** (26 балансеров на Форресте — collaps нет) | всегда в статическом реестре |
| checksearch per-card | нет (модуль выключен) | nativeProbe (embed→422→inconclusive→show) |
| Поток embed | — | `/embed/*` → 422 с datacenter-IP |
| Итог | эталон collaps **не обслуживает** | Maniya **показывает мёртвый источник** |

Паттерн `403 disable` на кластере — уже знакомая механика (BALANCER-ONLINE8-001/002): **модуль выключен на ноде**, это политика, а не «контента нет». Кластер тоже не может отдавать collaps с datacenter-инфраструктуры — вероятно, по той же причине (embed-хост режет datacenter-IP), оператор просто отключил модуль. Это сильное подтверждение, что блок embed-хоста — давнее и системное свойство, а не флак.

**Важное отличие от online8-abstain:** 403 `disable` от online8 (резервная легаси-нода) ≠ «нет», потому что primary-кластер может иметь контент. Здесь 422 приходит от **собственного контент-хоста единственного источника (native, без резерва)** — это отказ самого сервиса для данного egress, эквивалент «нет» для этого деплоя. Абстэйн тут не применим.

---

## 7. Сравнение с E-Online (но НЕ как абсолютная истина)

| Критерий | E-Online | Maniya | Вердикт |
|----------|----------|--------|---------|
| Показывает ли collaps в UI | Нет (модуль 403 `disable`, в events нет) | Да (native включён) | Maniya **хуже** операционно (мёртвый источник виден) |
| Может ли вообще обслужить collaps | Нет (модуль выключен) | Да, **если** egress к embed восстановлен (доказано: с резидентного IP всё работает) | Maniya **лучше** архитектурно (провайдер живой, не вырезан) |
| Причина недоступности | оператор выключил модуль | egress-блок `/embed/*` | разная, но корень один — collaps не обслуживается с datacenter |

Вывод: **Maniya не должна подражать EO «выключить модуль навсегда»** (это потеря живого провайдера). Правильно — не показывать источник, пока egress заблокирован, и дать ему автоматически вернуться при восстановлении доступа (авто-само-лечение, а не ручное отключение).

---

## 8. Root cause (одной фразой)

**Collaps-embed (`/embed/*` на api.ortified.ws) детерминированно отказывает egress-IP деплоя (HTTP 422, пустое тело, nginx `Vary:*`), поэтому: (а) `nativeProbe` на карточке видит ошибку → по дизайну «показываем при неопределённости» → `show:true` на всех карточках; (б) `videos()` глотает ту же ошибку в `items:[]` без `provider_error`. Провайдер/нормализатор/парсер/стримы корректны (доказано с резидентного IP), CDN стримов доступен с VPS — блокируется только один маршрут embed.**

---

## 9. Классификация

| Уровень | Что |
|---------|-----|
| **P1 (системный UX-дефект)** | collaps «светится» на каждой карточке, но никогда не отдаёт видео — нарушает DoD «на карточках нет visible-but-dead». Не P0 (нет потери данных/безопасности), но системно (все карточки) и видно каждому пользователю. |
| Вне скоупа | 422 — свойство инфраструктуры провайдера (geo/IP-гейт `/embed/*`), не дефект кода Maniya и не «провайдер не портирован». |
| Вторичное | `orid`-фолбэк (`/embed/movie/{tmdb_id}` → 404, когда TMDB id ≠ collaps-orid) — мелочь при отсутствии imdb/kp; не корень проблемы. |

---

## 10. Предлагаемый минимальный фикс

**Идея (в духе кодовой базы):** «жёсткий отказ» (hard refusal) контент-хоста = authoritative «нет», а не inconclusive-показ. В кодовой базе уже есть прецеденты классификации не-2xx как «нет»-сигнала (403 `disable` для primary, legacy-политика online8). Разница только в том, что сейчас **все** ошибки nativeProbe (сеть, таймаут, 5xx, 4xx) сваливаются в inconclusive-показ.

1. **`server/src/availability.js`, `nativeProbe` catch:** если ошибка — `HttpError` со статусом из набора «жёстких отказов» `{403, 422, 451}` → вернуть `{show:false, authoritative:true, reason:'host-block', status}`. Сеть/таймаут/5xx/прочие 4xx → как сейчас (`inconclusive → show`). Набор кода можно вынести в константу (`HARD_REFUSAL_STATUSES`).
2. **Единый гейт OLD∩NEW уже на месте:** row станет `show:false authoritative` → попадёт в `eligible` (строка 950) → `confirmNativeAbsence` повторит пробу с backoff (2 независимых 422 → подтверждённый hide). Инconclusive-подтверждение (например, второй раз сеть легла) → RULE-4: первичный «нет» остаётся, ряд помечается inconclusive → кэш HIDE_TTL с self-heal.
3. **Self-heal заложен:** подтверждённый hide кэшируется на HIDE_TTL_MS (60 с) → каждый повторный заход (или `force`) перепробует embed; как только egress восстановлен — `found` → `show:true` снова. Никакого ручного включения не нужно.

**Это НЕ «спрятать, потому что не играет»**: источник прячется только потому, что его контент-хост **детерминированно отказывает egress деплоя** — это операционный факт «из этого деплоя контент недоступен», а не «контента нет» и не «провайдер сломан». Когда доступ восстановлен — источник возвращается сам.

---

## 11. Альтернативы (рассмотрены, отклонены/отложены)

| # | Вариант | Вердикт |
|---|---------|---------|
| A | **Скрывать при 0 items (обратная связь videos→card)** — исходная формулировка GAP-002 | ❌ Отклонено: это «hide because dead», запрещено заданием; скрыло бы и живые native-источники при временной пустоте; против принципа «не прятать рабочий». |
| B | **Убрать collaps из реестра (`enabled()=false`)** | ⚠️ Отложено: решает симптом, но теряет живой провайдер навсегда (не вернётся при фиксе egress без ручного шага). Уступает §10 (self-heal). |
| C | **Хардкод «collaps → show:false»** | ❌ Отклонено: магическая константа, не обучается, не само-лечится. |
| D | **Обход блока: прокси/eгress к embed (резидентный IP)** | ⏳ **Корневое операционное решение** (вне кода): поднять HTTP-прокси/маршрут с разрешённого IP для embed-хоста. Тогда §10 сам вернёт collaps. Реализация — отдельная задача (инфраструктура), не код-патч. |
| E | **Опционально: `/videos` → `provider_error`** | ✅ Рекомендуется вместе с §10: клиент сможет показать «источник недоступен (блок сети)» вместо «видео не найдено» для закешированных карточек. |

---

## 12. Риски регрессии

- **Ложный hide при транзиентном 4xx:** если у живого источника вдруг появится 403 (например, rate-limit на probe) — confirm-гейт (2 независимые пробы с backoff) + HIDE_TTL (60 с) + self-heal ограничивают окно до минуты; источник вернётся сам. Риск низкий: у collaps/cdnvideohub (единственных native-пробы) нормальное состояние — 200 или 422-блок, 403 в штатной работе не встречается.
- **Скоуп:** изменение только в catch `nativeProbe` — skaz-путь (checkBalancer/online8 abstain/OLD∩NEW для skaz), TRUSTED, HIDE_TTL, single-flight, кэш/uid/force **не тронуты**. Другие провайдеры не затрагиваются (их пробы не проходят через этот catch при нормальной работе).
- **Поведение cdnvideohub:** у него `noKeyVerdict='absent'` — реальные запросы без kp уже дают authoritative «нет»; 422-классификация не меняет практический результат.
- **Согласованность с online8-abstain:** abstain относится к skaz-резерву (403 `disable` от легаси-ноды ≠ «нет»); здесь 422 от **primary** контент-хоста native-источника без резерва — другой сигнал, конфликта нет (§6).

---

## 13. План тестов (имплементационная фаза — после отдельного одобрения)

1. **Unit (`server/test/availability-hidden-twin.test.js`, +2–3 теста):**
   - `recordByKeys` бросает `HttpError(422)` → `nativeProbe` → `{show:false, authoritative:true, reason:'host-block'}`;
   - сеть (ECONNRESET) / 5xx → по-прежнему `inconclusive → show` (регресс-защита существующего теста «recordByKeys бросает (сеть) → inconclusive»);
   - подтверждающий проход: 2×422 (confirmNativeAbsence) → hide; второй раз inconclusive → RULE-4 (первичный «нет», hasInconclusive).
2. **Регрессия:** `cd server && NODE_ENV=test node --test` → 564 + новые, 0 fail (сейчас 564/558/0/6 skip — база чистая).
3. **(Опционально)** `collaps-provider.test.js`: videos() при HttpError(422) → `provider_error.code='collaps_embed_block'`.

---

## 14. План live-верификации (после деплоя фикса)

1. Матрица §5 (10 тайтлов): collaps `show:false` на всех → **FP 10/10 → 0/10**.
2. `/sources/card` elapsed не вырос (гейт добавляет ~0.5–1 с на первый hide-цикл, потом кэш).
3. Остальные 15 источников без изменений (видимость/items не тронуты).
4. (Опционально) `/videos?provider=collaps` → `provider_error` вместо тихого items:[].
5. Self-heal: временный «разрешённый» egress-проброс embed → в течение HIDE_TTL/TTL collaps возвращается (`show:true`, items>0, playback 200).

---

## 15. Точные файлы, которые ПОТРЕБУЮТ изменения (имплементация)

| Файл | Что | Оценка |
|------|-----|--------|
| `server/src/availability.js` | `nativeProbe` catch: классификация `HttpError` 403/422/451 → `{show:false, authoritative:true, reason:'host-block'}` + константа `HARD_REFUSAL_STATUSES` | ~8 строк |
| `server/test/availability-hidden-twin.test.js` | +2–3 теста (§13.1) | ~30 строк |
| `server/src/providers/collaps/CollapsProvider.js` | (опционально) videos(): HttpError-блок → `provider_error` | ~5 строк |
| `server/test/collaps-provider.test.js` | (опционально) тест provider_error | ~10 строк |
| `docs/gap-002-collaps-report.md` | этот отчёт | — |

**Что НЕ трогать:** `checkSearchPredicate`/`classifyLinkCard` (GAP-005), `TRUSTED_ALWAYS_VISIBLE`, `HIDE_TTL_MS`, single-flight, OLD∩NEW, `reservePolicy='abstain'` (online8), кэш-ключ/uid-скопинг, `force`, остальные провайдеры (filmix/kodik/rezka/hdvb/rutubemovie/cdnvideohub/skaz-*), порядок диспатча `store.js`, `applyCardAvailability` (UI), `proxy.allowHosts` (SSRF).

---

## 16. Ожидаемые FP/FN до и после

| Метрика | До | После (§10) |
|---------|----|-------------|
| **FP** (collaps виден, но items=0) | **10/10** | **0/10** (скрыт, пока egress заблокирован) |
| **FN** (collaps скрыт, хотя контент доступен из деплоя) | 0 | 0 (при восстановлении egress → `found` → show; false-hide исключён: блок детерминированный + двойное подтверждение) |
| Побочные источники | — | не затронуты (скоуп = nativeProbe catch) |

---

## 17. Итоговая рекомендация

1. **Реализовать §10** (минимальный код): жёсткий отказ embed-хоста (403/422/451) → authoritative «нет» в `nativeProbe`, с существующим OLD∩NEW-гейтом и HIDE_TTL self-heal. Это закрывает FP 10/10 и приводит операционный итог к уровню эталона (collaps не светится), **не** вырезая живой провайдер.
2. **Опционально в том же цикле — §11-E** (`provider_error` в `/videos`) для честного UX на закешированных карточках.
3. **Корневой фикс — отдельный операционный трек:** разрешить egress к `api.ortified.ws` (прокси/разрешённый IP). После него collaps **реально заработает** (провайдер доказанно рабочий, стрим-CDN с VPS доступен), а пункт 1 само-вылечится. До этого момента показывать collaps пользователю — всегда обман.
4. **НЕ** скрывать «потому что не играет», **НЕ** выпиливать провайдер из реестра, **НЕ** менять anything в §15 «не трогать».

---

*Конец отчёта GAP-002 (read-only фаза). READ-ONLY соблюдён: код не менялся, коммитов/пушей/деплоев не было; созданы только временные скрипты верификации (вне репо, токены удалены) и этот документ.*

---

# ПРИЛОЖЕНИЕ — IMPLEMENTATION PHASE (одобрена отдельно, 2026-08-15)

Реализован минимальный scope из одобрения: изменены ТОЛЬКО `server/src/availability.js` и
`server/test/availability-hidden-twin.test.js`. Commit/push/deploy **НЕ выполнялись**.
Live-shadow выполнялся на VPS в `/tmp/gap002-shadow` (scratch-копия `server/src` с патченным
`availability.js` + копия `server/.env`) — **`/opt/maniya-online` не тронут** (scratch удалён,
деплой-файл `availability.js` нетронут). Токен COLLAPS для recovery-пробы читался в
`Temp/collaps-token.txt` и удалён.

## 18. Точный diff

### `server/src/availability.js` (+23/−1)

```diff
@@ import
 import { config } from './config.js';
 import { registeredProviders, twinFor } from './providers/registry.js';
+import { HttpError } from './errors.js';
@@ (после genericCardKey)
+// GAP-002: детерминированный отказ контент/embed-хоста (напр. geo/IP-гейт
+// `/embed/*` → 422 у collaps). Это операционный факт «из этого деплоя контент
+// недоступен», а НЕ транзиентная сетевая ошибка → authoritative «нет» вместо
+// inconclusive-показа. 5xx/таймаут/ECONNRESET/ECONNREFUSED/DNS намеренно НЕ входят:
+// они оставляют inconclusive (см. nativeProbe catch). Без provider-specific хардкода:
+// применимо к любому native-провайдеру, чей контент-хост ответил жёстким отказом.
+const HARD_REFUSAL_STATUSES = new Set([403, 422, 451]);
@@ nativeProbe catch (единственное поведенческое изменение)
   } catch (error) {
-    // Сеть/HTTP/таймаут/дедлайн — вердикта нет: показываем (не прячем рабочий).
+    // GAP-002: детерминированный отказ контент/embed-хоста (403/422/451) —
+    // authoritative «нет» (host-block). Не транзиентный сбой: это стабильный
+    // гео/IP-гейт хоста против egress-IP деплоя. Существующий OLD∩NEW-гейт
+    // подтверждает второй пробой (confirmNativeAbsence) и прячет НА HIDE_TTL_MS —
+    // self-heal: как только доступ к хосту восстановится, следующий probe
+    // вернёт found → источник снова видим (без ручного включения).
+    if (error instanceof HttpError && HARD_REFUSAL_STATUSES.has(error.statusCode)) {
+      return {
+        show: false, authoritative: true, status: error.statusCode,
+        reason: 'host-block', error: String((error && error.message) || error).slice(0, 60)
+      };
+    }
+    // Сеть/HTTP/таймаут/дедлайн/5xx/прочие 4xx — вердикта нет: показываем (не прячем рабочий).
     return {
       show: true, authoritative: false, inconclusive: true, status: 0,
       reason: 'error', error: String((error && error.message) || error).slice(0, 60)
```

**Поведение:** HTTP 403/422/451 (`HttpError` с `statusCode` из набора) в catch `nativeProbe` →
`{show:false, authoritative:true, reason:'host-block', status}`. Таймаут/дедлайн/ECONNRESET/
ECONNREFUSED/DNS/5xx/прочие 4xx/plain Error (не `HttpError`) → прежнее
`{show:true, inconclusive:true, reason:'error'}`. Никаких `if (source === 'collaps')` — правило
статус-ориентированное и применимо к любому native-провайдеру.

### `server/test/availability-hidden-twin.test.js` (+122)

- импорт `HttpError` из `../src/errors.js`;
- блок `GAP-002: host-block` после существующих native-тестов: 9 новых тестов (§19).

## 19. Тесты

| # | Тест (A–G одобрения) | Утверждения |
|---|----------------------|-------------|
| A | `GAP-002 host-block: HttpError 422 → show:false + authoritative:true` | `show=false`, `authoritative=true`, `inconclusive=undefined`, `reason='host-block'`, `status=422` |
| B | `HttpError 403 → show:false + authoritative:true` | то же, `status=403` |
| C | `HttpError 451 → show:false + authoritative:true` | то же, `status=451` |
| E | `НЕ host-block: HttpError 500 → inconclusive (show:true)` | `show=true`, `inconclusive=true`, `reason='error'` |
| D | `НЕ host-block: timeout → inconclusive (show:true)` | то же (plain Error `deadline timeout`) |
| F | `НЕ host-block: DNS (ENOTFOUND) → inconclusive` | то же |
| F | `НЕ host-block: ECONNRESET → inconclusive` | то же |
| — | `НЕ host-block: plain Error "HTTP 403" (не HttpError) → inconclusive` | защита: текст кода в сообщении НЕ классифицируется (существующий тест `recordByKeys бросает (сеть)` остался валидным и покрывает это) |
| G | `self-heal: host-block → hidden; следующий успешный probe → show:true` | фаза 1 (422) → hide; фаза 2 (тот же код, `mode='ok'`) → `show=true reason='found'` |

**Прогоны:**
- `server/test/availability-hidden-twin.test.js` → **24/24 pass** (15 существующих + 9 новых).
- Полный suite `cd server && NODE_ENV=test node --test` → **573 tests, 567 pass, 0 fail, 6 skip**
  (база до фазы: 564/558/0/6 → +9 новых, ноль регрессий).

## 20. Live-shadow OLD vs NEW (10 тайтлов)

**Методика:** OLD = живой прод (непатченный) `/sources/card`, force, userA. NEW = патченный код,
запущен на самом VPS из scratch `/tmp/gap002-shadow` (реальный datacenter egress → реальный 422),
тот же `.env`, `createAvailabilityChecker()`, `card(..., force:true)`.

| Тайтл | OLD collaps | NEW collaps | NEW reason |
|-------|-------------|-------------|------------|
| Форрест Гамп | show:true | **show:false** | host-block, confirmed |
| Матрица | show:true | **show:false** | host-block, confirmed |
| Интерстеллар | show:true | **show:false** | host-block, confirmed |
| Одиссея 2026 | show:true | **show:false** | host-block, confirmed |
| Последний дом 2026 | show:true | **show:false** | host-block, confirmed |
| Дом Дракона | show:true | **show:false** | host-block, confirmed |
| The OA | show:true | **show:false** | host-block, confirmed |
| Укрытие (Silo) | show:true | **show:false** | host-block, confirmed |
| Во все тяжкие | show:true | **show:false** | host-block, confirmed |
| Шерлок | show:true | **show:false** | host-block, confirmed |

`confirmed:true` = hide прошёл OLD∩NEW-гейт (confirmNativeAbsence: вторая независимая проба тоже 422).
`hasInconclusive:false` на collaps-ряду; кэш на hide → HIDE_TTL (self-heal по TTL/force).

## 21. FP/FN before/after

| Метрика | До | После |
|---------|----|-------|
| **FP** (collaps виден, items=0) | **10/10** | **0/10** |
| **FN** (collaps скрыт при доступном контенте из деплоя) | 0 | **0** (recovery, §23) |

## 22. Регрессия (остальные источники)

- **filmix**: 10/10 `show:true` в OLD и NEW (TRUSTED_ALWAYS_VISIBLE — никогда не пробируется, не тронут).
- **rezka**: OLD и NEW совпадают 10/10 (Одиссея → `show:false` confirmed — легитимное «нет», как в OLD).
- **Полный набор источников**: 16 в OLD и NEW (идентичный состав). cdnvideohub: OLD `show:false` ↔ NEW `show:false` (`reason:no-key` — диагностика, `show` не изменился).
- **Run-to-run флап (НЕ патч)**: в независимых прогонах ОДНОГО кода skaz-кластерные источники дают разные
  вердикты — `NEW-RUN2` (идентичный патч) vs `NEW-RUN1`: skaz-kinopub false→true, rutubemovie true→false,
  skaz-kinoflix/geosaitebi true→false (Дом Дракона). Это pre-existing флак кластера (GAP-003/kinopub
  burst-насыщение, задокументировано ранее), НЕ влияние патча: skaz-ряды не проходят через nativeProbe,
  а kodik/rutubemovie (generic search-проба) в обоих прогонах `reason:""` без `host-block` (флап = каталог).
  collaps детерминирован: host-block во ВСЕХ NEW-прогонах.

## 23. Recovery / self-heal (один контентный кейс)

Тот же патченный код, но egress = **резидентный IP** (embed-хост отвечает 200):

```
Форрест Гамп: {"show":true,"authoritative":true,"status":0,"reason":"found"}  (423ms)
```

Сравни с VPS: `{show:false, authoritative:true, reason:'host-block'}`. Один код — разный вердикт
только из-за egress-состояния: **self-heal без sticky-hide**. Как только доступ к embed-хосту
восстановлен (операционный трек), кол-во источников вернётся само: следующий probe → found → show:true.

## 24. Неизменённые подсистемы

Ничего из списка одобрения не тронуто: GAP-005 `classifyLinkCard`, `TRUSTED_ALWAYS_VISIBLE`,
`HIDE_TTL_MS`, single-flight, OLD∩NEW-гейт (работает как прежде — подтверждение через
`confirmNativeAbsence`), `reservePolicy='abstain'` (online8), кэш/ключ/uid-изоляция, `force`,
провайдеры (`CollapsProvider`/`CollapsClient`/нормализатор/streams **НЕ изменены** — это запрет
одобрения), playback, proxy (allowHosts/SSRF), UI (`applyCardAvailability`), registry, store.js,
config.js. Никаких IP/прокси/allowlist/`COLLAPS_EMBED_HOST` — egress-трек явно вне этой фазы.

## 25. Итог

Фикс реализован минимально (1 поведенческая ветка в `nativeProbe` catch), 9 регрессионных тестов
проходят, полный suite 567/0 без регрессий, live-shadow на реальном egress подтвердил **FP 10/10 → 0/10**
с `confirmed` hide, FN=0, recovery проверен на контентом кейсе. **Commit/push/deploy НЕ выполнялись** —
ожидание отдельного шага деплоя.
