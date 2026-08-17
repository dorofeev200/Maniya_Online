# Диагностика стабильности BALANCER по одной карточке (House of the Dragon)

Дата: 2026-08-14. Статус: **ДИАГНОСТИКА ЗАВЕРШЕНА — данные, вердикт, без правок кода.**
Код не менялся, коммитов нет, деплоя нет (read-only: HTTP-запросы + импорт модулей для замера).

## Постановка
Проверить стабильность BALANCER для одной и той же карточки: 10 последовательных
запросов `/api/lampa/sources/card` с одним и тем же реальным токеном и абсолютно
одинаковыми параметрами. Фильм — «Дом Дракона» / House of the Dragon.

Параметры (идентичные во всех прогонах, из реального запроса телефона):
```
id=94997  title=Дом Дракона  original_title=House of the Dragon  serial=1  year=2022
original_language=en  source=tmdb  clarification=0  similar=false  imdb_id=tt11198330
uid=prsknyel  token=<REDACTED: prod-token, SECURITY-001> → userUid=fe3a37a2ece160df
```

Три режима, по 10 прогонов, в одном временном окне:
- **A** — реальный HTTP-эндпоинт `/api/lampa/sources/card` (card-кэш активен);
- **B** — сырой `defaultChecker.checkBalancer()` по каждому из 14 skaz-слагов
  (первичный checksearch, без card-кэша и confirm-гейта);
- **C** — E-Online `lite/events?life=false` с теми же параметрами и теми же creds.

---

## 1. Mode A — эндпоинт `/api/lampa/sources/card`, 10 запросов

| № | status | latency | cached | visible (id) | hidden (id) |
|---|--------|---------|--------|--------------|-------------|
| 0 | 200 | 5399 ms | false | filmix,rezka,collaps,hdvb,skaz-alloha,skaz-videoseed,skaz-kinopub,skaz-veoveo,skaz-pidtor,skaz-solntse,**skaz-rhsprem** | kodik,rutubemovie,cdnvideohub,skaz-kinoflix,skaz-geosaitebi |
| 1 | 200 | 1196 ms | false | … то же 11 источников (**rhsprem виден**) | … 5 |
| 2 | 200 | 1205 ms | false | … **rhsprem скрыт** (10 шт.) | … + skaz-rhsprem |
| 3 | 200 | 1268 ms | false | … **rhsprem скрыт** (10 шт.) | … + skaz-rhsprem |
| 4 | 200 | 1132 ms | false | … **rhsprem виден** (11 шт.) | … 5 |
| 5 | 200 | 1153 ms | false | … **rhsprem виден** (11 шт.) | … 5 |
| 6 | 200 | 1124 ms | false | … **rhsprem виден** (11 шт.) | … 5 |
| 7 | 200 | 1143 ms | false | … **rhsprem виден** (11 шт.) | … 5 |
| 8 | 200 | 1117 ms | false | … **rhsprem виден** (11 шт.) | … 5 |
| 9 | 200 | 1379 ms | false | … **rhsprem скрыт** (10 шт.) | … + skaz-rhsprem |

Полный набор всегда: `filmix, rezka, collaps, hdvb, skaz-alloha, skaz-videoseed,
skaz-kinopub, skaz-veoveo, skaz-pidtor, skaz-solntse` (10 стабильных) + флапающий
`skaz-rhsprem`.

**Подсчёты (Mode A):**
- Полностью одинаковых наборов из 10: **2 различных паттерна** (P1 = rhsprem виден:
  №0,1,4,5,6,7,8 — 7 прогонов; P2 = rhsprem скрыт: №2,3,9 — 3 прогона).
- Набор совпал с предыдущим запросом: **6/9** (№1,3,5,6,7,8); отличался: 3/9 (№2,4,9).
  Максимальная серия одинаковых подряд: **5** (№4–8).
- **cached=false 10/10** — карточка никогда не кэшируется.
- **>10 s: 0/10 в этом окне** (1.1–5.4 s). В более раннем окне (кластер под нагрузкой)
  было **10/10 >10 s (~12 s каждый)** — см. §5.

> В предыдущем окне (сессия «concurrency-404», тот же фильм) флапал **skaz-kinopub**
> (6:4). Сейчас — **skaz-rhsprem** (7:3). Какой именно слаг флапает, зависит от
> состояния кластера в момент запроса; механизм один и тот же (см. §5).

---

## 2. Mode B — сырой checkBalancer (checksearch), 10 прогонов × 14 слагов

Формат ячейки: `show/check/host/http-status`.

| run | alloha | videoseed | kinopub | kinoflix | veoveo | pidtor | solntse | filmix | rezka | hdvb | rutube | kodik | geosaitebi | rhsprem |
|-----|--------|-----------|---------|----------|--------|--------|---------|--------|-------|------|--------|-------|------------|---------|
| 0 | 1/OK/o3/200 | 1/OK/o3/200 | 1/INC/o3/200 | 0/NO/o8/403 | 1/OK/o3/200 | 1/INC/o3/200 | 1/INC/o3/200 | 1/INC/o3/200 | 1/INC/o3/200 | 1/OK/o3/200 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | 1/INC/o3/200 |
| 1 | 1/OK/o3 | 1/OK/o3 | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | 1/INC/o3 |
| 2 | 1/OK/o3 | 1/OK/o3 | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | **0/NO/o8/403** | **0/NO/o8/403** | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | **0/NO/o8/403** |
| 3 | 1/OK/o3 | 1/OK/o3 | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | 1/INC/o3 |
| 4 | 1/OK/o3 | **0/NO/o8/403** | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | **0/NO/o8/403** | **0/NO/o8/403** | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | **0/NO/o8/403** |
| 5 | 1/OK/o3 | 1/OK/o3 | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | 1/INC/o3 |
| 6 | 1/OK/o3 | 1/OK/o3 | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | **0/NO/o8/403** | **0/NO/o8/403** | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | **0/NO/o8/403** |
| 7 | 1/OK/o3 | 1/OK/o3 | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | 1/INC/o3 |
| 8 | 1/OK/o3 | **0/NO/o8/403** | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | **0/NO/o8/403** | **0/NO/o8/403** | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | **0/NO/o8/403** |
| 9 | 1/OK/o3 | 1/OK/o3 | 1/INC/o3 | 0/NO/o8/403 | 1/OK/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/INC/o3 | 1/OK/o3 | 0/NO/o8/503 | 0/NO/o3/200 | 0/NO/o8/503 | 1/INC/o3 |

Легенда: `OK` = authoritative show (200), `NO` = authoritative hide, `INC` = inconclusive
(предикатный «оптимистичный» show), `o3` = online3.skaz.tv, `o8` = online8.skaz.tv.

**Подсчёты (Mode B, 10 прогонов):**

| Бала/сер | show/10 | hide/10 | inconclusive | timedOut | hosts | status | класс |
|----------|---------|---------|--------------|----------|-------|--------|-------|
| alloha | 10 | 0 | 0 | 0 | o3, 94.249.239.37 | 200 | **STABLE-SHOW** |
| veoveo | 10 | 0 | 0 | 0 | o3, 94.249.239.37 | 200 | **STABLE-SHOW** |
| hdvb | 10 | 0 | 0 | 0 | o3, 94.249.239.37 | 200 | **STABLE-SHOW** |
| kinopub | 10 | 0 | **10** | 0 | o3, 94.249.239.37 | 200 | **STABLE-SHOW** (INC) |
| pidtor | 10 | 0 | **10** | 0 | o3, 94.249.239.37 | 200 | **STABLE-SHOW** (INC) |
| solntse | 10 | 0 | **10** | 0 | o3, 94.249.239.37 | 200 | **STABLE-SHOW** (INC) |
| kinoflix | 0 | 10 | 0 | 0 | online8 | 403 | **STABLE-HIDE** |
| rutubemovie | 0 | 10 | 0 | 0 | online8 | 503 | **STABLE-HIDE** |
| geosaitebi | 0 | 10 | 0 | 0 | online8 | 503 | **STABLE-HIDE** |
| kodik | 0 | 10 | 0 | 0 | o3, 94.249.* | 200 (нет контента) | **STABLE-HIDE** |
| **videoseed** | **8** | 2 | 0 | 0 | o3, online8 | 200,403 | **FLAP** (№4,8) |
| **filmix** | **6** | 4 | 6 | 0 | o3, online8 | 200,403 | **FLAP** (№2,4,6,8) |
| **rezka** | **6** | 4 | 6 | 0 | o3, online8 | 200,403 | **FLAP** (№2,4,6,8) |
| **rhsprem** | **6** | 4 | 6 | 0 | o3, 94.249.239.11, online8 | 200,403 | **FLAP** (№2,4,6,8) |

**Механизм флапа (подтверждён полной матрицей хостов):** в «плохих» прогонах (чётные
№2,4,6,8) первичная нода online3.skaz.tv для этих балансеров отвечает медленно →
ротация хостов уводит запрос на резервную легаси-ноду **online8.skaz.tv**, которая
отвечает **403 «нет»** для filmix/rezka/rhsprem/videoseed → authoritative hide.
В «хороших» прогонах запрос успевает на online3/94.249.* → 200. timedOut=0 везде:
простой checksearch сам по себе быстрый (0.2–1.5 s), все 14 слагов укладываются в
дедлайн; флап — не таймаут, а вердикт резервной ноды.

---

## 3. Mode C — E-Online `lite/events?life=false`, 10 прогонов (те же параметры/creds)

Первый (свежий) вызов: **1712 ms**, 22 ссылки (серверный checksearch кластера).
Прогоны 1–9: **35–75 ms** — всё из кластерного memkey-кэша (5 мин).

| № | status | latency | links | паттерн |
|---|--------|---------|-------|---------|
| 0 | 200 | 1712 ms | 22 | свежий checksearch |
| 1 | 200 | 40 ms | 22 | кэш |
| … | 200 | 36–75 ms | 22 | кэш |
| 9 | 200 | 35 ms | 22 | кэш |

**Полный список ссылок EO** (22): show → kinopub, filmix, alloha, rezka, pidtor, ashdi,
kinoukr, eneyida, veoveo, solntse, hdvb, rhsprem;
hide → sakhtv, kinoteatrkg, kinobase, xvideocdn, xvideocdnultra, xvideocdn60fps,
kinoflix, kinotochka, asiage, geosaitebi.
(videoseed в этом окне в EO отсутствует; в более раннем окне присутствовал show —
список EO сам слегка меняется между окнами, но внутри 5-минутного кэша стабилен.)

**Наши 14 слагов по вердикту EO (это окно):**
- show: **kinopub, filmix, alloha, rezka, pidtor, veoveo, solntse, hdvb, rhsprem** (9)
- hide: **kinoflix, geosaitebi** (2)
- отсутствуют в EO: videoseed, kodik, rutubemovie (3)

**Подсчёты (Mode C):** полностью одинаковых наборов из 10 — **1 паттерн на 10**
(10/10 идентичны, это стабильность кластерного кэша), **>10 s = 0/10**, errors = 0.

---

## 4. Сравнение стабильности: Maniya card vs E-Online

| слаг | Maniya raw (10/10) | EO вердикт | согласие |
|------|--------------------|-----------|----------|
| alloha | STABLE-SHOW (OK) | show | ✅ согласны |
| veoveo | STABLE-SHOW (OK) | show | ✅ согласны |
| hdvb | STABLE-SHOW (OK) | show | ✅ согласны |
| kinopub | STABLE-SHOW (INC) | show | ✅ согласны |
| pidtor | STABLE-SHOW (INC) | show | ✅ согласны |
| solntse | STABLE-SHOW (INC) | show | ✅ согласны |
| kinoflix | STABLE-HIDE | hide | ✅ согласны |
| geosaitebi | STABLE-HIDE | hide | ✅ согласны |
| **videoseed** | **FLAP 8/10** | (в этом окне нет / раньше show) | ⚠️ флап |
| **filmix** | **FLAP 6/10** | show | ⚠️ иногда hide там, где EO show |
| **rezka** | **FLAP 6/10** | show | ⚠️ иногда hide там, где EO show |
| **rhsprem** | **FLAP 6/10** | show | ⚠️ иногда hide там, где EO show |
| kodik | STABLE-HIDE | не в универсуме EO | ✅ консистентно (hide) |
| rutubemovie | STABLE-HIDE | не в универсуме EO | ✅ консистентно (hide) |

**Ключевое различие стабильности:**
- **E-Online кэширует безусловно.** Результат `lite/events` живёт в кластерном memkey
  (Fnv1a(id:serial:source:online.Count:uid), TTL 5 мин). Даже если исходный сигнал
  флапает, пользователь видит **стабильный список** 5 минут, а каждый следующий
  запрос — 35–75 ms. Стабильность EO = стабильность кэша, не стабильность сигнала.
- **Maniya card() кэширует только если НИ ОДНА строка не inconclusive.**
  kinopub/pidtor/solntse — всегда inconclusive (предикатный «оптимистичный» show) →
  для этой карточки **кэш не заполняется никогда** (cached=false 10/10) → каждый
  запрос заново гоняет checksearch всех 14 слагов + confirm-гейт (1.1–5.4 s в тихом
  окне, ~12 s под нагрузкой) → флап (online8-403) просачивается в видимый набор
  (2 паттерна из 10).

---

## 5. Вердикт

1. **Эндпоинт `/api/lampa/sources/card` по одной карточке НЕстабилен:** 2 различных
   набора из 10 запросов; флапающий слаг меняется от окна к окну (вчера kinopub 6:4,
   сейчас rhsprem 7:3) — это отражение реального флапа кластера skaz, а не гонки или
   серверного бага.
2. **Корень нестабильности — отказ от кэширования.** card() не кэширует результат,
   пока хоть одна строка inconclusive; для Дома Дракона inconclusive-строки есть всегда
   (kinopub/pidtor/solntse). Отсюда: (а) латентность 1.1–12 s вместо 35–75 ms у EO;
   (б) каждый запрос заново видит сырой флап 4 слагов (videoseed/filmix/rezka/rhsprem)
   через 403 резервной ноды online8.
3. **Кластер skaz флапает на первичной ноде:** когда online3.skaz.tv отвечает медленно,
   ротация хостов уводит запрос на online8.skaz.tv, которая для filmix/rezka/rhsprem/
   videoseed отвечает authoritative 403 «нет» → ложный hide. Стабильно show (10/10):
   alloha, kinopub, veoveo, pidtor, solntse, hdvb. Стабильно hide (0/10): kinoflix,
   rutubemovie, kodik, geosaitebi. Флапают ровно 4: videoseed, filmix, rezka, rhsprem.
4. **Согласие с E-Online хорошее в стабильном состоянии** (8/14 слагов согласны,
   ещё 2 hide-слага консистентны с отсутствием в EO). Разногласия — только в
   флапающих прогонах: там Maniya прячет источник, который EO показывает.
5. **>10 s — следствие нагрузки:** в тихом окне 0/10 (1.1–5.4 s), в нагруженном
   10/10 (~12 s из-за confirm-гейта, исчерпывающего дедлайн). Оба окна: cached=false.
6. **Действия не требуются (диагностика read-only).** Если понадобится лечить:
   (а) кэшировать card-результат даже при inconclusive-строках (как EO — безусловно,
   с коротким TTL для confirm-hide); (б) не считать online8 авторитетным «нет» для
   слагов, где резервная нода заведомо не обслуживает контент. Это гипотезы лечения,
   не применены.

## Артефакты
- Временные скрипты (в `server/scripts/` локально и `/tmp` на VPS, подлежат удалению):
  `card-stability-diagnostic.mjs`, `card-stability-matrix.mjs`, `eo-events-detail.mjs`.
- Связанные отчёты: `docs/concurrency-404-report.md` (флап без гонки),
  `docs/balancer-002-postdeploy-report.md` (карточка 2 = Дом Дракона).
