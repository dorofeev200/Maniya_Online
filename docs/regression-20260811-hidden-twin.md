# ROOT CAUSE: «видео не найдено при воспроизведении» (2026-08-11) — скрытый skaz-близнец не резолвится

**Статус: ЗАФИКСИРОВАНО И ЗАДЕПЛОЕНО.** Коммит `9f9daf6`, live-verify 200/200.

## Симптомы пользователя (критическая регрессия)
- На iPhone плагин периодически 404/«пропадает».
- Filmix «видео не найдено / видео повреждено», много-минутная загрузка, играет несколько секунд — и снова загрузка.
- CDNvideo «сегодня перестал находить видео».
- Другие источники стали хуже. «Вчера было заметно стабильнее».

## Баз. линия (задача #15): что изменилось между «вчера» и «сегодня»
Бэкап `maniya-online-pre-lazy-20260811.tar.gz` = вчерашний prod. Diff baseline → current prod:
- **ТОЛЬКО 2 файла**: `SkazProvider.js` (lazy-resolve + nav cache, 356 строк) и `public/maniya-online.js` (12 строк CSS для мобильных). Всё остальное байт-в-байт (index.js/store.js/users.json/nginx — идентичны).

## ROOT CAUSE (задача #18, секции B/D/H)

**Общий отказ нескольких источников** вызван одной строкой логики:

1. Ленивый `movieVideos` (коммит `fa7515b`) отдаёт карточки голосов как `method:"call"` с URL
   `/api/lampa/video?...&provider=skaz-<balancer>` — вместо прежних `method:"play"` (eager, прямой прокси-URL).
   Это работает для ВИДИМЫХ skaz-источников (`skaz-alloha`).
2. Но native-источники (rezka/rutubemovie/hdvb/kodik/filmix…) обслуживаются **СКРЫТЫМ skaz-близнецом**
   (`twin-first` в `store.js`): `/videos?provider=rezka` → `skaz-rezka` → call items с `provider=skaz-rezka`.
3. `getVideoForRequest` искал провайдера только в `registeredProviders()` = **видимые**.
   Скрытый `skaz-rezka` там НЕТ → `provider = null` → **404 `video_not_found` за 2–4 мс** (без единого сетевого запроса).

Живое доказательство (до фикса):
```
/api/lampa/video?provider=skaz-rezka   → HTTP 404 в 0.002s   (скрытый близнец)
/api/lampa/video?provider=skaz-alloha  → HTTP 200 в 0.816s   (видимый источник)
```

Это и есть «видео не найдено при воспроизведении»: discovery источников работал (карточки в списке есть),
а Play валился мгновенно. Вчера было стабильно, потому что eager-`movieVideos` отдавал `method=play`
(прямой URL) — `/api/lampa/video` вообще не вызывался.

### Проверенные НЕ-причины (исключено данными)
- **Аккаунт skaz-кластера НЕ при чём**: prod использует `nazarov6@gmail.com`/`dg4xu2tj` — тот же, что у
  работающего E-Online. Прямой probe `lite/*` с ним отдаёт полные данные (alloha 13KB call, filmix 5KB play, …).
  (Пустой аккаунт → `{"accsdb":true,"msg":"Войдите в аккаунт"}` — 104B, это НЕ наш случай.)
- **Ротация хостов СТАБИЛЬНА**: 20/20 `/videos` 200 (avg 11–27 мс после прогрева), 20/20 raw `getLite` 200 (165–300 мс).
- **Nav cache КОРРЕКТЕН**: кэширует только навигацию (карточки-ссылки). Для call-карточек дескриптор со
  свежими stream-URL перезапрашивается на Play (`resolveVideoJson(card.stream)`); у play-карточек
  подписанные URL живут ~24 ч (voidboost `:YYYYMMDDHH`) ≫ TTL 5 мин.
- **users.json/короткие ссылки плагина НЕ при чём**: реальные плагины юзеров
  (`/dorofeev200_3cfdc9c00227.js`, `/vip-kanal-tvv_207711693970.js`) — 200/41889B у реальных IP.
- **nginx НЕ при чём**: 404 в access.log — только боты (wp-includes/.env/favicon).

## ФИКС (минимальный, `9f9daf6`)
`registry.js`: новый `allProviders()` = native + **ВСЕ** skaz (включая скрытые близнецы).
`store.js` `getVideoForRequest`: поиск по `allProviders()` вместо `registeredProviders()`.
Скрытый близнец резолвит свои call-карточки; видимость в `/sources` не меняется.

Тесты: `registry-twin.test.js` +2 (allProviders включает скрытые; getVideoForRequest резолвит
`provider=skaz-rezka`). Всего **354 pass / 2 skip / 0 fail**.

## Live-verify после деплоя
| Источник | /videos | lazy /video (Play) |
|---|---|---|
| rezka | 11 call | **200** 53 мс, play, voidboost HLS (720/480/360) + мастер 200 |
| rutubemovie | 6 call | **200**, play, «…(2021,4K)» |
| hdvb | 2 call | **200** 37 мс, play, auto |
| skaz-alloha | 9 call | 200 652 мс, play 1080/720/480/360 |
| filmix | 4 play | play 2160p; proxy-стриминг: start+mid-range 206 (~150–175 мс TTFB) |
| cdnvideohub | 1 play | play; мастер→вариант 5.2M→сегмент 200/42 мс |
| collaps / videoseed / veoveo / pidtor / zagonka / geosaitebi | play | — (прямые play-итемы) |
| Юзерские 404 /api/lampa/video за 20 мин после фикса | **0** | |

## Секции A–I (приёмка)
- **A. Плагин 404**: сервер-сторона НЕ воспроизводится — все реальные загрузки плагина 200. Эпизодическое
  «пропадание» = транзиент во время деплоев/рестартов дня (09:16/09:55/11:30/12:20).
- **B. Filmix**: не был затронут скрытым-твин-багом (native play-итемы). С VPS discovery+стриминг здоровы.
  «Повреждено/виснет» — вероятно, title-специфично (известные 403/429 у части тайтлов, memory
  `maniya-script-error-findings`) или в окно регрессии.
- **C. CDNvideo**: сейчас полностью работает (цепочка HLS 200). «Перестал находить» — транзиент сегодня.
- **D. Общий отказ**: ДА, один — скрытый близнец → 404 на /api/lampa/video (rezka/rutubemovie/hdvb + любой
  native-источник с twin-first).
- **E. Ротация хостов**: стабильна (раздел выше).
- **F. Nav cache**: корректен.
- **G. Последний гарантированно стабильный коммит**: pre-lazy baseline = вчерашний prod (eager `method=play`).
- **H. Коммит-виновник**: `fa7515b` (именно lazy-часть `movieVideos`; nav cache и мобильный CSS — ок).
- **I. Минимальный фикс**: `9f9daf6` (2 файла + тесты) — скрытые близнецы резолвятся.

## Остаточные 0-items источники (НЕ регрессия, было и до фикса)
- `kodik` — native, Spider-Man не найден в его каталоге.
- `skaz-kinopub` — 302→follow (Lime), требует follow-схемы.
- `skaz-kinoflix` — кластер отдаёт 503 даже для E-Online-аккаунта (серверная блокировка).
- `skaz-solntse` — link-карточки, требует follow.

## Инструменты диагностики (в `scripts/`)
- `provider-matrix.mjs` — discovery-матрица всех источников + прямой кластерный probe.
- `filmix-chain.mjs` — playback-цепочка filmix/cdnvideohub (master→вариант→init→сегмент, 10 сегментов).
- `host-rotation.mjs` — 20 последовательных /videos + 20 raw getLite с ротацией.
- `mobile-card-probe.mjs` — E2E provider + lazy + Alloha 1080p.
