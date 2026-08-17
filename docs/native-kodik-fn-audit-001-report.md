# NATIVE-KODIK-FN-AUDIT-001 — отчёт

**Дата:** 2026-08-16. **Режим:** READ-ONLY (код/тесты/commit/push/deploy не менялись).
**Главный вопрос:** «Почему E-Online/Lampac показывает native Kodik на 8/11 проверенных тайтлов, а Maniya скрывает Kodik?»

**Краткий ответ: НАСТОЯЩЕГО FN НЕТ.** На 9 тайтлах (не 8) «E-Online SHOW + Maniya HIDE» — это **GHOST-SEMANTICS E-Online** (наивный предикат Lampac считает `data-json=` в **decoy-карточках-дисамбигуации** чужого фильма за контент) против **корректной семантики Maniya** (строгий предикат + каталог-гейт native: kodik — аниме/восточный каталог, искомых западных фильмов там НЕТ). `HIDE + /videos = 0` — скрытие оправдано.

---

## §0. Резюме в одну таблицу (11 тайтлов, live, 2026-08-16 ~15:45)

| # | Тайтл | E-Online kodik | Причина E | Maniya kodik | Причина Maniya | /videos items | Playable | Playback | Классификация |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Одиссея 2026 | SHOW | content-marker (`data-json=` на similar-link decoy «Бесконечная одиссея капитана Харлока» 2002) | **hide** | absent (twin checksearch: link-карточки чужих фильмов → absent; native: каталог-гейт en∉eastern → []) | **0** | 0 | — | GHOST-SEMANTICS (E) / CORRECT-DIVERGENCE (M) |
| 2 | Последний дом 2026 | SHOW | content-marker (decoy «Наруто: Последний фильм») | **hide** | absent | **0** | 0 | — | GHOST-SEMANTICS / CORRECT-DIVERGENCE |
| 3 | Интерстеллар 2014 | SHOW | content-marker (decoy «Интерстелла 5555») | **hide** | absent | **0** | 0 | — | GHOST-SEMANTICS / CORRECT-DIVERGENCE |
| 4 | Матрица 1999 | SHOW | content-marker (decoy «Армитаж: Полиматрица») | **hide** | absent | **0** | 0 | — | GHOST-SEMANTICS / CORRECT-DIVERGENCE |
| 5 | Дюна 2 2024 | SHOW | content-marker (decoy «Сын Кавери: Часть вторая») | **hide** | absent | **0** | 0 | — | GHOST-SEMANTICS / CORRECT-DIVERGENCE |
| 6 | Скайуокер 2019 | SHOW | content-marker (decoy «Восстание дракона») | **hide** | absent | **0** | 0 | — | GHOST-SEMANTICS / CORRECT-DIVERGENCE |
| 7 | Аватар 2009 | SHOW | content-marker (decoy «Аватар короля») | **hide** | absent | **0** | 0 | — | GHOST-SEMANTICS / CORRECT-DIVERGENCE |
| 8 | Дом Дракона 2022 (serial) | SHOW | content-marker (decoy «Дракон в поисках дома») | **hide** | absent | **0** | 0 | — | GHOST-SEMANTICS / CORRECT-DIVERGENCE |
| 9 | Тёмный рыцарь 2008 | SHOW | content-marker (decoy «Во тьме» 1994) | **hide** | absent | **0** | 0 | — | GHOST-SEMANTICS / CORRECT-DIVERGENCE |
| 10 | Паразиты 2019 (ko) | SHOW | content-marker (`method:call`, РЕАЛЬНЫЙ контент) | **show** | content (checksearch: call-карточки) | **5** | 5 | **403 `proxy_host_forbidden`** (sky.solodcdn.com не в allowlist Maniya-proxy) | **FOUND native** / PLAYBACK-FAILURE (Maniya-proxy) |
| 11 | Форрест Гамп 1994 | SHOW-FALSE | non-2xx(503) — ghost show:false | **show** | inconclusive (abstain: primary 503 → оптимистичный показ) | **0** | 0 | — | **FP Maniya** (INC-show) / E-Online ghost |

**Счёт «E-SHOW + M-HIDE» = 9/11** (в ТЗ сказано «8/11» — уточнение; в canonical-audit §11.2 было зафиксировано «kodik×8», фактически 9). Плюс: **1 FOUND** (Паразиты), **1 FP** (Форрест).

---

## §1. Вопрос и метод

Полный спектр вердиктов E-Online по kodik получен parity-пробом 2026-08-16 12:23 (checksearch на online3, наивный канонический предикат Lampac `OnlineApi.cs:975`: `work = rch || data-json= || "type":"movie|episode|season"`): **SHOW на 10/11**, ghost 503 на Форресте. Maniya (matrix-r2 07:03 + свежий live-проб 15:45) **hide на 9/11**, show на Форресте + Паразитах.

Чтобы понять, кто прав, выполнено по ТЗ:
1. Регистрация kodik в Maniya (native + hidden twin `skaz-kodik`) — чтение кода.
2. Два предиката (наивный Lampac / строгий Maniya) прогнаны на **живых** checksearch-ответах кластера.
3. End-to-end: `card` → `/videos?provider=kodik` (путь store.js, twin-first) на **проде**.
4. Сырой `lite/kodik` (plain и checksearch) — структура ответа, decoy-карточки, резолв pick-URL.
5. Playback FOUND-кейса (Паразиты): `/videos` → `/video` → master.

Все пробы — только GET (кластер и `plugin.maniya-kvn.online`), скрипты в `C:\Users\Admin\AppData\Local\Temp\post-w1-audit\`.

---

## §2. Регистрация kodik в Maniya: twin, а НЕ nativeProbe

- `registry.js`: `KodikProvider` в `nativeProviders` (`id='kodik'`); kodik входит в `SKAZ_BALANCERS` → `buildSkazProviders()` создаёт **скрытый близнец `skaz-kodik`** (`hiddenTwinNative='kodik'`, `show:false`), т.к. native включён.
- `availability.js resolveSources/computeCard`: native с hidden twin → **`checkBalancer(twin.balancer='kodik')`** — тот же checksearch, что гоняет E-Online на этот балансер. `nativeProbe` (search-level) применяется только к native БЕЗ твина (cdnvideohub, collaps) — kodik не тот случай.
- `store.js getVideosForRequest`: для фильма **twin-first** (сначала `skaz-kodik`), native — фоллбэк; для сериала native-first. Оба пути покрыты live-пробом ниже.

**Вывод §2:** сигнал availability native kodik = кластерный checksearch `lite/kodik` — тот же URL и параметры, что у parity-проба (buildUrl идентичен: id/imdb/kinopoisk/title/original_title/original_language/serial/year/source + account_email + uid). Значит расхождение E-vs-M — **не в URL и не в маршруте**, а в **интерпретации тела ответа**.

---

## §3. Почему E-Online показывает: наивный предикат × decoy-карточки

Живой ответ кластера `lite/kodik?checksearch=true` (Одиссея, len=42819; **len идентичен для plain и checksearch** — выдача не меняется от флага):

```
{"method":"link","url":"…/lite/kodik?title=&original_title=The+Odyssey&clarification=0&pick=бесконечная+одиссея+капитана+харлока","similar":true}
{"method":"link", … "pick=черепашья+одиссея" …,"similar":true}
{"method":"link", … "pick=детектив+конан…" …,"similar":true}
…
```

- Модуль kodik на кластере не находит искомый западный фильм и отдаёт **страницу дисамбигуации**: `method:link`-карточки `similar:true` на **чужие** фильмы (аниме/восточный каталог kodik): Наруто, Армитаж, Интерстелла 5555, Сын Кавери, Восстание дракона, Аватар короля, Дракон в поисках дома, Во тьме…
- Предикат Lampac (`OnlineApi.cs:975`): `work = rch || res.Contains("data-json=") || type-marker`. В теле **присутствует `data-json=`** (в decoy-карточках) → **work=true → show:true**. Substring-матч не различает `method:link`+`similar` от реального контента.
- **Это канонический ghost E-Online**: show:true, но при навигации link-карточка ведёт на чужой фильм (или пустой резолв). Проверено резолвом pick-URL: `…/lite/kodik?title=&original_title=The+Odyssey&clarification=0&pick=бесконечная…` → 200, 633 байта, **ещё одна вложенная `method:link`-карточка** (`rjson=False&…`) — цепочка дисамбигуации без playable-контента.

---

## §4. Почему Maniya скрывает: строгий предикат + каталог-гейт

Двойная защита, каждая из которых независимо даёт «нет»:

1. **`checkSearchPredicate` (availability.js:244)** — не substring, а разбор data-json-карточек. Для `method:link` → `classifyLinkCard(card, query)`:
   - `linkTargetIds(url)`: в decoy-URL нет kinopoisk_id/imdb_id → id-совпадения нет;
   - title «Бесконечная одиссея капитана Харлока» ≠ «Одиссея» → comparable && !titleMatch → **absent** (и год 2002 ≠ 2026 тоже → absent);
   - ни одной content-карточки → `work=false, verdict='absent'` → **show:false**.
   - Проба A: для всех 9 тайтлов `maniya=false/absent` на том же теле, где parity дал `naive=true`.
2. **`KodikProvider.withinCatalog` (KodikProvider.js:272)** — гейт каталога (аналог Lampac ModInit.Invoke): `original_language` западный (`en`…∉ {ja,ko,zh,cn,th,vi,tl}) → `search()` сразу возвращает `[]` → `videos()` = `{items:[]}`. Т.е. **native kodik /videos по 9 западным тайтлам = 0 by design** (kodik-токен Maniya — аниме/восточный каталог; диагноз §16.2 canonical-аудита: 8 западных id → total=0).
3. Twin `skaz-kodik` тоже даёт 0: кластер возвращает только `similar:true` link-карточки; SkazProvider-парсер их в items не включает (эмпирически: `/videos?provider=kodik` на проде = 0).

**Вывод §4:** hide корректен — **HIDE + ITEMS = 0**. Искомого контента в kodik нет (ни в native-kodik-api, ни в кластерном twin).

---

## §5. End-to-end live (прод, 2026-08-16 15:45)

`kodik-e2e-live.json` (11 тайтлов × `/sources/card` + `/videos?provider=kodik`):

| Тайтл | card.kodik | `/videos?provider=kodik` |
|---|---|---|
| Одиссея / ПД / Интерстеллар / Матрица / Дюна2 / Скайуокер / ДД / Аватар / ТР | `show:false` | **items=0** (status 200) |
| Паразиты 2019 | `show:true` | **items=5** (method:call, «Дублированный» и др., voice_name, url→`/api/lampa/video…`) |
| Форрест Гамп 1994 | `show:true` | **items=0** (status 200) |

- Уточнение по Паразитам: items=5 — результат **store.js twin-first** (кластерные call-карточки «Паразиты (Дублированный)», «HDrezka Studio», «STEPonee», «Сербин»); native каталог-гейт для `ko` разрешает, содержимое kodik-api то же — контент реален в обоих контурах.
- Форрест: `show:true` + 0 items = **FP** (семейство INC-show, уже принято в post-w1-аудите: 13 INC-show FP). Оптимистичный показ на 503 primary при abstain-политике (online8-002) — осознанный anti-FN trade-off, НЕ kodik-FN.

---

## §6. Идентичность (identity)

- E-Online/Skaz-кластер: балансер `kodik` → `lite/kodik` (REST, токен, апihost `kodik-api.com`). Maniya native: тот же `id='kodik'`, тот же `kodik-api.com`, тот же тип контента. **Провайдер-идентичность совпадает**; отображаемое имя («Kodik» vs «Maniya · Kodik») к идентичности не относится.
- Расхождение E-vs-M — **не** `IDENTITY-MISMATCH`: это разница предикатов на одном и том же ответе.

---

## §7. Playback

- **9 hide-тайтлов:** играбельного kodik-стрима не существует (каталог не содержит фильм; кластер отдаёт только decoy-link → playable master недостижим; pick-резолв → вложенная link-карточка). E-Online show:true здесь привёл бы к **воспроизведению чужого фильма** (или «видео не найдено») — ещё одно подтверждение ghost-природы.
- **Паразиты (FOUND):** реальный стрим есть. `resolveVideo` (native) вернул `https://plugin.maniya-kvn.online/api/lampa/proxy?url=https://sky.solodcdn.com/movies/…` → master через proxy → **403 `{"error":"proxy_host_forbidden","message":"Хост источника не разрешён"}`**. Причина: CDN-хост `sky.solodcdn.com` (реальный video-CDN kodik) **отсутствует в `config.proxy.allowHosts`** (там только `kodikres.com`). Это отдельный **playback-гейт Maniya**, не availability. E-Online (собственный прокси Lampac без такого allowlist) такой 403 не имеет.

---

## §8. Классификация (коды ТЗ)

| Код | Кол-во | Случаи |
|---|---|---|
| **GHOST-SEMANTICS** (E-Online) | 9 | Одиссея, ПД, Интерстеллар, Матрица, Дюна2, Скайуокер, Аватар, ДД, ТР — naive `data-json=` матч на similar-link decoy |
| **CORRECT-DIVERGENCE** (Maniya) | 9 | те же — строгий предикат (absent) + каталог-гейт → hide прав |
| **FOUND** (оба show, контент есть) | 1 | Паразиты 2019 (ko) |
| **PLAYBACK-FAILURE** (Maniya-proxy) | 1 | Паразиты: `proxy_host_forbidden` на sky.solodcdn.com |
| **FP Maniya** (show + 0 items) | 1 | Форрест Гамп 1994 (INC-show на 503, принятое семейство) |
| REAL-FN / EMPTY / TRANSIENT / PARSER-MISMATCH / IDENTITY-MISMATCH | 0 | — |

---

## §9. Хронология и стабильность

- matrix-r2 (07:03): hide 9/11. Свежий live-проб (15:45): hide 9/11, идентично. Ответ кластера детерминирован (plain.len == checksearch.len; decoy-набор стабилен). → **НЕ TRANSIENT**, не флап.
- Единственный ранее задокументированный kodik-«флап» в canonical-аудите касался link-карточек на «Бесконечную Одиссею капитана Харлока» (availability.js:67-68) — он же подтверждён здесь как системный механизм дисамбигуации.

---

## §10. Ограничения и что не трогали

- Код, тесты, config, деплой **не менялись** (READ-ONLY). W1/STABILITY-004/GAP-002/GAP-005/VEO-015/коллапс/кластер-ротация/hostOrder/pinMap/display-имена/provider-IDs/E-Online runtime-зависимость — не затронуты.
- Native kodik /videos в чистом виде (без twin-first) через публичный API не изолируется (movie = twin-first); вывод о native=0 опирается на каталог-гейт по коду + 0 items в store-пути.
- Учётная запись кластера = dorofeevigor20/7974327d37 (та же, что в parity). Прод-проб — токен dorofeev200.
- Данные проб: `kodik-checksearch-predicates.json`, `kodik-e2e-live.json`, `kodik-raw-lite.json`, `kodik-pick-playback.json` (в `C:\Users\Admin\AppData\Local\Temp\post-w1-audit\`).

---

## ITOG (A–J)

**A. Есть ли настоящий Kodik FN?** — **НЕТ.** Все 9 «E-SHOW + M-HIDE» — искомого контента в kodik нет; hide корректен.

**B. Сколько случаев?** — 9/11 (не 8, как в ТЗ; исправлено). + 1 FOUND (Паразиты), + 1 FP (Форрест).

**C. Какие именно?** — Одиссея, Последний дом, Интерстеллар, Матрица, Дюна 2, Скайуокер, Дом Дракона, Аватар, Тёмный рыцарь. Все западные (`en`). FOUND — Паразиты (`ko`).

**D. Почему E-Online показывает?** — Канонический наивный предикат Lampac `checkSearch` (`work = rch || res.Contains("data-json=") || type-marker`). Ответ `lite/kodik` на эти тайтлы — **страница дисамбигуации**: `method:link`-карточки `similar:true` на чужие фильмы (аниме/восточный каталог). Substring `data-json=` в этих карточках считается контентом → show:true (ghost; навигация вела бы на чужой фильм).

**E. Почему Maniya скрывает?** — (1) `checkSearchPredicate` разбирает карточки: `method:link`+`similar` → `classifyLinkCard` → чужой тайтл/год → absent; (2) `KodikProvider.withinCatalog`: западный язык ∉ EASTERN_LANGUAGES → native search=[] → /videos=0; (3) twin `skaz-kodik` тоже 0 (decoy-карточки не играбельны). `HIDE + ITEMS = 0`.

**F. Ошибка availability или корректная семантика?** — **Корректная семантика Maniya.** «Показ E-Online» — ghost (канонический артефакт наивного предиката). Совпадение с E-Online здесь НЕ цель: цель — контент.

**G. Нужен ли кодовый фикс?** — Для hide: **НЕТ** (поведение правильное). Есть **1 отдельная находка вне availability**: Паразиты/kodik — реальный контент, но **playback блокирован `proxy.allowHosts`** (CDN `sky.solodcdn.com` отсутствует) → Play даст «видео не найдено»/403. Решение по ней — за пользователем (см. H, J).

**H. Если нужен — какой минимальный концептуальный фикс?** — (только для FOUND-кейса, НЕ для hide): добавить реальные CDN-хосты kodik (например `sky.solodcdn.com`, при необходимости другие из живых `video-links`) в `config.proxy.allowHosts` (нужна проверка SSRF-безопасности). Предикат availability, twin-механику, каталог-гейт НЕ трогать.

**I. Есть ли риск FP?** — При «показе как E-Online» (один сигнал, substring `data-json=`) было бы **9 FP** (decoy-карточки). Текущий строгий предикат их предотвращает. FP уже есть один (Форрест, INC-show 503) — принятое семейство, не усугубляется фиксом из H (показ и так есть, меняется только playability).

**J. Что делать следующим шагом?** — **STOP.** Отчёт завершён, код не менялся. Вне этого аудита (по решению пользователя, отдельной задачей): (1) решить судьбу native kodik для восточного контента — проверить/добавить CDN-хосты kodik в `proxy.allowHosts` и перепроверить playback Паразитов; (2) Форрест/kodik FP — наблюдать в рамках уже принятого INC-show. Никаких изменений в availability/предикат/twin.
