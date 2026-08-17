# BALANCER-002 POST-DEPLOY — диагностика «лишних источников» (native показываются без per-card проверки)

Дата: 2026-08-13. Статус: **ДИАГНОСТИКА ЗАВЕРШЕНА, ROOT CAUSE ПОДТВЕРЖДЁН ЖИВЬЁМ.** Код не менялся,
commit/deploy не делались. Минимальный безопасный fix — в §7 (предложение, НЕ применено).

## 0. Резюме

Гипотеза юзера **ПОДТВЕРЖДЕНА** кодом и живым прогоном на VPS (4 карточки × 16 видимых источников):

- `server/src/availability.js` в `card()` хардкодит `show:true` для **каждого native-провайдера**
  (filmix/kodik/rezka/rutubemovie/cdnvideohub/collaps/hdvb) — per-card `checkBalancer()` выполняется
  ТОЛЬКО для `skaz-*`. Гейт `confirmAbsence` (двойная проверка «нет») тоже фильтрует `!row.native`.
- Живой прогон: **на каждой карточке 2–6 native-источников с `items=0` остаются `show:true`**,
  при этом все 9 skaz-источников рассчитаны корректно (совпадают с E-Online `lite/events` по-слагу).
- Худший случай — нишевый фильм «Seven-Per-Cent» (27190): **6 из 7 native `items=0`, но видимы**.
- Скрытые твины важны для fix: rutubemovie/FG играет через твин (native=0, twin=8), hdvb/HOTD —
  через native (native=10, twin=0). Availability native-источника должна учитывать ЭФФЕКТИВНЫЙ бэкенд
  (native ИЛИ твин), иначе fix скроет рабочие источники.

## 1. Root cause (код)

`server/src/availability.js` — `card()`:

```js
// resolveSources(): native → { native: true }, skaz → { balancer }
const settled = await Promise.allSettled(sources.map((source) => {
  if (source.native) {
    return Promise.resolve({ id: source.id, show: true, native: true, authoritative: true }); // ← БЕЗ проверки
  }
  return checkBalancer(source.balancer, query, deadline);                                      // только skaz
}));
```

Гейт подтверждения «нет» (строки ~394-396):

```js
const eligible = rows
  .filter(({ row }) => !row.native && row.show === false && row.authoritative && !row.accsdb);
//                     ^^^^^^^^^^^^ native-строки из гейта исключены
```

То же на маршруте `/api/lampa/sources/card` (`index.js`): отдаёт `{id, show}` из `card()`, где
native всегда `true`. Клиент (`public/maniya-online.js` `applyCardAvailability`) фильтрует
`filterSources` по `sources[key].show` → natives остаются видимыми на любой карточке.

Тест `availability-hidden-twin.test.js:65` даже ЗАКРЕПЛЯЕТ баг: `assert.equal(byId(result, 'filmix').show, true, 'native всегда show:true')`.

## 2. Живой прогон (VPS, 2026-08-13, 4 карточки)

Контур: реальный production API (`127.0.0.1:3000`) + реальный токен из `data/users.json` + клиентский
query-shape (`addMovieParams`+`addAccountParams`). OLD = `/api/lampa/videos?provider=X` (store-путь с
твином — что реально получает юзер); NEW = `/api/lampa/sources/card`; EO = `lite/events?life=false`.

### Карточка 1 — Forrest Gump (movie 13)

| source | тип | /card | /videos(store) | native (прямой) | twin | EO | вердикт |
|---|---|---|---|---|---|---|---|
| filmix | native | true | 5 | 5 | skaz-filmix=5 | show | OK |
| **kodik** | native | **true** | **0** | 0 | skaz-kodik=0 | — | **⚠ ЛИШНИЙ** |
| rezka | native | true | 22 | 22 | skaz-rezka=22 | show | OK |
| rutubemovie | native | true | 8 | **0** | **skaz-rutubemovie=8** | show | OK (твин кормит) |
| **cdnvideohub** | native | **true** | **0** | 0 | нет | — | **⚠ ЛИШНИЙ** |
| collaps | native | true | 1 | 1 | нет | — | OK |
| hdvb | native | true | 1 | 1 | skaz-hdvb=0 | show | OK |
| skaz-alloha | skaz | true | 4 | — | — | show | OK |
| skaz-videoseed | skaz | **false** | 0 | — | — | hide | ok (скрыт) |
| skaz-kinopub | skaz | true | 25 | — | — | show | OK |
| skaz-kinoflix | skaz | true | 3 | — | — | show | OK |
| skaz-veoveo | skaz | true | 1 | — | — | show | OK |
| skaz-pidtor | skaz | true | 8 | — | — | show | OK |
| skaz-solntse | skaz | true | 1 | — | — | show | OK |
| skaz-geosaitebi | skaz | true | 1 | — | — | show | OK |
| skaz-rhsprem | skaz | true | 22 | — | — | show | OK |

ЛИШНИХ: **kodik, cdnvideohub** (2 native). skaz — все корректны (videoseed скрыт, совпадает с EO).

### Карточка 2 — Дом Дракона (serial 94997)

ЛИШНИХ: **kodik, rutubemovie, cdnvideohub** (3 native). rezka играет через твин (native=0, store=10);
hdvb — через native (native=10, twin=0). skaz: kinoflix/geosaitebi корректно скрыты (0, EO hide);
pidtor — show (EO тоже show), но store=0 → pre-existing navigation gap (см. §5.3), НЕ availability.
videoseed — show + 10 items, EO hide (Maniya показывает рабочий источник сверх EO — допустимо).

### Карточка 3 — The OA (serial 71712)

ЛИШНИХ: **kodik, rutubemovie, cdnvideohub, collaps** (4 native). skaz: alloha/videoseed/solntse/
geosaitebi корректно скрыты; kinopub/veoveo/rhsprem работают; kinoflix/pidtor — EO show, store=0
(navigation gap).

### Карточка 4 — Seven-Per-Cent (movie 27190, нишевый)

ЛИШНИХ: **filmix, kodik, rutubemovie, cdnvideohub, collaps, hdvb** (6 native!). Работает только rezka.
skaz — ВСЕ корректны по EO (alloha/videoseed/kinoflix/pidtor/solntse/geosaitebi скрыты;
kinopub/veoveo/rhsprem работают).
⚠ filmix: EO показывает filmix (skaz-кластер нашёл карточку), но Maniya native+twin `videos()`=0 —
это navigation gap (§5.3), НЕ повод скрывать filmix.

### Сводка по 4 карточкам

| Card | Native items=0, но show:true |
|---|---|
| Forrest Gump (13) | kodik, cdnvideohub |
| Дом Дракона (94997) | kodik, rutubemovie, cdnvideohub |
| The OA (71712) | kodik, rutubemovie, cdnvideohub, collaps |
| Seven-Per-Cent (27190) | filmix, kodik, rutubemovie, cdnvideohub, collaps, hdvb |

- **kodik** — мёртв на ВСЕХ 4 карточках (native=0, twin=0). Согласованно «лишний».
- **cdnvideohub** — мёртв на ВСЕХ 4 карточках (native=0, твина нет). Согласованно «лишний».
- **rutubemovie** — карточка-зависимый: FG играет через твин (native=0, twin=8), HOTD/OA/niche пуст.
  Доказывает необходимость per-card проверки (и учёта твина).
- **collaps** — мёртв на OA/niche, работает на FG/HOTD.
- **skaz-*** — НИ ОДНОГО неверного show от слоя availability (все скрытия двойные и совпадают с EO).

## 3. Кто native, кто добавлен вручную

Все 7 native-источников были построены НАМИ в предыдущих волнах с собственными бэкендами
(НЕ skaz-кластер), поэтому их availability НЕ определяется `lite/events` E-Online напрямую:

| native id | бэкенд | волна |
|---|---|---|
| filmix | api-fx / api.filmix.tv | сессии 16.x, FILMIX-004 |
| kodik | kodik-api.com | Kodik phase 2 |
| rezka | rezka.ag | Rezka phase 1 + P0 resolveRecord |
| rutubemovie | rutube.ru | сессия 3 |
| cdnvideohub | plapi.cdnvideohub.com | сессия 4 |
| collaps | api.bhcesh.me / ortified.ws | сессия 5 |
| hdvb | apivb.com / entouaedon.com | сессия 6 |

skaz-* (9) — автогенерируются из `config.skaz.balancers` (`registry.js buildSkazProviders`),
каждый = REST-балансер кластера. «Добавлены вручную» = именно natives.

## 4. Как E-Online решает эту ситуацию

E-Online (`Lampac OnlineApi.cs:897`) — **параллельный `checkSearch` по КАЖДОМУ балансеру**,
без исключений: `GET lite/<balancer>?…&checksearch=true`, предикат
`work = rch || "data-json=" || "type":"movie"|"episode"|"season"`, кэш
`Fnv1a(id:serial:source:count:uid)` 5 мин. Универсум E-Online = 36 skaz-балансеров; понятия
«native получает show бесплатно» там НЕТ — каждый источник на каждой карточке проходит проверку.

Доказательство из нашего прогона: для общих слагов per-card `lite/events` E-Online совпадает с
реальной отдачей Maniya (`/videos` items>0) — FG: показывает filmix/rezka/rutubemovie/hdvb,
НЕ показывает kodik; HOTD: показывает filmix/rezka/hdvb, НЕ показывает rutubemovie/kodik;
niche: показывает filmix/rezka, НЕ показывает hdvb/rutubemovie/kodik. То есть E-Online **прячет
источник, когда на карточке его нет** — включая те, что у нас native (kodik/сdnvideohub в EO
просто не светятся).

Разница архитектуры: у E-Online каждый источник = skaz-балансер, и проверка идёт по кластеру.
У Maniya часть источников — native-бэкенды (filmix.api, kodik-api…) с отдельными каталогами;
они выпали из слоя availability как «native → show:true».

## 5. Ключевые нюансы для fix

### 5.1 Твин-кормление (hidden twin)

Store (`store.js`): фильм — twin-first, native — фоллбэк; сериал — native-first, twin — фоллбэк.
Значит ЭФФЕКТИВНЫЙ бэкенд видимого native-источника = native ИЛИ скрытый твин `skaz-<balancer>`:

- rutubemovie/FG: native=0, **twin=8** → источник РАБОЧИЙ (клик отдаёт контент твина). Скрывать = регрессия.
- hdvb/HOTD: native=10, twin=0 → источник работает через native. Проверка только твина его бы скрыла.
- => для native С твином availability = **union** обоих сигналов; скрывать ТОЛЬКО когда оба пусты.

### 5.2 Native-бэкенды без твина

cdnvideohub/collaps твинов НЕ имеют (нет `skaz-cdnvideohub`/`skaz-collaps` в SKAZ_BALANCERS).
Для них нужен собственный search-level probe:
- cdnvideohub: `search()` ТОЛЬКО по `kinopoisk_id` (нет kp → `[]`). «Нет kp id» = вердикта НЕТ
  (inconclusive → show), а не «контента нет».
- collaps: `search()` по title ИЛИ по kp/imdb/orid (`recordByKeys`). Пусто при наличии ключа = «нет».

### 5.3 Navigation gap (НЕ availability) — не трогать

pidtor (все карточки), kinoflix (OA), filmix (niche): `lite/events` EO показывает «есть карточка»,
но Maniya REST-navigation `videos()` отдаёт 0 (карточка → record → postid → streams не резолвится).
Это pre-existing гэп REST-навигации Maniya (задокументирован в balancer-002-report §8.2 для pidtor).
**Скрывать по `videos()=0` такие источники НЕЛЬЗЯ** — это отклонится от EO и спрячет потенциально
играемый контент. Отдельная задача (покрытие навигации), вне этой волны.

## 6. Что НЕ менялось (обязательства)

`SkazProvider.videos()`/resolver, `store.js` (twin-first/native-first), статический
`/api/lampa/sources`, `provider.videos()`/`resolveVideo()` — НЕ трогались и НЕ должны трогаться.
Availability определяет ТОЛЬКО видимость (`show:true/false`), не воспроизведение.

## 7. Минимальный безопасный fix (ПРЕДЛОЖЕНИЕ, НЕ применено)

Единый per-card availability для native + skaz + hidden twin (схема юзера):

```
native provider  ─┐
skaz provider    ─┼─→ единый card availability → show:true/false
hidden twin      ─┘
```

1. **`availability.js` `resolveSources()`**: для native-строки нести и `native:true`, и (если есть)
   `twinBalancer` (через `twinFor(nativeId)` из registry) — строки твинов в ответ не добавлять
   (никаких дублей в UI).
2. **`card()` вместо хардкода `show:true`**:
   - native С твином → `checkBalancer(twin.balancer, query)` — тот же skaz-cluster checksearch,
     что использует E-Online для этого балансера (покрывает twin-first/фоллбэк; rutubemovie/FG
     остаётся видимым, hdvb/HOTD — тоже, т.к. кластер отдаёт карточку);
   - native БЕЗ твина (cdnvideohub, collaps) → native search-level probe (`provider.search(context)`,
     карточные ключи kp/imdb/id/title). Пусто при НАЛИЧИИ ключа → «нет»; ключа нет / ошибка /
     таймаут → inconclusive → show оптимистично (safety policy §2 balancer-002-report);
   - skaz-* → `checkBalancer` как сейчас.
3. **Гейт подтверждения** — снять `!row.native` из `eligible`: «нет» native тоже перепроверять
   прямым сигналом (`confirmWithBackoff`) + HIDE_TTL 60с + retry. Для native БЕЗ твина «прямым
   сигналом» = повторный `search()` после backoff (или, если search не даёт подтверждения,
   оставлять checksearch/первичный вердикт — деталь реализации).
4. **Кэш** — ключ не менять (`Fnv1a(id:serial:source:count:uid)`), TTL/HIDE_TTL как есть.
5. **Критерий приёмки — OLD∩NEW гейт** (shadow-скрипт): расширить на natives — ни один native
   с `videos()` items>0 не скрывается. Обязательно включая твин-кейс rutubemovie/FG.
6. **Тесты**: переписать `availability-hidden-twin.test.js:65` («native всегда show:true»);
   +нативные кейсы (kodik mёртв → hide; rutubemovie с живым твином → show; cdnvideohub без kp-id →
   inconclusive show; hdvb native-only → show; гейт native «нет» → confirm).

Риски/границы: native probe для cdnvideohub/collaps — новый сигнал, его флак надо смотреть в
shadow-прогоне; navigation-gap (pidtor/kinoflix/filmix-niche) остаётся отдельной задачей и НЕ
должен приводить к скрытию (checksearch EO-совместим).

## 8. Артефакты

- Живой прогон: `/tmp/balancer-002-postdeploy.mjs` на VPS (запуск: `cd /opt/maniya-online/server &&
  NODE_ENV=production node /tmp/balancer-002-postdeploy.mjs`, env `DIAG_CARD=fg|hotd|oa|niche|all`);
  локальная копия `C:\tmp\showy\balancer-002-postdeploy.mjs` (НЕ коммитится, конвенция diag-скриптов).
- Twin-проба: `/tmp/twin-probe.mjs` на VPS (native vs twin items по карточкам).
- Секреты/токены не печатались (len only).

## 9. Вывод

- **Неправильно показываются**: native-источники с `items=0` на конкретной карточке (см. §2).
- **Почему**: `availability.js` хардкодит `show:true` для native; skaz проверяется, native — нет.
- **Какие native**: filmix/kodik/rezka/rutubemovie/cdnvideohub/collaps/hdvb (§3); стабильно мёртвые —
  **kodik, cdnvideohub**; карточка-зависимые — rutubemovie, collaps.
- **Добавлены вручную**: все 7 natives (§3).
- **Как решает E-Online**: per-card checkSearch по КАЖДОМУ источнику, без native-исключений (§4).
- **Минимальный fix**: единый card availability native+skaz+twin (§7), без изменения
  `provider.videos()`/`resolveVideo()`/store.js, приёмка по OLD∩NEW гейту с учётом твин-кейса.
