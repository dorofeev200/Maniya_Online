# SKAZ-MANIYA-PROVIDER-MATRIX

TASK-SKAZ-MANIYA-004 (§16-18) — финальная классификация провайдеров Skaz→Maniya через единый
balancer. Сверхзадача: **SAME INPUT → SAME/EQUIVALENT RESULT** (если Skaz даёт работающий источник,
Maniya обязан дать работающий эквивалент).
Дата: **2026-08-20**. Метод: локальный прогон + VERIFY-ON-VPS (shadow, read-only) +
benchmark + cross-query. **DEPLOY/COMMIT/PUSH = ЗАПРЕЩЁН (не выполнено).**

> ⚠ Арх-детерминированность: Kodik/Collaps — **native** в Skaz (вне lite-кластера, `/lite/*`=503).
> Rezka/Filmix/Kinotochka — native-близнецы/эквиваленты (Skaz lite-балансер ↔ Maniya native). Это
> контентный-паритет, не совпадение URL.

## Финальная классификация (37 провайдеров runtime `online[]`)

Легенда:
- **SKAZ_LITE** — skaz lite-кластерный балансер, Maniya подключает через `skaz-<name>` (унифицированный balancer).
- **NATIVE** — провайдер реализован как native (Lampac-путь), в Skaz тоже native или эквивалент.
- **NATIVE_TWIN** — native-провайдер Maniya, у которого есть скрытый skaz-близнец (`twinFor`), фоллбэк.
- **IMPLEMENTED** — контентный паритет доказан локально/VPS (discovery→resolve→stream).
- **PARTIAL** — источник есть, но с ограничениями (не вся линейка контента / upstream-гейты).
- **REFERENCE_NO_SOURCE** — и Skaz, и Maniya дают 0 работающих источников (честный upstream-refusal).
- **UNKNOWN** — провайдер не в конфиге Maniya (не подключён), требует отдельной оценки.

| # | Balanser | Skaz-тип | Maniya-тип | Balancer-путь | Discovery | Resolve | Stream | Playback | Классиф. |
|---|----------|----------|-----------|---------------|-----------|---------|--------|----------|----------|
| 1 | alloha | SKAZ_LITE | SKAZ_LITE | `skaz-alloha` | 4 items | call→CDN | vkvideo HLS | 206 (VPS+loc) | **IMPLEMENTED (SKAZ_LITE)** |
| 2 | aniliberty | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN (не в конфиге) |
| 3 | anilibria | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 4 | animebesst | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 5 | animedia | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 6 | animelib | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 7 | animevost | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 8 | asiage | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 9 | dreamerscast | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 10 | eneyida | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 11 | filmix | SKAZ_LITE | NATIVE_TWIN | `filmix` (+`skaz-filmix`) | 9 items(VPS) | play→CDN | werkecdn/cdnsqu MP4+HLS | 206 (VPS) | **IMPLEMENTED (NATIVE_TWIN)** |
| 12 | filmixtv | SKAZ_LITE (single-host) | — | — | — | — | — | — | UNKNOWN (отдельный, не 10 обязательных) |
| 13 | fxapi | SKAZ_LITE (single-host) | — | — | — | — | — | — | UNKNOWN |
| 14 | geosaitebi | SKAZ_LITE | SKAZ_LITE | `skaz-geosaitebi` | 5 items | — | — | — | **IMPLEMENTED (SKAZ_LITE)** * |
| 15 | hdvb | SKAZ_LITE | NATIVE_TWIN | `skaz-hdvb`/`hdvb` | 1 item (loc) | call→`/proxy` | /proxy m3u8 | 206 | **IMPLEMENTED (SKAZ_LITE/NATIVE_TWIN)** |
| 16 | kinobase | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 17 | kinoflix | SKAZ_LITE | SKAZ_LITE | `skaz-kinoflix` | 2 items | seg MP4-RANGE | — | 206 | **IMPLEMENTED (SKAZ_LITE)** |
| 18 | kinogo | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 19 | kinopub | SKAZ_LITE | SKAZ_LITE | `skaz-kinopub` | 14/25 items | play→CDN | cdntogo HLS | 206 | **IMPLEMENTED (SKAZ_LITE)** |
| 20 | kinoteatrkg | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 21 | kinotochka | SKAZ_LITE | **NATIVE kinovibe** | `kinotochka` | 1 item(VPS) | play→MP4 | kinovibe MP4 | 206 | **IMPLEMENTED (NATIVE, эквивалент)** |
| 22 | lift | SKAZ_LITE (single-host) | — | — | — | — | — | — | UNKNOWN |
| 23 | lumex | SKAZ_LITE (single-host) | — | — | — | — | — | — | UNKNOWN |
| 24 | lumina | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 25 | pidtor | SKAZ_LITE | SKAZ_LITE | `skaz-pidtor` | 0 (торрент-descr) | — | — | — | **PARTIAL (UPSTREAM TorrServer-гейт)** |
| 26 | redheadsound | SKAZ_LITE (single-host) | — | — | — | — | — | — | UNKNOWN |
| 27 | remux | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 28 | rezka | SKAZ_LITE | NATIVE_TWIN | `rezka` (+`skaz-rezka`) | 10 items ser (VPS) | play→m3u8 | HLS seg | 206 (VPS) | **IMPLEMENTED (NATIVE_TWIN) ser; movie by-design empty** |
| 29 | rutubemovie | SKAZ_LITE | NATIVE_TWIN | `rutubemovie` (+`skaz-`) | — | — | — | — | **IMPLEMENTED (NATIVE_TWIN)** * |
| 30 | sakhtv | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 31 | solntse | SKAZ_LITE | SKAZ_LITE | `skaz-solntse` | 2 items | seg MP4-RANGE | — | 206 | **IMPLEMENTED (SKAZ_LITE)** |
| 32 | veoveo | SKAZ_LITE | SKAZ_LITE | `skaz-veoveo` | 10 items | play→CDN | rstprgapipt HLS | 206 | **IMPLEMENTED (SKAZ_LITE)** |
| 33 | videoseed | SKAZ_LITE | SKAZ_LITE | `skaz-videoseed` | 10-16 items | call→`/proxy` | /proxy m3u8 | 206 | **IMPLEMENTED (SKAZ_LITE)** |
| 34 | vkmovie | SKAZ_LITE | SKAZ_LITE | `skaz-vkmovie` | — | — | — | — | **IMPLEMENTED (SKAZ_LITE)** * |
| 35 | xvideocdn | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 36 | xvideocdn60fps | SKAZ_LITE | — | — | — | — | — | — | UNKNOWN |
| 37 | xvideocdnultra | SKAZ_LITE | SKAZ_LITE | `skaz-xvideocdnultra` | 2 items | — | — | — | **IMPLEMENTED (SKAZ_LITE)** * |

\* = подтверждено в более ранних TASK-003/проверках и/или memory (PROD-VERIFIED релизы) — см.
inventory и память (vkmovie, rutubemovie, kinoflix, solntse, geosaitebi, xvideocdnultra).

**Счёт (37):**
- **IMPLEMENTED (SKAZ_LITE)**: alloha, geosaitebi, hdvb, kinoflix, kinopub, solntse, veoveo, videoseed,
  vkmovie, xvideocdnultra = **10** (skaz-путь).
- **IMPLEMENTED (NATIVE / NATIVE_TWIN)**: filmix, kodik, collaps, kinotochka, rezka, rutubemovie, hdvb =
  счёт не пересекается с skaz-путём (hdvb задваивается) — учтено в разделе «10 обязательных» ниже.
- **PARTIAL**: pidtor (только торрент-descriptor, stream за TorrServer-гейтом — UPSTREAM), rezka
  (movie by-design empty «For Serial»), filmix (1 stale-CDN дорожка из многих).
- **REFERENCE_NO_SOURCE**: collaps (native 422 на SE-egress — honest upstream-refusal)*.
- **UNKNOWN (не подключён в Maniya)**: aniliberty, anilibria, animebesst, animedia, animelib, animevost,
  asiage, dreamerscast, eneyida, filmixtv, fxapi, kinobase, kinogo, kinoteatrkg, lift, lumex, lumina,
  redheadsound, remux, sakhtv, xvideocdn, xvideocdn60fps = **22**.
  → Это вне scope 10 обязательных; требование TASK-004 — классифицировать (не обязательно реализовывать).
  Они перечислены как UNKNOWN (Skaz даёт lite-балансер, но Maniya не подключал — нет заявленного
  обязательства, кроме перечня/config, см. §18 отчёта).

\* collaps классифицирован REFERENCE_NO_SOURCE **на этом VPS-egress** (SE-гейт embed-хоста), при
этом известно (COLLAPS-EGRESS-001), что с другого региона egress (VPN) тот же CollapsClient даёт
200+playable HLS 12/12 → это region-зависимый upstream-refusal, НЕ отсутствие источника в каталоге.

## VERIFY-ON-VPS: 4 обязательных (TASK-003, закрыты в TASK-004)

| Provider | Skaz-тип | Maniya-тип | VPS (shadow) discovery | resolve | stream | playback | Вердикт |
|----------|----------|-----------|------------------------|---------|--------|----------|---------|
| **rezka** | SKAZ_LITE (lite) | NATIVE_TWIN | items=10 ser | play | m3u8 | seg 206 sig47✓ | ✅ **PASS** (ser; movie by-design empty) |
| **filmix** | SKAZ_LITE (lite) | NATIVE_TWIN | items=9 | play | werkecdn/cdnsqu MP4 | 206 (8/9 дорожек) | ✅ **PASS** (item[0]=stale-CDN 404) |
| **kinotochka** | SKAZ_LITE (lite, rch/WS-only) | **NATIVE kinovibe** | items=1 | play | MP4 | 206 video/mp4 | ✅ **PASS** (native эквивалент) |
| **collaps** | NATIVE | NATIVE | items=0 | — | — | 422 | ✅ честный **REFERENCE_NO_SOURCE** (SE-egress) |

Детали и безопасные trace: `docs/SKAZ-MANIYA-TASK-004-VPS-TRACES.md`.

## 10 обязательных — итог TASK-004

| № | Обязательный | Skaz | Maniya | FINAL |
|---|--------------|------|--------|-------|
| 1 | Videoseed | lite | `skaz-videoseed` | ✅ IMPLEMENTED |
| 2 | Rezka | lite | native twin | ✅ IMPLEMENTED (ser) |
| 3 | Filmix | lite | native twin | ✅ IMPLEMENTED |
| 4 | HDVB | lite | skaz/native | ✅ IMPLEMENTED |
| 5 | Kodik | **native** | native | ✅ IMPLEMENTED (native) |
| 6 | Kinopub | lite | `skaz-kinopub` | ✅ IMPLEMENTED |
| 7 | Alloha | lite | `skaz-alloha` | ✅ IMPLEMENTED |
| 8 | Veoveo | lite | `skaz-veoveo` | ✅ IMPLEMENTED |
| 9 | Collaps | **native** | native | ✅ REFERENCE_NO_SOURCE (SE-egress, honest) |
| 10 | Kinotochka | lite (rch/WS) | **native kinovibe** | ✅ IMPLEMENTED (эквивалент) |

> ⚠ Kinotochka: в Skaz lite-балансер `/lite/kinotochka` существует, но **rch/WS-only** (REST не
> играет — см. memory KINOTOCHKA-NATIVE-001, TASK-SOURCES-005 rch-гейт `{"rch":true}`). Maniya
> реализует native kinovibe.vip → прямой MP4 (Range-206). Это **архитектурный эквивалент**, НЕ
> ошибка (TASK-004 §4: "native путь — не автоматически ошибка").
> Kodik/Collaps — native в Skaz (вне lite); Maniya native — паритет по native-пути, НЕ по lite.

## Сводка статусов (TASK-003 → TASK-004)
- **PASS** — discovery→balancer→source→resolve→stream доказан (локально и/или VPS).
- **REFERENCE_NO_SOURCE** — и Skaz, и Maniya честно не дают работающий источник на данном egress
  (collaps SE-422; pidtor TorrServer-гейт).
- **UNKNOWN** — balanser есть в Skaz runtime, но не в scope/конфиге Maniya (не обязательный).
