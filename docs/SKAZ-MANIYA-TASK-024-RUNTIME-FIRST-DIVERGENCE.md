# TASK-SKAZ-MANIYA-024 — SKAZ REAL RUNTIME PARITY / FIRST DIVERGENCE

> READ-ONLY. Код/prod/Shadow/deploy/git НЕ трогались. Прод `8fc18753/76` нетронут.
> **Резюме:** серверный parity (T023) подтверждён; UI-движок Lampa разобран по его собственному
> коду (LampaWeb widget samsung/app.js); Maniya runtime вычислен детерминированно из `public/maniya-online.js`.
> Единственный недостающий артефакт для PROVEN — фактический runtime/payload SKAZ-плагина (приложение: screenshot+Network).
> **Статус: MISSING EVIDENCE** (см. §12 — двухминутный протокол закрытия).

## 1. Stage table (SKAZ vs Maniya, карточки «Мятеж» / «История игрушек 5»)

Обозначения: **P**=доказано кодом/живым probe · **O**=наблюдение на экране TV (док. T018/019C) · **C**=вычислено из нашего кода · **U**=UNKNOWN (нет плагина/дампа).

| Stage | SKAZ | Maniya | Equal? | First divergence |
|---|---|---|---|---|
| events (вход) | `{name,url,index,show,balanser,rch,voices,seasons}` (P: T018-21) | то же (P) | ✅ | — |
| plugin transform | обфусц., нет доступа (U) | `public/maniya-online.js` 521-557: детект `'index' in row` → build runtime объект (P) | ? → C-сторона известна, SKAZ-сторона U | **преобразование SKAZ UNKNOWN** |
| runtime `sources[key]` | поля = события, какие-то добавлены плагином (U) | `{name, icon, quality_label, url=row.api_url\|row.url, show, ghost, index, rch, voices, seasons}` (C) | частично | icon/url см. ниже |
| `id`/key | UNKNOWN (вероятно balanser-slug) | `sourceKey(row)` = `id` (native id или `skaz-<slug>`) (C) | ? | низкий импакт (storage) |
| `url` runtime | **кластерный** `events.url` (P: T023 §9) | **`api_url` → `/api/lampa/videos`** (C) | ❌ **DIVERGENCE (двухпуть)** | сетевой путь playback |
| `api_url` | ABSENT | PRESENT (C) | ❌ | суть двухпутья |
| `show` | из событий (P) | `row.show !== false` (C) | ✅ | — |
| `ghost` | в событиях ABSENT → создаётся плагином или Lampa из `show` (U кто именно; эффект = O) | явно `row.show === false` (C) | ✅ (эффект экрана: O) | — |
| «Ещё N» | show:false → hidden-бакет → «Ещё» (O: T018 «скрытые чипы») | то же (C, filterSources=все ключи) | ✅ | — |
| order | события по `index` ASC, KinoPub #1 (P) | серверный `index` ASC, KinoPub #1 (C+P ab2) | ✅ | — |
| `index` | PASS (P) | PASS (C) | ✅ | — |
| icon | в событиях ABSENT (P); плагин рисует своими иконками (U) | `row.icon || '🎬'` (C) — сервер шлёт icon по meta-слагу | ❌ **кандидат** | иконка чипа (выглядит) |
| quality_label | в событиях ABSENT (P); качество — внутри `name` («Filmix ~ 4K») (P) | `row.quality_label || ''` (C; сервер шлёт '') — качество в name (P) | ✅ (оба в name) | — |
| voices/seasons/rch | PASS (P) | PASS (C) | ✅ | — |
| active source | `stored || shown[0]` (O: «первый выбранный») | `stored('maniya_online_source') || shown[0]` (C) | ✅ | — |
| mouse/nav dim | `ghost` → opacity .5 (P: Lampa код) | то же поле (C) | ✅ | — |
| videos | клик → кластер `url` → data-json → resolve | клик → `api_url` → `/videos` → provider → proxy | ❌ **DIVERGENCE (архитектура)** | playback-путь |

## 2. «Ещё N» — полный lifecycle (доказан)

```
events.show=false ─▶ (SKAZ: плагин-пасс или Lampa из show; события поля ghost НЕ несут) ─▶ runtime ghost/skryt
                  ─▶ (Maniya: built.ghost = row.show===false) ─▶ filterSources = ВСЕ ключи (incl. ghost)
                  ─▶ Lampa: hidden-бакет + кнопка «Ещё» (items-line__more) ─▶ «Ещё N»
```
Кто создаёт ghost: **поле ghost в событиях отсутствует** (P). У Maniya его явно ставит клиент; у SKAZ — либо плагин, либо Lampa-слой по `show`. Эффект на экране одинаковый (O: T018: чипы=shown, «Ещё N»=show:false), поэтому на этом слое расхождения НЕТ.

## 3. Тусклые источники — условие (доказано из кода Lampa)

`LampaWeb/widgets/samsung/app.js`: **`if (element.ghost) item.css('opacity', 0.5)`** → чип тусклый ⇔ `ghost===true`.
Логика одинакова для обоих (поле `ghost`); у Maniya ghost выставляется той же величиной `!show`. Т.е. «тусклость» не является точкой расхождения при равных `show`. Если на чьём-то экране Maniya тусклее/ярче — источник расхождения в **значениях show**, а не в движке: кандидаты — граничный кейс кластера/наших probe (см. §6).

## 4. Порядок — KinoPub/Filmix (доказан)

- Оба: `index` ASC, KinoPub #1 (P, ab2). Maniya key-порядок = порядок вставки `json.sources` (сервер уже даёт по index ASC) → объект рендерится в том же порядке (JS object insertion order). Точку расхождения порядка НЕ обнаружено; KinoPub первый у обеих на 5/6 нод (нода 77.90.33.109 → Filmix #1 — инфра-особенность обеих, они ходят в один кластер).
- Примечание: на устройстве пользователя может быть **пользовательская сортировка** («Сортировать»), сохранённая в Lampa.Storage — она переопределяет порядок ОДИНАКОВО для обеих (один storage) → не является межплагинной дивергенцией.

## 5. withsearch — назначение (без внедрения)

- `GET {host}/lite/withsearch` → JSON **[34 slug]** (P: 2026-08-22, 337ms) — это **discovery набора модулей (balancers) кластера**, Lampac-семантика «модули с поиском» (per `docs/skaz-architecture.md` §0-§6 — плагин использует discovery при инициализации для своего поискового таба).
- НЕ используется: для пер-тайтл `/sources` карточки (там `lite/events`), для `/videos`, для playback, для RCH-слоя (rch помечен в самих событиях).
- Влияние на UI карточки: **нет** (набор для конкретного тайтла приходит через события, а не из withsearch). Новые slug (kinobase/anime*/rc/*) в событиях контрольных карточек отсутствуют → на состав экрана не влияют.

## 6. ROOT CAUSE (установленные факты + ранжированные кандидаты)

При серверном parity `lite/events` экран Maniya ≠ SKAZ из-за следующих **конкретных** различий runtime-объекта (по §1):
1. ❗ **url (двухпуть)**: SKAZ runtime `url` = кластерный deep-link (`events.url`); Maniya `url` = `api_url` → `/api/lampa/videos` → provider → proxy. Это **доказанная дивергенция** (код обеих сторон). Влияет на клик/нагрузку videos и на сетевой путь программы (не на чип-вид).
2. **icon**: у SKAZ — иконки плагина (карта в plugin.js, U); у Maniya — серверные `icon` по слагу или fallback **'🎬'**. Если на конкретном чипе иконка отличается — видимое расхождение (кандидат #1 по «выгляду»).
3. **Maniya-only extras в хвосте** (`index=null`, show=true): Кodik/Collaps/HDRezka 4K/etc — дополнительные яркие чипы, которых у SKAZ нет (документированный дизайн T021; visible divergence BY DESIGN).
4. **«Видео не найдено»**: Lampa показывает это сообщение при пустых videos выбранного источника; если у Maniya активный (stored или shown[0]) вернул пусто (например, из-за двухпутья/пустого эфемерного), а у SKAZ — нет → **внешняя** картина «Maniya: ошибка, SKAZ: играет» — это следствие §6.1/провайдера, а НЕ источника-модели.
5. **«Тусклые»**: одинаковый движок (ghost→.5); тусклыми выглядят show:false у обоих. Кандидат расхождения — только если у Maniya где-то probe менял `show` вопреки кластеру (в model-режиме доверяем кластеру → нет).

**Однозначный ответ на вопрос задачи:** «почему Maniya не выглядит как SKAZ при серверном parity» — потому что runtime-объект Lampa **не обязан** совпадать с ответом `/sources/card`: клиент Maniya подменяет `url`→`api_url` (дивергенция сетевого пути), возможно подставляет иконку `'🎬'`, и добавляет нативные extras-чипы. Ни одна из этих причин не находится в *источниках* (events→model вербатим) — они в **клиентской сборке runtime-объекта** и в **наборе extras**.

## 7. Что именно необходимо изменить в Maniya (чтобы Lampa получила ту же runtime-модель) — ПЛАН, НЕ выполняется

1. Решить two-path: вернуть кластерный `url` как непосредственный источник для `activeUrl`/`changeSource` (как у SKAZ) ИЛИ оставить `api_url` — решение зависит от §9 (влияет ли двухпуть на HDRezka/Filmix) и от TV-прогона. **Не менять без доказательства.**
2. icon-политика: согласовать иконки чипов с SKAZ (карта слаг→иконка на нашей стороне уже есть в meta; проверить построчно против экрана).
3. extras: если цель 1:1 с SKAZ-экраном — выключить нативные extras (index=null строки) в model-режиме (это тоже «изменение UI» — только с одобрения).
4. Ничего из этого не менять до «FIRST DIVERGENCE PROVEN» + HARD STOP §11.

## 8. Playback — сравнение архитектуры (без кода)

```
SKAZ: events.url → кластер lite/<balancer> → data-json(play/call/link) → CDN/манифест (Origin lampa.mx)
Maniya: api_url → /api/lampa/videos → provider (native | skaz-<slug>) → streams() → /proxy → CDN
```
- Filmix: упало = **upstream 403 без FILMIX_TV-кредов** (H/G), НЕ из-за двухпутья (P: shadow-лог 19:57:53 `hasAuth:false`).
- HDRezka: цепочка серверно работает (P: T021); двухпуть не виноват, пока TV не покажет обратное (P3/P4).
- Вывод: **двухпуть доказан как дивергенция архитектуры, но НЕ доказан как причина playback-сбоев**. Влияние — INCONCLUSIVE до TV-прогона.

## 9. Ghost/dim/«Ещё N» — parity подтверждена (без дампа плагина)

Наблюдения экрана TV (T018/019C) + код Lampa + computed-код Maniya дают: `show:false → ghost → dim(.5) + «Ещё N»` ОДИНАКОВО. Это слой, где расхождение НЕ обнаружено.

## 10. Недостающие доказательства (MISSING EVIDENCE)

- Фактический runtime/payload SKAZ-плагина: какие поля он кладёт в источник (id/icon/url/ghost), как формирует `filterSources`, какой URL передаёт при клике.
- Реальные значения `icon` на экране (скрин чипов SKAZ vs Maniya на «Мятеже»).
- Подтверждение, что у SKAZ «первый выбранный» = shown[0] (или сохранённый user-order).

## 11. HARD STOP

Без «FIRST DIVERGENCE PROVEN» НЕ менять: sourceModel, availability, providers, proxy, config, withsearch, UI, production. Status: только **FIRST DIVERGENCE PROVEN** или **MISSING EVIDENCE**.

## 12. Протокол закрытия (2 минуты, у пользователя)

В Web Lampa (живой, СКРИНОМ + DevTools→Network→XHR):
1. Открыть **«Мятеж»** через SKAZ-плагин: скрин чипов «Источник» (+«Ещё N»); в Network сохранить **ответ** запроса, который плагин отдал как sources (крайний `online`/`sources`-запрос на эту карточку).
2. То же самое **через Maniya Shadow** на том же «Мятеже»: скрин чипов; сохранить ответ `/api/lampa/sources/card`.
3. Прислать мне оба ответа (JSON, секреты замазать) + 2 скрина.
Сравнение ответов поле-в-поле ↔ это и есть «plugin transform»-звено: если JSON SKAZ содержит поля (id/icon/url/ghost/api_url), которых нет у нашего — это и будет явная FIRST DIVERGENCE с именем поля и механизма.

## 13. Вердикт

| Слой | Позиция |
|---|---|
| events→модель | Parity подтверждена (T023/T024) |
| ghost/«Ещё N»/dim | Parity подтверждена (код Lampa + код Maniya + O) |
| порядок/KinoPub-first | Parity подтверждена |
| url-двухпуть | **Дивергенция доказана** (архитектура; импакт на playback — INCONCLUSIVE) |
| icon/quality_label/extras | Кандидаты дивергенции — требуют дампа/скрина |
| SKAZ plugin transform (runtime поля) | UNKNOWN (нет plugin.js) |

**FINAL STATUS: MISSING EVIDENCE** (закрывается протоколом §12: 2 ответа Network + 2 скрина). После дампа статус станет FIRST DIVERGENCE PROVEN (с точным полем) и, отдельно, план §7 будет решать по факту.