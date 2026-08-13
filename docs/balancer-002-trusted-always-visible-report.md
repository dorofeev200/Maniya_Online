# BALANCER-002 — TRUSTED_ALWAYS_VISIBLE: Filmix как доверенный всегда-видимый источник

Дата: 2026-08-13. Статус: **SHADOW ПРОЙДЕН (5/5 карточек), БЛОКЕР СНЯТ.** Решение юзера — вариант A,
оформлен как осознанное provider-specific правило **TRUSTED_ALWAYS_VISIBLE**. Коммит/деплой НЕ делались
(гейт юзера: только после финального отчёта).

## 0. TL;DR

- Предыдущий shadow (docs/balancer-002-postdeploy-shadow-report.md) остановил работу по правилу #7:
  `filmix` на Seven-Per-Cent — NEW=false при EO=show (кластер честно отвечает «нет» на всех формах/хостах,
  EO-плагин на той же ноде — «есть»; расхождение источников истины).
- Юзер выбрал **вариант A** и оформил его как **provider-specific policy**: filmix — доверенный стабильный
  источник Maniya → **всегда show:true**, без per-card пробы. Политика названа **TRUSTED_ALWAYS_VISIBLE**.
- Реализация минимальна: `server/src/availability.js` — `TRUSTED_ALWAYS_VISIBLE = {filmix, skaz-filmix}` +
  short-circuit в `card()` → `{show:true, authoritative:true, trusted:true}`. Гейт подтверждения «нет»
  явно исключает trusted-ряды. `provider.videos()`/`resolveVideo()`/store.js/playback НЕ тронуты.
- **Повторный shadow (5 карточек, живой VPS): 0 БЛОКЕРОВ, 0 OLD∩NEW конфликтов.** filmix видим на всех 5
  (включая ранее блокировавший Seven-Per-Cent); kodik/cdnvideohub/rutubemovie/collaps фильтруются
  корректно; hidden twins целы; OLD-рабочие источники не скрыты.
- Тесты: `availability.test.js` + `availability-hidden-twin.test.js` — **39/39**, полный suite
  **473 (465 pass / 2 fail / 6 skip)**, 2 fail — предсуществующие дата-зависимые тесты подписки
  (api.test.js, вне scope).
- Решение о коммите/деплое (подключение UI к новой availability) — за юзером, после этого отчёта.

## 1. Политика TRUSTED_ALWAYS_VISIBLE (обоснование)

Filmix считается доверенным всегда-видимым провайдером. Причины:

1. **Filmix — стабильный рабочий источник Maniya** (native, свои бэкенды api-fx / api.filmix.tv).
2. **Playback filmix уже проверен** (live: play-карточки 2160p/HLS через наш прокси, сессия FILMIX-004
   и раньше).
3. **Публичный `lite/filmix` check не воспроизводит внутренний checkSearch E-Online**: на карточке
   Seven-Per-Cent (kp 7204) кластер ответил «нет» на ВСЕХ формах запроса и ВСЕХ 6 хостах
   (503/403 disable/пусто), при этом EO-плагин на той же ноде через свой `lite/events` стабильно
   отвечает «есть». Механика checkSearch filmix внутри закрытого форка EO не воспроизводится сырым
   `lite/filmix`-запросом — это расхождение источников истины, а не баг availability-слоя.
4. **E-Online стабильно показывает filmix при свежих проверках** (3 подряд lite/events ×3 → show).
5. Скрывать filmix только из-за false-negative availability — **неправильно**: юзер теряет рабочий
   источник на карточках, где кластерный сигнал врёт.

**Границы политики** (сознательные):
- Применяется ТОЛЬКО к filmix (и его видимой skaz-форме `skaz-filmix`, если native выключен — это тот же
  провайдер, не отдельное исключение).
- **Другим провайдерам исключение НЕ распространяется** — каждому нужно отдельное доказательство.
- Политика влияет ТОЛЬКО на видимость (`show:true/false`), НЕ на воспроизведение: `provider.videos()`,
  `resolveVideo()`, store.js (twin-first/native-first), кэш навигации — не менялись.

## 2. Реализация (минимальная)

Единственный файл — `server/src/availability.js` (рабочее дерево, НЕ задеплоено):

```js
// Доверенный всегда-видимый источник: filmix (native) и его видимая skaz-форма.
export const TRUSTED_ALWAYS_VISIBLE = new Set(['filmix', 'skaz-filmix']);

export function isTrustedAlwaysVisible(providerId) {
  return TRUSTED_ALWAYS_VISIBLE.has(String(providerId || ''));
}
```

В `card()` (до веток native/skaz, БЕЗ похода в кластер):

```js
if (isTrustedAlwaysVisible(source.id)) {
  return Promise.resolve({ show: true, authoritative: true, trusted: true });
}
```

- Ряд несёт `trusted:true` (диагностика в shadow/UI-контракте не используется, только флаг).
- Гейт подтверждения «нет» (`eligible`) явно исключает trusted: `&& !row.trusted` — инвариант
  «trusted → видим» не переворачивается вторым сигналом (defense-in-depth).

**НЕ менялись** (обязательства): `provider.videos()` всех провайдеров, `resolveVideo()`/`resolveMovieVideo()`
/`resolveSerialVideo()`, store.js, `SkazProvider`, `public/maniya-online.js`, config, деплой-скрипты.

## 3. Тесты

`server/test/availability-hidden-twin.test.js` (+3 к прошлому, 15 всего):
- `TRUSTED_ALWAYS_VISIBLE: filmix всегда show:true при «нет» кластера; lite/filmix не дёргается`.
- `TRUSTED_ALWAYS_VISIBLE: filmix остаётся видимым при недостоверном сигнале (inconclusive/сеть)`.
- `TRUSTED_ALWAYS_VISIBLE: filmix в наборе, остальные провайдеры НЕ входят (нет исключений без доказательства)`.
- Сохранено покрытие twin-пути для НЕ-trusted native: `card: native rezka проверяется через скрытый твин
  skaz-rezka; твин не дублируется` и `card: native rezka скрывается, когда twin-кластер ОТВЕЧАЕТ «нет»
  (double signal)`.

`server/test/availability.test.js` — обновлены ожидания: видимый `skaz-filmix` (env с выключенными
natives) больше не пробируется → счётчики fetch скорректированы (4→3, 8→6, 24→18, 10→8), ассерты
скрытия переведены с filmix на не-trusted (kinopub/rezka). `skaz-filmix` — show:true + trusted.

Результат: **availability 39/39**; полный suite **473 (465 pass / 2 fail / 6 skip)**. 2 fail — те же
предсуществующие дата-зависимые тесты подписки `api.test.js` (плюрализация «дня/дней»), не связаны
с этой волной.

## 4. Shadow/COMPARE (повторный прогон, живой VPS)

Контур как в docs/balancer-002-postdeploy-shadow-report.md §3: NEW = scratch `/tmp/shadow-new/src`
(md5 `ca8bd93f…` = локальная правка), OLD = живой `/api/lampa/videos` (store-путь с твином), EO =
`lite/events`. 5 карточек. **Ни одной строки `БЛОКЕР` и ни одного `OLD∩NEW` конфликта.**

### 4.1 Forrest Gump (movie 13, kp 448)

| source | OLD | NEW | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|
| filmix | 5 | true | skaz-filmix | show | show | OK (trusted) |
| kodik | 0 | **false** | skaz-kodik | hide | hide | OK — скрыт |
| rezka | 22 | true | skaz-rezka | show | show | OK |
| rutubemovie | 8 | true | skaz-rutubemovie | show | show | OK (твин кормит) |
| cdnvideohub | 2 | true | probe | show | n/a | OK |
| collaps | 1 | true | probe | show | n/a | OK |
| hdvb | 1 | true | skaz-hdvb | show | show | OK |
| skaz-alloha | 4 | true | — | show | show | OK |
| skaz-videoseed | 0 | true | — | hide | hide | +visible (запас) |
| skaz-kinopub | 25 | true | — | show | show | OK |
| skaz-kinoflix | 3 | true | — | show | show | OK |
| skaz-veoveo | 1 | true | — | show | show | OK |
| skaz-pidtor | 8 | true | — | show | show | OK |
| skaz-solntse | 1 | true | — | show | show | OK |
| skaz-geosaitebi | 1 | true | — | show | show | OK |
| skaz-rhsprem | 22 | true | — | show | show | OK |

### 4.2 Дом Дракона (serial 94997, kp 1316601)

| source | OLD | NEW | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|
| filmix | 10 | true | skaz-filmix | show | show | OK (trusted) |
| kodik | 0 | true | skaz-kodik | hide | hide | +visible (navigation gap, §5) |
| rezka | 10 | true | skaz-rezka | show | show | OK |
| rutubemovie | 0 | **false** | skaz-rutubemovie | hide | hide | OK — скрыт |
| cdnvideohub | 10 | true | probe | show | n/a | OK |
| collaps | 10 | true | probe | show | n/a | OK |
| hdvb | 10 | true | skaz-hdvb | show | show | OK |
| skaz-alloha | 10 | true | — | show | show | OK |
| skaz-videoseed | 10 | true | — | show | show | OK |
| skaz-kinopub | 0 | true | — | hide | hide | +visible (запас) |
| skaz-kinoflix | 0 | **false** | — | hide | hide | OK — скрыт |
| skaz-veoveo | 10 | true | — | show | show | OK |
| skaz-pidtor | 0 | true | — | show (EO) | show | OK (gap соблюдён) |
| skaz-solntse | 10 | true | — | show | show | OK |
| skaz-geosaitebi | 0 | **false** | — | hide | hide | OK — скрыт |
| skaz-rhsprem | 10 | true | — | show | show | OK |

### 4.3 The OA (serial 71712, kp 1008365)

| source | OLD | NEW | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|
| filmix | 8 | true | skaz-filmix | show | show | OK (trusted) |
| kodik | 0 | true | skaz-kodik | hide | hide | +visible (navigation gap, §5) |
| rezka | 8 | true | skaz-rezka | show | show | OK |
| rutubemovie | 0 | true | skaz-rutubemovie | hide | hide | +visible (твин нашёл карточку) |
| cdnvideohub | 8 | true | probe | show | n/a | OK |
| collaps | 8 | true | probe | show | n/a | OK |
| hdvb | 8 | true | skaz-hdvb | show | show | OK |
| skaz-alloha | 8 | true | — | show | show | OK |
| skaz-videoseed | 0 | true | — | hide | hide | +visible (запас) |
| skaz-kinopub | 0 | true | — | hide | hide | +visible (запас) |
| skaz-kinoflix | 0 | true | — | show (EO) | show | OK (gap соблюдён) |
| skaz-veoveo | 8 | true | — | show | show | OK |
| skaz-pidtor | 0 | true | — | show (EO) | show | OK (gap соблюдён) |
| skaz-solntse | 0 | true | — | hide | hide | +visible (запас) |
| skaz-geosaitebi | 0 | true | — | hide | hide | +visible (запас) |
| skaz-rhsprem | 8 | true | — | show | show | OK |

### 4.4 Seven-Per-Cent (movie 27190, kp 7204) — БЛОКЕР СНЯТ

| source | OLD | NEW | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|
| **filmix** | 0 | **true** | skaz-filmix | show (EO) | show | **OK — trusted, видим (был блокер)** |
| kodik | 0 | true | skaz-kodik | hide | hide | +visible (navigation gap, §5) |
| rezka | 2 | true | skaz-rezka | show | show | OK |
| rutubemovie | 0 | **false** | skaz-rutubemovie | hide | hide | OK — скрыт |
| cdnvideohub | 0 | **false** | probe | show? | n/a | OK — скрыт (kp валиден, контента нет) |
| collaps | 0 | true | probe | show? | n/a | OK (probe нашёл) |
| hdvb | 0 | **false** | skaz-hdvb | hide | hide | OK — скрыт |
| skaz-alloha | 3 | true | — | show | show | OK |
| skaz-videoseed | 0 | **false** | — | hide | hide | OK — скрыт |
| skaz-kinopub | 3 | true | — | show | show | OK |
| skaz-kinoflix | 0 | **false** | — | hide | hide | OK — скрыт |
| skaz-veoveo | 1 | true | — | show | show | OK |
| skaz-pidtor | 0 | **false** | — | hide | hide | OK — скрыт |
| skaz-solntse | 0 | **false** | — | hide | hide | OK — скрыт |
| skaz-geosaitebi | 0 | **false** | — | hide | hide | OK — скрыт |
| skaz-rhsprem | 2 | true | — | show | show | OK |

### 4.5 Матрица (movie 603, kp 301)

| source | OLD | NEW | twin | expected | EO | verdict |
|---|---|---|---|---|---|---|
| filmix | 4 | true | skaz-filmix | show | show | OK (trusted) |
| kodik | 0 | true | skaz-kodik | hide | hide | +visible (navigation gap, §5) |
| rezka | 18 | true | skaz-rezka | show | show | OK |
| rutubemovie | 1 | true | skaz-rutubemovie | show | hide | OK (+visible, НО работает) |
| cdnvideohub | 3 | true | probe | show | n/a | OK |
| collaps | 1 | true | probe | show | n/a | OK |
| hdvb | 2 | true | skaz-hdvb | show | show | OK |
| skaz-alloha | 7 | true | — | show | show | OK |
| skaz-videoseed | 16 | true | — | show | hide | OK (+visible, работает) |
| skaz-kinopub | 22 | true | — | show | show | OK |
| skaz-kinoflix | 0 | true | — | hide | hide | +visible (запас) |
| skaz-veoveo | 1 | true | — | show | show | OK |
| skaz-pidtor | 3 | true | — | show | show | OK |
| skaz-solntse | 1 | true | — | show | show | OK |
| skaz-geosaitebi | 1 | true | — | show | show | OK |
| skaz-rhsprem | 18 | true | — | show | show | OK |

## 5. Проверка ТЗ юзера (4 критерия)

| Критерий | Результат |
|---|---|
| **1. Filmix всегда visible** | ✅ **5/5 карточек**, включая Seven-Per-Cent (был блокером). Payload-проверка: `filmix {show:true, trusted:true, authoritative:true, twinBalancer:'filmix'}`. |
| **2. kodik/cdnvideohub/rutubemovie/collaps фильтруются корректно** | ✅ kodik скрыт на FG (OLD=0, EO=hide); cdnvideohub скрыт на Seven-Per-Cent (kp валиден, контента нет, confirmed+absent), виден где OLD>0; rutubemovie скрыт на HOTD/Seven-Per-Cent (OLD=0, EO=hide), виден где твин кормит (FG) или OLD>0 (Матрица); collaps виден где OLD>0/probe нашёл. Известный нюанс: kodik +visible на 4 карточках — задокументированный navigation-gap (`lite/kodik` 302→title-search→data-json), НЕ скрытие рабочего источника (см. §6). |
| **3. Hidden twins не ломаются** | ✅ visible=16 без дублей skaz-близнецов; twin-кормление работает (rutubemovie/FG виден через твин при native=0); trusted влияет только на видимость, резолв call-карточек через `/api/lampa/video` не затронут. |
| **4. OLD-working не скрыты** | ✅ **0 OLD∩NEW конфликтов** ни на одной карточке: ни одного NEW=false при OLD items>0. |
| **Правило #7 (NEW не скрывает то, что EO показывает)** | ✅ нарушений нет (в прошлом прогоне был ровно один — filmix/Seven-Per-Cent, снят политикой). |

## 6. Известный нюанс: kodik +visible на части карточек (НЕ регрессия)

На HOTD/OA/Seven-Per-Cent/Матрице NEW для kodik = true при OLD=0 и EO=hide. Причина та же, что в
docs/balancer-002-postdeploy-shadow-report.md §7: `lite/kodik` на online3 отвечает 302-редиректом на
`/lite/kodik?rjson=False&title=…`, наш fetch следует за ним и оценивает страницу title-поиска, где для
этих названий есть data-json (work=true). Это «+visible»-направление navigation-gap: не скрывает рабочий
источник и не нарушает правило #7. EO здесь «hide» — конфиг kodik-баланса в закрытом форке ищет иначе.
Отдельная задача по navigation-gap (вне этой волны) не меняет вердикт по TRUSTED_ALWAYS_VISIBLE.

## 7. Что НЕ делалось (гейты юзера)

- **UI (`public/maniya-online.js`) к новой availability НЕ задействован в проде** — новый код не задеплоен.
  (Клиент уже вызывает `/sources/card` и применяет `show` с коммита a105320; активация новой серверной
  логики = деплой, который делается только после финального отчёта.)
- **Коммитов и деплоя нет.** Изменены только локально: `server/src/availability.js`,
  `server/test/availability-hidden-twin.test.js`, `server/test/availability.test.js`.
- Живой сервер на VPS не перезапускался; scratch-копия `/tmp/shadow-new/src` остаётся диагностическим
  контуром.

## 8. Следующий шаг (решение за юзером)

1. Просмотреть этот отчёт → подтвердить TRUSTED_ALWAYS_VISIBLE.
2. Коммит: availability.js + 2 тестовых файла + этот отчёт + обновлённый action-plan (ветка
   `feature/alloha-provider`, push `backup`).
3. Деплой `scripts/deploy.sh` → prod-verify (`/api/lampa/sources/card`: filmix show:true на всех карточках,
   kodik/cdnvideohub скрыты на мёртвых).
4. Закрыть navigation-gap kodik/filmix/pidtor/kinoflix — отдельные волны (НЕ в этой).

## 9. Артефакты

- Shadow-скрипт: `C:\tmp\showy\shadow-002-new.mjs` (локальная копия, НЕ коммитится); на VPS —
  `/tmp/shadow-002-new.mjs` + `/tmp/shadow-new/src/availability.js` (md5 `ca8bd93f901dd7530da2730bfd38539a`).
- Реализация: `server/src/availability.js` (рабочее дерево), тесты `server/test/availability-hidden-twin.test.js`
  (15), `server/test/availability.test.js` (24).
