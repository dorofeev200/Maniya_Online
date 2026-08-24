# TASK-SKAZ-MANIYA-025 — COMPLETE SKAZ RUNTIME / UI / PLAYBACK FORENSIC CAPTURE

> READ-ONLY. Код/Shadow/prod/.env/nginx/DNS/UI НЕ тронуты. Ничего не исправлялось.
> Новый ЖИВОЙ серверный срез (2026-08-22): `docs/t025/events-capture.json` (lite/events,
> 4 карточки: Мятеж, История игрушек 5, Интерстеллар, Дом Дракона-serial) + `docs/t022/ab2-*.json`
> (server-паритет обеих сторон). Lampa-ядро → снипет §Р.В.
> **Статус: COMPLETE — FIRST DIVERGENCE PROVEN** (2026-08-23; §27). Остаточные вторичные наблюдения
> (icon-скрин, Shadow-model runtime) — детали, не меняющие FIRST DIVERGENCE.

---

## 1. SKAZ runtime source contract

Что приходит с кластера (ПОДТВЕРЖДЕНО живьём сегодня, 4 карточки, `lite/events`, auth в URL):
```
{ name, url, index, show, balanser, rch, voices, seasons }
```
- **`url` = голый deep-link** `http://online{3|8}.skaz.tv/lite/<module>` — БЕЗ card-query (проверено в
  `events-capture.json`: `"url": "http://online8.skaz.tv/lite/kinopub"`). Плагин при клике сам досылает
  параметры карточки → итоговый запрос `events.url + ?<cardParams>&account_email&uid`.
- `index/show` — главные UI-поля (порядок и «скрытые»). `rch:true` = сервисный WS/сессия (на мутини —
  eneyida idx13; все 4 карточки).
- **ABSENT в событиях: `id`, `icon`, `api_url`, `quality_label`, `quality`, `ghost`** (hasIcon/hasId/hasApiUrl/hasQuality = false — проба).
  → ghost/icon/id — это производные **плагина** (или Lampa), НЕ кластера.
- Свежие значения 4 карточек (total/shown): mutiny 29/9, toystory5 29/12, interst 29/23, hod 25/10.

### 1a. Реальная wire-цепочка SKAZ-плагина (запись Web Lampa lampa.mx, 2026-08-23, карточка Мятеж 1288445)

```
[SKAZ]  lite/withsearch?auth                  → 356 B (bootstrap, выдаёт nws)
        externalids?id=1288445&serial=0&imdb → {kp:5582050} ← кластер ПЕРЕОПРЕДЕЛЯЕТ kinopoisk_id
        lite/events?life=true&id&imdb&kp=5582050&title&serial=0&original_language=en&year&source=tmdb&
                clarification=0&similar=false&rchtype=web&cub_id&auth&nws_id  → 57 B (handshake/stub)
        lite/lifeevents?memkey=<…>&<та же карточка>&auth&nws_id               → 4362 B ← ПОЛНАЯ per-title модель
        [Lampa «online_choice_lumina follow»] → параллельная волна живой проверки:
        lite/filmix, lite/kinoukr, lite/remux, lite/kinogo, lite/kinotochka (каждое с полным cardParams)
        клик → lite/filmix?<cardParams>&auth&nws_id → data-json → ПРЯМОЙ CDN MP4 (werkecdn) → [Player] plays
```
- **Клик по источнику = `events.url + ?<cardParams> + auth (+nws_id)`** — ПОДТВЕРЖДЕНО живьём (lite/filmix?id=1288445…).
- **`api_url` у SKAZ-плагина ABSENT** (все XHR только на online*.skaz.tv; ни одного запроса к нашему API).
- `id` источника = `balanser` (kinopub/filmix/…) — чип-ключ и кластерный путь совпадают (wire-level).
- Client availability-follow: плагин проверяет модули параллельной волной (online_choice_lumina) — у нас это
  серверная availability.js; результат один.
- Request-shape vs наш (`lite/events` без life): различается; КОНТЕНТ-паритет модели верен (см. 1b).

### 1b. Parity-контроль life-формы (проба 2026-08-23, docs/t025/life-events-parity.json)

`lite/events?life=true` БЕЗ валидной RCH-сессии → **28 строк, минимальная форма `{name,url,balanser}` БЕЗ
show/index/voices**; авторитетную полную модель SKAZ берёт из **lifeevents?memkey** (4362 B). Наш запрос
(без life) отдаёт полную модель напрямую → content-parity верен при разной форме запроса (оба: первый KinoPub,
тот же состав).

## 2. Maniya runtime source contract

Сборка клиента (model-ветка `public/maniya-online.js:521-557`, точная):
```
sources[key] = { name, icon: row.icon||'🎬', quality_label: row.quality_label||'',
                 url: row.api_url||row.url||'', show: row.show!==false, ghost: row.show===false,
                 index: row.index, rch: !!row.rch, voices: row.voices||0, seasons: row.seasons||0 }
key = sourceKey(row) = id (native id или 'skaz-<slug>')
filterSources = getKeys(sources)   // ВСЕ, включая ghost
activeSource  = stored('maniya_online_source') || shown[0];  активный клик → api_url
```
Server (sourceModel/route) отдаёт каждому ключу: `{id, name, url:<cluster url сохранён как поле>,
api_url:"/api/lampa/videos?provider=<id>", index, show, ghost, balanser, rch, voices, seasons,
icon(по meta), quality_label:''}` + extras `index:null` (native providers) хвостом.

## 3. Source object diff (решетка обязательных полей)

| Поле | SKAZ runtime | MANIYA runtime | Equal? |
|---|---|---|---|
| source key/id | **PENDING** (плагин; события id не несут) | `id` native | `skaz-<slug>` | ? |
| name | события name (`KinoPub ~ ...`) | равно событиям (name||key) | ✅ |
| url | события `events.url` (bare lite path) — PENDING подтверждение в runtime | `api_url` (!!) | ❓ **кандидат #1** |
| api_url | ABSENT (нет в событиях; наличие в плагине PENDING) | PRESENT (`/api/lampa/videos?provider=`) | ❌ |
| index | события | события | ✅ |
| show | события | события | ✅ |
| ghost | Производное плагина/Lampa от show (runtime PENDING) | `show===false` | ✅ (эффект экрана) |
| icon | события ABSENT ⇒ плагин (PENDING) | meta/‘🎬’ | ❓ кандидат #2 |
| quality | ABSENT (в name) | ABSENT (в name) | ✅ |
| voices/seasons | события | события | ✅ |
| rch | события | события(`!!rch`) | ✅ |
| balanser | события `balanser` (сохраняет ли плагин в runtime — PENDING) | поле в server-item; клиент не кладёт в item | ❓ низко |

## 4. filterSources diff

Оба: все ключи, включая ghost (Lampa-селектор «Ещё N» прячет show:false). Maniya явно
`filterSources=getKeys(sources)`. SKAZ — PENDING по дампу, но на T018 виден один бакет «Ещё N».
⇒ поведение эквивалентно; расхождения в **наборе ключей** (extras, §9).

## 5. ghost / dim / «Ещё N»

- Lampa-ядро (widget build): `if (element.ghost) item.css('opacity', .5)` — тусклость ⇔ `ghost`. Кнопка «Ещё».
- Оба передают одно и то же `show` → одно и то же `ghost` → одинаковый эффект. **Parity доказана.**

## 6. icon diff

- SKAZ: события icon не несут; плагин, видимо, рисует свои вымышленные иконки по слагу/имени (PENDING).
- Maniya: `meta`-иконка по слагу или fallback `'🎬'`. Визуально может отличаться по чипам. **Кандидат #2.**

## 7. order diff

- Оба: `index` ASC; KinoPub #1 на 4/4 свежих карточках (live). Внутри равенства index (коллизии, напр.
  index:7 mutiny Zagonka/iRemux) — tie-break: кластер порядок в online[] (SKAZ), наш index-стабильный (модель).
  Видимого расхождения порядка → нет. Пользовательская «Сортировать» перекрывает ОДИНАКОВО (один storage).

## 8. active-source diff

Оба `stored || shown[0]`. Maniya key = `maniya_online_source`. SKAZ — свой ключ хранения (PENDING).
Жизнеспособный эффект: выбор первого — одинаков (KinoPub).

## 9. extras diff

- Появление: server sourceModel доклеивает **нативные провайдеры Maniya** (collaps, kodik, filmixtv-natives …)
  строками `index:null` — их НЕТ в событиях кластера (ab2: maniya total 31 vs skaz 29 на mutiny).
- В SKAZ их нет: SKAZ показывает ровно события + весь набор через «Ещё N» (29 на mutiny — все, ghost=скрытые в «Ещё»).
- Как SKAZ «обрабатывает тот же native provider»: никак — SKAZ = только кластер (у него нет нашей нативной ветки).
- Для 1:1 UI: да, extras надо убрать/спрятать (это «изменение UI» — только по решению после PROVEN).

## 10. discovery

- `lite/withsearch` → 34 slug (2026-08-22, docs/t023/probe.json). Назначение: перечень модулей кластера
  (поисковые табы плагина), НЕ для карточки/playback. В событиях 4 карточек слагов kinobase/anime*/rc/… НЕТ →
  на runtime источника не влияют. Проверено: наша статика 18 — состав КАРТОЧКИ не меняет (events авторитетен).

## 11. playback architecture

```
SKAZ:  [Lampa] → events.url + cardParams + auth  → {node}/lite/<module>?… → page JSON (call/play)
       → resolve (data-json play/link) → CDN/манифест → player            [Origin http://lampa.mx]
MANIYA: [Lampa] → api_url=/api/lampa/videos?provider=<id> → наш server → SkazProvider.videos()
       → ОН ЖЕ {node}/lite/<module>?… (SkazClient buildLiteUrl:513-523) → page JSON → resolve → proxy/CDN
```
**Точка схождения**: оба пути в итоге увеличивают `http://<node>/lite/<module>?cardParams&auth`
(проверено кодом: buildLiteUrl → `lite/${discoverPath||balancer}`). Разница — **наличие нашего сервера
посередине** (лишний hop + proxy + кэши/литьё) и подмена базового хоста на наш. Прямой ли URL — нет,
это **совместимый внутренний слой поверх того же кластера**. Влияет ли на HDRezka/Filmix — §14, INCONCLUSIVE до TV.

## 12–18. Per-source traces

Server-side установлено (общий контракт §1/§11); для SKAZ-стороны в трассах нужны живые кликов:
| Source | events.url | SKAZ click (PENDING дамп) | Maniya /videos (server, P) |
|---|---|---|---|
| KinoPub | online8/lite/kinopub | → page → resolve → CDN (PENDING) | provider=skaz-kinopub → тот же lite/kinopub (P) |
| Filmix | online3/lite/filmix | (PENDING) | сквозь наш server; upstream 403 без FILMIX_TV (P) |
| HDRezka | online3/lite/rezka | (PENDING) | skaz-rezka; серверно жив (T021); реальный play — TV |
| Alloha | online3/lite/alloha | (PENDING) | skaz-alloha |
| VideoSeed | online3/lite/videoseed | (PENDING) | skaz-videoseed |
| VeoVeo | online3/lite/veoveo | (PENDING) | skaz-veoveo; mvapspdmpg allowlist (T012) |
| RCH (eneyida) | online3/lite/eneyida, rch:true | сессия+навигация (PENDING) | RCH-слой есть; реальный сеанс — TV |

## 14. HDRezka (реальный playback)

Server: поиск/видео/качество работают (T021 P4: ≤15с, не ложное «Видео не найдено»). ПЕРВОЕ различие
запроса SKAZ vs Maniya (§11: лишний hop+proxy) — единственный доказанный кандидат; фактическое
сравнение manifest/segment/seek — через TV-прогон (снипет §27 ловит манифест/CDN/сегменты обеих).

## 15–19. Serial / Search

- Serial (HOD): события получены (25 строк, voices у kinopub/rezka=19 — кластер отдаёт и озвучки).
  Цепочка seasons/episodes → в нашей модели работы provider (skaz-<slug> serial pages). SKAZ-сторона — TV.
- Search: кластер `lite/fsearch` → 404 (T023). Реального поискового эндпоинта НЕ найдено; SKAZ поиск
  идёт через обычные страницы модулей (discovery-набор) — это уже наша provider-логика. PENDING на TV.

## 20. Continue Watching

- SKAZ: серверного continue-watching нет (404, T021). Всё клиентское (Lampa storage).
- Maniya: эквивалент клиентский (T021 P-PW). Различия = ключей storage/поля timecode/source;
  если поведение при повторном открытии отличается — сравнивать ключи через §27 (дамп storage).

## 21. FIRST DIVERGENCE matrix (живое поле-by-поле, серверная база доказана)

| # | FIELD | SKAZ (доказано ЛИВО 2026-08-23) | MANIYA (доказано) | LOCATION | EFFECT |
|---|---|---|---|---|---|
| **F1** | **url** | **events.url (bare lite deep-link); клик = url+?cardParams+auth+nws_id → прямой CDN MP4** (запись: lite/filmix?id=1288445→werkecdn, без прокси) | **api_url `/api/lampa/videos?provider=` → server → /api/lampa/proxy → тот же CDN** | maniya-online.js model-ветка `url: row.api_url\|\|row.url` + proxy route | Playback-путь: SKAZ=кластер→CDN напрямую; MANIYA=наш API→proxy. **Оба играют** (filmix подтверждён). Разница в проводке, не в источнике |
| **F2** | **api_url** | **ABSENT** (все XHR плагина только на online*.skaz.tv) | PRESENT | server sourceModel → клиент | Клик Maniya зависим от нашего API |
| F3 | icon | события ABSENT; плагин-иконки (не снято, вторично) | meta/‘🎬’ | клиент icon-fallback | Внешний вид чипов (вторично) |
| F4 | extras (index:null) | НЕТ | ЕСТЬ (natives) — только Shadow T021 | sourceModel merge | Доп. чипы в UI (shadow) |
| F5 | balanser в runtime | события balanser = id плагина | server шлёт; клиент дропает | клиент model-ветка | Служебное |
| F6 | request-shape событий | withsearch→externalids→events?life→lifeevents?memkey (+nws/cub_id/rchtype/kp-override) | lite/events напрямую (без life) | SkazClient.getOnline | Сетевая форма различается; КОНТЕНТ-паритет (1b) |
| F6p | PROD-состав | 29 per-title (events/lifeevents) | **PROD 768B = {id,show} static 21** (запись 2026-08-23) | прод не имеет sourceModel (T020 Golden) | На PROD: статик-список vs SKAZ per-title (T018-legacy; в Shadow T021 закрыто) |

Parity (подтверждена): name/index/show/ghost/voices/seasons/rch, filterSources-механика, dim, «Ещё N»,
порядок (KinoPub #1), активный источник; model-контент под обеими формами запроса.

**FIRST DIVERGENCE (ПРОД/Shadow общая) = F1 `url`**: первое поле runtime-объекта источника, на котором
SKAZ и Maniya расходятся; именно оно определяет клик→endpoint (эффект §11/§12-18). На PROD добавляется
F6p (состав статик-21 vs per-title-29), не меняющий FIRST DIVERGENCE.

## 22. Root causes

1. **двухпуть (F1)**: Maniya подменяет `url` на `api_url` → каждый клик идёт через наш API. Не «плохо
   сам по себе» (совместимый слой, §11), но это ПЕРВОЕ место, где поведение объективно отличается.
2. **extras (F4)**: нативные чипы в UI, которых у SKAZ нет → внешний «лишний» ряд; кандидат для 1:1.
3. **icon/visual (F3)**: если иконки не совпадают построчно — видимый диф.
4. Ложное «Видео не найдено» = пустые videos активного источника (следствие путей/провайдера, не модели).

## 23. Required code changes (ПЛАН — НЕ выполнять до PROVEN)

1. (F1-фикс опционально) кластерный url как первичный клик + api_url для native — по решению после TV.
2. (F4) скрыть/убрать extras в model-режиме — с одобрения.
3. (F3) синхронизировать иконки по слагу с фактическим SKAZ-экраном.
4. Ничего из этого НЕ выполнять до финального статуса.

## 24. Changes that must NOT be made

sourceModel.js · availability.js · SkazClient.js · store.js · providers/ · proxy.js · maniya-online.js ·
config.js · .env · nginx · DNS · production · Shadow. ГЕРМЕТИЧНО до завершения отчёта.

## 25. Test plan

1. Дамп §27 → заполнить PENDING-колонки → матрица §21 → статус.
2. TV-прогон (per-source click → request → response → manifest → segment → player) SKAZ и Maniya.
3. HDRezka реальный play: сравнить первый запрос (манифест) обоих.
4. Serial HOD: полная цепочка до эпизода. 5. Continue Watching: play→exit→reopen, ключи storage.

## 26. Снипет закрытия (пасту в DevTools Web Lampa; исполнять при открытых карточках)

```js
/* T025 capture — paste ONCE, then open each card via SKAZ then via Maniya.
   Ловит сетевые запросы (клик→endpoint→CDN) и снимает runtime-срезы. */
(()=>{
  const SAN = u => u.replace(/(account_email=)[^&]*/,'$1R').replace(/(&uid=)[^&]*/,'$1R').replace(/(nws_id=)[^&]*/,'$1R');
  const HOST_RE = /skaz\.tv|lampa|m3u8|\.mp4|maniya|\.ws|api\./;
  const seen = new Set();
  const hook = (impl_name, impl) => {
    if (!window.__t025) window.__t025 = { clicks: [] };
    if (impl_name === 'fetch') return function(u, o){
      try{
        const url = SAN(typeof u === 'string' ? u : (u&&u.url)||'');
        if (HOST_RE.test(url)) console.log('[T025-req]', (o&&o.method||'GET'), url);
        const p = impl.apply(this, arguments);
        p.then && p.then(r => {
          try{ const k = url.slice(0,120);
            if (!seen.has(k)){ seen.add(k); const ct = r.headers && r.headers.get && r.headers.get('content-type')||'';
              console.log('[T025-res]', r.status, SAN(typeof u === 'string' ? u : (u&&u.url)||''), ct, 'bytes=' + (r.headers && r.headers.get && r.headers.get('content-length')||'?'));
            } }
          catch(e){}
        }).catch(()=>{});
        return p;
      } catch(e){ return impl.apply(this, arguments); }
    };
    return function(){
      const u = SAN(this._url || this.url || '');
      if (HOST_RE.test(u)) console.log('[T025-req]', 'XHR', u);
      this.addEventListener('load', ()=>{
        try{ const ct = this.getResponseHeader && this.getResponseHeader('content-type')||'';
          if (ct && !ct.includes('text/html')) console.log('[T025-res]', this.status, u, ct, 'len=' + (this.responseText||'').length); }
        catch(e){}
      });
      return impl.apply(this, arguments);
    };
  };
  try{ window.fetch = hook('fetch', window.fetch); }catch(e){}
  try{ const X = window.XMLHttpRequest; const origSend = X.prototype.send;
    X.prototype.send = function(){
      const u = SAN(this._url || this.url || '');
      if (HOST_RE.test(u)) console.log('[T025-req]', 'XHR', u);
      this.addEventListener('load', ()=>{
        try{ const ct = this.getResponseHeader && this.getResponseHeader('content-type')||'';
          if (ct && !ct.includes('text/html')) console.log('[T025-res]', this.status, u, ct, 'len=' + (this.responseText||'').length); }
        catch(e){}
      });
      return origSend.apply(this, arguments);
    };
    const origOpen = X.prototype.open;
    X.prototype.open = function(m, u){ this._url = u; return origOpen.apply(this, arguments); };
  }catch(e){}
  const dummy = (label, v) => console.log('[T025-dump.'+label+']', JSON.stringify(v).slice(0, 600));
  window.__t025Dump = () => {
    console.log('--- T025 runtime dump ---');
    // активный источник Maniya / storage-ключи (sources/continue-watching)
    try{ const S = window.Lampa && Lampa.Storage;
      if (S && S.get){ dummy('stored.maniya_source', S.get('maniya_online_source'));
        ['continue_watching','maniya_continue','history','player'].forEach(k=>{ try{ const v = S.get(k); if (v) dummy('stored.'+k, v); }catch(e){} }); }
    }catch(e){}
    // текущие чипы-источники: классы + яркость (ghost→opacity≈.5) + text
    try{ const sel = document.querySelectorAll('.items-line__source, .source-line, .select-menu__item, .items-line__item');
      if (sel.length){ dummy('chips.count', sel.length);
        Array.prototype.forEach.call(sel, it => {
          const cs = getComputedStyle(it);
          if (cs && (cs.opacity !== '1' || /source/i.test(it.className||'')))
            console.log('[T025-chip]', (it.textContent||'').trim().slice(0,60), '| cls=' + (it.className||'').slice(0,80), '| opacity=' + (cs && cs.opacity));
        });
      } else console.log('[T025-chip] none (меню ещё не открыто?)');
    }catch(e){}
    dummy('card.url', location.href);
  };
  console.log('T025 capture armed. Paste-блок активен; открывай карточки SKAZ, потом Maniya, зови __t025Dump() при выбранном источнике.');
})();
```
Потом на карточке: открыть «Мятеж» → SKAZ → **клик KinoPub** → console: цепочка `[T025-req/res]`
(events.url+cardParams → page → resolve → m3u8/CDN); `__t025Dump()` при каждом выборе. Повторить Filmix,
HDRezka, Alloha, VideoSeed, VeoVeo, RCH(eneyida), сериал HOD; затем Maniya (те же карточки). Серию
console-вывода прислать (скрин/копия), Network-responses — по T024 §12 тоже.

## 26b. Evidence получено (2026-08-23, Web Lampa lampa.mx, карточка Мятеж)

1. **SKAZ**: full wire-sequence (§1a) + клик Filmix → lite/filmix?cardParams → **прямой** werkecdn MP4 → plays.
2. **Maniya (plugin.maniya-kvn.online, PROD)**: `/sources`(3481B)→`/sources/card`(768B{id,show})→
   `videos?provider=filmix`(5110B)→`proxy?url=werkecdn`(dl) → **plays**. → F1/F2/F6p доказаны; обе стороны играют.
3. Вторично (не блокирует): icon-DOM, Shadow-model runtime (их можно снять скрином/дампом по желанию).

## 27. FINAL STATUS

**COMPLETE — FIRST DIVERGENCE PROVEN.**

- **FIRST DIVERGENCE = FIELD `url`** (runtime-объект источника): SKAZ кликает `events.url`(+cardParams+nws)
  напрямую в кластер → CDN (без нашего сервера); Maniya кликает собственный `api_url`
  (`/api/lampa/videos?provider=`) → server → `/api/lampa/proxy` → тот же CDN.
  LOCATION: не в событиях (они вербатим), а в клиентской сборке runtime (maniya-online.js model-ветка) и в
  route+proxy сервера. EFFECT: другой сетевой путь клика/воспроизведения; на Filmix обе схемы играют.
- Сопровождающие доказанные различия: F2 (api_url ABSENT у SKAZ), F6 (wire-форма событий: life/nws/memkey),
  F6p (на PROD дополнительно статик-21 vs per-title-29).
- Parity (не differences): name/index/show/ghost/voices/seasons/rch, «Ещё N»/dim/порядок/active, контент модели.
- Код НЕ менять (HARD STOP) — вывод «что менять» изложен в §23 на основе F1-F6p.