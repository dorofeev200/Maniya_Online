# PLUGIN-VERIFY-004 — «500 Плагин не подтверждён» в Media Station X: root cause + минимальный фикс stub-текста

**Дата:** 2026-08-14 · **Статус:** диагностика завершена, фикс применён (stub-текст + тест), commit → deploy → PROD verification (заполняется после деплоя).
**Scope:** ТОЛЬКО `PLUGIN_STUB_TEXT` (1 строка в `server/src/http.js`) + тестовая репродукция `Extension.check()` + отчёт. НЕ менялись: `isLampaRequest()`, `availability.js`, провайдеры, playback, cache, балансеры, install-flow (`pluginUrl`), `index.js`-маршруты.
**Правило отчёта:** реальные секреты не приводятся — только masked. Публичные части ссылок (short-суффикс, slug) приводятся как в ТЗ.

---

## 1. Проблема (root cause)

Media Station X (Lampa web UI в WKWebView) показывает на карточке плагина **«500 Плагин не подтверждён »**, хотя плагин грузится и работает.

- **«500» — не HTTP-500 от нашего сервера.** В nginx access.log на момент открытия плагина в MSX **ноль 5xx** (проверено awk `$9 ~ /^5/`). Сервер отдаёт 200.
- Текст «500 Плагин не подтверждён » рисует **сама Lampa** — хардкод в методе `Extension.check()` (app.min.js, ru-перевод `extensions_no_plugin`). Единственное место, где эта строка появляется функционально (в коде она встречается один раз; остальные вхождения — ru/en переводы).

### Точный запрос/ответ, вызывающий 500

```
GET https://plugin.maniya-kvn.online/dorofeev200_d6de1c0fdce4.js
    UA: Mozilla/5.0 (iPhone; … AppleWebKit/605.1.15) Mobile/15E148   ← БЕЗ «lampa», БЕЗ origin-query
→  200 | text/plain; charset=utf-8 | 59 B
    «Добавьте плагин в Расширения Lampa»        ← /Lampa\./ → false → Lampa рисует 500
```

Подтверждено прод-логами: голые fetch'и (19:32:06, 19:32:26, 19:33:08/11, 19:34:45, iPhone OS 18_7) → `200 59` (stub); fetch'и с `?logged&reset&origin=…` → `200 54779` (полный JS). После полного JS плагин работает: `subscription/check` 200, `sources` 200, `videos` filmix 200.

### Код Lampa `Extension.check` (app.min.js)

```js
key: "check", value: function check() {
  var url = Utils$1.fixMirrorLink(Utils$1.rewriteIfHTTPS(this.data.url || this.data.link));
  this.network.timeout(5000);
  this.network["native"](url, function (str) {          // ГОЛЫЙ native-fetch — БЕЗ Lamp.fetch, БЕЗ origin-query
    if (/Lampa\./.test(str)) display('success', 200, Lang.translate('extensions_worked'));     // «200 Рабочий»
    else                     display('error', 500,  Lang.translate('extensions_no_plugin'));   // «500 Плагин не подтверждён »
  }, function (a, e) { display('error', a.decode_code || 404, Lang.translate('title_error')); }, false, {dataType:'text'});
}
```

- Запускается **автоматически**: `Extension.visible()` при `params.autocheck` вызывает `check()` при показе карточки (и при смене URL/статуса, и по кнопке «Проверить»). Поэтому 500 виден на карточке без действий пользователя.
- Сетевой сбой показал бы другое («Ошибка» + `decode_code||404`) — значит у нас именно успешный 200 со stub'ом без литерала `Lampa.`.

### Почему Android проходит, MSX — нет

| | Android Lampa | MSX (Lampa web UI в WKWebView) |
|---|---|---|
| UA при чеке | `Lampa/…` / `lampa_client` | обычный iOS-UA, **без «lampa»** |
| `isLampaRequest()` | ✅ по UA | ❌ голый fetch не проходит гейт |
| Что получает чек | полный JS (54779 B) | stub (59 B) |
| `/Lampa\./` | ✅ → **200 Рабочий** | ❌ → **500 «Плагин не подтверждён»** |

### Почему плагин при этом грузится и работает

Реальная загрузка идёт через `Lamp.fetch`, который дописывает `?logged=…&reset=…&origin=…` → гейт проходит по fallback `logged && reset` → полный JS → плагин работает. **Ломается только чек** — единственный запрос, идущий голым fetch'ем.

---

## 2. Минимальный фикс (выбран)

Сделать, чтобы stub-тело содержало литерал **`Lampa.`** — тогда `/Lampa\./` пройдёт и MSX покажет зелёное **«200 Рабочий»** (что честно: плагин работает), а обычный браузер по-прежнему получит **текст, а не JS**. Гейт `isLampaRequest()` не ослабляется — JS браузеру не возвращается.

- `server/src/http.js` → `PLUGIN_STUB_TEXT`:
  `'Добавьте плагин в Расширения Lampa'` → **`'Добавьте плагин в Расширения Lampa.'`** (добавлена точка).
- Тестовые константы/строки синхронизированы: `plugin-install.test.js`, `plugin-install-nosecret.test.js`, `api.test.js`, `shortlink.test.js`.

Проверено живьём (до фикса): `«Добавьте плагин в Расширения Lampa»` → `/Lampa\./` **false**; `«Добавьте плагин в Расширения Lampa.»` → `/Lampa\./` **true**; полный JS (54779 B) → `/Lampa\./` **true** (Android-чек корректно 200).

---

## 3. Тесты

Добавлен отдельный тест в `server/test/plugin-install.test.js`, буквально воспроизводящий логику `Extension.check()` из app.min.js (`/Lampa\./.test(body)` → `200 extensions_worked` / `500 extensions_no_plugin`):

- bare-fetch stub'ов (legacy-шортлинк, `/p/`, `/x/`, статика) с MSX- и браузер-UA → тело обязано проходить `/Lampa\./` → verdict `200` (не 500).
- попутно assert: в stub'ах нет токена (`MANIYA_ONLINE_TOKEN` отсутствует) — JS не утекает.

## 4. Deploy

1. **Shadow-снапшот** перед деплоем: `scripts/backup-remote.sh` → `backup/snapshots/<stamp>/` (`.env`, `users.json`, `videos.json`).
2. **Commit** → staged diff проверен (только 5 файлов правок + отчёт; без availability/providers/playback/cache и чужих незакоммиченных файлов).
3. **Push** — только `backup`.
4. **Deploy** — `scripts/deploy.sh` (сохраняет `server/.env` и `server/data`). Сервис `active`, `health` → 200.

## 5. PROD verification

(заполняется после деплоя — чек-лист)

| # | Проверка | Ожидание |
|---|---|---|
| A | bare iPhone-UA legacy | 200 text/plain «Добавьте плагин в Расширения Lampa.», `/Lampa\./` **true** → MSX-чек **200 «Рабочий»**, НЕ 500 |
| B | с `?logged&reset&origin=…` | 200 application/javascript, полный JS с токеном (не изменилось) |
| C | браузер (Chrome UA) голый | 200 stub-текст, **без** токена/кода |
| D | Android Lampa UA legacy | 200 JS с токеном (не изменилось) |
| E | `/p/` Lampa UA | 200 лоадер со скрытым `/x/` (не изменилось) |
| F | `/x/` неверный ключ | 404 (не изменилось) |
| G | `subscription/check` реальным токеном | 200 `authorized:true` |
