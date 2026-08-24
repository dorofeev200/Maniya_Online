# SKAZ-MANIYA-TASK-007 — Playback Pipeline Parity / HLS Differential Audit

**Дата:** 2026-08-21. **Режим:** READ-ONLY, прод не менялся. **Билд:** b1f98f8c.
**Источник:** Filmix «История игрушек 5» Дубляж [4K,SDR,ru,MovieDalen] → **nl105.cdnsqu.com** (item0).

## ROOT CAUSE
m3u8 `index.m3u8?hash=<95ch>` (sid/токен CDN) выставляется только на плейлисте; seg-URI в плейлисте — **абсолютные, БЕЗ hash**. CDN ключует по `hash` на каждый ресурс → каждый фрагмент = HTTP **403** → hls.js **fatal `[fragLoadError]`**. Доказано 30/30 = 403 (в т.ч. матрицей заголовков: none/self/filmix.my/filmix.gg/lampa.mx/UA Lampa/Range — все 403, ключ = hash, не заголовки). С полным hash: сегмент 200 video/MP2T (0x47 MPEG-TS).

## SKAZ
Skaz/lampa filmix фильмы = **прогрессивный MP4 напрямую с CDN** (`pl-cdn.werkecdn.me/…_2160.mp4`, `method:"play"`; реф raw/filmix.movie.html). HLS не участвует → фрагментный слой вообще не задействован.

## MANIYA
`/videos` → item `{method:'play'}` → streamProxy(m3u8+hash) → rewirteHlsManifest переписывает seg→`/api/lampa/proxy?url=<seg>` **без переноса hash** → CDN 403.

## FIRST DIVERGENCE
1. Тип артефакта: Skaz=MP4 (1 запрос), Maniya=HLS (фрагменты) — на этапе video-links.
2. **Фрагментный слой: seg-URI без hash в rewritten-манифесте** → 403 (это первый *функциональный* разрыв у Maniya; у Skaz этого слоя нет).

## WHY FRAGLOADERROR
После выбора источника Maniya гонит фрагменты через прокси с URL seg без `?hash=`; nl105.`verkecdn` отдаёт 403-HTML (non-video) → hls.js считает чанк битым → fatal fragment load error → «видео не играет», тогда как у Skaz MP4-URL (внутри часто werkecdn с уже прописанным токеном в пути) отдаёт 200 сразу.

## MINIMAL FIX (НЕ применён — только локально)
`proxy.js rewriteHlsManifest/rewriteDirectiveUri`: при пустом query у seg-URI добавлять hash из query базового m3u8-URL (baseUrl.searchParams в rewrite). Идемпотентно для werkecdn (где hash уже в seg). Т.е. `resolveSegmentUrl`+makeProxy c наследованием `?hash=` плейлиста.

## REGRESSION TEST (предложение, НЕ применено)
Proxy-rewrite unit: (1) seg без query + m3u8 с hash → url получает тот же hash; (2) seg уже с hash → без изменений; (3) относительный seg → резолвится и получает hash; (4) m3u8 без hash → без изменений. + дифференциальный прогон Skaz-vs-Maniya на этом же тайтле. Затем bench 10× и отдельный shadow-деплой.

## DATA
- m3u8: 200, 1-level, ~10+ seg, все seg абсолютные без hash.
- seg0 as-playlisted: 403 все вариации. seg0+hash: 200/206, content-type video/MP2T, 0x47.
- Werkecdn-аналог (item2 HDR10+): seg несёт свой hash → 200 as-playlisted (не регрессия).
- MP4+hash Range → 400 (hash — только для HLS-сегментов).
- Через ПРОД-прокси: P1(no-hash) 403 html 548B; P2(+hash) 206 video/MP2T Range 1024B; seg#2 +hash 200 23MB.

## ФИНАЛ
Код не менялся. TASK-008 отчёт: `docs/SKAZ-MANIYA-TASK-008-VPS-NETWORK-PLAYBACK-AUDIT.md` (root cause F: Лег1 клиент→VPS; VPS/CDN/proxy исключены; PRODUCTION CHANGE: NONE).