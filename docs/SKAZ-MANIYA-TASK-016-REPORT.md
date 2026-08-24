# SKAZ-MANIYA-TASK-016 — CLOSE OLD VPS TELEGRAM POLLING

**Дата:** 2026-08-22 (exe 2026-08-21 22:0x–22:2x MSK) — **СОСТОЯНИЕ: В РАБОТЕ / НАБЛЮДЕНИЕ**
**VPS:** OLD `95.85.241.121` (DigitalOcean, 1vCPU/2GB), Production Moscow `135.106.195.203` (4vCPU/8GB)
**Правило:** production/code не менять; философия KPM — при аномалии STOP→диагностика→доклад, hotfix не делать.

---

## TL;DR

| # | Пункт задачи | Статус | Доказательство |
|---|---|---|---|
| 1 | OLD `TELEGRAM_ENABLED=0` | ✅ PASS | .env строка 17 флипнута 1→0; md5 8aff635c92… (бэкап .env.bak-t016-pre md5 2f871fb44b…) |
| 2 | НЕ менять код/balancer/providers/proxy/HLS/users/data/nginx/DNS/domain | ✅ PASS | только 1 строка .env на OLD, ничего более |
| 3 | Рестарт только Maniya на OLD | ✅ PASS | рестарт 22:09:57, active |
| 4 | OLD: active / health 200 / NRestarts=0 / poller НЕ стартует | ✅ PASS | journal: 0 событий telegram_polling_started/getupdates с 22:10:00 |
| 5 | Moscow: sole poller, 409 исчезает | ✅ PASS (409=0) / ⚠️ нюанс | 0×409 с 22:10:00; **но** с 22:10:49 поллер Moscow ловит «fetch failed» — не может достучаться до API Telegram |
| 6 | Реальным действием бота проверить, что prod-бот работает | ⛔ BLOCKED (upstream) | Moscow egress → api.telegram.org (149.154.166.110:443) — SYN-drop; OLD достукивается (http=200) |
| 7 | Наблюдение 5-10 мин (409, errors, NRestarts, health, 5xx) | 🔄 ИДЁТ | монитор 30×30с на Moscow (getMe-ретраи + health/NRestarts/err) |
| 8 | OLD полностью НЕ выключать (rollback-ready) | ✅ PASS | OLD active, nginx live, только TGABOT-поллинг закрыт |
| 9 | Отчёт | 🔄 пишется | этот файл |

**FINAL STATUS: НЕ ЗАКРЫТ до снятия IP-бана Moscow→api.telegram.org** (см. §5).

---

## 1. Изменения на OLD (95.85.241.121)

Файл `/opt/maniya-online/server/.env`:

```
- TELEGRAM_ENABLED=1
+ TELEGRAM_ENABLED=0     (единственное изменение; бэкап .env.bak-t016-pre)
```

- **Реальная механика поллера:** фактический гейт — `TELEGRAM_ENABLED` (`server/src/config.js:76` `enabled: bool('TELEGRAM_ENABLED', false)`; `server/src/index.js:348` `const telegramRunner = config.telegram.enabled && config.telegram.botToken`).
  `TGAUTH_ENABLED`/`TGABOT_ENABLED` — **мертвый legacy-конфиг** (TASK-006 аудит: код их не читает). Имя в спец задачи («TGABOT_ENABLED») не соответствует фактической механике — по договорённости флипнут `TELEGRAM_ENABLED`.
- `config.telegram.enabled` больше нигде в коде не используется → отключение не трогает auth (`users.json` читается напрямую). **Авторизация устройств не затронута.**
- md5: **.env 8aff635c920265975aaa0810714be7ee** (новый) vs **2f871fb44b1183cc052aa61e5687f356** (пре-флип, .bak-t016-pre).

## 2. Runtime-состояние

| VPS | act | NRestarts | health | Poller |
|---|---|---|---|---|
| OLD | active | 0 | 200 | НЕ стартует: 0 telegram_polling_started / getupdates с 22:10:00 |
| Moscow | active | 0 | 200 | sole poller; последний старт 21:31:58; с 22:10:49 ошибки сети (fetch failed) |

## 3. A/B на поллер (реальное дли-поллинг)

До флипа (окно коэкзистенса): **«409 terminated by other getUpdates» warn-луп у обоих** (193 warn за 10 м, 0 err-level) — ожидаемый конфликт двух поллеров одного токена.

После флипа: **0×409 с 22:10:00** у Moscow (единственный поллер). CAVEAT: 409 исчезли синхронно с обрывом egress (см. §5) — признак «409=0» зашумлён сетью.

Строгая граница OLD: последнее telegram-событие **22:09:56.367** (последний 409), рестарт 22:09:57, **telegram-событий на OLD после 22:10:00 = 0** (journal count) → поллер OLD не стартует.

## 4. Точка «прекращение конкурентного поллинга»

- 22:09:57 — рестарт maniya-online на OLD (поллер закрыт).
- 22:09:59 — **последний** 409-ответ (Moscow).
- 22:10:49 — первый «fetch failed» у поллера Moscow (обрыв сети до 149.154.166.110).
- 22:10:50+ — ретраи поллера каждые ~50с, все «fetch failed» (поллер жив, сеть мертва).

## 5. ⚠️ КРИТИЧЕСКАЯ НАХОДКА: egress Moscow → api.telegram.org НЕПРИГОДЕН (upstream)

**Симптом:** с ~22:10:49 поллер Moscow не может достучаться до Telegram-API.

**Диагностика (22:2x):**

| Тест | Результат |
|---|---|
| OLD→`https://api.telegram.org/bot…/getMe` (v4) | **http=200**, connect=0.028 s, t=0.096 s — API жив |
| Moscow→idem | **http=000**, connect=0.000 s, t=8.002 s (connect-timeout) |
| Moscow→api.github.com (контроль, v4) | http=200, connect=0.042 s — egress в целом рабочий |
| Moscow→raw TCP 149.154.166.110:443 (нода api.telegram.org) | **SYN-drop / тайм-аут** |
| Moscow→raw TCP 149.154.167.220:443 (др. нода Telegram) | **TCP connect OK** → блок точечный, не вся сеть Telegram |
| DNS (Moscow) | api.telegram.org только → **149.154.166.110** (v4) и 2001:67c:4e8:f004::9 (v6); v6 сразу fail |

**Вывод:** на узле `149.154.166.110` установлен **дроп входящего SYN из 135.106.195.203** (не RST — пакеты молча теряются, connect=0). Пока api.telegram.org держит именно эта нода, весь трафик bot API с Moscow мёртв. OLD такую блокировку не имеет.

Контрольный замер из локальной (Windows) еgress: **http=000, connect=0.000** — мгновенный отказ (не тайм-аут) → на локальной сети тоже есть ограничение до api.telegram.org; вывод INCONCLUSIVE (не путать с SYN-drop-тайм-аутом Moscow). Не используется как доказательство.

**Вероятная причина:** контентный IP-бан со стороны Telegram за **409-churn** (два поллера одного токена в коэкзистенс-окне долбили `getUpdates`, конфликтовали мгновенно → пачка немедленных рестартов коннекта). До ~22:05 Moscow достукивался (409-ответы — живые коннекты) → блок активирован где-то в 22:05-22:10, т.е. на последние минуты churn. Это **upstream-ограничение**, не дефект Maniya-кода/миграции.

**Как не делать:** hotfix не применяется (KPM). Решение — ждать снятия (ретраи поллера идут автоматически каждые ~50с; layout восстановится сам), при длительном блоке — решать с пользователем (в т.ч. временный возврат поллера на OLD).

## 6. Мониторинг-окно (TASK-016 п.7)

Монитор `/tmp/t016_mon.sh` на Moscow: 30×30с = 15 мин, в `/tmp/t016_mon.log`:
- `getMe=` — восстановление egress (http=200 = блок снят);
- health / act / nrestarts / load — служба;
- `tgwarn1m` — счётчик warn-поллера за минуту (ожидаемо «fetch failed» пока блок в силе, 0 при восстановлении);
- первый текстовый фрагмент warn/err за минуту.

**Итог окна — в §7** _(заполняется после завершения монитора)._

## 7. Итоги наблюдения (заполняется post-window)

_place_

## 8. Rollback (TASK-016 п.8)

- OLD **активен** и не тронут (только poller закрыт). Вернуть поллинг OLD = одна строка `.env` (TELEGRAM_ENABLED=1) + рестарт.
- Файл `.env.bak-t016-pre` — точная пре-флип копия (md5 2f871fb44b…).
- OLD VPS целиком не выключается.

## 9. Follow-ups

- Если блок Telegram держится долго (>времени наблюдения) — согласовать: ждать vs временный возврат поллера OLD (с риском 409 при восстановлении Moscow) vs другие каналы бота.
- Следить за ретраями поллера Moscow: как только `getMe`/`getUpdates` вернёт 200 на ноду — бот полностью рабочий, п.6 закрыт реальным действием.