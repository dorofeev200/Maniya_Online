# PLUGIN-INSTALL-002 — UA-гейт + скрытый ключевой путь (реальный код только для Lampa)

**Дата:** 2026-08-14 · **Статус:** реализация + тесты + live shadow — **ВЫПОЛНЕНЫ**; commit + deploy — **НЕ выполнены (ждут подтверждения пользователя)**.
**Scope:** только install-flow (маршруты `/p/`, `/x/`, `/i/`, UA-детекция). НЕ менялись: `server/src/availability.js`, провайдеры, cache, playback, `sources/card`, BALANCER-002/ONLINE8-002, SHADOW/COMPARE, Filmix TRUSTED_ALWAYS_VISIBLE, RCH/WebSocket.
**Правило отчёта:** реальные значения нигде не приводятся — только masked fingerprint (первые 6 + `…` + последние 2).

---

## 1. Что сделано

Схема приведена к референсу E-Online (пример `138.16.184.153:8080/…_<key>.js`): **браузер видит stub-текст, Lampa получает лоадер → скрытый ключевой путь → реальный код.** `/i/`-страница удалена (единая ссылка, как в примере).

| URL | Браузер | Lampa | Кэш | Реальный токен |
|---|---|---|---|---|
| `GET /p/<install>.js` | 200 `text/plain` «Добавьте в плагины Lampa» | 200 `application/javascript` **лоадер** (инжектит `<script src="…/x/<install>_<key>.js">`) | `no-store` | Нет (ни в URL, ни в теле) |
| `GET /x/<install>_<key>.js` (новый) | 200 stub-текст | 200 **полный плагин** через `sendPluginForToken` (вшит `window.MANIYA_ONLINE_TOKEN`) | `no-store` | Да — только в теле для Lampa |
| `GET /i/<opaque>` (устаревший) | 200 stub-текст | 200 stub-текст (никогда JS) | `no-store` | Нет |
| `/dorofeev200_<short>.js` (legacy) | 200 stub-текст | 200 JS с токеном | `no-store` | Да — сохранён |
| `/maniya-online.js` (static) | 200 stub-текст | 200 JS | `public, max-age=300` | — сохранён |

- **UA-детекция `isLampaRequest()`:** `/lampa/i.test(user-agent)`. Lampa дописывает версию в UA (`… Lampa/0.20.4`); обычные браузеры этого не делают → stub.
- **Скрытый ключ:** `key = HMAC-SHA256(PLUGIN_CODE_SECRET, 'plugin-code:'+install).digest('hex').slice(0,24)` (24 hex, 96 бит). Детерминирован (тот же юзер — тот же ключ), **не выводится из публичного URL**: браузер скрытый путь не получает вовсе; неверный/несуществующий ключ → **404**.
- **Лоадер `sendPluginLoader()`:** маленький IIFE (вставка `<script>`, обработка `appready`/`Lampa.Listener.follow('app')`), без полного кода и без токена.
- **Fail-closed:** без `PLUGIN_CODE_SECRET` `/p/<install>.js` **недоступен — 503 `plugin_code_not_configured`** для любого клиента (в т.ч. Lampa). Полный JS по `/p/` НЕ отдаётся ни при каких условиях (ранее был fallback на полный JS — удалён как раскрывающий код при мис-конфигурации). `/x/` без секрета и так fail-closed (`hiddenKeyMatches` → 404). Секрет из `.env.example` (закомментирован).
- **`/x/` порядок проверок:** юзер существует **и** ключ верный → 404 иначе; неактивная подписка → 403; UA-гейт — последним (stub для браузера даже при верном ключе).
- Время-константное сравнение ключа (`crypto.timingSafeEqual`, одинаковые длины, ненулевые).

### Изменённые файлы

| Файл | Правка |
|---|---|
| `server/src/config.js` | `pluginCodeSecret` из `PLUGIN_CODE_SECRET` |
| `server/.env.example` | Комментарий + `# PLUGIN_CODE_SECRET=` (обязателен) |
| `server/src/http.js` | `isLampaRequest()`, `PLUGIN_STUB_TEXT`, `sendPluginStub()` (text/plain, no-store, nosniff), `sendPluginLoader()`; статика JS → stub для браузера; удалён `sendInstallPage` |
| `server/src/index.js` | `hiddenPathFor()`/`hiddenKeyMatches()` (HMAC); маршрут `/x/<install>_<key>.js`; `/p/` → лоадер, **без секрета → 503 (fail-closed)**; `/i/` → всегда stub; legacy-shortlink + статика → stub для браузера |
| `server/src/telegram/bot.js` | `pluginUrl()` → `/p/<install>.js` (было `/i/…`) |
| `server/test/plugin-install.test.js` | **Полностью переписан: 18 тестов** новой схемы |
| `server/test/plugin-install-nosecret.test.js` | **Новый: 4 теста** fail-closed (без `PLUGIN_CODE_SECRET` `/p/`→503, `/x/`→404, `/i/`→stub) |
| `server/test/telegram.test.js` | Ассерты ссылок `/i/` → `/p/<install>.js` |
| `server/test/api.test.js` | Статику/плагин тестируем с Lampa-UA + новый тест «статика в браузере → stub» |
| `server/test/shortlink.test.js` | Шортлинк с Lampa-UA + новый тест «шортлинк в браузере → stub» |

---

## 2. Тесты

Полный прогон `cd server && NODE_ENV=test node --test`:

**538 tests: 530 pass / 2 fail (pre-existing, date-dependent) / 6 skip.**

- 2 fail — прежние pre-existing из `api.test.js`: склонение «26802/26803 дня» против регэкспа `/^Осталось \d+ дней$/` (фикстура `expires_at=2099`, сегодня 2026-08-14). К PLUGIN-INSTALL-002 отношения не имеют, `status.js` не менялся.
- `plugin-install.test.js`: **18/18 pass**; `plugin-install-nosecret.test.js` (fail-closed): **4/4 pass**; telegram / api / shortlink: **pass**.

### Проверки plugin-install.test.js (18)

1. `/p/` в браузере: 200 text/plain stub, не JS, без токена, no-store, nosniff
2. `/p/` для Lampa: лоадер-JS со скрытым `/x/<install>_`, БЕЗ кода/токена
3. лоадер → `/x/`: Lampa получает полный JS с токеном; браузер — stub
4. скрытый путь детерминирован: тот же юзер — тот же `/x/`; у A и B разные; совпадает с HMAC
5. `/x/` неверный ключ → 404
6. `/x/` несуществующий install → 404
7. `/x/` неактивного (верный ключ) → 403
8. `/x/` неактивного (неверный ключ) → 404 (ключ не угадан)
9. `/i/` → stub и для браузера, и для Lampa
10. короткий `/i/` (< 32 hex) → 404
11. legacy-шортлинк: браузер — stub, Lampa — JS с токеном
12. статика: браузер — stub, Lampa — JS (cached max-age=300)
13. API `subscription/check` по реальному токену → authorized
14. A/B изоляция: лоадеры и полный код A ≠ B в обе стороны
15. В URL нет subscription-токена — только opaque + HMAC-ключ
16. Кэш: stub/лоадер/код no-store; повторы идентичны
17. Несуществующий `/p/<opaque>.js` → 404
18. Секрет не попадает в stub/лоадер/код

---

## 3. Live shadow (локальный сервер, реальная прод-запись)

Read-only к проду: `users.json` с VPS скопирован в `%TEMP%` (вне репозитория), локальный сервер, локальный случайный `PLUGIN_CODE_SECRET`. Реальный пользователь `dorofeev200` (install `80eae4…4f`, токен `mo-6d7…e4`). Прод не трогался; temp-файлы удалены.

**Фаза 1 — секрет задан (12/12 PASS):**
- `/p/` браузер → 200 stub; Lampa → 200 JS-лоадер со скрытым `/x/…` без токена; путь совпал с HMAC-ожиданием
- `/x/` Lampa → 200 JS, вшит **реальный** токен `mo-6d7…e4`, полный плагин; браузер → 200 stub
- `/x/` неверный ключ → 404; `/i/` Lampa → 200 stub
- API `subscription/check` с реальным токеном → `authorized=true`

**Фаза 2 — секрета нет (fail-closed, 7/7 PASS):**
- `/p/` Lampa и браузер → **503 `plugin_code_not_configured`**, без кода/токена
- `/x/` Lampa → 404 (ключ не матчится без секрета), без токена
- `/i/` Lampa → 200 stub (не зависит от секрета)

---

## 4. Ограничения и честная оценка

- **UA-гейт — защита «от случайного открытия в браузере», не крипто-скрытие.** Код физически должен быть скачан Lampa-клиентом; любой, кто подменит User-Agent (например `curl -A "Lampa/0.20.4"`), получит и лоадер, и `/x/`-код с токеном. Ключ `/x/` усиливает защиту только от **наблюдателя URL** (он не выводится из публичной ссылки), а не от активного противника с Lampa-UA.
- Кто прошёл UA-гейт — получает полный плагин с реальным токеном (необходимо для авторизации Lampa). Это тот же уровень доверия, что и у legacy-ссылки.
- Скрытый путь детерминирован (HMAC) — его можно «сжечь» только сменой `PLUGIN_CODE_SECRET` (ротация = сломать все старые установки до перевыдачи ссылки).
- `/p/`, `/x/`, `/i/`, legacy-шортлинк не rate-limited (как и раньше) — дешёвые валидации подписки.

---

## 5. Deploy TODO (после подтверждения пользователя)

1. **Commit** — только файлы PLUGIN-INSTALL-002, staged diff показать, проверить отсутствие credentials.
2. **Push** — только remote `backup`.
3. **Deploy** — `scripts/deploy.sh` (сохраняет `server/.env` и `server/data`).
4. **Добавить `PLUGIN_CODE_SECRET` на VPS** в `/opt/maniya-online/server/.env` (случайная hex-строка, сгенерировать на VPS). **Без неё `/p/` недоступен (503, fail-closed)** — не деплоить, пока секрет не задан.
5. **PROD verification** с реальным пользователем: `/p/<install>.js` в браузере → stub; с Lampa-UA → лоадер → `/x/` → полный код с токеном; `/x/` неверный ключ → 404; `/i/` → stub; статика и legacy — браузер stub / Lampa JS.
