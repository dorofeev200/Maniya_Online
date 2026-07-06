# Maniya Online API для Lampa

Базовый URL в плагине задаётся константой `MANIYA_API_BASE`.

## Общие параметры

Плагин добавляет к запросам:

| Параметр | Описание |
| --- | --- |
| `uid` | локальный ID устройства/плагина |
| `token` | токен подписки, если задан |
| `account_email` | email аккаунта Lampa, если доступен |
| `cub_id` | hash email аккаунта Lampa для совместимости с логикой старого примера |
| `id` | TMDB/CUB ID карточки |
| `imdb_id` | IMDb ID, если есть |
| `kinopoisk_id` | Kinopoisk ID, если есть |
| `tmdb_id` | TMDB ID, если есть |
| `title` | локализованное название |
| `original_title` | оригинальное название |
| `serial` | `1` для сериала, `0` для фильма |
| `year` | год релиза |
| `original_language` | язык оригинала, если есть |
| `source` | источник карточки, обычно `tmdb` |
| `clarification` | `1`, если включён уточнённый поиск |
| `similar` | `true`, если запрошены похожие результаты |


## Передача token из плагина

Плагин передаёт `token` двумя способами для совместимости с разными версиями Lampa:

1. query-параметр `token=...` добавляется ко всем API URL;
2. HTTP header `Authorization: Bearer <token>` добавляется ко всем JSON API-запросам.

Сервер принимает оба варианта.

## GET `/subscription/check`

Проверяет доступ пользователя.

### Успешный ответ

```json
{
  "active": true,
  "expires_at": "2026-12-31T23:59:59Z",
  "plan": "pro"
}
```

### Нет подписки

```json
{
  "active": false,
  "message": "Подписка Maniya Online не активна"
}
```

## GET `/sources`

Возвращает источники, доступные пользователю и текущей карточке.

```json
{
  "sources": [
    {
      "id": "main",
      "name": "Maniya Online",
      "url": "https://maniya.online/api/lampa/videos?source=main",
      "show": true
    }
  ]
}
```

Если подписка неактивна, верните HTTP `403` или:

```json
{
  "error": "subscription_required",
  "message": "Нужна активная подписка Maniya Online"
}
```

## GET `/videos`

Возвращает список сезонов, озвучек или файлов. Формат ответа — JSON.

### Фильм

```json
{
  "items": [
    {
      "title": "1080p",
      "method": "play",
      "url": "https://cdn.example.com/movie/master.m3u8",
      "quality": {
        "1080": "https://cdn.example.com/movie/1080.m3u8",
        "720": "https://cdn.example.com/movie/720.m3u8"
      },
      "subtitles": []
    }
  ]
}
```

### Сериал

```json
{
  "items": [
    {
      "title": "Серия 1",
      "season": 1,
      "episode": 1,
      "voice_name": "Оригинал",
      "method": "call",
      "url": "https://maniya.online/api/lampa/stream?id=abc"
    }
  ]
}
```

## GET `/stream`

Финальная выдача ссылки для элемента с `method: "call"`.

```json
{
  "url": "https://cdn.example.com/episode/master.m3u8",
  "headers": {},
  "quality": {
    "1080": "https://cdn.example.com/episode/1080.m3u8",
    "720": "https://cdn.example.com/episode/720.m3u8"
  },
  "subtitles": []
}
```
