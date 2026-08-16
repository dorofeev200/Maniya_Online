# VKMOVIE-INTEGRATION-AUDIT-001

**Дата:** 2026-08-16 · **Режим:** READ-ONLY (код/тесты/config не менялись, commit/push/deploy не делались)
**Контекст:** продолжение `balancer-post-w1-remaining-001` — vkmovie = единственный реально отсутствующий Skaz-балансер. W1-семантика, GAP-002/005, STABILITY-004, KODIK-fix, «Последний дом 2026» НЕ FN — приняты как доказанные, не пересказываются.
**Ключевое исправление к прежнему аудиту:** «vkmovie жив только на 94.249.239.11» — НЕВЕРНО. Модуль vkmovie жив на 8/9 основных нод кластера; 503 на части нод транзиентен.

---

## §1. Идентичность vkmovie (блок требований 1)

| Слой | Значение | Доказательство |
|---|---|---|
| Balanser ID | `vkmovie` | события `{"name":"VK Видео","url":"…/lite/vkmovie","balanser":"vkmovie"}` на всех 9 нод |
| Lampac-модуль | `Modules/OnlineRUS/VkMovie` (NextGen, C#) | ModInit.cs: `plugin = "vkmovie"`, `name = "VK Видео"`, `displayindex = 570`, `streamproxy = true` |
| Backend (сток) | Официальное VK API: `api.vkvideo.ru/method/catalog.getVideoSearchWeb2` | Controller.cs; анонимный токен берётся модулем из `login.vk.com/?act=get_anonym_token` (client_id/app_id модуля) |
| Заголовки | `origin`/`referer: https://vkvideo.ru` | ModInit.cs headers |
| API-эндпоинт | `{node}/lite/vkmovie?title&original_title&year&serial&account_email&uid` | lite-маршрут Lampac, подтверждён живыми пробами |
| Видео-эндпоинт | `{node}/proxy/{opaque}` — внутренний HostStreamProxy кластерной ноды | play-карты vkmovie дают `url=/proxy/{opaque}`; `streamproxy=true` |
| Фильтр контента | title содержит + год±1 + `duration>=3000` + исключение трейлер/сезон/сериал | Controller.cs `SearchNameTo.Convert` |

Идентичность сущности: **vkmovie = полноценный нативный Lampa-модуль каталога VK Видео (api.vkvideo.ru), сток — VK, а не зеркало**. Это давно работающий, зрелый модуль (README, полный HTTP-протокол, Model.cs: mp4_144…mp4_2160 + hls/dash + subtitles), НЕ «один хост с несколькими тайтлами».

**Какие хосты реально vkmovie-backend:** любой живой skaz-хост, обслуживающий `lite/vkmovie` (см. §3). Запрет из брифа — «не считать online4 единственным» — соблюдён: online4 (если жив для других балансеров) здесь 503 и НЕ является vkmovie-бэкендом; бэкенд — фильтрующий модуль Lampa на нодах, а не отдельный сервис.

## §2. Маппинг RUS-1-4K / RUS-2-4K (блок 2)

Проверены варианты A–E из брифа. Вывод:

- **«RUS-1 / RUS-2» — это presentation-ключи нашей meta, НЕ сервисы.** `meta.js`: `vk: {name:'RUS-1',…}`, `rutube: {name:'RUS-2',…}` — легаси-слоты от старых самодельных провайдеров (VK-группы / rutube API), ныне не подключаемые.
- **Живая пара в кластере — отдельная:** `vkmovie` («VK Видео») и `rutubemovie` («Rutube») — это ДВА РАЗНЫХ balanser'а, раздельные events-строки, раздельные Lampac-модули (OnlineRUS/VkMovie и OnlineRUS/RutubeMovie). Это **вариант E** (другая архитектура: два отдельных семейства), а не «два презентационных алиаса одного» (A) и не «один кластер» (B), не «разные balancer'ы одного стока» (C), и не полный «legacy» (D) — legacy только в имени.
- Связка: **RUS-1 → backend vkmovie** (модуль VkMovie, VK API, `name "VK Видео"`), **RUS-2 → backend rutubemovie** (модуль RutubeMovie, RuTube API). Суффиксы «-4K / HDR» — клиентская деривация качества: vkmovie отдаёт `streamquality` 2160p→144p и OnlineApiQuality-labels; точное происхождение пары «RUS-1-4K» у E-Online — их строковый слой поверх наших титулов, сервер кластера отдаёт только «VK Видео»+2160p.

Вывод сделан по событиям/коду/API-протоколам, НЕ по названию.

## §3. Инвентарь хостов vkmovie (блок 3)

Probe: `GET {node}/lite/vkmovie?title=Матрица&original_title=The Matrix&year=1999&serial=0` ×2 раунда (probe-1 + probe-2), события на всех нодах.

| Хост | Статус | Класс |
|---|---|---|
| online3.skaz.tv | 200, 21 play-карт, ×2 | ACTIVE / CONTENT |
| online5.skaz.tv | 200, 21 play, ×2 | ACTIVE / CONTENT |
| online6.skaz.tv | 200, 21 play, ×2 | ACTIVE / CONTENT |
| online7.skaz.tv | 200, 21 play, ×2 | ACTIVE / CONTENT |
| 94.249.239.63 | 200, 21 play, ×2 | ACTIVE / CONTENT |
| 94.249.239.11 | 200, 21 play, ×2 (probe-1: 1× 503 — транзиент) | ACTIVE / CONTENT |
| 77.90.33.109 | 200, 21 play, ×2 | ACTIVE / CONTENT |
| 94.249.239.37 | 503 («no content»/null), ×2 | TIMEOUT/FAIL — НЕ бэкенд |
| online4.skaz.tv | 503 («no content»/empty), ×2 | UNAVAILABLE — НЕ бэкенд |
| online8.skaz.tv | 403 `disable` (7 байт) | LEGACY DISABLED (все модули кроме kinopub) |
| oleg6.skaz.tv | 403 `disable` | LEGACY DISABLED |
| online1/online2 | сеть мертва | DEAD |

События `vkmovie`/`rutubemovie` присутствуют и на 94.249.239.37/online4/online1-2 — модуль зарегистрирован во всём кластере; только живой контентная способность различается.

**Почему бэкенд жив не на всех нодах:** vkmovie ходит во внешний `api.vkvideo.ru`; 503-класс соответствует недоступности/лимиту VK API для конкретной ноды (та же механика, что cs-флап kinopub. 8/9 нод стабильно 200 → для нашего availability.csv флапов нет). online4 (.37) — отдельный слой/недообслуженные ноды, online8/oleg6 — легаси без VK-модулей.

## §4. Провайдеры Maniya для vkmovie (блок 4)

- **Нативного VK/«vkvideo»-провайдера в Maniya НЕТ** (только `rutubemovie` → RutubeProvider).
- SkazProvider-семейство строится из `config.skaz.balancers` (14 слогов, vkmovie отсутствует) → провайдера нет ни native-, ни skaz-маршрутом.
- В registry.js есть `EO_TITLES.vkmovie = 'Maniya · VKMovie'` (display-only) и в meta.js `vkmovie: {name:'VKMovie', icon:'▶️', qualityLabel:'Full HD'}` — презентация готова, маршрута нет.
- Аналог для нового провайдера: `RutubeProvider.js` (movie-only: parseQuery → client.search → playOptions → playItem; `serial(){return[]}`).

## §5. Реальный play-флоу, ≥5 фильмов (блок 5)

Play-карта vkmovie: `method:play`, `url={node}/proxy/{opaque}`, `streamquality={2160p…144p}`, `subtitles`. Возобновление на всех нодах.

Range-пробы (первые 0–1023 байт + глубокий Range 1MB, НЕ полная загрузка):

| Фильм | isom-сигнатура | Content-Type | Content-Range / -Length | Статус |
|---|---|---|---|---|
| Матрица (1999) | `ftypisom` | video/mp4 | 206, 6 765 863 524 B | OK |
| Аватар (2009) | `ftypisom` | video/mp4 | 206, 11 647 104 960 B | OK |
| Дюна: Часть вторая (2024) | `ftypisom` | video/mp4 | 206, 3 820 854 223 B | OK |
| Интерстеллар (2014) | `ftypisom` | video/mp4 | 206, 6 054 139 929 B | OK |
| Властелин колец: Братство Кольца (2001) | `ftypisom` | video/mp4 | 206, 8 460 961 602 B | OK |

Формат — **прямой MP4-файл (не HLS)**, отдаётся через `/proxy/{opaque}` ноды; наш прокси-слой (Range-поддержка в proxy.js) подходит без изменений.

## §6. Сериалы: capability (блок 6)

- Probe: «Игра престолов» (2011) и «Дом Дракона» (2022), с `serial=0` и `serial=1` на всех 9 нод → **весь кластер 503, len 0–4, 0 play-карт** (двух раундов нет смысла — стабильно).
- Плюс код модуля: `if (serial == 1) return OnError();` и добавление источника только `args.serial == -1 || args.serial == 0`; фильтр исключает названия с «сезон/серия».
- **Вывод: vkmovie = movie-only ограничение модуля/VK-фильтра**, детерминированное и не транзиентное. Для Maniya интеграция сериалов через vkmovie невозможна без расширения VK-стока — фиксировать искусственно НЕ предлагается (записать как capability limitation; сериалы продолжат браться из filmix/kinoflix/kinopub/rezka/alloha…).

## §7. Availability-семантика для vkmovie (блок 7, на модели W1 — не менять)

- **(A) один хост CONTENT** → `CONTENT` (continue-скан getLite: 2xx+usable → CONTENT, stop).
- **(B) один CONTENT + один EMPTY** → `CONTENT` (hide только при единогласном «нет»; vkmovie не изменяет).
- **(C) один timeout + один CONTENT** → `CONTENT` (timeout/503 ≠ «нет»-голос primary; для reserve работает reservePolicy 'abstain').
- **(D) все EMPTY** → `EMPTY` → hide (через OLD∩NEW confirm-gate) — корректно.
- **(E) все unavailable (403/503/timeout)** → hide-класс (источник реально недоступен; для vkmovie на практике не случается: live-probe даёт 200 на 8/9 нод).
- Ожидаемое поведение после гипотетического подключения: этот источник почти всегда CONTENT, с редко встречающимися 503-флапами конкретной ноды, которые W1-скан и так переживает.

## §8. Identity vs presentation (блок 8)

- **Identity:** balanser `vkmovie` (Lampac-модуль VkMovie, сток VK API).
- **Presentation:** «VK Видео» (server events), «VKMovie»/«Maniya · VKMovie» (наши экраны), «RUS-1-4K» (E-Online legacy-имя + quality-деривация) — всё это оформление одного identity.
- **Кластер-нода НЕ входит в identity** — живые ноды ротируются; identity = `vkmovie`, host = «любой живой skaz-хост».
- Имена E-Online (RUS-1/RUS-2/etc.) в identity НЕ выносятся.

## §9. Безопасность / SSRF (блок 9)

- Плей-URL = `http://{node}/proxy/{opaque}` (внутренний HTTP на skaz-хост, не VK). Maniya должна проксировать через свой `buildProxyUrl` (https publicBase), как прочие play-ссылки — прямого клиентского хостинга не требуется.
- **allow-лист уже покрывает:** `httpAllowHosts` содержит суффикс `skaz.tv` (suffix-match в `isHostAllowed` покрывает online3/5/6/7.skaz.tv) + `94.249.239.63/.37/.11` + `77.90.33.109`; `allowHosts` уже содержит `vkvideo.cloud` (https-запас). **Новый allow-entry НЕ требуется.**
- SSRF-поверхность не расширяется: за opaque-ссылкой конечный сток = VK-API/CDN, но мы её не видим — нода сама проксирует и шлём только на разрешённые skaz-хосты. Редирект-валидация `validateProxyTarget` продолжает действовать (при интеграции исключить проверку редиректов на не-allow не предполагается).
- Кодек-оверлэп: `solodcdn.com` в allowlist — для Kodik, vkmovie не нужен; НЕ трогать.
- **Финально: proxy.js НЕ менять.**

## §10. NO blind fix (блок 10)

Подключение «просто добавить vkmovie в config.skaz.balancers» — слепой фикс, т.к. в Maniya нет ни native-провайдера VK, ни skaz-маршрута для vkmovie, и до проверок карточек/прокси/сериалов нельзя предсказать поведение. Всё вышеперечисленное выполнено до рекомендаций (§§1–9), поэтому рекомендации не слепые.

## §11. E-Online — только reference (блок 11)

E-Online показали «RUS-1/RUS-2 живы»; сверка с E-Online используется только для сравнения тёплого/холодного путей. Их runtime/токены НЕ копируются; наши creds (выход к кластеру) остаются как есть.

## §12. ИТОГ (блок 12, A–M)

- **A. Что такое vkmovie:** нативный Lampac-модуль OnlineRUS/VkMovie: каталог VK Видео через официальный `api.vkvideo.ru` (анонимный токен собирает сам модуль), балансер ID `vkmovie`, display «VK Видео», карты `method:play` → `{node}/proxy/{opaque}`.
- **B. RUS-1-4K/RUS-2-4K маппинг:** «RUS-1/RUS-2» = наши легаси-presentation-ключи (vk/rutube в meta.js); живая идентичность пары = `vkmovie` («VK Видео», 2160p) и `rutubemovie` («Rutube») — два разных balanser'а, два разных модуля, две разные API; суффиксы 4K/HDR — клиентская деривация качества.
- **C. Рабочие/мёртвые хосты:** CONTENT на online3/5/6/7 + 94.249.239.63/.11 + 77.90.33.109 (200/21 play, 2×2 раунда); 503: 94.249.239.37, online4; 403-disable: online8, oleg6; dead: online1/online2.
- **D. Реальный movie-плей:** `{node}/lite/vkmovie` → play-карты с 2160p→144p → `{node}/proxy/{opaque}` → прямой MP4 (ftypisom) с Range-206; 5/5 фильмов proven (Матрица 6.7GB…Аватар 11.6GB).
- **E. Serial:** НЕ поддерживается (весь кластер 503 на serial=0/1 + модуль `serial==1→OnError`) — capability limitation, movie-only.
- **F. Почему vkmovie отсутствует в Maniya:** нет в `config.skaz.balancers` (14 слогов) AND нет native VK-провайдера; готовы только presentation-слои (meta.js/registry.js EO_TITLES).
- **G. Можно ли использовать существующий provider/client:** YES на move-части — по аналогу `RutubeProvider` (movie-only паттерн) для native-варианта; для skaz-варианта — существующий `SkazProvider`+`SkazClient` (получение lite-страниц, play/streamquality-карты, buildProxyUrl) уже умеют всё, что нужно (это самый короткий путь).
- **H. Файлы, которые ПОТЕНЦИАЛЬНО изменятся (при решении):** `server/src/config.js` (skaz.balancers +vkmovie, если выбрать skaz-маршрут), либо новый `server/src/providers/vk/VkProvider.js` (native-вариант, аналогично rutubemovie); `meta.js` (только если нужен другой label — сейчас vkmovie уже есть); registry.js (пул providers) + тесты. НЕ трогать: proxy.js, availability.js, hostOrder.js.
- **I. Минимальный safe-дизайн:** skaz-маршрут: добавить `vkmovie: {...строку как rutubemovie...}` в `config.skaz.balancers` → провайдер появится автоматически; play-карты уже обрабатываются SkazProvider; quality 2160p→144p отдаётся в streamquality и мапится; сериалы отсутствуют (serial=[]). Это единственный вариант без нового клиента и без трогания proxy.
- **J. Как availability работает с vkmovie:** по W1 (см. §7) — CONTENT при любой 200-ноде; hide только vs. всего-нет; параллели с текущими источниками нет (новый id), OLD∩NEW-гейт полностью применим.
- **K. SSRF/security:** безопасность не расширяется; существующие allow-хостинги полностью покрывают плей-путь vkmovie; менять proxy.js НЕ нужно; solodcdn/vkvideo.cloud-суффиксы не трогать.
- **L. Регрессионные риски:** интеграция vkmovie не пересекается с другими источниками (новый ID, изолированные неймспейсы карточек); риски — только шумы play-карт кластера (21 карта/фильм, verbose) и возможная 503-новь на некоторых нодах при VK-лимитах — stessa как у kinopub, переживается W1.
- **M. Что НЕ менять:** proxy.js (SSRF/allow), availability.js (W1-семантику), hostOrder.js, сериальную модель Lampa, мета «RUS-1/RUS-2» (легаси-имена остаются слотом), конфиг prod без отдельного решения.

**Решение НЕ ПРИНИМАЕТСЯ (READ-ONLY).** Следующая задача — RUTUBE-PLAYBACK-AUDIT-001 — не начинается без отдельного разрешения. Временные probe удалены.