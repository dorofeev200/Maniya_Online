# FINAL-QA-FIX-001 — Исправление AUDIT-001 + AUDIT-002

**Дата:** 2026-08-19
**Заказ:** исправить ТОЛЬКО два подтверждённых MANIYA BUG из `docs/final-qa-001-report.md`.
**Ограничения:** без повторного аудита, без архитектурных изменений, без LOW cleanup, без AUDIT-003…006.

---

## Что изменено

| Файл | Строка | До | После | Проблема |
|---|---|---|---|---|
| `server/src/providers/alloha/AllohaClient.js` | 123 | `directors_cut: directors ? 'true' : undefined` | `directors_cut: directorsCut ? 'true' : undefined` | Обращение к необъявленной переменной `directors` вместо параметра `directorsCut` → `ReferenceError` при вызове `streams()` |
| `server/src/providers/skaz/SkazRchClient.js` | 379 | `requestHeaders['user-agent'] = defaultUserAgent;` | `requestHeaders['user-agent'] = defaultUserAgent();` | Передавалась ссылка на функция, а не результат вызова → битый User-Agent в RCH-запросах `rchtype === 'apk'` |

---

## Regression tests

Добавлены два минимальных теста:

1. `server/test/alloha-client.test.js`
   - `AllohaClient.streams()` с `directorsCut=true/false` не бросает `ReferenceError`.
   - При `directorsCut=true` в URL присутствует `directors_cut=true`; при `false` параметр отсутствует.

2. `server/test/skaz-rch-client.test.js`
   - `SkazRchClient._executePushed()` для `rchtype='apk'` передаёт в `fetch` строковый `User-Agent` (`Mozilla/5.0 …`), а не исходный код функции.

---

## Полный test suite

```text
ℹ tests 744
ℹ suites 14
ℹ pass 738
ℹ fail 0
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 6295.9005
```

**0 FAIL.** Оба новых теста проходят.

---

## Live-проверки (минимальные)

### Alloha

Запущен реальный HTTP-вызов `AllohaClient.streams()` с тестовым токеном `dummy-token`:

```text
directorsCut=true ERROR HttpError Provider HTTP 401
directorsCut=false ERROR HttpError Provider HTTP 401
```

- `ReferenceError` не возникает.
- Запрос доходит до upstream linkhost и получает ожидаемый `401` (токен недействителен).
- Параметр `directors_cut` формируется корректно (проверено unit-тестом).

### RCH

Запущен реальный вызов `SkazRchClient._executePushed()` через `fetchImpl` к `https://httpbin.org/get`:

```text
RCH pushed UA type: string
RCH pushed UA: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36
```

- User-Agent теперь строка, а не функция.
- Полноценный сквозной RCH-кейс playback невозможен локально без учётных данных skaz-кластера; unit-тест и smoke-вызов покрывают исправленный путь.

---

## Git

```text
$ git diff --check
warning: in the working copy of 'server/src/providers/alloha/AllohaClient.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server/src/providers/skaz/SkazRchClient.js', LF will be replaced by CRLF the next time Git touches it
```

- Ошибок whitespace нет.
- Предупреждения только о line endings (core.autocrlf на Windows), не влияют на код.

### Изменённые/добавленные файлы

```text
 M server/src/providers/alloha/AllohaClient.js
 M server/src/providers/skaz/SkazRchClient.js
?? server/test/alloha-client.test.js
?? server/test/skaz-rch-client.test.js
```

### Diff summary

```text
 server/src/providers/alloha/AllohaClient.js | 2 +-
 server/src/providers/skaz/SkazRchClient.js  | 2 +-
 2 files changed, 2 insertions(+), 2 deletions(-)
```

---

## Регрессии

- Не затронуты: W1/availability, store.js, balancer, TMDB, VKMovie, Rutube, HDVB, Kodik, Collaps, PIDTOR, RHSPREM.
- AUDIT-003…006 не исправлялись.
- Полный suite: **0 FAIL**.

---

## Действия, которые НЕ выполнялись

- **Commit:** NO
- **Push:** NO
- **Deploy:** NO

---

## Вывод

AUDIT-001 и AUDIT-002 исправлены однострочными изменениями. Regression tests добавлены. Полный suite зелёный. Регрессий нет.
