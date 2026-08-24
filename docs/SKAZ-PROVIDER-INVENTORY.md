# SKAZ PROVIDER INVENTORY (runtime `online[]`)

Источник: **фактический Skaz runtime** — `GET http://<host>/lite/events?life=true&account_email=...&uid=...`.
Endpoint возвращает **JSON-массив** (не объект с `.online`): `[{name, url, balanser}, ...]`.
Опросены все 6 сконфигурированных хостов кластера: online3, online8, 94.249.239.63, 94.249.239.37,
94.249.239.11, 77.90.33.109.

Дата сбора: **2026-08-20**. Секреты (account_email/uid) в этом документе **замаскированы**.

## Итог: 37 уникальных провайдеров

| # | balanser | name (отображ.) | хостов | статус в кластере |
|---|----------|-----------------|:------:|-------------------|
| 1 | alloha | Alloha | 5 | PARTIAL_CLUSTER (не на online8) |
| 2 | aniliberty | AniLiberty | 5 | PARTIAL_CLUSTER |
| 3 | anilibria | Anilibria | 5 | PARTIAL_CLUSTER |
| 4 | animebesst | Animebesst | 5 | PARTIAL_CLUSTER |
| 5 | animedia | AniMedia | 5 | PARTIAL_CLUSTER |
| 6 | animelib | AnimeLib | 5 | PARTIAL_CLUSTER |
| 7 | animevost | Animevost | 5 | PARTIAL_CLUSTER |
| 8 | asiage | AsiaGe | 6 | FULL_CLUSTER |
| 9 | dreamerscast | Dreamerscast | 5 | PARTIAL_CLUSTER |
| 10 | eneyida | Eneyida | 3 | PARTIAL_CLUSTER |
| 11 | filmix | Filmix | 4 | PARTIAL_CLUSTER |
| 12 | filmixtv | Filmix | 1 | SINGLE_HOST |
| 13 | fxapi | 🇺🇦 UAkino | 1 | SINGLE_HOST |
| 14 | geosaitebi | Geosaitebi | 5 | PARTIAL_CLUSTER |
| 15 | hdvb | HDVB | 5 | PARTIAL_CLUSTER |
| 16 | kinobase | Kinobase | 6 | FULL_CLUSTER |
| 17 | kinoflix | FilmGE | 5 | PARTIAL_CLUSTER |
| 18 | kinogo | KinoGo | 4 | PARTIAL_CLUSTER |
| 19 | kinopub | KinoPub | 6 | FULL_CLUSTER |
| 20 | kinoteatrkg | Kinoteatr.kg | 5 | PARTIAL_CLUSTER |
| 21 | kinotochka | Kinotochka | 5 | PARTIAL_CLUSTER |
| 22 | lift | Lift ~ 1080p | 1 | SINGLE_HOST |
| 23 | lumex | Lumex | 1 | SINGLE_HOST |
| 24 | lumina | Lumina - 720p | 5 | PARTIAL_CLUSTER |
| 25 | pidtor | SkazTV | 5 | PARTIAL_CLUSTER |
| 26 | redheadsound | Redheadsound | 1 | SINGLE_HOST |
| 27 | remux | iRemux | 6 | FULL_CLUSTER |
| 28 | rezka | Rezka | 5 | PARTIAL_CLUSTER |
| 29 | rutubemovie | Rutube | 5 | PARTIAL_CLUSTER |
| 30 | sakhtv | Lumex | 5 | PARTIAL_CLUSTER |
| 31 | solntse | Солнце | 5 | PARTIAL_CLUSTER |
| 32 | veoveo | VeoVeo | 5 | PARTIAL_CLUSTER |
| 33 | videoseed | Videoseed | 5 | PARTIAL_CLUSTER |
| 34 | vkmovie | VK Видео | 5 | PARTIAL_CLUSTER |
| 35 | xvideocdn | Fanserials | 6 | FULL_CLUSTER |
| 36 | xvideocdn60fps | xVideoCDN (60/120fps) | 5 | PARTIAL_CLUSTER |
| 37 | xvideocdnultra | xVideoCDN (Ultra) | 6 | FULL_CLUSTER |

### Определения статуса
- **FULL_CLUSTER** — balanser объявлен на всех 6 хостах.
- **PARTIAL_CLUSTER** — объявлен на большинстве хостов, но не на всех (обычно отсутствует на online8,
  который обслуживает легаси/kinopub-only подмножество).
- **SINGLE_HOST** — объявлен только на одном хосте (не в общем реестре).

## КРИТИЧЕСКОЕ: отсутствующие в runtime провайдеры

Запрошено 10 обязательных провайдеров TASK-003. Проверка на всех 6 хостах:

| Провайдер | В runtime `online[]`? | Direct `/lite/<balanser>` | Вердикт для Skaz |
|-----------|:---------------------:|---------------------------|------------------|
| videoseed | ✅ (5 хостов) | — | SKAZ_PROVIDER |
| rezka | ✅ (5 хостов) | — | SKAZ_PROVIDER |
| filmix | ✅ (4 хоста) | — | SKAZ_PROVIDER |
| hdvb | ✅ (5 хостов) | — | SKAZ_PROVIDER |
| kinopub | ✅ (6 хостов) | — | SKAZ_PROVIDER |
| alloha | ✅ (5 хостов) | — | SKAZ_PROVIDER |
| veoveo | ✅ (5 хостов) | — | SKAZ_PROVIDER |
| kinotochka | ✅ (5 хостов) | — | SKAZ_PROVIDER |
| **kodik** | ❌ НИГДЕ | `503` | **NATIVE (вне lite-кластера)** |
| **collaps** | ❌ НИГДЕ | `503` | **NATIVE (вне lite-кластера)** |

**Вывод:** Kodik и Collaps — **НЕ lite-балансеры Skaz**. Это **нативные** провайдеры (server-side
resolve, не через `/lite/<balancer>`, не в реестре `online[]`, direct endpoint 503). Для них контракт
паритета в TASK-003 применяется иначе: Skaz не даёт lite-эталон → статус **NATIVE_NON_LITE**
(сравниваем с native Lampac-путь Maniya, не с skaz lite-кластером). Это согласуется с прежними
аудитами: collaps native-only (maniya-arch-audit-001), kodik native (native-kodik-fn-audit-001).

## Сопоставление с 10 обязательными провайдерами TASK-003

| № | Обязательный | Тип в Skaz | Тип в Maniya | Путь Maniya |
|---|--------------|-----------|--------------|-------------|
| 1 | Videoseed | SKAZ_PROVIDER (lite) | skaz-proxy | `skaz-videoseed` (via /lite/videoseed) |
| 2 | Rezka | SKAZ_PROVIDER (lite) | skaz-proxy + native twin | `rezka` native twin + `skaz-rezka` |
| 3 | Filmix | SKAZ_PROVIDER (lite) | skaz-proxy + native twin | `filmix` native twin + `skaz-filmix` |
| 4 | HDVB | SKAZ_PROVIDER (lite) | skaz-proxy | `skaz-hdvb` (via /lite/hdvb) |
| 5 | Kodik | NATIVE | native | `kodik` (native lampac) |
| 6 | Kinopub | SKAZ_PROVIDER (lite) | skaz-proxy | `skaz-kinopub` (via /lite/kinopub) |
| 7 | Alloha | SKAZ_PROVIDER (lite) | skaz-proxy | `skaz-alloha` (via /lite/alloha) |
| 8 | Veoveo | SKAZ_PROVIDER (lite) | skaz-proxy | `skaz-veoveo` (via /lite/veoveo) |
| 9 | Collaps | NATIVE | native | `collaps` (native lampac) |
| 10 | Kinotochka | SKAZ_PROVIDER (lite) | native kinovibe | `kinotochka` (native kinovibe.vip) |

> ⚠ Kinotochka: в Skaz это lite-balanser `/lite/kinotochka`; в Maniya реализован как **native**
> (kinovibe.vip — см. memory KINOTOCHKA-NATIVE-001). Это архитектурное расхождение реализации
> (не контентное) — проверить в matrix, эквивалентен ли результат.

## Хосты без balansers
online8 отдаёт только 10 провайдеров (легаси подмножество + kinopub) — см. memory
BALANCER-ONLINE8-001 (online8 = легаси, обслуживает в осн. kinopub). Это по-дизайну доступности,
не потеря content.

## Метод воспроизведения
```bash
curl "http://online3.skaz.tv/lite/events?life=true&account_email=<REDACTED>&uid=<REDACTED>" \
  -H "Origin: http://lampa.mx" -H "Accept: */*"
```
Ответ — JSON-массив `[{name,url,balanser},...]`.
