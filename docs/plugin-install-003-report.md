# PLUGIN-INSTALL-003 — обязательный legacy-URL + MSX-гейт origin-query

**Дата:** 2026-08-14 · **Статус:** реализация + тесты + **commit (`d445224`) + push (`backup`) + deploy + PROD-VERIFY — ВЫПОЛНЕНЫ (10/10)**.
**Scope:** только install-flow (`pluginUrl` в bot.js, `isLampaRequest` в http.js, stub-текст, тесты). НЕ менялись: `availability.js`, провайдеры, cache, playback, балансеры, `index.js`-маршруты, чужие незакоммиченные файлы.
**Правило отчёта:** реальные значения не приводятся — только masked (первые 4–6 + `…` + последние 2). Токен хвост `…1c0fdce4` и install `80ea…4f` публичны (они же в ссылках).

---

## 1. Проблема (root cause)

Media Station X = Lampa web UI в WKWebView с обычным iOS-UA **без «Lampa»**. `isLampaRequest()` (`/lampa/i`) его не пропускал → любой плагин-URL (legacy **и** `/p/`) отдавал ему 40-байтный stub, до `/x/` дело не доходило → «HTTP 500» в самом MSX. До PLUGIN-INSTALL-002 тот же iPhone-UA получал полный JS (легаси-шортлинк без UA-гейта). **Дискриминатор из прод-логов:** Lampa web UI (MSX и Android) при загрузке плагина дописывает `?logged=…&reset=…&origin=bylampa.online`.

Дополнительно: после 002 пользователю выдавалась ссылка `/p/<install>.js` — при входе в MSX именно её формат был причиной сбоя. Требование — вернуть обязательный legacy-формат.

## 2. Что сделано

| Файл | Правка |
|---|---|
| `server/src/http.js` | `isLampaRequest()`: `UA содержит 'lampa'` **ИЛИ** `origin === 'bylampa.online'` **ИЛИ** (`logged` && `reset`). `PLUGIN_STUB_TEXT` → «Добавьте плагин в Расширения Lampa» |
| `server/src/telegram/bot.js` | `pluginUrl()` **всегда** legacy `/{slug}_{short}.js` (или `/{prefix}_{short}.js` без ника); `/p/<install>.js` из выдаваемой ссылки убран. `install_token` сохраняется в записи (для `/x/` HMAC и обратной совместимости) |
| `server/test/plugin-install.test.js` | +5 тестов MSX (19–23) |
| `server/test/telegram.test.js` | 3 ассерта `/p/` → legacy-формат |
| `server/test/{api,shortlink,plugin-install-nosecret}.test.js` | stub-текст обновлён |

**Легаси-формат не менялся:** `https://plugin.maniya-kvn.online/dorofeev200_d6de1c0fdce4.js` (slug = `linkPrefix`/`linkPrefix` из конфига, short = последние 12 hex токена). Маршрут `/^\/[^/]+_([0-9a-fA-F]{8,})\.js$/` в `index.js` не трогали.

## 3. Гейт (честная оценка)

- **Защита — «от случайного открытия в браузере», не крипто-скрытие** (как и в 002). Кто знает схему — обходит подменой UA (`curl -A "Lampa/…"`) или добавлением `?origin=bylampa.online`/`logged+reset`. Это тот же уровень доверия, что у legacy-ссылки до 002.
- MSX проходит по origin-query; браузер с голой ссылкой (без query) — stub. Требование «браузер видит текст, а не JS» выполняется при обычном открытии выданной ссылки.
- `/p/` остаётся рабочим маршрутом для уже выданных ссылок (обратная совместимость), но из нового install-flow исключён.

## 4. Тесты

Полный прогон `cd server && NODE_ENV=test node --test`: **543 tests: 535 pass / 2 fail (pre-existing date-dependent api.test.js «дней/дня») / 6 skip**.
Затронутые файлы: **75/75 pass** (plugin-install 23, nosecret 4, telegram, shortlink).

## 5. Deploy (ВЫПОЛНЕН 2026-08-14)

1. **Commit** `d445224` — ровно 7 файлов PLUGIN-INSTALL-003, staged diff проверен (без credentials, без чужих правок).
2. **Push** — только `backup` (`fa5f10b..d445224` → `feature/alloha-provider`).
3. **Deploy** — `scripts/deploy.sh` (сохраняет `server/.env` и `server/data`). Сервис `active`, `health` → 200.

## 6. PROD verification (10/10) через публичный HTTPS, реальный `dorofeev200`

short=`d6de1c0fdce4` (совпал с указанным в ТЗ), install=`80ea…4f`, токен `mo-…e4`.

| # | Проверка | Результат |
|---|---|---|
| A | браузер, голый `dorofeev200_d6de1c0fdce4.js` | 200 text/plain «Добавьте плагин в Расширения Lampa», без токена/кода |
| B | Android Lampa UA, legacy | 200 application/javascript, вшит реальный токен |
| C | MSX iOS UA, голый legacy | 200 stub (как браузер) |
| D | MSX + `?logged&reset&origin=bylampa.online` | 200 JS с токеном |
| E | MSX + только `?origin=bylampa.online` | 200 JS |
| F | `/p/<install>.js` браузер голый | 200 stub |
| G | `/p/<install>.js` Lampa | 200 JS-лоадер со скрытым `/x/`, без токена/кода |
| H | `/x/<install>_<key>.js` Lampa / браузер | 200 JS с токеном / 200 stub |
| I | `/x/` неверный ключ | 404 |
| J | `subscription/check` реальным токеном | 200 `authorized:true` |

**nginx access.log** (реальные размеры тела): legacy+origin → 200 **54779** (полный JS); `/p/` → 200 **59** (stub) и 200 **507** (лоадер); `/x/` → 200 **54779** / 200 **59**; wrong-key `/x/` → **404 69**.

### Осталось на устройствах пользователя (не могу сам)
Серверный гейт и формат ссылки проверены на реальных UA. Финальный шаг — открыть выданную legacy-ссылку в **Android Lampa** и **Media Station X** на устройствах: теперь MSX пройдёт по origin-query и получит полный JS. Если MSX пришлёт origin в ином виде — см. fallback `logged && reset` (оба маркера у Lampa web UI есть).
