# Диагностика: 404 при двух параллельных клиентах (concurrent clients)

Дата: 2026-08-14. Статус: **ЗАКРЫТО — 404 НЕ гонка и НЕ серверный 404.**
Код не менялся, коммитов нет, деплоя нет (диагностика read-only: GET-запросы к локальному
сервису на VPS).

## Постановка (со слов пользователя)
Одновременно подключены два разных телефона/пользователя → «появился 404».
Гипотеза: BALANCER-UI-001 имеет shared mutable state, ломающийся при параллельных запросах.
Проверялись: (1) клиентский state в maniya-online.js; (2) серверный shared state в
availability.js; (3) эмпирический параллельный A/B-тест ×10; (4) точный URL 404 в логах.

## 1. Клиент (public/maniya-online.js) — shared state ОТСУТСТВУЕТ
- Модульные глобалы (строки 4–12): `MANIYA_API_BASE`, `COMPONENT`, `PLUGIN_FLAG`,
  `sortMenuOpen`, `selectWatchBound` — константы/флаги-одиночки, по запросу не пишутся.
- Всё состояние карточки (строки 342–358) — замыкание компонента: `sources`, `filterSources`,
  `activeSource`, `activeUrl`, `activeSeason`, `activeVoice`, `seasonNumbers`, `voiceIndexes`,
  `seasonEpisodesCache`. Каждый телефон = отдельный JS-runtime (отдельная вкладка/устройство) →
  перекрёстно-телефонный доступ к этим переменным невозможен в принципе.
- `bindSelectWatch()` (BALANCER-UI-001) работает через `Lampa.Select.listener` с
  дискриминатором `items[0].source` — состояние в замыкании, не глобал.
- **Вывод: клиент не может гонять состояние между двумя телефонами.**

## 2. Сервер (server/src/availability.js) — shared state для данных ОТСУТСТВУЕТ
- `card()` (строки 756–891): все данные — локальные (`deadline`, `settled`, `rows`, `key`).
- `resolveSources()` (715–735): строит **свежий массив** на каждый вызов; реестр
  `registeredProviders()`/`allProviderInstances` читается только на чтение.
- `cache` (Map): синхронные get/set (JS однопоточный), ключ
  `fnv1aKey(id:serial:source:count:userUid)` (строка 741) — **по-пользовательский**
  (uid = sha256(token) из запроса) и по-id. Смешивания A/B через кэш невозможно.
- `SkazClient._hostIndex`: курсор ротации хостов (round-robin) — влияет на *какой хост*
  пробуется, не на *какие данные*. Гонку данных не порождает.
- `SkazClient.lastAccsdb`: диагностика (SkazProvider.js:468) — маскимально «устаревший»
  `provider_error.message`, не данные фильма; 404 не порождает.
- `SkazProvider._navCache`: только в videos/resolve-пути, ключ = полные pageParams
  (title/id/serial), кэширует только непустое, TTL 5 мин — перекрёстно-фильмового
  смешивания нет.
- **Вывод: серверный card-путь не имеет cross-request mutable state, влияющего на данные.**

## 3. Эмпирика: параллельный A/B-тест (VPS, localhost:3000, GET)
- Client A = token `mo-54f4a…` (uid prsknyel) → «Одиссея» id=1368337 serial=0.
- Client B = token `mo-fb9bf…` (uid qqxlj0kh) → «Последний дом» id=1284041 serial=0.
- Фильмы реально открывались этими телефонами вчера (из access.log.1).

Тёплый (кэш-хиты, 4–8 мс):
- Concurrent A||B × 10: **10/10 clean** — паттерн A всегда = soloA, B = soloB.
- Cross-scope (тот же фильм обоими токенами) × 3: **3/3 clean** — uid-scoping в ключе
  кэша работает под контенцией.

Холодный (4 свежие пары, 16 проверок, дедлайн 10 с исчерпывался → кэш не заполнялся):
- **Zero swaps**: ни в одной паре A ≠ B не совпали, нет cold/warm-swap.
- Паттерны флапали между прогонами одного и того же фильма — это upstream-флоп, НЕ гонка.
  Доказательство (контроль, тот же фильм **последовательно** ×3):
  - «Дом Дракона»: 2 разных паттерна без конкуренции (skaz-rhsprem 1→0).
  - «Молодой Вашингтон»: «sparse» (всё скрыто) в solo cold-теста и «full» в последовательном
    контроле и наоборот — кластер skaz флапает вердикты во времени.
- Все статусы 200; ошибок `video_not_found` нет.

**Вывод: 404 не воспроизводится параллельными card-запросами; смешивания A/B нет.**

## 4. Точный URL 404 (логи nginx + journald)
За 13.08 (`access.log.1`):
- `/api/lampa/video`: 468×200, 264×204(OPTIONS), 6×499(клиент-аборт), **0×404**.
- `/api/lampa/sources/card`: 38×200, 30×204, **0×404**.
- Единственный `/api/lampa` 404 — голый `GET /api/lampa` в 19:18:02 с bot-подобного
  iPhone-UA (iOS 13.2.3/Safari 13.0.3), IP 101.33.55.204. Это не телефон пользователя.
- Journald за 13.08: все 404 — сканеры/боты (/.svn/wc.db, /api/key, /favicon.ico,
  /phpmyadmin*, /robots.txt, /sitemap.xml, /test.php, /HNAP1, /webdav/ и т.п.) с чужих IP.
  С IP пользователей (31.40.208.24/.38) 404 за день — **ноль**.

За 12.08 (`access.log.2.gz`):
- `/api/lampa/video`: 271×200, 177×204, 1×400, 1×403, 2×499, **0×404**.

Реальные не-2xx пользователей за 13.08 — ошибки upstream-прокси:
- veoveo 403 (rstprgapipt.com), filmix 403/429 (werkecdn.me, cdnsqu.com), pidtor 503,
  collaps 500 (interkh.com). Именно эти ошибки Lampa показывает как «видео не найдено»/сбой.

## 5. Вердикт
- 404 **не** связан с concurrency и **не** генерируется сервером: за оба дня
  `/api/lampa/video` и `/sources/card` не вернули ни одного 404 реальному пользователю.
- BALANCER-UI-001 не имеет cross-phone shared state (клиент изолирован по-телефону;
  сервер — по-пользовательский кэш, sync Map, свежие массивы).
- Виденный пользователем «404» = почти наверняка отображение Lampa ошибки upstream-прокси
  (403/429/503/500 на нестабильных CDN: veoveo/filmix/pidtor/collaps), либо голый
  bot-запрос `/api/lampa`. В обоих случаях это не `/api/lampa/video` 404 сервера.
- **Действия не требуются.** Кластер skaz сейчас стрессует (многие проверки упираются в
  дедлайн 10 с) — вердикты карточки флапают; это меняет список источников в UI, но не
  ломает Play. Кэш card не заполняется при инконклюзивных вердиктах (self-heal).

## Артефакты
- Скрипты тестов (временные, удалены из репо): `concurrency-card-test.mjs`,
  `concurrency-card-cold.mjs`, `card-stability-control.mjs` (были на VPS в /tmp).
- Временные файлы на VPS: `/tmp/concurrency-*.mjs`, `/tmp/card-stability-control.mjs`,
  `/tmp/uidb.txt` — можно удалить.
