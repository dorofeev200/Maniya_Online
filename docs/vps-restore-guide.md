# Восстановление на новом сервере (disaster recovery / миграция VPS)

Если с текущим VPS что-то случилось — восстанавливаемся на новом за ~10 минут,
не теряя ни кода, ни секретов, ни пользователей. Все механизмы уже готовы в репо.

> Гарантия «ничего не потерять» = две независимые копии:
> **код** — GitHub (remote `backup`) / проверяются локально тестами;
> **незаменимые данные** — локальные снапшоты `backup/snapshots/<stamp>/`.
> `backup/` в .gitignore (секреты только локально, не в git/не на чужом хосте).

## 0. Карта: что где лежит и как восстанавливается

| Компонент | Где живёт | Как восстанавливается |
|---|---|---|
| Код + конфиги сервера | git-репо, remote `backup` | `deploy.sh` (tar-over-ssh) |
| systemd-сервис `maniya-online` | генерируется на лету | `deploy.sh` (шаблон) |
| nginx-конфиг | генерируется на лету | `deploy.sh` (шаблон) |
| TLS-сертификат | на VPS, certbot renew | `deploy.sh` → `certbot --nginx -d DOMAIN` |
| **Секреты `.env`** (токены, SKAZ_ACCOUNT_EMAIL/UID) | **снапшот** `backup/snapshots/<stamp>/.env` (скрытый файл!) | `restore-vps.sh` [2/3] |
| **Пользователи** `users.json` (подписки/токены) | **снапшот** `.../users.json` | `restore-vps.sh` [2/3] |
| Кэш `videos.json` (опционально) | **снапшот** `.../videos.json` | `restore-vps.sh` [2/3] |
| Домен + DNS | **Cloudflare** (вне VPS!) | руками: A-record на новый IP |
| SSH-доступ | пароль root нового VPS | руками (SSH_ASKPASS для неинтерактива) |

Снапшоты: `backup/snapshots/20260807-184437/`, `20260810-163948/` (последний — актуальный).

## 1. Профилактика (до «часа X»)

1. После каждой волны изменений — `push` в `backup` (рабочая ветка `feature/alloha-provider`).
2. Свежий снапшот перед важными изменениями `.env`/`users`:
   ```bash
   bash scripts/backup-remote.sh
   ```
3. Один раз в неделю — тот же `backup-remote.sh` (можно через Планировщик Windows,
   `schtasks /create /tn maniya-backup /tr "bash C:\Users\Admin\Maniya_Online\scripts\backup-remote.sh" /sc weekly ...`).
4. НЕ удалять `backup/snapshots/` — это единственная копия секретов и подписок.

## 2. Новый сервер — подготовка

1. Арендовать VPS (Ubuntu 22.04/24.04, минимум 1GB RAM), root + пароль, запомнить **NEW_IP**.
2. Проверить из Git Bash: `ssh -o ConnectTimeout=10 root@<NEW_IP> echo ok` (пароль парой вопросов не
   задаётся — для неинтерактива используется SSH_ASKPASS, шаблон в конце файла).

## 3. DNS (Cloudflare) — до запуска деплоя

1. В Cloudflare → домен → DNS: A-запись `plugin.maniya-kvn.online` → **NEW_IP**.
2. Подождать пропагацию (обычно 1–5 мин). Локально проверить: `nslookup plugin.maniya-kvn.online`.
3. Если это не авария, а плановый переезд — можно сначала переключить DNS, потом деплой;
   при аварии порядок не важен — certbot в `deploy.sh` с `|| true` корректно дождётся (см. п.5).

## 4. Восстановление — ОДНА команда (с локального ПК)

```bash
SERVER_HOST=<NEW_IP> bash scripts/restore-vps.sh
#   дефолт — самый свежий снапшот; или явно:
SERVER_HOST=<NEW_IP> bash scripts/restore-vps.sh -s backup/snapshots/20260810-163948
```

Что делает `restore-vps.sh`:
1. `deploy.sh` — заливает код, ставит node/nginx/certbot, генерирует systemd + nginx,
   `systemctl enable --now maniya-online`, `certbot`, health-проверку.
   `.env` deploy **не перезаписывает** (шаблон создаётся только если файла ещё нет).
2. Кладёт сверху снапшот: `.env` → `server/.env`, `users.json`/`videos.json` → `server/data/`.
3. Рестарт сервиса + `curl http://127.0.0.1:3000/health`.

Если сменили домен: `SERVER_HOST=<NEW_IP> DOMAIN=<новый>.online bash scripts/restore-vps.sh`.

## 5. Пост-восстановление

1. **TLS**, если certbot не успел (DNS ещё ехал):
   ```bash
   ssh root@<NEW_IP> "certbot --nginx -d plugin.maniya-kvn.online --non-interactive --agree-tos --register-unsafely-without-email"
   ```
2. **Проверка из браузера/curl:**
   ```bash
   curl -fsS https://plugin.maniya-kvn.online/health
   TOKEN=<токен из свежего backup/snapshots/<stamp>/users.json> bash scripts/verify-remote.sh
   ```
3. **Сквозная проверка в Lampa** (важнее любых curl): открыть плагин, источники Maniya
   должны быть (skaz-alloha/geosaitebi/…), включить фильм → поток играет (HLS через прокси).
4. **Первый свежий бекап с нового сервера**:
   ```bash
   SERVER_HOST=<NEW_IP> bash scripts/backup-remote.sh
   ```
5. Оставить старый VPS выключенным до момента, пока всё не проверили (при аварии — не критично).

## 6. Тривиальный запасной путь (если репо потерян, но снапшоты есть)

Полный код так просто не восстановить из снапшота — поэтому `push` в `backup` держим всегда
свежим. Минимальная альтернатива: скачать релизный тарбол с GitHub (тэг/ветка) → распаковать
→ `deploy.sh`. Снапшот дополняет только `.env`/`users.json`.

## SSH_ASKPASS (неинтерактивный вход по паролю, Windows Git Bash)

```bash
printf '#!/bin/sh\necho "<PASSWORD>"\n' > /tmp/askpass.sh && chmod +x /tmp/askpass.sh
export SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force DISPLAY=dummy:0
```
`<PASSWORD>` — текущий root-пароль VPS (НЕ коммитить: только локально/в памяти).
Рекомендация на будущее: `ssh-copy-id` один раз → пароль больше не нужен.