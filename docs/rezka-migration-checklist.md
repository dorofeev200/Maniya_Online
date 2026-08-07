# Миграционный чеклист: RezkaClient (текущий) → Lampac-контракт

> Дата: 2026-08-06. Эталон: Lampac `Modules/OnlinePaid/Rezka/{Controller,Service,AnubisFast}.cs`
> (локальная копия в `AppData/Local/Temp/lampac-rezka/`). Цель — пересобрать провайдер под
> реальный AJAX-контракт HDRezka, закрыть фиктивный `/api/*`.

## 1. Сравнение: текущий клиент vs Lampac

| Слой | Текущий Maniya (`RezkaClient.js`) | Lampac (эталон) | Вердикт |
|---|---|---|---|
| Поиск | `GET /api/search` (без query!) → JSON `{results}` | `GET {host}/search/?do=search&subaction=search&q={q}` → HTML `b-content__inline_item` | **заменить целиком** |
| Карточка | `GET /api/card/{id}` → JSON | `GET {host}/{href}.html` → HTML (`translators-list`, `data-season_id`, `cdnplayer`) | **заменить целиком** |
| Стримы | `GET /api/streams/{id}` → JSON `{streams,translations,qualities}` | `POST {host}/ajax/get_cdn_series/?t={ts}{rand}` form-urlencoded, `action=get_episodes|get_movie|get_stream` | **заменить целиком** |
| Декодирование потока | нет (URL напрямую из JSON) | `decodeBase64` (мусор `#h`, `//_//`, trashList) → `[quality]url,[...]` + `getStreamLink` (резервы ` or `, HLS) | **добавить** |
| Анти-бот | нет | Anubis: `anubis_challenge` → SHA-256 PoW → `pass-challenge` + cookie `techaro.lol-anubis-cookie-verification` | **добавить** |
| Авторизация | нет | `POST /ajax/login/` → cookie `dle_user_id`,`dle_password` | **добавить (опционально, premium)** |
| Заголовки AJAX | `accept: application/json` | `x-requested-with: XMLHttpRequest`, `origin`, `referer` (embed-URL), `accept: application/json, text/javascript, */*` | **добавить** |
| Гео-блок | нет | коды `Ошибка доступа (105)` IP-блок, `(101)` аккаунт, `403` | **обработать** |

## 2. Что ломается при пересборе

- `RezkaProvider.search()` — сейчас зовёт `client.search()` → вернёт строки из нового HTML-парсинга (тот же контракт записей, но id = href-слаг).
- `RezkaProvider.streams()` — текущий путь `client.streams(id)` мёртв; нужен полный резолв «карточка → перевод → поток».
- `card(id)` — сигнатура меняется: не id, а `href` (слаг `.html`). Провайдер должен передавать ссылку из поиска.
- Нормализатор `RezkaNormalizer` целиком ожидает JSON `{streams,translations,qualities}` — переписывается на HTML-парсинг.

## 3. Чеклист миграции

### Фаза 1 — клиент (этот PR)
- [ ] `searchHtml({query})` → `GET /search/?do=search&subaction=search&q=` + разбор HTML.
- [ ] `page(href)` → `GET {host}/{href}` + извлечение `id`, `translators-list`, `cdnplayer`-base64, `data-season_id`/`initCDNSeriesEvents`.
- [ ] `getEpisodes(id, translatorId)` → `POST get_episodes` (seasons+episodes HTML).
- [ ] `getStreamMovie(id, translatorId, {director,favs})` → `POST get_movie`.
- [ ] `getStreamEpisode(id, translatorId, season, episode, favs)` → `POST get_stream`.
- [ ] `decodeBase64` + `getStreamLink` (чистые функции, `[quality]url` + резервы + HLS-флаг).
- [ ] Anubis: `solveAnubis(html)` (crypto SHA-256 PoW) + `pass-challenge` + cookie-контейнер + повторный запрос.
- [ ] Заголовки AJAX (`x-requested-with`, `origin`, `referer`), `ts+rand` в query.
- [ ] Юнит-тесты на фикстурах (без сети).

### Фаза 2 — нормализатор
- [ ] `normalizeSearchItem` из HTML-блоков.
- [ ] `normalizeTranslations` из `translators-list`.
- [ ] `normalizeSeasons/Episodes` из HTML `get_episodes`.
- [ ] `resolveQualities` из `decodeBase64`.
- [ ] Хранение `referer` для потока/плеера.

### Фаза 3 — провайдер
- [ ] `search()`, `streams()`, `videos()` по Maniya-контракту (Filmix-стиль: fallback, логирование).
- [ ] `config.rezka` (host, mirror, premium, hls, reserve, enabled).
- [ ] CDN-хосты Rezka в `PROXY_ALLOW_HOSTS`.

### Фаза 4–5 — проверка и включение
- [ ] `test/live-rezka.test.js` (skip по умолчанию).
- [ ] Регистрация в `registry.js` (уже есть) + `.env.example`.
