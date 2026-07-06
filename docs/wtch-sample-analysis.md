# Анализ присланного WTCH/Lampac-плагина

Этот файл фиксирует, какие данные реально удалось извлечь из присланного примера и что нужно перенести/заменить для Maniya Online.

## Важный вывод

В присланном коде нет готового приватного токена подписки или API-ключа. Поле `token` есть, но оно пустое:

```js
var token = '';
```

Поэтому для Maniya Online токен подписки нужно выпускать на вашем сервере и сохранять в Lampa как `maniya_token`.

## Хосты и внешние URL из примера

| Назначение | Значение в примере | Что делать в Maniya Online |
| --- | --- | --- |
| Основной host | `http://wtch.ch/` | заменить на `https://plugin.maniya-kvn.online/` |
| RCH host | `http://wtch.ch` | не переносить без необходимости |
| NWS client | `http://wtch.ch/js/nws-client-es5.js?v21042026` | не переносить; это внешний скрипт старого сервиса |
| RCH result | `http://wtch.ch/rch/result?id=...` | не переносить |
| RCH gzip result | `http://wtch.ch/rch/gzresult?id=...` | не переносить |
| QR реклама | `http://api.qrserver.com/v1/create-qr-code/...` | удалить/заменить своим промо |
| Telegram bot из рекламы | `https://t.me/showybot?start=pro` | заменить на ваш бот Maniya Online, если он будет |

## Storage-ключи из примера

| Ключ | Назначение | Аналог в Maniya Online |
| --- | --- | --- |
| `lampac_unic_id` | локальный ID устройства/плагина | `maniya_unic_id` |
| `account_email` | email аккаунта Lampa | оставить как входной параметр |
| `lampac_nws_id` | ID native websocket/RCH | пока не нужен |
| `kit_aesgcmkey` | доп. заголовок `X-Kit-AesGcm` | не переносить без понимания источника |
| `clarification_search` | уточнённый поиск по карточке | можно добавить позже |
| `online_last_balanser` | последний выбранный источник фильма | `maniya_online_source` уже есть частично |
| `online_balanser` | глобальный выбранный источник | `maniya_online_source` |
| `active_balanser` | активный балансер | не нужен отдельно |
| `online_choice_<source>` | сезон/озвучка/просмотр по источнику | добавить позже при развитии UI |
| `online_watched_last` | последняя история просмотра | добавить позже |
| `online_view` | просмотренные серии/фильмы | добавить позже |

## API endpoint-ы из примера

| Endpoint | Назначение | Статус в Maniya Online |
| --- | --- | --- |
| `/lite/withsearch` | список балансеров с поиском | пока не нужен |
| `/externalids` | получить IMDb/KP/TMDB ID | пока используем данные карточки Lampa |
| `/lite/events?life=true` | список источников/балансеров | заменено на `/api/lampa/sources` |
| `/lifeevents?memkey=...` | long-poll готовности источников | пока не нужен |
| URL балансера из `/lite/events` | список сезонов/озвучек/видео | заменено на `/api/lampa/videos` |
| `file.url` при `method: call` | финальная ссылка потока | заменено на `/api/lampa/stream` |

## Query-параметры, которые отправлял пример

| Параметр | Описание | Используем сейчас |
| --- | --- | --- |
| `account_email` | email аккаунта Lampa | да |
| `uid` | локальный ID | да |
| `token` | токен доступа, но в примере пустой | да, как `maniya_token` |
| `nws_id` | websocket/RCH ID | нет |
| `id` | ID карточки | да |
| `imdb_id` | IMDb ID | да |
| `kinopoisk_id` | Kinopoisk ID | да |
| `tmdb_id` | TMDB ID | да |
| `title` | название | да |
| `original_title` | оригинальное название | да |
| `serial` | фильм/сериал | да |
| `original_language` | язык оригинала | можно добавить позже |
| `year` | год | да |
| `source` | источник карточки | пока нет |
| `clarification` | уточнённый поиск | пока нет |
| `similar` | похожие результаты | пока нет |
| `rchtype` | режим RCH | нет |
| `cub_id` | hash email | пока нет |

## Форматы ответа из примера

Старый плагин ждал HTML с элементами `.videos__item` и `.videos__button`, где данные лежали в `data-json`.

Для Maniya Online выбран более простой JSON-формат:

```json
{
  "items": [
    {
      "title": "1080p",
      "method": "play",
      "url": "https://example.com/master.m3u8"
    }
  ]
}
```

Это проще поддерживать на вашем сервере и безопаснее, чем парсить HTML.

## Что не переносим специально

1. `eval` / `evalrun` — старый сервер мог выполнить произвольный JS в клиенте. Это опасно.
2. Внешний `nws-client-es5.js` с `wtch.ch` — это зависимость чужого сервиса.
3. RCH-прокси как обязательную часть — добавлять только если реально понадобится обход CORS.
4. Рекламу Showy/ShowyBot — это чужой бренд.
5. Список чужих балансеров как готовую интеграцию — источники нужно подключать на сервере Maniya Online легально и отдельно.

## Что нужно сделать дальше

1. Задеплоить текущий сервер на VPS.
2. Проверить, что `https://plugin.maniya-kvn.online/health` отдаёт `{ "ok": true }`.
3. Подключить плагин в Lampa:

```text
https://plugin.maniya-kvn.online/maniya-online.js?token=demo-token
```

4. Заменить `demo-token` и тестовый поток на реальные данные.
5. Добавить вашу систему выдачи подписок: админка, Telegram-бот или ручной JSON/БД.
