# RELEASE-PLAYBACK-GAP-001 — релиз доводки FINAL-PLAYBACK-GAP-001

**Дата:** 2026-08-18 · **Wave:** RELEASE (только изменения FINAL-PLAYBACK-GAP-001)
**Статус:** RELEASED + PROD-VERIFIED (зелёный). **STOP.**

---

## 1. Что выпущено (релиз-коммит)

**Commit `7013097`** (`70130970223de18156947fd68f47617c7f935d14`)
`FINAL-PLAYBACK-GAP-001: HDVB voiceFile/preferYear + Kodik AMS port + tests`

Ровно 5 файлов этой волны (diff — только FINAL-PLAYBACK-GAP-001):

| Файл | Изменение |
|---|---|
| `server/src/providers/hdvb/HDVBNormalizer.js` | +14: `voiceFile(folders)` — свежие фильмы отдавали JSON-список голосов вместо m3u8; выбор `/дубляж/`, иначе первый; `cleanFile(...)` |
| `server/src/providers/hdvb/HDVBProvider.js` | +36/−1: `resolvePlaylist` → после `nextFile` — если нет m3u8 но есть `folders` → `post(voiceFile)`; фильмы: `kinopoiskId ? list : preferYear(list, query)` — год запроса поднимает совпавшие записи (лечит колизию «Дэдпул и Росомаха» vs «Дэдпул») |
| `server/src/providers/kodik/KodikClient.js` | +163: AMS-порт (upstream перешёл на AMS-подпись, HTML-парсинг видео сломан upstream). `amsStreams(html, playerUrl)`: var-глобалы страницы (`domain/d_sign/pd/pd_sign/ref/ref_sign` + `vInfo.type/hash/id`) → POST-uri из `app.player_*.js` (`type:"POST",url:atob("…")`, кэш) → POST `{linkHost}{uri}` (`bad_user=false,cdn_is_working=true,…`) → `decodeAmsLinks` (shift+18 → URL-base64 → m3u8). `streams()` = `directStreams` только при `KODIK_SECRET_TOKEN`, иначе `parsePlayer` |
| `server/test/hdvb-provider.test.js` | +89: TITLE_SEARCH_MATRIX, preferYear, VOICE_IFRAME/VOICE_LIST/VOICE_M3U8, voiceFile, videos-posts |
| `server/test/kodik-client.test.js` | +99: AMS-фикстуры (реальная live-пара зашифрованный↔декодированный src), POST-body, 502 без vars |

**Проверки перед релизом:** `git diff --check` ✓ · локальный HEAD `7013097` == `backup/master` == `backup/gap-012-veoveo` ✓ · **origin не тронут** ✓ · секретов в диффе нет (единственный URL-флаг = публичный CDN-манифест в тест-фикстуре) ✓.

## 2. Push (только backup)

```
backup/master        4b34615..7013097  (fast-forward)
backup/gap-012-veoveo 4b34615..7013097  (fast-forward)
origin               — НЕ ТРОГНУТ
```
Полный SHA backup-рефов: `70130970223de18156947fd68f47617c7f935d14` (оба).

## 3. Deploy (production)

- **Первый подход заблокирован локальным VPN** (FlClashX TUN, default-route fake-IP `198.18.0.1`): TCP:22 коннектился, но SSH-баннер не приходил (баннер-проба `scripts/_ssh_banner_probe.cjs` — сервер молчит, тогда как :443 отвечал). Это **локальная причина**, не серверная.
- **После отключения VPN** — баннер `SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.18` пришёл, deploy через `scripts/deploy.sh` (tar-over-SSH, exclude `.git/node_modules/server/.env/server/data/backup`) прошёл успешно.
- Гигиена: `.fpg-shadow/` и askpass вынесены из корня до тара (проверено: на VPS их нет).
- **Production SHA после деплоя совпадают с локальными:**
  - `server/src/providers/hdvb/HDVBProvider.js` = `571f54a2ad971e6da642e50d1552397509747dfa6b16724a3482c882d2be51e5`
  - `server/src/providers/kodik/KodikClient.js` = `45868c97be02c457904b1dc04bb1e22452ad392c7b722149e2b5307a00007ead`
  - `server/src/index.js` = `f3cf5668…` (совпадает)
- Кодовых правок после деплоя — **ноль** (§9).

## 4. Suite (регрессия)

```
cd server && NODE_ENV=test node --test
735 pass / 729 pass?  →  735/729/0/6   (3 провайдер-гейта + 3 под NODE_ENV=test — pre-existing skip, не регрессия)
```

## 5. Production verification (§8) — зелёный

Бейс — `https://plugin.maniya-kvn.online`, токен из `/opt/maniya-online/server/data/users.json` (полная подписка `mo-6…`).

### 5.1 HDVB — приоритет-1 цепочка (source→resolve→master→variant→segment)
| Фильм | /videos | Цепочка |
|---|---|---|
| Дэдпул и Росомаха (2024) | items=1 | master→variant→**seg=206 video/mp2t sig47✓** |
| Гладиатор II (кп 1207839) | items=1 | master→variant→**seg=206 video/mp2t sig47✓** |
| Супермен (2025) | items=1 | master→variant→**seg=206 video/mp2t sig47✓** |

Все три — голос «Дубляж» (voiceFile), полный HLS-цикл до сегмента. Nuance (честно): **Гладиатор II без kinopoisk_id** (title-only) → `items=0` — свежая выборка HDVB расходится по title/год с TMDB-карточкой, поэтому требует KP-id; с KP-id цепочка полная. Не регрессия (на shadow 3/3 с тем же механизмом, см. приоритет-1 в final-report).

### 5.2 Kodik — приоритет-1 реальный AMS-плейтайт
- **Паразиты (2019, kp 496243 / tt6751668):** `items=5` → item url → proxy: **m3u8 200, application/vnd.apple.mpegurl, 351736 B** (реальный AMS-стрим через `p12.solodcdn.com` между) → variant → **seg=206 MP2T sig47✓**.
- Локальный `parsePlayer` (shadow-доказательство из wave 1): без токена на `kodikplayer.com/video/726/…` → **4 качества**, src `p12.solodcdn.com/s/m/…` → m3u8 200. `solodcdn.com` уже в `allowHosts` (фикс `37b742d`), proxy не трогался.

### 5.3 Smoke-кластер (не-приоритет)
| Источник | Проверка | Результат |
|---|---|---|
| VKMovie / Alloha / VeoVeo / Kinopub | natives, Интерстеллар + KP 462682 | items=1 каждый ✓ |
| Rutube / RUmovie-2 | Интерстеллар | master→**seg 206** ✓ |
| Skaz RCH | skaz-kinopub (`{"rch":true}`) | items=9 → **seg 206 MP4** ✓ (WebSocket-слой жив) |
| Filmix | Дэдпул и Росомаха | items=10 → **Range 206 video/mp4** ✓ (F-артефакт устранён: полный GET медиа висит, клиент Lampa ходит с Range) |
| Collaps | Интерстеллар | items=0 `pe=collaps_http_error` — **честный upstream-refusal** (внешний egress/nginx, см. GAP-013), НЕ регрессия релиза |
| TMDB proxy | img / api relay | img → **404 text/html от TMDb** (выдуманный тестовый путь — relay реально дошёл до апстрима); api → **401 passthrough** `{"status_code":7,"status_message":"Invalid API key…"}` — ровно как документировано в TMDB-PROXY-FIX-001; гейт подписки жив: под `admin-fixture` → `403 subscription_required`, под full-подпиской → чистый passthrough ✓ |

## 6. Регрессии
- `server/src/providers/.../store.js`, native-first Rutube, twin/skaz-fallback логика, proxy.js, config — **не тронуты в этой волне**.
- Suite зелёный, production-поведение по всем smokes сохранено. Collaps 422/egress — pre-existing (GAP-013), список «collaps-флап» есть в балерной семантике.

## 7. Остаточные gaps (задокументированы, не блокеры релиза)
1. **Kodik secret-ветка** `directStreams` (официальный `/api/video-links` с `KODIK_SECRET_TOKEN`) не проверена — нет токена. Основной playable-путь закрыт AMS-портом.
2. **Collaps egress** — 422 со стороны upstream-сервера на оба хоста (внешний nginx), workaround не выдумывался (GAP-013).
3. **SSH на этом ПК требует VPN OFF** — FlClashX в default-route блокирует баннер :22 (локальный туннель, серверную сторону не трогать). Для деплоя: сначала отключить VPN.
4. **HDVB title-only без KP-id** для некоторых свежих фильмов (Гладиатор II) → 0 items; с KP-id — полноценная цепочка. Клиент Lampa шлёт KP-id, поэтому практическое влияние отсутствует.

## 8. Финальное состояние
- **Commit:** `7013097` (HEAD gap-012-veoveo) · **backup:** master+gap-012-veoveo = `7013097…` · **origin:** нет
- **Production:** SHA серверных файлов идентичны локальному релизу; все §8 проверки зелёные.
- **Suite:** 735/729/0/6.
- **Некоммитимые артефакты (оставлены как есть):** `scripts/_fpg_*.mjs`, `_prod_verify_release.mjs`, `_prod_tail.mjs`, `_ssh_banner_probe.cjs`, крены `.fpg-shadow/`, 4 пре-existing doc-правки 17.08. **STOP — дальнейшая работа по этой волне не выполняется.**