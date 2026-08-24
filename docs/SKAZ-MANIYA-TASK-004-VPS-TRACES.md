# SKAZ-MANIYA-TASK-004-VPS-TRACES

VERIFY-ON-VPS (TASK-004 §2-8, §20): rezka / filmix / kinotochka / collaps на VPS.
Метод: read-only HTTP-пробы клиентского пути против **shadow-инстанса** (staging,
`95.85.241.121:3210`, НЕ prod). **DEPLOY = ЗАПРЕЩЁН — серверный код не менялся**; это
только клиентские GET/диагностика. Пароль/email/uid/токены/ключи НЕ логируются.

Дата: **2026-08-20**.

---

## 1. Топология (read-only, для контекста)
- **prod** (systemd `maniya-online.service`): `/opt/maniya-online/server`, порт 3000, nginx впереди.
- **shadow (staging)**: `/tmp/fpg-shadow/server`, порт 3210, запущен 2026-08-18, `SKAZ_ENABLED=true`
  + skaz-креды на месте. Этот инстанс — цель read-only проб.
- Skaz-референс (кластер online*.skaz.tv) с локального бокса по прямому HTTPS недостижим
  (egress-лимit, как в прошлых сессиях); SkazClient в Maniya делает этот discovery на рантайме.

## 2. Архитектурная карта 4 провайдеров (registry.js)
| Мания (видимый) | Тип | Skaz-близнец/эквивалент |
|---|---|---|
| `rezka` | native RezkaProvider | hidden twin `skaz-rezka` |
| `filmix` | native FilmixProvider | hidden twin `skaz-filmix` |
| `kinotochka` | native KinotochkaProvider (kinovibe.vip) | в Skaz кластерный kinotochka — rch/WS-only (REST не играет); native — функциональный эквивалент |
| `collaps` | native CollapsProvider (Collaps/Kodik native) | в Skaz тоже native; скрытого skaz-collaps нет (вне lite-cluster, `/lite/collaps`=503) |

## 3. VERIFY-ON-VPS результаты (discovery → resolve → stream/playback)

### rezka — **PASS (сериал)**
- Discovery: `videos` → items=10 (Дом дракона, serial).
- Resolve: item[0] `method=play` → `/proxy`-родственный URL через shadow-proxy.
- Playback: `play=m3u8→seg 206 video/MP2T 1024B sig47✓` — полная HLS-цепочка до сегмента.
- MOVIE (Интерстеллар): `items=0` — НЕ баг: источник сам себя называет "For Serial"
  (означен `rezka`="For Serial"); сериалы покрыты, фильмы — другими провайдерами (filmix/kinotochka/…).
- `method=play` (не `call`) — **без call-url**, resolved-поток сразу.

### filmix — **PASS**
- Discovery: Дюна-2 → items=9; Интерстеллар → items=3.
- Resolve: все item — `method=play`, direct `/api/lampa/proxy?url=https://<cdn>/…`. **0 call-url.**
- Playback (все качества/дорожки):
  - Дюна-2: items[1..8] → **206/video/mp4 1024B** (все играют).
  - Интерстеллар: все 3 → **206/video/mp4** и **206/m3u8** (играют, HLS-дорожка тоже).
- Единственное исключение: **item[0] Дюны-2** ("Дубляж [4K, Bravo Records Georgia]",
  `nl205.cdnsqu.com/.../UHD_090/...2160.mp4`) → **404**. Это **stale CDN-копия** конкретной
  дорожки (мёртвый линк на `nl205.cdnsqu.com/UHD_090`), НЕ дефект кода filmix: 8/9 других дорожек
  того же фильма и все дорожки Интерстеллар играют 206. Классификация: пер-трек stale-CDN, не
  системный сбой.

### kinotochka — **PASS**
- Discovery: Интерстеллар → items=1.
- Resolve: item[0] `method=play`.
- Playback: `play=MP4/TS-RANGE 206/video/mp4 1024B` — прямой MP4 (kinovibe.vip) играет.
- Это подтверждает решение (memory KINOTOCHKA-NATIVE-001): native kinovibe-путь даёт работающий
  MP4; кластерный kinotochka в Skaz rch/WS-only (REST не играет) — native — правильный
  функциональный эквивалент, НЕ ошибка.

### collaps — **UPSTREAM/EGRESS LIMITATION** (честный upstream-refusal)
- Discovery: Паразиты (movie) и Дом дракона (serial) → `items=0`,
  `provider_error={kind:"upstream-refusal", status:422, code:"collaps_http_error"}`.
- Сообщение: "Collaps HTTP 422".
- Это документально подтверждает **COLLAPS-EGRESS-001** (память): embed-хост
  (`api.luxembd.ws`/`api.bhcesh.me`) гейтит `/embed/*` по IP-региону egress; **VPS-SE стабильно
  422**, VPN-локал 200+playable HLS 12/12 тем же CollapsClient. Запрос Maniya корректен, код не
  менялся. Collaps native и в Skaz — на этом VPS-egress он отказывает одинаково с двух сторон →
  honest upstream-refusal, НЕ дефект Maniya.

## 4. Host-bound / balancer на VPS (§9-10)
- Все resolved-потоки — через `/api/lampa/proxy?url=<inner>` на shadow-хосте; generation=resolve
  на одном хосте (shadow). **0 call-url** во всех пробах (rezka m3u8, filmix mp4/m3u8, kinotochka
  mp4). Единый balancer-путь (createAvailabilityChecker → resolveSources → computeCard) на VPS
  резолвит в реальные потоки.
- Для collaps: probe в 422 — upstream-refusal распознаётся и сообщается как provider_error
  (kind=upstream-refusal), не падает и не крутит цикл — стабильная честная классификация.

## 5. Итог
| Provider | VPS result | Расшифровка |
|---|---|---|
| rezka | **PASS** (serial playable; movie by-design empty "For Serial") | 0 call-url |
| filmix | **PASS** | 0 call-url; 1 stale-CDN дорожка (item[0] Дюны-2 → 404), остальные 206 |
| kinotochka | **PASS** | 0 call-url; native MP4 kinovibe |
| collaps | **UPSTREAM/EGRESS LIMITATION** | 422 SE-egress, honest upstream-refusal, совпадает с [[collaps-egress-001]] |

Никакие секреты/креды/токены/ключи в отчёт не вынесены. Регрессия кода — нет (0 изменений без
TASK-004 fix'ов; fix skaz-enabled-gate — отдельная деталь, покрыта локальной suite).
