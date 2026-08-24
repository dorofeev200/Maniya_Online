# SKAZ-MANIYA-TASK-013 — FILMIX ACQUISITION FALLBACK — REPORT

**Дата:** 2026-08-21. **Тип:** read-only investigation → **STOP по стоп-условиям задачи.** Код/конфиг/.env/VPS/PROD **НЕ изменялись**. Фаллбек НЕ реализован.

---

## ROOT CAUSE

TASK-012 установил: «skaz-filmix snapshot empty» — НЕ coverage-gap. TASK-013 пытался устранить возможное окно «SKAZ Filmix = playable, MANIYA Filmix = transient EMPTY» через HTML-acquisition fallback на werkecdn MP4.

**Проверено вживую (эта сессия), все каналы:**

| канал | результат | вывод |
|---|---|---|
| `api.filmix.tv/api-fx/list` (поиск) | 200, 6 items, ~826ms | **работает** |
| `api.filmix.tv/api-fx/post/{id}/video-links` | 200, 1 track (Многоголосый, Megogo), files 1080/720/480, 124ms | **работает** |
| `filmix.my` (HTML + api/v2) | таймаут (>8с) | мёртв |
| `filmix.gg/ac/pub/fm` | таймаут (>7с) | мёртвы |
| `filmix.tv` | 302 → /login | не HTML-контент |
| `lite/filmix` (кластер SKAZ) | 200, HTML, **10 werkecdn-ссылок (2160p есть)** | единственный живой HTML-путь |
| werkecdn MP4 (прямой, без Referer) | 206 video/mp4 | проигрывается и без прокси |
| `proxy.allowHosts` | содержит werkecdn.me/cdnsqu.com | прокси-путь готов |

**Текущая цепочка (FilmixProvider.streams/videos):** `api-fx search → video-links → items`; при сбое video-links → `card() (filmix.my/api/v2/post)` → **мёртвый путь → EMPTY**. SDK-метка `filmix.my` (primaryClient) уже настроен на 3с/без-ретраев.

## CURRENT FLOW (точный)

```
search() → api-fx/list.search (200, 826ms)  → normalizeSearchItem
videos()/streams() → api-fx video-links (200, 124ms, track/voice+files 1080-480)
  !!!! video-links сбой (502/timeout>45с) → card() filmix.my/api/v2/post
    (таймаут 3с, 301→501) → [] → "Поиск не дал результатов"
```

## FALLBACK DESIGN ОЦЕНКА

**Требование задачи:** fallback = HTML-acquisition через «существующий разрешённый Filmix acquisition path», **НЕ копировать SKAZ-код**, **НЕ добавлять новый provider**.

**Доказано:** прямой filmix-домен (my/gg/ac/pub/fm/tv) **не отдаёт HTML ни с этого сервера, ни ранее с VPS (diagnosis §16.2)**: filmix.my/api/v2 — 301→501, HTML — таймаут. Единственный HTML-путь с werkecdn-ссылками = `lite/filmix` кластера SKAZ (online3, 200/300ms). Но:

- `lite/filmix` — это **SKAZ-канал**, ответ кластера (обёрнутый filmix.co), а не прямой Filmix-acquisition path;
- использование его внутри FilmixClient = завязка native-filmix на кластер → **нарушение разделения слоёв** (native-filmix ↔ skaz-O3) и, по смыслу, копирование SKAZ-подхода; явно запрещено стоп-условием «НЕ копировать SKAZ-код»/path-условием.

⇒ **Стоп-условие выполнено: «fallback не имеет надёжного (допустимого в архитектуре) acquisition path».** Фаллбек реализовать в рамках TASK-013 нельзя.

## FALLBACK FLOW (гипотетический, НЕ реализован)

```
api-fx video-links сбой → filmix.my HTML (мёртв) ⇢ BLOCKED
  └ только lite/filmix (кластер) → 10 MP4 (2160p!) → НЕ допустимо в фильмix-слой
```

## FILES CHANGED

**Ни одного.** `git diff` чистый (проверено: рабочее дерево без правок в рамках этого TASK).

## WHY SAFE / TEST RESULTS

- Регрессия: **763/756/1/6 = baseline** (fail=route:41 — известный pre-existing egress-flake, НЕ регрессия этого TASK). Изменений кода не было, поэтому регресс-критерий формально выполнен «сохранением baseline».
- Никаких юнит-тестов не добавлено (нечего тестировать — код не менялся).

## LATENCY (измерено)

- video-links успешно: **124ms** (live, interstellar id 112791)
- api-fx search: **826ms** (live)
- Прямой HTML-заход на filmix.my/gg/ac/pub/fm: **>7-8с таймаут** (мёртв)
- Cluster lite/filmix HTML: **300-400ms** (но это SKAZ-канал, не filmix-path)

Требование «не увеличить normal latency» — не затронуто (код не менялся, норма ведёт себя как раньше).

## DIFFERENTIAL (SKAZ vs MANIYA, живое, 3 тайтла)

| title | SKAZ filmix (cluster HTML) | MANIYA native filmix (video-links) | совпадают? |
|---|---|---|---|
| История игрушек 5 | 200, 2160p (nl105/nl221) | 200, **3 items** (424p…) | Да |
| Интерстеллар | 200, 10 werkecdn (2160p/1440/1080) | 200, **3 items** (voice Megogo, 1080/720/480) | Да |
| Форрест Гамп | 200, 2160p | 200, **5 items** | Да |

**Ни одного live-события «SKAZ content / MANIYA EMPTY» на 3 контрольных тайтлах за всю сессию** (T012 PHASE-2, T013-probe): native filmix стабильно отдаёт items. Транзиентные 0-items в прошлом — фильмix.my-api-недоступность, но она и есть «статически мёртвый» путь, а не источник расхождения сегодня.

## SHADOW RESULT

**Не создавался** — реализация остановлена на этапе проектирования по стоп-условиям (нет реализации → нет shadow).

## PRODUCTION STATUS

**Не тронут.** Код/конфиг/.env/VPS/PROD без изменений. Никаких фиксов не применялось.

---

## FINAL STATUS: **REJECT** (по стоп-условиям TASK-013)

### Обоснование
1. **Единственный живой HTML-путь = SKAZ-кластер `lite/filmix`**, что является нарушением условия «fallback должен использовать *существующий разрешённый Filmix acquisition path*» и дублирует принцип «НЕ копировать SKAZ-код».
2. **Прямые filmix-домены (my/gg/ac/pub/fm/tv) мертвы** из среды развёртывания — надёжного *допустимого* HTML-канала нет. Стоп-условие «fallback не имеет надёжного acquisition path» выполнено.
3. **Проблема «SKAZ content / MANIYA EMPTY» сегодня не воспроизводится** (0/3 контрольных, live); код не менялся никак, регресс-бейз сохранён (763/756/1/6).

### Что можно было бы делать (и НЕ делать сейчас, до отдельного задания)
- **Если** появится живой филбэк-путь filmix.my (филмix восстановит geo) → тогда HTML-fallback в FilmixClient станет легальным (filmix.my = разрешённый Filmix host, уже в config + proxy.allowHosts) — это **следующий отдельный TASK**.
- **Не** подключать filmixtv, **не** модифицировать skaz-слои для HTML-парсинга, **не** трогать proxy, hostOrder, availability, UI.