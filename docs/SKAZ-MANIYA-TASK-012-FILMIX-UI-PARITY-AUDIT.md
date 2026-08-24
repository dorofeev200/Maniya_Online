# SKAZ-MANIYA-TASK-012 — FILMIX / FILMIXTV IDENTITY + SOURCE UI PARITY AUDIT

**Дата:** 2026-08-21. **Тип:** READ-ONLY audit (код/конфиг/.env/VPS/PROD НЕ изменялись, фиксы НЕ выполнялись).
**Метод:** traceback от прямых probe кластера (`lite/<slug>` с теми же params и account_email/uid, что Maniya buildUrl) + код `server/src/providers/filmix/FilmixClient.js` + прод-API `/api/lampa/sources` и `/api/lampa/videos`.

---

## PHASE 1 — IDENTIFY PROVIDERS (traceback)

| slug/провайдер | endpoint (живой) | backend-класс | auth | response | CDN | quality-модель | play-модель |
|---|---|---|---|---|---|---|---|
| SKAZ **filmix** | `http://online3.skaz.tv/lite/filmix` (200, 293–468ms) | **filmix.co HTML-скрап**: тело = HTML `<div class="videos__line">` + прямые werkecdn **MP4**-ссылки | account_email + uid (кластер) | HTML | werkecdn: chache08.werkecdn.me, nl221.werkecdn.me, nl104/nl105/nl06/nl202.cdnsqu.com | ladder 2160p/1440p/1080p (MP4) | progressive MP4 (прямые ссылки) |
| SKAZ **filmixtv** | `http://77.90.33.109/lite/filmixtv` (200, 370–1383ms; **online3 → 503**) | **ТОТ ЖЕ HTML-скрап filmix.co**: идентичная структура страницы, тот же набор werkecdn MP4 (2160/1440/1080) | account_email + uid | HTML | ТЕ ЖЕ узлы werkecdn | ladder 2160p/1440p/1080p (MP4) | progressive MP4 |
| MANIYA native **filmix** | `filmix.my` (primary JSON/HTML, timeout 3с) + **`api.filmix.tv`** (api-fx `video-links`, timeout 45с) | **FilmixTV JSON API** (browser-API) + filmix.my | user_dev_token (user_device_id) + tvUser/tvPassword (FILMIX_TV_*) | JSON → items play/HLS | werkecdn m3u8 с hash (T010: nl105.cdnsqu.com, 2160p 6.6GB) | HLS 2160p/1080p… | HLS (m3u8+hash) / play |
| MANIYA **skaz-filmix** (hidden twin, в списке нет) | кластер `lite/filmix` (тот же HTML) | HTML → SkazClient НЕ парсит (нет lite-JSON) → **0 items всегда** | uid | — | — | — | не работает (by design) |

**Вывод PHASE 1 (без предположений, по телам):**
- `lite/filmix` и `lite/filmixtv` возвращают **один и тот же HTML-шаблон и один и тот же контент-набор werkecdn MP4** на «Интерстелларе»: `https://chache08.werkecdn.me/s/FHPvLX…/Interstellar.2014.BDRip.2160p.SDR.dub.rus_2160.mp4` (и _1440, _1080) против `FHUJxt…/…_2160.mp4` — **различие только в signed-токене URL и узле кластера**. api.filmix.tv / filmix.co ссылок в телах НЕТ → оба слага = **один контент-source (filmix.co через кластер)**, два endpoint/slug.
- MANIYA native filmix = **другой acquisition-канал того же контента**: официальный JSON-API FilmixTV (filmix.my + api.filmix.tv) — не HTML-скрап кластера.

## PHASE 2 — CONTROLLED DIFFERENTIAL (3 тайтла)

| title | SKAZ filmix @online3 | SKAZ filmixtv @77.90.33.109 | MANIYA native filmix | MANIYA skaz-filmix |
|---|---|---|---|---|
| История игрушек 5 | 200/293ms **2160p** (nl105/nl221) | 200/1383ms **2160p** (nl105/nl221) | 200/925ms **items=3** (4K Дубляж…) | 200/2733ms **0 items** |
| Интерстеллар | 200/338ms **2160p** (chache08/nl221) | 200/370ms **2160p** (chache08/nl221, тело=MP4 2160/1440/1080) | 200/1725ms **items=3** (Rus/1080+/4K) | 200/1638ms **0 items** |
| Форрест Гамп | 200/468ms **2160p** (nl06/nl202) | 200/431ms **2160p** (nl06/nl202) | 200/1285ms **items=5** | 200/1110ms **0 items** |
| хост-фолбэки | 77.90.33.109: **403 `disable`** | online3: **503 EMPTY** | — | — |

**Критерий задачи:** «есть ли случай SKAZ filmixtv=content, но MANIYA filmix=EMPTY?» → **НЕТ. НИ ОДНОГО.** native filmix покрывает все 3 контрольных тайтла (items>0). ⇒ **filmixtv НЕ считать coverage gap** (по стоп-условию задачи).

## PHASE 3 — SOURCE IDENTITY

| SKAZ provider | SKAZ backend | MANIYA provider | MANIYA backend | equivalent? |
|---|---|---|---|---|
| filmix | filmix.co HTML (кластер, online3) | native `filmix` | filmix.my + api.filmix.tv (JSON API) | контент тот же; канал разный |
| filmixtv | filmix.co HTML (кластер, 77.90.33.109) | native `filmix` | filmix.my + api.filmix.tv | контент тот же; канал разный |
| filmix ≡ filmixtv | один HTML/werkecdn-контент (тела идентичны, токен/узел разные) | — | — | **ДВА endpoint ОДНОГО backend/content** |
| — | — | skaz-filmix (twin) | lite/filmix HTML (не парсится) | отсутствует по смыслу (0 items) |

**missing?** — физически отсутствует только «вторая карточка фильмикса» (filmixtv) = номинал. РЕАЛЬНОГО missing-бэкенда нет.

## PHASE 4 — UI / SOURCE MODEL (код `public/maniya-online.js`)

- Плагин запрашивает `/api/lampa/sources` **с параметрами фильма** (`addMovieParams`), рендерит карточку на каждый id с `show:true` (`filterSources = keys.filter(s => sources[key].show)`), мета (icon, quality_label) приходит из серверного `meta.js`; при пустом списке — `maniya_empty_sources`.
- Прод-список: **21 провайдер** (8 native + 13 skaz-*), все show=true на статике; динамика show/hide — в per-title ответе.
- **SKAZ-модель UI**: Lampa рисует карточку на каждый id из отдаваемого списка — у SKAZ-плагина 29 карточек (включая **две filmix-карточки**: `filmix` и `filmixtv`).
- Сопоставление: набор ид-карточек (=у SKAZ больше), quality badge (у Maniya есть per-source quality_label), green-online/available (у обоих = Lampa-стайл), выбранный источник/ordering (Lampa-нативные механики, плагин отдаёт только список+show). Функциональных отличий модели рендера НЕТ — различие в **перечне provider-id** и **внешнем виде набора**.

## PHASE 5 — TRACE UI → BACKEND (критическая точка)

Пользователь → выбирает `filmix` → `/api/lampa/videos?provider=filmix` → `FilmixClient`:
`filmix.my` (primaryClient: **timeout 3с, retries 0**) → при недоступности/гео-блоке → `api.filmix.tv` `video-links` (apiFxClient: **timeout 45с**, cold-cache до ~40с, бывают 502 — это закомментировано прямо в коде клиента).
- Если **оба канала дают сбой в окне транзиента** → **items=0** → Lampa покажет «Поиск не дал результатов».
- В этот же момент SKAZ filmix (кластер) отвечает **200/349ms 2160p MP4**. Внутренний фолбэк Maniya на `skaz-filmix` twin **невозможен** (0 items by design, HTML не парсится).

**FIRST DIVERGENCE этой цепочки = acquisition-канал filmix-семейства:** кластер отдаёт filmix-контент HTML/MP4 мгновенно; Maniya-native ходит напрямую в FilmixTV JSON API с VPS (гео-гейт, тяжёлый video-links) → окно EMPTY возможно. Класс **C (upstream/egress-transient)**, НЕ баг балансировщика.

## PHASE 6 — SOURCE COVERAGE (29 → 21)

| кластер слаг | в Maniya | статус |
|---|---|---|
| filmix, **filmixtv** | native `filmix` (1 карточка) | **дубликат-контент** — filmixtv избыточен (доказано PHASE 1-2) |
| alloha/veoveo/pidtor/… (18) | skaz-* провайдеры | мост есть |
| kinobase/lumex/fxapi/redheadsound/anime*×6/remux/animelib/kinoukr/vcdn/videocdn/vdbmovies | отсутствуют | T011: на контрольных честно EMPTY/503 (не различия) |
| kinotochka | native kinotochka | покрыт отдельным бэкендом |

**Дубликатов бэкендов внутри Maniya с ДОКАЗАННЫМ одинаковым контентом не выявлено;** единственный «двойник» — filmix/filmixtv ≡ один контент, и он покрыт одним native filmix.

## PHASE 7 — FINAL DIFFERENCE MATRIX

| AREA | SKAZ | MANIYA | SAME? | FIRST DIVERGENCE | CLASS |
|---|---|---|---|---|---|
| Discovery/слаги | 29 карточек | 21 карточка | Нет | перечень provider-id (шире у SKAZ) | E (номинал) |
| Provider identity (filmix-family) | filmix + filmixtv | filmix (1) | Нет (номинал) | дублирующий слаг filmixtv | E |
| Content coverage filmix-family | 2160p MP4 | 2160p HLS/play | **Да (3/3, items>0)** | — | — |
| Availability show/hide | кластер-истина | 1:1 (T011, 0 расхождений) | Да | — | — |
| Host selection | online3 / filmixtv@77.90 | online3 / native direct | Да (T011) | — | — |
| Source ordering | порядок слагов | registry+meta | ~ | не влияет на playability | E |
| Quality | 2160p MP4 | 2160p HLS + quality_label | Да (планка 2160p) | реализация (MP4 vs HLS) | E |
| Voice | по каталогу | по каталогу (alloha и др.) | Да | — | — |
| Resolve/Play | HTML → MP4 (direct) | JSON → HLS | Да (оба playable) | acquisition-канал | C |
| Fallback | второй линк/SDL | filmix.my→api-fx | Нет (в окно 503/40с возможен EMPTY) | **нет HTML-MP4 фолбэка** | C |
| UI state / empty state | Lampa "нет результатов" при пустом слага | то же + maniya_empty_sources | Да (механика Lampa) | — | — |
| Player | Lampa native (MP4/HLS) | Lampa native (+proxy) | Да | — | — |

---

## FINAL ANSWER

1. **SKAZ `filmix` — тот же backend, что Maniya native Filmix?** НЕТ по endpoint-классу: SKAZ filmix = **filmix.co HTML-скрап** (кластер, werkecdn MP4); Maniya native = **filmix.my + api.filmix.tv JSON API** (HLS). Контент-библиотека одна (Filmix/werkecdn), канал разный.
2. **SKAZ `filmixtv` — тот же backend, что Maniya native Filmix?** По контенту — ДА (те же werkecdn MP4 2160p на всех контрольных). По каналу — такой же HTML-скрап кластера, как filmix. **SKAZ filmix ≡ SKAZ filmixtv = один backend, два slug** (разница: узел 77.90.33.109 + signed-token; на online3 filmixtv=503, на 77.90 filmix=403). Maniya native filmix даёт тот же контент тем же CDN через JSON-API.
3. **Есть ли реальный coverage gap?** **НЕТ.** Случай «SKAZ filmixtv = content, MANIYA filmix = EMPTY» на контрольном наборе не встречается (0 из 3; native filmix items>0 везде). Вывод T011 «filmixtv = B COVERAGE GAP» **СНЯТ** — классифицировано как дублирующий слаг существующего покрытия.
4. **Есть ли реальный UI/source-model gap?** Функционального — нет (механика карточек Lampa одинакова). Номинальные: набор карточек 21 vs 29; одна filmix-карточка vs две; отсутствуют anime*/lumex/… (пусты на контроле). Всё класс E.
5. **Почему Maniya визуально не ведёт себя как SKAZ?** Не из-за рендера: Lampa рисует то, что отдают слаги. Различия: (а) Maniya отдаёт 21 id, у SKAZ 29; (б) у SKAZ два id для одного filmix-контента, у Maniya один `filmix`; (в) окно EMPTY native filmix при транзиенте filmix.my/api-fx (то, что у SKAZ мгновенно берётся HTML-путём кластера) → может вызвать «Поиск не дал результатов» при рабочем кластерном источнике. Это единственный функциональный кандидат, и он в acquisition-пути, не в UI.
6. **Какой следующий минимальный TASK нужен?** **НЕ подключать filmixtv** (избыточен). Минимальный осмысленный шаг (если симптом «Поиск не дал результатов» подтверждается вживую): **TASK — HTML/MP4-фолбэк в FilmixClient** (взять werkecdn MP4-ссылку через HTML-путь filmix.my, когда filmix.my/api.filmix.tv недоступны 3с/40с) — закрывает transient-EMPTY. До отдельного задания — ничего не делать.
7. **Что НЕ нужно исправлять:** filmixtv (дубликат), skaz-filmix twin (0 items = design, HTML не парсится), состав/порядок карточек, availability (0 расхождений), proxy (HLS уже принят T010).

## FINAL STATUS: **ACCEPT**

Audit завершён, все гипотезы закрыты traceback'ом (тела lite/filmix ≡ lite/filmixtv; native filmix items>0 3/3; UI = Lampa-механика; дивергенция только в acquisition-канале class C). Код/конфиг/PROD не изменялись. Ожидается отдельное задание (если требуется фолбэк-фикс).