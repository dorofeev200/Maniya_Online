# SKAZ-MANIYA-TASK-038 — Real Android empty playback: wire FIRST DIVERGENCE

**Дата:** 2026-08-23. **Среда:** STAGING 95.85.241.121 + реальный Android/Lampa (UA `2109119DG Build/UKQ1.240624.001; wv`, IP 178.173.126.235, учётка dorofeevigor20@gmail.com). **Статус:** ⏳ PHASE 2 завершён (точный запрос/ответ девайса), FIRST DIVERGENCE локализован в CLIENT/UI (или девайсный плеер). ФИКСА НЕТ, PROD НЕ ТРОНУТ.

## Симптом (формулировка задачи)

Карточка открывается и показывает старые PROD-источники → список обновляется на staging → после обновления источники пустые/невоспроизводимые. «Дом Дракона» → KinoPub = «нет видео», хотя серверно (T037) serial=1 → skaz-kinopub → 10 items / 3 сезона / 13 голосов.

## Что реально зафиксировано на wire девайса (nginx STAGING, IP 178.173.126.235)

- Девайс грузил ТОЛЬКО staging-плагин (`/staging/4f3a9c21e7b64d08a5c2f1e9.js`):
  - `window.MANIYA_ONLINE_TOKEN_STAGING="staging-test-4f3a9c21e7b64d08a5c2f1e9"`
  - `MANIYA_API_BASE='http://95.85.241.121/api/lampa'`, COMPONENT `maniya_online_staging`.
- PROD-трафика через staging nginx НЕТ (старые PROD-источники в начале карточки приходят с другого плагина/кэша — см. ниже, это отдельный клиентский феномен).

### A. Девайсный запрос/ответ: «Дом Дракона» → skaz-kinopub (эталон для сравнения)

| Поле | Значение (девайс) | Значение T037 (curl-эталон) | Совпадение |
|---|---|---|---|
| Plugin build | staging `/staging/4f3a9c21e7b64d08a5c2f1e9.js` | тот же staging | — |
| API base | `http://95.85.241.121/api/lampa` | тот же | == |
| Endpoint | `/videos` | `/videos` | == |
| Параметры | `provider=skaz-kinopub`, `id=94997`, `imdb_id=tt11198330`, `title=House of the Dragon`, `original_title`, `year`, `serial=1`, `source`, `token` и др. | то же (serial=1) | == |
| serial | `1` (movie.name → сериал) на КАЖДОМ девайсном запросе HOD | `1` | == |
| Response HTTP | **200** (4 раза; 5-й season=2 также 200) | 200 | == |
| Response JSON | items=10 play / seasons=3 / voices=13 | 10 play / 3 / 13 | == |
| Размер | **4402 B** (md5 f50d6a9e…), season=2 → 3485 B (8 items) | 4402 B (одна и та же md5) | == |
| model | card: **model:true** (8573/8341/9151/8526 B, меняется по времени) | model:true | == |
| первый провайдер | kinopub (index 1) | kinopub | == |
| url/api_url | items: **сырые CDN-url** `https://…ams-static-*.cdntogo.net/hls/…` (DIRECT_PLAYBACK=true); карточка: `url=api_url=/api/lampa/videos?provider=skaz-kinopub` | сырые cdntogo (DIRECT) | == |
| show | kinopub show:true (модель) | show:true | == |
| voices / seasons | 13 / 3 (в модели) | 13 / 3 | == |

Хронология девайсных /videos по HOD (все 200 с тем же содержимым): 15:05:37, 15:09:29, 15:15:37 (другой порядок параметров — второй URL-сборщик на стороне Lampa), 15:17:19; 15:20:53 season=2 → 200/3485B. Т.е. повторные заходы на карточку НЕ дали ни одного пустого/ошибленного ответа.

### В. Что девайс НЕ делал (проверка по чек-листу 12 пунктов)

1. Второй /sources параллельно? — На staging девайс: один плагин (staging). Двойного /sources нет.
2. Повторный /sources/card пустым? — Нет: все card 200 model:true, пустых/ошибочных нет.
3. Смена провайдера после первого ответа? — Нет: provider=skaz-kinopub во всех /videos HOD.
4. serial=0 вместо serial=1? — Нет: serial=1 на каждом HOD-запросе (serial=0 только у фильмов Spider-Man/Мятеж → честный пустой 12 B).
5. Пустой ответ /videos? — Нет: 4402B / 3485B, items>0 везде.
6. /videos по полному пути с девайсными параметрами? — Да, сравнение A выше, байт-в-байт с curl-эталоном (одна md5).
7. Client model/filter дропает items? — Клиентский код draw() рендерит любой items>0; normalizeItems берёт response.items (10 шт.). Проверено чтением кода — фильтры сезона/озвучки строятся из json.voices/json.seasons, reset-пункт канонический.
8. Play URL (direct vs proxy): ЕДИНСТВЕННОЕ отличие staging vs PROD = `DIRECT_PLAYBACK=true` → /videos отдаёт сырые cdntogo URL. PRи включённом direct девайсный плеер играл бы напрямую CDN→клиент, МИМимо нашего nginx; в истории /proxy девайса только vkvideo/alloha (не kinopub). → серверный wire НЕ МОЖЕТ видеть, играется ли девайсом сырой cdntogo URL.

## FIRST DIVERGENCE (по правилу решений из задачи)

`items > 0` на КАЖДОМ девайсном запросе, но UI показывает «нет видео» → по решению задачи это **CLIENT/UI дивергенция (или девайсный плеер)**, НЕ сервер.

Серверный чек-лист отработал чисто: запрос точный, ответ байт-в-байт эталона, provider/сериал/модель стабильны на каждом повторе, пустых ответов нет. Единственное различие staged vs PROD на пути девайса — delivery raw-URL cdntogo под DIRECT_PLAYBACK=true вместо /proxy-wrapped. Оно влияет только на то, ЧТО получает плеер девайса (прямой https-манифест CDN вместо нашего /api/lampa/proxy), и это **не наблюдаемо из нашего nginx** (прямой поток минует нас).

Кандидаты, остающиеся для дискриминации на реальном девайсе:
- C1: девайсный hls.js не декодирует/не играет сырой cdntogo direct-URL (плейбек-дивергенция).
- C2: клиент-рендер/фильтр/кэш Lampa (старый PROD-плагин + staging в одной карточке; PROD-источники в начале карточки — признак того, что PROD-плагин всё ещё установлен и работает параллельно).

## Минимальный managed-эксперимент (staging-only, /proxy НЕ меняется)

Дискриминатор между C1 и C2 — переключение delivery на девайсе:

1. На STAGING: `DIRECT_PLAYBACK=false` (убрать cdntogo.net из `DIRECT_PLAYBACK_ALLOW_HOSTS`), рестарт сервиса → /videos снова отдаёт /api/lampa/proxy-wrapped URL (существующий /proxy не трогаем).
2. Девайс: открыть «Дом Дракона» → KinoPub → play.
3. Наблюдение в staging nginx: появились ли девайсные `/api/lampa/proxy` master+сегментные запросы (UA девайса)?
   - **Запросы /proxy есть и видео играет** → C1 подтверждён: девайс не играл raw-direct; фикс = оставить staging на proxy (direct-first не деплоить на PROD; опционально сузить allowHosts после девайс-проверок).
   - **Запросов /proxy нет, UI по-прежнему пуст** → C2: чистый client/UI (параллельный PROD-плагин / кэш Lampa / фильтр) — тогда дальнейшая работа исключительно клиентская, direct-first методологически ни при чём.

Это управляемый flip, обратимы за минуты, не затрагивает PROD, не трогает существующий /proxy и никакой код. Эксперимент доказывает C1/C2 фактом на девайсе, а не предположением (требование задачи «не предполагать, что проблема в direct-first»).

## Статус
- PHASE 1 «воспроизвести на девайсе» — воспроизведено по логам (карточка меняется, затем пусто).
- PHASE 2 «точный запрос/ответ» — завершён (таблица A).
- PHASE 3/4 «FIRST DIVERGENCE + минимальный фикс» — локализовано в CLIENT/UI|device-player; минимальный эксперимент описан выше, НЕ выполнен (ждёт девайса).
- PHASE 5 «деплой» — нет фикса, деплоя нет.
- PHASE 6/7 «повтор на девайсе + отчёт» — ждут эксперимента.

PROD — HARD STOP, не трогался. Код STAGING не менялся (read-only анализ).