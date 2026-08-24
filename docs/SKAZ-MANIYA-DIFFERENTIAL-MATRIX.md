# SKAZ-MANIYA-DIFFERENTIAL-MATRIX

Спецификация дифференциальной матрицы and результатов TASK-002 (детерминированный репро парата Skaz→Maniya).

Метод: **SAME INPUT → SAME/EQUIVALENT RESULT**. Reference = Skaz (online3.skaz.tv и кластер); Implementation under test = Maniya Online (локальный `server/`).

## Объекты / входы

| ID | Тип | Название | ids | Провайдеры |
|----|-----|----------|-----|-----------|
| O1 | serial | Дом дракона | 94997 / tt11198330 / 2022 | videoseed, rezka, filmix, hdvb |
| O2 | movie | Форрест Гамп | 448 / tt0109830 / 1994 | videoseed, rezka, filmix, hdvb |
| O3 | movie | Начало (Inception) | 13 / tt1375666 / 2010 | filmix |

## Сопоставление результата
- Skaz `/: call → JSON {url: /proxy/<hash>}` ↔ Maniya `/video → play {url: <proxy(/proxy/<hash>)>}`.
- Тест эквивалентности: внутренний `url` после `decodeURIComponent` у Maniya = `/proxy/<hash>.m3u8` (или реальный CDN-стрим), **НЕ `/lite/<balancer>/video/<token>`** (call-url).

## Фактические результаты
| Вход | Skaz | Maniya (после фикса) | Вердикт |
|------|------|----------------------|---------|
| O1/videoseed/ep1 | `/proxy/04bbd075…` | `/proxy/04bbd075…` | ✅ |
| O1/videoseed/ep2 | `/proxy/0b8d9348…` | `/proxy/0b8d9348…` | ✅ |
| O1/videoseed/ep3 | `/proxy/52686176…` | `/proxy/52686176…` | ✅ |
| O1/rezka/ep1 | resolved voidboost | `stream.voidboost.one/...:2026…` | ✅ |
| O1/filmix/ep1 | resolved werkecdn | `nl03.werkecdn.me/s/…` | ✅ |
| O2/rezka | resolved voidboost | `stream.voidboost.one/…` | ✅ |
| O3/filmix | play-URL (CDN) | 4 play-карточки (CDN) | ✅ (play-path) |
| O1/hdvb/ep1 | — | null | ⚠ TODO |
| O2/hdvb | — | 0 items | ⚠ TODO |

## Критерии
1..10 — см. `SKAZ-MANIYA-TASK-002-REPORT.md` §7. Критерий 9 (не call-url) ИСПРАВЛЕН local-фиксом.
