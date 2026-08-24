# SKAZ-MANIYA-TASK-019 — PREIMPLEMENT AUDIT (ФАЗА 0, до кода)

Статус: ✅ выполнен до любого кода (свежий baseline живьём + снимок прод `/sources/card` + fixture-артефакты).
Дата: 2026-08-22. Базис: TASK-018 (§10, `docs/SKAZ-MANIYA-TASK-018-EXACT-SOURCE-MODEL-PARITY.md`).
Прод/код/.env/config/nginx — НЕ тронуты (только READ-ONLY GET).

---

## 1. Методология

- Харнесс: `scripts/_t019_baseline.mjs` (READ-ONLY GET, `DIFF_TOKEN='mo-...'`, `node --env-file=server/.env`).
- Контрольные карточки (те же, что в T018): **mutiny** (Мятеж 2026), **toystory5** (История игрушек 5 2026), **interst** (Интерстеллар 2014).
- Кластер: `GET {host}/lite/events?<cardParams>` без `life=true`; ротация `orderedSkazHosts` — использован первый доступный (во всех трёх карточках = `http://online3.skaz.tv`).
- Прод: `GET https://plugin.maniya-kvn.online/api/lampa/sources/card?<cardParams>&token=...`.
- Артефакты: `docs/t019/{mutiny,toystory5,interst,_baseline}.json`; fixture (санированные online[], 32 записи) — `server/test/fixtures/t019-{mutiny,toystory5,interst}.json`.
- Цифры **НЕ подгоняем** под 11/14/24 из T018 — фиксируем фактическое состояние на 2026-08-22 (рефайнмент пользователя #16).

## 2. Свежий SKAZ baseline (3 карточки)

| карточка | online[] | shown | hidden | ghost «Ещё N» | первый shown | первый/selected | events ms | прод probe ms |
|---|---|---|---|---|---|---|---|---|
| mutiny | 32 | **12** | 20 | 20 | index 1 **KinoPub** | KinoPub | 8 643 | 31 366 |
| toystory5 | 32 | **14** | 18 | 18 | index 1 **KinoPub** | KinoPub | 4 134 | 32 700 |
| interst | 32 | **24** | 8 | 8 | index 1 **KinoPub** | KinoPub | 6 421 | 6 520 |

Кластер жив (200, типовая задержка 4–9 с). Прод probe-волна: 31–33 с на mutiny/toystory5 (на interst — 6.5 c).
> Сдвиг baseline vs T018: первый показанный во всех трёх карточках = **KinoPub (index 1)**, как и в T018. Но состав mutiny изменился — появился VK Видео (vkmovie, index 17), shown 11→**12** (см. §3.2). Используем фактические цифры: **12/14/24**, а не слепые 11/14/24.

## 3. Схема online[] (модель источника)

Запись: `{ name, url, index, show, balanser, rch, voices, seasons }` (все 32 уникальных balanser'а на каждую карточку — дубликаты слагов отсутствуют).

- `name` — серверный, несёт качество/бренд: «Filmix ~ 4K», «Lumina - 720p», «Мир кино Z», «Violation» (транслит/бренды класса). **ID ≠ display name** (внутр. id = native/skaz-<slug>).
- `url` — кластерный deep-link `http://<host>/lite/<slug>` (после sanitize — без query; auth → `account_email`/`uid` в query на fetch, НЕ в url модели).
- `index` — серверный порядок (KinoPub=1, Filmix=2, … ZetflixDB=515, Uakino=825 — НЕ последовательный, НО сортируется ASC).
- `show` — кластерная per-title истина. Hidden присутствуют с `show:false` → ghost «Ещё N» от Lampa.
- `rch:true` — WebSocket-only источник (см. §7).
- `voices`/`seasons` — клиентские под-фильтры (числа, сохраняются без замены).

### 3.1 Коллизии index (проверено — обе сохраняются, см. тест #11)

- **mutiny: два index=2** — `Filmix ~ 4K` (filmix), `Lumex` (sakhtv).
- **interst: два index=7** — `Zagonka` (zagonka), `iRemux` (remux).
- Идентичность id — по `balanser` (уникален), НЕ по index.

### 3.2 Состав vs T018 (пер-карточно)

- **mutiny:** shown 12 (БЫЛО 11) — **+ VK Видео (vkmovie, index 17)**. Это означает дрейф кластерного online[] между T018 и T019 (11→12) — свежий baseline обязателен, слепое 11/14/24 неверно.
- **toystory5:** shown 14 (как в T018). **interst:** shown 24 (как в T018).
- Во всех карточках показаны и стабильны (33): KinoPub, Filmix ~ 4K, Alloha, Rezka, SkazTV(pidtor), VK Видео, VeoVeo, Videoseed, Ashdi, UAkino(kinoukr), Eneyida, LordFilm, Мир кино Z.

### 3.3 filmixtv — снят

`grep` по всем 3 свежим online[]: **filmixtv ОТСУТСТВУЕТ** (как и в T018). filmix = ОДИН источник. Двойного чипа Filmix/Filmixtv в модели НЕ будет (T011 был устаревшей картиной).

## 4. Слеги vs `config.skaz.balancers` (18) — разрыв

Уникальных cluster-слагов за 3 карточки: **32**. На каждую карточку — 32 своего набора (пересечение почти полное, различается показанность/индексы).

**Слеги ВНЕ `config.skaz.balancers` (16):**

| slug | name (кластер) | rch | показан на | id в модели |
|---|---|---|---|---|
| kinotochka | Kinotochka | – | interst (H на mutiny/toystory5) | **kinotochka** (native) |
| cdnvideohub | VideoHUB 4k | – | interst (H elsewhere) | **cdnvideohub** (native) |
| ashdi | Ashdi | ✅ rch | все 3 | `skaz-ashdi` |
| kinoukr | UAkino | ✅ rch | все 3 | `skaz-kinoukr` |
| eneyida | Eneyida | ✅ rch | все 3 | `skaz-eneyida` |
| lordfilm | LordFilm | – | все 3 | `skaz-lordfilm` |
| mirkino | Мир кино Z | – | все 3 | `skaz-mirkino` |
| remux | iRemux | – | interst+toystory5 (H mutiny) | `skaz-remux` |
| kinobase | Kinobase | – | H везде | `skaz-kinobase` |
| kinoteatrkg | Kinoteatr.kg | – | H везде | `skaz-kinoteatrkg` |
| sakhtv | Lumex | – | H везде | `skaz-sakhtv` |
| lumina | Lumina - 720p | – | H везде | `skaz-lumina` |
| asiage | AsiaGe | – | H везде | `skaz-asiage` |
| xvideocdn | Fanserials | – | H везде | `skaz-xvideocdn` |
| xvideocdn60fps | xVideoCDN (60/120fps) | – | H на interst | `skaz-xvideocdn60fps` |
| uakino | UaKino | – | H везде | `skaz-uakino` |

**Слеги В РЕЕСТРЕ (18 balancers), present в online[] (16):** alloha, videoseed, kinopub, kinoflix, veoveo, pidtor, solntse, filmix, rezka, hdvb, rutubemovie, vkmovie, geosaitebi, zetflixdb, zagonka, xvideocdnultra.
**В реестре, но ОТСУТСТВУЮТ в online[] (2):** `kodik`, `rhsprem`.

**Maniya-only экстрасы (зарегистрированные провайдеры, чей слаг НЕТ в кластерном online[] на данной карточке):**
- `kodik` (NATIVE, собственный токен) — кластер Кодак не моделирует вовсе.
- `collaps` (NATIVE) — в SKAZ коллапса нет (T018: отсутствует).
- `rhsprem` (skaz-bridge, платный HDRezka) — кластерный online[] его не содержит ни на одной из 3 карточек.
→ В модели они добавляются в КОНЕЦ (index=null) — Maniya-специфичное дополнение поверх кластерного паритет-набора (см. plan merge: `for ... where !slugSet.has(id)`). Это ЯВНО зафиксированное отличие в большую сторону (Maniya показывает больше, чем SKAZ), НЕ рассинхрон паритетного блока.

## 5. Карта разрешения id (slug → model id) — для `resolveModelId`

Правило (native enabled wins): `nativeProviders` по id = `filmix, kodik, rezka, alloha, rutubemovie, cdnvideohub, collaps, hdvb, kinotochka`.

| слаг | native enabled? | → id |
|---|---|---|
| filmix, alloha, rezka, rutubemovie, hdvb, kinotochka, cdnvideohub | да | сам id (native) — близнец skaz НЕ создаётся |
| kodik, collaps | да (но нет в online[]) | extra-native id (index=null, конец) |
| kinopub, pidtor, vkmovie, videoseed, veoveo, kinoflix, solntse, geosaitebi, zetflixdb, zagonka, xvideocdnultra, rhsprem | нет (skaz-bridge) | `skaz-<slug>` |
| lordfilm, mirkino, ashdi, kinoukr, eneyida, remux, kinobase, kinoteatrkg, sakhtv, lumina, asiage, xvideocdn, xvideocdn60fps, uakino | нет (вне реестра) | `skaz-<slug>` (ЭФЕМЕРНЫЙ) |

Эфемерные `skaz-<slug>` НЕ регистрируются в `/sources`/списках — резолвятся только в `store.js` через `skazProviderFor(id)` (memo-инстанс на лету). **Уникальность id**: слаг уникален по online[] → `skaz-<slug>` уникален; коллизий `slug` не встречено (32/32 unique).

## 6. Прод `/sources/card` (снимок для A/B) — контрольный замер

| карточка | status | meta.cached | elapsed_ms | shown | hidden | count(static 21) |
|---|---|---|---|---|---|---|
| mutiny | 200 | false | 31 366 | 8 | 13 | 21 |
| toystory5 | 200 | false | 32 700 | 10 | 11 | 21 |
| interst | 200 | false | 6 520 | 19 | 2 | 21 |

Разрыв состава (кластер shown vs прод Maniya shown): mutiny 12 vs 8; toystory5 14 vs 10; interst 24 vs 19 — прод стабильно меньше на ~5 (нет lordfilm/«Мир кино Z»/rch-источников/эфемерных проявленных на interst; НО прод показывает collaps/kodik-флаги, которых в кластере нет вовсе).
Первый в prod = filmix; в кластере = KinoPub → **порядок и первый выбор — ключевые видимые отличия, снимаемые моделью**.

## 7. rch-источники

- В online[] на всех 3 карточках: **ashdi, kinoukr, eneyida** (`rch:true`, все показаны). Это WebSocket-only провайдеры.
- В модели: сохраняются с `rch:true`, присутствуют в списке источников и кликабельны. Их клик может честно дать `provider_error rch_*`/пусто (документируется в report; **полноценный RCH playback → TASK-020**).

## 8. Ключевой инженерный вывод (прогресс-ограничение модели)

Plan-merge в исходной псевдокодовой записи вызывал `defaultChecker.card(query, userUid)` для «пинов + вердиктов extras». **Замер прод показывает: полная probe-волна = 31–33 с** на mutiny/toystory5 — это катастрофически выше bounded-кэпа model-пути (12 с) и ломает рефайнменты #4/#5 (детерминированный bounded timeout, быстрый ответ).

**Решение (в рамках рефайнментов):** внутри `sourceModel.card()` НЕ вызывается полная probe-волна. Maniya-only extras (`kodik`, `collaps`, `rhsprem`) добавляются **оптимистично** с `show` из статического реестра (`provider.show !== false`) БЕЗ probe; `/videos` сохраняет существующий механизм host-rotation/пинов нетронутым; rch/playback остаются T020. Модель-путь ограничен только events-фетчем (~4–9 с) + кэшем TTL 60 с + single-flight. Старый probe-path ОСТАЁТСЯ не-изменённым для fallback (model → null), включая timeout/error/invalid JSON.

## 9. Риски и решения (зафиксировано до кода)

| риск | решение |
|---|---|
| events на 3+ нодах медленные | ротация последовательно, per-нода `config.skaz.checkTimeoutMs` (10с), общий кэп `min(10с×N, 12с)` → null → probe fallback |
| рассинхрон кэша между юзерами | ключ = полные card params + uid |
| гонка конкурентных карточек | single-flight `inflight` (зеркало availability.js) |
| `checkEnabled=false` / `skaz.enabled=false` | старый статик/probe-путь ДОСЛОВНО (ничего не меняется) |
| Двойные чипы native/twin | resolveModelId (native enabled → native id; skaz-близнец не создаётся) |
| filmix транзиентно `show:false` | `show = (id==='filmix' && nativeEnabled) ? true : o.show` (TRUSTED filmix, существующий invariant) |
| эфемерные слаги на клике / /videos резолв | `skazProviderFor(id)` memo-инстанс + lazy resolve в store.js; НЕ в реестре |
| ghost «Ещё N» | hidden сохраняются с `show:false`; клиент шлёт `ghost:!show` (updateFilter уже умеет) |
| коллизии index | НЕ dedupe; сортировка stable по index с tie-break url_host→balanser; id по balanser |
| Maniya-only extras без probe | оптимистичный append, трикрайний static `show`, в конце (index=null) |

## 10. Что НЕ делается (железные границы)

- Статический список 21→32 НЕ расширяется; в PROVIDER_META/зарегистрированные providers НЕ добавляются эфемерные слаги.
- `defaultChecker`/`availability.js`/балансер НЕ меняются (кроме read-only снимка для extras — см. §8).
- UI Lampa НЕ переписывается (`filter.set('sort', ...ghost)` — существующая возможность).
- Прод/деплой — НЕТ. Стоп на `FINAL STATUS: READY-FOR-PRODUCTION`/`REJECT`.

## Приложение: fixture-артефакты

`server/test/fixtures/t019-mutiny.json`, `t019-toystory5.json`, `t019-interst.json` — 32 записи каждая, все поля онлайн[] сохранены вербатим (url санирован от query/секретов). Используются юнит-тестами модели (unit DI) и A/B (свежий baseline vs модель vs прод).